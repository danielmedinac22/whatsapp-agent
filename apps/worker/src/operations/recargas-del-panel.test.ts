import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { recargasDeDocumento, sinComentarios } from "./recargas-del-panel";

/**
 * Las únicas líneas de todo el archivo que tocan el disco. Lo demás son
 * fixtures.
 *
 * Cruzan el límite de paquetes igual que las de `consultas-del-panel.test.ts`,
 * y por lo mismo: lo que se vigila es de `apps/web` y esta es la suite que
 * puede abrir archivos. Los dos paquetes viajan siempre en el mismo repositorio.
 *
 * Se barre `apps/web/src` **entero** y no una lista de archivos: un
 * `location.reload()` nuevo va a nacer en la pantalla que a nadie se le ocurrió
 * poner en la lista.
 */
const PANEL = fileURLToPath(new URL("../../../web/src", import.meta.url));

function fuentesDelPanel(dir = PANEL): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      salida.push(...fuentesDelPanel(ruta));
      continue;
    }
    // Las pruebas del panel sí pueden nombrar la recarga: es de lo que hablan.
    if (/\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name)) {
      salida.push(ruta);
    }
  }
  return salida;
}

describe("la red sobre las recargas del panel", () => {
  it("hoy ninguna pantalla del panel recarga el documento", () => {
    // Si esta prueba falla, la pantalla que nombra le está quitando al asesor
    // la conversación abierta, el filtro puesto y el mensaje a medio escribir.
    // No se arregla acá: se arregla reescribiendo la fila que cambió, como en
    // `orders-table.tsx` y `inbox-client.tsx`. Si hace falta que el servidor
    // recalcule algo, es `router.refresh()`.
    const hallazgos = fuentesDelPanel().flatMap((ruta) =>
      recargasDeDocumento(readFileSync(ruta, "utf8")).map(
        (r) => `${ruta.slice(PANEL.length + 1)}:${r.linea} · ${r.texto}`,
      ),
    );
    expect(hallazgos).toEqual([]);
  });

  it("mira todo el panel y no un puñado de archivos", () => {
    const rutas = fuentesDelPanel().map((r) => r.slice(PANEL.length + 1));
    // El falso negativo que acecha a esta red es barrer el directorio
    // equivocado y no encontrar nada porque no hay nada que mirar.
    expect(rutas.length).toBeGreaterThan(20);
    expect(rutas).toContain(join("app", "(app)", "inbox", "inbox-client.tsx"));
    expect(rutas).toContain(join("app", "(app)", "orders", "orders-table.tsx"));
  });
});

describe("qué cuenta como recarga", () => {
  it("ve la llamada suelta y la que va con `window`", () => {
    expect(recargasDeDocumento("location.reload();")).toHaveLength(1);
    expect(recargasDeDocumento("window.location.reload();")).toHaveLength(1);
    expect(recargasDeDocumento("document.location.reload()")).toHaveLength(1);
  });

  it("no se le escapa por espacios de más", () => {
    expect(recargasDeDocumento("window . location . reload ( )")).toHaveLength(1);
  });

  it("dice en qué línea está, para poder ir", () => {
    const fuente = ["const a = 1;", "", "  location.reload();"].join("\n");
    expect(recargasDeDocumento(fuente)).toEqual([
      { linea: 3, texto: "location.reload();" },
    ]);
  });

  it("no confunde `router.refresh()`, que es el camino bueno", () => {
    expect(recargasDeDocumento("router.refresh();")).toEqual([]);
  });

  it("no confunde otras cosas que se llaman reload", () => {
    expect(recargasDeDocumento("reload();")).toEqual([]);
    expect(recargasDeDocumento("await reload();")).toEqual([]);
    expect(recargasDeDocumento("setTimeout(reload, 400);")).toEqual([]);
  });
});

describe("los comentarios no son código", () => {
  /**
   * Esto no es un detalle de implementación: es la diferencia entre una red que
   * se puede vivir con ella y una que castiga documentar el arreglo. El archivo
   * que sacó los tres reloads de la bandeja explica en prosa qué eran.
   */
  it("no marca un `location.reload()` nombrado en un comentario", () => {
    expect(recargasDeDocumento("// antes esto hacía location.reload();")).toEqual(
      [],
    );
    expect(
      recargasDeDocumento("/* reemplaza a los tres location.reload() */"),
    ).toEqual([]);
    expect(
      recargasDeDocumento(
        ["/**", " * tres `location.reload()` que tenían los botones.", " */"].join(
          "\n",
        ),
      ),
    ).toEqual([]);
  });

  it("sí lo marca cuando está debajo del comentario que habla de él", () => {
    const fuente = [
      "// esto ya no hace location.reload()",
      "location.reload();",
    ].join("\n");
    expect(recargasDeDocumento(fuente)).toEqual([
      { linea: 2, texto: "location.reload();" },
    ]);
  });

  it("no toma por comentario una barra dentro de una cadena", () => {
    const fuente = 'const u = "https://x/y"; location.reload();';
    expect(recargasDeDocumento(fuente)).toHaveLength(1);
  });

  it("conserva el número de línea al borrar un comentario de varias líneas", () => {
    const fuente = ["/* uno", "dos", "tres */", "location.reload();"].join("\n");
    expect(recargasDeDocumento(fuente)).toEqual([
      { linea: 4, texto: "location.reload();" },
    ]);
  });

  it("deja el código intacto cuando no hay comentarios", () => {
    expect(sinComentarios("const a = 1;")).toBe("const a = 1;");
  });
});
