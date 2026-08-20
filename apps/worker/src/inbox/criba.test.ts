import { describe, expect, it } from "vitest";
import {
  puedeSerDeVentas,
  resolveInbox,
  type InboxFacts,
  type OrderFacts,
  type OrderLogisticsStatus,
  type SalesSieveFacts,
} from "@wa/db";

/**
 * **La criba de la bandeja de ventas, atada a la regla que no puede
 * contradecir.**
 *
 * `puedeSerDeVentas` existe para que el panel no tenga que traer las 1.762
 * conversaciones de la operación cada vez que dibuja 200. Es un
 * superconjunto: puede dejar pasar de más —eso solo cuesta derivar una fila de
 * sobra— y **no puede dejar fuera ni una que `resolveInbox` mandaría a
 * ventas**, porque eso sería borrarla de la pantalla sin que nada falle.
 *
 * Por eso el test que importa no comprueba casos elegidos a mano: recorre
 * **todas** las combinaciones de los hechos que las seis reglas miran y verifica
 * la implicación en el único sentido que importa. Los casos con nombre que
 * vienen después son para leer, no para cubrir.
 */

const dia = (d: number) => new Date(Date.UTC(2026, 6, d, 12, 0, 0));

function pedido(
  createdAt: Date,
  logisticsStatus: OrderLogisticsStatus = "en_transito",
): OrderFacts {
  return { createdAt, pipelineStatus: "confirmed", logisticsStatus };
}

/**
 * Los hechos que las dos funciones comparten, para no poder alimentarlas con
 * mundos distintos: `hasOrders` sale de los mismos pedidos que ve la regla, que
 * es exactamente lo que la consulta promete cuando pregunta con su `not exists`.
 */
function mundo(facts: InboxFacts, bornAt: Date): SalesSieveFacts {
  return {
    lastAdClickAt: facts.lastAdClickAt,
    bornAt,
    hasOrders: facts.orders.length > 0,
  };
}

