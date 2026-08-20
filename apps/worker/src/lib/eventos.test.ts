import { describe, expect, it } from "vitest";
import type { WaEvent } from "@wa/shared";
import { events as bus } from "./events";
import { events as ruta } from "../routes/events";
import {
  esParaElPanel,
  instantaneaDe,
  normalizarAvisoDelPanel,
  type HechosDeLaFila,
} from "./eventos";

/**
 * Que el evento del stream traiga lo que cambió, y que no cruce de operación.
 *
 * **Lo que estas pruebas no cubren y por qué.** Los cinco sitios de emisión
 * escriben en Postgres una línea antes de emitir, y este encargo no tiene base:
 * lo que se prueba es lo que decide el contenido del evento —la instantánea, el
 * filtro y el aviso que llega del web—, no el `UPDATE` que lo precede. Que los
 * cinco manden los campos nuevos lo verifica el compilador, que es la
 * comprobación más fuerte de las dos: `WaEvent` es una unión discriminada y
 * quitarle `operationId` a cualquiera de los cinco no compila.
 */

const GUATEMALA = "11111111-1111-4111-8111-111111111111";
const COLOMBIA = "22222222-2222-4222-8222-222222222222";

const NACIMIENTO = new Date("2026-07-01T10:00:00.000Z");
const ENTRANTE = new Date("2026-08-20T14:00:00.000Z");
const SALIENTE = new Date("2026-08-20T15:30:00.000Z");

/** Una conversación viva, como la trae la fila. */
const fila: HechosDeLaFila = {
  lastMessagePreview: "¿ya salió mi pedido?",
  unreadCount: 3,
  lastInboundAt: ENTRANTE,
  lastOutboundAt: null,
  createdAt: NACIMIENTO,
};

describe("la instantánea que repinta la fila", () => {
  it("lleva la vista previa, el contador y la fecha", () => {
    expect(instantaneaDe(fila)).toEqual({
      lastMessagePreview: "¿ya salió mi pedido?",
      unreadCount: 3,
      lastActivityAt: ENTRANTE.toISOString(),
    });
  });

  it("la fecha es la más reciente de las tres, no la del cliente", () => {
    // Es la misma frase que ordena la lista (`actividadDe`, `@wa/db`): una
    // conversación cuyo último mensaje es NUESTRO no puede quedarse anclada a
    // la fecha del cliente, o el panel la repintaría en el puesto equivocado.
    expect(
      instantaneaDe({ ...fila, lastOutboundAt: SALIENTE }).lastActivityAt,
    ).toBe(SALIENTE.toISOString());
  });

  it("una conversación sin mensajes cae en su nacimiento", () => {
    expect(
      instantaneaDe({
        lastMessagePreview: null,
        unreadCount: 0,
        lastInboundAt: null,
        lastOutboundAt: null,
        createdAt: NACIMIENTO,
      }),
    ).toEqual({
      lastMessagePreview: null,
      unreadCount: 0,
      lastActivityAt: NACIMIENTO.toISOString(),
    });
  });

  it("el contador viaja como quedó, no como delta", () => {
    // Un delta obligaría al cliente a sumar sobre un número que puede tener
    // viejo; el valor absoluto lo deja repintar sin acumular deriva.
    expect(instantaneaDe({ ...fila, unreadCount: 0 }).unreadCount).toBe(0);
  });
});

/** El entrante que la ingesta emite, armado como lo arma `inbound/pipeline.ts`. */
function entranteDe(operationId: string | null, preview: string): WaEvent {
  return {
    type: "message.created",
    operationId,
    conversationId: "c-1",
    messageId: "m-1",
    conversation: instantaneaDe({ ...fila, lastMessagePreview: preview }),
  };
}

