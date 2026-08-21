/**
 * La línea de contexto de una pantalla: en qué operación y en qué módulo estás.
 *
 * Va **sobre** el `h1`, siempre, y es el nivel 1 de los tres encabezados que
 * decidió la ronda de diseño: `.app-context` sobre `.app-title` sobre
 * `.app-section`. El `h1` dice qué pantalla es; esta línea dice desde dónde se
 * la está mirando.
 *
 * **Vive en el contenido y no en el marco, y esa es toda la razón por la que
 * existe.** El riel se pliega (`.app-frame[data-bars="collapsed"]`) y ahí la
 * placa del país se pierde: en la pantalla desde la que salen mensajes a
 * Guatemala, el único indicio del país era una bandera de 8×30 px en una barra
 * que se puede cerrar. Lo que no se puede plegar es el título de la pantalla,
 * así que el país viaja pegado a él.
 *
 * **En el teléfono dice solo la bandeja** —`CONFIRMACIÓN`, sin bandera y sin
 * nombre de operación—, que es el veredicto del nivel 4. Ahí el país no se
 * perdió: lo lleva la barra de 52px, a dos centímetros de este mismo texto, y a
 * 390px las dos cosas quedan pegadas diciendo lo mismo. En escritorio no cambia
 * nada, porque allá el riel está a 78px del título y la repetición no molesta.
 *
 * **`pantalla` es el módulo del menú, no el nombre de la pantalla** — «Ventas»,
 * «Confirmación», «Operación», los `label` de `NAV_GROUPS`. Repetir el `h1` dos
 * renglones más arriba no diría nada nuevo; el módulo sí, porque es lo que
 * distingue el trabajo de Katherine del de Sebastián sin abrir el selector.
 * Llega como texto y no derivado de la ruta a propósito: es la firma que fija el
 * contrato de nombres del spec, y el Inbox —que la importa desde
 * `inbox-client.tsx`— no tiene una ruta que lo identifique, tiene dos.
 */

/**
 * Los degradados de las banderas que sabemos dibujar.
 *
 * **Es la misma tabla que la del riel** (`operation-rail.tsx`), duplicada a
 * sabiendas: allá es privada del módulo y ese archivo tiene otro dueño en esta
 * tanda. Unificarla es trabajo de una sola línea el día que las dos ramas estén
 * juntas, y hasta entonces duplicarla es más barato que coordinar un export.
 */
const FLAGS: Readonly<Record<string, string>> = {
  GT: "linear-gradient(90deg,#4997d0 0 33.3%,#fff 33.3% 66.6%,#4997d0 66.6%)",
  CO: "linear-gradient(180deg,#fcd116 0 50%,#003893 50% 75%,#ce1126 75%)",
};

/**
 * La bandera, por el mismo mecanismo del riel: un `span` con `.op-flag` y el
 * degradado de fondo. No es un emoji — un emoji de bandera se dibuja distinto en
 * cada sistema y en Windows no se dibuja.
 *
 * `filter: none` en línea porque `.op-flag` nace apagada: en el riel el apagado
 * distingue el país que **no** está activo, y acá el único país que se dibuja es
 * el activo. El sitio limpio para esto sería `.app-context .op-flag` en
 * `globals.css`, que es de otra rama en esta tanda.
 */
function Flag({ code }: { code: string }) {
  const gradient = FLAGS[code.toUpperCase()];
  return (
    <span
      aria-hidden
      className="op-flag h-[11px] w-4"
      // Un país sin bandera dibujada no se queda en blanco: toma el tinte de su
      // propia operación, igual que en el riel.
      style={{ background: gradient ?? "var(--op)", filter: "none" }}
    />
  );
}

/**
 * `op` se tipa estructuralmente —`{ name, countryCode }` y no `Operation`— para
 * que la firma sea la del contrato: quien la llama ya tiene la fila entera, pero
 * el componente solo necesita esos dos campos y no debería obligar a construir
 * una `Operation` completa para dibujar una línea de texto.
 */
export function ContextLine({
  op,
  pantalla,
}: {
  op: { name: string; countryCode: string };
  pantalla: string;
}): React.ReactElement {
  return (
    <p className="app-context flex items-center gap-1.5">
      <Flag code={op.countryCode} />
      {/*
        Dos textos y no uno recortado, porque **el país y la bandeja viven en el
        mismo nodo de texto** y a un nodo de texto no se le puede dar estilo. Los
        esconde `globals.css` por ancho (`.app-context-full` y
        `.app-context-short`), así que en cada pantalla hay exactamente uno con
        caja: el lector de pantalla tampoco oye la bandeja dos veces.
      */}
      <span className="app-context-full min-w-0">
        {op.name} · {pantalla}
      </span>
      <span className="app-context-short min-w-0">{pantalla}</span>
    </p>
  );
}
