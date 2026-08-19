import { describe, expect, it } from "vitest";
import {
  buildSalesOrder,
  salesOrderStore,
  OFF_CATALOG_TAG,
  PICKUP_AT_OFFICE_TAG,
  SALES_ORDER_TAG,
  type ClosingContact,
  type SalesClosing,
  type SalesOrderError,
  type SalesOrderResult,
  type SalesOrderStore,
  type SalesSettings,
} from "./order";

// ── Las dos operaciones ─────────────────────────────────────────────────────
//
// Guatemala es la que factura. Colombia todavía no opera y está aquí porque la
// validación es por país: es lo que hace demostrable que una dirección buena en
// un país falla contra la lista del otro.

const GUATEMALA = { id: "op-gt", countryCode: "GT", currency: "GTQ" };
const COLOMBIA = { id: "op-co", countryCode: "CO", currency: "COP" };

/** La tienda de una operación. Falla el test si la fábrica la rechaza. */
function tienda(
  operation: { id: string; countryCode: string; currency: string },
  shopDomain = `${operation.id}.myshopify.com`,
): SalesOrderStore {
  const store = salesOrderStore(operation, {
    operationId: operation.id,
    shopDomain,
  });
  if (!store) throw new Error(`la operación ${operation.id} no tiene tienda`);
  return store;
}

const TIENDA_GT = tienda(GUATEMALA);
const TIENDA_CO = tienda(COLOMBIA);

// ── Los datos de un cierre ──────────────────────────────────────────────────

const CONTACTO_GT: ClosingContact = {
  firstName: "María",
  lastName: "López",
  phone: "5555 1234",
  city: "Antigua Guatemala",
  division: "Sacatepéquez",
  address: "3a calle poniente 12, casa 4",
  pickupAtOffice: false,
  email: null,
};

const CONTACTO_CO: ClosingContact = {
  firstName: "Andrés",
  lastName: "Gómez",
  phone: "300 123 4567",
  city: "Medellín",
  division: "Antioquia",
  address: "Carrera 45 #12-30, apto 201",
  pickupAtOffice: false,
  email: null,
};

const LINEA = {
  productId: "gid://shopify/Product/1",
  variantId: "gid://shopify/ProductVariant/11" as string | null,
  title: "Colágeno Hidrolizado",
  quantity: 1,
  unitPrice: 300,
};

/** Un producto creado en el panel: sin variante, con precio propio. */
const LINEA_NATIVA = {
  productId: "8f6a0d2e-1111-4c3b-9e7a-000000000001",
  variantId: null,
  title: "REVITALHAIR Serum Capilar",
  quantity: 1,
  unitPrice: 349,
};

function cierre(overrides: Partial<SalesClosing> = {}): SalesClosing {
  return {
    leadRef: "conv-0001",
    contact: CONTACTO_GT,
    lines: [LINEA],
    discountPct: 0,
    ...overrides,
  };
}

/** Un cierre con un contacto modificado, que es lo que varía en casi todo test. */
function conContacto(overrides: Partial<ClosingContact>): SalesClosing {
  return cierre({ contact: { ...CONTACTO_GT, ...overrides } });
}

const SIN_DESCUENTO: SalesSettings = {
  discountLimitPct: 0,
  sellerName: "Sebastián",
};
const HASTA_20: SalesSettings = { discountLimitPct: 20, sellerName: "Sebastián" };

function construir(
  closing: SalesClosing,
  settings: SalesSettings = HASTA_20,
  store: SalesOrderStore = TIENDA_GT,
): SalesOrderResult {
  return buildSalesOrder({ store, closing, settings });
}

/** El pedido, o el fallo del test con los errores a la vista. */
function pedidoDe(result: SalesOrderResult) {
  if (!result.ok) {
    throw new Error(`se esperaba un pedido: ${JSON.stringify(result.errors)}`);
  }
  return result.order;
}

function erroresDe(result: SalesOrderResult): readonly SalesOrderError[] {
  if (result.ok) throw new Error("se esperaban errores y salió un pedido");
  return result.errors;
}

// ── Los caminos que sí construyen ───────────────────────────────────────────