describe("a qué panel le llega un evento", () => {
  it("el tráfico de Guatemala no llega al panel de Colombia", () => {
    expect(esParaElPanel(entranteDe(GUATEMALA, "hola"), COLOMBIA)).toBe(false);
  });

  it("el tráfico de Guatemala llega al panel de Guatemala", () => {
    expect(esParaElPanel(entranteDe(GUATEMALA, "hola"), GUATEMALA)).toBe(true);
  });

  it("el acuse de entrega también se filtra por operación", () => {
    const acuse: WaEvent = {
      type: "message.status",
      operationId: GUATEMALA,
      conversationId: "c-1",
      messageId: "m-1",
      status: "failed",
    };
    expect(esParaElPanel(acuse, COLOMBIA)).toBe(false);
    expect(esParaElPanel(acuse, GUATEMALA)).toBe(true);
  });

  it("el cambio de conversación también se filtra por operación", () => {
    const cambio: WaEvent = {
      type: "conversation.updated",
      operationId: COLOMBIA,
      conversationId: "c-2",
      conversation: null,
    };
    expect(esParaElPanel(cambio, GUATEMALA)).toBe(false);
  });

  it("un evento sin operación llega a todos: no se puede probar ajeno", () => {
    // Es la conversación que entró por un número que no reconocemos, que el
    // pipeline procesa igual antes que perderla. Descartarla acá la volvería
    // invisible en todos los paneles a la vez.
    expect(esParaElPanel(entranteDe(null, "hola"), GUATEMALA)).toBe(true);
  });

  it("un panel que no resolvió su operación sigue recibiendo todo", () => {
    // La ruta se traga ese fallo a propósito. Cambiar una pantalla degradada
    // por una pantalla muerta sería peor que el bug que este filtro cierra.
    expect(esParaElPanel(entranteDe(GUATEMALA, "hola"), null)).toBe(true);
  });

  it("el QR y el estado de conexión no son de ninguna operación", () => {
    expect(esParaElPanel({ type: "qr", qr: "abc" }, GUATEMALA)).toBe(true);
    expect(
      esParaElPanel({ type: "status", status: "connected" }, COLOMBIA),
    ).toBe(true);
  });
});

/** Lo que una pestaña con esta operación abierta recibiría del bus. */
function loQueRecibeElPanel(
  operacion: string | null,
  emitir: () => void,
): WaEvent[] {
  const recibidos: WaEvent[] = [];
  const off = bus.onEvent((ev) => {
    if (!esParaElPanel(ev, operacion)) return;
    recibidos.push(ev);
  });
  try {
    emitir();
  } finally {
    off();
  }
  return recibidos;
}

describe("el evento que sale del bus", () => {
  it("llega con los cuatro campos nuevos poblados", () => {
    const recibidos = loQueRecibeElPanel(GUATEMALA, () =>
      bus.emitEvent(entranteDe(GUATEMALA, "¿ya salió mi pedido?")),
    );

    expect(recibidos).toHaveLength(1);
    const ev = recibidos[0]!;
    expect(ev.type).toBe("message.created");
    // Los cuatro: la operación, la vista previa, el contador y la fecha.
    expect(ev).toMatchObject({
      operationId: GUATEMALA,
      conversation: {
        lastMessagePreview: "¿ya salió mi pedido?",
        unreadCount: 3,
        lastActivityAt: ENTRANTE.toISOString(),
      },
    });
  });

  it("un evento de Colombia no le lleva nada al panel de Guatemala", () => {
    const recibidos = loQueRecibeElPanel(GUATEMALA, () => {
      bus.emitEvent(entranteDe(COLOMBIA, "pedido de Bogotá"));
      bus.emitEvent(entranteDe(GUATEMALA, "pedido de Antigua"));
    });

    expect(recibidos).toHaveLength(1);
    expect(recibidos[0]).toMatchObject({
      operationId: GUATEMALA,
      conversation: { lastMessagePreview: "pedido de Antigua" },
    });
    // Y sobre todo: ni la vista previa del otro país se asomó.
    expect(JSON.stringify(recibidos)).not.toContain("Bogotá");
    expect(JSON.stringify(recibidos)).not.toContain(COLOMBIA);
  });

  it("sobrevive al viaje por JSON, que es como cruza el SSE", () => {
    const [ev] = loQueRecibeElPanel(GUATEMALA, () =>
      bus.emitEvent(entranteDe(GUATEMALA, "hola")),
    );
    expect(JSON.parse(JSON.stringify(ev))).toEqual(ev);
  });
});

