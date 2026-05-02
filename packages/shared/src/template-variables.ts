export type TemplateVariable = {
  key: string;
  label: string;
  description: string;
  example: string;
};

export const TEMPLATE_VARIABLES: readonly TemplateVariable[] = [
  {
    key: "nombre",
    label: "Nombre",
    description: "Nombre del cliente (Shopify customer.first_name)",
    example: "Juan",
  },
  {
    key: "producto",
    label: "Productos",
    description: "Items del pedido (cantidad × nombre)",
    example: "2 × Camiseta Azul, Pantalón Negro",
  },
  {
    key: "total",
    label: "Total",
    description: "Total del pedido (sin .00 final)",
    example: "125.50",
  },
  {
    key: "direccion",
    label: "Dirección",
    description: "Dirección de envío (line1 + line2)",
    example: "Calle 5 Zona 10, Apto 302",
  },
  {
    key: "ciudad",
    label: "Ciudad",
    description: "Ciudad y provincia",
    example: "Guatemala, Guatemala",
  },
  {
    key: "telefono",
    label: "Teléfono",
    description: "Teléfono de contacto",
    example: "+50212345678",
  },
  {
    key: "pedido",
    label: "Pedido",
    description: "ID del pedido en Shopify",
    example: "shop-12345",
  },
  {
    key: "guia",
    label: "Guía",
    description: "Número de guía de Dropi",
    example: "ABC123456",
  },
  {
    key: "transportadora",
    label: "Transportadora",
    description: "Carrier asignado por Dropi (Forja / Gintracom)",
    example: "Forja",
  },
  {
    key: "estado",
    label: "Estado",
    description: "Estado actual del pedido en Dropi",
    example: "en_transito",
  },
  {
    key: "pdf_guia",
    label: "PDF de la guía",
    description: "Link público al PDF de la guía (CloudFront de Dropi)",
    example:
      "https://d2ob47cxeawi8a.cloudfront.net/guatemala/guias/forza/ORDEN-633022-GUIA-FD32562013.pdf",
  },
] as const;

export const TEMPLATE_VARIABLE_KEYS: readonly string[] = TEMPLATE_VARIABLES.map(
  (v) => v.key,
);

export const TEMPLATE_VARIABLE_EXAMPLES: Record<string, string> =
  Object.fromEntries(TEMPLATE_VARIABLES.map((v) => [v.key, v.example]));
