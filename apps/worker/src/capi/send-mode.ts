/**
 * El interruptor del reporte a Meta: **apagado por defecto**.
 *
 * Todo lo de este archivo es PURO salvo el último accesor, que lee el entorno.
 *
 * ## Por qué el interruptor es parte de este ticket
 *
 * Este repo tiene dos precedentes y ninguno cubre esto: `agent_settings
 * .dropi_dry_run`, que solo alcanza a las confirmaciones a logística, y
 * `shopify/write-mode.ts`, que la ola pasada escribió para la escritura sobre
 * la tienda del cliente. Éste es el tercer camino que sale del sistema hacia
 * afuera, y es el único cuyo daño **no se puede deshacer**: un pedido falso en
 * la tienda se cancela, un mensaje mal mandado se explica, pero un evento de
 * conversión mal formado o duplicado ya entró al aprendizaje del algoritmo que
 * decide a quién le muestra Meta la pauta que Vorare paga. Es el riesgo R7 de
 * la no-regresión, y su frase clave es «no se revierte borrando datos».
 *
 * Un booleano es barato. Ese aprendizaje, no.
 *
 * ## Las tres posiciones, y por qué son tres y no dos
 *
 * - **`off`** — no sale **ni una** llamada a Meta. Es el valor por defecto y el
 *   estado de hoy.
 * - **`test`** — se postea de verdad, pero con el `test_event_code` del
 *   administrador de eventos: Meta lo recibe, lo muestra en la pestaña de
 *   pruebas y **no lo usa para optimizar**. Es el ensayo que el ticket
 *   `ventas-capi/04` tiene que hacer antes de encender el real.
 * - **`live`** — la conversión cuenta.
 *
 * `test` no es un lujo: sin esa posición, la única forma de comprobar que el
 * evento llega bien formado sería mandando uno real, que es exactamente lo que
 * R7 prohíbe hacer a ciegas.
 *
 * ## Las tres reglas del valor, todas en la dirección segura
 *
 * 1. **Solo `test` y `live` encienden.** Cualquier otra cosa —vacío, ausente,
 *    `true`, `1`, `on`, un error de tipeo— deja el interruptor apagado. Es al
 *    revés de lo que suele hacerse y es deliberado: un valor que no entendemos
 *    no puede habilitar escrituras sobre el aprendizaje de una pauta.
 * 2. **Sin credencial no hay envío, diga lo que diga el interruptor.** Hoy no
 *    hay ninguna variable de Meta en el entorno y el permiso
 *    `whatsapp_business_manage_events` todavía no existe. Que la ausencia del
 *    token apague el camino por sí sola es lo que hace verdadera la frase «sin
 *    credencial esto no se ejecuta» sin depender de que alguien se acuerde.
 * 3. **`test` sin código de prueba se apaga.** Postear en «modo prueba» sin el
 *    código no es una prueba: es un evento real. Un modo que miente sobre lo
 *    que hace es peor que un modo que no arranca.
 *
 * ## Dónde vive la credencial, y por qué ahí
 *
 * **En el entorno, no en la base.** El precedente natural habría sido una
 * columna —`operations` ya tiene `capi_dataset_id`, o sea que el modelo ya
 * asume que esto es por operación—, y aun así el token va aparte, por tres
 * razones que apuntan al mismo lado:
 *
 * 1. **El dataset es por operación; el token no.** El dataset lo crea cada
 *    cuenta de WhatsApp y hay uno por país. El token de usuario de sistema es
 *    del Business Manager que las contiene: es **una** credencial para las dos
 *    operaciones. Guardarla por operación sería guardar el mismo secreto dos
 *    veces y esperar que nadie los desincronice.
 * 2. **No se puede encender desde el panel.** Igual que
 *    `SHOPIFY_ORDER_WRITE_MODE`: encender el reporte real pide un despliegue,
 *    no un clic. Con una columna, la pantalla que configura el dataset habría
 *    quedado a un botón de distancia de empezar a reportar de verdad.
 * 3. **Es un secreto con permisos sobre la cuenta publicitaria**, y el entorno
 *    de Railway lo guarda cifrado y fuera de la base que el panel lee.
 *
 * Cuando exista la segunda operación con su propio Business Manager, mover el
 * token a una columna es cambiar {@link capiDispatch} y nada más: todo lo que
 * decide se decide en {@link resolveCapiDispatch}, que ya recibe los valores en
 * vez de buscarlos.
 *
 * ## El token tiene que ser el de usuario de sistema
 *
 * Lo advirtió quien administra la cuenta y está en el ticket: el token **de
 * usuario** no sirve para esto porque choca con la certificación de no
 * discriminación. El de usuario de sistema sirve para CAPI y para lectura, y no
 * tiene persona detrás — que es lo correcto para un proceso automático. No hay
 * forma de comprobarlo desde el código: los dos son cadenas opacas. Por eso el
 * nombre de la variable lo dice.
 */

/** El interruptor. Sin él, `off`. */
export const CAPI_MODE_ENV = "META_CAPI_MODE";

