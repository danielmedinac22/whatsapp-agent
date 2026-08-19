import { describe, expect, it } from "vitest";
import {
  CAPI_COMO_SE_ENCIENDE,
  elMotivoYaEstaDicho,
  lineasDelBarrido,
  momentoDeBusqueda,
  motivoDeEspera,
  motivoDeSalto,
} from "@wa/shared";
import type { SkipReason, WaitReason } from "./plan";

/**
 * Lo que la pantalla del reporte dice de cada motivo del barrido.
 *
 * Vive en `@wa/shared` porque lo comparten el worker y el panel, y se prueba
 * desde acá porque la suite del repo es la del worker.
 */

/**
 * **Los dos mapas son exhaustivos por tipo, no por lista.**
 *
 * Son `Record<WaitReason, true>` y `Record<SkipReason, true>`: el día que
 * `plan.ts` agregue un motivo, este archivo **deja de compilar** hasta que
 * alguien escriba cómo se dice. Una lista escrita a mano se olvidaría, y lo que
 * saldría de ahí es un motivo mostrándose con su nombre de código en una
 * pantalla que un operador tiene que entender.
 */
const ESPERAS: Record<WaitReason, true> = {
  "awaiting-customer-confirmation": true,
  "operation-has-no-dataset": true,
  "operation-has-no-whatsapp-account": true,
  "operation-has-no-currency": true,
};

const SALTOS: Record<SkipReason, true> = {
  "not-a-sales-order": true,
  "no-click-id": true,
  "too-old": true,
  "order-has-no-id": true,
  "order-has-no-value": true,
  "order-has-no-close-time": true,
};

describe("los motivos del barrido, en lenguaje de operación", () => {
  it("todos los motivos de espera tienen su frase, y ninguno cae al respaldo", () => {
    for (const clave of Object.keys(ESPERAS)) {
      const m = motivoDeEspera(clave);
      expect(m.texto).not.toContain(clave);
      expect(m.texto.length).toBeGreaterThan(20);
    }
  });

  it("todos los motivos de salto tienen su frase, y ninguno cae al respaldo", () => {
    for (const clave of Object.keys(SALTOS)) {
      const m = motivoDeSalto(clave);
      expect(m.texto).not.toContain(clave);
      expect(m.texto.length).toBeGreaterThan(20);
    }
  });

  it("un motivo que este panel no conoce se muestra, no se esconde", () => {
    // Una deriva entre el worker y el panel tiene que verse. Desaparecer una
    // línea del barrido sería el mismo silencio que esta pantalla existe para
    // romper.
    const m = motivoDeEspera("motivo-del-futuro");
    expect(m.texto).toContain("motivo-del-futuro");
    expect(m.accionable).toBe(true);
  });

  it("esperar por la configuración es accionable; esperar la confirmación no", () => {
    // Es la distinción que decide si alguien tiene que hacer algo hoy.
    expect(motivoDeEspera("operation-has-no-dataset").accionable).toBe(true);
    expect(motivoDeEspera("awaiting-customer-confirmation").accionable).toBe(
      false,
    );
  });

  it("«no lo tomó el vendedor» no pide trabajo de nadie", () => {
    expect(motivoDeSalto("not-a-sales-order").accionable).toBe(false);
  });
});

