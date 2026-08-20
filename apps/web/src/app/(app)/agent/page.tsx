import { resolvePanelOperation } from "@/lib/operation";
import {
  getAgentSettings,
  listRecentConversationOptions,
  listTemplates,
} from "@/lib/queries";
import { ContextLine } from "../context-line";
import { AgentForm } from "./agent-form";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  // La pantalla de configuración edita la de **una** operación: la que el admin
  // eligió en el riel. Antes editaba la fila global `id = 1` — que es
  // Guatemala, y por tanto el país equivocado en cuanto exista el segundo.
  const op = await resolvePanelOperation();
  const [settings, templates, conversations] = await Promise.all([
    getAgentSettings(op),
    listTemplates(op),
    listRecentConversationOptions(op),
  ]);

  return (
    <div className="app-page max-w-5xl space-y-3">
      <header className="max-w-3xl">
        <ContextLine op={op} pantalla="Confirmación" />
        <h1 className="app-title">Agente</h1>
        <p className="app-subtitle app-muted mt-1">Modelo, prompt y automatizaciones</p>
      </header>
      <AgentForm
        initial={{
          systemPrompt: settings?.systemPrompt ?? "",
          model: settings?.model ?? "anthropic/claude-sonnet-4.6",
          debounceMs: settings?.debounceMs ?? 8000,
          followupDelayMs: settings?.followupDelayMs ?? 5 * 60 * 1000,
          followupTemplateId: settings?.followupTemplateId ?? null,
          remarketingDelayMs: settings?.remarketingDelayMs ?? 3 * 60 * 60 * 1000,
          remarketingTemplateId: settings?.remarketingTemplateId ?? null,
          confirmationAckTemplateId: settings?.confirmationAckTemplateId ?? null,
          activateAgentOnConfirm: settings?.activateAgentOnConfirm ?? true,
          dropiEnabled: settings?.dropiEnabled ?? false,
          dropiDryRun: settings?.dropiDryRun ?? true,
          dropiPollIntervalMin: settings?.dropiPollIntervalMin ?? 10,
          dropiSyncIntervalMin: settings?.dropiSyncIntervalMin ?? 15,
          dropiMatchWindowDays: settings?.dropiMatchWindowDays ?? 5,
          dropiTemplateGuiaId: settings?.dropiTemplateGuiaId ?? null,
          dropiTemplateRecolectadoId: settings?.dropiTemplateRecolectadoId ?? null,
          dropiTemplateEnOficinaId: settings?.dropiTemplateEnOficinaId ?? null,
          dropiTemplateEnTransitoId: settings?.dropiTemplateEnTransitoId ?? null,
          dropiTemplateConMensajeroId:
            settings?.dropiTemplateConMensajeroId ?? null,
          dropiTemplateEntregadoId: settings?.dropiTemplateEntregadoId ?? null,
        }}
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          type: t.type,
        }))}
        conversations={conversations}
      />
    </div>
  );
}
