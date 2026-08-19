/**
 * Enseña, contra una base **de ensayo**, qué archivos del producto le llegan al
 * lead durante la conversación — y qué archivos no le llegan nunca.
 *
 * Existe porque este camino **no es observable en producción**: `product_media`
 * está en cero, `sales_agent_settings` también, y hasta que el dueño de la
 * operación cargue el catálogo y configure al vendedor, no se ejecuta ni una
 * vez. Los tests prueban las reglas con fixtures; esto prueba lo que los
 * fixtures no pueden: que la clave foránea compuesta, el índice único de la
 * cola y el filtro por operación se comporten como se dice **en un Postgres de
 * verdad**.
 *
 * Corre el camino real —el mismo accesor, la misma decisión de turno y el mismo
 * `enqueueOutbound`— y **no manda nada**: encolar deja una fila, y sin worker
 * levantado nadie la consume. Igual se niega a correr contra producción, por lo
 * mismo que su hermano de catálogo.
 *
 *     docker run -d --name wa-ensayo -e POSTGRES_PASSWORD=test \
 *       -e POSTGRES_DB=wa -p 55995:5432 postgres:16-alpine
 *     DATABASE_URL="postgres://postgres:test@127.0.0.1:55995/wa" \
 *       pnpm --filter @wa/db migrate
 *     DATABASE_URL="postgres://postgres:test@127.0.0.1:55995/wa" SEMBRAR=si \
 *       npx tsx scripts/seed-catalogo-ensayo.ts
 *     DATABASE_URL="postgres://postgres:test@127.0.0.1:55995/wa" SEMBRAR=si \
 *       npx tsx scripts/apoyos-visuales-ensayo.ts
 */
import {
  and,
  contacts,
  conversations,
  eq,
  getDb,
  getProductMediaForSend,
  listCatalog,
  listSendableProductMedia,
  operations,
  outboundMessages,
  productMedia,
  products,
  setProductMediaSendable,
  sql,
  type Operation,
} from "@wa/db";
import { conteoDeEnviables, formatoDeTamano } from "@wa/shared";
import { renderVisualSupportSection } from "../apps/worker/src/sales/product-context";
import {
  decidirApoyosDelTurno,
  enqueueApoyosVisuales,
} from "../apps/worker/src/sales/product-media-send";

/** Hosts que son producción. Contra estos no se escribe nada, nunca. */
const PROHIBIDOS = ["rlwy.net", "railway.app"];

function hostDe(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "<DATABASE_URL inválida>";
  }
}

