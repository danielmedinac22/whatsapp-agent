/**
 * ¿Está funcionando el reporte a Meta?
 *
 * Todo lo de este archivo es PURO: recibe los conteos y devuelve un veredicto
 * con su explicación. Quien los consigue es `capi/reporting-routes.ts`.
 *
 * ## Por qué existe, y por qué es un veredicto y no una tabla de números
 *
 * Es un criterio literal del ticket: *«el admin puede saber si el reporte está
 * funcionando, sin esperar un mes para descubrir que no se envió nada»*. Ese
 * mes es el problema real: la atribución no tiene un cliente que reclame. Si el
 * reporte se cae, nadie escribe molesto — simplemente la pauta rinde peor y la
 * explicación llega cuando alguien se pregunta por qué.
 *
 * Y el modo de fallar más probable **no es un error**: es el silencio. Cero
 * eventos mandados se ve exactamente igual cuando todo funciona y no hubo
 * ventas por anuncio, que cuando falta el dataset, que cuando el token venció.
 * Es el hallazgo registrado del proyecto —«el estado vacío aprueba por la razón
 * equivocada»— aplicado a un tablero. Por eso el veredicto **nunca dice “bien”
 * por ausencia de problemas**: distingue *«no hubo nada que reportar»* de
 * *«funciona»*, que son cosas distintas y piden acciones distintas.
 */

import { offReasonText, type CapiDispatchSetting } from "./send-mode";
import type { ConversionTally } from "./conversion-record";
import type { SkipReason, WaitReason } from "./plan";

/** Cuántos pedidos candidatos hay en cada situación, según el último barrido. */
export interface SweepCounts {
  /** Pedidos que se pueden reportar ya. */
  report: number;
  /** Los que esperan algo, por motivo. */
  wait: Partial<Record<WaitReason, number>>;
  /** Los que no se van a reportar nunca, por motivo. */
  skip: Partial<Record<SkipReason, number>>;
}

/**
 * Cómo está el reporte. El orden de la unión es el orden de gravedad, y cada
 * caso pide una acción distinta de una persona distinta.
 */
export type ReportingVerdict =
  /** Falta algo del entorno o de la configuración. Nadie está reportando. */
  | { state: "blocked"; headline: string; detail: string }
  /** Está encendido y algo se rompió: Meta rechaza, o quedaron dudas. */
  | { state: "failing"; headline: string; detail: string }
  /** Encendido, con conversiones llegando. */
  | { state: "working"; headline: string; detail: string }
  /**
   * Encendido y correcto, **y no hay nada que reportar todavía**. Es un estado
   * propio y no «bien»: se ve igual que una avería y no lo es.
   */
  | { state: "idle"; headline: string; detail: string };

/**
 * El veredicto, dado el interruptor, lo que hay en el libro y lo que vio el
 * último barrido.
 *
 * El orden de las comprobaciones es el orden en que alguien puede actuar:
 * primero lo que impide reportar del todo (el interruptor, el dataset), después
 * lo que está fallando, después si algo llegó, y al final el silencio legítimo.
 */
