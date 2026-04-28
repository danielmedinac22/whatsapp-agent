interface LineItem {
  title?: string;
  name?: string;
  quantity?: number;
}

interface OrderPayload {
  customer?: {
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
  } | null;
  shipping_address?: {
    name?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    province?: string | null;
    phone?: string | null;
  } | null;
  phone?: string | null;
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

function pickAddress(p: OrderPayload): string {
  const a1 = p.shipping_address?.address1?.trim();
  const a2 = p.shipping_address?.address2?.trim();
  if (a1 && a2) return `${a1}, ${a2}`;
  return a1 ?? "";
}

function pickCity(p: OrderPayload): string {
  const city = p.shipping_address?.city?.trim();
  const province = p.shipping_address?.province?.trim();
  if (city && province) return `${city}, ${province}`;
  return city ?? province ?? "";
}

function pickPhone(p: OrderPayload): string {
  const ship = p.shipping_address?.phone?.trim();
  if (ship) return ship;
  const customer = p.customer?.phone?.trim();
  if (customer) return customer;
  const top = p.phone?.trim();
  return top ?? "";
}

export function extractOrderVariables(
  payload: unknown,
): Record<string, string> {
  const p = (payload ?? {}) as OrderPayload;
  return {
    nombre: pickFirstName(p),
    producto: describeProducts(p),
    total: formatTotal(p.total_price),
    direccion: pickAddress(p),
    ciudad: pickCity(p),
    telefono: pickPhone(p),
  };
}
