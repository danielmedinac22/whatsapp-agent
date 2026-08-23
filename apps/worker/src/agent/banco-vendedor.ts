/**
 * El banco de pruebas del vendedor: **oír a Sebastián sin encenderlo.**
 *
 * Es el hermano de `agent/preview.ts`, que hace lo propio con Katherine, y
 * existe por una razón que no es comodidad. Hasta hoy la única forma de saber
 * cómo contesta el vendedor era escribirle un nombre visible en el panel, y ese
 * guardado hace dos cosas: enciende el módulo **y estampa `activated_at`**, la
 * línea de corte que decide qué conversación es de quién. Esa fecha no se vuelve
 * a mover nunca (`apps/web/src/lib/vendedor.ts`), así que **probar costaba una
 * decisión irreversible**. Acá no se guarda nada: la configuración viaja en la
 * petición tal como está en el formulario, sin pasar por la base.
 *
 * ## Qué comparte con producción, que es de dónde sale su valor
 *
 * El prompt lo arma `buildEffectiveSystemPrompt` con la misma rama de ventas
 * que usa el runner, y la línea del pedido la resuelve `resolveClosingLine`, la
 * misma función que la herramienta de verdad. Un banco que compusiera su propio
 * prompt probaría otro vendedor.
 *
 * ## Qué no comparte, y es todo lo que escribe
 *
 * - **No manda WhatsApp.** No encola nada.
 * - **No escribe en `agent_runs`.** Una prueba no es una corrida del agente, y
 *   contarla como tal envenenaría justo la tabla donde se mira si el agente se
 *   está cayendo.
 * - **No escala.** La herramienta real llama a `escalateToHuman`, que le avisa
 *   al cliente, apaga el modo agente y le suena el teléfono al admin. Acá el
 *   escalamiento se **reporta**: el modelo recibe el mismo texto y nadie se
 *   entera afuera.
 * - **No crea el pedido**, ni siquiera cuando la escritura a la tienda está
 *   encendida. Llega hasta `buildSalesOrder` —que es puro— y devuelve el
 *   borrador para que se vea en pantalla. Ese corte es deliberado: el banco
 *   tiene que poder usarse el día que `SHOPIFY_ORDER_WRITE_MODE` esté en `live`
 *   sin que probar signifique vender.
 *
 * ## Y lo único que un banco no puede simular
 *
 * El clic del anuncio. En producción de qué producto habla el lead lo deduce la
 * cascada de reconocimiento a partir de la referencia CTWA; acá lo elige quien
 * prueba. Por eso {@link BancoInput.productId} acepta `null` y
 * `candidateIds`: son los otros dos estados reales de la cascada —no reconoció
 * nada, y dudó entre varios—, y hay que poder verlos, porque son los que
 * decidirá una conversación que llega sin anuncio.
 */

import { generateText, stepCountIs, tool, type ModelMessage } from "ai";
import { type Operation } from "@wa/db";
import {
  parseSalesDiscountBehavior,
  type SalesAgentSettingsInput,
} from "@wa/shared";
import { getShopifyConnection } from "../shopify/admin";
import { logger } from "../lib/logger";
import {
  buildSalesOrder,
  salesOrderStore,
  type SalesOrderDraft,
  type SalesOrderError,
} from "../sales/order";
import {
  capturedToClosing,
  closingCaptureSchema,
  CLOSING_TOOL_NAME,
  MAX_QUANTITY,
  quantityOutOfRange,
  type ClosingCapture,
} from "../sales/closing-capture";
import {
  closingCorrectionMessage,
  closingPendingMessage,
  funnelHandoffMessage,
  orderRegisteredMessage,
  type CreatedOrderSummary,
} from "../sales/closing-messages";
import { salesReasoningOptions } from "../sales/model";
import { storeWriteMode, type StoreWriteMode } from "../shopify/write-mode";
import { customerNoticeFor } from "./escalation";
import { buildEffectiveSystemPrompt } from "./effective-prompt";
import { resolveClosingLine } from "./sales-closing-tool";
import { openrouter } from "./openrouter";
import { TECHO_DE_RESPUESTA } from "./techo-de-respuesta";

