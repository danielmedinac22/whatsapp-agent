import { resolvePanelOperation } from "@/lib/operation";
import { loadCapiEstado } from "@/lib/capi";
import { ReporteMetaClient } from "./reporte-client";

export const dynamic = "force-dynamic";

/**
 * El estado del reporte de conversiones a Meta, de **una** operación.
 *
 * Existe porque el reporte estaba construido y desplegado y solo se podía mirar
 * por `curl`: un ticket resuelto que el operador no puede usar no está
 * resuelto. Y acá pesa más que de costumbre, porque **este reporte puede estar
 * muerto y verse sano** — si la referencia del anuncio nunca llega, todo se ve
 * completo y no pasa nada, y nadie se entera hasta preguntarse por qué la pauta
 * no aprende.
 *
 * **Lleva el país en su propio encabezado.** El marco ubica y la pantalla
 * confirma: lo que se ve acá depende de la operación —su dataset, sus ventas,
 * su libro de conversiones— y una pantalla que muestra datos de un país sin
 * decir cuál es la que deja mirar el equivocado.
 *
 * **De sólo lectura, y eso es una decisión.** No hay ningún control que
 * encienda el reporte: el modo se cambia por entorno y con un despliegue
 * (`ventas-capi/03`), porque un evento duplicado o mal formado envenena el
 * aprendizaje de la pauta que Vorare paga y eso no se revierte borrando datos.
 */
export default async function ReporteMetaPage() {
  const [op, view] = await Promise.all([
    resolvePanelOperation(),
    loadCapiEstado(),
  ]);

  return (
    <div className="app-page max-w-4xl space-y-3">
      <header className="max-w-3xl">
        <p className="app-eyebrow">{op.name} · ventas</p>
        <h1 className="app-title">Reporte de conversiones</h1>
        <p className="app-subtitle app-muted mt-1">
          Si las ventas que vienen de un anuncio le están volviendo a Meta, y
          cuáles no. Es de lo que aprende la pauta para saber a quién mostrarle
          el anuncio.
        </p>
      </header>
      <ReporteMetaClient view={view} moneda={op.currency} />
    </div>
  );
}
