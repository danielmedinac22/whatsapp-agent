import { getDb, getRawClient, templates, eq } from "@wa/db";

async function main() {
  const db = getDb();
  const newBody =
    "¡Hola {{nombre}}! 👋 Soy de Vorare Store Guatemala. Vimos que hiciste un pedido pero aún no nos has confirmado. ¿Quieres continuar con el envío? Recuerda que tenemos pago contra entrega y envío gratis 🚚";

  await db
    .update(templates)
    .set({ body: newBody, variables: ["nombre"] })
    .where(eq(templates.name, "shopify_followup"));

  console.log("ok");
  await getRawClient().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
