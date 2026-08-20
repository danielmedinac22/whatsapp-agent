import { describe, expect, it } from "vitest";
import {
  DIAS_SIN_RESPONDER,
  pelotaNuestra,
  puedeEstarSinResponder,
  sinResponder,
  type SinResponderFacts,
} from "@wa/db";

/**
 * **«Sin responder»**: qué conversación está esperando que una persona conteste.
 *
 * La regla vieja era `!agent_mode && unread_count > 0` y contaba 90
 * conversaciones sobre las 1.760 de Guatemala; ninguna de las 54 que se pudieron
 * reproducir el 19-ago-2026 era trabajo vivo. Lo que estos casos fijan es cada
 * una de las cuatro condiciones por separado, más las dos que la corrección del
 * 20-ago-2026 agregó: que **una notificación no es una respuesta**, y que **la
 * ausencia de respuesta cuenta como que no contestamos**.
 */

const AHORA = new Date(Date.UTC(2026, 7, 20, 12, 0, 0));

/** Hace `d` días, para que el corte de recencia se lea a ojo. */
const haceDias = (d: number): Date =>
  new Date(AHORA.getTime() - d * 24 * 60 * 60 * 1000);

/**
 * Una conversación que el cliente escribió ayer y nadie contestó: el caso que
 * la vista tiene que traer. Cada test cambia **un** hecho.
 */
function conversacion(cambios: Partial<SinResponderFacts> = {}): SinResponderFacts {
  return {
    lastInboundAt: haceDias(1),
    lastConversationalOutboundAt: null,
    agentMode: false,
    assignedUserId: null,
    lastEscalationAt: null,
    lastActivityAt: haceDias(1),
    ...cambios,
  };
}

describe("la pelota es nuestra", () => {
  it("lo es cuando el cliente habló después de la última respuesta", () => {
    expect(
      pelotaNuestra({
        lastInboundAt: haceDias(1),
        lastConversationalOutboundAt: haceDias(2),
      }),
    ).toBe(true);
  });

  it("no lo es cuando ya le contestamos después de que habló", () => {
    expect(
      pelotaNuestra({
        lastInboundAt: haceDias(2),
        lastConversationalOutboundAt: haceDias(1),
      }),
    ).toBe(false);
  });

  it("lo es cuando nunca salió una respuesta, aunque hayan salido avisos", () => {
    // Los 24 casos de producción del 20-ago-2026: conversaciones sin ninguna
    // fila conversacional en el outbox. La ausencia cuenta como «no
    // contestamos», que es el lado conservador.
    expect(
      pelotaNuestra({
        lastInboundAt: haceDias(1),
        lastConversationalOutboundAt: null,
      }),
    ).toBe(true);
  });

  it("no lo es si el cliente nunca escribió", () => {
    expect(
      pelotaNuestra({
        lastInboundAt: null,
        lastConversationalOutboundAt: null,
      }),
    ).toBe(false);
  });

  it("no lo es en el empate al milisegundo", () => {
    // Estrictamente posterior, como el clic de anuncio del ruteo: lo que ocurre
    // en el mismo instante no es el cliente esperando.
    const t = haceDias(1);
    expect(
      pelotaNuestra({
        lastInboundAt: t,
        lastConversationalOutboundAt: new Date(t.getTime()),
      }),
    ).toBe(false);
  });
});

