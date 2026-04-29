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
] as const;

export const TEMPLATE_VARIABLE_KEYS: readonly string[] = TEMPLATE_VARIABLES.map(
  (v) => v.key,
);

export const TEMPLATE_VARIABLE_EXAMPLES: Record<string, string> =
  Object.fromEntries(TEMPLATE_VARIABLES.map((v) => [v.key, v.example]));
