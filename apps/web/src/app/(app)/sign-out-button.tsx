"use client";

import { useRef, useTransition } from "react";
import { LogOut } from "lucide-react";
import { endSession } from "./frame-actions";

/**
 * Cerrar sesión, con una pregunta en medio.
 *
 * **La pregunta no es cortesía, es que el clic es irreversible y el vecino de
 * abajo se usa veinte veces al día.** Plegar las barras y salir del panel
 * vivían a 6px uno del otro; fallar el chevrón por unos píxeles tiraba la
 * sesión y no había cómo deshacerlo. La separación en el riel baja los errores,
 * el diálogo los vuelve inofensivos.
 *
 * Va con `<dialog>` nativo y `showModal()` a propósito: el riel tiene
 * `overflow-y-auto`, así que cualquier globo posicionado dentro quedaría
 * recortado por la barra. El modal se dibuja en la capa superior del navegador,
 * fuera del recorte, y trae gratis el foco atrapado y el Escape.
 *
 * El foco arranca en Cancelar. Quien abrió esto por error sale con Enter.
 */
export function SignOutButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [leaving, startLeaving] = useTransition();

  const close = () => dialog.current?.close();

  return (
    <>
      <button
        type="button"
        className="op-rail-icon is-exit"
        title="Cerrar sesión"
        onClick={() => dialog.current?.showModal()}
      >
        <LogOut className="h-4 w-4" />
        <span className="sr-only">Cerrar sesión</span>
      </button>

      <dialog
        ref={dialog}
        className="op-dialog"
        aria-labelledby="op-exit-title"
        // Clic en el fondo cierra. El nativo no lo hace solo, y el `<dialog>`
        // ocupa toda la pantalla: el clic de afuera aterriza en él, no en el
        // recuadro.
        onClick={(e) => {
          if (e.target === dialog.current && !leaving) close();
        }}
      >
        <h2 id="op-exit-title" className="text-base font-semibold">
          ¿Cerrar sesión?
        </h2>
        <p className="mt-1.5 text-[13px] leading-5 text-[var(--color-text-dim)]">
          Vuelves a la pantalla de acceso y tendrás que entrar de nuevo con tu
          correo y tu contraseña.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            className="app-button-secondary"
            onClick={close}
            disabled={leaving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="op-exit-confirm"
            disabled={leaving}
            onClick={() =>
              startLeaving(async () => {
                await endSession();
              })
            }
          >
            {leaving ? "Saliendo…" : "Sí, cerrar sesión"}
          </button>
        </div>
      </dialog>
    </>
  );
}
