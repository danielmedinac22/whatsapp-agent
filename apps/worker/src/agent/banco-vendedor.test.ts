import { describe, expect, it } from "vitest";
import { vendedorBancoInput, MAX_BANCO_TURNS } from "@wa/shared";
import {
  mensajesAlCliente,
  reporteDelBanco,
  type BancoPedido,
} from "./banco-vendedor";
import type { SalesOrderDraft } from "../sales/order";

/**
 * Una configuración completa **y apagada**, que es el caso normal del banco:
 * probar no exige encender, y ese es el motivo por el que el banco existe.
 */
const SEBASTIAN = {
  enabled: false,
  displayName: "Sebastián",
  greeting: "¡Hola! Soy Sebastián de Vorare 👋",
  closingPush: "¿Te lo aparto? Pagas cuando lo recibes.",
  funnelMessage: "Te dejo el enlace por si quieres verlo con calma.",
  toneInstructions: "Tutea y no escribas párrafos largos.",
  discountLimitPct: 10,
  discountLimitBehavior: "consultar" as const,
  model: "openai/gpt-5.4-mini",
  reasoningEffort: "low" as const,
};

const PRODUCTO = "8f1c2f7a-3c2b-4a9d-9f0e-1a2b3c4d5e6f";
const OTRO_PRODUCTO = "2b7e6d5c-4a3b-4c2d-8e1f-0a9b8c7d6e5f";

const UN_TURNO = [{ role: "user" as const, content: "hola, vi el anuncio" }];

describe("qué acepta el banco de pruebas", () => {
  it("un lead con producto reconocido es lo que la pauta paga", () => {
    const r = vendedorBancoInput.safeParse({
      settings: SEBASTIAN,
      productId: PRODUCTO,
      turns: UN_TURNO,
    });
    expect(r.success).toBe(true);
  });

  it("un lead que llega sin anuncio reconocido también se puede probar", () => {
    // Es el caso real de quien le escribe al número sin pasar por un anuncio, y
    // es justamente el que hay que poder ver: el vendedor no sabe qué producto
    // quiere y tiene que preguntarlo.
    const r = vendedorBancoInput.safeParse({
      settings: SEBASTIAN,
      productId: null,
      turns: UN_TURNO,
    });
    expect(r.success).toBe(true);
  });

  it("la duda de la cascada se prueba con la lista de candidatos", () => {
    const r = vendedorBancoInput.safeParse({
      settings: SEBASTIAN,
      productId: null,
      candidateIds: [PRODUCTO, OTRO_PRODUCTO],
      turns: UN_TURNO,
    });
    expect(r.success).toBe(true);
  });

  it("una prueba sin ningún turno no es una prueba", () => {
    const r = vendedorBancoInput.safeParse({
      settings: SEBASTIAN,
      productId: PRODUCTO,
      turns: [],
    });
    expect(r.success).toBe(false);
  });

  it("la conversación de prueba tiene tope", () => {
    const r = vendedorBancoInput.safeParse({
      settings: SEBASTIAN,
      productId: PRODUCTO,
      turns: Array.from({ length: MAX_BANCO_TURNS + 1 }, () => ({
        role: "user" as const,
        content: "otra vez",
      })),
    });
    expect(r.success).toBe(false);
  });

  it("un razonamiento que la configuración no reconoce no se puede probar", () => {
    // La columna es texto libre y el formulario muestra lo que haya guardado,
    // aunque no lo entienda. El banco no: mandar un valor que el proveedor no
    // acepta haría que la prueba fallara como si fuera culpa del prompt.
    const r = vendedorBancoInput.safeParse({
      settings: { ...SEBASTIAN, reasoningEffort: "altísimo" },
      productId: PRODUCTO,
      turns: UN_TURNO,
    });
    expect(r.success).toBe(false);
  });

  it("se puede probar con el vendedor encendido, que es el mismo turno", () => {
    // El banco no mira el interruptor: corre la configuración que le mandan.
    // Encendido o apagado, el turno que arma es el mismo.
    const r = vendedorBancoInput.safeParse({
      settings: { ...SEBASTIAN, enabled: true },
      productId: PRODUCTO,
      turns: UN_TURNO,
    });
    expect(r.success).toBe(true);
  });

  it("el producto se elige por identificador, no por nombre", () => {
    const r = vendedorBancoInput.safeParse({
      settings: SEBASTIAN,
      productId: "REVITALHAIR",
      turns: UN_TURNO,
    });
    expect(r.success).toBe(false);
  });
});

describe("qué se le dice al modelo cuando el pedido se armó", () => {
  const ARMADO: BancoPedido = {
    kind: "armado",
    order: {
      totals: { subtotal: 300, discount: 0, total: 300 },
    } as SalesOrderDraft,
    discountClamped: false,
    requestedPct: 0,
    appliedPct: 0,
  };

  it("le avisa que su texto de este turno no sale", () => {
    // Es lo que de verdad pasa: en un turno de cierre el texto del modelo lo
    // reemplaza el sistema. Decirle otra cosa haría que el turno siguiente
    // hablara como si el cliente hubiera leído lo suyo.
    const { detalle } = reporteDelBanco(ARMADO);
    expect(detalle).toMatch(/no sale/i);
  });

  it("dice que es una prueba, con su propio estado", () => {
    expect(reporteDelBanco(ARMADO).estado).toBe("armado_en_prueba");
  });

  it("cuando faltan datos habla como producción, que es lo que se quiere ver", () => {
    const { estado, detalle } = reporteDelBanco({
      kind: "faltan_datos",
      errors: [{ code: "missing_required", field: "phone" }],
    });
    expect(estado).toBe("faltan_datos");
    expect(detalle).toMatch(/pedile al cliente lo que falta/i);
  });

  it("la presentación sin elegir vuelve con las opciones, para que pregunte", () => {
    const { detalle } = reporteDelBanco({
      kind: "falta_la_presentacion",
      opciones: ["250ml", "500ml"],
    });
    expect(detalle).toContain("250ml, 500ml");
  });

  it("sin tienda conectada dice que en producción esperaría, no que se pierde", () => {
    const { detalle } = reporteDelBanco({ kind: "sin_tienda" });
    expect(detalle).toMatch(/en cola esperando/i);
  });
});

