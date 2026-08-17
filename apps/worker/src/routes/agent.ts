import { Hono } from "hono";
import { z } from "zod";
import {
  agentPreviewInput,
  agentPromptInput,
  agentSettingsInput,
} from "@wa/shared";
import {
  db,
  agentSettings,
  eq,
  getAgentSettings,
  GLOBAL_AGENT_SETTINGS,
  GLOBAL_AGENT_SETTINGS_ID,
} from "../db";
import { logger } from "../lib/logger";
import { previewAgentReply } from "../agent/preview";
import {
  getPromptVersion,
  listPromptVersions,
  recordPromptVersion,
} from "../agent/prompt-versions";

export const agent = new Hono();

/** Email del usuario del dashboard que originó la request (lo pasa el proxy web). */
function actorEmail(c: { req: { header: (n: string) => string | undefined } }) {
  const raw = c.req.header("x-actor-email");
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : null;
}

/**
 * El panel todavía edita la configuración global: no tiene selector de
 * operación —eso es otro ticket— así que aquí el ámbito se declara explícito
 * en vez de quedar implícito en un `id = 1` suelto. Las escrituras de abajo
 * apuntan a la misma fila por `GLOBAL_AGENT_SETTINGS_ID`, que es lo que el
 * contract (ticket 06) sale a buscar.
 */
function loadSettings() {
  return getAgentSettings(GLOBAL_AGENT_SETTINGS);
}

agent.get("/settings", async (c) => {
  return c.json(await loadSettings());
});

agent.put("/settings", async (c) => {
  const parsed = agentSettingsInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const v = parsed.data;
  const previous = await loadSettings();
  const fields = {
    systemPrompt: v.systemPrompt,
    model: v.model,
    debounceMs: v.debounceMs,
    followupDelayMs: v.followupDelayMs,
    followupTemplateId: v.followupTemplateId,
    remarketingDelayMs: v.remarketingDelayMs,
    remarketingTemplateId: v.remarketingTemplateId,
    confirmationAckTemplateId: v.confirmationAckTemplateId,
    activateAgentOnConfirm: v.activateAgentOnConfirm,
    dropiEnabled: v.dropiEnabled,
    dropiDryRun: v.dropiDryRun,
    dropiPollIntervalMin: v.dropiPollIntervalMin,
    dropiSyncIntervalMin: v.dropiSyncIntervalMin,
    dropiMatchWindowDays: v.dropiMatchWindowDays,
    dropiTemplateGuiaId: v.dropiTemplateGuiaId,
    dropiTemplateRecolectadoId: v.dropiTemplateRecolectadoId,
    dropiTemplateEnTransitoId: v.dropiTemplateEnTransitoId,
    dropiTemplateConMensajeroId: v.dropiTemplateConMensajeroId,
    dropiTemplateEntregadoId: v.dropiTemplateEntregadoId,
    dropiTemplateEnOficinaId: v.dropiTemplateEnOficinaId,
    updatedAt: new Date(),
  };
  await db
    .insert(agentSettings)
    .values({ id: GLOBAL_AGENT_SETTINGS_ID, ...fields })
    .onConflictDoUpdate({ target: agentSettings.id, set: fields });

  // El prompt cambió desde la pantalla de configuración: queda en el historial.
  if (previous?.systemPrompt !== v.systemPrompt) {
    await recordPromptVersion({
      prompt: v.systemPrompt,
      authorEmail: actorEmail(c),
    }).catch((err) => logger.warn({ err }, "prompt version record failed"));
  }

  return c.json({ ok: true });
});

// ────────────────────────────────────────────────────────────────────────────
// system prompt: guardar con nota, historial y restauración
// ────────────────────────────────────────────────────────────────────────────

agent.put("/prompt", async (c) => {
  const parsed = agentPromptInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const { prompt, label } = parsed.data;

  const previous = await loadSettings();
  if (!previous) {
    return c.json({ error: "agent_settings sin configurar" }, 409);
  }

  await db
    .update(agentSettings)
    .set({ systemPrompt: prompt, updatedAt: new Date() })
    .where(eq(agentSettings.id, GLOBAL_AGENT_SETTINGS_ID));

  if (previous.systemPrompt !== prompt) {
    await recordPromptVersion({
      prompt,
      label,
      authorEmail: actorEmail(c),
    }).catch((err) => logger.warn({ err }, "prompt version record failed"));
  }

  return c.json({ ok: true });
});

agent.get("/prompt/versions", async (c) => {
  return c.json(await listPromptVersions());
});

agent.get("/prompt/versions/:id", async (c) => {
  const row = await getPromptVersion(c.req.param("id"));
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

agent.post("/prompt/versions/:id/restore", async (c) => {
  const row = await getPromptVersion(c.req.param("id"));
  if (!row) return c.json({ error: "not found" }, 404);

  const previous = await loadSettings();
  await db
    .update(agentSettings)
    .set({ systemPrompt: row.prompt, updatedAt: new Date() })
    .where(eq(agentSettings.id, GLOBAL_AGENT_SETTINGS_ID));

  if (previous?.systemPrompt !== row.prompt) {
    const when = row.createdAt.toLocaleString("es-CO", {
      dateStyle: "short",
      timeStyle: "short",
    });
    await recordPromptVersion({
      prompt: row.prompt,
      label: `Restaurado de la versión del ${when}`,
      authorEmail: actorEmail(c),
    }).catch((err) => logger.warn({ err }, "prompt version record failed"));
  }

  return c.json({ ok: true, prompt: row.prompt });
});

// ────────────────────────────────────────────────────────────────────────────
// banco de pruebas: corre el prompt borrador sin enviar nada al cliente
// ────────────────────────────────────────────────────────────────────────────

agent.post("/prompt/preview", async (c) => {
  const parsed = agentPreviewInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);

  try {
    const result = await previewAgentReply(parsed.data);
    return c.json(result);
  } catch (err) {
    logger.error({ err }, "agent prompt preview failed");
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      502,
    );
  }
});

void z;
