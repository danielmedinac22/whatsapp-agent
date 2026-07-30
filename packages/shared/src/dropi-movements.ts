/**
 * Situaciones logísticas, agrupadas desde el vocabulario REAL que reporta la
 * transportadora en `servientrega_movements[].nom_mov` (Dropi). Los nombres se
 * comparan en mayúsculas y exactos: son valores cerrados que emite el carrier,
 * no texto libre del cliente.
 *
 * Vive en @wa/shared porque la lista tiene que ser la misma en el filtro de la
 * UI y en el WHERE de la consulta; si divergen, el filtro miente.
 *
 * Un movimiento nuevo que no caiga en ningún grupo no desaparece: la tabla de
 * Pedidos muestra `last_movement_raw` tal cual, así que se ve aunque todavía
 * no tenga bucket.
 */

export interface LogisticSituation {
  key: string;
  label: string;
  /** Valores exactos de nom_mov (en MAYÚSCULAS) que caen en este grupo. */
  movements: string[];
}

export const LOGISTIC_SITUATIONS: LogisticSituation[] = [
  {
    key: "en_oficina",
    label: "Por reclamar en oficina",
    movements: [
      "ENTREGADO EN EXPRESS CENTER",
      "ENTREGADO EN OFICINA",
      "ENTREGADO EN AGENCIA",
    ],
  },
  {
    key: "reprogramado",
    label: "Cliente reprogramó la entrega",
    movements: ["DESTINATARIO RE-PROGRAMA FECHA DE ENTREGA"],
  },
  {
    key: "sin_contacto",
    label: "No contesta llamadas ni WhatsApp",
    movements: ["DESTINATARIO NO CONTESTA LLAMADAS NI WHATSAPP"],
  },
  {
    key: "ausente",
    label: "No estaba en la dirección",
    movements: ["DESTINATARIO NO SE ENCUENTRA EN LUGAR DE ENTREGA."],
  },
  {
    key: "telefono_malo",
    label: "Teléfono incorrecto",
    movements: ["NÚMERO TELEFÓNICO INCORRECTO", "NUMERO TELEFONICO INCORRECTO"],
  },
  {
    key: "fuera_cobertura",
    label: "Fuera de cobertura",
    movements: [
      "FUERA DE COBERTURA, NO COINCIDE LA CIUDAD REAL DESTINO CON LA CIUDAD INGRESADA",
    ],
  },
  {
    key: "cambio_direccion",
    label: "Pide cambio de dirección",
    movements: ["DESTINATARIO SOLICITA CAMBIO DE DIRECCIÓN"],
  },
  {
    key: "no_recibe",
    label: "Cliente no quiere recibir",
    movements: [
      "DESTINATARIO INDICA QUE ESTÁ INCONFORME CON EL PRODUCTO. (NO RECIBE)",
      "DESTINATARIO INDICA QUE YA NO DESEA EL PRODUCTO",
      "DESTINATARIO INDICA QUE NO HA COMPRADO NINGÚN PRODUCTO",
      "DESTINATARIO INDICA QUE YA RECIBIÓ EL PRODUCTO",
    ],
  },
  {
    key: "devuelto",
    label: "Devuelto / retornado",
    movements: ["DEVUELTO", "DEVOLUCIÓN", "DEVOLUCION", "PAQUETE RETORNADO PARA REPROCESO"],
  },
  {
    key: "incidencia",
    label: "Incidencia en ruta",
    movements: ["INCIDENCIA EN RUTA", "INCIDENCIA VALIDADA", "SOLUCION APROBADA"],
  },
  {
    key: "en_ruta",
    label: "En ruta",
    movements: [
      "RECOLECTADO",
      "EN TRÁNSITO",
      "EN TRANSITO",
      "EN REPARTO",
      "EN RUTA",
      "EN INVENTARIO",
      "PACKING",
      "GENERADA",
      "SOLICITADO",
    ],
  },
  {
    key: "entregado",
    label: "Entregado al cliente",
    movements: ["ENTREGADO", "COD PAGADO", "ENTREGADA GINTRACOM"],
  },
];

export function situationByKey(key: string): LogisticSituation | null {
  return LOGISTIC_SITUATIONS.find((s) => s.key === key) ?? null;
}

/** Grupo al que pertenece un movimiento, o null si es uno que no conocemos. */
export function situationOfMovement(
  movement: string | null | undefined,
): LogisticSituation | null {
  if (!movement) return null;
  const upper = movement.trim().toUpperCase();
  return (
    LOGISTIC_SITUATIONS.find((s) => s.movements.includes(upper)) ?? null
  );
}
