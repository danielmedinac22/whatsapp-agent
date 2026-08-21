/**
 * La silueta del Inbox mientras el servidor lo arma.
 *
 * Un render de esta pantalla tarda **2,0 s en caliente y 2,9 s en frío** contra
 * producción, y es `force-dynamic`: no hay nada cacheado que enseñar mientras
 * tanto. Sin esto, el clic en «Inbox» no cambia un solo píxel durante dos
 * segundos y el asesor vuelve a hacer clic, que es el bug que este archivo
 * cierra. Otros tickets van a bajar esos 2 s, pero no a cero.
 *
 * **La silueta es la de la pantalla que viene, no un spinner.** Las medidas de
 * cada caja están copiadas de `inbox-client.tsx` a propósito —la rejilla de
 * `336px`, el corte en `lg`, el `calc(100vh-46px)` del marco— para que al llegar
 * el contenido nada salte de sitio. Cuando un número no se puede saber de
 * antemano, se elige el caso que más se da; están anotados abajo.
 *
 * **Y son dos siluetas, no una**, como la pantalla es dos plantas: en el
 * teléfono la lista es todo lo que hay y corre en el flujo del documento; de
 * `lg` para arriba aparece la columna del hilo al lado.
 */

/** Anchos del nombre y de la vista previa de cada fila. Desparejos a propósito:
 *  una columna de barras idénticas se lee como una tabla vacía, no como nombres
 *  y mensajes todavía sin llegar.
 *
 *  **Son diez y ya no siete.** La fila del teléfono perdió el renglón de
 *  etiquetas en el caso corriente —solo se dibujan los estados que piden hacer
 *  algo, y la mayoría de las filas no piden ninguno—, así que en una pantalla
 *  entran muchas más. Las que sobran en escritorio las recorta el
 *  `lg:overflow-hidden` de la columna. */
const FILAS = [
  ["w-32", "w-44"],
  ["w-24", "w-36"],
  ["w-36", "w-28"],
  ["w-28", "w-40"],
  ["w-40", "w-32"],
  ["w-24", "w-44"],
  ["w-32", "w-24"],
  ["w-36", "w-40"],
  ["w-28", "w-32"],
  ["w-40", "w-28"],
] as const;

/** El ancho de cada botón de la barra de filtros —«Todas», «Sin responder»,
 *  «Por confirmar»…—, del largo que mide cada nombre más su número. Tres es lo
 *  que trae la bandeja de ventas; la de confirmación trae cinco, y los dos que
 *  falten se apagan solos al llegar el contenido. */
const FILTROS = ["w-20", "w-32", "w-28", "w-28", "w-32"] as const;

