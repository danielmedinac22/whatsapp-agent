import { describe, expect, it } from "vitest";
import {
  capturedToClosing,
  closingCaptureSchema,
  closingToolReport,
  closingTurnVoice,
  MAX_QUANTITY,
  pickVariant,
  quantityOutOfRange,
  resolveSalesTurnText,
  type ClosingCapture,
} from "./closing-capture";
import { closingPendingMessage } from "./closing-messages";
import type { CloseSaleResult } from "./closing";
import type { ClosingLine } from "./order";

/** Lo que el vendedor captura cuando el cliente ya dio todo. */
const CAPTURA_COMPLETA: ClosingCapture = {
  nombre: "Ana",
  apellido: "Pérez",
  telefono: "4123 4567",
  departamento: "Guatemala",
  municipio: "Mixco",
  direccion: "3a calle 5-20 zona 4",
  reclama_en_oficina: false,
  email: null,
  cantidad: 2,
  presentacion: null,
  descuento_pct: 0,
};

/** La línea ya resuelta contra la tienda: con id de variante y precio reales. */
const LINEA: ClosingLine = {
  productId: "prod-1",
  variantId: "gid://shopify/ProductVariant/9911",
  title: "Colágeno Hidrolizado — 250 g",
  quantity: 2,
  unitPrice: 199,
};

const PENDIENTE = closingPendingMessage();

