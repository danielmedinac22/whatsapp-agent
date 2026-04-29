import { getAgentSettings, listTemplates } from "@/lib/queries";
import { AgentForm } from "./agent-form";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const [settings, templates] = await Promise.all([
    getAgentSettings(),
    listTemplates(),
  ]);

  return (
    <div className="app-page max-w-5xl space-y-3">
      <header className="max-w-3xl">
        <h1 className="app-title">Agente</h1>
        <p className="app-subtitle app-muted mt-1">Modelo, prompt y automatizaciones</p>
      </header>
      <AgentForm
        initial={
          settings ?? {
            systemPrompt: "",
            model: "anthropic/claude-sonnet-4.6",
            debounceMs: 8000,
            followupDelayMs: 5 * 60 * 1000,
            followupTemplateId: null,
            remarketingDelayMs: 3 * 60 * 60 * 1000,
            remarketingTemplateId: null,
            confirmationAckTemplateId: null,
            activateAgentOnConfirm: true,
          }
        }
        templates={templates.map((t) => ({ id: t.id, name: t.name }))}
      />
    </div>
  );
}
