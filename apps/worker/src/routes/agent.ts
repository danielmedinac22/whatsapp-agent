import { Hono } from "hono";
import { z } from "zod";
import { agentSettingsInput } from "@wa/shared";
import { db, agentSettings, eq } from "../db";

export const agent = new Hono();

agent.get("/settings", async (c) => {
  const [row] = await db
    .select()
    .from(agentSettings)
    .where(eq(agentSettings.id, 1))
    .limit(1);
  return c.json(row ?? null);
});

agent.put("/settings", async (c) => {
  const parsed = agentSettingsInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const v = parsed.data;
  await db
    .insert(agentSettings)
    .values({
      id: 1,
      systemPrompt: v.systemPrompt,
      model: v.model,
      debounceMs: v.debounceMs,
      followupDelayMs: v.followupDelayMs,
      followupTemplateId: v.followupTemplateId,
      remarketingDelayMs: v.remarketingDelayMs,
      remarketingTemplateId: v.remarketingTemplateId,
      activateAgentOnConfirm: v.activateAgentOnConfirm,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: agentSettings.id,
      set: {
        systemPrompt: v.systemPrompt,
        model: v.model,
        debounceMs: v.debounceMs,
        followupDelayMs: v.followupDelayMs,
        followupTemplateId: v.followupTemplateId,
        remarketingDelayMs: v.remarketingDelayMs,
        remarketingTemplateId: v.remarketingTemplateId,
        activateAgentOnConfirm: v.activateAgentOnConfirm,
        updatedAt: new Date(),
      },
    });
  return c.json({ ok: true });
});

void z;
