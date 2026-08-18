import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TABLAS_CON_DUENO,
  analizarConsultasDelPanel,
  consultasSinAlcance,
} from "./consultas-del-panel";

/**
 * Las únicas líneas de todo el archivo que tocan el disco. Lo demás son
 * fixtures.
 *
 * Cruzan el límite de paquetes a propósito: los archivos que hay que vigilar son
 * de `apps/web` y los tests corren solo en `apps/worker`. Los dos viajan siempre
 * en el mismo repositorio.
 *
 * Son dos y no uno porque las consultas del panel no están todas en
 * `queries.ts`: la pantalla de Plantillas escribe con sus propias acciones de
 * servidor, y esas también reciben un id de un formulario.
 */
const VIGILADOS = [
  "../../../web/src/lib/queries.ts",
  "../../../web/src/app/(app)/templates/page.tsx",
] as const;

function fuente(relativa: string): string {
  return readFileSync(fileURLToPath(new URL(relativa, import.meta.url)), "utf8");
}

describe("la red sobre las consultas del panel", () => {
  for (const archivo of VIGILADOS) {
    it(`hoy ninguna consulta de ${archivo.split("/").pop()} devuelve filas sin acotar por operación`, () => {
      // Si esta prueba falla, la consulta que nombra lee o escribe filas de
      // todas las operaciones. No se arregla acá: se arregla en el archivo.
      expect(consultasSinAlcance(fuente(archivo))).toEqual([]);
    });
  }

  it("vigila las doce consultas del panel y no solo unas cuantas", () => {
    const funciones = new Set(
      analizarConsultasDelPanel(fuente(VIGILADOS[0])).map((c) => c.funcion),
    );
    for (const nombre of [
      "listConversations",
      "listApprovedWaTemplates",
      "getConversationById",
      "listMessages",
      "markRead",
      "listTemplates",
      "listRecentConversationOptions",
      "setAgentMode",
      "setConfirmationStatus",
      "listShopifyOrders",
      "listShopifyOrdersWithDropi",
      "listCarriers",
    ]) {
      expect(funciones).toContain(nombre);
    }
  });

  it("ve las cuatro consultas de listConversations, no una sola", () => {
    // El falso negativo que tuvo la primera versión de esta red: con una sola
    // consulta vigilada por función, quitarle el filtro a la lista del Inbox
    // pasaba desapercibido porque las otras tres seguían acotando.
    const enElInbox = analizarConsultasDelPanel(fuente(VIGILADOS[0])).filter(
      (c) => c.funcion === "listConversations",
    );
    expect(enElInbox.length).toBeGreaterThanOrEqual(4);
  });

  it("las tablas con dueño salen del esquema, no de una lista a mano", () => {
    // El día que alguien agregue una tabla con `operation_id`, entra sola.
    for (const tabla of [
      "conversations",
      "shopifyOrders",
      "waTemplates",
      "templates",
      "dropiOrders",
    ]) {
      expect(TABLAS_CON_DUENO).toContain(tabla);
    }
  });
});

