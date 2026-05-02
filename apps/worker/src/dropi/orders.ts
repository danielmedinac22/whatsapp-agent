import { dropiFetch } from "./client";
import { getValidDropiAuth } from "./auth";
import { normalizeDropiStatus } from "./normalize";

export interface DropiOrderRow {
  id: number;
  status: string;
  guide_number: string | null;
  carrier: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  created_at: string | null;
  raw: Record<string, unknown>;
}

interface RawOrder {
  id: number;
  [k: string]: unknown;
}

interface ListOrdersResponse {
  // shape from /orders/myorders/v2 — varies; we keep it permissive.
  isOk?: boolean;
  data?: RawOrder[] | { orders?: RawOrder[]; data?: RawOrder[] };
  total?: number;
}

function pickStr(o: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

function extractOrders(resp: ListOrdersResponse): RawOrder[] {
  const d = resp.data;
  if (!d) return [];
  if (Array.isArray(d)) return d;
  if (Array.isArray(d.orders)) return d.orders;
  if (Array.isArray(d.data)) return d.data;
  return [];
}

function toRow(raw: RawOrder): DropiOrderRow {
  const o = raw as Record<string, unknown>;
  const statusRaw =
    pickStr(o, "status", "status_name", "estado", "order_status") ?? "";
  const guide = pickStr(
    o,
    "guide_number",
    "tracking_number",
    "guia",
    "numero_guia",
  );
  const carrier = pickStr(o, "carrier", "transportadora", "courier");
  const phone = pickStr(
    o,
    "customer_phone",
    "phone",
    "telefono",
    "client_phone",
  );
  const name = pickStr(
    o,
    "customer_name",
    "client_name",
    "nombre_cliente",
    "name",
  );
  const createdAt = pickStr(o, "created_at", "fecha_creado", "createdAt");
  return {
    id: Number(o.id),
    status: statusRaw,
    guide_number: guide,
    carrier,
    customer_name: name,
    customer_phone: phone,
    created_at: createdAt,
    raw,
  };
}

export interface ListOrdersInput {
  from: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
  start?: number;
  resultNumber?: number;
  status?: string | null;
}

export async function listOrders(input: ListOrdersInput): Promise<DropiOrderRow[]> {
  const auth = await getValidDropiAuth();
  const resp = await dropiFetch<ListOrdersResponse>(
    "/orders/myorders/v2",
    {
      query: {
        exportAs: "orderByRow",
        orderBy: "id",
        orderDirection: "desc",
        result_number: input.resultNumber ?? 50,
        start: input.start ?? 0,
        textToSearch: "",
        status: input.status ?? "null",
        supplier_id: "false",
        user_id: auth.userId,
        from: input.from,
        until: input.until,
        filter_product: "undefined",
        haveIncidenceProcesamiento: "false",
        tag_id: "",
        warranty: "false",
        seller: "null",
        filter_date_by: "FECHA DE CREADO",
        invoiced: "null",
      },
    },
  );
  return extractOrders(resp).map(toRow);
}

export async function listAllOrders(
  input: Omit<ListOrdersInput, "start" | "resultNumber">,
  pageSize = 50,
  maxPages = 20,
): Promise<DropiOrderRow[]> {
  const all: DropiOrderRow[] = [];
  for (let page = 0; page < maxPages; page++) {
    const rows = await listOrders({
      ...input,
      start: page * pageSize,
      resultNumber: pageSize,
    });
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

export async function confirmOrder(dropiOrderId: number): Promise<void> {
  await dropiFetch(`/orders/myorders/${dropiOrderId}`, {
    method: "PUT",
    body: { status: "PENDIENTE" },
  });
}

export { normalizeDropiStatus };