describe("el aviso que manda el panel", () => {
  const avisoDelWeb = { type: "conversation.updated", conversationId: "c-1" };

  it("toma la operación del header, que es lo único que la dice", () => {
    // `apps/web` arma este objeto dentro de un `JSON.stringify`, así que el
    // compilador no lo alcanza: si la operación no se pegara acá, el filtro del
    // stream tiraría los avisos de «la trabajo yo» y de la confirmación, que
    // son dos de los tres botones de uso diario de la bandeja.
    expect(normalizarAvisoDelPanel(avisoDelWeb, GUATEMALA)).toEqual({
      type: "conversation.updated",
      operationId: GUATEMALA,
      conversationId: "c-1",
      conversation: null,
    });
  });

  it("el aviso normalizado sí le llega a su propio panel", () => {
    const ev = normalizarAvisoDelPanel(avisoDelWeb, GUATEMALA)!;
    expect(esParaElPanel(ev, GUATEMALA)).toBe(true);
    expect(esParaElPanel(ev, COLOMBIA)).toBe(false);
  });

  it("no inventa instantánea: asignar o confirmar no mueve la fila", () => {
    const ev = normalizarAvisoDelPanel(avisoDelWeb, GUATEMALA);
    expect(ev).toMatchObject({ conversation: null });
  });

  it("una instantánea que sí venga en el cuerpo se respeta", () => {
    const conversation = instantaneaDe(fila);
    expect(
      normalizarAvisoDelPanel({ ...avisoDelWeb, conversation }, GUATEMALA),
    ).toMatchObject({ conversation });
  });

  it("la operación explícita del cuerpo le gana al header", () => {
    expect(
      normalizarAvisoDelPanel(
        { ...avisoDelWeb, operationId: COLOMBIA },
        GUATEMALA,
      ),
    ).toMatchObject({ operationId: COLOMBIA });
  });

  it("sin operación en ninguna parte queda en null, no en undefined", () => {
    // `undefined` no es `null` para el filtro: sería un evento que no llega a
    // ningún panel en vez de uno que llega a todos.
    const ev = normalizarAvisoDelPanel(avisoDelWeb, null);
    expect(ev).toMatchObject({ operationId: null });
    expect(esParaElPanel(ev!, GUATEMALA)).toBe(true);
  });

  it("un mensaje nuevo avisado desde el panel también se arma entero", () => {
    expect(
      normalizarAvisoDelPanel(
        { type: "message.created", conversationId: "c-1", messageId: "m-9" },
        GUATEMALA,
      ),
    ).toEqual({
      type: "message.created",
      operationId: GUATEMALA,
      conversationId: "c-1",
      messageId: "m-9",
      conversation: null,
    });
  });

  it("un acuse avisado desde el panel conserva su estado", () => {
    expect(
      normalizarAvisoDelPanel(
        {
          type: "message.status",
          conversationId: "c-1",
          messageId: "m-9",
          status: "failed",
        },
        GUATEMALA,
      ),
    ).toMatchObject({ status: "failed", operationId: GUATEMALA });
  });

  it("rechaza lo que no alcanza para armar un evento", () => {
    expect(normalizarAvisoDelPanel(null, GUATEMALA)).toBeNull();
    expect(normalizarAvisoDelPanel("hola", GUATEMALA)).toBeNull();
    expect(normalizarAvisoDelPanel({}, GUATEMALA)).toBeNull();
    expect(
      normalizarAvisoDelPanel({ type: "conversation.updated" }, GUATEMALA),
    ).toBeNull();
    expect(
      normalizarAvisoDelPanel({ type: "vino.de.marte", conversationId: "c" }, GUATEMALA),
    ).toBeNull();
    expect(
      normalizarAvisoDelPanel(
        { type: "message.status", conversationId: "c", messageId: "m", status: "azul" },
        GUATEMALA,
      ),
    ).toBeNull();
  });
});

describe("la ruta que el panel llama", () => {
  const cabecera = { "content-type": "application/json", "x-operation-id": GUATEMALA };

  it("pone en el bus el aviso con la operación de la pestaña", async () => {
    const recibidos: WaEvent[] = [];
    const off = bus.onEvent((ev) => recibidos.push(ev));
    try {
      const res = await ruta.request("/notify", {
        method: "POST",
        headers: cabecera,
        // El cuerpo exacto que manda `apps/web` al tomar una conversación.
        body: JSON.stringify({ type: "conversation.updated", conversationId: "c-7" }),
      });
      expect(res.status).toBe(200);
    } finally {
      off();
    }

    expect(recibidos).toEqual([
      {
        type: "conversation.updated",
        operationId: GUATEMALA,
        conversationId: "c-7",
        conversation: null,
      },
    ]);
  });

  it("un cuerpo que no arma un evento sigue siendo 400 y no toca el bus", async () => {
    const recibidos: WaEvent[] = [];
    const off = bus.onEvent((ev) => recibidos.push(ev));
    try {
      const res = await ruta.request("/notify", {
        method: "POST",
        headers: cabecera,
        body: JSON.stringify({ nada: true }),
      });
      expect(res.status).toBe(400);
    } finally {
      off();
    }
    expect(recibidos).toEqual([]);
  });
});
