import { Hono } from "hono";
import { panelOperation } from "../operations";
import { readStoreProducts, searchStoreProducts } from "./admin";

/**
 * Lo único del catálogo que el panel **no** puede resolver solo: la tienda.
 *
 * El resto de la pantalla de catálogo lee y escribe `products` y `product_ads`
 * con el accesor de `@wa/db`, directo desde el panel. Shopify no: las
 * credenciales de administración viven en el worker y no salen de ahí — el
 * navegador nunca recibe el token, y el panel tampoco lo necesita.
 *
 * **Vive en `shopify/` y no en `routes/` por una razón de la ola del
 * 18-ago-2026, no de diseño**: ese directorio tiene otro dueño esta ola (el
 * worktree del selector de operación) y dos ramas escribiendo el mismo
 * directorio chocan sin que ningún check local lo vea. Cuando la ola cierre,
 * mudarlo es un `git mv` y una línea en `index.ts`.
 */
export const catalogStore = new Hono();

/**
 * Buscar productos en la tienda para conectarlos al catálogo.
 *
 * Los tres estados salen como `store` en el cuerpo y con `200`, no como código
 * de error: «la tienda no está conectada» es hoy el estado normal —
 * `shopify_connection` está vacía en producción— y la pantalla tiene que poder
 * explicarlo en vez de mostrar un fallo.
 */
catalogStore.get("/store/search", async (c) => {
  const op = await panelOperation(c);
  const term = c.req.query("q") ?? "";
  const limit = Number(c.req.query("limit") ?? 25);
  const read = await searchStoreProducts(
    op,
    term,
    Number.isFinite(limit) ? limit : 25,
  );
  return c.json(read);
});

/**
 * La información de los productos conectados, leída de la tienda **en tiempo de
 * uso**.
 *
 * Es lo que hace verdadera la promesa del ticket: el catálogo guarda el id y
 * nada más, así que editar el producto en la tienda se refleja acá sin que
 * nadie sincronice nada.
 */
catalogStore.get("/store/products", async (c) => {
  const op = await panelOperation(c);
  const ids = (c.req.query("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    return c.json({ store: "connected", shopDomain: "", result: [] });
  }
  return c.json(await readStoreProducts(op, ids));
});
