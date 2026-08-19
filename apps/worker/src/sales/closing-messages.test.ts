import { describe, expect, it } from "vitest";
import {
  closingCorrectionMessage,
  closingErrorAudience,
  funnelHandoffMessage,
  orderRegisteredMessage,
  salesPurchaseAckMessage,
} from "./closing-messages";
import type { SalesOrderError } from "./order";

describe("closingErrorAudience · no todo error es del cliente", () => {
  it("lo que el cliente puede corregir, se le pregunta", () => {
    const suyos: SalesOrderError[] = [
      { code: "missing_required", field: "phone" },
      { code: "phone_invalid", value: "123" },
      { code: "city_unknown", value: "Pueblo" },
      { code: "division_unknown", value: "Depto" },
      { code: "city_in_other_division", value: "Antigua", divisions: ["X"] },
      { code: "address_and_pickup_conflict" },
    ];
    for (const e of suyos) expect(closingErrorAudience(e)).toBe("lead");
  });

  it("lo que el cliente no puede arreglar, escala", () => {
    // Pedirle al cliente que corrija un error del sistema es la peor respuesta
    // posible: lo deja intentando algo imposible y sin nadie mirando.
    const delEquipo: SalesOrderError[] = [
      { code: "country_unsupported", countryCode: "MX" },
      { code: "no_lines" },
      { code: "line_invalid", index: 0, reason: "price" },
    ];
    for (const e of delEquipo) expect(closingErrorAudience(e)).toBe("team");
  });
});

describe("closingCorrectionMessage · todo lo que falta, de una vez", () => {
  it("pide junto todo lo que el cliente tiene que corregir", () => {
    // Una corrección por mensaje —«falta el apellido», «ahora el teléfono»— es
    // cómo se pierde a alguien que ya había decidido comprar.
    const msg = closingCorrectionMessage([
      { code: "missing_required", field: "lastName" },
      { code: "phone_invalid", value: "123" },
      { code: "city_unknown", value: "Pueblito" },
    ]);
    expect(msg).toContain("apellido");
    expect(msg).toContain("123");
    expect(msg).toContain("Pueblito");
    expect(msg?.split("\n").filter((l) => l.startsWith("•"))).toHaveLength(3);
  });

  it("con un solo dato, el encabezado habla en singular", () => {
    const msg = closingCorrectionMessage([
      { code: "missing_required", field: "phone" },
    ]);
    expect(msg).toContain("un dato");
    expect(msg).not.toContain("estos datos");
  });

  it("el municipio en otro departamento pregunta con precisión", () => {
    // El caso real: «Antigua Guatemala» con departamento «Guatemala». El
    // municipio existe, así que repreguntar por el municipio entero sería
    // hacerle repetir lo que ya escribió bien.
    const msg = closingCorrectionMessage([
      {
        code: "city_in_other_division",
        value: "Antigua Guatemala",
        divisions: ["Sacatepéquez"],
      },
    ]);
    expect(msg).toContain("Sacatepéquez");
    expect(msg).not.toContain("No encuentro el municipio");
  });

  it("dirección y reclamo en oficina a la vez no se resuelven por él", () => {
    const msg = closingCorrectionMessage([
      { code: "address_and_pickup_conflict" },
    ]);
    expect(msg).toContain("¿cuál de las dos preferís?");
  });

  it("cuando solo hay errores del sistema, al cliente no se le pregunta nada", () => {
    expect(closingCorrectionMessage([{ code: "no_lines" }])).toBeNull();
    expect(
      closingCorrectionMessage([
        { code: "country_unsupported", countryCode: "MX" },
        { code: "line_invalid", index: 0, reason: "quantity" },
      ]),
    ).toBeNull();
  });
});

describe("orderRegisteredMessage · lo que cierra la venta", () => {
  const base = {
    orderName: "#1042",
    productSummary: "2 × Colágeno Hidrolizado",
    total: 540,
    currency: "GTQ",
    destination: "3a calle poniente 12 — Antigua Guatemala, Sacatepéquez",
    pickupAtOffice: false,
  };

  it("lleva el número de pedido, que es lo único que el cliente tiene", () => {
    // En contraentrega no hay comprobante de pago: ese número es lo que
    // convierte «creo que compré» en «compré el #1042».
    const msg = orderRegisteredMessage(base);
    expect(msg).toContain("#1042");
    expect(msg).toContain("2 × Colágeno Hidrolizado");
  });

  it("dice cuánto paga al recibir, sin decimales de más", () => {
    expect(orderRegisteredMessage(base)).toContain("540 GTQ al recibir");
  });

  it("el reclamo en oficina se lee distinto de una entrega a domicilio", () => {
    const msg = orderRegisteredMessage({ ...base, pickupAtOffice: true });
    expect(msg).toContain("Lo reclamás en oficina");
    expect(msg).not.toContain("Entrega en");
  });
});

describe("funnelHandoffMessage · el aviso que escribe el admin", () => {
  it("usa el texto configurado en el panel", () => {
    expect(funnelHandoffMessage("  Te llamamos mañana  ")).toBe(
      "Te llamamos mañana",
    );
  });

  it("vacío no deja al cliente sin el aviso", () => {
    // `sales_agent_settings` se llena de a poco desde el panel; un campo vacío
    // no puede hacer que el mensaje de diez minutos después se lea como que
    // nadie se enteró de la venta.
    const msg = funnelHandoffMessage("");
    expect(msg).toContain("confirmaciones");
    expect(msg.length).toBeGreaterThan(20);
  });
});

describe("salesPurchaseAckMessage · reconoce la compra, no la propone", () => {
  const base = {
    customerFirstName: "María",
    productSummary: "Colágeno Hidrolizado",
    destination: "3a calle poniente 12 — Antigua Guatemala",
    total: "540 GTQ",
  };

  it("da por hecha la compra en vez de preguntar si quiere comprar", () => {
    // El punto entero del ticket 05: el cliente acaba de despedirse del
    // vendedor y recibir «¿querés confirmar tu pedido?» se lee como que nadie
    // se enteró.
    const msg = salesPurchaseAckMessage(base);
    expect(msg).toContain("Ya tengo tu pedido");
    expect(msg).toContain("María");
  });

  it("se enfoca en verificar la dirección, que es donde se caen las entregas", () => {
    // No se salta la confirmación: la hace en un mensaje. En contraentrega la
    // dirección sin verificar es la causa número uno de devolución.
    const msg = salesPurchaseAckMessage(base);
    expect(msg).toContain("confirmar la dirección");
    expect(msg).toContain("3a calle poniente 12");
    expect(msg).toContain("¿Está correcta?");
  });

  it("sin nombre, saluda igual y no escribe un hueco", () => {
    const msg = salesPurchaseAckMessage({ ...base, customerFirstName: "  " });
    expect(msg).toContain("¡Hola!");
    expect(msg).not.toContain("¡Hola !");
  });
});
