/**
 * **Qué quedó represado por la caída del agente, y por dónde se puede contestar.**
 *
 * Solo lee. No encola nada, no escribe una fila.
 *
 * Las reglas no son nuevas, son las del repo:
 *
 * - **Contestar** es un saliente `agent` o `manual`, y nada más
 *   (`esSalienteConversacional`, en `@wa/db`). Una notificación de Dropi o un
 *   `confirmation_ack` no son una respuesta, y contarlos como tal es lo que
 *   hacía que el panel dijera que 30 conversaciones ya estaban atendidas cuando
 *   no lo estaban.
 * - **La pelota es nuestra** si el cliente escribió después de la última vez que
 *   alguien le contestó, o si nunca le contestamos (`pelotaNuestra`).
 * - **La ventana** son 24 horas desde el último entrante del cliente
 *   (`serviceWindowFrom`, en `kapso/service-window.ts`). Abierta se puede
 *   mandar texto libre; cerrada solo sale una plantilla aprobada.
 *
 * Lo que este inventario **no** usa es `sinResponder`, y hay que decir por qué:
 * esa regla exige `agent_mode = false`, porque una conversación que lleva el
 * agente no espera a una persona. Los represados de esta caída son justamente
 * los que el agente llevaba y no pudo contestar, así que el contador de
 * «sin responder» del panel **no los ve**. Por eso hicieron falta 25 horas para
 * que alguien lo notara desde afuera.
 */
import {
  conversations,
  contacts,
  getDb,
  esSalienteConversacional,
  type OutboundSource,
} from "@wa/db";
import { sql } from "drizzle-orm";
import { serviceWindowFrom } from "../apps/worker/src/kapso/service-window";

// Desde fuera de Railway el dominio privado no resuelve: se entra por el proxy
// público, que es el mismo host `rlwy.net` con el que miden los demás scripts.
if (process.env.DATABASE_PUBLIC_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}

/** El instante del corte, en la zona en la que opera Vorare. */
const CORTE = "2026-08-21 16:03:00-06";

interface Fila {
  conversation_id: string;
  wa_id: string | null;
  nombre: string | null;
  agent_mode: boolean;
  assigned_user_id: string | null;
  last_inbound_at: Date;
  ultimo_texto: string | null;
  entrantes: number;
  ultima_respuesta_at: Date | null;
  ultima_respuesta_espejo_at: Date | null;
  ultima_respuesta_por_telefono_at: Date | null;
  ultimo_saliente_source: OutboundSource | null;
  ultimo_saliente_at: Date | null;
  algo_salio_despues_at: Date | null;
}