describe("buildSalesOrder · el cierre completo", () => {
  it("con dirección sale un pedido contraentrega con envío a domicilio", () => {
    const order = pedidoDe(construir(cierre()));

    expect(order.shipping).toEqual({
      kind: "delivery",
      address: "3a calle poniente 12, casa 4",
      city: "Antigua Guatemala",
      division: "Sacatepéquez",
      countryCode: "GT",
    });
    expect(order.customer).toEqual({
      firstName: "María",
      lastName: "López",
      phone: "+50255551234",
      email: null,
    });
    expect(order.financialStatus).toBe("pending");
    expect(order.paymentMethod).toBe("cash_on_delivery");
    expect(order.lines).toEqual([
      {
        productId: LINEA.productId,
        variantId: LINEA.variantId,
        title: "Colágeno Hidrolizado",
        quantity: 1,
        listUnitPrice: 300,
        unitPrice: 300,
        lineTotal: 300,
      },
    ]);
  });

  it("con reclamo en oficina sale sin dirección y con su etiqueta", () => {
    const order = pedidoDe(
      construir(conContacto({ address: null, pickupAtOffice: true })),
    );

    expect(order.shipping).toEqual({
      kind: "pickup_at_office",
      city: "Antigua Guatemala",
      division: "Sacatepéquez",
      countryCode: "GT",
    });
    expect(order.tags).toContain(PICKUP_AT_OFFICE_TAG);
  });

  it("lleva las etiquetas de origen de ventas y de vendedor", () => {
    const order = pedidoDe(construir(cierre()));
    expect(order.tags).toEqual([SALES_ORDER_TAG, "vendedor:Sebastián"]);
  });

  it("guarda el nombre canónico del lugar, no lo que tecleó el cliente", () => {
    // «la antigua» y «sacatepequez» son lo que dice la gente; el pedido sale
    // con la ortografía oficial, y la venta no se cae por una tilde.
    const order = pedidoDe(
      construir(conContacto({ city: "la antigua", division: "sacatepequez" })),
    );
    expect(order.shipping.city).toBe("Antigua Guatemala");
    expect(order.shipping.division).toBe("Sacatepéquez");
  });

  it("el correo es opcional de verdad", () => {
    const con = pedidoDe(construir(conContacto({ email: "maria@vorare.gt" })));
    expect(con.customer.email).toBe("maria@vorare.gt");
    expect(pedidoDe(construir(cierre())).customer.email).toBeNull();
  });
});

// ── La moneda y la tienda salen de la operación ─────────────────────────────

describe("buildSalesOrder · la operación decide moneda y tienda", () => {
  it("el pedido guatemalteco va en quetzales y a la tienda guatemalteca", () => {
    const order = pedidoDe(construir(cierre()));
    expect(order.currency).toBe("GTQ");
    expect(order.store).toEqual({
      operationId: "op-gt",
      shopDomain: "op-gt.myshopify.com",
    });
  });

  it("el pedido colombiano va en pesos y a la tienda colombiana", () => {
    // Mismo constructor, misma llamada: la moneda no está escrita en ninguna
    // parte del módulo, sale de la operación.
    const order = pedidoDe(
      construir(cierre({ contact: CONTACTO_CO }), HASTA_20, TIENDA_CO),
    );
    expect(order.currency).toBe("COP");
    expect(order.store.shopDomain).toBe("op-co.myshopify.com");
  });

  it("una tienda que es de otra operación no se puede fabricar", () => {
    // El error más caro del módulo —despachar al país equivocado— no llega a
    // ser un error de validación: el valor no existe, así que la llamada al
    // constructor no se puede ni escribir.
    expect(
      salesOrderStore(GUATEMALA, {
        operationId: COLOMBIA.id,
        shopDomain: "op-co.myshopify.com",
      }),
    ).toBeNull();
  });

  it("una operación sin conexión de tienda tampoco produce tienda", () => {
    // Es el estado de hoy en producción: `shopify_connection` está vacía.
    expect(salesOrderStore(GUATEMALA, null)).toBeNull();
    expect(
      salesOrderStore(GUATEMALA, { operationId: GUATEMALA.id, shopDomain: "" }),
    ).toBeNull();
  });

  it("una operación sin moneda no produce tienda: no hay moneda por defecto", () => {
    expect(
      salesOrderStore(
        { ...GUATEMALA, currency: "  " },
        { operationId: GUATEMALA.id, shopDomain: "x.myshopify.com" },
      ),
    ).toBeNull();
  });
});

// ── Los errores de validación ───────────────────────────────────────────────

