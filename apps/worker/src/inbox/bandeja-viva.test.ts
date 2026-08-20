import { describe, expect, it } from "vitest";
import type { ConversationSnapshot, WaEvent } from "@wa/shared";
import {
  aplicarEvento,
  reordenarPorActividad,
  type FilaDeLaLista,
} from "@wa/db/bandeja-viva";
import { sinResponder, type SinResponderFacts } from "@wa/db";

/**
 * **Qué le hace a la lista de la bandeja un evento del stream.**
 *
 * La regla vieja era una sola y siempre la misma: `router.refresh()`, o sea
 * pedirle al servidor la pantalla entera —23 idas y vueltas a la base y 1.256
 * filas leídas, medido el 20-ago-2026— para entregar una fila que cambió.
 *
 * Lo que estos casos fijan es cada una de las tres respuestas por separado:
 * cuándo la fila se repinta sola, cuándo el evento no le toca a esta bandeja, y
 * los dos casos —nombrados, no un cajón de sastre— en los que hay que volver a
 * preguntar. Más las dos cosas que la lista nunca hace sola: moverse de puesto
 * e inventar una conversación que no tiene.
 */

const GUATE = "op-guatemala";
const COLOMBIA = "op-colombia";

/** Una fila de la lista, con lo mínimo puesto y el resto en su valor limpio. */
function fila(over: Partial<FilaDeLaLista> & { id: string }): FilaDeLaLista {
  return {
    preview: "hola",
    unread: 0,
    lastAt: "2026-08-20T10:00:00.000Z",
    agentMode: false,
    assignedTo: null,
    sinResponder: false,
    deliveryFailed: false,
    ...over,
  };
}

/** El resumen de la fila tal como viaja en el evento. */
function instantanea(over: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    lastMessagePreview: "¿ya salió mi pedido?",
    unreadCount: 1,
    lastActivityAt: "2026-08-20T12:00:00.000Z",
    ...over,
  };
}

/** Un mensaje entrante de Guatemala, con el resumen de la fila pegado. */
function entrante(
  conversationId: string,
  snap: Partial<ConversationSnapshot> = {},
  operationId: string | null = GUATE,
): WaEvent {
  return {
    type: "message.created",
    operationId,
    conversationId,
    messageId: "m-1",
    conversation: instantanea(snap),
  };
}

const BANDEJA = { operationId: GUATE };

/**
 * Dos conversaciones, la de arriba con actividad más reciente: el orden que
 * manda el servidor.
 */
const LISTA = [
  fila({ id: "c-arriba", lastAt: "2026-08-20T11:00:00.000Z" }),
  fila({ id: "c-abajo", lastAt: "2026-08-20T09:00:00.000Z" }),
];

describe("a quién le toca el evento", () => {
  it("un evento de otra operación no toca esta bandeja", () => {
    const d = aplicarEvento(LISTA, entrante("c-abajo", {}, COLOMBIA), BANDEJA);
    expect(d).toEqual({
      accion: "ignorar",
      motivo: "otra-operacion",
      conversationId: "c-abajo",
    });
  });

  it("un evento sin operación llega igual: no se puede probar que sea ajeno", () => {
    // Es la conversación que entró por un número que no reconocemos. El
    // pipeline la procesa antes que perderla, y descartarla acá la volvería
    // invisible en todos los paneles a la vez.
    const d = aplicarEvento(LISTA, entrante("c-abajo", {}, null), BANDEJA);
    expect(d.accion).toBe("parchear");
  });

  it("un panel sin operación resuelta recibe todo, y no una pantalla muerta", () => {
    const d = aplicarEvento(LISTA, entrante("c-abajo", {}, COLOMBIA), {
      operationId: null,
    });
    expect(d.accion).toBe("parchear");
  });

  it("el estado de la conexión no es de ninguna conversación", () => {
    const d = aplicarEvento(LISTA, { type: "status", status: "connected" }, BANDEJA);
    expect(d).toEqual({
      accion: "ignorar",
      motivo: "no-es-de-una-conversacion",
      conversationId: null,
    });
  });
});

