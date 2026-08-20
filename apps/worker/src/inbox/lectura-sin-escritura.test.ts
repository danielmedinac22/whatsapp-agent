import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CAMINO_DE_LECTURA,
  escriturasEnLaLectura,
  nombresQueYaNoExisten,
} from "./lectura-sin-escritura";

/**
 * La única línea de todo el archivo que toca el disco. Cruza el límite de
 * paquetes por el mismo motivo que la otra red del panel: el archivo que hay
 * que vigilar es de `apps/web` y los tests corren solo en `apps/worker`.
 */
const QUERIES = "../../../web/src/lib/queries.ts";

function fuente(relativa: string): string {
  return readFileSync(fileURLToPath(new URL(relativa, import.meta.url)), "utf8");
}

describe("mirar la bandeja no escribe", () => {
  it("ninguna función del camino de lectura del Inbox escribe una fila", () => {
    // Si esta prueba falla, dibujar el Inbox volvió a escribir en la base —y
    // el panel se refresca con cada evento SSE, o sea una vez por mensaje de
    // WhatsApp que entra—. No se arregla acá: se arregla sacando la escritura
    // del camino. Dónde ponerla está en `inbox/asignacion.ts`.
    expect(escriturasEnLaLectura(fuente(QUERIES))).toEqual([]);
  });

  it("y la red encuentra a todas las que dice vigilar", () => {
    // Una red que vigila un nombre que ya no existe pasa en verde sin mirar
    // nada, que es peor que no tenerla.
    expect(nombresQueYaNoExisten(fuente(QUERIES))).toEqual([]);
    expect(CAMINO_DE_LECTURA.length).toBeGreaterThanOrEqual(10);
  });

  it("la liberación de asignaciones ya no vive en el panel", () => {
    // El nombre exacto de lo que se sacó. No es lo mismo que la prueba de
    // arriba: aquélla mira escrituras, y ésta mira que no vuelva **esta**
    // escritura, ni siquiera envuelta en otra función que la red del camino
    // todavía no conozca.
    expect(fuente(QUERIES)).not.toContain("releaseStaleAssignments");
  });
});

describe("qué atrapa la red", () => {
  it("el `UPDATE` que la carga del Inbox disparaba", () => {
    // Textualmente lo que había antes de PRO-20, reducido a su forma.
    const source = `
async function idsDeLaBandejaDeVentas(op: Operation) {
  const candidatas = await db.select().from(conversations).where(ofOperation(op, conversations.operationId));
  await db.update(conversations).set({ assignedUserId: null }).where(inArray(conversations.id, soltar));
  return candidatas;
}`;
    expect(escriturasEnLaLectura(source)).toEqual([
      { funcion: "idsDeLaBandejaDeVentas", verbo: "update", tabla: "conversations" },
    ]);
  });

  it("una escritura escondida detrás de otra función del camino también", () => {
    const source = `
export async function countSalesInboxViews(op: Operation) {
  await db.insert(conversations).values({});
}`;
    expect(escriturasEnLaLectura(source)).toEqual([
      { funcion: "countSalesInboxViews", verbo: "insert", tabla: "conversations" },
    ]);
  });

  it("las escrituras que un botón dispara NO son de esta red", () => {
    // `setAssignment` escribe porque alguien apretó «TRABAJARLA YO». La
    // diferencia con lo de arriba no es la escritura: es quién la dispara.
    const source = `
export async function setAssignment(op: Operation, id: string) {
  await db.update(conversations).set({ assignedUserId: userId }).where(rowOfOperation(op, conversations.id, id, conversations.operationId));
}`;
    expect(escriturasEnLaLectura(source)).toEqual([]);
  });

  it("prometer en un comentario que no se escribe no cuenta", () => {
    const source = `
export async function listConversations(op: Operation) {
  // ya no hacemos db.update(conversations) acá
  await db.update(conversations).set({ unreadCount: 0 });
}`;
    expect(escriturasEnLaLectura(source)).toHaveLength(1);
  });

  it("un nombre del camino que ya no existe se reporta", () => {
    const source = `
export async function listConversations(op: Operation) {
  return db.select().from(conversations);
}`;
    expect(nombresQueYaNoExisten(source, ["listConversations", "loQueSeFue"])).toEqual([
      "loQueSeFue",
    ]);
  });
});
