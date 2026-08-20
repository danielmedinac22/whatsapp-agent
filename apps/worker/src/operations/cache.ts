/**
 * La caché por operación **ya no vive aquí**: PRO-15 la subió a `@wa/db`.
 *
 * El motivo es el mismo por el que subieron los accesores de `operations`: el
 * panel necesitaba la misma caché —las plantillas aprobadas y la URL de los
 * archivos de logística se leen en cada render— y `apps/web` no puede importar
 * del worker. Copiar la clase habría dejado dos implementaciones de la misma
 * idea, con dos TTL que se desincronizan la primera vez que alguien toque uno.
 *
 * Se re-exporta desde aquí para que los llamadores del worker sigan pidiéndola
 * donde siempre, igual que se hizo con `listOperations`.
 */
export { OPERATION_CACHE_MS, OperationScopedCache } from "@wa/db";
