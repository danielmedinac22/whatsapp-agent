import { describe, expect, it } from "vitest";
import type { ParsedAdReferral } from "../kapso/inbound";
import { resolveInbox, type OrderFacts } from "../inbox/resolve";
import { decideAdAttribution, type StoredAdAttribution } from "./attribution";
import { resolveConversationOwner } from "./owner";

describe("resolveConversationOwner", () => {
  it("sin vendedor configurado el dueño es el agente de confirmación", () => {
    expect(resolveConversationOwner({ salesAgentConfigured: false })).toEqual({
      agent: "confirmacion",
      rule: "no_sales_agent",
    });
  });

  it("con vendedor, la bandeja de ventas es del vendedor", () => {
    expect(
      resolveConversationOwner({ salesAgentConfigured: true, inbox: "ventas" }),
    ).toEqual({ agent: "ventas", rule: "sales_inbox" });
  });

  it("con vendedor, la bandeja de operaciones sigue siendo de confirmación", () => {
    expect(
      resolveConversationOwner({
        salesAgentConfigured: true,
        inbox: "operaciones",
      }),
    ).toEqual({ agent: "confirmacion", rule: "operations_inbox" });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Las cuatro combinaciones: referencia presente o ausente × pedido en curso o no
// ────────────────────────────────────────────────────────────────────────────
//
// Es la primera decisión de cada mensaje entrante desde que venta y
// confirmación comparten número, y equivocarla significa venderle a quien solo
// quería saber dónde está su guía. Se prueba sobre la composición real —
// atribución → bandeja → dueño — porque el error posible no está dentro de
// ninguna de las tres, sino en cómo se encadenan.

const AHORA = new Date("2026-08-17T10:00:00.000Z");
const HACE_UN_MES = new Date("2026-07-17T10:00:00.000Z");

const SIN_ATRIBUCION: StoredAdAttribution = {
  adId: null,
  adHeadline: null,
  adBody: null,
  adSourceUrl: null,
  ctwaClid: null,
  adReferralAt: null,
  adReferralRaw: null,
  productId: null,
};

const REFERENCIA: ParsedAdReferral = {
  adId: "120226305854810726",
  headline: "Recupera tu cabello",
  body: "REVITALHAIR DHT en 90 días",
  sourceUrl: "https://fb.me/3cr4Wqqkv",
  sourceType: "ad",
  ctwaClid: "Aff-n8ZTODiE79d22KtAwQKj9e",
  path: "message.referral",
  raw: { source_id: "120226305854810726" },
};

/** Un pedido de julio que la logística todavía está moviendo. */
const PEDIDO_EN_CURSO: OrderFacts = {
  createdAt: HACE_UN_MES,
  pipelineStatus: "confirmed",
  logisticsStatus: "en_transito",
};

const SIN_PEDIDOS: readonly OrderFacts[] = [];

/** Lo que hace el pipeline con un mensaje entrante, encadenado tal cual. */
function ingesta(input: {
  referencia: boolean;
  pedidos: readonly OrderFacts[];
  vendedor: boolean;
  guardado?: StoredAdAttribution;
}) {
  const attribution = decideAdAttribution({
    stored: input.guardado ?? SIN_ATRIBUCION,
    referral: input.referencia ? REFERENCIA : null,
    receivedAt: AHORA,
  });
  const inbox = resolveInbox({
    lastAdClickAt: attribution.effective.adReferralAt,
    orders: input.pedidos,
  });
  const owner = input.vendedor
    ? resolveConversationOwner({
        salesAgentConfigured: true,
        inbox: inbox.inbox,
      })
    : resolveConversationOwner({ salesAgentConfigured: false });
  return { attribution, inbox, owner };
}

describe("las cuatro combinaciones · con vendedor configurado", () => {
  it("con referencia y sin pedido es un lead de venta", () => {
    const { inbox, owner } = ingesta({
      referencia: true,
      pedidos: SIN_PEDIDOS,
      vendedor: true,
    });
    expect(inbox).toEqual({ inbox: "ventas", rule: "no_order" });
    expect(owner.agent).toBe("ventas");
  });

  it("con referencia y con pedido en curso es un lead de venta otra vez", () => {
    // El recomprador: ya compró, y un clic nuevo es intención de compra nueva.
    // No pierde su historial de postventa — las notificaciones logísticas del
    // pedido en curso siguen saliendo por su cuenta.
    const { inbox, owner } = ingesta({
      referencia: true,
      pedidos: [PEDIDO_EN_CURSO],
      vendedor: true,
    });
    expect(inbox).toEqual({
      inbox: "ventas",
      rule: "ad_click_after_last_order",
    });
    expect(owner.agent).toBe("ventas");
  });

  it("sin referencia y con pedido en curso es consulta de postventa", () => {
    const { inbox, owner } = ingesta({
      referencia: false,
      pedidos: [PEDIDO_EN_CURSO],
      vendedor: true,
    });
    expect(inbox).toEqual({ inbox: "operaciones", rule: "order_in_progress" });
    expect(owner.agent).toBe("confirmacion");
  });

  it("sin referencia y sin pedido entra como lead de venta", () => {
    const { inbox, owner } = ingesta({
      referencia: false,
      pedidos: SIN_PEDIDOS,
      vendedor: true,
    });
    expect(inbox).toEqual({ inbox: "ventas", rule: "no_order" });
    expect(owner.agent).toBe("ventas");
  });
});

describe("las cuatro combinaciones · sin vendedor configurado (Guatemala hoy)", () => {
  // El riesgo R8 de la no-regresión: introducir la lógica de dueño sobre el
  // número que hoy factura no puede rutear a un cliente de postventa hacia un
  // vendedor que no existe. Las cuatro combinaciones dan el mismo dueño que
  // antes del proyecto.
  const combinaciones = [
    { nombre: "con referencia y sin pedido", referencia: true, pedidos: SIN_PEDIDOS },
    { nombre: "con referencia y con pedido", referencia: true, pedidos: [PEDIDO_EN_CURSO] },
    { nombre: "sin referencia y con pedido", referencia: false, pedidos: [PEDIDO_EN_CURSO] },
    { nombre: "sin referencia y sin pedido", referencia: false, pedidos: SIN_PEDIDOS },
  ];

  for (const caso of combinaciones) {
    it(`${caso.nombre} sigue siendo del agente de confirmación`, () => {
      const { owner } = ingesta({
        referencia: caso.referencia,
        pedidos: caso.pedidos,
        vendedor: false,
      });
      expect(owner).toEqual({ agent: "confirmacion", rule: "no_sales_agent" });
    });
  }

  it("la atribución se guarda igual aunque no haya vendedor que la use", () => {
    // Capturarla no depende de que el módulo de ventas exista: lo que no se
    // guarde en el primer mensaje se pierde para siempre.
    const { attribution } = ingesta({
      referencia: true,
      pedidos: SIN_PEDIDOS,
      vendedor: false,
    });
    expect(attribution.write?.adId).toBe("120226305854810726");
    expect(attribution.write?.ctwaClid).toBe("Aff-n8ZTODiE79d22KtAwQKj9e");
  });
});

describe("un mensaje posterior de la misma conversación", () => {
  /** Cómo queda la conversación tras el primer mensaje, con producto resuelto. */
  const TRAS_EL_PRIMER_MENSAJE: StoredAdAttribution = {
    adId: "120226305854810726",
    adHeadline: "Recupera tu cabello",
    adBody: "REVITALHAIR DHT en 90 días",
    adSourceUrl: "https://fb.me/3cr4Wqqkv",
    ctwaClid: "Aff-n8ZTODiE79d22KtAwQKj9e",
    adReferralAt: AHORA,
    adReferralRaw: { source_id: "120226305854810726" },
    productId: "producto-revitalhair-dht",
  };

  it("una respuesta de botón sigue teniendo su anuncio, su producto y su clic", () => {
    const { attribution } = ingesta({
      referencia: false,
      pedidos: SIN_PEDIDOS,
      vendedor: true,
      guardado: TRAS_EL_PRIMER_MENSAJE,
    });
    expect(attribution.write).toBeNull();
    expect(attribution.effective.adId).toBe("120226305854810726");
    expect(attribution.effective.productId).toBe("producto-revitalhair-dht");
    expect(attribution.effective.ctwaClid).toBe("Aff-n8ZTODiE79d22KtAwQKj9e");
  });

  it("y sigue siendo del vendedor: la conversación no cambia de dueño al tocar un botón", () => {
    const { owner, inbox } = ingesta({
      referencia: false,
      pedidos: SIN_PEDIDOS,
      vendedor: true,
      guardado: TRAS_EL_PRIMER_MENSAJE,
    });
    expect(inbox.inbox).toBe("ventas");
    expect(owner.agent).toBe("ventas");
  });

  it("aunque el lead ya haya comprado: el pedido nuevo lo pasa a operaciones", () => {
    // La venta cerró: el pedido se creó después del clic que la trajo, así que
    // la conversación pasa a postventa sola, sin que nadie la mueva.
    const { owner, inbox } = ingesta({
      referencia: false,
      pedidos: [
        {
          createdAt: new Date(AHORA.getTime() + 60_000),
          pipelineStatus: "received",
          logisticsStatus: null,
        },
      ],
      vendedor: true,
      guardado: TRAS_EL_PRIMER_MENSAJE,
    });
    expect(inbox).toEqual({ inbox: "operaciones", rule: "order_in_progress" });
    expect(owner.agent).toBe("confirmacion");
  });
});