/** Un turno de la conversación de prueba, tal como lo manda la pantalla. */
export interface BancoTurn {
  role: "user" | "assistant";
  content: string;
}

export interface BancoInput {
  /** La configuración del formulario, **sin guardar**. */
  settings: SalesAgentSettingsInput;
  /** De qué producto viene el lead: lo que el anuncio habría resuelto. */
  productId: string | null;
  /** Entre qué dudó la cascada, para probar la pregunta con lista corta. */
  candidateIds?: readonly string[] | null;
  /** La conversación completa. El banco no guarda estado. */
  turns: readonly BancoTurn[];
}

/**
 * Qué pasó con el pedido en este turno. `null` cuando el vendedor no intentó
 * cerrar, que es la mayoría de los turnos.
 *
 * Son los mismos casos que la herramienta real distingue, con una diferencia de
 * nombre que importa: acá el pedido nunca queda «registrado», queda
 * **armado**. Llamarlo registrado en una pantalla de pruebas sería la misma
 * mentira que el modo seco existe para no decirle al cliente.
 */
export type BancoPedido =
  | {
      kind: "armado";
      order: SalesOrderDraft;
      /** El descuento se pasó del límite y se cobró el autorizado. */
      discountClamped: boolean;
      requestedPct: number;
      appliedPct: number;
    }
  | { kind: "faltan_datos"; errors: readonly SalesOrderError[] }
  | { kind: "falta_la_presentacion"; opciones: readonly string[] }
  | {
      kind: "a_un_asesor";
      motivo: string;
      /** El mismo motivo con el que producción escalaría, para citar su texto. */
      reason: "sales_out_of_rules" | "sales_product_unidentified";
    }
  /** No hay tienda conectada: en producción el cierre se encola y espera. */
  | { kind: "sin_tienda" };

/**
 * Lo que el cliente leería en este turno, que **no siempre es lo que el modelo
 * escribió**.
 *
 * Es la corrección más importante que se le hizo a este banco. En un turno de
 * cierre el texto del vendedor casi nunca sale: `resolveSalesTurnText` lo
 * reemplaza por un texto fijo o lo calla del todo, porque se midió que el
 * modelo, al recibir el resultado de la herramienta, redacta «tu pedido quedó
 * registrado» — una frase que es cierta o falsa según cómo terminó el cierre y
 * que él no está en condiciones de calificar. Un banco que mostrara su texto
 * como si fuera lo que el cliente lee enseñaría un mensaje que producción no
 * manda, justo en el turno que más importa.
 */
export interface TurnoDelCliente {
  /** En orden, lo que le llegaría al teléfono. Vacío = no le llega nada. */
  textos: readonly string[];
  /** Quién lo redactó: el vendedor, o el sistema por encima de él. */
  fuente: "modelo" | "sistema";
}

export interface BancoResult {
  /**
   * Lo que el modelo redactó, **salga o no**. Se devuelve siempre porque la
   * diferencia entre lo que quiso decir y lo que sale es lo que hace entender
   * por qué el cierre no lo deja hablar.
   */
  reply: string;
  /** Lo que el cliente leería de verdad en este turno. */
  cliente: TurnoDelCliente;
  /** El modo de escritura vigente del worker, que decide el caso bueno. */
  writeMode: StoreWriteMode;
  /** El prompt completo que recibió el modelo, bloques automáticos incluidos. */
  effectiveSystemPrompt: string;
  /** Si tenía la herramienta de cierre en este turno. */
  podiaCerrar: boolean;
  pedido: BancoPedido | null;
}

/**
 * Un turno del vendedor contra la configuración del formulario.
 *
 * Lee de la base —el producto, el catálogo de la pregunta, la conexión de la
 * tienda— y de la tienda si el producto es de allá, todo en solo lectura.
 */
