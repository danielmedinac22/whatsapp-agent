/**
 * Deja una base **de ensayo** con el catálogo real de Guatemala cargado, para
 * poder mirar la pantalla de `/catalogo` con el estado difícil.
 *
 * Existe porque el hallazgo del árbol de diseño aplica acá entero: **el estado
 * vacío aprueba por la razón equivocada**. Un catálogo sin filas se ve
 * ordenado, se navega perfecto y no prueba nada; lo que hay que mirar es si con
 * los tres nombres REVITALHAIR casi idénticos la tabla sigue siendo navegable y
 * el origen se distingue de un vistazo.
 *
 * En producción `products` y `product_ads` están en cero, y **cargar el
 * catálogo de verdad es un acto del dueño de la operación, no de un agente**.
 * Por eso este script se niega a correr contra la base de producción, y además
 * pide confirmación explícita.
 *
 *     docker run -d --name wa-ensayo -e POSTGRES_PASSWORD=test \
 *       -e POSTGRES_DB=wa -p 55988:5432 postgres:16-alpine
 *     DATABASE_URL="postgres://postgres:test@127.0.0.1:55988/wa" \
 *       pnpm --filter @wa/db migrate
 *     DATABASE_URL="postgres://postgres:test@127.0.0.1:55988/wa" SEMBRAR=si \
 *       npx tsx scripts/seed-catalogo-ensayo.ts
 */
import {
  connectShopifyProduct,
  createNativeProduct,
  getDb,
  linkAdToProducts,
  operations,
  sql,
  type Operation,
} from "@wa/db";

/** Hosts que son producción. Contra estos no se siembra nada, nunca. */
const PROHIBIDOS = ["rlwy.net", "railway.app"];

function hostDe(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "<DATABASE_URL inválida>";
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL requerido");
  const host = hostDe(url);

  if (PROHIBIDOS.some((p) => host.includes(p))) {
    console.error(
      `\n  ${host} es producción. Este script no siembra ahí.\n` +
        `  Cargar el catálogo real es una decisión del dueño de la operación.\n`,
    );
    process.exit(1);
  }
  if (process.env.SEMBRAR !== "si") {
    console.error(
      `\n  Va a escribir productos y mapeos en ${host}.\n` +
        `  Volvé a correrlo con SEMBRAR=si si es la base de ensayo.\n`,
    );
    process.exit(1);
  }

  const db = getDb();
  const [op] = (await db.select().from(operations)) as Operation[];
  if (!op) throw new Error("no hay ninguna operación: falta correr las migraciones");

  await db.execute(sql`delete from product_ads`);
  await db.execute(sql`delete from products`);

  const nativo = (name: string, description?: string) =>
    createNativeProduct(op, { name, description: description ?? null });

  // Los nombres son los reales, con la concentración real: el primero es el 77%
  // del volumen y los tres primeros el 96%. Los tres se parecen a propósito.
  const dht = await nativo(
    "REVITALHAIR – DHT ANTICALVICIE",
    "Tratamiento en cápsulas para la caída por DHT. Presentación de 60 cápsulas, tratamiento de 3 meses.",
  );
  const blocker = await nativo(
    "REVITALHAIR – DHT BLOCKER ANTICALVICIE",
    "Bloqueador de DHT en presentación reforzada. No confundir con el tratamiento base.",
  );
  const combo = await nativo(
    "REVITALHAIR – COMBO DHT + SERUM ANTICALVICIE 360",
    "Combo del tratamiento en cápsulas más el serum capilar de aplicación diaria.",
  );
  // Sin anuncios a propósito: es la fuga de reconocimiento que la ficha nombra.
  await nativo("REVITALHAIR – Hair Recovery 3X");
  const serum = await nativo(
    "REVITALHAIR Serum Capilar",
    "Serum de aplicación diaria. Todavía no está en la tienda.",
  );
  await nativo("Kit Barba Vorare");

  // Dos conectados, para ver la columna de origen con las dos clases de fila.
  // Sin conexión de Shopify no tienen nombre: eso también es lo que hay que ver.
  const tienda = await connectShopifyProduct(op, "gid://shopify/Product/7788990011");
  await connectShopifyProduct(op, "gid://shopify/Product/7788990022");

  await linkAdToProducts(op, "23851094782", [dht.id]);
  await linkAdToProducts(op, "23851094790", [dht.id]);
  await linkAdToProducts(op, "23904471123", [dht.id]);
  // El anuncio compartido, que es el N:M: un id, dos productos.
  await linkAdToProducts(op, "23851094999", [blocker.id, serum.id]);
  await linkAdToProducts(op, "23990117845", [combo.id]);
  await linkAdToProducts(op, "24001233741", [combo.id, tienda.id]);

  console.log(`\n  Catálogo de ensayo cargado en ${host} (${op.countryCode}).`);
  console.log("  8 productos · 6 anuncios · 2 compartidos · 3 sin anuncios\n");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
