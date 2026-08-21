import { auth } from "@/auth";
import { redirect } from "next/navigation";
import {
  getSalesAgentSettings,
  listConnectionPhones,
  salesAgentIsConfigured,
} from "@wa/db";
import { countSalesInboxViews } from "@/lib/queries";
import { operationTint } from "@wa/shared";
import { resolveAccess } from "@/access/resolve";
import { resolvePanelBars, resolvePanelOperationState } from "@/lib/operation";
import { ChooseOperation } from "./choose-operation";
import { MobileFrame } from "./mobile-frame";
import { NAV_HREFS } from "./nav";
import type { SalesNav } from "./module-nav";
import {
  Flag,
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
 * neutra. Si `--color-ink` siguiera al país, cada botón primario cambiaría de
 * color y el verde dejaría de significar «confirmado» — justo en Guatemala,
 * que es lo que factura. Es la decisión 1 del nivel 1 y la razón por
 * la que los tres referentes del patrón (Slack, la consola de AWS, el modo
 * prueba de Stripe) confinan el color al cromo.
 *
 * De aquí para adentro, cada pantalla resuelve su propia operación con
 * `resolvePanelOperation()`: el layout no se la puede pasar a los `children`, y
 * pasarla por contexto la volvería invisible en la firma de las consultas, que
 * es justo lo que este trabajo vino a evitar.
 *
 * **Debajo de `lg` las dos barras no se apilan sobre el contenido: entran en un
 * cajón** (`<MobileFrame>`), y arriba queda una barra de 52px. Es el veredicto
 * del nivel 4. El riel y la columna se siguen dibujando **acá, en el
 * servidor**, y viajan como `children`: el cajón es un envoltorio y no un
 * segundo menú, así que no hay dos árboles de navegación que mantener de
 * acuerdo ni dos veces las consultas que los alimentan.
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
  //
  // **Y desde PRO-15 esa consulta casi nunca viaja.** Es la hermana de
  // `listOperations`: las dos dibujan el riel, las dos traen una o dos filas que
  // cambian cuando alguien conecta un número, y las dos las paga cada render de
  // cada una de las siete pantallas. La invalida `invalidateKapsoConnectionCache`
  // en el worker, que es quien escribe.
  const connections = await listConnectionPhones();
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
   * ningún otro sitio: sin vendedor no hay enlace de Conversaciones, no hay
   * vistas, no se derivan bandejas y no se paga ni una consulta de más.
   *
   * **El listón es `salesAgentIsConfigured`, no «existe la fila».** Preguntar
   * por la fila fue el error que este ticket vino a corregir: el `upsert` de
   * `/vendedor` la crea con todos los textos en `''`, así que abrir la pantalla
   * de configuración encendía el módulo entero —menú, vistas y contadores— con
   * el vendedor apagado del lado del worker. Ahora el panel y el que contesta
   * responden lo mismo, porque preguntan lo mismo.
   *
   * Los contadores se calculan en el layout y no en la bandeja porque tienen
   * que verse **desde afuera** de ella (decisión 1 del nivel 2): un contador
   * que solo aparece estando ya dentro no sirve para que entres.
   */
  const seller = active ? await getSalesAgentSettings(active) : null;
  const sales: SalesNav | null =
    active && salesAgentIsConfigured(seller)
      ? {
          // La fila entera y no solo la operación: el corte del vendedor
          // (`activated_at`) decide qué conversación es suya, y «En automático»
          // solo significa algo con el vendedor encendido — que es justo lo que
          // el guardia de arriba acaba de comprobar.
          counts: await countSalesInboxViews(active, seller),
          // El listón garantiza que no está vacío: es literalmente lo que
          // pregunta. Por eso acá no hay ningún «o el vendedor» de reserva —un
          // nombre de reserva es la barra diciendo un nombre que nadie escribió.
          sellerName: seller.displayName.trim(),
        }
      : null;

  // Sin operación elegida el marco no toma el color de ninguna: teñirlo del
  // primero de la lista sería decir que se está trabajando sobre él.
  const tint = active
    ? operationTint(active.countryCode)
    : {
        // `--op` también pinta texto (el código del país en la baldosa, el
        // módulo activo), así que el neutro de reserva tiene que ser un color
        // de texto: «tenue» da 4,54:1 sobre el riel y «suave» 2,85:1.
        base: "var(--color-text-dim)",
        line: "var(--color-border-strong)",
        soft: "color-mix(in srgb, var(--color-text-soft) 14%, transparent)",
        faint: "color-mix(in srgb, var(--color-text-soft) 7%, transparent)",
      };

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
      <MobileFrame
        barra={
          active ? (
            <>
              <Flag code={active.countryCode} className="h-[11px] w-4" />
              <span className="truncate">{active.name}</span>
            </>
          ) : (
            // Sin operación elegida la barra no inventa un nombre: dice lo que
            // hay que hacer, y el cajón lleva dentro el riel con el que se hace.
            <span className="truncate text-[var(--color-text-dim)]">
              Elegí una operación
            </span>
          )
        }
      >
        <OperationRail
          entries={entries}
          activeId={active?.id ?? null}
          bars={bars}
          allowed={allowed}
          sales={sales}
        />
        {/* **La columna se dibuja aunque las barras estén plegadas**, y es
            `globals.css` quien la esconde —solo en escritorio— con
            `.app-frame[data-bars="collapsed"] .op-column`. Omitirla del árbol
            dejaba el cajón del teléfono sin menú: plegar es una preferencia
            que se toma en una pantalla grande y viaja en una cookie hasta el
            móvil, donde no significa nada. */}
        {activeEntry ? (
          <OperationColumn
            entry={activeEntry}
            allowed={allowed}
            email={session.user.email}
            sales={sales}
          />
        ) : null}
      </MobileFrame>

      <main className="app-main">
        {/* `children` no se renderiza mientras no haya operación: la pantalla
            no se dibuja «por debajo» de un aviso, sencillamente no se dibuja. */}
        <div>{active ? children : <ChooseOperation state={state} />}</div>
      </main>
    </div>
  );
}
