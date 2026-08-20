import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Operation } from "@wa/db";
import { ConnectionIndicator } from "./connection-indicator";
import { ModuleNav, ModuleNavIcons, type SalesNav } from "./module-nav";
import { selectOperation, toggleBars } from "./frame-actions";
import { SignOutButton } from "./sign-out-button";
import type { PanelBars } from "@/lib/operation";

/**
 * El riel de operaciones y la columna de navegación: el marco entero.
 *
 * **Es el modelo Slack completo — riel + tinte, no uno de los dos.** El tinte
 * solo dice dónde estás; el riel deja el otro país a la vista aunque no se esté
 * usando, que es lo que hace falta el día de la apertura. Con la placa sola, un
 * admin que nunca vio Colombia no sabe que existe.
 *
 * Plegado queda en 46px: conserva en qué país estás, que existe el otro, y la
 * navegación por iconos de la pantalla actual. Lo que se pierde son los nombres
 * de las pantallas y el número de teléfono.
 */

export interface RailOperation {
  operation: Operation;
  /** El número que atiende, de su conexión de WhatsApp. `null` = sin conectar. */
  phone: string | null;
}

/** Los degradados de las banderas que sabemos dibujar. */
const FLAGS: Readonly<Record<string, string>> = {
  GT: "linear-gradient(90deg,#4997d0 0 33.3%,#fff 33.3% 66.6%,#4997d0 66.6%)",
  CO: "linear-gradient(180deg,#fcd116 0 50%,#003893 50% 75%,#ce1126 75%)",
};

function Flag({
  code,
  className,
}: {
  code: string;
  className: string;
}) {
  const gradient = FLAGS[code.toUpperCase()];
  return (
    <span
      aria-hidden
      className={`op-flag ${className}`}
      // Un país sin bandera dibujada no se queda en blanco: toma el tinte de su
      // propia operación, que ya es distinto del de cualquier otra.
      style={{ background: gradient ?? "var(--op)" }}
    />
  );
}

/** Baldosa de una operación. Es un formulario porque la cookie es `httpOnly`. */
function OperationTile({
  entry,
  active,
  tight,
}: {
  entry: RailOperation;
  active: boolean;
  tight: boolean;
}) {
  const op = entry.operation;
  const dormant = op.status !== "active";
  return (
    <form action={selectOperation}>
      <input type="hidden" name="operationId" value={op.id} />
      <button
        type="submit"
        className={`op-tile${tight ? " is-tight" : ""}${dormant ? " is-dormant" : ""}`}
        aria-pressed={active}
        title={`${op.name} · ${dormant ? "sin operar" : "operando"}${
          entry.phone ? ` · ${entry.phone}` : ""
        }`}
      >
        <Flag code={op.countryCode} className={tight ? "h-3 w-[18px]" : "h-[15px] w-[22px]"} />
        {tight ? null : (
          <span className="op-tile-code">{op.countryCode}</span>
        )}
        <span className="sr-only">Trabajar sobre {op.name}</span>
      </button>
    </form>
  );
}

function FoldButton({ next }: { next: PanelBars }) {
  const collapsing = next === "collapsed";
  return (
    <form action={toggleBars}>
      <input type="hidden" name="bars" value={next} />
      <button
        type="submit"
        className="op-fold"
        title={collapsing ? "Colapsar barras" : "Expandir barras"}
      >
        {collapsing ? (
          <ChevronLeft className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <span className="sr-only">
          {collapsing ? "Colapsar barras" : "Expandir barras"}
        </span>
      </button>
    </form>
  );
}

/**
 * Cerrar sesión vive en el riel y no en la columna a propósito: el riel
 * sobrevive al plegado, así que la salida no depende de tener las barras
 * abiertas. Lo que sí cambió es la vecindad. El botón está en
 * `sign-out-button.tsx`, separado del de plegar por una línea y preguntando
 * antes de salir.
 */

export function OperationRail({
  entries,
  activeId,
  bars,
  allowed,
  sales,
}: {
  entries: readonly RailOperation[];
  activeId: string | null;
  bars: PanelBars;
  allowed: readonly string[];
  /** El vendedor de la operación activa, o `null` si no tiene configurado. */
  sales: SalesNav | null;
}) {
  const tight = bars === "collapsed";
  return (
    <aside className={`op-rail${tight ? " is-tight" : ""}`}>
      {entries.map((entry) => (
        <OperationTile
          key={entry.operation.id}
          entry={entry}
          active={entry.operation.id === activeId}
          tight={tight}
        />
      ))}
      {tight ? <ModuleNavIcons allowed={allowed} sales={sales} /> : null}
      {/* Salir y plegar no son el mismo grupo, y hasta hoy se veían como uno:
          6px de separación entre un clic que se hace todos los días y otro que
          tira la sesión. La línea los separa y el chevrón se queda donde
          estaba, abajo del todo, para no mover la mano que ya lo tiene
          aprendido. */}
      <div className="mt-auto flex flex-col items-center pt-2">
        <SignOutButton />
        <span aria-hidden className="op-rail-sep" />
        <FoldButton next={tight ? "open" : "collapsed"} />
      </div>
    </aside>
  );
}

/**
 * La columna: quién es la operación activa, y la navegación anidada dentro.
 *
 * **El número de teléfono va junto al color**, decisión 6 de la ronda 2: es el
 * dato que hace el error irreversible —es lo que le sale al cliente— y protege
 * de que el tinte se vuelva papel tapiz con el uso diario. Se descartó llevar
 * también la moneda en su propia línea y el recuadro: costaban ~70px
 * permanentes.
 */
export function OperationColumn({
  entry,
  allowed,
  email,
  sales,
}: {
  entry: RailOperation;
  allowed: readonly string[];
  email: string | null | undefined;
  /** El vendedor de esta operación, o `null` si no tiene configurado. */
  sales: SalesNav | null;
}) {
  const op = entry.operation;
  const dormant = op.status !== "active";
  return (
    <div className="op-column">
      <div className="op-column-head">
        <Flag code={op.countryCode} className="h-[22px] w-8" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-[var(--color-text)]">
            {op.name}
          </span>
          <span className="mt-0.5 block text-[10px] uppercase tracking-wider text-[var(--color-text-dim)]">
            {dormant ? "Sin operar" : "Operando"} · {op.currency}
          </span>
          <span
            className={`mt-1 block text-[11.5px] font-semibold tabular-nums ${
              entry.phone
                ? "text-[var(--op)]"
                : "text-[var(--color-warn)]"
            }`}
          >
            {entry.phone ?? "sin número conectado"}
          </span>
        </span>
        <FoldButton next="collapsed" />
      </div>

      <ModuleNav allowed={allowed} sales={sales} />

      <div className="mt-auto space-y-2 border-t border-[var(--color-border)] pt-3">
        <ConnectionIndicator />
        <p className="truncate px-1 text-[11px] text-[var(--color-text-dim)]">
          {email ?? "sesión sin correo"}
        </p>
      </div>
    </div>
  );
}