describe("buildSalesOrder · los seis requeridos", () => {
  it("un campo requerido faltante impide el pedido y dice cuál", () => {
    expect(erroresDe(construir(conContacto({ lastName: null })))).toEqual([
      { code: "missing_required", field: "lastName" },
    ]);
  });

  it("un requerido en blanco cuenta como faltante", () => {
    expect(erroresDe(construir(conContacto({ firstName: "   " })))).toEqual([
      { code: "missing_required", field: "firstName" },
    ]);
  });

  it("salen todos los que faltan a la vez, no el primero", () => {
    // El vendedor tiene que poder pedir de una vez todo lo que falta, no
    // arrastrar al cliente por una corrección por mensaje.
    const errors = erroresDe(
      construir(conContacto({ firstName: null, phone: null, city: null })),
    );
    expect(errors).toEqual([
      { code: "missing_required", field: "firstName" },
      { code: "missing_required", field: "phone" },
      { code: "missing_required", field: "city" },
    ]);
  });

  it("sin dirección ni reclamo en oficina falta el sexto requerido", () => {
    expect(
      erroresDe(construir(conContacto({ address: null, pickupAtOffice: false }))),
    ).toEqual([{ code: "missing_required", field: "addressOrPickup" }]);
  });

  it("dirección y reclamo en oficina coexistiendo es un error, no una preferencia", () => {
    // No se resuelve eligiendo uno: el cliente dijo dos cosas distintas y hay
    // que preguntarle cuál.
    expect(
      erroresDe(
        construir(
          conContacto({ address: "3a calle poniente 12", pickupAtOffice: true }),
        ),
      ),
    ).toEqual([{ code: "address_and_pickup_conflict" }]);
  });

  it("un cierre sin líneas no es un pedido", () => {
    expect(erroresDe(construir(cierre({ lines: [] })))).toEqual([
      { code: "no_lines" },
    ]);
  });

  it("una cantidad que no es un entero positivo señala su línea", () => {
    expect(
      erroresDe(construir(cierre({ lines: [{ ...LINEA, quantity: 0 }] }))),
    ).toEqual([{ code: "line_invalid", index: 0, reason: "quantity" }]);
  });
});

describe("buildSalesOrder · teléfono y lugar contra el país de la operación", () => {
  it("un teléfono con formato inválido para el país impide el pedido", () => {
    expect(erroresDe(construir(conContacto({ phone: "12345" })))).toEqual([
      { code: "phone_invalid", value: "12345" },
    ]);
  });

  it("una ciudad que no existe en el país impide el pedido", () => {
    expect(erroresDe(construir(conContacto({ city: "Zona 10" })))).toEqual([
      { code: "city_unknown", value: "Zona 10" },
    ]);
  });

  it("un departamento que no existe en el país impide el pedido", () => {
    const errors = erroresDe(construir(conContacto({ division: "Antioquia" })));
    expect(errors).toContainEqual({
      code: "division_unknown",
      value: "Antioquia",
    });
  });

  it("una ciudad real en el departamento equivocado dice dónde sí está", () => {
    // La confusión de verdad: Antigua Guatemala es de Sacatepéquez, y mucha
    // gente pone «Guatemala» de departamento. Se puede repreguntar con
    // precisión en vez de volver a pedir la dirección entera.
    expect(erroresDe(construir(conContacto({ division: "Guatemala" })))).toEqual([
      {
        code: "city_in_other_division",
        value: "Antigua Guatemala",
        divisions: ["Sacatepéquez"],
      },
    ]);
  });

  it("una operación cuyo país no tiene listas no valida contra las del vecino", () => {
    // El día que se abra un tercer país antes de que existan sus listas: el
    // constructor lo dice en vez de medir la dirección con la regla equivocada.
    const mexico = tienda({ id: "op-mx", countryCode: "MX", currency: "MXN" });
    expect(erroresDe(construir(cierre(), HASTA_20, mexico))).toEqual([
      { code: "country_unsupported", countryCode: "MX" },
    ]);
  });

  it("una dirección colombiana válida falla contra la lista de Guatemala", () => {
    // El test que exige el ticket. El mismo cierre que construye un pedido en
    // la operación colombiana no construye nada en la guatemalteca: teléfono,
    // ciudad y departamento son de otro país.
    expect(
      construir(cierre({ contact: CONTACTO_CO }), HASTA_20, TIENDA_CO).ok,
    ).toBe(true);

    expect(erroresDe(construir(cierre({ contact: CONTACTO_CO })))).toEqual([
      { code: "phone_invalid", value: "300 123 4567" },
      { code: "division_unknown", value: "Antioquia" },
      { code: "city_unknown", value: "Medellín" },
    ]);
  });

  it("y al revés: una dirección guatemalteca válida falla contra la de Colombia", () => {
    expect(
      erroresDe(construir(cierre(), HASTA_20, TIENDA_CO)),
    ).toEqual([
      { code: "phone_invalid", value: "5555 1234" },
      { code: "division_unknown", value: "Sacatepéquez" },
      { code: "city_unknown", value: "Antigua Guatemala" },
    ]);
  });
});

