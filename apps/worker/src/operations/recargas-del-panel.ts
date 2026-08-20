/**
 * La red que atrapa un `location.reload()` de vuelta en el panel.
 *
 * **Qué se está vigilando.** Recargar el documento entero no refresca datos:
 * rehace la pantalla y reinicia el cliente. En la bandeja eso costaba la
 * conversación abierta —que no vive en la URL, así que el panel aterrizaba en
 * el primer chat—, el filtro puesto y el mensaje a medio escribir. Medido el
 * 20-ago-2026: un render del Inbox son diez viajes a la base y dos segundos, y
 * había tres botones de uso diario que lo disparaban.
 *
 * La forma correcta ya existe en dos sitios del repo: reescribir en memoria la
 * fila que cambió tras el POST (`orders-table.tsx`, `inbox-client.tsx`). Cuando
 * hace falta que el servidor recalcule algo derivado, es `router.refresh()`,
 * que vuelve a pedir el render sin reiniciar el cliente ni perder el sitio.
 *
 * **Por qué hace falta una red.** Esto no lo ve el compilador: `location.reload()`
 * es una llamada perfectamente tipada. Solo se ve mirando el código, así que
 * esto lo mira. Es la hermana de {@link ./consultas-del-panel}, y vive acá por
 * lo mismo: los archivos que vigila son de `apps/web` y esta es la suite de
 * Node del repo, la que puede abrir archivos. `apps/web` ya tiene la suya desde
 * el 20-ago-2026, pero corre en jsdom sobre el documento —lo que el asesor
 * percibe—, no sobre el código como texto.
 *
 * **Todo lo de este archivo es PURO.** Recibe el código como texto y devuelve
 * hallazgos. Quien abre los archivos es su prueba.
 */

/** Un `location.reload()` encontrado, con la línea donde está. */
export type Recarga = {
  linea: number;
  texto: string;
};

/**
 * El código sin comentarios, conservando el número de líneas.
 *
 * Hace falta porque los comentarios de este repo **hablan de lo que sacaron**:
 * el archivo que arregló los tres reloads explica en prosa qué era un
 * `location.reload()` y por qué se fue. Una red que no distinga las dos cosas
 * castiga documentar el arreglo, que es exactamente al revés.
 *
 * No es un parser: es un barrido que sabe de `//`, de `/* … *\/` y de las tres
 * comillas, lo justo para no confundir una cadena con un comentario.
 */
export function sinComentarios(fuente: string): string {
  let fuera = "";
  let i = 0;
  let comilla: string | null = null;
  while (i < fuente.length) {
    const c = fuente[i]!;
    const par = fuente.slice(i, i + 2);
    if (comilla) {
      if (c === "\\") {
        fuera += "  ";
        i += 2;
        continue;
      }
      if (c === comilla) comilla = null;
      fuera += c;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      comilla = c;
      fuera += c;
      i += 1;
      continue;
    }
    if (par === "//") {
      while (i < fuente.length && fuente[i] !== "\n") {
        fuera += " ";
        i += 1;
      }
      continue;
    }
    if (par === "/*") {
      while (i < fuente.length && fuente.slice(i, i + 2) !== "*/") {
        // Los saltos se conservan para que el número de línea siga sirviendo.
        fuera += fuente[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      fuera += "  ";
      i += 2;
      continue;
    }
    fuera += c;
    i += 1;
  }
  return fuera;
}

/**
 * `location.reload()` con o sin `window.` delante, y con espacios en medio.
 * `document.location` cuenta igual: es la misma recarga por otro camino.
 */
const RECARGA = /\b(?:(?:window|self|globalThis|document)\s*\.\s*)?location\s*\.\s*reload\s*\(/;

/** Los `location.reload()` que hay en este archivo, si hay alguno. */
export function recargasDeDocumento(fuente: string): Recarga[] {
  return sinComentarios(fuente)
    .split("\n")
    .map((texto, i) => ({ linea: i + 1, texto: texto.trim() }))
    .filter((l) => RECARGA.test(l.texto));
}
