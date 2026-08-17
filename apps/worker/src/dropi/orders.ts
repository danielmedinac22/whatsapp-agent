import type { Operation } from "@wa/db";
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
  /** Shopify order number from Dropi's payload (when available). */
  shop_order_number: string | null;
  /** Relative S3 path to the PDF guide (e.g. "guatemala/guias/forza/ORDEN-...PDF"). */
  guide_pdf_path: string | null;
  /** Filename of the PDF (e.g. "ORDEN-...PDF"). */
  guide_pdf_file: string | null;
  created_at: string | null;
  raw: Record<string, unknown>;
}

interface RawOrder {
  id: number;
  [k: string]: unknown;
}

interface ListOrdersResponse {
  isSuccess?: boolean;
  status?: number;
  count?: number | null;
  objects?: RawOrder[];
  // legacy/permissive fallbacks
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
  if (Array.isArray(resp.objects)) return resp.objects;
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
    "shipping_guide",
    "guide_number",
    "tracking_number",
    "guia",
    "numero_guia",
    "guide",
    "guia_number",
  );
  // Dropi nests carrier under distribution_company / shipping_company / transporter.
  let carrier = pickStr(o, "carrier", "transportadora", "courier");
  if (!carrier) {
    for (const key of [
      "distribution_company",
      "shipping_company",
      "transporter",
      "transportadora_obj",
    ]) {
      const t = o[key] as { name?: string } | null | undefined;
      if (t?.name) {
        carrier = t.name;
        break;
      }
    }
  }
  const phone = pickStr(
    o,
    "customer_phone",
    "phone",
    "telefono",
    "client_phone",
  );
  const first = pickStr(o, "name", "customer_name", "client_name");
  const last = pickStr(o, "surname", "last_name", "apellido");
  const name =
    [first, last].filter(Boolean).join(" ").trim() || first || last || null;
  const createdAt = pickStr(o, "created_at", "fecha_creado", "createdAt");
  const shopOrderNumber = pickStr(
    o,
    "shop_order_number",
    "shop_order_id",
    "external_order_number",
  );
  const pdfPath = pickStr(o, "guia_urls3", "guide_url_s3", "guia_url_s3");
  const pdfFile = pickStr(o, "sticker", "guia_file", "guide_file");
  return {
    id: Number(o.id),
    status: statusRaw,
    guide_number: guide,
    carrier,
    customer_name: name,
    customer_phone: phone,
    shop_order_number: shopOrderNumber,
    guide_pdf_path: pdfPath,
    guide_pdf_file: pdfFile,
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

/** Los pedidos de logística de una operación: los de la cuenta Dropi de esa operación. */
export async function listOrders(
  op: Operation,
  input: ListOrdersInput,
): Promise<DropiOrderRow[]> {
  const auth = await getValidDropiAuth(op);
  const resp = await dropiFetch<ListOrdersResponse>(
    op,
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
  op: Operation,
  input: Omit<ListOrdersInput, "start" | "resultNumber">,
  pageSize = 50,
  maxPages = 20,
): Promise<DropiOrderRow[]> {
  const all: DropiOrderRow[] = [];
  for (let page = 0; page < maxPages; page++) {
    const rows = await listOrders(op, {
      ...input,
      start: page * pageSize,
      resultNumber: pageSize,
    });
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

/**
 * Confirma un pedido contra la logística de su operación. El id es el de Dropi,
 * que es único dentro de una cuenta y no entre cuentas: sin la operación, esta
 * llamada podría confirmar el pedido de otro país con el mismo número.
 */
export async function confirmOrder(
  op: Operation,
  dropiOrderId: number,
): Promise<void> {
  await dropiFetch(op, `/orders/myorders/${dropiOrderId}`, {
    method: "PUT",
    body: { status: "PENDIENTE" },
  });
}

export { normalizeDropiStatus };
