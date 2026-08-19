/**
 * El interruptor de escritura sobre la tienda: **seco por defecto**.
 *
 * Todo lo de este archivo es PURO salvo el último accesor, que lee el entorno.
 *
 * ## Por qué existe, y por qué va en este ticket
 *
 * Este repo no tenía interruptores de encendido salvo `agent_settings
 * .dropi_dry_run`, y ese cubre solo las confirmaciones a logística. Éste es el
 * primer camino que **escribe en un sistema externo real y ajeno**: la tienda
 * del cliente. Un booleano es barato; un pedido falso en la tienda de un
 * cliente, no.
 *
 * Va apagado por defecto, como `dropi_dry_run` arrancó en `true`, y por el
 * mismo motivo: la escritura se enciende cuando alguien decide encenderla, no
 * cuando alguien despliega.
 *
 * ## Por qué es una variable de entorno y no una columna
 *
 * El precedente natural sería una columna en `agent_settings` con su
 * interruptor en el panel, igual que `dropi_dry_run`. **Esta ola no puede tocar
 * el esquema**: las migraciones tienen otro dueño y dos ramas que generen en
 * paralelo chocan siempre. La variable de entorno da el mismo comportamiento
 * observable —apagado por defecto, ni una escritura mientras esté apagado— sin
 * migración, y mover el valor a una columna después es cambiar
 * {@link storeWriteMode} y nada más: todo lo que decide se decide en
 * {@link resolveStoreWriteMode}, que ya recibe el valor en vez de buscarlo.
 *
 * Tiene además una propiedad que la columna no tiene, y en este caso juega a
 * favor: **no se puede encender desde el panel**. Encender la escritura sobre
 * la tienda de un cliente pide un despliegue, no un clic.
 *
 * ## La regla del valor: solo `live` enciende
 *
 * Cualquier otra cosa —vacío, ausente, `true`, `1`, `on`, un error de tipeo—
 * deja el modo seco. Es deliberado y es al revés de lo que suele hacerse:
 * un valor que no entendemos no puede habilitar escrituras sobre una tienda
 * viva. La dirección segura del error es no escribir.
 */

/** El nombre de la variable, en un solo lugar. */
export const STORE_WRITE_MODE_ENV = "SHOPIFY_ORDER_WRITE_MODE";

/** El único valor que enciende la escritura. */
export const STORE_WRITE_MODE_LIVE = "live";

/**
 * Los dos modos.
 *
 * - `dry_run` — se construye el pedido, se comprueba en lectura si ya existe, y
 *   **no se emite ninguna escritura**. Queda registrado qué habría salido.
 * - `live` — se crea el pedido de verdad en la tienda.
 */
export type StoreWriteMode = "dry_run" | "live";

/**
 * De un valor crudo al modo. Puro, para que el borde se pruebe sin entorno.
 *
 * Case-insensitive y con espacios recortados porque una variable de entorno
 * pasa por manos humanas y por la consola de Railway; nada más se interpreta.
 */
export function resolveStoreWriteMode(
  raw: string | null | undefined,
): StoreWriteMode {
  return raw?.trim().toLowerCase() === STORE_WRITE_MODE_LIVE
    ? "live"
    : "dry_run";
}

/** El modo vigente del proceso. La única línea que mira el entorno. */
export function storeWriteMode(): StoreWriteMode {
  return resolveStoreWriteMode(process.env[STORE_WRITE_MODE_ENV]);
}
