import { describe, expect, it } from "vitest";
import { outboundSource } from "@wa/db";
import {
  esSalienteConversacional,
  huellaDelSaliente,
  type OutboundSource,
} from "./saliente-conversacional";

/**
 * Qué deja anotado un mensaje que salió.
 *
 * Las dos preguntas del ticket viven acá: **cuál de los ocho `source` es una
 * respuesta y cuál es una notificación**, y **qué se le escribe a la
 * conversación cuando el mensaje salió — y qué no se le escribe cuando no**.
 */

/**
 * Los ocho valores de `outbound_source` con el lado que le tocó a cada uno, y
 * el volumen que tienen en producción (Guatemala, 19-ago-2026): sirve para
 * saber qué se rompe si alguno cambia de lado.
 */
const LADOS: Array<{ source: OutboundSource; conversacional: boolean; filas: number }> = [
  { source: "agent", conversacional: true, filas: 4859 },
  { source: "manual", conversacional: true, filas: 352 },
  { source: "dropi_2fa", conversacional: false, filas: 5979 },
  { source: "dropi_status", conversacional: false, filas: 4542 },
  { source: "confirmation_ack", conversacional: false, filas: 1528 },
  { source: "followup", conversacional: false, filas: 980 },
  { source: "remarketing", conversacional: false, filas: 379 },
  { source: "escalation", conversacional: false, filas: 93 },
];

describe("qué saliente cuenta como una respuesta", () => {
  it("cubre los ocho valores que el esquema permite, y solo esos", () => {
    // El `never` de `esSalienteConversacional` hace que un `source` nuevo no
    // compile; esto hace que además no pase sin un caso de prueba. Son las dos
    // mitades de lo mismo: el compilador obliga a decidir, esta prueba obliga a
    // dejar dicho qué se decidió.
    expect([...LADOS.map((l) => l.source)].sort()).toEqual(
      [...outboundSource.enumValues].sort(),
    );
  });

  it("el agente contestando es una respuesta", () => {
    expect(esSalienteConversacional("agent")).toBe(true);
  });

  it("el envío manual del panel es una respuesta", () => {
    expect(esSalienteConversacional("manual")).toBe(true);
  });

  it("la escalada NO es una respuesta", () => {
    // La que más se parece a serlo y la que más caro sale confundir: es el
    // aviso de que hace falta una persona, no la respuesta de esa persona.
    // Apagar el contador con ella escondería justo la conversación que el
    // agente pidió mirar. En producción son 93 sobre 37 contactos.
    expect(esSalienteConversacional("escalation")).toBe(false);
  });

  it("el aviso de estado de la logística no es una respuesta", () => {
    expect(esSalienteConversacional("dropi_status")).toBe(false);
  });

  it("el código de dos factores de la logística no es una respuesta", () => {
    // El más voluminoso de los ocho —5.979 filas— y ni siquiera va dirigido al
    // cliente: es un código operativo que pasa por el mismo número.
    expect(esSalienteConversacional("dropi_2fa")).toBe(false);
  });

  it("el acuse de confirmación no es una respuesta", () => {
    expect(esSalienteConversacional("confirmation_ack")).toBe(false);
  });

  it("el seguimiento no es una respuesta", () => {
    expect(esSalienteConversacional("followup")).toBe(false);
  });

  it("el remarketing no es una respuesta", () => {
    expect(esSalienteConversacional("remarketing")).toBe(false);
  });

  it("conversacional es exactamente agent y manual: 5.211 de 18.712", () => {
    const conversacionales = LADOS.filter((l) => l.conversacional);
    expect(conversacionales.map((l) => l.source)).toEqual(["agent", "manual"]);
    expect(conversacionales.reduce((n, l) => n + l.filas, 0)).toBe(5211);
    expect(LADOS.reduce((n, l) => n + l.filas, 0)).toBe(18712);
  });
});

const AHORA = new Date("2026-08-19T15:00:00.000Z");
const ID_DE_META = "wamid.HBgLNTAyMTIzNDU2NzgVAgARGBI5QjRE";

describe("la huella que un saliente deja en su conversación", () => {
  it("una respuesta del agente apaga el contador y estampa la fecha", () => {
    expect(
      huellaDelSaliente({
        waId: ID_DE_META,
        source: "agent",
        cuerpo: "Claro que sí, te cuento",
        ahora: AHORA,
      }),
    ).toEqual({
      lastOutboundAt: AHORA,
      lastMessagePreview: "Claro que sí, te cuento",
      unreadCount: 0,
    });
  });

  it("un envío manual del panel hace exactamente lo mismo", () => {
    // Contestar es contestar, venga del agente o de una persona. Es la historia
    // 3 del spec: «quiero que contestar desde el celular apague el contador».
    expect(
      huellaDelSaliente({
        waId: ID_DE_META,
        source: "manual",
        cuerpo: "Ya te lo despachamos",
        ahora: AHORA,
      })?.unreadCount,
    ).toBe(0);
  });

  it("una notificación logística estampa la fecha pero NO apaga el contador", () => {
    const huella = huellaDelSaliente({
      waId: ID_DE_META,
      source: "dropi_status",
      cuerpo: "Tu pedido va en camino",
      ahora: AHORA,
    });
    // La fecha y la vista previa siguen saliendo con cualquier saliente: son
    // «qué fue lo último que salió», que es como la lista del panel ordena y
    // qué muestra. Recortarlas a lo conversacional le movería la bandeja a
    // Katherine sin que nadie lo pidiera — 1.204 de sus 1.760 conversaciones
    // tienen una notificación como último saliente.
    expect(huella).toEqual({
      lastOutboundAt: AHORA,
      lastMessagePreview: "Tu pedido va en camino",
    });
    expect(huella).not.toHaveProperty("unreadCount");
  });

  it("ninguna de las seis notificaciones apaga el contador", () => {
    for (const { source } of LADOS.filter((l) => !l.conversacional)) {
      const huella = huellaDelSaliente({
        waId: ID_DE_META,
        source,
        cuerpo: "aviso",
        ahora: AHORA,
      });
      expect(huella, source).not.toHaveProperty("unreadCount");
      expect(huella?.lastOutboundAt, source).toEqual(AHORA);
    }
  });

  it("un envío que no salió no marca nada, ni siquiera del agente", () => {
    // Sin identificador de Meta el mensaje no llegó a salir: es lo mismo que
    // mira `mirrorFailedSend` para saber que el envío murió en el intento. Se
    // estampa cuando el mensaje salió, no cuando se encoló — si no, un número
    // malo dejaría la conversación marcada como respondida para siempre.
    expect(
      huellaDelSaliente({
        waId: null,
        source: "agent",
        cuerpo: "esto nunca salió",
        ahora: AHORA,
      }),
    ).toBeNull();
  });

  it("la vista previa se corta a 200 caracteres, como la de la ingesta", () => {
    const huella = huellaDelSaliente({
      waId: ID_DE_META,
      source: "manual",
      cuerpo: "a".repeat(500),
      ahora: AHORA,
    });
    expect(huella?.lastMessagePreview).toHaveLength(200);
  });

  it("aplicarla dos veces deja lo mismo: la escritura es idempotente", () => {
    // Sale en cada saliente conversacional —~5.200 de 18.700—, así que tiene
    // que poder repetirse sin acumular nada. No hay `+ 1` ni lectura previa.
    const args = {
      waId: ID_DE_META,
      source: "agent" as const,
      cuerpo: "misma respuesta",
      ahora: AHORA,
    };
    expect(huellaDelSaliente(args)).toEqual(huellaDelSaliente(args));
  });
});