export async function correrBancoDelVendedor(
  operation: Operation,
  input: BancoInput,
): Promise<BancoResult> {
  const settings = input.settings;
  const persona = {
    ...settings,
    discountLimitBehavior: parseSalesDiscountBehavior(
      settings.discountLimitBehavior,
    ),
  };

  const systemPrompt = await buildEffectiveSystemPrompt({
    agent: "sales",
    operation,
    persona,
    productId: input.productId,
    candidateIds: input.candidateIds ?? null,
  });

  // La misma condición que el runner: sin producto identificado no hay línea
  // que armar, y lo que corresponde es que pregunte cuál es. Se saca a una
  // const para que el estrechamiento llegue hasta la herramienta, que pide el
  // producto no nulo justamente para que no se pueda armar una sin él.
  const productId = input.productId;

  // Cómo terminó el intento de cierre, si lo hubo. Igual que en producción, la
  // herramienta lo rellena desde adentro del SDK y se lee al volver.
  const capturado: { pedido: BancoPedido | null } = { pedido: null };

  const messages: ModelMessage[] = input.turns.map((t) => ({
    role: t.role,
    content: t.content,
  }));

  const provider = openrouter();
  const result = await generateText({
    model: provider(settings.model),
    system: systemPrompt,
    messages,
    maxOutputTokens: TECHO_DE_RESPUESTA,
    ...(productId !== null
      ? {
          tools: bancoClosingTool({
            operation,
            productId,
            settings,
            capturado,
          }),
          stopWhen: stepCountIs(2),
        }
      : {}),
    ...salesReasoningOptions(settings),
  });

  const pedido = capturado.pedido;
  const writeMode = storeWriteMode();

  return {
    reply: result.text.trim(),
    // Lo que el cliente leería, que en un turno de cierre casi nunca es el
    // texto de arriba. Ver {@link mensajesAlCliente}.
    cliente: mensajesAlCliente({
      pedido,
      modelText: result.text,
      writeMode,
      funnelMessage: settings.funnelMessage,
      resumen: pedido?.kind === "armado" ? resumenDelPedido(pedido.order) : null,
    }),
    writeMode,
    effectiveSystemPrompt: systemPrompt,
    podiaCerrar: productId !== null,
    pedido,
  };
}

/**
 * El borrador, dicho como lo dice el mensaje de «tu pedido quedó registrado».
 *
 * El número de pedido **no se inventa con una forma de número**: acá no hay
 * pedido y no lo va a haber, y un `#1042` de mentira en una pantalla de pruebas
 * es exactamente lo que alguien copia después creyendo que existió.
 */
function resumenDelPedido(order: SalesOrderDraft): CreatedOrderSummary {
  return {
    orderName: "(el número se lo pone la tienda)",
    productSummary: order.lines
      .map((l) => (l.quantity > 1 ? `${l.quantity} × ${l.title}` : l.title))
      .join(", "),
    total: order.totals.total,
    currency: order.currency,
    destination:
      order.shipping.kind === "delivery"
        ? `${order.shipping.address} — ${order.shipping.city}, ${order.shipping.division}`
        : `${order.shipping.city}, ${order.shipping.division}`,
    pickupAtOffice: order.shipping.kind === "pickup_at_office",
  };
}

/**
 * La herramienta de cierre del banco: **corre el camino entero menos el
 * último paso.**
 *
 * Recorre lo mismo que la de producción —cantidad, línea contra el catálogo y
 * la tienda, construcción y validación del pedido— y se detiene justo antes de
 * `closeSale`, que es la única función de todo ese camino que escribe. Lo que
 * cambia es a quién le habla el resultado: en producción va a la tienda y al
 * cliente, acá va a la pantalla.
 *
 * El `detalle` que recibe el modelo dice **la verdad del banco**, no la de
 * producción. Decirle «quedó registrado» lo llevaría a confirmarle a quien está
 * probando un pedido que no existe, y aprenderíamos de su tono con un dato
 * falso en la conversación.
 */
