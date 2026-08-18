import { AlertTriangle } from "lucide-react";
import type { PanelOperationState } from "@wa/db";

/**
 * Lo que el panel muestra cuando **no sabe** sobre qué operación trabajar.
 *
 * Es el estado que aparece el día que Colombia se ponga `active`, la primera vez
 * que cada admin entra: hay dos operaciones y nadie eligió todavía. El riel se
 * dibuja igual —está a la izquierda, con las dos— y acá va el porqué.
 *
 * **Ninguna pantalla se renderiza mientras tanto.** No es una advertencia
 * encima del contenido: es *en lugar del* contenido. Mostrar el Inbox de un
 * país que el admin no eligió, con un aviso arriba que se lee en tres días y ya
 * no, es exactamente la forma silenciosa del error que todo esto previene.
 */
export function ChooseOperation({ state }: { state: PanelOperationState }) {
  const activas = state.operations.filter((o) => o.status === "active");
  const sinNinguna = state.operations.length === 0 || activas.length === 0;

  return (
    <div className="app-page flex max-w-2xl flex-col gap-3 pt-10">
      <div className="app-card flex flex-col gap-3 p-6">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border-strong)] text-[var(--color-highlight)]">
          <AlertTriangle className="h-4 w-4" />
        </span>

        {sinNinguna ? (
          <>
            <h1 className="app-title">No hay ninguna operación atendiendo</h1>
            <p className="app-subtitle app-muted">
              El panel trabaja siempre sobre una operación, y ahora mismo no hay
              ninguna activa. Se activa desde la configuración, no desde aquí.
            </p>
          </>
        ) : (
          <>
            <h1 className="app-title">
              ¿Sobre qué operación querés trabajar?
            </h1>
            <p className="app-subtitle app-muted">
              Hay {activas.length} operaciones atendiendo (
              {activas.map((o) => o.name).join(" y ")}) y todavía no elegiste
              ninguna. Elegila en el riel de la izquierda: todo lo que veas y
              edites a partir de ahí —conversaciones, pedidos, plantillas,
              configuración— es de esa operación y solo de esa.
            </p>
            {state.reason === "eleccion_desconocida" ? (
              <p className="app-subtitle text-[var(--color-highlight)]">
                La operación que tenías elegida ya no existe, así que hay que
                elegir de nuevo.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
