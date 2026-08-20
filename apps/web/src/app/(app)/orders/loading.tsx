/**
 * La silueta de Pedidos mientras el servidor lo arma.
 *
 * Misma razón que el Inbox: la pantalla es `force-dynamic`, trae la tabla
 * entera de una y el clic en el menú no cambiaba nada hasta que llegaba. El
 * único indicador que ya existía —«Filtrando…»— vive dentro de la tabla ya
 * montada, así que no cubre el viaje de entrada, que es el que se siente
 * colgado.
 *
 * **Lo que ya se sabe se dibuja de verdad, no en gris.** El título, el párrafo
 * de abajo y los ocho encabezados de columna son texto fijo de esta pantalla:
 * no dependen de ninguna consulta, así que aparecen desde el primer fotograma
 * y no se mueven cuando llegan las filas. Un esqueleto que también tapa lo que
 * ya podía decirse no está esperando, está escondiendo.
 */

/** Los cinco selectores de la barra de filtros, del ancho de su rótulo:
 *  «Situación logística», «Estado Dropi», «Estado Shopify», «Transportadora»,
 *  «Match». Van desparejos porque los de verdad lo son. */
const FILTROS = ["w-56", "w-44", "w-40", "w-40", "w-36"] as const;

/** Las ocho columnas, en el orden y con el rótulo de `orders-table.tsx`. */
const COLUMNAS = [
  "Pedido",
  "Cliente",
  "Recibido",
  "Estado Shopify",
  "Estado Dropi",
  "Situación logística",
  "Guía / Transportadora",
  "Match",
] as const;

/** Doce filas: llenan la primera pantalla de la tabla sin estirar el documento
 *  más de lo que lo estira el contenido real. */
const FILAS = Array.from({ length: 12 }, (_, i) => i);

export default function OrdersLoading() {
  return (
    <div className="app-page space-y-3">
      <p role="status" className="sr-only">
        Cargando Pedidos…
      </p>

      <header className="max-w-3xl">
        <h1 className="app-title">Pedidos</h1>
        <p className="app-subtitle app-muted mt-1">
          Filtra por situación logística y salta a la conversación del cliente.
          El check verde aparece cuando Shopify ya marcó el pedido como
          confirmado.
        </p>
      </header>

      <div className="app-card space-y-2 p-3">
        <div className="app-skeleton h-9 w-full" />
        <div className="flex flex-wrap items-center gap-2">
          {FILTROS.map((ancho, i) => (
            <div key={i} className={`app-skeleton h-9 lg:h-8 ${ancho}`} />
          ))}
          {/* El contador de la derecha —«N pedidos»—, en su sitio. */}
          <div className="app-skeleton ml-auto h-4 w-20" />
        </div>
      </div>

      <div className="app-card overflow-x-auto">
        <table className="app-table">
          <thead className="bg-[rgba(12,27,38,0.82)]">
            <tr>
              {COLUMNAS.map((c) => (
                <th key={c} className="px-4 py-3">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FILAS.map((i) => (
              <tr key={i}>
                {/* Pedido: el número en monoespaciada y, debajo, el de Dropi
                    cuando el cruce existe — no siempre existe. */}
                <td className="px-4 py-3">
                  <div className="app-skeleton h-3.5 w-16" />
                  {i % 3 !== 2 && <div className="app-skeleton mt-2.5 h-3.5 w-12" />}
                </td>
                {/* Cliente: el nombre (enlace al chat) y el teléfono debajo. */}
                <td className="px-4 py-3">
                  <div
                    className={`app-skeleton h-3.5 ${i % 3 === 0 ? "w-36" : i % 3 === 1 ? "w-28" : "w-32"}`}
                  />
                  <div className="app-skeleton mt-2.5 h-3.5 w-24" />
                </td>
                <td className="px-4 py-3">
                  <div className="app-skeleton h-3.5 w-24" />
                </td>
                {/* Las dos pastillas de estado: `rounded` y no `rounded-md`,
                    que es el radio que usan las de verdad. */}
                <td className="px-4 py-3">
                  <div className="app-skeleton h-5 w-20 rounded" />
                </td>
                <td className="px-4 py-3">
                  <div className="app-skeleton h-5 w-24 rounded" />
                </td>
                {/* Situación logística: dos renglones de texto, no pastilla. */}
                <td className="px-4 py-3">
                  <div className="app-skeleton h-3.5 w-28" />
                  <div className="app-skeleton mt-2.5 h-3.5 w-20" />
                </td>
                <td className="px-4 py-3">
                  <div className="app-skeleton h-3.5 w-24" />
                  <div className="app-skeleton mt-2.5 h-3.5 w-16" />
                </td>
                <td className="px-4 py-3">
                  <div className="app-skeleton h-3.5 w-12" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
