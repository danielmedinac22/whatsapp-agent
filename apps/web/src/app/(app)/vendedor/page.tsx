import { parseSalesDiscountBehavior, SALES_AGENT_DEFAULTS } from "@wa/shared";
import { loadVendedorScreen } from "@/lib/vendedor";
import { ContextLine } from "../context-line";
import { VendedorForm } from "./vendedor-form";

export const dynamic = "force-dynamic";

/**
 * La configuración del vendedor de la operación del panel.
 *
 * **La fila puede no existir**, y hoy no existe: `sales_agent_settings` está
 * vacía en producción. La pantalla no trata eso como un error ni como un estado
 * aparte — muestra lo que la base usaría (`SALES_AGENT_DEFAULTS`, espejo de los
 * `default` de las columnas) y el primer guardado crea la fila.
 *
 * **La configuración de Katherine no se alcanza desde acá**: esta página no lee
 * ni escribe `agent_settings`, y no hay ningún enlace hacia `/agent`. Son dos
 * tablas hermanas y dos pantallas hermanas.
 */
export default async function VendedorPage() {
  const { operation, settings, phone } = await loadVendedorScreen();

  return (
    <div className="app-page max-w-5xl space-y-3">
      <header className="max-w-3xl">
        <ContextLine op={operation} pantalla="Ventas" />
        <h1 className="app-title">Vendedor</h1>
        <p className="app-subtitle app-muted mt-1">
          Quién es y cómo se comporta en {operation.name}. Lo que guardes aplica
          en la próxima conversación, sin desplegar.
        </p>
      </header>
      <VendedorForm
        phone={phone}
        initial={{
          displayName: settings?.displayName ?? SALES_AGENT_DEFAULTS.displayName,
          greeting: settings?.greeting ?? SALES_AGENT_DEFAULTS.greeting,
          closingPush: settings?.closingPush ?? SALES_AGENT_DEFAULTS.closingPush,
          funnelMessage:
            settings?.funnelMessage ?? SALES_AGENT_DEFAULTS.funnelMessage,
          toneInstructions:
            settings?.toneInstructions ?? SALES_AGENT_DEFAULTS.toneInstructions,
          discountLimitPct:
            settings?.discountLimitPct ?? SALES_AGENT_DEFAULTS.discountLimitPct,
          // La columna es `text` con un `check`: el conjunto cerrado se arma
          // en un solo lugar, y sin fila se usa el default de la columna.
          discountLimitBehavior: parseSalesDiscountBehavior(
            settings?.discountLimitBehavior,
          ),
          model: settings?.model ?? SALES_AGENT_DEFAULTS.model,
          reasoningEffort:
            settings?.reasoningEffort ?? SALES_AGENT_DEFAULTS.reasoningEffort,
        }}
      />
    </div>
  );
}
