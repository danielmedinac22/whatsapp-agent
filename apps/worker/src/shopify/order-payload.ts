/**
 * Del pedido que construyó `sales/order.ts` al cuerpo exacto que espera la API
 * de administración de la tienda.
 *
 * Todo lo de este archivo es PURO: no toca la red ni la base. Es a propósito y
 * es lo que hace que este ticket se pueda terminar y probar **sin credenciales
 * de la tienda**, que hoy no existen (`shopify_connection` tiene cero filas).
 * Lo que se prueba es qué payload sale dada una entrada, que es lo que el spec
 * pide; que la llamada salga por el cable es orquestación y no se prueba acá.
 *
 * ## La etiqueta que hace idempotente la creación
 *
 * `sales/order.ts` deriva una llave del lead y de lo que compró. Esa llave
 * **viaja como una etiqueta más del pedido**, y no como una nota ni un atributo
 * de más: las etiquetas son el único campo de un pedido que la API sabe
 * **buscar** (`tag:...`). Guardarla donde no se puede buscar sería tenerla y no
 * poder preguntar «¿este cierre ya creó su pedido?», que es justo la pregunta
 * que evita dos envíos contraentrega del mismo producto al mismo cliente.
 *
 * La llave sale de `sales/order.ts` con la forma `ventas-` + 24 hexadecimales:
 * 31 caracteres, por debajo del límite de 40 por etiqueta, y sin dos puntos ni
 * comillas — nada que la sintaxis de búsqueda de la tienda tenga que escapar.
 *
 * ## Un producto que la tienda no conoce entra como línea suelta
 *
 * La mitad **nativa** del catálogo existe para vender algo que todavía no está
 * en la tienda (`ventas-panel/02`), así que al llegar acá no tiene variante:
 * `line.variantId` es `null`. La API de la tienda ya tiene forma para eso — una
 * línea con **título y precio y sin variante**— y es la que se usa. Las otras
 * dos opciones se descartaron: crear el producto en Shopify al vuelo pediría
 * `write_products`, que es el permiso de más que el ticket 01 prohíbe, y además
 * convertiría una venta en un alta de catálogo que nadie revisó; y colgar el
 * importe de un producto genérico —«producto varios»— dejaría el pedido sin
 * decir qué se vendió, que es lo único que logística necesita leer.
 *
 * **Qué cambia para quien recibe el pedido, y cómo se entera.** Ese renglón no
 * tiene SKU, no descuenta inventario —no hay inventario que descontar— y no
 * aparece en los informes por producto de la tienda. Para que eso no se
 * descubra en la bodega, el pedido sale marcado por dos vías que se
 * complementan: la etiqueta `OFF_CATALOG_TAG` de `sales/order.ts`, que es
 * **buscable**
 * (`tag:'producto-fuera-de-la-tienda'`) y sirve para listarlos, y una línea de
 * la nota que dice **cuál** de los renglones es y por qué. Y lleva
 * `requiresShipping: true`, porque una línea suelta no lo hereda de ninguna
 * variante y sin eso el pedido podría verse como si no hubiera nada que
 * despachar — que es lo contrario de lo que pasa: hay una caja y un cobro
 * contraentrega.
 *
 * ## Lo que este mapeo NO hace
 *
 * **No manda el descuento como descuento.** Las líneas ya vienen con el precio
 * pactado y clampeado, así que el precio de la línea *es* el precio acordado.
 * Mandar además un objeto de descuento lo aplicaría dos veces. Lo que se pierde
 * —ver el precio de lista al lado del pactado— se recupera en la nota del
 * pedido, que se escribe para que un humano la lea.
 *
 * **No crea ni asocia un cliente de la tienda.** El pedido va con teléfono,
 * correo si lo hay, y la dirección de envío a nombre del cliente, que es lo que
 * el receptor del webhook usa para encontrarlo (`customer.phone ?? phone ??
 * shipping_address.phone`) y lo que la plantilla de confirmación necesita
 * (`extractOrderVariables` cae al nombre de la dirección de envío cuando no hay
 * cliente). Pedir `read_customers`/`write_customers` para no ganar nada sería
 * exactamente el permiso de más que el ticket 01 prohíbe.
 */

import type { SalesOrderDraft } from "../sales/order";

/**
 * Lo que se escribe en la dirección de envío cuando el cliente reclama en la
 * oficina de la transportadora.
 *
 * La API pide una línea de dirección y el cliente por definición no dio una.
 * Dejarla vacía haría que en la tienda —y de ahí en logística— el pedido se
 * viera como una dirección incompleta, que es lo que un asesor persigue por
 * teléfono. Con la etiqueta `reclamo-en-oficina` que ya trae el pedido, esto lo
 * vuelve legible en las dos partes.
 */
export const PICKUP_ADDRESS_LINE = "Reclama en oficina";

/** El nombre del método de pago tal como queda escrito en el pedido. */
export const COD_LABEL = "Contraentrega";

/**
 * La consulta que busca el pedido de un cierre por su llave.
 *
 * Va entre comillas simples porque la llave lleva un guion y la sintaxis de
 * búsqueda de la tienda parte por caracteres no alfanuméricos: sin comillas,
 * `ventas-abc123` buscaría dos términos y traería pedidos ajenos. Un pedido
 * ajeno leído como «este cierre ya existe» sería una venta que nunca se crea.
 */
export function idempotencyTagQuery(idempotencyKey: string): string {
  return `tag:'${idempotencyKey.replace(/'/g, "")}'`;
}