/**
 * El token de **usuario de sistema** del Business Manager, con
 * `whatsapp_business_manage_events`. El nombre lleva `SYSTEM_USER` porque el de
 * usuario normal no sirve y los dos se ven igual.
 */
export const CAPI_TOKEN_ENV = "META_CAPI_SYSTEM_USER_TOKEN";

/** El código de la pestaña de pruebas del administrador de eventos. */
export const CAPI_TEST_CODE_ENV = "META_CAPI_TEST_EVENT_CODE";

/** La versión de la Graph API. Ver {@link DEFAULT_GRAPH_VERSION}. */
export const CAPI_GRAPH_VERSION_ENV = "META_GRAPH_API_VERSION";

/**
 * La versión vigente al 17-ago-2026 (anunciada el 29-jul-2026).
 *
 * Se fija explícita y no se hereda la que Meta tenga por defecto: la forma de
 * este flujo cambia entre versiones, y heredar significa que un día Meta cambia
 * su default y el evento empieza a viajar distinto sin que nadie toque nada.
 * Los ejemplos de la documentación de business messaging están congelados en
 * `v16.0`; eso es la página, no la API.
 */
export const DEFAULT_GRAPH_VERSION = "v26.0";

/** Las dos posiciones que encienden. */
export type CapiSendMode = "test" | "live";

/** Por qué el reporte está apagado. Cada motivo se arregla distinto. */
export type CapiOffReason =
  /** Nadie puso la variable. El estado de hoy y el valor por defecto. */
  | "switch-off"
  /** La variable tiene algo que no es `test` ni `live`. Probablemente un typo. */
  | "unknown-value"
  /** Falta el token de usuario de sistema. Es lo que bloquea el ticket. */
  | "no-token"
  /** Modo de prueba sin código de prueba: sería un envío real disfrazado. */
  | "no-test-code";

/**
 * Lo que el despachador necesita saber para mandar — o para no mandar.
 *
 * Es una unión y no un objeto con campos opcionales a propósito: con `mode:
 * "live"` el token **existe** por tipo, así que no hay forma de escribir un
 * envío que se olvide de comprobarlo, y `test` no compila sin su código.
 */
export type CapiDispatchSetting =
  | { mode: "off"; reason: CapiOffReason }
  | {
      mode: "test";
      token: string;
      /** Va en el cuerpo como `test_event_code`. */
      testEventCode: string;
      graphVersion: string;
    }
  | { mode: "live"; token: string; graphVersion: string };

/** Lo que el entorno puede decir. Explícito para que el borde se pruebe sin él. */
export interface CapiEnv {
  mode: string | null | undefined;
  token: string | null | undefined;
  testEventCode: string | null | undefined;
  graphVersion: string | null | undefined;
}

/**
 * De lo que dice el entorno a lo que se hace. Puro.
 *
 * El orden de las comprobaciones es el orden en que alguien puede actuar:
 * primero si le pidieron algo (el interruptor), después si puede hacerlo (el
 * token), y al final si el modo pedido está completo (el código de prueba). Un
 * interruptor apagado devuelve `switch-off` aunque además falte el token: no
 * tiene sentido reportar como problema una credencial que nadie pidió usar.
 */
export function resolveCapiDispatch(env: CapiEnv): CapiDispatchSetting {
  const raw = env.mode?.trim().toLowerCase();
  if (!raw) return { mode: "off", reason: "switch-off" };
  if (raw !== "test" && raw !== "live") {
    return { mode: "off", reason: "unknown-value" };
  }

  const token = env.token?.trim();
  if (!token) return { mode: "off", reason: "no-token" };

  const graphVersion = env.graphVersion?.trim() || DEFAULT_GRAPH_VERSION;

  if (raw === "test") {
    const testEventCode = env.testEventCode?.trim();
    if (!testEventCode) return { mode: "off", reason: "no-test-code" };
    return { mode: "test", token, testEventCode, graphVersion };
  }

  return { mode: "live", token, graphVersion };
}

/** El ajuste vigente del proceso. Las únicas líneas que miran el entorno. */
export function capiDispatch(): CapiDispatchSetting {
  return resolveCapiDispatch({
    mode: process.env[CAPI_MODE_ENV],
    token: process.env[CAPI_TOKEN_ENV],
    testEventCode: process.env[CAPI_TEST_CODE_ENV],
    graphVersion: process.env[CAPI_GRAPH_VERSION_ENV],
  });
}

/**
 * Por qué está apagado, en una línea que un operador entienda. Es lo que sale
 * en el estado del reporte y en el log del barrido.
 */
export function offReasonText(reason: CapiOffReason): string {
  switch (reason) {
    case "switch-off":
      return `el reporte a Meta está apagado (${CAPI_MODE_ENV} sin poner)`;
    case "unknown-value":
      return `${CAPI_MODE_ENV} tiene un valor que no es 'test' ni 'live': el reporte queda apagado`;
    case "no-token":
      return `falta el token de usuario de sistema (${CAPI_TOKEN_ENV}) con permiso whatsapp_business_manage_events`;
    case "no-test-code":
      return `el modo de prueba necesita ${CAPI_TEST_CODE_ENV}: sin él el evento sería real`;
  }
}
