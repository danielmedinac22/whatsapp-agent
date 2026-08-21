/**
 * La bandera de un país, por degradado y no por emoji: un emoji de bandera se
 * dibuja distinto en cada sistema y en Windows no se dibuja.
 *
 * Vive en su propio archivo porque la usan tres sitios con dueños distintos: la
 * columna y la tira plegada (`operation-bar.tsx`, servidor), el selector de
 * operación (`operation-picker.tsx`, cliente) y la barra del teléfono, que la
 * arma el layout para pasársela hecha a `<MobileFrame>`. Un archivo sin
 * directiva y sin importaciones de servidor entra en los dos grafos sin
 * arrastrar nada detrás.
 */

/** Los degradados de las banderas que sabemos dibujar. */
const FLAGS: Readonly<Record<string, string>> = {
  GT: "linear-gradient(90deg,#4997d0 0 33.3%,#fff 33.3% 66.6%,#4997d0 66.6%)",
  CO: "linear-gradient(180deg,#fcd116 0 50%,#003893 50% 75%,#ce1126 75%)",
};

export function Flag({
  code,
  className,
}: {
  code: string;
  className: string;
}) {
  const gradient = FLAGS[code.toUpperCase()];
  return (
    <span
      aria-hidden
      className={`op-flag ${className}`}
      // Un país sin bandera dibujada no se queda en blanco: toma el tinte de su
      // propia operación, que ya es distinto del de cualquier otra.
      style={{ background: gradient ?? "var(--op)" }}
    />
  );
}