function titulo(t: string) {
  console.log(`\n── ${t} ${"─".repeat(Math.max(0, 66 - t.length))}\n`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL requerido");
  const host = hostDe(url);

  if (PROHIBIDOS.some((p) => host.includes(p))) {
    console.error(
      `\n  ${host} es producción. Este script no escribe ahí.\n` +
        `  Encolar un envío en producción es mandarle un archivo a una persona.\n`,
    );
    process.exit(1);
  }
  if (process.env.SEMBRAR !== "si") {
    console.error(
      `\n  Va a escribir contactos, conversaciones y envíos en ${host}.\n` +
        `  Volvé a correrlo con SEMBRAR=si si es la base de ensayo.\n`,
    );
    process.exit(1);
  }

  const db = getDb();
  const [gt] = (await db.select().from(operations)) as Operation[];
  if (!gt) throw new Error("no hay ninguna operación: falta correr las migraciones");

  const catalogo = await listCatalog(gt);
  if (catalogo.length === 0) {
    throw new Error("catálogo vacío: corré antes scripts/seed-catalogo-ensayo.ts");
  }

  // ── 1. Qué se manda y qué no, producto por producto ──────────────────────
  titulo("Qué le llega al cliente, por producto");
  for (const { product } of catalogo) {
    const todos = await db
      .select()
      .from(productMedia)
      .where(
        and(
          eq(productMedia.operationId, gt.id),
          eq(productMedia.productId, product.id),
        ),
      );
    if (todos.length === 0) continue;
    const enviables = await listSendableProductMedia(gt, product.id);
    const conteo = conteoDeEnviables(todos);
    console.log(`  ${product.name ?? product.id}  ·  ${conteo.texto}`);
    for (const a of todos) {
      const sale = enviables.some((e) => e.id === a.id);
      console.log(
        `      ${sale ? "→ sale " : "  no   "} ${a.filename.padEnd(28)} ${formatoDeTamano(a.byteSize)}`,
      );
    }
  }

  // ── 2. El archivo que se pasó del límite después de subido ────────────────
  //
  // El rechazo por tamaño ocurre al subir, así que una fila así **no se puede
  // crear por el camino normal**: `addProductMedia` la rechaza. Se inserta a
  // mano justo para eso — es el estado que aparecería el día que Meta baje el
  // límite y filas ya guardadas dejen de caber sin que nadie las toque.
  const combo = catalogo.find((c) => c.product.name?.includes("COMBO"))?.product;
  if (!combo) throw new Error("el catálogo de ensayo no trae el COMBO");

  titulo("Un archivo que dejó de caber en WhatsApp después de subido");
  const [pesado] = await db
    .insert(productMedia)
    .values({
      operationId: gt.id,
      productId: combo.id,
      filename: "sesion-fotos.jpg",
      mime: "image/jpeg",
      bytes: Buffer.alloc(6 * 1024 * 1024, 0x20),
      byteSize: 6 * 1024 * 1024,
      sendable: true, // marcado a mano: el panel tampoco dejaría marcarlo
    })
    .returning({ id: productMedia.id, filename: productMedia.filename });
  if (!pesado) throw new Error("no se pudo insertar el archivo pesado");
  const conPesado = await listSendableProductMedia(gt, combo.id);
  console.log(
    `  ${pesado.filename} está marcado como enviable en la base y pesa 6 MB (el límite de imagen es 5 MB).`,
  );
  console.log(
    `  ¿Sale? ${conPesado.some((a) => a.id === pesado.id) ? "SÍ — mal" : "no — y los otros salen igual"}`,
  );

  // ── 3. Los turnos de la conversación ─────────────────────────────────────
  titulo("Turno por turno, con el vendedor contestando");

  const waId = "50255500001";
  await db.delete(contacts).where(eq(contacts.waId, waId));
  const [contacto] = await db
    .insert(contacts)
    .values({ waId, jid: `${waId}@s.whatsapp.net`, phone: waId, name: "Lead de ensayo" })
    .returning({ id: contacts.id });
  if (!contacto) throw new Error("no se pudo crear el contacto de ensayo");
  const [conversacion] = await db
    .insert(conversations)
    .values({ contactId: contacto.id, operationId: gt.id, productId: combo.id })
    .returning();
  if (!conversacion) throw new Error("no se pudo crear la conversación de ensayo");

  for (const turno of [1, 2, 3]) {
    const r = await enqueueApoyosVisuales({
      operation: gt,
      conversation: conversacion,
      to: waId,
    });
    console.log(
      `  turno ${turno}: encolados ${r.encolados}, quedan pendientes ${r.pendientes}`,
    );
  }

  const encolados = await db
    .select({
      body: outboundMessages.body,
      sourceRef: outboundMessages.sourceRef,
      mediaKind: outboundMessages.mediaKind,
      dedupKey: outboundMessages.dedupKey,
    })
    .from(outboundMessages)
    .where(eq(outboundMessages.conversationId, conversacion.id));
  console.log(`\n  Filas que quedaron en el outbox (${encolados.length}):`);
  for (const e of encolados) {
    console.log(`      ${e.body.padEnd(30)} ${e.mediaKind}  ${e.sourceRef}`);
  }
  console.log(
    `\n  Llaves distintas: ${new Set(encolados.map((e) => e.dedupKey)).size} — ` +
      `ninguna se repite, y el índice único es el que lo garantiza.`,
  );

  // ── 4. El bloque que recibe Sebastián ────────────────────────────────────
  titulo("Lo que el prompt del vendedor dice de los archivos");
  const seccion = renderVisualSupportSection(
    await listSendableProductMedia(gt, combo.id),
  );
  console.log(
    (seccion ?? "  (sin archivos: no hay sección)")
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n"),
  );

  // ── 5. La operación vecina ───────────────────────────────────────────────
  titulo("Un archivo de la otra operación");
  await db.execute(sql`delete from product_media where operation_id in (select id from operations where country_code = 'CO')`);
  await db.execute(sql`delete from products where operation_id in (select id from operations where country_code = 'CO')`);
  await db.execute(sql`delete from operations where country_code = 'CO'`);
  const [co] = await db
    .insert(operations)
    .values({ name: "Colombia", countryCode: "CO", currency: "COP" })
    .returning();
  if (!co) throw new Error("no se pudo crear la operación vecina");
  const [productoCo] = await db
    .insert(products)
    .values({ operationId: co.id, source: "native", name: "Producto colombiano" })
    .returning({ id: products.id });
  if (!productoCo) throw new Error("no se pudo crear el producto vecino");
  const [archivoCo] = await db
    .insert(productMedia)
    .values({
      operationId: co.id,
      productId: productoCo.id,
      filename: "solo-colombia.jpg",
      mime: "image/jpeg",
      bytes: Buffer.alloc(1024, 0x20),
      byteSize: 1024,
      sendable: true,
    })
    .returning({ id: productMedia.id });
  if (!archivoCo) throw new Error("no se pudo crear el archivo vecino");

  const desdeGuatemala = await getProductMediaForSend(gt, archivoCo.id);
  const desdeColombia = await getProductMediaForSend(co, archivoCo.id);
  console.log(
    `  El archivo de Colombia, pedido desde Guatemala: ${desdeGuatemala ? "LO DEVUELVE — mal" : "no existe"}`,
  );
  console.log(
    `  El mismo archivo, pedido desde Colombia:        ${desdeColombia ? "lo devuelve" : "NO LO DEVUELVE — mal"}`,
  );
  const cruzado = decidirApoyosDelTurno({
    archivos: await listSendableProductMedia(gt, productoCo.id),
    yaEncolados: new Set(),
  });
  console.log(
    `  El producto colombiano, preguntado desde Guatemala: ${cruzado.envia.length} archivos`,
  );

  // ── 6. Desmarcar un archivo, sin reiniciar nada ──────────────────────────
  titulo("Un archivo desmarcado, desde la conversación siguiente");
  const [aApagar] = await listSendableProductMedia(gt, combo.id);
  if (!aApagar) throw new Error("el COMBO se quedó sin archivos enviables");
  await setProductMediaSendable(gt, aApagar.id, false);
  console.log(`  El admin acaba de apagar el interruptor de ${aApagar.filename}.`);

  const waId2 = "50255500002";
  await db.delete(contacts).where(eq(contacts.waId, waId2));
  const [contacto2] = await db
    .insert(contacts)
    .values({ waId: waId2, jid: `${waId2}@s.whatsapp.net`, phone: waId2, name: "Lead nuevo" })
    .returning({ id: contacts.id });
  if (!contacto2) throw new Error("no se pudo crear el segundo contacto");
  const [conversacion2] = await db
    .insert(conversations)
    .values({ contactId: contacto2.id, operationId: gt.id, productId: combo.id })
    .returning();
  if (!conversacion2) throw new Error("no se pudo crear la segunda conversación");

  await enqueueApoyosVisuales({ operation: gt, conversation: conversacion2, to: waId2 });
  await enqueueApoyosVisuales({ operation: gt, conversation: conversacion2, to: waId2 });
  const delLeadNuevo = await db
    .select({ body: outboundMessages.body })
    .from(outboundMessages)
    .where(eq(outboundMessages.conversationId, conversacion2.id));
  console.log("  Lo que recibe el lead siguiente:");
  for (const e of delLeadNuevo) console.log(`      ${e.body}`);
  console.log(
    `  ¿Salió el desmarcado? ${
      delLeadNuevo.some((e) => e.body.includes(aApagar.filename))
        ? "SÍ — mal"
        : "no — y no hubo que reiniciar ni desplegar nada"
    }`,
  );

  console.log(`\n  Listo. Nada de esto salió hacia WhatsApp: son filas en ${host}.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
