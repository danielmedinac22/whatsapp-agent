/**
 * La creación del pedido en la tienda. **Es el único punto del sistema que
 * escribe en un sistema externo del cliente.**
 *
 * Tres cosas lo gobiernan, y ninguna es opcional:
 *
 * 1. **Se lee antes de escribir.** Antes de crear se busca el pedido por la
 *    llave de idempotencia del cierre. Si ya existe, no se crea otro. Y si la
 *    búsqueda **falla**, tampoco se crea: no saber si ya existe no es lo mismo
 *    que saber que no existe, y confundirlos manda dos envíos contraentrega del
 *    mismo producto al mismo cliente. Es la regla de lectura del proyecto —una
 *    consulta que falla no es un dato que no existe— aplicada donde cuesta
 *    plata.
 * 2. **El modo seco manda.** Apagado por defecto (`write-mode.ts`). Con el modo
 *    seco puesto se hace todo salvo la mutación: se resuelve la tienda, se
 *    arma el payload, se comprueba en lectura, y se devuelve qué habría salido.
 *    **Ni una escritura.**
 * 3. **La tienda de la operación, o ninguna.** La tienda llega dentro del
 *    {@link SalesOrderDraft}, que solo se puede fabricar con una conexión que
 *    pertenece a esa operación. Acá se vuelve a comprobar contra la conexión
 *    viva antes de mandar, porque entre construir y crear puede haber pasado un
 *    reintento de veinticuatro horas y alguien pudo cambiar la conexión en el
 *    panel. Un pedido guatemalteco creado en la tienda colombiana es el error
 *    más caro que este módulo puede cometer: despacha al país equivocado.
 *
 * La orquestación con efectos no se prueba con tests unitarios, en línea con la
 * convención del repo. Lo que sí está probado es todo lo que decide: el mapeo
 * del payload (`order-payload.ts`), la clasificación del fallo (`failure.ts`) y
 * el interruptor (`write-mode.ts`).
 */

import type { Operation } from "@wa/db";
import { logger } from "../lib/logger";
import type { SalesOrderDraft } from "../sales/order";
import { adminEndpoint, getShopifyConnection } from "./admin";
import { adminTokenFor, storeCredential } from "./token";
import {
  buildOrderCreateVariables,
  idempotencyTagQuery,
  type OrderCreateVariables,
} from "./order-payload";
import {
  classifyStoreFailure,
  unexpectedFailure,
  type StoreFailure,
} from "./failure";
import { storeWriteMode, type StoreWriteMode } from "./write-mode";

/** Un pedido que existe en la tienda. */
export interface StoreOrderRef {
  /** El id global de la tienda (`gid://shopify/Order/...`). */
  id: string;
  /** El número visible: `#1042`. Es lo que se le dice al cliente y al equipo. */
  name: string;
}

/**
 * Cómo terminó el intento. Es una unión y no un booleano con excepciones
 * porque cada caso se atiende distinto, y el compilador lo tiene que exigir:
 * `already_exists` es un éxito, `dry_run` no es un fallo, `not_connected` es el
 * estado normal de hoy, y `failed` se parte según se reintente o no.
 */
export type StoreOrderOutcome =
  | { kind: "created"; order: StoreOrderRef; shopDomain: string }
  /** El cierre ya había creado su pedido. Un segundo disparo no crea otro. */
  | { kind: "already_exists"; order: StoreOrderRef; shopDomain: string }
  /** El modo seco. Se devuelve lo que habría salido, sin haber salido. */
  | { kind: "dry_run"; shopDomain: string; variables: OrderCreateVariables }
  /** No hay tienda para esta operación. Hoy, el caso de todas. */
  | { kind: "not_connected" }
  /** La conexión viva ya no es la de la operación del pedido. */
  | { kind: "store_mismatch"; expected: string; found: string }
  | { kind: "failed"; failure: StoreFailure; stage: "token" | "lookup" | "create" };

const ORDER_LOOKUP_QUERY = /* GraphQL */ `
  query BuscarPedidoDeCierre($query: String!) {
    orders(first: 1, query: $query) {
      edges {
        node {
          id
          name
        }
      }
    }
  }
`;

