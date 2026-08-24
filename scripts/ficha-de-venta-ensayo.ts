/**
 * Enseña, contra una base **de ensayo**, qué lee el vendedor de un producto — y
 * prueba la asimetría de la que depende todo el diseño de `sales_brief`.
 *
 * **La afirmación que este script existe para sostener** es que la ficha de
 * venta se puede escribir sobre un producto **conectado a la tienda** sin
 * abrirle un agujero a la regla de la `0022`, que dice que el panel no escribe
 * sobre la tienda. Las dos cosas conviven porque protegen cosas distintas:
 * aquella impide guardar **una copia** de lo que vive en Shopify, que se
 * desincroniza sin avisar; esto guarda un dato que **en Shopify no existe**.
 * Es fácil decirlo y es fácil que un refactor lo rompa sin que nada falle, así
 * que acá se ejecuta: `setSalesBrief` sobre un conectado escribe,
 * `updateNativeProduct` sobre el mismo conectado lanza.
 *
 * Lo demás que ejercita contra un Postgres de verdad, y no contra fixtures:
 * que la ficha en blanco **borre** en vez de guardar una cadena vacía, que la
 * operación se verifique antes de escribir, y que el bloque del prompt
 * reemplace la descripción de la tienda cuando hay ficha.
 *
 *     docker run -d --name wa-ensayo -e POSTGRES_PASSWORD=test \
 *       -e POSTGRES_DB=wa -p 55995:5432 postgres:16-alpine
 *     DATABASE_URL="postgres://postgres:test@127.0.0.1:55995/wa" \
 *       pnpm --filter @wa/db migrate
 *     DATABASE_URL="postgres://postgres:test@127.0.0.1:55995/wa" SEMBRAR=si \
 *       npx tsx scripts/ficha-de-venta-ensayo.ts
 */
import {
  connectShopifyProduct,
  createNativeProduct,
  deleteProduct,
  eq,
  getDb,
  operations,
  setSalesBrief,
  updateNativeProduct,
  type Operation,
} from "@wa/db";
import { renderProductContextBlock } from "../apps/worker/src/sales/product-context";

/** Hosts que son producción. Contra estos no se escribe nada, nunca. */
const PROHIBIDOS = ["rlwy.net", "railway.app"];

/** Un pedazo de landing, con las tres formas de ruido que trae una de verdad. */
const LANDING = [
  "🔥 Elige tu oferta — la seleccionas en la barra de compra",
  "👇",
  '¿Deseas tu producto? Dale a la barra amarilla "Comprar con envío gratis".',
  "🚚 Envío gratis 💵 Pago contra entrega 🚚 Envío gratis 💵 Pago contra entrega",
  "",
  "B",
  "",
  "Byron M. Ciudad de Guatemala",
  "",
  "★★★★★",
  "",
  "Llevo dos meses y se me nota menos caída en la ducha.",
  "",
  "✓ Compra verificada",
  "",
  "💊 ¿Cómo tomarlo? 2 cápsulas por día, 20–30 min antes de comer.",
].join("\n");

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

function afirmar(condicion: boolean, dice: string) {
  console.log(`  ${condicion ? "✅" : "❌"} ${dice}`);
  if (!condicion) process.exitCode = 1;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL requerido");
  const host = hostDe(url);

  if (PROHIBIDOS.some((p) => host.includes(p))) {
    console.error(
      `\n  ${host} es producción. Este script no escribe ahí.\n` +
        `  Escribe y borra productos del catálogo, que en producción son los que venden.\n`,
    );
    process.exit(1);
  }
  if (process.env.SEMBRAR !== "si") {
    console.error(
      `\n  Va a crear y borrar productos en ${host}.\n` +
        `  Volvé a correrlo con SEMBRAR=si si es la base de ensayo.\n`,
    );
    process.exit(1);
  }

  const db = getDb();
  const [primera] = (await db.select().from(operations)) as Operation[];
  if (!primera) throw new Error("no hay ninguna operación: falta correr las migraciones");

  const conectado = await connectShopifyProduct(primera, "gid://shopify/Product/ensayo-ficha");
  const nativo = await createNativeProduct(primera, {
    name: "Combo de ensayo",
    description: "dos frascos",
  });

  try {
    titulo("La ficha se escribe sobre las dos fuentes");
    const conFicha = await setSalesBrief(primera, conectado.id, "  2 cápsulas al día.  ");
    afirmar(
      conFicha.salesBrief === "2 cápsulas al día.",
      "un producto CONECTADO acepta ficha, y llega recortada",
    );
    const nativoConFicha = await setSalesBrief(primera, nativo.id, "ficha del nativo");
    afirmar(nativoConFicha.salesBrief === "ficha del nativo", "un producto NATIVO también");

    titulo("Y la regla que protege a la tienda sigue en pie");
    let lanzo = false;
    try {
      await updateNativeProduct(primera, conectado.id, { description: "copia de la tienda" });
    } catch {
      lanzo = true;
    }
    afirmar(lanzo, "el panel sigue sin poder escribir la descripción de un conectado");

    titulo("La ficha en blanco borra, no guarda vacío");
    const borrada = await setSalesBrief(primera, conectado.id, "   ");
    afirmar(
      borrada.salesBrief === null,
      "quitarla devuelve el producto a leer la tienda, que es el estado de partida",
    );

    titulo("La operación se verifica antes de escribir");
    const [otra] = await db
      .insert(operations)
      .values({ name: "Ensayo cruzado", countryCode: "XX", currency: "XXX" })
      .returning();
    let rechazo = false;
    try {
      await setSalesBrief(otra as Operation, conectado.id, "de otra operación");
    } catch {
      rechazo = true;
    }
    afirmar(rechazo, "una operación ajena no puede escribirle la ficha a este producto");
    await db.delete(operations).where(eq(operations.id, (otra as Operation).id));

    titulo("Y en el prompt, la ficha reemplaza a la landing");
    const sinFicha = renderProductContextBlock({
      name: "Producto de ensayo",
      salesBrief: null,
      description: LANDING,
      price: null,
      variants: [],
    });
    afirmar(!sinFicha.includes("👇"), "sin ficha, la landing entra limpia de adorno");
    afirmar(!sinFicha.includes("Byron M."), "y sin la reseña, que se va entera");
    afirmar(
      sinFicha.split("Envío gratis").length - 1 === 1,
      "la marquesina repetida se dice una sola vez",
    );
    afirmar(
      sinFicha.includes("2 cápsulas por día"),
      "y lo que hacía falta —la dosis, que vive al final— llega",
    );
    afirmar(
      sinFicha.includes("no la mandes a hacer clic en nada"),
      "con el aviso de que eso es una página web y el cliente no la tiene delante",
    );

    const conBrief = renderProductContextBlock({
      name: "Producto de ensayo",
      salesBrief: "2 cápsulas al día con agua. No en embarazo.",
      description: LANDING,
      price: null,
      variants: [],
    });
    afirmar(!conBrief.includes("barra amarilla"), "con ficha, la landing no entra");
    afirmar(!conBrief.includes("página web"), "ni el aviso, que ya no describe nada");
    afirmar(conBrief.includes("No en embarazo"), "y se lee la ficha entera");
  } finally {
    await deleteProduct(primera, conectado.id);
    await deleteProduct(primera, nativo.id);
  }

  console.log(
    process.exitCode === 1
      ? "\n  Algo no se comportó como dice el diseño.\n"
      : "\n  Todo se comportó como dice el diseño.\n",
  );
  process.exit(process.exitCode ?? 0);
}

main();
