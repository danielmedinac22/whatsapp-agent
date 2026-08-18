/**
 * Deja una base **de ensayo** con las dos bandejas llenas, para poder mirar el
 * Inbox por módulo con el estado difícil.
 *
 * Existe por el hallazgo del árbol de diseño: **el estado fácil aprueba por la
 * razón equivocada**. Hoy en producción `resolveInbox` manda a ventas toda
 * conversación sin pedido, y como Guatemala vende por la tienda casi todas
 * tienen uno: la bandeja de ventas queda **casi vacía**. Eso es correcto, no un
 * bug — y es exactamente el estado con el que no se puede aprobar una pantalla.
 * Una bandeja vacía se ve ordenada, navega perfecto y no prueba nada.
 *
 * Lo que siembra, y por qué cada cosa:
 *
 * - **Un vendedor configurado** (`sales_agent_settings`), que es el interruptor:
 *   sin fila no hay segunda bandeja y el panel es el de siempre.
 * - **Leads de anuncio**, con producto reconocido y sin reconocer, para ver que
 *   la fila solo marca lo que NO quedó limpio.
 * - **Una escalada de verdad**, encolada con la misma clave de deduplicación
 *   que escribe `escalateToHuman`, que es de donde el hilo saca el motivo.
 * - **Un recomprador**: pedido entregado y clic de anuncio posterior. Tiene que
 *   estar en ventas aunque tenga pedidos.
 * - **Una conversación asignada que ya cambió de bandeja**: se le vendió, se le
 *   creó el pedido después de asignarla, y al abrir la bandeja tiene que
 *   aparecer libre — y quedar libre en la base.
 * - **Pedidos en curso**, para que la bandeja de operaciones no quede vacía y se
 *   pueda comparar con lo que Katherine ve hoy.
 *
 * Cargar datos de verdad es un acto del dueño de la operación, no de un agente:
 * por eso este script se niega a correr contra producción y pide confirmación.
 *
 *     docker run -d --name wa-bandejas -e POSTGRES_PASSWORD=test \
 *       -e POSTGRES_DB=wa -p 55991:5432 postgres:16-alpine
 *     DATABASE_URL="postgres://postgres:test@127.0.0.1:55991/wa" \
 *       pnpm --filter @wa/db migrate
 *     DATABASE_URL="postgres://postgres:test@127.0.0.1:55991/wa" SEMBRAR=si \
 *       npx tsx scripts/seed-bandejas-ensayo.ts
 */
import {
  contacts,
  conversations,
  dropiOrders,
  getDb,
  messages,
  operations,
  outboundMessages,
  productAds,
  products,
  salesAgentSettings,
  shopifyOrders,
  sql,
  users,
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

/** Días hacia atrás desde ahora, para que las fechas se lean como una historia. */
function haceDias(d: number): Date {
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000);
}

