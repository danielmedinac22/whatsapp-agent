interface LineItem {
  title?: string;
  name?: string;
  quantity?: number;
}

interface OrderPayload {
  customer?: {
    first_name?: string | null;
    last_name?: string | null;
  } | null;
  shipping_address?: { name?: string | null } | null;
  total_price?: string | null;
  line_items?: LineItem[];
}

function pickFirstName(p: OrderPayload): string {
  const first = p.customer?.first_name?.trim();
  if (first) return first;
  const shipping = p.shipping_address?.name?.trim();
  if (shipping) return shipping.split(/\s+/)[0] ?? "";
  return "";
}

function describeProducts(p: OrderPayload): string {
  const items = p.line_items ?? [];
  if (items.length === 0) return "";
  return items
    .map((it) => {
      const name = it.title ?? it.name ?? "Producto";
      const qty = it.quantity ?? 1;
      return qty > 1 ? `${qty} × ${name}` : name;
    })
    .join(", ");
}

function formatTotal(raw: string | null | undefined): string {
  if (!raw) return "";
  // Shopify ships prices as "12.00" or "12.50" — drop trailing .00
  return raw.endsWith(".00") ? raw.slice(0, -3) : raw;
}

export function extractOrderVariables(
  payload: unknown,
): Record<string, string> {
  const p = (payload ?? {}) as OrderPayload;
  return {
    nombre: pickFirstName(p),
    producto: describeProducts(p),
    total: formatTotal(p.total_price),
  };
}
