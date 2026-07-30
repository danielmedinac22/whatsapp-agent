import { getDb, getRawClient, sql } from "@wa/db";

/**
 * Reclasifica los pedidos Dropi históricos con el vocabulario nuevo.
 *
 * Va aparte de la migración porque Postgres prohíbe usar un valor de enum
 * recién agregado dentro de la misma transacción (55P04) y drizzle corre todas
 * las migraciones pendientes en una. Correr DESPUÉS de `pnpm db:migrate`.
 *
 * Idempotente: cada UPDATE filtra por el estado de origen.
 *
 * Garantía explícita: NO se manda ningún aviso retroactivo. Los pedidos que
 * pasan a `en_oficina` quedan con `last_notified_status = 'en_oficina'`, así
 * que el job de notificaciones los ve como ya avisados. Solo los pedidos que
 * lleguen a ese estado DESPUÉS del deploy reciben la plantilla nueva.
 */
async function main() {
  const db = getDb();

  // 1. Estados que Dropi ya reportaba y nosotros dejábamos en "unknown"
  //    (128 pedidos ciegos: aparecían como "—" en Pedidos y no se podían
  //    filtrar). El mapeo debe coincidir con dropi/normalize.ts.
  const remap: Array<[string, string[]]> = [
    ["devolucion", ["DEVOLUCION", "DEVOLUCIÓN", "DEVUELTO"]],
    ["rechazado", ["RECHAZADO", "RECHAZADA"]],
    [
      "novedad_solucionada",
      ["NOVEDAD SOLUCIONADA", "INCIDENCIA VALIDADA", "SOLUCION APROBADA", "SOLUCIÓN APROBADA"],
    ],
    ["retornado", ["PAQUETE RETORNADO PARA REPROCESO", "RETORNADO"]],
  ];
  for (const [target, rawStatuses] of remap) {
    // sql.join y no interpolar el array: drizzle lo expandiría como
    // placeholders sueltos y Postgres rechazaría el IN.
    const list = sql.join(
      rawStatuses.map((s) => sql`${s}`),
      sql`, `,
    );
    const res = await db.execute(sql`
      UPDATE dropi_orders
      SET status = ${target}::dropi_status, updated_at = now()
      WHERE status = 'unknown' AND upper(trim(raw_status)) IN (${list})
      RETURNING id;
    `);
    console.log(`${target}: ${rowCount(res)} pedidos`);
  }

  // 2. "ENTREGADO EN EXPRESS CENTER": el paquete está en la oficina de la
  //    transportadora, no en manos del cliente. Dropi lo reporta como
  //    ENTREGADO, así que hasta hoy les decíamos "tu pedido fue entregado".
  const office = await db.execute(sql`
    UPDATE dropi_orders
    SET status = 'en_oficina'::dropi_status, updated_at = now()
    WHERE status = 'entregado'
      AND upper(coalesce(last_movement_raw, '')) ~ '^ENTREGADO EN (EXPRESS CENTER|OFICINA|AGENCIA)'
    RETURNING id;
  `);
  console.log(`en_oficina: ${rowCount(office)} pedidos reclasificados`);

  // 3. Sello anti-retroactivo: nadie recibe la plantilla nueva por un paquete
  //    que lleva semanas en la oficina.
  const sealed = await db.execute(sql`
    UPDATE dropi_orders
    SET last_notified_status = 'en_oficina'::dropi_status,
        last_notified_at = coalesce(last_notified_at, now()),
        updated_at = now()
    WHERE status = 'en_oficina'
      AND (last_notified_status IS NULL OR last_notified_status <> 'en_oficina')
    RETURNING id;
  `);
  console.log(
    `sellados sin notificar: ${rowCount(sealed)} pedidos (no reciben aviso retroactivo)`,
  );

  await getRawClient().end();
}

function rowCount(result: unknown): number | string {
  if (Array.isArray(result)) return result.length;
  return (result as { rowCount?: number }).rowCount ?? "?";
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
