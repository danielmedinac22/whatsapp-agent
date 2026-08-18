import { describe, expect, it } from "vitest";
import {
  inboxChangedSince,
  resolveInboxAsOf,
  type InboxFacts,
  type OrderFacts,
  type OrderLogisticsStatus,
  type OrderPipelineStatus,
} from "@wa/db";

/**
 * Lo que decide si una asignación sigue en pie: si la conversación cambió de
 * bandeja desde que alguien dijo «esta la trabajo yo».
 *
 * Las fechas son días de un mismo mes para que el orden se lea a ojo.
 */
const dia = (d: number) => new Date(Date.UTC(2026, 6, d, 12, 0, 0));

function pedido(
  createdAt: Date,
  logisticsStatus: OrderLogisticsStatus | null = null,
  pipelineStatus: OrderPipelineStatus = "confirmed",
): OrderFacts {
  return { createdAt, pipelineStatus, logisticsStatus };
}

describe("la bandeja de un instante pasado", () => {
  it("un lead sin pedido estaba en ventas, y lo sigue estando", () => {
    const facts: InboxFacts = { lastAdClickAt: dia(1), orders: [] };
    expect(resolveInboxAsOf(facts, dia(5)).inbox).toBe("ventas");
    expect(inboxChangedSince(facts, dia(5))).toBe(false);
  });

  it("el pedido que nació después no cuenta para la bandeja de antes", () => {
    const facts: InboxFacts = {
      lastAdClickAt: dia(1),
      orders: [pedido(dia(8))],
    };
    // El 5 todavía era un lead: el pedido es del 8.
    expect(resolveInboxAsOf(facts, dia(5))).toEqual({
      inbox: "ventas",
      rule: "no_order",
    });
    expect(resolveInboxAsOf(facts, dia(9)).inbox).toBe("operaciones");
  });

  it("el clic que llegó después tampoco cuenta hacia atrás", () => {
    const facts: InboxFacts = {
      lastAdClickAt: dia(9),
      orders: [pedido(dia(3))],
    };
    expect(resolveInboxAsOf(facts, dia(5)).inbox).toBe("operaciones");
    expect(resolveInboxAsOf(facts, dia(10)).inbox).toBe("ventas");
  });
});

describe("cuándo se libera la asignación", () => {
  it("cerrar la venta suelta a quien la vendía: la conversación se fue a operaciones", () => {
    const asignada = dia(5);
    const facts: InboxFacts = {
      lastAdClickAt: dia(2),
      orders: [pedido(dia(7), "pendiente_confirmacion")],
    };
    expect(inboxChangedSince(facts, asignada)).toBe(true);
  });

  it("un clic nuevo sobre una conversación de operaciones también la suelta: la vuelve a ventas", () => {
    const asignada = dia(5);
    const facts: InboxFacts = {
      lastAdClickAt: dia(9),
      orders: [pedido(dia(3), "entregado")],
    };
    expect(inboxChangedSince(facts, asignada)).toBe(true);
  });

  it("un segundo pedido sobre una conversación que ya era de operaciones NO la suelta", () => {
    // Cambia la regla —de terminado a en curso— y no cambia la bandeja. Soltar
    // acá sería castigar a quien la está trabajando por un hecho que no la movió.
    const asignada = dia(5);
    const facts: InboxFacts = {
      lastAdClickAt: null,
      orders: [pedido(dia(2), "entregado"), pedido(dia(8), "en_transito")],
    };
    expect(inboxChangedSince(facts, asignada)).toBe(false);
  });

  it("que el pedido avance de estado no suelta nada: sigue siendo de operaciones", () => {
    const asignada = dia(5);
    const antes: InboxFacts = {
      lastAdClickAt: null,
      orders: [pedido(dia(2), "pendiente")],
    };
    const despues: InboxFacts = {
      lastAdClickAt: null,
      orders: [pedido(dia(2), "entregado")],
    };
    expect(inboxChangedSince(antes, asignada)).toBe(false);
    expect(inboxChangedSince(despues, asignada)).toBe(false);
  });

  it("una conversación que nunca se movió de ventas conserva a quien la trabaja", () => {
    const asignada = dia(5);
    const facts: InboxFacts = { lastAdClickAt: dia(4), orders: [] };
    expect(inboxChangedSince(facts, asignada)).toBe(false);
  });
});
