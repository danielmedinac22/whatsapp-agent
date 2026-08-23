import { describe, expect, it } from "vitest";
import { needsActivationStamp, salesAgentIsConfigured } from "@wa/db";

/**
 * **El único listón de «hay vendedor» del monorepo**, y por eso este es el
 * único archivo que lo prueba.
 *
 * Hasta este ticket había tres respuestas a la misma pregunta —dos en el worker
 * y una en el panel— y la del panel era distinta: preguntaba si la fila
 * existía. Cada una se leía razonable por su cuenta; juntas, abrir
 * `/vendedor` encendía el módulo de ventas de Guatemala, porque el `upsert`
 * crea la fila con todos los textos en `''`.
 *
 * Se importa de `@wa/db` a propósito, aunque el worker lo re-exporte: si algún
 * día alguien vuelve a escribir una copia local, este import sigue apuntando al
 * de verdad y la copia queda sin tests, que es como se nota.
 */
describe("salesAgentIsConfigured · el listón único", () => {
  it("una operación sin fila no tiene vendedor", () => {
    expect(salesAgentIsConfigured(null)).toBe(false);
  });

  it("la fila sola no basta: la `0022` la crea con todo en blanco", () => {
    // Es el estado de producción hoy —una fila, apagada, `display_name`
    // vacío— y el que encendió el menú del panel sin encender al vendedor.
    // Contarla como vendedor activaría la lógica nueva sobre el número que hoy
    // factura —el riesgo R8— sin que exista vendedor alguno.
    expect(salesAgentIsConfigured({ enabled: false, displayName: "" })).toBe(false);
    expect(salesAgentIsConfigured({ enabled: false, displayName: "   " })).toBe(false);
  });

  it("encendido y con nombre sí hay vendedor", () => {
    expect(
      salesAgentIsConfigured({ enabled: true, displayName: "Sebastián" }),
    ).toBe(true);
  });

  it("el nombre sin el interruptor NO alcanza, y es lo que cambió en la `0033`", () => {
    // Antes esto era `true`: el encendido se deducía del nombre. Ahora
    // encender es un acto declarado, así que se puede dejar la configuración
    // escrita y guardada con el vendedor apagado — que es como se ajusta el
    // tono sin que nadie empiece a atender.
    expect(
      salesAgentIsConfigured({ enabled: false, displayName: "Sebastián" }),
    ).toBe(false);
  });

  it("el interruptor sin nombre tampoco: se presentaría como nadie", () => {
    // El panel no deja producir esta combinación, pero la tabla se escribe
    // también por SQL, por un seed y por una restauración. La dirección segura
    // del error es que no atienda.
    expect(salesAgentIsConfigured({ enabled: true, displayName: "" })).toBe(false);
    expect(salesAgentIsConfigured({ enabled: true, displayName: "  " })).toBe(false);
  });

  it("es un guardia de tipo: pasar el listón deja la fila en la mano", () => {
    // Lo que impide que el panel escriba `seller!.displayName` después de
    // preguntar — un `!` es una segunda afirmación de lo que la condición ya
    // comprobó, y las segundas afirmaciones son las que se quedan cuando la
    // condición cambia.
    const fila: {
      enabled: boolean;
      displayName: string;
      activatedAt: Date | null;
    } | null = {
      enabled: true,
      displayName: "Sebastián",
      activatedAt: null,
    };
    if (salesAgentIsConfigured(fila)) {
      expect(fila.displayName).toBe("Sebastián");
    } else {
      throw new Error("el listón tenía que dejarlo pasar");
    }
  });
});

/**
 * El respaldo perezoso de la línea de corte, en su mitad decidible.
 *
 * La otra mitad —el `UPDATE ... where activated_at is null`— es el borde y no
 * se prueba, como el resto de las consultas del repo. Lo que sí se prueba es la
 * decisión, porque ahí vive el «una sola vez»: es lo único que impide que
 * apagar y volver a encender al vendedor le arrastre a Katherine las
 * conversaciones que él ya estaba trabajando.
 */
describe("needsActivationStamp · cuándo se estampa la línea de corte", () => {
  it("una operación sin fila no tiene nada que estampar", () => {
    expect(needsActivationStamp(null)).toBe(false);
  });

  it("apagado no se estampa: no hubo activación que fechar", () => {
    // Producción hoy. Estampar acá pondría la fecha de un encendido que nunca
    // ocurrió, y a partir de ella toda conversación nueva sin pedido caería en
    // la bandeja de un vendedor que sigue apagado.
    expect(
      needsActivationStamp({ enabled: false, displayName: "", activatedAt: null }),
    ).toBe(false);
    expect(
      needsActivationStamp({ enabled: false, displayName: "   ", activatedAt: null }),
    ).toBe(false);
  });

  it("la configuración escrita con el vendedor apagado tampoco estampa", () => {
    // Es el caso que la `0033` hizo posible y el que sostiene la fase de
    // pruebas: dejar el nombre y el tono guardados sin encender. La línea de
    // corte tiene que seguir sin fecha hasta que alguien encienda de verdad.
    expect(
      needsActivationStamp({
        enabled: false,
        displayName: "Sebastián",
        activatedAt: null,
      }),
    ).toBe(false);
  });

  it("encendido y sin fecha se estampa: es el caso que el respaldo cubre", () => {
    // Llenar `display_name` por SQL, por un seed o por una restauración no pasa
    // por el guardado del panel. Sin este respaldo, `activated_at` se quedaría
    // en `null` para siempre y la bandeja de ventas quedaría vacía con el
    // vendedor encendido, sin error y sin log que lo explique.
    expect(
      needsActivationStamp({
        enabled: true,
        displayName: "Sebastián",
        activatedAt: null,
      }),
    ).toBe(true);
  });

  it("con la fecha puesta NO se re-escribe, y ese es el punto", () => {
    expect(
      needsActivationStamp({
        enabled: true,
        displayName: "Sebastián",
        activatedAt: new Date("2026-08-20T00:00:00.000Z"),
      }),
    ).toBe(false);
  });

  it("apagar al vendedor y volver a encenderlo no mueve la fecha", () => {
    // Apagarlo ya no borra nada —desde la `0033` el nombre se queda— y el
    // guardado no toca la columna con el vendedor apagado, así que al volver a
    // encenderlo la fila llega acá con fecha y no se re-estampa. Re-estamparla
    // devolvería a la bandeja de Katherine conversaciones vivas, que es lo que
    // `no-regresion.md` prohíbe.
    const encendida = new Date("2026-08-20T00:00:00.000Z");
    expect(
      needsActivationStamp({
        enabled: false,
        displayName: "Sebastián",
        activatedAt: encendida,
      }),
    ).toBe(false);
    expect(
      needsActivationStamp({
        enabled: true,
        displayName: "Sebastián",
        activatedAt: encendida,
      }),
    ).toBe(false);
  });
});
