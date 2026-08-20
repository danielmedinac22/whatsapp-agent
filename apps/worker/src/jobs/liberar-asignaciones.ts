/**
 * **El barrido que suelta las asignaciones que dejaron de corresponder.**
 *
 * Es la red de `inbox/asignacion.ts`, y ahí está escrito el porqué de todo
 * esto: soltar la asignación era una escritura colgada de la carga del Inbox,
 * y el Inbox se recarga con cada mensaje de WhatsApp que entra.
 *
 * **Por qué un barrido y no solo el gancho del pedido.** El gancho cubre el
 * caso normal —se cerró la venta, la conversación pasó a operaciones— y lo
 * cubre al instante. Lo que no puede cubrir es lo que no pasa por él: un clic
 * de anuncio nuevo sobre una conversación que ya era de operaciones (la regla
 * del recomprador), un pedido que entra por la logística sin pasar por la
 * tienda, y el atraso acumulado del día que se encienda al vendedor. El barrido
 * no sabe de caminos: vuelve a preguntar por **todas** las asignaciones vivas,
 * así que ningún camino olvidado se queda sin cubrir.
 *
 * **Cuánto tarda.** El gancho es inmediato. Lo que solo ve el barrido tarda
 * como mucho {@link SWEEP_CRON}, hoy diez minutos. La consecuencia de ese
 * atraso está acotada y conviene decirla: la conversación sigue mostrándose
 * como tomada por quien ya no la trabaja, y por eso no aparece en «sin
 * responder». Antes eso se corregía en el mismo render que lo descubría; ahora
 * se corrige en el barrido siguiente. Diez minutos es corto contra el hecho que
 * lo dispara —una venta cerrada— y largo contra el costo de mirarlo: la
 * consulta pide `assigned_user_id is not null`, que en Guatemala son unidades.
 *
 * **Con el vendedor apagado no cuesta nada.** `liberarAsignacionesVencidas`
 * sale antes de consultar la tabla si la operación no tiene vendedor
 * configurado, que es el estado de producción hoy: el barrido corre, lee la
 * configuración cacheada de cada operación y se va.
 */

import { listActiveOperations } from "@wa/db";
import { liberarAsignacionesVencidas } from "../inbox/asignacion";
import { logger } from "../lib/logger";
import { LIBERAR_ASIGNACIONES_QUEUE, getBoss } from "./queue";

/**
 * Cada diez minutos. El hecho que lo dispara —una venta que cierra— llega por
 * el gancho al instante; esto es la red, y una red que barre más seguido no
 * agrega garantía, agrega consultas. Es el mismo criterio con el que el barrido
 * de conversiones eligió sus cinco minutos: el evento no es urgente, lo que
 * importa es que no se pierda.
 */
const SWEEP_CRON = "*/10 * * * *";

/** Lo que dejó una pasada del barrido, por operación. */
export interface BarridoDeAsignaciones {
  operation: string;
  miradas: number;
  sueltas: number;
}

/**
 * Suelta lo que haya que soltar en cada operación activa. El fallo de una no
 * puede impedir el barrido de las demás: son bandejas de países distintos.
 */
export async function runLiberarAsignaciones(): Promise<BarridoDeAsignaciones[]> {
  const salida: BarridoDeAsignaciones[] = [];
  for (const op of await listActiveOperations()) {
    try {
      const r = await liberarAsignacionesVencidas(op);
      salida.push({ operation: op.countryCode, ...r });
    } catch (err) {
      logger.error(
        { err: String(err), operation: op.countryCode },
        "bandeja: el barrido de asignaciones falló en esta operación",
      );
    }
  }
  return salida;
}

export async function startLiberarAsignacionesWorker(): Promise<void> {
  const boss = await getBoss();
  await boss.work(LIBERAR_ASIGNACIONES_QUEUE, async (raw) => {
    const list = (Array.isArray(raw) ? raw : [raw]) as Array<{ id?: string }>;
    for (const job of list) {
      try {
        const resultados = await runLiberarAsignaciones();
        const sueltas = resultados.reduce((a, r) => a + r.sueltas, 0);
        // Solo se anota cuando hubo algo que soltar: un barrido que no
        // encuentra nada es lo normal, y anotarlo cada diez minutos entierra
        // el día que sí encuentre.
        if (sueltas > 0) {
          logger.info({ resultados, jobId: job?.id }, "bandeja: barrido de asignaciones");
        }
      } catch (err) {
        // No se relanza: que falle una pasada no puede cortar la serie del
        // cron, y la siguiente vuelve a mirar exactamente lo mismo.
        logger.error(
          { err: String(err), jobId: job?.id },
          "bandeja: el barrido de asignaciones falló",
        );
      }
    }
  });
  logger.info("liberar-asignaciones worker started");
}

export async function scheduleLiberarAsignaciones(): Promise<void> {
  const boss = await getBoss();
  await boss.schedule(LIBERAR_ASIGNACIONES_QUEUE, SWEEP_CRON, {});
  logger.info({ cron: SWEEP_CRON }, "liberar-asignaciones sweep scheduled");
}