describe("un mensaje entrante repinta la fila", () => {
  it("escribe la vista previa, el contador y la fecha", () => {
    const d = aplicarEvento(
      LISTA,
      entrante("c-abajo", {
        lastMessagePreview: "¿ya salió mi pedido?",
        unreadCount: 3,
        lastActivityAt: "2026-08-20T12:00:00.000Z",
      }),
      BANDEJA,
    );
    if (d.accion !== "parchear") throw new Error(`esperaba parchear, dio ${d.accion}`);
    expect(d.filas[1]).toMatchObject({
      id: "c-abajo",
      preview: "¿ya salió mi pedido?",
      unread: 3,
      lastAt: "2026-08-20T12:00:00.000Z",
    });
  });

  it("conserva su identidad: lo que el evento no trae se queda como estaba", () => {
    // El evento lleva tres campos y la fila veinte. Un parche que reconstruyera
    // la fila borraría el pedido, la guía y el dueño.
    const con = [
      fila({ id: "c-abajo", agentMode: true, deliveryFailed: true }),
    ] as Array<FilaDeLaLista & { orderNumber: string }>;
    con[0]!.orderNumber = "GT-1042";

    const d = aplicarEvento(con, entrante("c-abajo"), BANDEJA);
    if (d.accion !== "parchear") throw new Error(`esperaba parchear, dio ${d.accion}`);
    expect(d.filas[0]).toMatchObject({
      orderNumber: "GT-1042",
      agentMode: true,
      deliveryFailed: true,
    });
  });

  it("no mueve la fila de puesto, aunque la actividad la mande arriba", () => {
    const d = aplicarEvento(LISTA, entrante("c-abajo"), BANDEJA);
    if (d.accion !== "parchear") throw new Error(`esperaba parchear, dio ${d.accion}`);
    expect(d.filas.map((f) => f.id)).toEqual(["c-arriba", "c-abajo"]);
  });

  it("avisa que la lista quedó desordenada cuando la fila tendría que subir", () => {
    const d = aplicarEvento(LISTA, entrante("c-abajo"), BANDEJA);
    if (d.accion !== "parchear") throw new Error(`esperaba parchear, dio ${d.accion}`);
    expect(d.desordena).toBe(true);
  });

  it("no avisa de nada si la fila ya era la primera", () => {
    // La de arriba se actualiza y sigue arriba: nada que reordenar, y un aviso
    // que aparece sin que nada se haya movido es un aviso que nadie mira.
    const d = aplicarEvento(LISTA, entrante("c-arriba"), BANDEJA);
    if (d.accion !== "parchear") throw new Error(`esperaba parchear, dio ${d.accion}`);
    expect(d.desordena).toBe(false);
  });

  it("no inventa una conversación que no está en la lista", () => {
    const d = aplicarEvento(LISTA, entrante("c-que-no-esta"), BANDEJA);
    expect(d).toEqual({
      accion: "ignorar",
      motivo: "fuera-de-la-lista",
      conversationId: "c-que-no-esta",
    });
  });
});

