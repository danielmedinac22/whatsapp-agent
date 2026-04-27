import {
  getDb,
  getRawClient,
  templates,
  agentSettings,
  eq,
} from "@wa/db";

const FOLLOWUP_BODY = `Hola {{nombre}}👋

Te escribimos desde Tienda Vorare para confirmar que tu pedido de {{producto}} ya quedó reservado en nuestro sistema ✅

Para enviarlo hoy mismo necesitamos validar los siguientes datos:

📍 Dirección de entrega:
🏙 Ciudad / Barrio:
📞 Número de contacto:
💵 Pago contra entrega: Q{{total}}

Por favor respóndenos confirmando que todos los datos están correctos para proceder con el despacho 🚚📦

Una vez confirmado, tu pedido sera despachado en ruta.

¡Gracias por tu compra! 💚`;

const REMARKETING_BODY = `Hola {{nombre}} 😊✨
Te escribimos porque realizaste un pedido con nosotros a través de nuestra página web 🛍️

Queríamos confirmarlo contigo para poder despacharlo lo antes posible 🚚💨

Quedamos muy atentos a tu confirmación.
¡Muchas gracias! 💚`;

async function upsertTemplate(name: string, body: string, vars: string[]) {
  const db = getDb();
  const existing = await db
    .select()
    .from(templates)
    .where(eq(templates.name, name))
    .limit(1);
  if (existing[0]) {
    await db
      .update(templates)
      .set({ body, variables: vars, updatedAt: new Date() })
      .where(eq(templates.id, existing[0].id));
    return existing[0].id;
  }
  const [created] = await db
    .insert(templates)
    .values({ name, body, variables: vars })
    .returning();
  return created!.id;
}

async function main() {
  const db = getDb();

  const followupId = await upsertTemplate("shopify_followup", FOLLOWUP_BODY, [
    "nombre",
    "producto",
    "total",
  ]);
  const remarketingId = await upsertTemplate(
    "remarketing_3hr",
    REMARKETING_BODY,
    ["nombre"],
  );

  await db
    .insert(agentSettings)
    .values({
      id: 1,
      followupTemplateId: followupId,
      remarketingTemplateId: remarketingId,
      remarketingDelayMs: 3 * 60 * 60 * 1000,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: agentSettings.id,
      set: {
        followupTemplateId: followupId,
        remarketingTemplateId: remarketingId,
        remarketingDelayMs: 3 * 60 * 60 * 1000,
        updatedAt: new Date(),
      },
    });

  console.log("Seeded:");
  console.log(`  shopify_followup → ${followupId}`);
  console.log(`  remarketing_3hr  → ${remarketingId}`);
  console.log("agent_settings updated to use both templates.");
  await getRawClient().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
