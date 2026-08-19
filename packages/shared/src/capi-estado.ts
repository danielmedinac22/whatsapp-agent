/**
 * El estado del reporte de conversiones a Meta, tal como viaja del worker al
 * panel — y cómo se dice cada motivo en lenguaje de operación.
 *
 * **Todo esto es puro.** No toca la base, ni la red, ni el reloj.
 *
 * ## Por qué el contrato vive acá y no en cada lado
 *
 * El worker contesta `GET /api/capi/estado` y el panel lo dibuja. Son las dos
 * mitades del mismo módulo, y es la misma razón por la que los accesores viven
 * en `@wa/db` y las reglas de los archivos enviables en este paquete: dos
 * copias de la forma se desincronizan en cuanto una se toque, y lo que sale de
 * ahí es una pantalla que dice «no hay conversiones sin llegar» porque está
 * leyendo un campo que el worker renombró. En un tablero cuyo modo de fallar
 * **es el silencio**, esa mentira no se nota.
 *
 * ## Los motivos se traducen acá, y no en la pantalla
 *
 * El barrido devuelve motivos con nombre de código (`not-a-sales-order`,
 * `operation-has-no-dataset`). Traducirlos en el JSX dejaría la traducción sin
 * poder probarse —la suite del repo es la del worker— y sin un lugar donde se
 * vea, todos juntos, que **esperar y saltar no son lo mismo**: uno es algo que
 * una persona puede destrabar y el otro es un pedido que nunca se va a
 * reportar. Colapsarlos es cómo un tablero se ve tranquilo mientras hace un mes
 * que falta un dato de configuración.
 *
 * ## Los motivos llegan como texto y no como unión cerrada
 *
 * `WaitReason` y `SkipReason` los define `apps/worker/src/capi/plan.ts`, que es
 * quien decide. Acá se reciben como claves de texto **a propósito**: un motivo
 * nuevo del worker no puede romper la pantalla ni desaparecer de ella — sale
 * con su clave cruda y se ve que hay algo que este panel todavía no sabe
 * nombrar, que es la forma honesta de que una deriva se note en vez de
 * esconderse.
 */

/** Las tres posiciones del interruptor. Arranca en `off`. */
export type CapiModo = "off" | "test" | "live";

/**
 * Una conversión que quedó sin resolver, con lo que hace falta para decidir qué
 * hacer con ella. Es `StuckConversion` del worker, con las fechas ya en texto
 * porque viajó por JSON.
 */