describe("lineasDelBarrido", () => {
  it("descarta los motivos en cero: un motivo sin pedidos no es información", () => {
    const r = lineasDelBarrido({
      report: 0,
      wait: { "operation-has-no-dataset": 0 },
      skip: { "not-a-sales-order": 206, "no-click-id": 0 },
    });
    expect(r.esperando).toHaveLength(0);
    expect(r.saltados.map((l) => l.clave)).toEqual(["not-a-sales-order"]);
  });

  it("pone arriba lo que alguien puede destrabar", () => {
    // Con seis motivos posibles y uno solo que pide trabajo, el orden es la
    // diferencia entre verlo y no verlo.
    const r = lineasDelBarrido({
      report: 0,
      wait: {
        "awaiting-customer-confirmation": 90,
        "operation-has-no-dataset": 3,
      },
      skip: {},
    });
    expect(r.esperando.map((l) => l.clave)).toEqual([
      "operation-has-no-dataset",
      "awaiting-customer-confirmation",
    ]);
  });

  it("entre motivos igual de accionables, el más numeroso primero", () => {
    const r = lineasDelBarrido({
      report: 0,
      wait: {},
      skip: { "no-click-id": 2, "not-a-sales-order": 206 },
    });
    expect(r.saltados.map((l) => l.clave)).toEqual([
      "not-a-sales-order",
      "no-click-id",
    ]);
  });

  it("suma los totales de cada grupo", () => {
    const r = lineasDelBarrido({
      report: 1,
      wait: { "awaiting-customer-confirmation": 4 },
      skip: { "not-a-sales-order": 206, "no-click-id": 2 },
    });
    expect(r.totalEsperando).toBe(4);
    expect(r.totalSaltados).toBe(208);
  });

  it("el estado real de hoy en Guatemala se lee como una explicación", () => {
    // Medido contra producción el 18-ago-2026: 206 pedidos en el período y
    // ninguno tomado por el vendedor. La pantalla tiene que decir eso, y no un
    // cero: un cero se lee igual que una avería.
    const r = lineasDelBarrido({
      report: 0,
      wait: {},
      skip: { "not-a-sales-order": 206 },
    });
    expect(r.saltados[0]?.cantidad).toBe(206);
    expect(r.saltados[0]?.texto).toContain("no los tomó el vendedor");
  });
});

describe("cómo se enciende el reporte", () => {
  it("nombra las tres cosas que faltan, y ninguna es un botón del panel", () => {
    expect(CAPI_COMO_SE_ENCIENDE).toHaveLength(3);
    const todo = CAPI_COMO_SE_ENCIENDE.join(" ");
    expect(todo).toContain("usuario de sistema");
    expect(todo).toContain("dataset");
    expect(todo).toContain("META_CAPI_MODE");
    // El destino es un dataset y **no** el píxel: mandarlo al píxel llega a un
    // destino real y equivocado, sin error y sin alarma.
    expect(todo).toContain("no el píxel");
  });
});

describe("momentoDeBusqueda · el dato con el que se busca en Meta", () => {
  it("sale en UTC y lo dice, que es la zona en la que viajó el evento", () => {
    expect(momentoDeBusqueda("2026-08-18T20:33:02.034Z")).toBe(
      "2026-08-18 20:33 UTC",
    );
  });

  it("no depende de la zona del proceso: el mismo instante da el mismo texto", () => {
    // La pantalla se dibuja en el servidor —en UTC— y se hidrata en el
    // navegador del admin —en Guatemala—. Dos textos para el mismo instante son
    // una discrepancia de hidratación, y de paso una hora de diferencia al
    // cruzarlo contra el administrador de eventos.
    const enOtraZona = "2026-08-18T14:33:02.034-06:00";
    expect(momentoDeBusqueda(enOtraZona)).toBe(
      momentoDeBusqueda("2026-08-18T20:33:02.034Z"),
    );
  });

  it("una fecha ilegible se muestra tal cual en vez de decir «Invalid Date»", () => {
    expect(momentoDeBusqueda("no-es-una-fecha")).toBe("no-es-una-fecha");
  });
});

describe("elMotivoYaEstaDicho · no repetirle al operador la misma frase", () => {
  it("lo reconoce aunque el veredicto le haya puesto la mayúscula", () => {
    // Es exactamente lo que pasa hoy en producción, y la comparación ingenua
    // decía que no: el veredicto capitaliza el motivo al meterlo en su texto.
    const motivo = "el reporte a Meta está apagado (META_CAPI_MODE sin poner)";
    const detalle =
      "El reporte a Meta está apagado (META_CAPI_MODE sin poner). No sale ninguna llamada a Meta y ninguna venta se está atribuyendo.";
    expect(elMotivoYaEstaDicho(detalle, motivo)).toBe(true);
  });

  it("cuando el veredicto habla de otra cosa, el motivo sigue haciendo falta", () => {
    // Pasa cuando no se pudo mirar el barrido: el veredicto se convierte en
    // «no se pudo leer» y el motivo del apagado no está dicho en ningún lado.
    expect(
      elMotivoYaEstaDicho(
        "No se pudo mirar qué ventas faltan por reportar (connection refused).",
        "falta el token de usuario de sistema (META_CAPI_SYSTEM_USER_TOKEN)",
      ),
    ).toBe(false);
  });
});