// ── El descuento ────────────────────────────────────────────────────────────

describe("buildSalesOrder · el clamp del descuento", () => {
  it("un descuento dentro del límite se aplica tal cual y no señala clamp", () => {
    const result = construir(cierre({ discountPct: 10 }), HASTA_20);
    const order = pedidoDe(result);

    expect(result.ok && result.discount).toEqual({
      requestedPct: 10,
      appliedPct: 10,
      limitPct: 20,
      clamped: false,
    });
    expect(order.lines[0]?.unitPrice).toBe(270);
    expect(order.totals).toEqual({ subtotal: 300, discount: 30, total: 270 });
  });

  it("un descuento por encima del límite sale clampeado y señalado", () => {
    // Nunca falla la construcción por descuento: el pedido se crea al precio
    // bueno y el resultado avisa para que el orquestador escale.
    const result = construir(cierre({ discountPct: 45 }), HASTA_20);
    const order = pedidoDe(result);

    expect(result.ok && result.discount).toEqual({
      requestedPct: 45,
      appliedPct: 20,
      limitPct: 20,
      clamped: true,
    });
    expect(order.lines[0]?.unitPrice).toBe(240);
    expect(order.totals.total).toBe(240);
  });

  it("con el límite en cero, un descuento pactado también clampea", () => {
    // Cero es el valor por defecto de la tabla y prohíbe descuentos.
    const result = construir(cierre({ discountPct: 15 }), SIN_DESCUENTO);
    const order = pedidoDe(result);

    expect(result.ok && result.discount).toEqual({
      requestedPct: 15,
      appliedPct: 0,
      limitPct: 0,
      clamped: true,
    });
    expect(order.totals).toEqual({ subtotal: 300, discount: 0, total: 300 });
  });

  it("el clamp se aplica a todas las líneas y a la cantidad de cada una", () => {
    const order = pedidoDe(
      construir(
        cierre({
          discountPct: 50,
          lines: [
            { ...LINEA, quantity: 2 },
            { ...LINEA, variantId: "v-22", unitPrice: 150, quantity: 1 },
          ],
        }),
        HASTA_20,
      ),
    );
    expect(order.lines.map((l) => l.lineTotal)).toEqual([480, 120]);
    expect(order.totals).toEqual({ subtotal: 750, discount: 150, total: 600 });
  });

  it("un descuento negativo no sube el precio", () => {
    const result = construir(cierre({ discountPct: -30 }), HASTA_20);
    expect(result.ok && result.discount.appliedPct).toBe(0);
    expect(pedidoDe(result).totals.total).toBe(300);
  });
});

// ── La idempotencia ─────────────────────────────────────────────────────────

describe("buildSalesOrder · la llave de idempotencia", () => {
  it("dos construcciones del mismo cierre dan la misma llave", () => {
    // Es lo que impide dos envíos contraentrega del mismo producto al mismo
    // cliente. Ni el instante ni un aleatorio entran en la llave.
    const primera = pedidoDe(construir(cierre()));
    const segunda = pedidoDe(construir(cierre()));
    expect(primera.idempotencyKey).toBe(segunda.idempotencyKey);
  });

  it("no cambia porque cambien el descuento aplicado o los datos personales", () => {
    // El reintento de un cierre al que se le corrigió un dígito del teléfono es
    // el mismo pedido, no uno nuevo.
    const base = pedidoDe(construir(cierre()));
    const corregido = pedidoDe(
      construir(
        cierre({
          contact: { ...CONTACTO_GT, phone: "4444 9999", email: "m@vorare.gt" },
          discountPct: 15,
        }),
      ),
    );
    expect(corregido.idempotencyKey).toBe(base.idempotencyKey);
  });

  it("no cambia porque el vendedor agregue las líneas en otro orden", () => {
    const lineas = [LINEA, { ...LINEA, variantId: "v-22", unitPrice: 150 }];
    const enOrden = pedidoDe(construir(cierre({ lines: lineas })));
    const alReves = pedidoDe(construir(cierre({ lines: [...lineas].reverse() })));
    expect(alReves.idempotencyKey).toBe(enOrden.idempotencyKey);
  });

  it("otro lead da otra llave", () => {
    const uno = pedidoDe(construir(cierre()));
    const otro = pedidoDe(construir(cierre({ leadRef: "conv-0002" })));
    expect(otro.idempotencyKey).not.toBe(uno.idempotencyKey);
  });

  it("la recompra del mismo cliente con otro producto da otra llave", () => {
    // Hay una conversación por contacto para siempre: una llave que fuera solo
    // del lead bloquearía la segunda compra de ese cliente para siempre.
    const primera = pedidoDe(construir(cierre()));
    const recompra = pedidoDe(
      construir(cierre({ lines: [{ ...LINEA, variantId: "v-99" }] })),
    );
    expect(recompra.idempotencyKey).not.toBe(primera.idempotencyKey);
  });
});