async function main() {
  const db = getDb();
  const ahora = new Date();

  // Una fila por conversación con entrante desde el corte. La última respuesta
  // se calcula con los mismos dos `source` que `esSalienteConversacional`
  // reconoce; el `switch` de arriba queda como la fuente de verdad y esto lo
  // cita, no lo redefine.
  // `db.execute` devuelve el arreglo de filas con este driver; en otros llega
  // envuelto en `.rows`. Se aceptan las dos formas para que el script no
  // dependa de cuál esté instalada.
  const crudo = (await db.execute(sql`
    with entrantes as (
      select m.conversation_id,
             count(*)::int as entrantes,
             max(m.created_at) as last_inbound_at
      from messages m
      where m.direction = 'in' and m.created_at >= ${CORTE}::timestamptz
      group by 1
    )
    select e.conversation_id,
           ct.wa_id,
           ct.name as nombre,
           ct.agent_mode,
           c.assigned_user_id,
           e.last_inbound_at,
           e.entrantes,
           (select left(m2.body, 120) from messages m2
             where m2.conversation_id = e.conversation_id and m2.direction = 'in'
             order by m2.created_at desc limit 1) as ultimo_texto,
           (select max(o.created_at) from outbound_messages o
             where o.conversation_id = e.conversation_id
               and o.source in ('agent', 'manual')
               and o.wa_id is not null) as ultima_respuesta_at,
           -- La misma pregunta por la otra puerta. La columna conversation_id de
           -- outbound_messages llega nula en la mayoría de los manual (316 de 352
           -- medidos), así que cruzar solo por ahí puede dar por no contestada una
           -- conversación que sí lo fue. El espejo en messages siempre tiene
           -- conversación resuelta.
           (select max(m3.created_at) from messages m3
             where m3.conversation_id = e.conversation_id
               and m3.direction = 'out'
               and (m3.from_agent = true or m3.sent_by_user_id is not null)
            ) as ultima_respuesta_espejo_at,
           (select max(o4.created_at) from outbound_messages o4
             where o4.to_wa_id = ct.wa_id
               and o4.source in ('agent', 'manual')
               and o4.wa_id is not null) as ultima_respuesta_por_telefono_at,
           (select o2.source from outbound_messages o2
             where o2.conversation_id = e.conversation_id and o2.wa_id is not null
             order by o2.created_at desc limit 1) as ultimo_saliente_source,
           (select max(o3.created_at) from outbound_messages o3
             where o3.conversation_id = e.conversation_id and o3.wa_id is not null
            ) as ultimo_saliente_at,
           -- Salió CUALQUIER cosa después del último entrante, del source que sea.
           -- No es una respuesta, pero tampoco es silencio: el cliente que pulsa el
           -- botón de la plantilla recibe su confirmation_ack en un segundo y medio,
           -- y ese lazo ya se cerró. Sin esta columna esas conversaciones entran al
           -- represado y alguien las contesta dos veces.
           (select max(m4.created_at) from messages m4
             where m4.conversation_id = e.conversation_id
               and m4.direction = 'out'
               and m4.created_at > e.last_inbound_at) as algo_salio_despues_at
    from entrantes e
    join conversations c on c.id = e.conversation_id
    left join contacts ct on ct.id = c.contact_id
    order by e.last_inbound_at desc
  `)) as unknown as Fila[] | { rows: Fila[] };
  const rows: Fila[] = Array.isArray(crudo) ? crudo : crudo.rows;

  /** La respuesta más reciente, mire por donde se mire. El máximo de las tres. */
  const respuestaDe = (r: Fila): Date | null =>
    [
      r.ultima_respuesta_at,
      r.ultima_respuesta_espejo_at,
      r.ultima_respuesta_por_telefono_at,
    ]
      .filter((d): d is Date => d !== null)
      .map((d) => new Date(d))
      .reduce<Date | null>((max, d) => (max === null || d > max ? d : max), null);

  const pendientes = rows.filter((r) => {
    const resp = respuestaDe(r);
    return resp === null || new Date(r.last_inbound_at).getTime() > resp.getTime();
  });

  // Cuánto cambia el número según por dónde se pregunte. Si las tres puertas
  // dan lo mismo, el inventario no depende de cuál se eligió.
  const soloPorConversacion = rows.filter((r) => {
    const resp = r.ultima_respuesta_at ? new Date(r.ultima_respuesta_at) : null;
    return resp === null || new Date(r.last_inbound_at).getTime() > resp.getTime();
  });
  console.log(
    `cruce por conversation_id: ${soloPorConversacion.length} pendientes; ` +
      `sumando el espejo y el teléfono: ${pendientes.length}`,
  );

  // Silencio de verdad: no salió nada después de que el cliente escribió.
  const enSilencio = pendientes.filter((r) => r.algo_salio_despues_at === null);
  const conAlgoDespues = pendientes.filter((r) => r.algo_salio_despues_at !== null);

  const abiertas = enSilencio.filter(
    (r) => serviceWindowFrom(new Date(r.last_inbound_at), ahora) === "open",
  );
  const cerradas = enSilencio.filter(
    (r) => serviceWindowFrom(new Date(r.last_inbound_at), ahora) !== "open",
  );

  console.log(`conversaciones con entrante desde el corte: ${rows.length}`);
  console.log(`  ya contestadas (agent o manual después del entrante): ${rows.length - pendientes.length}`);
  console.log(`  represadas, la pelota es nuestra: ${pendientes.length}`);
  console.log(`    de esas, algo salió después (ack, notificación): ${conAlgoDespues.length}`);
  console.log(`    en SILENCIO, no salió nada: ${enSilencio.length}`);
  console.log(`      con ventana ABIERTA (sale texto libre): ${abiertas.length}`);
  console.log(`      con ventana CERRADA (solo plantilla):   ${cerradas.length}`);

  const pinta = (r: Fila) => ({
    wa_id: r.wa_id,
    nombre: r.nombre,
    agente_lo_lleva: r.agent_mode,
    asignada: r.assigned_user_id !== null,
    horas_desde_el_entrante: Number(
      ((ahora.getTime() - new Date(r.last_inbound_at).getTime()) / 3_600_000).toFixed(1),
    ),
    entrantes: r.entrantes,
    ultimo_texto: r.ultimo_texto,
    ultimo_saliente: r.ultimo_saliente_source,
  });

  console.log("\n=== ventana ABIERTA ===");
  console.log(JSON.stringify(abiertas.map(pinta), null, 1));
  console.log("\n=== ventana CERRADA ===");
  console.log(JSON.stringify(cerradas.map(pinta), null, 1));

  // El `switch` de @wa/db es la fuente de verdad de qué cuenta como respuesta;
  // esto lo deja citado en la salida para que el criterio viaje con el número.
  console.log(
    `\ncuenta como respuesta: agent=${esSalienteConversacional("agent")}, ` +
      `manual=${esSalienteConversacional("manual")}, ` +
      `confirmation_ack=${esSalienteConversacional("confirmation_ack")}, ` +
      `dropi_status=${esSalienteConversacional("dropi_status")}`,
  );
  void conversations;
  void contacts;
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
