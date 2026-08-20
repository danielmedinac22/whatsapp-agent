/**
 * **Cómo dice la hora una fila de la bandeja.**
 *
 * Hasta hoy decía `14:32` para todo, y eso miente. La lista mezcla **a
 * propósito** las 200 más recientes por actividad con **todas** las que están
 * sin responder, que son mucho más viejas: medido contra producción el
 * 20-ago-2026, esas 200 cubren cinco días (del 15 al 20 de agosto) y en la base
 * hay 955 conversaciones con más de un mes sin actividad. Todo lo que aparece
 * en la lista por estar sin responder es más viejo que esos cinco días y se
 * pintaba con el mismo `14:32` que algo de hace diez minutos.
 *
 * El veredicto del nivel 3 lo dice en tres tramos: hora si es de hoy, día si es
 * de esta semana, fecha si es más viejo.
 *
 * **Es pura y recibe el «ahora» como parámetro**, y esa es toda la razón de que
 * sea un archivo aparte: los tres bordes que hay que probar —medianoche, ayer a
 * las 23:59 y el salto de semana— no se pueden escribir contra un reloj que
 * corre. Congelar el reloj del proceso probaría lo mismo pero dejaría la
 * función atada a un truco del arnés.
 */

/**
 * Los nombres van escritos y no salen de `toLocaleDateString`.
 *
 * El panel es de una operación de Guatemala y está en español de punta a punta;
 * lo que decide el `locale` del navegador es la máquina del asesor, no el
 * producto. Con `[]` como locale, la misma fila diría `Tue` en un portátil
 * recién sacado de la caja.
 */
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;
const MESES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
] as const;

/**
 * Cuántos días de calendario hay entre dos instantes, en la zona del que mira.
 *
 * Se cuentan **días de calendario y no de 24 horas**, que es lo que hace que a
 * las 00:01 un mensaje de las 23:59 diga «ayer» y no «hace dos minutos». Los
 * dos instantes se anclan a su medianoche local antes de restar, así que un
 * cambio de horario de verano no corre la cuenta medio día.
 */
function diasDeCalendario(desde: Date, hasta: Date): number {
  const a = Date.UTC(desde.getFullYear(), desde.getMonth(), desde.getDate());
  const b = Date.UTC(hasta.getFullYear(), hasta.getMonth(), hasta.getDate());
  return Math.round((b - a) / 86_400_000);
}

/** `14:32`, con el cero delante y en 24 horas. */
function laHora(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * `12 ago`, y con el año cuando no es el de este año.
 *
 * El año no está en el ejemplo del spec y se agrega por lo mismo que existe
 * esta función: `12 ago` a secas para algo del año pasado es exactamente la
 * mentira que el ticket vino a sacar, solo que un tamaño más grande.
 */
function laFecha(d: Date, ahora: Date): string {
  const dia = `${d.getDate()} ${MESES[d.getMonth()]}`;
  return d.getFullYear() === ahora.getFullYear()
    ? dia
    : `${dia} ${d.getFullYear()}`;
}

/**
 * Lo que la fila escribe a la derecha del nombre.
 *
 * - **hoy** → la hora: `14:32`
 * - **ayer** → `ayer`
 * - **de dos a seis días** → el día: `mar`
 * - **una semana o más** → la fecha: `12 ago`
 *
 * El corte de la semana está en siete días **y no en la semana del calendario**:
 * es la regla de WhatsApp, que es donde el asesor ya la aprendió, y es la única
 * que no puede quedar ambigua. A los siete días exactos el nombre del día sería
 * el mismo que el de hoy, así que a partir de ahí manda la fecha.
 *
 * Un instante en el futuro —el reloj del asesor atrasado frente al del
 * servidor— se dice como si fuera de hoy: es lo que es, y `en 3 días` en una
 * bandeja no significaría nada.
 */
export function tiempoRelativo(cuando: Date | string, ahora: Date): string {
  const d = typeof cuando === "string" ? new Date(cuando) : cuando;
  if (!Number.isFinite(d.getTime())) return "—";

  const dias = diasDeCalendario(d, ahora);
  if (dias <= 0) return laHora(d);
  if (dias === 1) return "ayer";
  if (dias < 7) return DIAS[d.getDay()]!;
  return laFecha(d, ahora);
}

/**
 * Lo mismo, dicho entero, para el `title` de la fila.
 *
 * La fila dice `mar` y con eso alcanza para recorrerla con la vista; el que se
 * detiene en una necesita el día exacto, y abrirla para averiguarlo sería
 * pagar un chat entero por una fecha.
 */
export function tiempoCompleto(cuando: Date | string): string {
  const d = typeof cuando === "string" ? new Date(cuando) : cuando;
  if (!Number.isFinite(d.getTime())) return "Sin actividad registrada";
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()} · ${laHora(d)}`;
}