export interface CapiFilaTrabada {
  orderId: string;
  status: string;
  mode: string;
  /** El dataset de la cuenta de WhatsApp. **No es el píxel.** */
  datasetId: string;
  value: string;
  currency: string;
  /** El `event_time` que viajó, en ISO. Es por donde se la busca en Meta. */
  eventTime: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

/** Cómo está el reporte. El orden de la unión es el orden de gravedad. */
export interface CapiVeredicto {
  state: "blocked" | "failing" | "working" | "idle";
  headline: string;
  detail: string;
}

/** Cuántas conversiones hay en cada estado, en el período. */
export interface CapiConteos {
  sent: number;
  failed: number;
  unconfirmed: number;
  pending: number;
}

/** Qué vio el último barrido: cuántos pedidos en cada situación, por motivo. */
export interface CapiBarrido {
  report: number;
  wait: Record<string, number | undefined>;
  skip: Record<string, number | undefined>;
}

/** Lo que contesta `GET /api/capi/estado`. */
export interface CapiEstado {
  modo: CapiModo;
  /** Por qué está apagado, en una línea. `null` si no lo está. */
  motivoApagado: string | null;
  /** El destino: un **dataset** de la cuenta de WhatsApp, no el píxel. */
  datasetId: string | null;
  veredicto: CapiVeredicto;
  periodoDias: number;
  conteos: CapiConteos;
  /** `null` cuando no se pudo mirar. **No es lo mismo que todo en cero.** */
  barrido: CapiBarrido | null;
  pendientesSinResolver: {
    desdeHoras: number;
    nota: string;
    filas: CapiFilaTrabada[];
  };
  enDuda: {
    comoVerificar: string;
    filas: CapiFilaTrabada[];
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Los motivos, en lenguaje de operación
// ────────────────────────────────────────────────────────────────────────────

/** Un motivo del barrido, listo para ponerlo en pantalla. */
export interface MotivoDelBarrido {
  /** Qué les pasa a esos pedidos, en una frase. */
  texto: string;
  /**
   * Si hay algo que una persona puede hacer. Es la diferencia entre una lista
   * que pide trabajo y una que solo informa, y por eso está en el dato y no en
   * el color: un motivo accionable escondido entre seis que no lo son es un mes
   * de pauta sin atribuir.
   */
  accionable: boolean;
}

/**
 * Los pedidos que **todavía** no se reportaron y podrían reportarse.
 *
 * Todos menos el primero se destraban en el panel, y cuando se destraban las
 * ventas que esperaban se reportan solas — eso es lo que hay que decir, porque
 * si no la pantalla parece pedir que alguien reenvíe algo a mano.
 */
export function motivoDeEspera(clave: string): MotivoDelBarrido {
  switch (clave) {
    case "awaiting-customer-confirmation":
      return {
        texto:
          "esperando a que le salga la confirmación al cliente. El evento va después de eso, a propósito",
        accionable: false,
      };
    case "operation-has-no-dataset":
      return {
        texto:
          "esperando a que la operación tenga su dataset de conversiones. Se configura en el panel y las que esperan se reportan solas",
        accionable: true,
      };
    case "operation-has-no-whatsapp-account":
      return {
        texto:
          "esperando a que la operación tenga su conexión de WhatsApp. El dataset cuelga de esa cuenta",
        accionable: true,
      };
    case "operation-has-no-currency":
      return {
        texto:
          "esperando a que la operación diga su moneda. Sin moneda el valor de la venta no se puede reportar",
        accionable: true,
      };
    default:
      return { texto: `esperando por «${clave}»`, accionable: true };
  }
}

/**
 * Los pedidos que **nunca** se van a reportar. No hay nada que hacer con ellos
 * y no merecen alarma — pero se cuentan, porque es lo que distingue «no hubo
 * pedidos» de «hubo 206 y ninguno era una venta del vendedor», que es
 * exactamente lo que pasa hoy en Guatemala.
 */
export function motivoDeSalto(clave: string): MotivoDelBarrido {
  switch (clave) {
    case "not-a-sales-order":
      return {
        texto:
          "no los tomó el vendedor. El reporte solo cubre las ventas por conversación",
        accionable: false,
      };
    case "no-click-id":
      return {
        texto: "no vinieron de un anuncio: no hay conversión que atribuir",
        accionable: false,
      };
    case "too-old":
      return {
        texto: "Meta ya no los aceptaría por antigüedad (la ventana es de siete días)",
        accionable: false,
      };
    case "order-has-no-id":
      return {
        texto: "llegaron sin identificador de pedido. Es un defecto, no configuración",
        accionable: true,
      };
    case "order-has-no-value":
      return {
        texto: "llegaron sin importe. Es un defecto, no configuración",
        accionable: true,
      };
    case "order-has-no-close-time":
      return {
        texto: "llegaron sin fecha de cierre. Es un defecto, no configuración",
        accionable: true,
      };
    default:
      return { texto: `saltados por «${clave}»`, accionable: true };
  }
}

/** Una fila del barrido, ya contada y traducida. */
export interface LineaDelBarrido {
  clave: string;
  cantidad: number;
  texto: string;
  accionable: boolean;
}

/**
 * El barrido, ordenado como se lee: primero lo que alguien puede destrabar.
 *
 * Descarta los motivos en cero —un motivo sin pedidos no es información— y
 * ordena los accionables arriba. Con seis motivos posibles y uno solo que pide
 * trabajo, el orden **es** la diferencia entre verlo y no verlo.
 */
export function lineasDelBarrido(barrido: CapiBarrido): {
  esperando: LineaDelBarrido[];
  saltados: LineaDelBarrido[];
  totalEsperando: number;
  totalSaltados: number;
} {
  const armar = (
    grupo: Record<string, number | undefined>,
    traducir: (clave: string) => MotivoDelBarrido,
  ): LineaDelBarrido[] =>
    Object.entries(grupo)
      .filter(([, n]) => (n ?? 0) > 0)
      .map(([clave, n]) => ({ clave, cantidad: n ?? 0, ...traducir(clave) }))
      // Accionables primero; entre iguales, el más numeroso arriba.
      .sort((a, b) =>
        a.accionable === b.accionable
          ? b.cantidad - a.cantidad
          : a.accionable
            ? -1
            : 1,
      );

  const esperando = armar(barrido.wait, motivoDeEspera);
  const saltados = armar(barrido.skip, motivoDeSalto);
  const sumar = (l: LineaDelBarrido[]) =>
    l.reduce((total, x) => total + x.cantidad, 0);
  return {
    esperando,
    saltados,
    totalEsperando: sumar(esperando),
    totalSaltados: sumar(saltados),
  };
}

/**
 * Si el veredicto ya explica por qué está apagado.
 *
 * Existe porque la pantalla lo repetía: el veredicto arma su explicación
 * **poniendo el motivo dentro, con la primera letra en mayúscula**, así que
 * compararlos tal cual decía que no y el operador leía dos veces la misma
 * frase. Es puro y está probado por eso mismo — la comparación ingenua ya
 * falló una vez.
 *
 * Lo que se gana no es estética: cuando el veredicto habla de otra cosa —el
 * caso en que no se pudo mirar el barrido— el motivo del apagado **sigue
 * siendo un dato que no está dicho en ningún otro lado**, y tiene que salir.
 */
export function elMotivoYaEstaDicho(
  detalleDelVeredicto: string,
  motivoApagado: string,
): boolean {
  return detalleDelVeredicto
    .toLocaleLowerCase("es")
    .includes(motivoApagado.toLocaleLowerCase("es"));
}

/**
 * Un momento del libro, escrito para **buscarlo en el administrador de eventos
 * de Meta**: `2026-08-18 20:33 UTC`.
 *
 * En UTC y con la zona escrita, por dos razones que apuntan al mismo lado:
 *
 * 1. **Es el momento que viajó.** El evento lleva `event_time` en segundos
 *    desde epoch, o sea UTC. Mostrarlo traducido a una zona obliga a
 *    destraducirlo para cruzarlo contra Meta, que es donde se cometen los
 *    errores de una hora.
 * 2. **La pantalla se dibuja en el servidor y se hidrata en el navegador**, y
 *    los dos están en zonas distintas — el worker en UTC, el admin en
 *    Guatemala—. Un `toLocaleString()` sin zona fija da dos textos distintos
 *    para el mismo instante y React lo reporta como una discrepancia de
 *    hidratación. Fijar la zona lo vuelve determinista.
 */
export function momentoDeBusqueda(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dos = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}` +
    ` ${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())} UTC`
  );
}

/**
 * Cómo se enciende el reporte, dicho para quien lo va a encender.
 *
 * **No hay botón, y no es un olvido.** El modo se cambia por entorno y con un
 * despliegue (decisión de `ventas-capi/03`): un evento de conversión mal
 * formado o duplicado envenena el aprendizaje de la pauta que el cliente paga,
 * y eso no se revierte borrando datos. Un interruptor en el panel dejaría eso a
 * un clic de distancia. La pantalla lo dice en vez de ofrecerlo.
 */
export const CAPI_COMO_SE_ENCIENDE: readonly string[] = [
  "El token de usuario de sistema del Business Manager, con permiso whatsapp_business_manage_events. El token de usuario normal no sirve: choca con la certificación de no discriminación.",
  "El dataset de conversiones de la cuenta de WhatsApp de esta operación. Es un dataset, no el píxel: mandarlo al píxel llega a un destino real y equivocado, sin error y sin alarma.",
  "Poner META_CAPI_MODE en 'test' y comprobar en el administrador de eventos de Meta que el evento llega bien formado, antes de pasar a 'live'.",
];
