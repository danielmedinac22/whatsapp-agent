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

/** Anchos de las dos primeras líneas de cada fila. Desparejos a propósito: una
 *  columna de barras idénticas se lee como una tabla vacía, no como nombres y
 *  mensajes todavía sin llegar. Ocho filas llenan la lista más alta; las que
 *  sobran las recorta el `overflow-hidden` de la tarjeta. */
const FILAS = [
  ["w-32", "w-44"],
  ["w-24", "w-36"],
  ["w-36", "w-28"],
  ["w-28", "w-40"],
  ["w-40", "w-32"],
  ["w-24", "w-44"],
  ["w-32", "w-24"],
  ["w-36", "w-36"],
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
          {/* El título no se dibuja de verdad porque esta ruta sirve dos
              pantallas: «Inbox» y «Conversaciones» según `?b=ventas`, y un
              `loading.tsx` no recibe la URL. Escribir uno de los dos sería
              acertar la mitad de las veces y mentir la otra mitad. */}
          <div className="app-skeleton h-7 w-40 md:h-8" />
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
        <aside className="app-card flex h-[55vh] min-h-[320px] min-w-0 flex-col overflow-hidden xl:h-auto xl:min-h-[520px]">
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
          <ul className="flex-1 overflow-hidden p-2">
            {FILAS.map(([nombre, preview], i) => (
              <li
                key={i}
                className="mb-2 rounded-lg border border-[var(--color-border)] bg-[rgba(12,26,36,0.55)] px-3 py-2.5 shadow-[0_2px_8px_rgba(3,10,16,0.3)]"
              >
                <div className={`app-skeleton h-4 ${nombre}`} />
                <div className={`app-skeleton mt-2 h-3 ${preview}`} />
                {/* La tira de abajo: «manual», la pastilla de confirmación y
                    la hora. Las filas de verdad a veces suman una segunda
                    tira de pastillas y crecen; se dibuja la de una sola, que
                    es el piso — un esqueleto más alto que la fila deja un
                    salto al revés, más feo que el corto. */}
                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <div className="app-skeleton h-4 w-12" />
                    <div className="app-skeleton h-5 w-24 rounded" />
                  </div>
                  <div className="app-skeleton h-3 w-9" />
                </div>
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
            <div className="flex-1 bg-[linear-gradient(180deg,rgba(9,19,28,0.3),rgba(5,12,18,0.18))]" />

            <footer className="border-t border-[var(--color-border)] bg-[rgba(10,24,34,0.84)] p-3">
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