/** El pedido, tal como lo espera la mutación. Los nombres son los de la API. */
export interface OrderCreateInput {
  currency: string;
  email?: string;
  phone: string;
  financialStatus: "PENDING";
  tags: string[];
  note: string;
  customAttributes: Array<{ key: string; value: string }>;
  lineItems: Array<{
    /** Ausente en una línea suelta: el producto no está en la tienda. */
    variantId?: string;
    quantity: number;
    title: string;
    priceSet: { shopMoney: { amount: string; currencyCode: string } };
    /**
     * Solo en las líneas sueltas. Una línea con variante lo hereda de ella y
     * mandarlo cambiaría el comportamiento de los pedidos que hoy funcionan.
     */
    requiresShipping?: boolean;
  }>;
  shippingAddress: {
    firstName: string;
    lastName: string;
    phone: string;
    address1: string;
    city: string;
    provinceCode?: string;
    province: string;
    countryCode: string;
  };
}

export interface OrderCreateOptions {
  /**
   * Igual que un pedido de la tienda: descuenta inventario respetando la
   * política de la tienda. Es el comportamiento de los 1.732 pedidos que ya
   * entran por el formulario de contraentrega, y elegir otro haría que las
   * ventas del vendedor movieran el stock distinto que las demás.
   */
  inventoryBehaviour: "DECREMENT_OBEYING_POLICY";
  /**
   * La tienda **no** le escribe al cliente. Quien le avisa que su pedido quedó
   * registrado es la conversación, en el mismo hilo donde acaba de comprar.
   * Muchos de estos clientes ni siquiera dan correo.
   */
  sendReceipt: false;
  sendFulfillmentReceipt: false;
}

export interface OrderCreateVariables {
  order: OrderCreateInput;
  options: OrderCreateOptions;
}

/**
 * Una nota que un humano pueda leer en el panel de la tienda.
 *
 * Dice de dónde vino el pedido y, cuando hubo descuento, cuál era el precio de
 * lista — la información que el mapeo no manda como objeto de descuento para
 * no aplicarlo dos veces. Sin esto, un pedido con 15% pactado se ve en la
 * tienda como un pedido con precios raros y sin explicación.
 */
function orderNote(draft: SalesOrderDraft): string {
  const lines = [`Pedido tomado por el vendedor en WhatsApp. Pago: ${COD_LABEL}.`];
  if (draft.totals.discount > 0) {
    lines.push(
      `Precio de lista ${draft.totals.subtotal} ${draft.currency} · descuento aplicado ${draft.totals.discount} ${draft.currency} · total ${draft.totals.total} ${draft.currency}.`,
    );
  }
  // Cuáles de los renglones no están en la tienda, por su nombre. La etiqueta
  // sirve para encontrar el pedido; esto es lo que quien lo despacha necesita
  // leer, y por eso nombra las líneas en vez de decir «tiene una».
  const sueltas = draft.lines.filter((l) => l.variantId === null);
  if (sueltas.length > 0) {
    lines.push(
      `${sueltas.length === 1 ? "Este producto no está" : "Estos productos no están"} en la tienda y ${sueltas.length === 1 ? "va" : "van"} como línea suelta, con el precio del panel: ${sueltas
        .map((l) => l.title)
        .join(", ")}. Sin SKU y sin descuento de inventario.`,
    );
  }
  if (draft.shipping.kind === "pickup_at_office") {
    lines.push("El cliente reclama en la oficina de la transportadora.");
  }
  return lines.join("\n");
}

function shippingAddressOf(
  draft: SalesOrderDraft,
): OrderCreateInput["shippingAddress"] {
  const s = draft.shipping;
  return {
    firstName: draft.customer.firstName,
    lastName: draft.customer.lastName,
    phone: draft.customer.phone,
    address1: s.kind === "delivery" ? s.address : PICKUP_ADDRESS_LINE,
    city: s.city,
    province: s.division,
    countryCode: s.countryCode,
  };
}

/**
 * El cuerpo de la creación, listo para mandar.
 *
 * Recibe el pedido ya validado y clampeado: si llegó hasta acá es porque el
 * constructor de orden dijo que sí, así que este mapeo no valida nada y no
 * puede fallar. Es la propiedad que lo hace probable con fixtures.
 */
export function buildOrderCreateVariables(
  draft: SalesOrderDraft,
): OrderCreateVariables {
  return {
    order: {
      currency: draft.currency,
      ...(draft.customer.email ? { email: draft.customer.email } : {}),
      phone: draft.customer.phone,
      financialStatus: "PENDING",
      // La llave va al final: las etiquetas de origen y vendedor son las que un
      // humano lee en la tienda, y la llave es maquinaria.
      tags: [...draft.tags, draft.idempotencyKey],
      note: orderNote(draft),
      customAttributes: [
        { key: "Método de pago", value: COD_LABEL },
        { key: "Origen", value: "Venta por WhatsApp" },
      ],
      lineItems: draft.lines.map((line) => ({
        // Con variante, la línea es la de siempre. Sin ella —producto nativo—
        // sale suelta: el título y el precio ya venían en las dos, así que lo
        // único que cambia es que no se manda variante y que hay que decir que
        // se despacha.
        ...(line.variantId === null
          ? { requiresShipping: true }
          : { variantId: line.variantId }),
        quantity: line.quantity,
        title: line.title,
        priceSet: {
          shopMoney: {
            amount: line.unitPrice.toFixed(2),
            currencyCode: draft.currency,
          },
        },
      })),
      shippingAddress: shippingAddressOf(draft),
    },
    options: {
      inventoryBehaviour: "DECREMENT_OBEYING_POLICY",
      sendReceipt: false,
      sendFulfillmentReceipt: false,
    },
  };
}