export function reportingVerdict(input: {
  setting: CapiDispatchSetting;
  tally: ConversionTally;
  sweep: SweepCounts;
  /** Conversiones que pidieron turno y quedaron sin resolver. */
  stalePending: number;
}): ReportingVerdict {
  const { setting, tally, sweep, stalePending } = input;

  if (setting.mode === "off") {
    return {
      state: "blocked",
      headline: "El reporte a Meta está apagado",
      detail: `${capitalize(offReasonText(setting.reason))}. No sale ninguna llamada a Meta y ninguna venta se está atribuyendo.`,
    };
  }

  const sinDataset = sweep.wait["operation-has-no-dataset"] ?? 0;
  const sinCuenta = sweep.wait["operation-has-no-whatsapp-account"] ?? 0;
  const sinMoneda = sweep.wait["operation-has-no-currency"] ?? 0;
  if (sinDataset > 0 || sinCuenta > 0 || sinMoneda > 0) {
    const falta = sinDataset
      ? "la operación no tiene dataset de CAPI configurado"
      : sinCuenta
        ? "la operación no tiene conexión de WhatsApp"
        : "la operación no dice su moneda";
    return {
      state: "blocked",
      headline: "Falta configuración para reportar",
      detail: `${ventasFrase(sinDataset + sinCuenta + sinMoneda)} sin reportar porque ${falta}. Se arregla en el panel y las ventas que esperan se reportan solas.`,
    };
  }

  if (tally.failed > 0 || tally.unconfirmed > 0 || stalePending > 0) {
    return {
      state: "failing",
      headline: "El reporte está fallando",
      detail: describirFallas(tally, stalePending, setting.mode),
    };
  }

  if (tally.sent > 0) {
    return {
      state: "working",
      headline:
        setting.mode === "test"
          ? "El reporte está en modo de prueba"
          : "El reporte está funcionando",
      detail:
        setting.mode === "test"
          ? `${ventasFrase(tally.sent)} llegado al administrador de eventos como prueba. **No cuentan como conversión**: hay que pasar a modo real para que la pauta aprenda.`
          : `${ventasFrase(tally.sent)} reportado a Meta en el período.`,
    };
  }

  // Encendido, sin fallas y sin nada mandado. Es lo que se ve igual que una
  // avería, así que se dice qué se miró y por qué no había nada.
  return {
    state: "idle",
    headline: "Encendido, y todavía no hubo nada que reportar",
    detail: describirSilencio(sweep),
  };
}

function describirFallas(
  tally: ConversionTally,
  stalePending: number,
  mode: "test" | "live",
): string {
  const partes: string[] = [];
  if (tally.failed > 0) {
    partes.push(
      `${tally.failed} ${tally.failed === 1 ? "venta fue rechazada" : "ventas fueron rechazadas"} por Meta o agotaron sus reintentos`,
    );
  }
  if (tally.unconfirmed > 0) {
    partes.push(
      `${tally.unconfirmed} ${tally.unconfirmed === 1 ? "quedó" : "quedaron"} en duda: la petición salió y Meta no respondió, y no se reintenta para no contar la venta dos veces`,
    );
  }
  if (stalePending > 0) {
    partes.push(
      `${stalePending} ${stalePending === 1 ? "quedó pidiendo turno" : "quedaron pidiendo turno"} y nunca se resolvió`,
    );
  }
  const cola =
    tally.sent > 0
      ? ` En el mismo período ${ventasFrase(tally.sent).toLowerCase()} llegado bien.`
      : "";
  const prueba = mode === "test" ? " (en modo de prueba)" : "";
  return `${capitalize(partes.join("; "))}.${cola}${prueba}`;
}

/**
 * Por qué no hubo nada que reportar. Es la parte que impide que el silencio se
 * lea como «todo bien»: dice qué se miró.
 */
function describirSilencio(sweep: SweepCounts): string {
  const esperando = sweep.wait["awaiting-customer-confirmation"] ?? 0;
  if (esperando > 0) {
    return `${ventasFrase(esperando)} esperando a que le salga la confirmación al cliente. El evento va después de eso, a propósito.`;
  }
  const sinClic = sweep.skip["no-click-id"] ?? 0;
  const noVentas = sweep.skip["not-a-sales-order"] ?? 0;
  if (sinClic > 0) {
    return `Hubo ${sinClic} ${sinClic === 1 ? "venta" : "ventas"} del vendedor en el período, y ninguna vino de un anuncio: no hay conversión que atribuir.`;
  }
  if (noVentas > 0) {
    return `Hubo ${noVentas} ${noVentas === 1 ? "pedido" : "pedidos"} en el período y ninguno lo tomó el vendedor. El reporte solo cubre las ventas por conversación.`;
  }
  return "No hubo pedidos en el período.";
}

function ventasFrase(n: number): string {
  return n === 1 ? "1 venta ha quedado" : `${n} ventas han quedado`;
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}