function bancoClosingTool(ctx: {
  operation: Operation;
  productId: string;
  settings: SalesAgentSettingsInput;
  capturado: { pedido: BancoPedido | null };
}) {
  return {
    [CLOSING_TOOL_NAME]: tool({
      description:
        "Registra el pedido del cliente con los datos que te dio en la conversación. " +
        "Llámala solo cuando ya tengas nombre, apellido, teléfono, departamento, municipio " +
        "y dirección (o que reclama en oficina). El sistema valida los datos, crea el pedido " +
        "y le confirma al cliente por este mismo chat.",
      inputSchema: closingCaptureSchema,
      execute: async (capture: ClosingCapture) => {
        const pedido = await armarEnPrueba(ctx, capture);
        ctx.capturado.pedido = pedido;
        if (pedido.kind === "armado") {
          logger.info(
            {
              operationId: ctx.operation.id,
              total: pedido.order.totals.total,
              clamped: pedido.discountClamped,
            },
            "banco del vendedor: pedido armado, no creado",
          );
        }
        return reporteDelBanco(pedido);
      },
    }),
  };
}

/**
 * El camino del cierre hasta el borrador, sin el paso que escribe.
 *
 * Es el mismo orden de comprobaciones que la herramienta de producción, y por
 * el mismo motivo: es el orden en el que alguien puede actuar.
 */
async function armarEnPrueba(
  ctx: {
    operation: Operation;
    productId: string;
    settings: SalesAgentSettingsInput;
  },
  capture: ClosingCapture,
): Promise<BancoPedido> {
  if (quantityOutOfRange(capture.cantidad)) {
    return {
      kind: "a_un_asesor",
      motivo: `Intentó cerrar ${capture.cantidad} unidades y el máximo automático es ${MAX_QUANTITY}.`,
      reason: "sales_out_of_rules",
    };
  }

  const resolution = await resolveClosingLine(
    ctx.operation,
    ctx.productId,
    capture,
  );

  if (resolution.kind === "ambiguous_variant") {
    return { kind: "falta_la_presentacion", opciones: resolution.options };
  }

  if (resolution.kind === "no_product") {
    return {
      kind: "a_un_asesor",
      motivo: "El producto elegido no está en el catálogo de esta operación.",
      reason: "sales_product_unidentified",
    };
  }

  if (resolution.kind === "not_sellable") {
    return {
      kind: "a_un_asesor",
      motivo: `No se pudo armar la línea del pedido: ${resolution.detail}.`,
      reason: "sales_out_of_rules",
    };
  }

  // La tienda se lee, no se escribe: de acá salen el dominio y la moneda con
  // los que el pedido se habría armado. Sin conexión, en producción el cierre
  // se encola con sus datos completos y espera — no se pierde.
  const connection = await getShopifyConnection(ctx.operation);
  const store = salesOrderStore(ctx.operation, connection);
  if (!store) return { kind: "sin_tienda" };

  const built = buildSalesOrder({
    store,
    closing: capturedToClosing({
      leadRef: BANCO_LEAD_REF,
      capture,
      line: resolution.line,
    }),
    settings: {
      discountLimitPct: ctx.settings.discountLimitPct,
      sellerName: ctx.settings.displayName,
    },
  });

  if (!built.ok) return { kind: "faltan_datos", errors: built.errors };

  return {
    kind: "armado",
    order: built.order,
    discountClamped: built.discount.clamped,
    requestedPct: built.discount.requestedPct,
    appliedPct: built.discount.appliedPct,
  };
}

/**
 * Qué leería el cliente en este turno. **Puro.**
 *
 * Es la tabla de `resolveSalesTurnText` y `closingTurnVoice` dicha desde el
 * banco, con los textos que producción manda de verdad. Las reglas, en orden:
 *
 * - **Sin intento de cierre** —la mayoría de los turnos— sale el texto del
 *   modelo, que es la conversación de siempre.
 * - **Presentación sin elegir** también: la herramienta volvió sin cerrar nada y
 *   quien tiene que preguntar cuál quiere es el vendedor.
 * - **Pedido armado** depende del interruptor de escritura. En seco —hoy— el
 *   cliente recibe el texto fijo que dice que sus datos están y **no** que el
 *   pedido exista. Con la escritura encendida recibe el pedido con su número y
 *   el mensaje de embudo, y el texto del modelo no sale en ninguno de los dos.
 * - **Faltan datos** sale la corrección con todo lo que falta junto.
 * - **A un asesor** sale el aviso de cortesía del escalamiento, el mismo texto.
 * - **Sin tienda** es el caso encolado: el mismo texto fijo del modo seco,
 *   porque para el cliente los dos significan lo mismo.
 */
