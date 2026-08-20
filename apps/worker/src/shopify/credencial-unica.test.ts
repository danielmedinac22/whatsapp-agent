import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * La red sobre «¿está conectada la tienda?».
 *
 * ## El fallo que esta prueba existe para que no vuelva
 *
 * Hasta el 19-ago-2026 la respuesta era mirar `admin_access_token`: si la
 * columna tenía algo, había tienda. Con la credencial del Dev Dashboard esa
 * columna está **vacía a propósito** —lo que se guarda es client id y secret, y
 * el token se acuña— así que todo sitio que siguiera preguntando por la columna
 * empezó a contestar «no hay tienda» sobre una tienda perfectamente conectada.
 *
 * **El compilador no podía verlo.** La columna sigue existiendo y sigue siendo
 * `string | null`, así que `if (!conn.adminAccessToken)` compila igual de bien
 * que antes y significa otra cosa. Dos sitios se pasaron por alto en el cambio y
 * los encontró ejecutar contra producción, no leer: la pantalla de estado de la
 * tienda decía «no conectada» mientras el catálogo, al lado, leía productos; y
 * peor, **el bloque de producto del prompt del vendedor volvía `null`**, o sea
 * Sebastián conversando sin la ficha de lo que vende, sin error y sin alarma.
 *
 * ## Por qué es una prueba de fuente y no una de comportamiento
 *
 * Porque lo que hay que impedir no es un resultado sino un **hábito**: que el
 * próximo que necesite saber si hay tienda escriba la pregunta a mano en vez de
 * llamar a {@link storeCredential}. Un test de comportamiento cubriría los
 * sitios que ya existen; éste cubre el que alguien escriba el mes que viene.
 */

const AQUI = fileURLToPath(new URL(".", import.meta.url));
const RAIZ = fileURLToPath(new URL("..", import.meta.url));

/**
 * Los únicos archivos que pueden nombrar la columna.
 *
 * - `token.ts` es **donde vive la decisión**: es el que traduce columnas a
 *   credencial, así que tiene que poder leerla.
 * - `routes/shopify-connection.ts` la **escribe**: recibe del formulario un
 *   token fijo cuando la tienda es vieja y lo guarda.
 */
const PERMITIDOS = new Set([
  "shopify/token.ts",
  "shopify/token.test.ts",
  "routes/shopify-connection.ts",
  "shopify/credencial-unica.test.ts",
]);

function archivosDeFuente(dir: string, prefijo = ""): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const completo = `${dir}/${entrada}`;
    const relativo = prefijo ? `${prefijo}/${entrada}` : entrada;
    if (statSync(completo).isDirectory()) {
      salida.push(...archivosDeFuente(completo, relativo));
    } else if (entrada.endsWith(".ts") || entrada.endsWith(".tsx")) {
      salida.push(relativo);
    }
  }
  return salida;
}

describe("la red sobre la credencial de la tienda", () => {
  it("nadie fuera de token.ts decide si hay tienda mirando admin_access_token", () => {
    // Si esta prueba falla, el archivo que nombra está preguntando por la
    // columna vieja. No se arregla acá: se arregla llamando a
    // `storeCredential(conn)`, que sabe de las dos formas de credencial.
    const culpables = archivosDeFuente(RAIZ)
      .filter((f) => !PERMITIDOS.has(f))
      .filter((f) => readFileSync(`${RAIZ}/${f}`, "utf8").includes("adminAccessToken"));

    expect(culpables).toEqual([]);
  });

  it("los archivos permitidos existen: la lista no protege nombres muertos", () => {
    // Una lista de excepciones que menciona archivos borrados deja de ser una
    // excepción y pasa a ser un agujero con nombre viejo.
    const presentes = new Set(archivosDeFuente(RAIZ));
    for (const permitido of PERMITIDOS) {
      expect(presentes.has(permitido), `${permitido} ya no existe`).toBe(true);
    }
  });

  it("el escaneo mira de verdad el árbol del worker", () => {
    // Una red que no encuentra nada porque busca en el directorio equivocado
    // pasa siempre y no protege nada. Es el modo de fallar de este tipo de
    // prueba, y ya mordió en este proyecto.
    const todos = archivosDeFuente(RAIZ);
    expect(todos.length).toBeGreaterThan(50);
    expect(todos).toContain("agent/shopify-context.ts");
    expect(todos).toContain("shopify/closing-routes.ts");
    expect(AQUI).toContain("shopify");
  });
});
