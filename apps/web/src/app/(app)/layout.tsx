import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db, kapsoConnection } from "@/lib/db";
import { getSalesAgentSettings } from "@wa/db";
import { countSalesInboxViews } from "@/lib/queries";
import { operationTint } from "@wa/shared";
import { resolveAccess } from "@/access/resolve";
import { resolvePanelBars, resolvePanelOperationState } from "@/lib/operation";
import { ChooseOperation } from "./choose-operation";
import { NAV_HREFS } from "./nav";
import type { SalesNav } from "./module-nav";
import {
  OperationColumn,
  OperationRail,
  type RailOperation,
} from "./operation-rail";

/**
 * El marco del panel: el riel de operaciones, el tinte del país activo y la
 * navegación anidada dentro.
 *
 * **El tinte muere aquí.** Las variables `--op*` se declaran en este elemento y
 * las usan el riel y la columna; el contenido conserva siempre la paleta
 * neutra. Si `--color-accent-strong` siguiera al país, cada botón primario
 * cambiaría de color y el verde dejaría de significar «confirmado» — justo en
 * Guatemala, que es lo que factura. Es la decisión 1 del nivel 1 y la razón por
 * la que los tres referentes del patrón (Slack, la consola de AWS, el modo
 * prueba de Stripe) confinan el color al cromo.
 *
 * De aquí para adentro, cada pantalla resuelve su propia operación con
 * `resolvePanelOperation()`: el layout no se la puede pasar a los `children`, y
 * pasarla por contexto la volvería invisible en la firma de las consultas, que
 * es justo lo que este trabajo vino a evitar.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  // **Sin lanzar, a propósito.** El marco tiene que dibujarse aunque no haya
  // operación elegida: es el que trae el riel con el que se elige. Si esto
  // lanzara —como lanza `resolvePanelOperation()` en las pantallas—, el día que
  // Colombia se ponga `active` el panel quedaría sin salida: para elegir haría
  // falta un riel que no se podría dibujar hasta haber elegido.
  const [state, bars] = await Promise.all([
    resolvePanelOperationState(),
    resolvePanelBars(),
  ]);
  const active = state.operation;
  const operations = state.operations;

  // El número de cada operación sale de su conexión de WhatsApp. Una sola
  // consulta para todo el riel: son una o dos filas, y el índice único de la
  // `0021` garantiza una conexión por operación.
  const connections = await db
    .select({
      operationId: kapsoConnection.operationId,
      phone: kapsoConnection.displayPhoneNumber,
    })
    .from(kapsoConnection);
  const phoneByOperation = new Map(
    connections.map((c) => [c.operationId, c.phone]),
  );

  const entries: RailOperation[] = operations.map((operation) => ({
    operation,
    phone: phoneByOperation.get(operation.id) ?? null,
  }));
  const activeEntry = active
    ? entries.find((e) => e.operation.id === active.id) ?? {
        operation: active,
        phone: phoneByOperation.get(active.id) ?? null,
      }
    : null;

  // Las rutas que este rol alcanza, decididas por la misma función que el borde
  // (`src/proxy.ts`): el menú no puede ofrecer una pantalla que rebota, ni
  // esconder una que sí abre.
  const allowed = NAV_HREFS.filter(
    (href) => resolveAccess(session.user.role, href).allowed,
  );

  /**
   * El vendedor de la operación activa, y los contadores de sus vistas.
   *
   * **`null` es el interruptor de la no-regresión**, y aquí se nota más que en
   * ningún otro sitio: sin fila en `sales_agent_settings` no hay enlace de
   * Conversaciones, no hay vistas, no se derivan bandejas y no se paga ni una
   * consulta de más. En producción esa tabla está vacía, así que hoy el marco
   * de Katherine se dibuja exactamente igual que antes de este ticket.
   *
   * Los contadores se calculan en el layout y no en la bandeja porque tienen
   * que verse **desde afuera** de ella (decisión 1 del nivel 2): un contador
   * que solo aparece estando ya dentro no sirve para que entres.
   */
  const seller = active ? await getSalesAgentSettings(active) : null;
  const sales: SalesNav | null = seller
    ? {
        counts: await countSalesInboxViews(active!),
        sellerName: seller.displayName.trim() || "el vendedor",
      }
    : null;

  // Sin operación elegida el marco no toma el color de ninguna: teñirlo del
  // primero de la lista sería decir que se está trabajando sobre él.
  const tint = active
    ? operationTint(active.countryCode)
    : {
        base: "var(--color-text-soft)",
        line: "var(--color-border-strong)",
        soft: "rgba(157, 187, 210, 0.08)",
        faint: "rgba(157, 187, 210, 0.04)",
      };
  const collapsed = bars === "collapsed";

  return (
    <div
      className="app-frame"
      data-bars={active ? bars : "collapsed"}
      style={
        {
          "--op": tint.base,
          "--op-line": tint.line,
          "--op-soft": tint.soft,
          "--op-faint": tint.faint,
        } as React.CSSProperties
      }
    >
      <OperationRail
        entries={entries}
        activeId={active?.id ?? null}
        bars={bars}
        allowed={allowed}
        sales={sales}
      />
      {collapsed || !activeEntry ? null : (
        <OperationColumn
          entry={activeEntry}
          allowed={allowed}
          email={session.user.email}
          sales={sales}
        />
      )}

      <main className="app-main">
        {/* `children` no se renderiza mientras no haya operación: la pantalla
            no se dibuja «por debajo» de un aviso, sencillamente no se dibuja. */}
        <div>{active ? children : <ChooseOperation state={state} />}</div>
      </main>
    </div>
  );
}