const ORDER_CREATE_MUTATION = /* GraphQL */ `
  mutation CrearPedidoDeCierre(
    $order: OrderCreateOrderInput!
    $options: OrderCreateOptionsInput
  ) {
    orderCreate(order: $order, options: $options) {
      order {
        id
        name
      }
      userErrors {
        field
        message
      }
    }
  }
`;

interface GraphQLCall {
  shopDomain: string;
  apiVersion: string;
  token: string;
  query: string;
  variables: Record<string, unknown>;
}

type GraphQLResult<T> =
  | { ok: true; data: T }
  | { ok: false; failure: StoreFailure };

/**
 * Una llamada a la API de administración que **no lanza**: clasifica.
 *
 * `admin.ts` tiene su propio ayudante y lanza una excepción con el texto del
 * error adentro; eso alcanza para leer productos, donde el remedio de cualquier
 * fallo es el mismo (devolver la caché). Acá no: el código HTTP decide si se
 * reintenta una venta o se llama a una persona, y sacarlo de un mensaje con una
 * expresión regular es cómo un cambio de redacción de la tienda convierte un
 * `429` reintentable en un fallo definitivo sin que nadie se entere.
 */
async function adminCall<T>(call: GraphQLCall): Promise<GraphQLResult<T>> {
  let res: Response;
  try {
    res = await fetch(
      adminEndpoint({ shopDomain: call.shopDomain, apiVersion: call.apiVersion }),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": call.token,
        },
        body: JSON.stringify({ query: call.query, variables: call.variables }),
      },
    );
  } catch {
    return { ok: false, failure: classifyStoreFailure({ kind: "network" }) };
  }

  if (!res.ok) {
    return {
      ok: false,
      failure: classifyStoreFailure({ kind: "http", status: res.status }),
    };
  }

  let json: { data?: T; errors?: Array<{ extensions?: { code?: string } }> };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    // Un `200` con cuerpo ilegible es la tienda a medio contestar: se reintenta.
    return { ok: false, failure: classifyStoreFailure({ kind: "network" }) };
  }

  if (json.errors?.length) {
    return {
      ok: false,
      failure: classifyStoreFailure({
        kind: "graphql",
        codes: json.errors.map((e) => e.extensions?.code ?? ""),
      }),
    };
  }
  if (!json.data) {
    return { ok: false, failure: classifyStoreFailure({ kind: "network" }) };
  }
  return { ok: true, data: json.data };
}

interface LiveConnection {
  shopDomain: string;
  apiVersion: string;
  token: string;
}

/**
 * La comprobación previa: ¿este cierre ya creó su pedido?
 *
 * Se exporta porque es la mitad leída de la idempotencia y sirve sola: con el
 * modo seco puesto es lo único que se hace contra la tienda, y es lo que
 * permite ensayar la conexión sin escribir nada.
 */
async function findOrderByKey(
  conn: LiveConnection,
  idempotencyKey: string,
): Promise<GraphQLResult<StoreOrderRef | null>> {
  const result = await adminCall<{
    orders: { edges: Array<{ node: StoreOrderRef }> };
  }>({
    ...conn,
    query: ORDER_LOOKUP_QUERY,
    variables: { query: idempotencyTagQuery(idempotencyKey) },
  });
  if (!result.ok) return result;
  return { ok: true, data: result.data.orders.edges[0]?.node ?? null };
}

/**
 * Crea el pedido de un cierre en la tienda de su operación.
 *
 * `mode` se inyecta para que quien llama pueda forzar el modo seco —un ensayo
 * desde el panel, por ejemplo— sin que se pueda forzar al revés por descuido:
 * ausente, manda el interruptor del proceso, que arranca apagado.
 */