describe("qué atrapa la red", () => {
  it("una consulta que acota por operación pasa", () => {
    const source = `
export async function listConversations(op: Operation) {
  return db.select().from(conversations).where(ofOperation(op, conversations.operationId));
}`;
    expect(consultasSinAlcance(source)).toEqual([]);
  });

  it("una consulta que tiene la operación a mano y no la usa es la fuga silenciosa", () => {
    const source = `
export async function listConversations(op: Operation) {
  return db.select().from(conversations).orderBy(desc(lastActivityAt)).limit(200);
}`;
    expect(consultasSinAlcance(source)).toEqual([
      {
        funcion: "listConversations",
        tabla: "conversations",
        motivo: "sin_filtro_de_operacion",
      },
    ]);
  });

  it("una consulta que ni siquiera tiene la operación se distingue de la anterior", () => {
    const source = `
export async function listConversations(search?: string) {
  return db.select().from(conversations).limit(200);
}`;
    expect(consultasSinAlcance(source)).toEqual([
      {
        funcion: "listConversations",
        tabla: "conversations",
        motivo: "sin_operacion_a_mano",
      },
    ]);
  });

  it("dentro de una función, cada consulta responde por sí misma", () => {
    // Es el caso que la primera versión dejaba pasar: la segunda consulta acota
    // y la primera no, y la función entera parecía correcta.
    const source = `
export async function listConversations(op: Operation) {
  const rows = await db.select().from(conversations).limit(200);
  const pedidos = await db.select().from(shopifyOrders).where(ofOperation(op, shopifyOrders.operationId));
  return { rows, pedidos };
}`;
    expect(consultasSinAlcance(source)).toEqual([
      {
        funcion: "listConversations",
        tabla: "conversations",
        motivo: "sin_filtro_de_operacion",
      },
    ]);
  });

  it("una escritura por id sin verificar pertenencia se atrapa igual que una lectura", () => {
    const source = `
export async function setConfirmationStatus(op: Operation, conversationId: string) {
  await db.update(conversations).set({ confirmationStatus: "confirmed" }).where(eq(conversations.id, conversationId));
}`;
    expect(consultasSinAlcance(source)).toEqual([
      {
        funcion: "setConfirmationStatus",
        tabla: "conversations",
        motivo: "sin_filtro_de_operacion",
      },
    ]);
  });

  it("acotar a mano cuenta igual que usar el ayudante", () => {
    const source = `
export async function listTemplates(op: Operation) {
  return db.select().from(templates).where(eq(templates.operationId, op.id));
}`;
    expect(consultasSinAlcance(source)).toEqual([]);
  });

  it("una acción de pantalla que resuelve la operación ella misma cuenta como tenerla", () => {
    // Las acciones de servidor de `templates/page.tsx` no reciben la operación:
    // no hay quién se la pase, así que la resuelven.
    const source = `
async function deleteTemplate(formData: FormData) {
  const op = await resolvePanelOperation();
  await db.delete(templates).where(and(eq(templates.id, id), eq(templates.operationId, op.id)));
}`;
    expect(consultasSinAlcance(source)).toEqual([]);
  });

  it("prometer el filtro en un comentario no cuenta como filtrarlo", () => {
    const source = `
export async function listTemplates(op: Operation) {
  // TODO: filtrar por templates.operationId
  return db.select().from(templates);
}`;
    expect(consultasSinAlcance(source)).toHaveLength(1);
  });

  it("las tablas que cuelgan de la conversación también se vigilan", () => {
    // `messages` no lleva `operation_id` y aun así se lee por id desde la URL.
    const source = `
export async function listMessages(conversationId: string) {
  return db.select().from(messages).where(eq(messages.conversationId, conversationId));
}`;
    expect(consultasSinAlcance(source)).toEqual([
      {
        funcion: "listMessages",
        tabla: "messages",
        motivo: "sin_operacion_a_mano",
      },
    ]);
  });

  it("una tabla que solo se une a otra no exige su propio filtro", () => {
    // El que manda es el que maneja la consulta: un `leftJoin` no puede traer
    // filas que el `from` no haya traído.
    const source = `
export async function listShopifyOrdersWithDropi(op: Operation) {
  return db.select().from(shopifyOrders)
    .leftJoin(dropiOrders, eq(dropiOrders.shopifyOrderRowId, shopifyOrders.id))
    .where(ofOperation(op, shopifyOrders.operationId));
}`;
    expect(consultasSinAlcance(source)).toEqual([]);
  });

  it("un parámetro con valor por defecto entre llaves no confunde a la firma", () => {
    const source = `
export async function listShopifyOrdersWithDropi(op: Operation, filters: OrderFilters = {}, limit = 300) {
  return db.select().from(shopifyOrders).where(ofOperation(op, shopifyOrders.operationId)).limit(limit);
}`;
    expect(consultasSinAlcance(source)).toEqual([]);
  });

  it("una función que no toca tablas con dueño no se vigila", () => {
    const source = `
export function renderPreview(body: string) {
  return body.trim();
}`;
    expect(analizarConsultasDelPanel(source)).toEqual([]);
  });
});