describe("los acuses", () => {
  const acuse = (status: "delivered" | "read" | "sent"): WaEvent => ({
    type: "message.status",
    operationId: GUATE,
    conversationId: "c-abajo",
    messageId: "m-1",
    status,
  });

  it("un acuse de lectura no cambia ni reordena nada", () => {
    // Cada mensaje que sale produce dos o tres. Si movieran la lista, el
    // reordenamiento sería por mensaje enviado y no por conversación nueva.
    for (const estado of ["sent", "delivered", "read"] as const) {
      expect(aplicarEvento(LISTA, acuse(estado), BANDEJA)).toEqual({
        accion: "ignorar",
        motivo: "acuse",
        conversationId: "c-abajo",
      });
    }
  });

  it("un fallo enciende el aviso de «no entregado» sin mover la fila", () => {
    const d = aplicarEvento(
      LISTA,
      { ...acuse("delivered"), status: "failed" } as WaEvent,
      BANDEJA,
    );
    if (d.accion !== "parchear") throw new Error(`esperaba parchear, dio ${d.accion}`);
    expect(d.filas[1]).toMatchObject({ id: "c-abajo", deliveryFailed: true });
    expect(d.desordena).toBe(false);
  });

  it("un envío que murió también lo enciende, y por eso llega sin instantánea", () => {
    // `huellaDelSaliente` devuelve `null` sin `wa_id`: un mensaje que nunca
    // salió no le deja huella a la conversación. Lo único que cambia es el aviso.
    const d = aplicarEvento(
      LISTA,
      {
        type: "message.created",
        operationId: GUATE,
        conversationId: "c-abajo",
        messageId: "m-muerto",
        conversation: null,
      },
      BANDEJA,
    );
    if (d.accion !== "parchear") throw new Error(`esperaba parchear, dio ${d.accion}`);
    expect(d.filas[1]).toMatchObject({ deliveryFailed: true });
  });

  it("un fallo repetido no vuelve a escribir la fila", () => {
    const ya = [fila({ id: "c-abajo", deliveryFailed: true })];
    const d = aplicarEvento(
      ya,
      {
        type: "message.status",
        operationId: GUATE,
        conversationId: "c-abajo",
        messageId: "m-2",
        status: "failed",
      },
      BANDEJA,
    );
    expect(d).toMatchObject({ accion: "ignorar", motivo: "sin-cambio" });
  });
});

describe("lo que el evento no alcanza a decir", () => {
  it("«cambió la conversación» siempre vuelve a preguntar", () => {
    // Sus dos emisores lo prueban: el clasificador mueve `confirmation_status`,
    // que no viaja en la instantánea, y el aviso del propio panel llega con la
    // instantánea en `null`.
    const d = aplicarEvento(
      LISTA,
      {
        type: "conversation.updated",
        operationId: GUATE,
        conversationId: "c-abajo",
        conversation: instantanea(),
      },
      BANDEJA,
    );
    expect(d).toEqual({
      accion: "refrescar",
      motivo: "cambio-no-descrito",
      conversationId: "c-abajo",
    });
  });

  it("pregunta también por una conversación que todavía no está en la lista", () => {
    // La acaban de asignar y estaba fuera del corte por actividad: el servidor
    // es el único que la puede traer.
    const d = aplicarEvento(
      LISTA,
      {
        type: "conversation.updated",
        operationId: GUATE,
        conversationId: "c-que-no-esta",
        conversation: null,
      },
      BANDEJA,
    );
    expect(d.accion).toBe("refrescar");
  });
});

/**
 * **`sinResponder` es derivado por el servidor**, y este repo ya tuvo un
 * contador que decía lo que no medía. Lo que estos casos fijan es que el parche
 * solo lo toca donde la regla de `sin-responder.ts` da la misma respuesta.
 */