describe("lo que el vendedor puede entregar", () => {
  it("no tiene dónde escribir el precio ni el id de la variante", () => {
    // Es la defensa de fondo contra un precio inventado, y no es una regla del
    // prompt: no existe el campo. En contraentrega un precio equivocado se
    // descubre con el repartidor en la puerta cobrando otra cifra.
    const campos = Object.keys(closingCaptureSchema.shape);
    expect(campos).not.toContain("precio");
    expect(campos).not.toContain("variant_id");
    expect(campos).not.toContain("precio_unitario");
    expect(campos).not.toContain("total");
  });

  it("acepta un cierre incompleto, para que el sistema diga qué falta", () => {
    // Un esquema que exigiera todo dejaría al modelo inventando el hueco para
    // poder llamar. Prefiere recibirlo incompleto y contestar qué falta.
    const parsed = closingCaptureSchema.safeParse({
      ...CAPTURA_COMPLETA,
      direccion: null,
      apellido: null,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("de lo capturado al cierre", () => {
  it("la llave del cierre sale del lead y de lo que compró, nunca del reloj", () => {
    // Dos capturas del mismo cierre en momentos distintos tienen que producir
    // cierres idénticos: es lo que hace que el segundo disparo no cree un
    // segundo envío contraentrega.
    const uno = capturedToClosing({
      leadRef: "conv-1",
      capture: CAPTURA_COMPLETA,
      line: LINEA,
    });
    const dos = capturedToClosing({
      leadRef: "conv-1",
      capture: CAPTURA_COMPLETA,
      line: LINEA,
    });
    expect(uno).toEqual(dos);
    expect(uno.leadRef).toBe("conv-1");
  });

  it("el precio del pedido es el de la tienda, no el que el modelo haya dicho", () => {
    const cierre = capturedToClosing({
      leadRef: "conv-1",
      capture: { ...CAPTURA_COMPLETA, cantidad: 2 },
      line: LINEA,
    });
    expect(cierre.lines).toEqual([LINEA]);
    expect(cierre.lines[0]?.unitPrice).toBe(199);
  });

  it("pasa los datos tal como el cliente los dijo, sin completar lo que falta", () => {
    // Completar un apellido vacío sería inventar; lo que corresponde es que el
    // constructor de orden lo declare faltante y se le pregunte al cliente.
    const cierre = capturedToClosing({
      leadRef: "conv-1",
      capture: { ...CAPTURA_COMPLETA, apellido: null, direccion: null },
      line: LINEA,
    });
    expect(cierre.contact.lastName).toBeNull();
    expect(cierre.contact.address).toBeNull();
  });
});

describe("qué presentación eligió", () => {
  const UNA = [{ title: "Default Title", id: "v1" }];
  const VARIAS = [
    { title: "250 g", id: "v1" },
    { title: "500 g", id: "v2" },
  ];

  it("con una sola presentación no hay nada que preguntar", () => {
    expect(pickVariant(UNA, null)).toEqual({ kind: "ok", variant: UNA[0] });
  });

  it("con varias y ninguna nombrada, se le pregunta en vez de elegir por él", () => {
    // Elegir «la más parecida» entre dos presentaciones del mismo producto es
    // exactamente cómo se despacha la equivocada.
    expect(pickVariant(VARIAS, null)).toEqual({
      kind: "ambiguous",
      options: ["250 g", "500 g"],
    });
  });

  it("reconoce la presentación aunque el cliente la escriba distinto", () => {
    expect(pickVariant(VARIAS, "250g")).toEqual({
      kind: "ok",
      variant: VARIAS[1 - 1],
    });
    expect(pickVariant(VARIAS, " 500 G ")).toEqual({
      kind: "ok",
      variant: VARIAS[1],
    });
  });

  it("reconoce la presentación aunque el cliente no le ponga la tilde", () => {
    const conTilde = [
      { title: "Cápsulas", id: "v1" },
      { title: "Polvo", id: "v2" },
    ];
    expect(pickVariant(conTilde, "capsulas")).toEqual({
      kind: "ok",
      variant: conTilde[0],
    });
  });

  it("un nombre que no es ninguna de las disponibles se pregunta, no se adivina", () => {
    expect(pickVariant(VARIAS, "1 kg")).toEqual({
      kind: "ambiguous",
      options: ["250 g", "500 g"],
    });
  });

  it("sin ninguna presentación disponible no hay nada que vender", () => {
    expect(pickVariant([], "250 g")).toEqual({ kind: "none" });
  });
});

describe("la cantidad que no se cierra sola", () => {
  it("una cantidad normal se registra", () => {
    expect(quantityOutOfRange(1)).toBe(false);
    expect(quantityOutOfRange(3)).toBe(false);
    expect(quantityOutOfRange(MAX_QUANTITY)).toBe(false);
  });

  it("un cero de más no se despacha: pasa el techo y va a una persona", () => {
    // «20» donde el cliente dijo «2» es un despacho contraentrega de veinte
    // unidades que nadie pidió, y sin cobro previo que lo frene.
    expect(quantityOutOfRange(MAX_QUANTITY + 1)).toBe(true);
    expect(quantityOutOfRange(200)).toBe(true);
  });

  it("una cantidad que no es un entero positivo tampoco se registra", () => {
    expect(quantityOutOfRange(0)).toBe(true);
    expect(quantityOutOfRange(-1)).toBe(true);
    expect(quantityOutOfRange(1.5)).toBe(true);
    expect(quantityOutOfRange(Number.NaN)).toBe(true);
  });
});

describe("quién habla en un turno de cierre", () => {
  const CREADO: CloseSaleResult = {
    kind: "created",
    orderName: "#1042",
    discountClamped: false,
  };
  const SECO: CloseSaleResult = { kind: "dry_run" };
  const ENCOLADO: CloseSaleResult = {
    kind: "queued",
    reason: "la tienda no está conectada",
    willRetry: true,
  };

  it("un turno sin cierre es el turno de siempre: habla el modelo", () => {
    // La no-regresión del turno normal: mientras la herramienta no se llame, no
    // cambia una línea de lo que el cliente lee.
    const turno = resolveSalesTurnText({
      modelText: "¿Te lo despacho hoy mismo?",
      closing: { suppressModelText: false, result: null },
      pendingMessage: PENDIENTE,
    });
    expect(turno).toEqual({
      body: "¿Te lo despacho hoy mismo?",
      source: "model",
    });
  });

  it("si el cierre ya le escribió al cliente, el texto del modelo no sale", () => {
    // Se midió que el modelo redacta «tu pedido quedó registrado» al recibir el
    // resultado de la herramienta. El único texto que no puede mentir es el que
    // no se manda.
    const turno = resolveSalesTurnText({
      modelText: "¡Listo Ana! Tu pedido quedó registrado ✅",
      closing: { suppressModelText: true, result: CREADO },
      pendingMessage: PENDIENTE,
    });
    expect(turno.body).toBe("");
    expect(turno.source).toBe("suppressed");
  });

  it("en modo seco el cliente no lee que su pedido quedó registrado", () => {
    // El pedido no existe. Decírselo sería el mismo fallo silencioso que este
    // camino existe para evitar, solo que al revés.
    const turno = resolveSalesTurnText({
      modelText: "¡Listo! Tu pedido quedó registrado ✅ Es el #1042.",
      closing: { suppressModelText: false, result: SECO },
      pendingMessage: PENDIENTE,
    });
    expect(turno.source).toBe("closing_pending");
    expect(turno.body).toBe(PENDIENTE);
    expect(turno.body).not.toContain("quedó registrado");
    expect(turno.body).not.toContain("#1042");
  });

  it("con el cierre encolado tampoco se le dice que compró, pero no se lo deja mudo", () => {
    const turno = resolveSalesTurnText({
      modelText: "Tu pedido ya está en el sistema.",
      closing: { suppressModelText: false, result: ENCOLADO },
      pendingMessage: PENDIENTE,
    });
    expect(turno.source).toBe("closing_pending");
    expect(turno.body.length).toBeGreaterThan(0);
    expect(turno.body).not.toContain("registrado");
  });

  it("sin texto y sin cierre, el turno no manda nada", () => {
    expect(
      resolveSalesTurnText({
        modelText: "   ",
        closing: { suppressModelText: false, result: null },
        pendingMessage: PENDIENTE,
      }),
    ).toEqual({ body: "", source: "empty" });
  });
});

describe("cuándo el cierre ya habló", () => {
  it("los cuatro desenlaces en que el cierre le escribió callan al modelo", () => {
    const hablaron: CloseSaleResult[] = [
      { kind: "invalid", errors: [{ code: "no_lines" }], message: "falta algo" },
      { kind: "escalated", errors: [{ code: "no_lines" }] },
      { kind: "created", orderName: "#1", discountClamped: false },
      { kind: "duplicate", orderName: "#1" },
    ];
    for (const r of hablaron) {
      expect(closingTurnVoice(r)).toEqual({ kind: "closing_spoke" });
    }
  });

  it("los dos en que calló a propósito dejan que el turno diga algo honesto", () => {
    expect(closingTurnVoice({ kind: "dry_run" })).toEqual({
      kind: "closing_silent",
    });
    expect(
      closingTurnVoice({
        kind: "queued",
        reason: "la tienda no está conectada",
        willRetry: true,
      }),
    ).toEqual({ kind: "closing_silent" });
  });
});

describe("lo que el vendedor sabe al terminar de registrar", () => {
  it("un pedido creado le llega con su número, para que no lo vuelva a pedir", () => {
    const reporte = closingToolReport({
      kind: "created",
      orderName: "#1042",
      discountClamped: false,
    });
    expect(reporte.estado).toBe("registrado");
    expect(reporte.detalle).toContain("#1042");
  });

  it("un descuento recortado se le dice, porque un asesor lo va a revisar", () => {
    const reporte = closingToolReport({
      kind: "created",
      orderName: "#1042",
      discountClamped: true,
    });
    expect(reporte.detalle).toContain("precio autorizado");
  });

  it("modo seco y cola le dicen explícitamente que el pedido NO existe", () => {
    expect(closingToolReport({ kind: "dry_run" }).estado).toBe(
      "no_registrado_modo_prueba",
    );
    expect(closingToolReport({ kind: "dry_run" }).detalle).toContain("NO");
    const encolado = closingToolReport({
      kind: "queued",
      reason: "la tienda no está conectada",
      willRetry: true,
    });
    expect(encolado.estado).toBe("no_registrado_en_cola");
    expect(encolado.detalle).toContain("la tienda no está conectada");
  });

  it("un segundo disparo le dice que no vuelva a pedir los datos", () => {
    const reporte = closingToolReport({ kind: "duplicate", orderName: "#1042" });
    expect(reporte.detalle).toContain("No vuelvas a pedirle los datos");
  });
});

describe("lo que dispara el vendedor es lo que llega a la cola de reintentos", () => {
  // El cierre que no llegó a la tienda viaja entero dentro del job de pg-boss
  // —`SalesOrderJob.closing`— y se guarda como JSON. Cada reintento lo
  // reconstruye desde ahí, así que un campo que no sobreviva el viaje es una
  // venta que se reintenta con datos distintos a los que el cliente dio, y no
  // hay ningún check que lo vea: el tipo dice que está.
  const cierre = capturedToClosing({
    leadRef: "conv-1",
    capture: {
      ...CAPTURA_COMPLETA,
      email: "ana@example.com",
      descuento_pct: 15,
    },
    line: LINEA,
  });

  it("sobrevive entero el viaje por la cola, sin perder ni cambiar un campo", () => {
    const ida = JSON.parse(JSON.stringify(cierre));
    expect(ida).toEqual(cierre);
  });

  it("lleva todo lo que hace falta para volver a armar el pedido sin el chat", () => {
    // El reintento ocurre horas después y sin conversación a mano: si el dato
    // no está acá, no está en ninguna parte.
    const job = JSON.parse(JSON.stringify(cierre)) as typeof cierre;
    expect(job.contact.firstName).toBe("Ana");
    expect(job.contact.lastName).toBe("Pérez");
    expect(job.contact.phone).toBe("4123 4567");
    expect(job.contact.city).toBe("Mixco");
    expect(job.contact.division).toBe("Guatemala");
    expect(job.contact.address).toBe("3a calle 5-20 zona 4");
    expect(job.contact.email).toBe("ana@example.com");
    expect(job.lines[0]?.variantId).toBe(LINEA.variantId);
    expect(job.lines[0]?.quantity).toBe(2);
    expect(job.lines[0]?.unitPrice).toBe(199);
    expect(job.discountPct).toBe(15);
  });

  it("el descuento pactado viaja sin aplicar: lo decide el límite en cada intento", () => {
    // Por eso el job lleva el cierre y no el pedido ya armado. Si el admin baja
    // el límite entre el fallo y el reintento, manda el límite nuevo.
    expect(cierre.discountPct).toBe(15);
    expect(cierre.lines[0]?.unitPrice).toBe(199);
  });

  it("dos disparos del mismo cierre viajan con la misma referencia de lead", () => {
    const otro = capturedToClosing({
      leadRef: "conv-1",
      capture: { ...CAPTURA_COMPLETA, telefono: "4123 4568" },
      line: LINEA,
    });
    // Corregir un dígito del teléfono entre dos intentos no puede crear un
    // pedido nuevo: la llave sale del lead y del carrito, no de los datos.
    expect(otro.leadRef).toBe(cierre.leadRef);
    expect(otro.lines).toEqual(cierre.lines);
  });
});
