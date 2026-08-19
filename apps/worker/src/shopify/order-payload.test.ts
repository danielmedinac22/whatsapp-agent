import { describe, expect, it } from "vitest";
import {
  buildSalesOrder,
  salesOrderStore,
  type SalesClosing,
  type SalesOrderDraft,
  type SalesOrderStore,
} from "../sales/order";
import {
  buildOrderCreateVariables,
  COD_LABEL,
  idempotencyTagQuery,
  PICKUP_ADDRESS_LINE,
} from "./order-payload";

/**
 * El payload se prueba contra pedidos **reales del constructor de orden**, no
 * contra objetos escritos a mano. Si se escribieran a mano, este archivo
 * seguiría verde el día que el constructor cambie la forma del pedido, y lo que
 * saldría hacia la tienda sería otra cosa.
 */

const GUATEMALA = { id: "op-gt", countryCode: "GT", currency: "GTQ" };

function tienda(): SalesOrderStore {
  const store = salesOrderStore(GUATEMALA, {
    operationId: GUATEMALA.id,
    shopDomain: "vorare.myshopify.com",
  });
  if (!store) throw new Error("la operación de prueba no tiene tienda");
  return store;
}

const LINEA = {
  productId: "gid://shopify/Product/1",
  variantId: "gid://shopify/ProductVariant/11" as string | null,
  title: "Colágeno Hidrolizado",
  quantity: 2,
  unitPrice: 300,
};

/**
 * Un producto **creado en el panel**: no existe en la tienda, así que no tiene
 * variante y su precio es el que un admin escribió (`ventas-panel/05`).
 */
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
    contact: {
      firstName: "María",
      lastName: "López",
      phone: "5555 1234",
      city: "Antigua Guatemala",
      division: "Sacatepéquez",
      address: "3a calle poniente 12, casa 4",
      pickupAtOffice: false,
      email: null,
    },
    lines: [LINEA],
    discountPct: 0,
    ...overrides,
  };
}

function pedido(
  closing: SalesClosing = cierre(),
  discountLimitPct = 20,
): SalesOrderDraft {
  const result = buildSalesOrder({
    store: tienda(),
    closing,
    settings: { discountLimitPct, sellerName: "Sebastián" },
  });
  if (!result.ok) {
    throw new Error(`se esperaba un pedido: ${JSON.stringify(result.errors)}`);
  }
  return result.order;
}

describe("buildOrderCreateVariables · lo que sale hacia la tienda", () => {
  it("el pedido va contraentrega, en la moneda de la operación", () => {
    const { order } = buildOrderCreateVariables(pedido());
    expect(order.currency).toBe("GTQ");
    // Pendiente = el cobro no ocurrió; ocurre al entregar.
    expect(order.financialStatus).toBe("PENDING");
    expect(order.customAttributes).toContainEqual({
      key: "Método de pago",
      value: COD_LABEL,
    });
  });

  it("cada línea lleva su variante, su cantidad y su precio ya pactado", () => {
    const { order } = buildOrderCreateVariables(pedido());
    expect(order.lineItems).toEqual([
      {
        variantId: "gid://shopify/ProductVariant/11",
        quantity: 2,
        title: "Colágeno Hidrolizado",
        priceSet: { shopMoney: { amount: "300.00", currencyCode: "GTQ" } },
      },
    ]);
  });

  it("el descuento viaja en el precio de la línea, no como descuento aparte", () => {
    // Mandarlo además como objeto de descuento lo aplicaría dos veces: el
    // cliente pagaría menos de lo pactado y el margen se iría sin que nadie lo
    // decidiera.
    const { order } = buildOrderCreateVariables(
      pedido(cierre({ discountPct: 10 })),
    );
    expect(order.lineItems[0]?.priceSet.shopMoney.amount).toBe("270.00");
    // Y el precio de lista queda escrito donde un humano lo puede leer.
    expect(order.note).toContain("600");
    expect(order.note).toContain("540");
  });

  it("la llave de idempotencia viaja como etiqueta, junto a las de origen", () => {
    const draft = pedido();
    const { order } = buildOrderCreateVariables(draft);
    expect(order.tags).toContain("origen-ventas");
    expect(order.tags).toContain("vendedor:Sebastián");
    expect(order.tags).toContain(draft.idempotencyKey);
    // Las etiquetas son el único campo del pedido que la tienda sabe buscar:
    // guardarla donde no se puede buscar sería tenerla y no poder preguntar
    // «¿este cierre ya creó su pedido?».
    expect(order.tags[order.tags.length - 1]).toBe(draft.idempotencyKey);
  });

  it("la llave cabe en una etiqueta y no necesita escaparse", () => {
    const draft = pedido();
    expect(draft.idempotencyKey.length).toBeLessThanOrEqual(40);
    expect(draft.idempotencyKey).toMatch(/^[a-z0-9-]+$/);
  });

  it("la dirección de envío lleva municipio y departamento canónicos", () => {
    const { order } = buildOrderCreateVariables(pedido());
    expect(order.shippingAddress).toEqual({
      firstName: "María",
      lastName: "López",
      phone: "+50255551234",
      address1: "3a calle poniente 12, casa 4",
      city: "Antigua Guatemala",
      province: "Sacatepéquez",
      countryCode: "GT",
    });
  });

  it("el reclamo en oficina queda legible en la dirección y en la nota", () => {
    // La API pide una línea de dirección y el cliente por definición no dio
    // una. Dejarla vacía haría que en la tienda —y de ahí en logística— el
    // pedido se viera como una dirección incompleta, que es lo que un asesor
    // persigue por teléfono.
    const { order } = buildOrderCreateVariables(
      pedido(
        cierre({
          contact: {
            ...cierre().contact,
            address: null,
            pickupAtOffice: true,
          },
        }),
      ),
    );
    expect(order.shippingAddress.address1).toBe(PICKUP_ADDRESS_LINE);
    expect(order.tags).toContain("reclamo-en-oficina");
    expect(order.note).toContain("reclama en la oficina");
  });

  it("sin correo, el campo no se manda vacío: no se manda", () => {
    const { order } = buildOrderCreateVariables(pedido());
    expect(order).not.toHaveProperty("email");
  });

  it("con correo, el campo va", () => {
    const { order } = buildOrderCreateVariables(
      pedido(
        cierre({
          contact: { ...cierre().contact, email: "maria@ejemplo.com" },
        }),
      ),
    );
    expect(order.email).toBe("maria@ejemplo.com");
  });

  it("la tienda no le escribe al cliente: de eso se encarga la conversación", () => {
    // Muchos de estos clientes ni siquiera dan correo, y el que sí lo da ya
    // recibe el aviso en el mismo chat donde acaba de comprar.
    const { options } = buildOrderCreateVariables(pedido());
    expect(options.sendReceipt).toBe(false);
    expect(options.sendFulfillmentReceipt).toBe(false);
  });

  it("el inventario se mueve igual que en un pedido de la tienda", () => {
    const { options } = buildOrderCreateVariables(pedido());
    expect(options.inventoryBehaviour).toBe("DECREMENT_OBEYING_POLICY");
  });
});