export default function InboxLoading() {
  return (
    <div className="app-page flex flex-col gap-3 lg:h-[calc(100vh-46px)] lg:min-h-0">
      {/* Lo único que se anuncia. Las barras son cajas vacías: un lector de
          pantalla no tiene nada que leer en ellas, y este renglón le dice lo
          que el latido le dice a quien mira. */}
      <p role="status" className="sr-only">
        Cargando el Inbox…
      </p>

      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          {/* La línea de contexto, que va sobre el título. Tampoco se escribe:
              el nombre de la operación sale de una cookie que este archivo no
              lee, y la pantalla es una de dos. */}
          <div className="app-skeleton h-3 w-56" />
          {/* El título no se dibuja de verdad porque esta ruta sirve dos
              pantallas: «Inbox» y «Conversaciones» según `?b=ventas`, y un
              `loading.tsx` no recibe la URL. Escribir uno de los dos sería
              acertar la mitad de las veces y mentir la otra mitad. Alto de
              `.app-title`, que ahora son 34 px. */}
          <div className="app-skeleton mt-2 h-9 w-52" />
          <div className="app-skeleton mt-2 h-4 w-52" />
        </div>
        {/* La barra de filtros, que reemplazó al bloque de cinco tarjetas.
            Envuelve, no desliza, y cada botón es una píldora de 30 px de alto. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTROS.map((ancho, i) => (
            <div
              key={i}
              className={`app-skeleton h-[30px] rounded-full ${ancho}`}
            />
          ))}
        </div>
      </header>

      <div className="grid min-h-0 gap-3 lg:flex-1 lg:grid-cols-[336px_1fr]">
        {/* Sin `.app-card`, como la lista de verdad: **lo que la separa del
            hilo es la superficie**, y el hilo es el que va sobre blanco. */}
        <aside className="flex min-w-0 flex-col rounded-lg lg:h-auto lg:min-h-[520px] lg:overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-[var(--color-border)] px-3 py-2.5">
            <div className="app-skeleton h-9 w-full lg:h-8" />
          </div>
          {/* Un encabezado de sección arriba del todo: la lista de verdad se
              parte en «Esperando respuesta» y «El resto» siempre que las dos
              tengan filas, que es el caso corriente en esta bandeja. Ya sin
              número: la cuenta la lleva la barra de filtros. */}
          <div className="px-3 pb-1.5 pt-3">
            <div className="app-skeleton h-4 w-40" />
          </div>
          <ul className="px-2 lg:flex-1 lg:overflow-hidden">
            {FILAS.map(([nombre, preview], i) => (
              <li key={i} className="mb-0.5 rounded-lg px-3 py-2">
                {/* Renglón 1: el nombre, y el tiempo a la derecha. */}
                <div className="flex items-center justify-between gap-2">
                  <div className={`app-skeleton h-4 ${nombre}`} />
                  <div className="app-skeleton h-3 w-8" />
                </div>
                {/* Renglón 2: la vista previa. */}
                <div className={`app-skeleton mt-1.5 h-3 ${preview}`} />
                {/* Renglón 3: las etiquetas. **Solo de `lg` para arriba**, que
                    es donde la fila las lleva casi siempre —ahí se dibuja
                    también el detalle del pedido—. En el teléfono la mayoría de
                    las filas no lleva ninguna, así que dibujarla dejaría un
                    salto en cada fila al llegar el contenido. */}
                <div className={`app-skeleton mt-2 hidden h-3.5 w-24 lg:block`} />
              </li>
            ))}
          </ul>
        </aside>

        {/* **El hilo no se dibuja en el teléfono**, porque ahí no está: es otra
            pantalla, y a esta se entra por la lista. De `lg` para arriba llega
            **con una conversación abierta**, entres como entres: la lista
            selecciona sola la primera fila cuando la URL no nombra ninguna. */}
        <section className="hidden min-w-0 flex-col lg:flex">
          <div className="app-card flex h-full min-h-0 flex-col overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-3 py-3 lg:px-4">
              <div>
                <div className="app-skeleton h-4 w-40" />
                <div className="app-skeleton mt-2 h-3 w-28" />
              </div>
              {/* Dos botones y no tres: el de «Trabajarla yo» solo aparece con
                  vendedor configurado, y estos dos están siempre. */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="app-skeleton h-9 w-36 lg:h-8" />
                <div className="app-skeleton h-9 w-32 lg:h-8" />
              </div>
            </header>

            {/* La tira de datos del pedido: mensajes, modo de respuesta, estado
                de la guía. */}
            <div className="border-b border-[var(--color-border)] px-4 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="app-skeleton h-7 w-28" />
                <div className="app-skeleton h-7 w-36" />
                <div className="app-skeleton h-7 w-28" />
                <div className="app-skeleton h-7 w-44" />
              </div>
            </div>

            {/* El hilo va vacío a propósito, y no es pereza: los mensajes no
                vienen en este render — el panel los pide por su cuenta después
                de montarse. Dibujar globos acá sería prometer algo que esta
                navegación no trae; lo que trae es el marco vacío, y eso es lo
                que se dibuja. */}
            <div className="flex-1 bg-[var(--color-surface)]" />

            <footer className="border-t border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <div className="flex items-start gap-2">
                <div className="app-skeleton h-9 min-w-[180px] flex-1" />
                <div className="app-skeleton h-9 w-9" />
                <div className="app-skeleton h-9 w-28" />
              </div>
            </footer>
          </div>
        </section>
      </div>
    </div>
  );
}