describe("buildSalesOrder · un producto que no está en la tienda", () => {
  it("se puede vender: la línea sale sin variante y con su precio", () => {
    const order = pedidoDe(construir(cierre({ lines: [LINEA_NATIVA] })));
    expect(order.lines).toEqual([
      {
        productId: LINEA_NATIVA.productId,
        variantId: null,
        title: "REVITALHAIR Serum Capilar",
        quantity: 1,
        listUnitPrice: 349,
        unitPrice: 349,
        lineTotal: 349,
      },
    ]);
    expect(order.totals.total).toBe(349);
  });

  it("el pedido lleva la etiqueta que avisa que hay algo fuera del catálogo", () => {
    const order = pedidoDe(construir(cierre({ lines: [LINEA_NATIVA] })));
    expect(order.tags).toContain(OFF_CATALOG_TAG);
  });

  it("basta una línea suelta entre varias para que el pedido quede marcado", () => {
    const order = pedidoDe(construir(cierre({ lines: [LINEA, LINEA_NATIVA] })));
    expect(order.tags).toContain(OFF_CATALOG_TAG);
  });

  it("un pedido enteramente de la tienda no lleva esa etiqueta", () => {
    expect(pedidoDe(construir(cierre())).tags).not.toContain(OFF_CATALOG_TAG);
  });

  it("el descuento se le aplica igual que a cualquier otra línea", () => {
    const order = pedidoDe(
      construir(cierre({ lines: [LINEA_NATIVA], discountPct: 10 })),
    );
    expect(order.lines[0]?.unitPrice).toBe(314.1);
  });
});

describe("la llave de idempotencia con productos que no están en la tienda", () => {
  it("dos disparos del mismo cierre nativo dan la misma llave", () => {
    const primera = pedidoDe(construir(cierre({ lines: [LINEA_NATIVA] })));
    const segunda = pedidoDe(construir(cierre({ lines: [LINEA_NATIVA] })));
    expect(segunda.idempotencyKey).toBe(primera.idempotencyKey);
  });

  it("dos productos nativos distintos dan llaves distintas", () => {
    // Sin variante, lo que distingue una compra de otra es el producto. Si no
    // entrara, la recompra de otro producto nativo colisionaría con la primera
    // y la segunda venta no se crearía nunca.
    const uno = pedidoDe(construir(cierre({ lines: [LINEA_NATIVA] })));
    const otro = pedidoDe(
      construir(
        cierre({
          lines: [{ ...LINEA_NATIVA, productId: "8f6a0d2e-1111-4c3b-9e7a-000000000002" }],
        }),
      ),
    );
    expect(otro.idempotencyKey).not.toBe(uno.idempotencyKey);
  });

  it("un producto de la tienda y uno nativo no comparten llave", () => {
    const tienda = pedidoDe(construir(cierre({ lines: [LINEA] })));
    const nativo = pedidoDe(construir(cierre({ lines: [LINEA_NATIVA] })));
    expect(nativo.idempotencyKey).not.toBe(tienda.idempotencyKey);
  });

  it("la llave de un pedido de la tienda es la misma de siempre", () => {
    // Es la no-regresión de este ticket sobre la parte que va a mover el
    // volumen. El valor está fijado a mano y **se calculó con la fórmula de
    // antes del ticket, leída de git**, no copiado de esta implementación: así
    // el test falla si el carrito cambia de forma, que es lo que dejaría un
    // pedido ya creado sin poder reconocerse y produciría el duplicado.
    const order = pedidoDe(construir(cierre()));
    expect(order.idempotencyKey).toBe("ventas-4fe6205f54e99cee46baa81f");
  });
});