function haceHoras(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL requerido");
  const host = hostDe(url);

  if (PROHIBIDOS.some((p) => host.includes(p))) {
    console.error(
      `\n  ${host} es producción. Este script no siembra ahí.\n` +
        `  La bandeja de ventas casi vacía de producción es la verdad, no un bug.\n`,
    );
    process.exit(1);
  }
  if (process.env.SEMBRAR !== "si") {
    console.error(
      `\n  Va a escribir conversaciones, pedidos y escaladas en ${host}.\n` +
        `  Volvé a correrlo con SEMBRAR=si si es la base de ensayo.\n`,
    );
    process.exit(1);
  }

  const db = getDb();
  const [op] = (await db.select().from(operations)) as Operation[];
  if (!op) throw new Error("no hay ninguna operación: falta correr las migraciones");

  // Se limpia lo que este script siembra, para que correrlo dos veces no
  // duplique la bandeja. El orden respeta las llaves foráneas.
  await db.execute(sql`delete from outbound_messages`);
  await db.execute(sql`delete from messages`);
  await db.execute(sql`delete from dropi_orders`);
  await db.execute(sql`delete from shopify_orders`);
  await db.execute(sql`delete from conversations`);
  await db.execute(sql`delete from contacts`);
  await db.execute(sql`delete from product_ads`);
  await db.execute(sql`delete from products`);
  await db.execute(sql`delete from sales_agent_settings`);

  // ── El interruptor: con vendedor hay dos bandejas ────────────────────────
  await db.insert(salesAgentSettings).values({
    operationId: op.id,
    displayName: "Sebastián",
    greeting: "¡Hola! Soy Sebastián 👋",
    closingPush: "¿Te lo aparto?",
    funnelMessage: "Contame qué buscás",
    toneInstructions: "Cercano, sin presionar.",
    discountLimitPct: 10,
  });

  // Dos asesores, para que «la trabaja otro» sea de verdad otro.
  const [ana, luis] = await db
    .insert(users)
    .values([
      {
        email: "ana@ensayo.local",
        passwordHash: "x",
        name: "Ana",
        role: "admin" as const,
      },
      {
        email: "luis@ensayo.local",
        passwordHash: "x",
        name: "Luis",
        role: "admin" as const,
      },
    ])
    .returning({ id: users.id });

  // ── El catálogo, para que el reconocimiento tenga qué nombrar ────────────
  const productosSembrados = await db
    .insert(products)
    .values([
      {
        operationId: op.id,
        source: "native" as const,
        name: "REVITALHAIR – DHT ANTICALVICIE",
        description: "Tratamiento en cápsulas, 3 meses.",
      },
      {
        operationId: op.id,
        source: "native" as const,
        name: "REVITALHAIR Serum Capilar",
        description: "Serum de aplicación diaria.",
      },
    ])
    .returning({ id: products.id, name: products.name });
  const dht = productosSembrados[0]!;
  const serum = productosSembrados[1]!;

  await db.insert(productAds).values([
    { operationId: op.id, adId: "23851094782", productId: dht.id },
    { operationId: op.id, adId: "23851094999", productId: dht.id },
    { operationId: op.id, adId: "23851094999", productId: serum.id },
  ]);

  // ── Las conversaciones ───────────────────────────────────────────────────
  interface Semilla {
    nombre: string;
    waId: string;
    agentMode: boolean;
    unread: number;
    preview: string;
    /** Clic de anuncio, si vino de uno. */
    anuncio?: { adId: string; headline: string; at: Date };
    /** Producto que el reconocimiento resolvió. */
    productoId?: string;
    /** Escalada que salió de verdad, con su motivo. */
    escalada?: { motivo: string; at: Date };
    /** Pedidos de tienda del contacto. */
    pedidos?: Array<{
      at: Date;
      status:
        | "received"
        | "followup_scheduled"
        | "followup_sent"
        | "confirmed"
        | "no_response"
        | "cancelled";
      dropi?: {
        status:
          | "pendiente_confirmacion"
          | "en_transito"
          | "entregado"
          | "novedad";
      };
    }>;
    /** Quién la está trabajando, y desde cuándo. */
    asignada?: { userId: string; at: Date };
  }

  const semillas: Semilla[] = [
    // ── Bandeja de VENTAS ──────────────────────────────────────────────────
    {
      nombre: "Lucía Morales",
      waId: "50255510001",
      agentMode: false,
      unread: 3,
      preview: "¿Y sirve para entradas?",
      anuncio: {
        adId: "23851094782",
        headline: "Frena la caída del cabello",
        at: haceHoras(3),
      },
      productoId: dht.id,
    },
    {
      nombre: "Marta Quiñónez",
      waId: "50255510002",
      agentMode: true,
      unread: 0,
      preview: "Perfecto, ¿cuánto sale el combo?",
      anuncio: {
        adId: "23851094999",
        headline: "Combo capilar REVITALHAIR",
        at: haceHoras(9),
      },
      // Anuncio compartido por dos productos: el reconocimiento no eligió.
    },
    {
      nombre: "Julio Estrada",
      waId: "50255510003",
      agentMode: false,
      unread: 1,
      preview: "Prefiero hablar con una persona",
      anuncio: {
        adId: "23851094999",
        headline: "Combo capilar REVITALHAIR",
        at: haceDias(1),
      },
      escalada: { motivo: "sales_human_requested", at: haceHoras(20) },
    },
    {
      nombre: "Wendy Sactic",
      waId: "50255510004",
      agentMode: false,
      unread: 2,
      preview: "no entendí cuál es",
      anuncio: {
        adId: "23851094999",
        headline: "Combo capilar REVITALHAIR",
        at: haceDias(2),
      },
      escalada: { motivo: "sales_product_unidentified", at: haceDias(2) },
    },
    {
      nombre: "Byron Chacón",
      waId: "50255510005",
      agentMode: true,
      unread: 0,
      preview: "Gracias, lo pienso",
      anuncio: {
        adId: "23851094782",
        headline: "Frena la caída del cabello",
        at: haceDias(3),
      },
      productoId: dht.id,
      asignada: { userId: luis!.id, at: haceDias(2) },
    },
    {
      // El recomprador: pedido entregado y clic NUEVO después. Va a ventas.
      nombre: "Rosa Ixcot",
      waId: "50255510006",
      agentMode: false,
      unread: 1,
      preview: "quiero pedir otra vez",
      anuncio: {
        adId: "23851094782",
        headline: "Frena la caída del cabello",
        at: haceHoras(6),
      },
      productoId: dht.id,
      pedidos: [
        { at: haceDias(40), status: "confirmed", dropi: { status: "entregado" } },
      ],
    },
    {
      // Lead viejo sin anuncio: entró escribiendo al número. También es ventas.
      nombre: "+502 5551 0007",
      waId: "50255510007",
      agentMode: true,
      unread: 0,
      preview: "buenas, información",
    },

    // ── Bandeja de OPERACIONES ─────────────────────────────────────────────
    {
      nombre: "Karla Pérez",
      waId: "50255510010",
      agentMode: true,
      unread: 0,
      preview: "Sí, confirmo la dirección",
      pedidos: [
        {
          at: haceDias(2),
          status: "confirmed",
          dropi: { status: "en_transito" },
        },
      ],
    },
    {
      nombre: "Delfino Ramos",
      waId: "50255510011",
      agentMode: false,
      unread: 4,
      preview: "no me llegó nada todavía",
      pedidos: [
        { at: haceDias(6), status: "confirmed", dropi: { status: "novedad" } },
      ],
    },
    {
      nombre: "Sofía Tzoc",
      waId: "50255510012",
      agentMode: true,
      unread: 0,
      preview: "listo, gracias",
      pedidos: [
        {
          at: haceDias(1),
          status: "received",
          dropi: { status: "pendiente_confirmacion" },
        },
      ],
    },
    {
      /**
       * La que prueba el criterio 4: se le asignó cuando era un lead de ventas
       * y **después** cerró la venta. Al abrir la bandeja tiene que aparecer
       * libre, y las dos columnas tienen que quedar en `null` en la base.
       */
      nombre: "Elena Barrios",
      waId: "50255510013",
      agentMode: false,
      unread: 1,
      preview: "ya hice el pedido",
      anuncio: {
        adId: "23851094782",
        headline: "Frena la caída del cabello",
        at: haceDias(5),
      },
      productoId: dht.id,
      asignada: { userId: ana!.id, at: haceDias(4) },
      pedidos: [
        {
          at: haceDias(2),
          status: "confirmed",
          dropi: { status: "pendiente_confirmacion" },
        },
      ],
    },
  ];

  let pedidoNumero = 10400;
  for (const s of semillas) {
    const [contacto] = await db
      .insert(contacts)
      .values({
        waId: s.waId,
        jid: `${s.waId}@s.whatsapp.net`,
        phone: `+${s.waId}`,
        name: s.nombre,
        agentMode: s.agentMode,
        lastMessageAt: haceHoras(1),
      })
      .returning({ id: contacts.id });

    const [conv] = await db
      .insert(conversations)
      .values({
        contactId: contacto!.id,
        operationId: op.id,
        lastInboundAt: haceHoras(1),
        lastOutboundAt: haceHoras(2),
        lastMessagePreview: s.preview,
        unreadCount: s.unread,
        adId: s.anuncio?.adId ?? null,
        adHeadline: s.anuncio?.headline ?? null,
        adReferralAt: s.anuncio?.at ?? null,
        productId: s.productoId ?? null,
        assignedUserId: s.asignada?.userId ?? null,
        assignedAt: s.asignada?.at ?? null,
      })
      .returning({ id: conversations.id });

    await db.insert(messages).values([
      {
        conversationId: conv!.id,
        direction: "in" as const,
        body: s.preview,
        createdAt: haceHoras(1),
      },
      {
        conversationId: conv!.id,
        direction: "out" as const,
        body: "Con gusto, ya te cuento 🙌",
        fromAgent: true,
        status: "read" as const,
        createdAt: haceMinutos(50),
      },
    ]);

    for (const p of s.pedidos ?? []) {
      pedidoNumero += 1;
      const [pedido] = await db
        .insert(shopifyOrders)
        .values({
          operationId: op.id,
          contactId: contacto!.id,
          orderId: `#${pedidoNumero}`,
          customerName: s.nombre,
          customerPhone: `+${s.waId}`,
          totalPrice: "349.00",
          status: p.status,
          receivedAt: p.at,
          rawPayload: {
            line_items: [{ title: "REVITALHAIR – DHT ANTICALVICIE" }],
          },
        })
        .returning({ id: shopifyOrders.id });
      if (p.dropi) {
        await db.insert(dropiOrders).values({
          operationId: op.id,
          contactId: contacto!.id,
          shopifyOrderRowId: pedido!.id,
          dropiOrderId: pedidoNumero,
          customerName: s.nombre,
          status: p.dropi.status,
          createdAt: p.at,
        });
      }
    }

    if (s.escalada) {
      // La misma forma que escribe `escalateToHuman`: es de donde el panel saca
      // el motivo, así que sembrar otra cosa probaría otra cosa.
      const hora = Math.floor(s.escalada.at.getTime() / 3_600_000);
      await db.insert(outboundMessages).values({
        toWaId: s.waId,
        body: "¡Claro! 🙌 Un asesor te escribe por aquí en unos minutos.",
        source: "escalation" as const,
        dedupKey: `escalation-customer-${contacto!.id}-${s.escalada.motivo}-${hora}`,
        status: "sent" as const,
        createdAt: s.escalada.at,
      });
    }
  }

  console.log(
    `\n  Sembrado en ${host}:\n` +
      `    · vendedor «Sebastián» configurado — la operación tiene dos bandejas\n` +
      `    · ${semillas.length} conversaciones, ${productosSembrados.length} productos, 3 mapeos de anuncio\n` +
      `    · asesores: ana@ensayo.local y luis@ensayo.local\n\n` +
      `  Qué mirar:\n` +
      `    · Ventas trae 7 y Operaciones 4 — Rosa Ixcot está en ventas CON pedido entregado\n` +
      `    · solo Marta, Julio y Wendy llevan marca en la fila; el resto no\n` +
      `    · Elena Barrios estaba asignada a Ana y aparece libre: cambió de bandeja\n`,
  );
}

function haceMinutos(m: number): Date {
  return new Date(Date.now() - m * 60 * 1000);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