describe("qué leería el cliente, que no es lo que el modelo escribió", () => {
  const ARMADO: BancoPedido = {
    kind: "armado",
    order: {
      currency: "GTQ",
      lines: [{ title: "REVITALHAIR", quantity: 2 }],
      totals: { subtotal: 600, discount: 0, total: 600 },
      shipping: {
        kind: "delivery",
        address: "4a calle 12-30",
        city: "Mixco",
        division: "Guatemala",
      },
    } as unknown as SalesOrderDraft,
    discountClamped: false,
    requestedPct: 0,
    appliedPct: 0,
  };

  const RESUMEN = {
    orderName: "(el número se lo pone la tienda)",
    productSummary: "2 × REVITALHAIR",
    total: 600,
    currency: "GTQ",
    destination: "4a calle 12-30 — Mixco, Guatemala",
    pickupAtOffice: false,
  };

  const base = {
    modelText: "¡Listo! Tu pedido quedó registrado, te llega mañana.",
    funnelMessage: "En un rato te escribe el equipo de confirmaciones.",
    resumen: RESUMEN,
  };

  it("sin intento de cierre habla el vendedor, que es la conversación de siempre", () => {
    const r = mensajesAlCliente({
      ...base,
      pedido: null,
      writeMode: "dry_run",
      modelText: "El REVITALHAIR cuesta 300 quetzales 🙌",
    });
    expect(r.fuente).toBe("modelo");
    expect(r.textos).toEqual(["El REVITALHAIR cuesta 300 quetzales 🙌"]);
  });

  it("con el pedido armado y la escritura en seco, el texto del modelo NO sale", () => {
    // La regla que este banco existe para no enseñar mal: el modelo redacta
    // «quedó registrado» y en modo seco eso es mentira, así que producción lo
    // reemplaza. Si el banco mostrara su texto, Pablo vería un mensaje que su
    // cliente nunca va a leer.
    const r = mensajesAlCliente({ ...base, pedido: ARMADO, writeMode: "dry_run" });
    expect(r.fuente).toBe("sistema");
    expect(r.textos.join("\n")).not.toContain("te llega mañana");
    expect(r.textos.join("\n")).toMatch(/ya tengo todos tus datos/i);
  });

  it("en seco no le promete al cliente que el pedido exista", () => {
    const r = mensajesAlCliente({ ...base, pedido: ARMADO, writeMode: "dry_run" });
    expect(r.textos.join("\n")).not.toMatch(/quedó registrado/i);
  });

  it("con la escritura encendida sí recibe el pedido y el embudo, en ese orden", () => {
    const r = mensajesAlCliente({ ...base, pedido: ARMADO, writeMode: "live" });
    expect(r.textos).toHaveLength(2);
    expect(r.textos[0]).toMatch(/quedó registrado/i);
    expect(r.textos[1]).toBe("En un rato te escribe el equipo de confirmaciones.");
  });

  it("la presentación sin elegir la pregunta el vendedor, no el sistema", () => {
    const r = mensajesAlCliente({
      ...base,
      pedido: { kind: "falta_la_presentacion", opciones: ["250ml", "500ml"] },
      writeMode: "dry_run",
      modelText: "¿La querés de 250ml o de 500ml?",
    });
    expect(r.fuente).toBe("modelo");
    expect(r.textos).toEqual(["¿La querés de 250ml o de 500ml?"]);
  });

  it("cuando faltan datos, la corrección los pide todos juntos", () => {
    const r = mensajesAlCliente({
      ...base,
      pedido: {
        kind: "faltan_datos",
        errors: [
          { code: "missing_required", field: "phone" },
          { code: "missing_required", field: "city" },
        ],
      },
      writeMode: "dry_run",
    });
    expect(r.fuente).toBe("sistema");
    expect(r.textos).toHaveLength(1);
    expect(r.textos[0]).toMatch(/me faltan estos datos/i);
  });

  it("al pasar a un asesor sale el mismo aviso que manda el escalamiento", () => {
    const r = mensajesAlCliente({
      ...base,
      pedido: {
        kind: "a_un_asesor",
        motivo: "no hay producto",
        reason: "sales_product_unidentified",
      },
      writeMode: "dry_run",
    });
    expect(r.textos[0]).toMatch(/te paso con un asesor/i);
  });

  it("sin tienda conectada el cliente lee lo mismo que en seco: sus datos están", () => {
    // Para el cliente los dos casos significan lo mismo, y por eso comparten
    // texto: el pedido no existe todavía y una persona le va a confirmar.
    const r = mensajesAlCliente({ ...base, pedido: { kind: "sin_tienda" }, writeMode: "live" });
    expect(r.textos.join("\n")).toMatch(/ya tengo todos tus datos/i);
  });
});
