/**
 * El hilo por páginas: cómo se juntan lo que ya está cargado y lo que llega.
 *
 * El servidor sirve el hilo desde el final, de a 50 (`listMessages`). Hay dos
 * cosas que llegan y no son lo mismo:
 *
 * - **La ventana reciente**, que se vuelve a pedir con cada `message.created`.
 *   Reemplazar el hilo entero con ella, como se hacía cuando el hilo cabía en
 *   una sola respuesta, **borraría todo lo que el asesor cargó subiendo**: cada
 *   mensaje nuevo lo devolvería a los últimos 50.
 * - **Una página anterior**, que se antepone.
 *
 * Están fuera del componente porque son lo que se puede romper sin que se note:
 * el hilo se sigue viendo, solo que más corto.
 */

/** Lo mínimo de un mensaje que hace falta para juntarlos. */
type ConFecha = { id: string; createdAt: string };

export type HiloCargado<M extends ConFecha> = {
  msgs: M[];
  /** Si queda algo más viejo que el primero de `msgs`. */
  hasMore: boolean;
};

/**
 * Juntar la ventana reciente con lo que ya estaba cargado.
 *
 * Lo cargado que es **anterior al primero de la ventana** se conserva tal cual;
 * lo que cae dentro de la ventana lo manda el servidor, que es el que tiene el
 * estado nuevo (un acuse, un motivo de fallo). Si la ventana dice que no hay
 * nada antes, es el hilo entero y no hay nada que conservar.
 *
 * El corte va por milisegundo con `<=`, no `<`: un mensaje cargado del mismo
 * milisegundo que el primero de la ventana y que no está en ella es, por
 * fuerza, anterior — la ventana trae todo lo más nuevo.
 */
export function mezclarVentana<M extends ConFecha>(
  previo: HiloCargado<M>,
  ventana: HiloCargado<M>,
): HiloCargado<M> {
  const primero = ventana.msgs[0];
  if (!ventana.hasMore || !primero) return ventana;
  const enLaVentana = new Set(ventana.msgs.map((m) => m.id));
  const desde = Date.parse(primero.createdAt);
  const anteriores = previo.msgs.filter(
    (m) => !enLaVentana.has(m.id) && Date.parse(m.createdAt) <= desde,
  );
  if (anteriores.length === 0) return ventana;
  // Lo que había arriba sigue ahí, y con ello si queda algo más arriba todavía.
  return { msgs: [...anteriores, ...ventana.msgs], hasMore: previo.hasMore };
}

/** Anteponer una página anterior, sin repetir lo que ya estaba. */
export function anteponerPagina<M extends ConFecha>(
  previo: HiloCargado<M>,
  pagina: HiloCargado<M>,
): HiloCargado<M> {
  const ya = new Set(previo.msgs.map((m) => m.id));
  return {
    msgs: [...pagina.msgs.filter((m) => !ya.has(m.id)), ...previo.msgs],
    hasMore: pagina.hasMore,
  };
}
