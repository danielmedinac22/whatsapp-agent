import { getAgentSettings, listTemplates } from "@/lib/queries";
import { AgentForm } from "./agent-form";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const [settings, templates] = await Promise.all([
    getAgentSettings(),
    listTemplates(),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-xl font-semibold">Agente</h1>
        <p className="text-sm text-[var(--color-text-dim)]">
          Comportamiento del agente conversacional cuando un contacto está en
          modo agente o tras un follow-up de Shopify.
        </p>
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
