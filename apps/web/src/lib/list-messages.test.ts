// @vitest-environment node
/**
 * El hilo por páginas, del lado del servidor.
 *
 * El bug: `listMessages` ordenaba ascendente y cortaba en 200, así que en un
 * chat largo **lo que no se veía eran los mensajes más nuevos**. Ahora lee desde
 * el final, de a 50, y sube con un cursor.
 *
 * No hay base en estas pruebas. Se afirman dos cosas por separado:
 *
 * 1. **La forma del SQL** que sale de verdad de Drizzle: el par
 *    `(created_at, id)` contra la fila del cursor leída en la base, acotada a
 *    la conversación y a la operación.
 * 2. **El recorrido**, contra una tabla en memoria que contesta esa consulta
 *    con las reglas de Postgres que importan acá: fechas con microsegundos,
 *    comparación de pares, y un cursor ajeno que no encuentra fila. Cada
 *    página que devuelve sale del SQL afirmado en 1, leyendo sus parámetros.
 *
 * Lo que esto no prueba es el planificador real; eso pide la base de ensayo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Fila = {
  id: string;
  conversationId: string;
  /** ISO con microsegundos, como lo guarda Postgres. Ordena como texto. */
  createdAt: string;
};

const tabla = vi.hoisted(() => ({
  filas: [] as Fila[],
  /** Conversación → operación dueña. */
  duenas: new Map<string, string>(),
  consultas: [] as Array<{ sql: string; params: unknown[] }>,
}));

vi.mock("./db", async (importOriginal) => {
  const original = await importOriginal<typeof import("./db")>();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const { getTableColumns } = await import("drizzle-orm");
  const columnas = Object.keys(getTableColumns(original.messages));

  const db = drizzle(async (sql, params) => {
    tabla.consultas.push({ sql, params });
    // Los parámetros se reconocen por valor: los ids son únicos en la prueba
    // y el límite es el único número.
    const conversationId = params.find((p) =>
      tabla.duenas.has(String(p)),
    ) as string;
    const operacion = params.find((p) =>
      [...tabla.duenas.values()].includes(String(p)),
    );
    const limite = params.find((p) => typeof p === "number") as number;
    const cursorId = sql.includes(") < (")
      ? params.find((p) => tabla.filas.some((f) => f.id === p))
      : undefined;

    const deLaOperacion = (f: Fila) =>
      tabla.duenas.get(f.conversationId) === operacion;
    let filas = tabla.filas.filter(
      (f) => f.conversationId === conversationId && deLaOperacion(f),
    );
    if (sql.includes(") < (")) {
      const cursor = tabla.filas.find(
        (f) =>
          f.id === cursorId &&
          f.conversationId === conversationId &&
          deLaOperacion(f),
      );
      // Sin fila del cursor la comparación es `null`: no pasa ninguna.
      filas = cursor
        ? filas.filter(
            (f) =>
              f.createdAt < cursor.createdAt ||
              (f.createdAt === cursor.createdAt && f.id < cursor.id),
          )
        : [];
    }
    filas.sort((a, b) =>
      a.createdAt === b.createdAt
        ? b.id.localeCompare(a.id)
        : b.createdAt.localeCompare(a.createdAt),
    );
    const valores: Record<string, unknown> = {};
    return {
      rows: filas.slice(0, limite).map((f) => {
        Object.assign(valores, {
          id: f.id,
          conversationId: f.conversationId,
          direction: "in",
          waId: null,
          body: f.id,
          mediaUrl: null,
          mediaMime: null,
          status: "delivered",
          deliveryError: null,
          sentByUserId: null,
          fromAgent: false,
          createdAt: f.createdAt,
        });
        return columnas.map((c) => valores[c]);
      }),
    };
  });
  return { ...original, db };
});

import {
  esCursorDeMensaje,
  listMessages,
  MENSAJES_POR_PAGINA,
} from "./queries";
import type { Operation } from "@wa/db";

const GUATEMALA = { id: "0a000000-0000-4000-8000-000000000001" } as Operation;
const COLOMBIA = { id: "0a000000-0000-4000-8000-000000000002" } as Operation;
const CHAT = "0c000000-0000-4000-8000-000000000001";
const OTRO_CHAT = "0c000000-0000-4000-8000-000000000002";
const CHAT_COLOMBIANO = "0c000000-0000-4000-8000-000000000003";