export async function createStoreOrder(
  op: Operation,
  draft: SalesOrderDraft,
  mode: StoreWriteMode = storeWriteMode(),
): Promise<StoreOrderOutcome> {
  const connection = await getShopifyConnection(op);
  const credential = connection ? storeCredential(connection) : null;
  if (!connection || !credential || credential.kind === "none") {
    return { kind: "not_connected" };
  }

  // La tienda del pedido se decidió al construirlo; entre aquel momento y éste
  // pudo pasar un reintento de veinticuatro horas y un cambio en el panel.
  if (credential.shopDomain !== draft.store.shopDomain) {
    return {
      kind: "store_mismatch",
      expected: draft.store.shopDomain,
      found: credential.shopDomain,
    };
  }

  // **El token se resuelve una vez para las dos llamadas** —la comprobación
  // previa y la creación— y no una por llamada. Con la credencial del Dev
  // Dashboard resolver puede significar acuñar, y acuñar dos veces en el mismo
  // cierre gasta una llamada de más y abre la puerta a que la comprobación se
  // haga con un token y la escritura con otro.
  //
  // Que un fallo acá sea `failed` y no `not_connected` no es cosmético: la
  // tienda **está** conectada y el fallo puede ser una caída pasajera, así que
  // la cola tiene que poder reintentarlo. `not_connected` es un estado estable
  // que nadie reintenta.
  const resolved = await adminTokenFor(connection);
  if (!resolved.ok) {
    return {
      kind: "failed",
      stage: "token",
      failure: {
        disposition: "retry",
        reason: `no se pudo conseguir el token de la tienda: ${resolved.error}`,
      },
    };
  }

  const conn: LiveConnection = {
    shopDomain: credential.shopDomain,
    apiVersion: connection.apiVersion,
    token: resolved.token,
  };
  const variables = buildOrderCreateVariables(draft);

  const existing = await findOrderByKey(conn, draft.idempotencyKey);
  if (!existing.ok) {
    // Con el modo seco esto es información, no un incidente: el ensayo dice
    // que la lectura no funciona y el operador lo arregla antes de encender.
    if (mode === "dry_run") {
      logger.warn(
        { operation: op.countryCode, reason: existing.failure.reason },
        "tienda (modo seco): la comprobación previa falló",
      );
      return { kind: "dry_run", shopDomain: conn.shopDomain, variables };
    }
    return { kind: "failed", failure: existing.failure, stage: "lookup" };
  }
  if (existing.data) {
    return {
      kind: "already_exists",
      order: existing.data,
      shopDomain: conn.shopDomain,
    };
  }

  if (mode === "dry_run") {
    logger.info(
      {
        operation: op.countryCode,
        shopDomain: conn.shopDomain,
        idempotencyKey: draft.idempotencyKey,
        total: draft.totals.total,
        currency: draft.currency,
      },
      "tienda (modo seco): el pedido NO se creó; esto es lo que habría salido",
    );
    return { kind: "dry_run", shopDomain: conn.shopDomain, variables };
  }

  const created = await adminCall<{
    orderCreate: {
      order: StoreOrderRef | null;
      userErrors: Array<{ field?: string[] | null; message: string }>;
    };
  }>({
    ...conn,
    query: ORDER_CREATE_MUTATION,
    // El cuerpo es un objeto concreto y tipado, no un mapa suelto: se ensancha
    // acá, en el borde con el transporte, y no relajando el tipo del payload.
    variables: variables as unknown as Record<string, unknown>,
  });

  if (!created.ok) {
    return { kind: "failed", failure: created.failure, stage: "create" };
  }

  const { order, userErrors } = created.data.orderCreate;
  if (userErrors.length > 0 || !order) {
    return {
      kind: "failed",
      stage: "create",
      failure: classifyStoreFailure({
        kind: "user_errors",
        messages: userErrors.map((e) =>
          [e.field?.join("."), e.message].filter(Boolean).join(": "),
        ),
      }),
    };
  }

  logger.info(
    {
      operation: op.countryCode,
      shopDomain: conn.shopDomain,
      orderName: order.name,
      idempotencyKey: draft.idempotencyKey,
    },
    "tienda: pedido creado desde el cierre de una venta",
  );
  return { kind: "created", order, shopDomain: conn.shopDomain };
}

export { unexpectedFailure };