export function mensajesAlCliente(input: {
  pedido: BancoPedido | null;
  modelText: string;
  writeMode: StoreWriteMode;
  /** `funnel_message` del borrador, para el mensaje de embudo. */
  funnelMessage: string;
  /** El resumen del pedido armado. `null` cuando no hay pedido que anunciar. */
  resumen: CreatedOrderSummary | null;
}): TurnoDelCliente {
  const p = input.pedido;

  if (p === null || p.kind === "falta_la_presentacion") {
    const texto = input.modelText.trim();
    return { textos: texto ? [texto] : [], fuente: "modelo" };
  }

  switch (p.kind) {
    case "armado":
      return input.writeMode === "live" && input.resumen
        ? {
            textos: [
              orderRegisteredMessage(input.resumen),
              funnelHandoffMessage(input.funnelMessage),
            ],
            fuente: "sistema",
          }
        : { textos: [closingPendingMessage()], fuente: "sistema" };

    case "sin_tienda":
      return { textos: [closingPendingMessage()], fuente: "sistema" };

    case "faltan_datos": {
      const correccion = closingCorrectionMessage(p.errors);
      return {
        textos: correccion ? [correccion] : [],
        fuente: "sistema",
      };
    }

    case "a_un_asesor": {
      const aviso = customerNoticeFor(p.reason);
      return { textos: aviso ? [aviso] : [], fuente: "sistema" };
    }
  }
}

/**
 * Qué se le dice al modelo cuando termina de intentar el cierre. **Puro.**
 *
 * Está aparte y exportado por una sola regla, y es la que le da forma a todo
 * este módulo: **en el caso bueno, el reporte no puede decir que el pedido
 * quedó registrado.** No quedó — el banco no escribe— y si el modelo lo lee
 * así, se lo confirma en el chat a quien está probando y termina midiéndose el
 * tono del vendedor sobre un dato falso. Es la misma regla por la que el cierre
 * en modo seco prefiere callarse antes que anunciarle un pedido al cliente, y
 * ahí ya costó caro descubrirla.
 *
 * Los demás casos sí hablan como producción, y también a propósito: lo que hace
 * después de que le falten datos o de que la presentación esté sin elegir es
 * exactamente lo que se quiere ver.
 */
export function reporteDelBanco(pedido: BancoPedido): {
  estado: string;
  detalle: string;
} {
  switch (pedido.kind) {
    case "armado":
      return {
        estado: "armado_en_prueba",
        detalle:
          "El pedido se armó bien con los datos que diste. Lo que el cliente lee en este " +
          "turno lo escribe el sistema, no vos, así que tu texto de este turno no sale.",
      };
    case "faltan_datos":
      return {
        estado: "faltan_datos",
        detalle:
          "Los datos que diste no alcanzan para armar el pedido. Pedile al cliente lo que falta y volvé a intentar.",
      };
    case "falta_la_presentacion":
      return {
        estado: "falta_la_presentacion",
        detalle: `Antes de registrar, preguntale cuál de estas presentaciones quiere: ${pedido.opciones.join(", ")}.`,
      };
    case "a_un_asesor":
      return {
        estado: "paso_a_un_asesor",
        detalle:
          "No se pudo armar el pedido. En producción esto pasaría a un asesor.",
      };
    case "sin_tienda":
      return {
        estado: "sin_tienda",
        detalle:
          "La tienda no está conectada, así que el pedido no se puede armar. En producción quedaría en cola esperando.",
      };
  }
}

/**
 * La referencia de lead del banco.
 *
 * En producción es el uuid de la conversación, y de ahí sale la llave de
 * idempotencia. Acá es una constante **a propósito**: el banco no crea pedidos,
 * así que no hay nada que deduplicar, y un valor fijo hace que dos pruebas del
 * mismo carrito den la misma llave — que es exactamente lo que se querría ver
 * si algún día esta llave se mirara desde acá.
 */
const BANCO_LEAD_REF = "banco-de-pruebas";