describe("idempotencyTagQuery · buscar el pedido de un cierre", () => {
  it("la llave va entre comillas para que no se parta en dos términos", () => {
    // Sin comillas, `ventas-abc123` buscaría dos términos y podría traer un
    // pedido ajeno — que leído como «este cierre ya existe» sería una venta que
    // nunca se crea.
    expect(idempotencyTagQuery("ventas-abc123")).toBe("tag:'ventas-abc123'");
  });

  it("una comilla en la llave no puede romper la consulta", () => {
    expect(idempotencyTagQuery("ventas-a'b")).toBe("tag:'ventas-ab'");
  });
});

describe("buildOrderCreateVariables · un producto que la tienda no tiene", () => {
  it("entra como línea suelta: con título y precio, y sin variante", () => {
    const { order } = buildOrderCreateVariables(
      pedido(cierre({ lines: [LINEA_NATIVA] })),
    );
    const [linea] = order.lineItems;
    expect(linea).toEqual({
      quantity: 1,
      title: "REVITALHAIR Serum Capilar",
      priceSet: { shopMoney: { amount: "349.00", currencyCode: "GTQ" } },
      requiresShipping: true,
    });
    // Que **no** lleve variante es el criterio: mandar una inventada crearía el
    // pedido contra un producto que no es.
    expect(linea && "variantId" in linea).toBe(false);
  });

  it("el pedido queda marcado con una etiqueta que se puede buscar", () => {
    // Logística tiene que poder listar los pedidos con algo fuera del catálogo:
    // ese renglón no tiene SKU ni sale en los informes por producto.
    const { order } = buildOrderCreateVariables(
      pedido(cierre({ lines: [LINEA_NATIVA] })),
    );
    expect(order.tags).toContain("producto-fuera-de-la-tienda");
  });

  it("la nota dice cuál de los productos no está en la tienda", () => {
    const { order } = buildOrderCreateVariables(
      pedido(cierre({ lines: [LINEA, LINEA_NATIVA] })),
    );
    expect(order.note).toContain("REVITALHAIR Serum Capilar");
    expect(order.note).toContain("Sin SKU");
    // Y no nombra el que sí está: quien despacha no tiene que dudar de ese.
    expect(order.note).not.toContain("Colágeno Hidrolizado");
  });

  it("un pedido enteramente de la tienda sale exactamente como antes", () => {
    const { order } = buildOrderCreateVariables(pedido());
    expect(order.tags).not.toContain("producto-fuera-de-la-tienda");
    expect(order.note).not.toContain("línea suelta");
    expect(order.lineItems[0]).not.toHaveProperty("requiresShipping");
  });
});
