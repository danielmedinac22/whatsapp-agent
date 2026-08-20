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
 * `336px`, el alto de la lista, el `calc(100vh-46px)` del marco— para que al
 * llegar el contenido nada salte de sitio. Cuando un número no se puede saber
 * de antemano, se elige el caso que más se da; están anotados abajo.
 */

/** Anchos del nombre, de la vista previa y de la tira de etiquetas de cada
 *  fila. Desparejos a propósito: una columna de barras idénticas se lee como
 *  una tabla vacía, no como nombres y mensajes todavía sin llegar. **La tercera
 *  barra es nueva y es la de los estados**, que es lo que ahora hace a la fila
 *  de tres renglones; sin ella la silueta sería más baja que la pantalla que
 *  viene y todo saltaría al llegar. Siete filas llenan la lista más alta; las
 *  que sobran las recorta el `overflow-hidden` de la columna. */
const FILAS = [
  ["w-32", "w-44", "w-24"],
  ["w-24", "w-36", "w-32"],
  ["w-36", "w-28", "w-20"],
  ["w-28", "w-40", "w-28"],
  ["w-40", "w-32", "w-20"],
  ["w-24", "w-44", "w-32"],
  ["w-32", "w-24", "w-24"],
] as const;

/** El rótulo de cada tarjeta del encabezado —«Conversaciones», «Sin leer»,
 *  «Modo agente», «Por confirmar», «Sin responder»—, del largo que mide cada
 *  palabra. El número que va debajo es siempre corto. */
const TARJETAS = ["w-24", "w-16", "w-20", "w-20", "w-24"] as const;

export default function InboxLoading() {
  return (
    <div className="app-page flex min-h-[calc(100vh-46px)] flex-col gap-3 xl:h-[calc(100vh-46px)] xl:min-h-0">
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
        {/* Cinco tarjetas: las de la bandeja de siempre, que es a la que se
            entra desde el menú. La de ventas trae cuatro; la quinta se apaga
            sola cuando llega el contenido. */}
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          {TARJETAS.map((ancho, i) => (
            <div key={i} className="app-card min-w-[132px] px-3 py-2">
              <div className={`app-skeleton h-3 ${ancho}`} />
              <div className="app-skeleton mt-2 h-5 w-8" />
            </div>
          ))}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[336px_1fr]">
        {/* Sin `.app-card`, como la lista de verdad: **lo que la separa del
            hilo es la superficie**, y el hilo es el que va sobre blanco. */}
        <aside className="flex h-[55vh] min-h-[320px] min-w-0 flex-col overflow-hidden rounded-lg xl:h-auto xl:min-h-[520px]">
          <div className="flex flex-col gap-2 border-b border-[var(--color-border)] px-3 py-2.5">
            <div className="app-skeleton h-9 w-full lg:h-8" />
            <div className="flex items-center justify-between gap-2">
              <div className="app-skeleton h-4 w-28" />
              <div className="flex items-center gap-2">
                <div className="app-skeleton h-9 w-28 lg:h-7" />
                <div className="app-skeleton h-6 w-12" />
              </div>
            </div>
          </div>
          {/* Un encabezado de sección arriba del todo: la lista de verdad se
              parte en «Esperando respuesta» y «El resto» siempre que las dos
              tengan filas, que es el caso corriente en esta bandeja. */}
          <div className="px-3 pb-1.5 pt-3">
            <div className="app-skeleton h-4 w-40" />
          </div>
          <ul className="flex-1 overflow-hidden px-2">
            {FILAS.map(([nombre, preview, estados], i) => (
              <li key={i} className="mb-0.5 rounded-lg px-3 py-2">
                {/* Renglón 1: el nombre, y el tiempo a la derecha. */}
                <div className="flex items-center justify-between gap-2">
                  <div className={`app-skeleton h-4 ${nombre}`} />
                  <div className="app-skeleton h-3 w-8" />
                </div>
                {/* Renglón 2: la vista previa. */}
                <div className={`app-skeleton mt-1.5 h-3 ${preview}`} />
                {/* Renglón 3: las etiquetas de estado. Se dibuja una, que es el
                    piso: las filas de verdad a veces llevan dos y crecen, y un
                    esqueleto más alto que la fila deja un salto al revés, más
                    feo que el corto. */}
                <div className={`app-skeleton mt-2 h-3.5 ${estados}`} />
              </li>
            ))}
          </ul>
        </aside>

        {/* El panel derecho llega **con una conversación abierta**, entres
            como entres: la lista selecciona sola la primera fila cuando la URL
            no nombra ninguna. Comprobado en pantalla, no leído del código —
            era justo lo que este archivo había supuesto al revés. */}
        <section className="flex h-[80vh] min-h-[420px] min-w-0 flex-col xl:h-auto xl:min-h-0">
          <div className="app-card flex h-full min-h-0 flex-col overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
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
