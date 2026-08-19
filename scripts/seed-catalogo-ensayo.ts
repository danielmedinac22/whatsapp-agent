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
  addProductMedia,
  connectShopifyProduct,
  createNativeProduct,
  getDb,
  linkAdToProducts,
  operations,
  setProductMediaSendable,
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

  await db.execute(sql`delete from product_media`);
  await db.execute(sql`delete from product_ads`);
  await db.execute(sql`delete from products`);

  const nativo = (name: string, description?: string) =>
    createNativeProduct(op, { name, description: description ?? null });

  // Los nombres son los **reales**, con la concentración real: el primero es el
  // 77% del volumen y los tres primeros el 96%. Se parecen a propósito — son
  // los cuatro que motivaron toda la cascada de reconocimiento, y sobre los que
  // el nivel semántico tiene que decir *ambiguo* y nunca elegir uno.
  const dht = await nativo(
    "REVITALHAIR - DHT ANTICALVICIE",
    "Tratamiento en cápsulas para la caída por DHT. Presentación de 60 cápsulas, tratamiento de 3 meses.",
  );
  const blocker = await nativo(
    "REVITALHAIR - DHT BLOCKER ANTICALVICIE",
    "Bloqueador de DHT en presentación reforzada. No confundir con el tratamiento base.",
  );
  const combo = await nativo(
    "REVITALHAIR COMBO DHT + SERUM ANTICALVICIE 360",
    "Combo del tratamiento en cápsulas más el serum capilar de aplicación diaria.",
  );
  // El cuarto de la familia, con su nombre real completo: es el que **no** se
  // parece a los otros tres por su nombre, solo por lo que vende. Sin anuncios
  // a propósito — es la fuga de reconocimiento que la ficha nombra, y ahora
  // además es el que hace observable el nivel 2: un anuncio capilar suyo cae al
  // match semántico porque nadie lo registró.
  await nativo("Hair Recovery 3X - COMBO RECUPERACION CAPILAR TOTAL");
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

  // ── Los archivos enviables (migración `0025`) ───────────────────────────
  //
  // Lo que hay que poder mirar acá es **el conteo de la cabecera diciendo la
  // verdad**: «2 de 3 enviables» tiene que leerse como «al cliente le llegan
  // 2». Por eso el catálogo de ensayo carga un archivo que a propósito NO se
  // marca —la hoja de márgenes internos, que el admin sube para tenerla a mano
  // y que mandársela al cliente no se deshace— y dos que sí.
  //
  // **El video de 27 MB del prototipo no se siembra, y no es un olvido**: el
  // rechazo por tamaño se hace al subir, así que ese archivo nunca llega a ser
  // una fila. Para verlo hay que intentar subirlo desde la ficha, que es
  // exactamente el momento en que el ticket quiere que aparezca el problema.
  const bytes = (n: number) => Buffer.alloc(n, 0x20);
  const archivo = async (
    productId: string,
    filename: string,
    mime: string,
    size: number,
    enviable: boolean,
  ) => {
    const media = await addProductMedia(op, productId, {
      filename,
      mime,
      bytes: bytes(size),
    });
    // Nace apagado siempre: marcarlo es un acto aparte, también acá.
    if (enviable) await setProductMediaSendable(op, media.id, true);
  };

  await archivo(dht.id, "ficha-producto.pdf", "application/pdf", 480 * 1024, true);
  await archivo(dht.id, "antes-despues.jpg", "image/jpeg", 1_200 * 1024, true);
  await archivo(
    dht.id,
    "margen-interno.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    44 * 1024,
    false,
  );
  await archivo(blocker.id, "ficha-blocker.pdf", "application/pdf", 512 * 1024, true);
  await archivo(serum.id, "modo-de-uso.pdf", "application/pdf", 220 * 1024, true);

  // El COMBO lleva cuatro enviables **a propósito**: es el estado difícil del
  // ticket 03. Con el tope de tres archivos por turno, un producto con cuatro es
  // el único que muestra la conversación repartiendo —tres en un turno y el
  // cuarto en el siguiente— en vez de mandarlos todos y no probar nada.
  await archivo(combo.id, "combo-360.jpg", "image/jpeg", 890 * 1024, true);
  await archivo(combo.id, "instructivo.pdf", "application/pdf", 1_100 * 1024, true);
  await archivo(combo.id, "modo-de-uso.mp4", "video/mp4", 3_900 * 1024, true);
  await archivo(combo.id, "testimonio-cliente.jpg", "image/jpeg", 1_400 * 1024, true);

  console.log(`\n  Catálogo de ensayo cargado en ${host} (${op.countryCode}).`);
  console.log("  8 productos · 6 anuncios · 2 compartidos · 3 sin anuncios");
  console.log(
    "  9 archivos · 8 enviables · DHT ANTICALVICIE queda en «2 de 3 enviables»",
  );
  console.log(
    "  COMBO 360 queda con 4 enviables: tres salen en un turno y el cuarto en el siguiente\n",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
