import { Hono } from "hono";
import { z } from "zod";
import {
  agentPreviewInput,
  agentPromptInput,
  agentSettingsInput,
} from "@wa/shared";
import { db, agentSettings, eq, getAgentSettings } from "../db";
import { panelOperation, type HeaderCarrier } from "../operations";
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
 * El panel edita la configuración de **una** operación: la que el admin eligió
 * en el riel, que llega en el header `x-operation-id`.
 *
 * El lote 05 dejó estas cuatro lecturas/escrituras en ámbito global explícito
 * (`GLOBAL_AGENT_SETTINGS`, la fila `id = 1`). El contract lo borró: `id = 1`
 * es Guatemala, y un panel que escribe siempre en Guatemala pasaría a editar el
 * país equivocado en cuanto exista el segundo. Hasta el ticket 07 lo cubría el
 * puente `panelOperation()`, que no adivinaba —con dos activas fallaba— y por
 * eso obligaba a que el selector llegara antes que Colombia. Ya llegó.
 */
function loadSettings(c: HeaderCarrier) {
  return panelOperation(c).then(getAgentSettings);
}

/**
 * `id` es el entero con `default 1` heredado del singleton: la configuración de
 * una segunda operación necesita el suyo o choca contra la clave primaria.
 */
async function nextAgentSettingsId(): Promise<number> {
  const rows = await db.select({ id: agentSettings.id }).from(agentSettings);
  return rows.reduce((max, r) => Math.max(max, r.id), 0) + 1;
}

agent.get("/settings", async (c) => {
  return c.json(await loadSettings(c));
});

agent.put("/settings", async (c) => {
  const parsed = agentSettingsInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const v = parsed.data;
  const op = await panelOperation(c);
  const previous = await getAgentSettings(op);
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
  if (previous) {
    await db
      .update(agentSettings)
      .set(fields)
      .where(eq(agentSettings.id, previous.id));
  } else {
    await db.insert(agentSettings).values({
      id: await nextAgentSettingsId(),
      operationId: op.id,
      ...fields,
    });
  }

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

  const previous = await loadSettings(c);
  if (!previous) {
    return c.json({ error: "agent_settings sin configurar" }, 409);
  }

  await db
    .update(agentSettings)
    .set({ systemPrompt: prompt, updatedAt: new Date() })
    .where(eq(agentSettings.id, previous.id));

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

  const previous = await loadSettings(c);
  if (!previous) {
    return c.json({ error: "agent_settings sin configurar" }, 409);
  }
  await db
    .update(agentSettings)
    .set({ systemPrompt: row.prompt, updatedAt: new Date() })
    .where(eq(agentSettings.id, previous.id));

  if (previous.systemPrompt !== row.prompt) {
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