describe("sin responder", () => {
  it("cuenta la conversación que escribió y nadie contestó", () => {
    expect(sinResponder(conversacion(), AHORA)).toBe(true);
  });

  it("no cuenta la que ya fue contestada", () => {
    expect(
      sinResponder(
        conversacion({
          lastInboundAt: haceDias(2),
          lastConversationalOutboundAt: haceDias(1),
        }),
        AHORA,
      ),
    ).toBe(false);
  });

  it("no cuenta la que solo recibió una notificación después", () => {
    // El caso que la corrección del 20-ago-2026 vino a arreglar: comparar
    // contra `last_outbound_at` convertía «Estamos pendientes para que recibas
    // tu pedido» en «ya contestamos». Acá el saliente conversacional sigue
    // siendo el de antes de que el cliente escribiera, así que sigue contando.
    expect(
      sinResponder(
        conversacion({
          lastInboundAt: haceDias(2),
          lastConversationalOutboundAt: haceDias(3),
          // La notificación movió la actividad, no la respuesta.
          lastActivityAt: haceDias(1),
        }),
        AHORA,
      ),
    ).toBe(true);
  });

  it("no cuenta la que lleva el agente", () => {
    expect(sinResponder(conversacion({ agentMode: true }), AHORA)).toBe(false);
  });

  it("no cuenta la que alguien está trabajando", () => {
    expect(
      sinResponder(conversacion({ assignedUserId: "u-1" }), AHORA),
    ).toBe(false);
  });

  it("no cuenta la que lleva más de treinta días quieta", () => {
    const vieja = haceDias(DIAS_SIN_RESPONDER + 1);
    expect(
      sinResponder(
        conversacion({ lastInboundAt: vieja, lastActivityAt: vieja }),
        AHORA,
      ),
    ).toBe(false);
  });

  it("cuenta la del último día de la ventana", () => {
    const justo = haceDias(DIAS_SIN_RESPONDER);
    expect(
      sinResponder(
        conversacion({ lastInboundAt: justo, lastActivityAt: justo }),
        AHORA,
      ),
    ).toBe(true);
  });

  it("cuenta la que sigue viva aunque el cliente escribiera hace más de 24h", () => {
    // Con la ventana de 24h la cuenta da cero en producción. Un lead de hace
    // treinta horas sigue siendo una venta perdida: lo que cambia es que la
    // fila diga que la ventana está cerrada, no que salga de la cuenta.
    const ayerYPico = new Date(AHORA.getTime() - 30 * 60 * 60 * 1000);
    expect(
      sinResponder(
        conversacion({ lastInboundAt: ayerYPico, lastActivityAt: ayerYPico }),
        AHORA,
      ),
    ).toBe(true);
  });

  it("cuenta la escalada aunque el último mensaje sea nuestro", () => {
    expect(
      sinResponder(
        conversacion({
          lastInboundAt: haceDias(3),
          lastConversationalOutboundAt: haceDias(2),
          lastEscalationAt: haceDias(2),
          lastActivityAt: haceDias(2),
        }),
        AHORA,
      ),
    ).toBe(true);
  });

  it("no cuenta la escalada vieja de una conversación ya contestada", () => {
    expect(
      sinResponder(
        conversacion({
          lastInboundAt: haceDias(3),
          lastConversationalOutboundAt: haceDias(2),
          lastEscalationAt: haceDias(DIAS_SIN_RESPONDER + 1),
          lastActivityAt: haceDias(2),
        }),
        AHORA,
      ),
    ).toBe(false);
  });

  it("no cuenta la escalada que alguien ya tomó", () => {
    // Una escalada no es un pase libre: si el asesor la tomó, ya no es un
    // pendiente de la lista, que es para lo que sirve «TRABAJARLA YO».
    expect(
      sinResponder(
        conversacion({
          lastInboundAt: haceDias(3),
          lastConversationalOutboundAt: haceDias(2),
          lastEscalationAt: haceDias(2),
          lastActivityAt: haceDias(2),
          assignedUserId: "u-1",
        }),
        AHORA,
      ),
    ).toBe(false);
  });

  it("no cuenta la conversación que solo escribimos nosotros", () => {
    expect(
      sinResponder(
        conversacion({ lastInboundAt: null, lastActivityAt: haceDias(1) }),
        AHORA,
      ),
    ).toBe(false);
  });
});

/**
 * **Lo que la consulta del panel puede descartar en la base.**
 *
 * `apps/web/src/lib/queries.ts` copia `puedeEstarSinResponder` en SQL —tres
 * columnas— para no traerse las 1.760 conversaciones de Guatemala en cada carga
 * del Inbox. Esta prueba es lo que ata las dos mitades: si algún día una de las
 * tres condiciones deja de ser necesaria, deja de valer el `where` de allá y
 * este test falla acá, que es donde se puede leer por qué.
 */
describe("lo que se puede descartar en la base", () => {
  /** Las dieciséis combinaciones de lo que la regla mira, sin repetir a mano. */
  const combinaciones: SinResponderFacts[] = [true, false].flatMap((agentMode) =>
    [null, "u-1"].flatMap((assignedUserId) =>
      [1, DIAS_SIN_RESPONDER + 1].flatMap((diasQuieta) =>
        [null, haceDias(2)].flatMap((lastEscalationAt) =>
          [null, haceDias(0)].map((lastConversationalOutboundAt) => ({
            lastInboundAt: haceDias(diasQuieta),
            lastConversationalOutboundAt,
            agentMode,
            assignedUserId,
            lastEscalationAt,
            lastActivityAt: haceDias(diasQuieta),
          })),
        ),
      ),
    ),
  );

  it("descartar por las tres condiciones nunca se lleva una que sí contaba", () => {
    for (const facts of combinaciones) {
      if (!puedeEstarSinResponder(facts, AHORA)) {
        expect(sinResponder(facts, AHORA)).toBe(false);
      }
    }
  });

  it("y no descarta todo: alguna de las combinaciones sobrevive y cuenta", () => {
    // Sin esto, un `return false` en `puedeEstarSinResponder` pasaría el test
    // de arriba sin que nadie se enterara.
    expect(combinaciones.some((f) => sinResponder(f, AHORA))).toBe(true);
  });
});