/** Un uuid ordenable: el número va al final, con ceros a la izquierda. */
const uuid = (prefijo: string, n: number) =>
  `${prefijo}000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** El n-ésimo segundo del día, con microsegundos. */
const instante = (segundo: number, micro = 0) =>
  `2026-10-28T10:${String(Math.floor(segundo / 60)).padStart(2, "0")}:${String(
    segundo % 60,
  ).padStart(2, "0")}.${String(micro).padStart(6, "0")}+00:00`;

function sembrar(conversationId: string, cuantos: number, prefijo = "0d") {
  for (let n = 0; n < cuantos; n++) {
    tabla.filas.push({
      id: uuid(prefijo, n),
      conversationId,
      createdAt: instante(n),
    });
  }
}

/** Sube por el hilo hasta el primer mensaje, como lo haría el asesor. */
async function recorrer(op: Operation, conversationId: string) {
  const paginas: string[][] = [];
  let pagina = await listMessages(op, conversationId);
  paginas.push(pagina.messages.map((m) => m.id));
  while (pagina.hasMore) {
    const before = pagina.messages[0]!.id;
    pagina = await listMessages(op, conversationId, { before });
    paginas.push(pagina.messages.map((m) => m.id));
  }
  return paginas;
}

beforeEach(() => {
  tabla.filas = [];
  tabla.consultas = [];
  tabla.duenas = new Map([
    [CHAT, GUATEMALA.id],
    [OTRO_CHAT, GUATEMALA.id],
    [CHAT_COLOMBIANO, COLOMBIA.id],
  ]);
});

describe("el SQL que sale", () => {
  it("lee desde el final, con uno de más para saber si queda algo", async () => {
    await listMessages(GUATEMALA, CHAT);
    const { sql, params } = tabla.consultas[0]!;
    expect(sql).toMatch(
      /order by "messages"\."created_at" desc, "messages"\."id" desc/,
    );
    expect(params).toContain(MENSAJES_POR_PAGINA + 1);
    expect(sql).not.toContain(") < (");
  });

  it("corta por el par (created_at, id) contra la fila del cursor, en la base", async () => {
    const cursor = uuid("0d", 7);
    await listMessages(GUATEMALA, CHAT, { before: cursor });
    const { sql, params } = tabla.consultas[0]!;
    // El par entero y no la fecha sola: el id desempata dentro del mismo
    // instante, y la fecha del cursor no viaja por JS, que corta a milisegundos.
    expect(sql).toMatch(
      /\("messages"\."created_at", "messages"\."id"\) < \(\s*select "messages"\."created_at", "messages"\."id" from "messages"/,
    );
    // La fila del cursor tiene que ser de esta conversación y de esta operación.
    const subconsulta = sql.slice(sql.indexOf(") < ("));
    expect(subconsulta).toMatch(/"messages"\."conversation_id" = \$\d+/);
    expect(subconsulta).toMatch(/"conversations"\."operation_id" = \$\d+/);
    expect(params).toContain(cursor);
    expect(params.filter((p) => p === CHAT).length).toBeGreaterThanOrEqual(2);
    expect(params).toContain(GUATEMALA.id);
  });
});

describe("las páginas", () => {
  it("al abrir trae los últimos 50, en orden, y avisa que hay más", async () => {
    sembrar(CHAT, 120);
    const { messages, hasMore } = await listMessages(GUATEMALA, CHAT);
    expect(messages).toHaveLength(50);
    expect(messages[0]!.id).toBe(uuid("0d", 70));
    expect(messages.at(-1)!.id).toBe(uuid("0d", 119));
    expect(hasMore).toBe(true);
  });

  it("sube de 50 en 50 hasta el primero, sin repetir ni saltarse ninguno", async () => {
    sembrar(CHAT, 120);
    const paginas = await recorrer(GUATEMALA, CHAT);
    expect(paginas.map((p) => p.length)).toEqual([50, 50, 20]);
    const todos = paginas.reverse().flat();
    expect(todos).toEqual(
      Array.from({ length: 120 }, (_, n) => uuid("0d", n)),
    );
  });

  it("con exactamente 50 no hay más; con 51, sí", async () => {
    sembrar(CHAT, 50);
    expect((await listMessages(GUATEMALA, CHAT)).hasMore).toBe(false);
    sembrar(OTRO_CHAT, 51, "0e");
    const conUnoMas = await listMessages(GUATEMALA, OTRO_CHAT);
    expect(conUnoMas.messages).toHaveLength(50);
    expect(conUnoMas.hasMore).toBe(true);
    const ultima = await listMessages(GUATEMALA, OTRO_CHAT, {
      before: conUnoMas.messages[0]!.id,
    });
    expect(ultima.messages.map((m) => m.id)).toEqual([uuid("0e", 0)]);
    expect(ultima.hasMore).toBe(false);
  });

  it("los mensajes del mismo instante se desempatan por id y no se pierde ninguno", async () => {
    // 75 mensajes en el mismo microsegundo, y 10 más en el mismo milisegundo
    // pero distinto microsegundo: los que un `Date` de JS confundiría.
    for (let n = 0; n < 75; n++) {
      tabla.filas.push({
        id: uuid("0d", n),
        conversationId: CHAT,
        createdAt: instante(0),
      });
    }
    for (let n = 0; n < 10; n++) {
      tabla.filas.push({
        id: uuid("0f", n),
        conversationId: CHAT,
        createdAt: instante(0, 100 + n),
      });
    }
    const paginas = await recorrer(GUATEMALA, CHAT);
    const todos = paginas.flat();
    expect(todos).toHaveLength(85);
    expect(new Set(todos).size).toBe(85);
  });

  it("un cursor de otra conversación devuelve vacío", async () => {
    sembrar(CHAT, 60);
    sembrar(OTRO_CHAT, 60, "0e");
    const ajeno = uuid("0e", 30);
    expect(await listMessages(GUATEMALA, CHAT, { before: ajeno })).toEqual({
      messages: [],
      hasMore: false,
    });
  });

  it("un cursor que existe en la conversación de otra operación devuelve vacío", async () => {
    sembrar(CHAT_COLOMBIANO, 60, "0e");
    expect(
      await listMessages(GUATEMALA, CHAT_COLOMBIANO, { before: uuid("0e", 30) }),
    ).toEqual({ messages: [], hasMore: false });
  });
});

describe("el cursor", () => {
  it("es un uuid; lo demás no llega a la base", () => {
    expect(esCursorDeMensaje(uuid("0d", 1))).toBe(true);
    expect(esCursorDeMensaje("")).toBe(false);
    expect(esCursorDeMensaje("2026-10-28T10:00:00Z")).toBe(false);
    expect(esCursorDeMensaje("x' or 1=1 --")).toBe(false);
  });
});