describe("la criba nunca deja fuera una conversación de ventas", () => {
  it("sobre todas las combinaciones de hechos que las reglas miran", () => {
    // Los ejes son los que aparecen en las seis reglas: cuándo fue el clic,
    // qué pedidos hay y cuándo nacieron, cuándo nació la conversación y cuándo
    // se encendió el vendedor. Las fechas se cruzan a los dos lados de cada
    // comparación que las reglas hacen.
    const clics: Array<Date | null> = [null, dia(1), dia(5), dia(9), dia(20)];
    const nacimientos = [dia(1), dia(5), dia(9), dia(20)];
    const cortes: Array<Date | null> = [null, dia(1), dia(5), dia(9), dia(20)];
    const juegosDePedidos: OrderFacts[][] = [
      [],
      [pedido(dia(4))],
      [pedido(dia(10))],
      [pedido(dia(4), "entregado")],
      [pedido(dia(10), "entregado")],
      [pedido(dia(4), "entregado"), pedido(dia(10))],
      [pedido(dia(2), "devolucion")],
    ];

    const escapadas: string[] = [];
    let deVentas = 0;
    let combinaciones = 0;
    for (const lastAdClickAt of clics) {
      for (const orders of juegosDePedidos) {
        for (const bornAt of nacimientos) {
          for (const activatedAt of cortes) {
            combinaciones += 1;
            const facts: InboxFacts = { lastAdClickAt, orders };
            const decision = resolveInbox(facts, { activatedAt, bornAt });
            if (decision.inbox !== "ventas") continue;
            deVentas += 1;
            if (!puedeSerDeVentas(mundo(facts, bornAt), activatedAt)) {
              escapadas.push(
                `${decision.rule} · clic=${lastAdClickAt?.toISOString() ?? "—"} ` +
                  `pedidos=${orders.length} nace=${bornAt.toISOString()} ` +
                  `corte=${activatedAt?.toISOString() ?? "—"}`,
              );
            }
          }
        }
      }
    }

    // Si esta lista deja de estar vacía, la criba está escondiendo
    // conversaciones de la bandeja de ventas y el mensaje dice cuáles.
    expect(escapadas).toEqual([]);
    // Y que el recorrido haya encontrado filas de ventas de verdad: una criba
    // que nunca se pone a prueba pasa igual.
    expect(combinaciones).toBe(
      clics.length * juegosDePedidos.length * nacimientos.length * cortes.length,
    );
    expect(deVentas).toBeGreaterThan(20);
  });

  it("y las tres reglas que mandan a ventas están representadas", () => {
    // Cubrir mucho no sirve si lo cubierto es siempre lo mismo. Estas son las
    // tres únicas reglas que pueden mandar una fila a la bandeja de ventas.
    const reglas = new Set<string>();
    for (const lastAdClickAt of [null, dia(1), dia(9)]) {
      for (const orders of [[], [pedido(dia(4))], [pedido(dia(4), "entregado")]]) {
        for (const bornAt of [dia(1), dia(9)]) {
          for (const activatedAt of [null, dia(5)]) {
            const d = resolveInbox({ lastAdClickAt, orders }, { activatedAt, bornAt });
            if (d.inbox === "ventas") reglas.add(d.rule);
          }
        }
      }
    }
    expect([...reglas].sort()).toEqual([
      "ad_click_after_activation",
      "ad_click_after_last_order",
      "born_after_activation",
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Un caso con nombre por cada motivo por el que una fila entra a la bandeja
// ────────────────────────────────────────────────────────────────────────────

describe("por qué una conversación pasa la criba", () => {
  const CORTE = dia(5);

  it("el recomprador: pedido entregado y clic nuevo después (regla 1)", () => {
    const facts: InboxFacts = {
      lastAdClickAt: dia(9),
      orders: [pedido(dia(3), "entregado")],
    };
    expect(resolveInbox(facts, { activatedAt: CORTE, bornAt: dia(1) })).toEqual({
      inbox: "ventas",
      rule: "ad_click_after_last_order",
    });
    expect(puedeSerDeVentas(mundo(facts, dia(1)), CORTE)).toBe(true);
  });

  it("el recomprador pasa **con pedidos**, que es lo que el `sin pedidos` solo no ve", () => {
    // Es la mitad del `or` que existe por esta fila: si la criba fuera solo
    // «sin pedidos y nacida después del corte», el recomprador —que tiene
    // pedido y nació antes— quedaría fuera de la bandeja del vendedor.
    const facts: InboxFacts = {
      lastAdClickAt: dia(9),
      orders: [pedido(dia(3), "entregado")],
    };
    expect(mundo(facts, dia(1)).hasOrders).toBe(true);
    expect(puedeSerDeVentas(mundo(facts, dia(1)), CORTE)).toBe(true);
  });

  it("el lead: sin pedido y nacida después de encender al vendedor (regla 4)", () => {
    const facts: InboxFacts = { lastAdClickAt: null, orders: [] };
    expect(resolveInbox(facts, { activatedAt: CORTE, bornAt: dia(9) })).toEqual({
      inbox: "ventas",
      rule: "born_after_activation",
    });
    expect(puedeSerDeVentas(mundo(facts, dia(9)), CORTE)).toBe(true);
  });

  it("el que nunca compró y hace clic después del corte (regla 5)", () => {
    const facts: InboxFacts = { lastAdClickAt: dia(9), orders: [] };
    expect(resolveInbox(facts, { activatedAt: CORTE, bornAt: dia(1) })).toEqual({
      inbox: "ventas",
      rule: "ad_click_after_activation",
    });
    expect(puedeSerDeVentas(mundo(facts, dia(1)), CORTE)).toBe(true);
  });

  it("sin vendedor encendido lo único que puede pasar es el clic", () => {
    // Producción hoy. Sin línea de corte las reglas 4 y 5 no se disparan, así
    // que la criba se reduce a `ad_referral_at is not null` — y con Guatemala
    // sin anuncios corriendo, eso son cero filas.
    expect(puedeSerDeVentas({ lastAdClickAt: null, bornAt: dia(9), hasOrders: false }, null)).toBe(false);
    expect(puedeSerDeVentas({ lastAdClickAt: dia(9), bornAt: dia(9), hasOrders: false }, null)).toBe(true);
  });
});

describe("qué NO pasa la criba, y por eso no hay que traerlo", () => {
  const CORTE = dia(5);

  it("el histórico de Katherine: sin clic, con pedido, nacida antes", () => {
    const facts: InboxFacts = { lastAdClickAt: null, orders: [pedido(dia(6))] };
    expect(resolveInbox(facts, { activatedAt: CORTE, bornAt: dia(1) }).inbox).toBe(
      "operaciones",
    );
    expect(puedeSerDeVentas(mundo(facts, dia(1)), CORTE)).toBe(false);
  });

  it("el que compró después de nacer, aunque haya nacido después del corte", () => {
    // Es el caso normal de una venta cerrada y el que más filas descarta: en la
    // base de ensayo el 94 % de las conversaciones tiene pedido, igual que
    // producción. Sin el `sin pedidos` en la criba, un año después del
    // encendido pasarían todas las del año.
    const facts: InboxFacts = { lastAdClickAt: null, orders: [pedido(dia(10))] };
    expect(resolveInbox(facts, { activatedAt: CORTE, bornAt: dia(9) }).inbox).toBe(
      "operaciones",
    );
    expect(puedeSerDeVentas(mundo(facts, dia(9)), CORTE)).toBe(false);
  });

  it("la criba deja pasar de más y la regla lo corrige, que es el trato", () => {
    // Clic anterior al último pedido: la criba la pasa por tener clic y
    // `resolveInbox` la manda a operaciones. Es el error barato, y es el único
    // que la criba puede permitirse.
    const facts: InboxFacts = {
      lastAdClickAt: dia(2),
      orders: [pedido(dia(8))],
    };
    expect(puedeSerDeVentas(mundo(facts, dia(1)), CORTE)).toBe(true);
    expect(resolveInbox(facts, { activatedAt: CORTE, bornAt: dia(1) }).inbox).toBe(
      "operaciones",
    );
  });
});

describe("la criba no mira la actividad, y ese es el punto", () => {
  it("una conversación quieta desde hace un año pasa igual que una de hoy", () => {
    // **Es la casilla que el ticket vigila.** La bandeja muestra las 200 más
    // recientes *y además* las que están sin responder, que por viejas caen
    // fuera de cualquier corte por actividad —170 filas en la medición de
    // PRO-16—. Si la criba cortara por actividad para leer menos, esas 170
    // desaparecerían de la pantalla y el contador seguiría contándolas: la
    // misma clase de mentira que este lote vino a sacar del panel.
    //
    // Por eso `SalesSieveFacts` no tiene ningún campo de actividad: no es que
    // no se use, es que no se puede usar.
    const campos = Object.keys({
      lastAdClickAt: null,
      bornAt: dia(1),
      hasOrders: false,
    } satisfies SalesSieveFacts);
    expect(campos).toEqual(["lastAdClickAt", "bornAt", "hasOrders"]);

    const vieja: InboxFacts = { lastAdClickAt: null, orders: [] };
    // Nació hace un año, no habló desde entonces, y el vendedor se encendió
    // antes: sigue siendo del vendedor y sigue teniendo que aparecer.
    const naceEn = new Date(Date.UTC(2025, 0, 1));
    const corte = new Date(Date.UTC(2024, 0, 1));
    expect(resolveInbox(vieja, { activatedAt: corte, bornAt: naceEn }).inbox).toBe(
      "ventas",
    );
    expect(puedeSerDeVentas(mundo(vieja, naceEn), corte)).toBe(true);
  });
});
