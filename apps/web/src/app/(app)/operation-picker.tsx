"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Flag } from "./flag";
import { selectOperation } from "./frame-actions";
import type { BarOperation } from "./operation-bar";

/**
 * El selector de operación: la cabecera de la columna es también con qué se
 * cambia de país.
 *
 * **Sustituye al riel de baldosas**, que era una barra entera de 78px a la
 * izquierda para una lista de una o dos filas. El país activo se sigue viendo
 * igual de grande —bandera, nombre, estado, moneda y el número que atiende, que
 * es el dato que hace el error irreversible— y lo que se fue es la columna que
 * lo repetía en miniatura.
 *
 * Lo que el riel daba y esto no: los demás países ya no están a la vista todo
 * el tiempo, hay que abrir la lista. Se compensa con la única pista que un
 * selector puede dar sin ocupar sitio —el chevrón, que solo se dibuja cuando
 * hay a dónde cambiar— y con que el estado abierto es el de arranque mientras
 * no haya operación elegida: el día que Colombia se ponga a atender, la lista
 * es lo primero que se ve.
 *
 * Es lo segundo del marco que corre en el cliente, y por lo que un `<details>`
 * no alcanzaba: cerrarse al apretar afuera y con Escape. La lista se despliega
 * **en el flujo**, empujando el menú hacia abajo, y no flotando: la columna
 * tiene `overflow-y-auto` y cualquier globo posicionado dentro saldría
 * recortado por la barra — el mismo motivo por el que salir de la sesión
 * pregunta con un `<dialog>` y no con un menú.
 */
export function OperationPicker({
  entries,
  active,
}: {
  entries: readonly BarOperation[];
  /** La operación sobre la que se trabaja, o `null` si nadie eligió todavía. */
  active: BarOperation | null;
}) {
  // Con una sola operación no hay nada que elegir: la cabecera se dibuja tal
  // cual, sin chevrón y sin nada que apretar. Un selector de un solo elemento
  // es una promesa que no se cumple.
  const sinDondeElegir = entries.length <= 1;
  const [abierto, setAbierto] = useState(active === null && !sinDondeElegir);
  const caja = useRef<HTMLDivElement>(null);
  const lista = useId();

  useEffect(() => {
    if (!abierto) return;
    const afuera = (e: PointerEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    // En captura: el cajón del teléfono escucha `pointerdown` para su gesto de
    // arrastre, y sin capturar el orden entre los dos dependería del árbol.
    document.addEventListener("pointerdown", afuera, true);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("pointerdown", afuera, true);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierto]);

  const op = active?.operation ?? null;
  const dormida = op !== null && op.status !== "active";

  const cara = (
    <>
      {op ? <Flag code={op.countryCode} className="h-[22px] w-8" /> : null}
      <span className="min-w-0 flex-1">
        <span className="op-picker-name">
          <span className="truncate">{op ? op.name : "Elegí una operación"}</span>
          {sinDondeElegir ? null : (
            <ChevronDown
              aria-hidden
              className={`op-picker-caret${abierto ? " is-open" : ""}`}
            />
          )}
        </span>
        <span className="op-picker-meta">
          {op
            ? `${dormida ? "Sin operar" : "Operando"} · ${op.currency}`
            : entries.length === 1
              ? "1 operación"
              : `${entries.length} operaciones`}
        </span>
        {active ? (
          <span
            className={`op-picker-phone${active.phone ? "" : " is-missing"}`}
          >
            {active.phone ?? "sin número conectado"}
          </span>
        ) : null}
      </span>
    </>
  );

  return (
    <div ref={caja} className="op-picker">
      {sinDondeElegir ? (
        <div className="op-picker-face">{cara}</div>
      ) : (
        <button
          type="button"
          className="op-picker-face is-tap"
          aria-haspopup="true"
          aria-expanded={abierto}
          aria-controls={lista}
          onClick={() => setAbierto((antes) => !antes)}
        >
          {cara}
          <span className="sr-only">Cambiar de operación</span>
        </button>
      )}

      {abierto ? (
        <div id={lista} className="op-picker-list">
          {entries.map((entry) => {
            const suya = entry.operation.id === op?.id;
            const suDormida = entry.operation.status !== "active";
            return (
              // Es un formulario porque la cookie de operación es `httpOnly`:
              // la escribe una acción de servidor, no el navegador.
              <form
                key={entry.operation.id}
                action={selectOperation}
                onSubmit={() => setAbierto(false)}
              >
                <input
                  type="hidden"
                  name="operationId"
                  value={entry.operation.id}
                />
                <button
                  type="submit"
                  className="op-pick"
                  aria-current={suya ? "true" : undefined}
                >
                  <Flag
                    code={entry.operation.countryCode}
                    className="h-[13px] w-[19px]"
                  />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[12.5px] font-medium text-[var(--color-text)]">
                      {entry.operation.name}
                    </span>
                    <span className="block truncate text-[10.5px] tabular-nums text-[var(--color-text-dim)]">
                      {suDormida
                        ? "sin operar"
                        : entry.phone ?? "sin número conectado"}
                    </span>
                  </span>
                  {suya ? (
                    <Check
                      aria-hidden
                      className="h-3.5 w-3.5 flex-none text-[var(--op)]"
                    />
                  ) : null}
                  <span className="sr-only">
                    Trabajar sobre {entry.operation.name}
                  </span>
                </button>
              </form>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