describe("«sin responder», que es derivado", () => {
  const AHORA = new Date("2026-08-20T12:00:01.000Z");

  /** Los hechos que la regla del servidor vería tras ese mismo entrante. */
  function hechosTrasElEntrante(
    over: Partial<SinResponderFacts> = {},
  ): SinResponderFacts {
    return {
      lastInboundAt: new Date("2026-08-20T12:00:00.000Z"),
      lastConversationalOutboundAt: new Date("2026-08-20T09:00:00.000Z"),
      agentMode: false,
      assignedUserId: null,
      lastEscalationAt: null,
      lastActivityAt: new Date("2026-08-20T12:00:00.000Z"),
      ...over,
    };
  }

  it("un entrante enciende el rojo, y la regla del servidor dice lo mismo", () => {
    const d = aplicarEvento(LISTA, entrante("c-abajo", { unreadCount: 1 }), BANDEJA);
    if (d.accion !== "parchear") throw new Error(`esperaba parchear, dio ${d.accion}`);
    expect(d.filas[1]!.sinResponder).toBe(true);
    // La atadura: lo que el parche decidió con tres campos de la fila es lo que
    // `sinResponder` decide con los seis hechos. Si alguna de las dos cambia de
    // opinión, esto lo dice.
    expect(sinResponder(hechosTrasElEntrante(), AHORA)).toBe(true);
  });

  it("no lo enciende si el agente la lleva, y la regla tampoco", () => {
    const conAgente = [fila({ id: "c-sola", agentMode: true })];
    const d = aplicarEvento(conAgente, entrante("c-sola", { unreadCount: 4 }), BANDEJA);
    if (d.accion !== "parchear") throw new Error(`esperaba parchear, dio ${d.accion}`);
    expect(d.filas[0]!.sinResponder).toBe(false);
    expect(sinResponder(hechosTrasElEntrante({ agentMode: true }), AHORA)).toBe(false);
  });

  it("no lo enciende si alguien la está trabajando, y la regla tampoco", () => {
    const tomada = [
      fila({ id: "c-sola", assignedTo: { id: "u-katherine", label: "Katherine" } }),
    ];
    const d = aplicarEvento(tomada, entrante("c-sola", { unreadCount: 2 }), BANDEJA);
    if (d.accion !== "parchear") throw new Error(`esperaba parchear, dio ${d.accion}`);
    expect(d.filas[0]!.sinResponder).toBe(false);
    expect(
      sinResponder(hechosTrasElEntrante({ assignedUserId: "u-katherine" }), AHORA),
    ).toBe(false);
  });

  it("un saliente que no mueve el contador no enciende nada", () => {
    // Una notificación logística no es que el cliente haya escrito. El contador
    // sube en un solo sitio del worker —la ingesta de un entrante—, y verlo
    // quieto es la prueba de que no entró nada.
    const d = aplicarEvento(
      LISTA,
      entrante("c-abajo", { unreadCount: 0, lastMessagePreview: "tu guía va en camino" }),
      BANDEJA,
    );
    if (d.accion !== "parchear") throw new Error(`esperaba parchear, dio ${d.accion}`);
    expect(d.filas[1]!.sinResponder).toBe(false);
  });

  it("nunca lo apaga solo: si la fila estaba roja y el contador quedó en cero, pregunta", () => {
    // Apagar el rojo exigiría saber si el saliente fue una respuesta o una
    // notificación, y si hay una escalada reciente. Nada de eso viaja.
    const roja = [fila({ id: "c-sola", sinResponder: true, unread: 3 })];
    const d = aplicarEvento(roja, entrante("c-sola", { unreadCount: 0 }), BANDEJA);
    expect(d).toEqual({
      accion: "refrescar",
      motivo: "pudo-dejar-de-estar-sin-responder",
      conversationId: "c-sola",
    });
  });

  it("una escalada deja la conversación sin responder aunque le hayamos contestado", () => {
    // Este es el caso que hace que apagar el rojo en el cliente sea imposible:
    // la pelota es de ellos y la regla dice `true` igual.
    expect(
      sinResponder(
        hechosTrasElEntrante({
          lastInboundAt: new Date("2026-08-20T08:00:00.000Z"),
          lastConversationalOutboundAt: new Date("2026-08-20T12:00:00.000Z"),
          lastEscalationAt: new Date("2026-08-20T12:00:00.000Z"),
        }),
        AHORA,
      ),
    ).toBe(true);
  });

  it("una fila roja que sigue recibiendo mensajes no pregunta nada", () => {
    // El caso del cliente que escribe tres veces seguidas: sigue roja, y el
    // servidor no tiene nada que agregar.
    const roja = [fila({ id: "c-sola", sinResponder: true, unread: 1 })];
    const d = aplicarEvento(roja, entrante("c-sola", { unreadCount: 2 }), BANDEJA);
    if (d.accion !== "parchear") throw new Error(`esperaba parchear, dio ${d.accion}`);
    expect(d.filas[0]!.sinResponder).toBe(true);
  });
});

describe("reordenar, que es cosa del usuario", () => {
  it("pone primero la actividad más reciente", () => {
    const desordenada = [
      fila({ id: "a", lastAt: "2026-08-20T09:00:00.000Z" }),
      fila({ id: "b", lastAt: "2026-08-20T12:00:00.000Z" }),
      fila({ id: "c", lastAt: "2026-08-20T11:00:00.000Z" }),
    ];
    expect(reordenarPorActividad(desordenada).map((f) => f.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("no toca la lista que recibe", () => {
    const original = [...LISTA];
    reordenarPorActividad(LISTA);
    expect(LISTA).toEqual(original);
  });
});
