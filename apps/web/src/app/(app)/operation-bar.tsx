import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Operation } from "@wa/db";
import { ConnectionIndicator } from "./connection-indicator";
import { Flag } from "./flag";
import { ModuleNav, ModuleNavIcons, type SalesNav } from "./module-nav";
import { OperationPicker } from "./operation-picker";
import { toggleBars } from "./frame-actions";
import { SignOutButton } from "./sign-out-button";
import type { PanelBars } from "@/lib/operation";

/**
 * La barra del panel: quién es la operación activa y la navegación anidada
 * dentro.
 *
 * **Es una sola barra y no dos.** Hasta hoy eran el riel de operaciones —78px
 * de baldosas, una por país— y la columna colgando de él. El riel se fue: su
 * único trabajo, cambiar de operación, lo hace ahora la propia cabecera de la
 * columna, que es un selector (`operation-picker.tsx`). Lo que eso compra son
 * 78px de ancho permanentes en todas las pantallas, que es el motivo del
 * cambio.
 *
 * Lo que se pierde a cambio está medido: los demás países dejan de estar a la
 * vista sin abrir nada. La contrapartida la lleva el selector, que se abre solo
 * mientras no haya operación elegida.
 *
 * Plegada, la barra queda en 46px —{@link OperationStrip}— y conserva en qué
 * país estás, la navegación por iconos de la pantalla actual y la salida. Lo
 * que se pierde son los nombres de las pantallas y el número de teléfono.
 */

export interface BarOperation {
  operation: Operation;
  /** El número que atiende, de su conexión de WhatsApp. `null` = sin conectar. */
  phone: string | null;
}

function FoldButton({ next }: { next: PanelBars }) {
  const collapsing = next === "collapsed";
  return (
    <form action={toggleBars}>
      <input type="hidden" name="bars" value={next} />
      <button
        type="submit"
        className="op-fold"
        title={collapsing ? "Colapsar la barra" : "Expandir la barra"}
      >
        {collapsing ? (
          <ChevronLeft className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <span className="sr-only">
          {collapsing ? "Colapsar la barra" : "Expandir la barra"}
        </span>
      </button>
    </form>
  );
}

/**
 * La barra plegada: 46px con la bandera del país, los iconos de la pantalla
 * actual y la salida.
 *
 * **La bandera es el botón que despliega**, y no un adorno: plegada no hay
 * sitio para el selector, así que el sitio donde vive el país es también por
 * donde se llega a cambiarlo. Un clic para abrir la barra, otro para elegir.
 *
 * Es un estado de escritorio y solo se dibuja ahí: en el teléfono no hay barras
 * que plegar, hay un cajón que se abre y se cierra.
 */
export function OperationStrip({
  entry,
  allowed,
  sales,
}: {
  entry: BarOperation;
  allowed: readonly string[];
  /** El vendedor de la operación activa, o `null` si no tiene configurado. */
  sales: SalesNav | null;
}) {
  const op = entry.operation;
  const dormant = op.status !== "active";
  return (
    <aside className="op-strip">
      <form action={toggleBars}>
        <input type="hidden" name="bars" value="open" />
        <button
          type="submit"
          className="op-strip-tile"
          title={`${op.name} · ${dormant ? "sin operar" : "operando"}${
            entry.phone ? ` · ${entry.phone}` : ""
          } — expandir la barra`}
        >
          <Flag code={op.countryCode} className="h-3 w-[18px]" />
          <span className="sr-only">Expandir la barra</span>
        </button>
      </form>

      <ModuleNavIcons allowed={allowed} sales={sales} />

      {/* Salir y plegar no son el mismo grupo, y hasta hace poco se veían como
          uno: 6px de separación entre un clic que se hace todos los días y otro
          que tira la sesión. La línea los separa y el chevrón se queda donde
          estaba, abajo del todo, para no mover la mano que ya lo tiene
          aprendido. */}
      <div className="mt-auto flex flex-col items-center pt-2">
        <SignOutButton />
        <span aria-hidden className="op-sep" />
        <FoldButton next="open" />
      </div>
    </aside>
  );
}

/**
 * La barra abierta: el selector de operación arriba y el menú de módulos
 * debajo.
 *
 * **El número de teléfono va junto al color**, decisión 6 de la ronda 2: es el
 * dato que hace el error irreversible —es lo que le sale al cliente— y protege
 * de que el tinte se vuelva papel tapiz con el uso diario. Se descartó llevar
 * también la moneda en su propia línea y el recuadro: costaban ~70px
 * permanentes.
 *
 * **Se dibuja aunque no haya operación elegida**, y entonces trae el selector
 * abierto y ningún menú: sin operación no hay pantalla a la que ir —el layout
 * dibuja `<ChooseOperation>` en lugar del contenido—, pero sí hay dos cosas que
 * hacer, elegir y salir. Con el riel eran suyas; ahora son de acá, y por eso
 * `entry` puede ser `null`.
 */
export function OperationColumn({
  entries,
  active,
  allowed,
  email,
  sales,
}: {
  /** Todas las operaciones, que son las que ofrece el selector. */
  entries: readonly BarOperation[];
  /** Sobre cuál se trabaja, o `null` si nadie eligió todavía. */
  active: BarOperation | null;
  allowed: readonly string[];
  email: string | null | undefined;
  /** El vendedor de esta operación, o `null` si no tiene configurado. */
  sales: SalesNav | null;
}) {
  return (
    <div className="op-column">
      <div className="op-column-head">
        <OperationPicker entries={entries} active={active} />
        {/* Sin operación elegida no hay nada que plegar: el layout fuerza la
            barra abierta —es la que trae el selector—, así que el chevrón sería
            un botón que no hace nada. */}
        {active ? <FoldButton next="collapsed" /> : null}
      </div>

      {active ? <ModuleNav allowed={allowed} sales={sales} /> : null}

      <div className="mt-auto space-y-2 border-t border-[var(--color-border)] pt-3">
        {/* El indicador pregunta por la conexión de la operación activa: sin
            operación no hay nada por lo que preguntar, y dibujarlo diría
            «desconectado» de un número que nadie eligió. */}
        {active ? <ConnectionIndicator /> : null}
        {/* Salir vivía en el riel, que sobrevivía al plegado. Ahora vive acá, al
            lado del correo de quien está dentro —que es lo que la salida
            deshace— y con la misma pregunta en medio. Plegada, la barra lo
            conserva en la tira. */}
        <div className="flex items-center gap-1.5">
          <p className="min-w-0 flex-1 truncate px-1 text-[11px] text-[var(--color-text-dim)]">
            {email ?? "sesión sin correo"}
          </p>
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
