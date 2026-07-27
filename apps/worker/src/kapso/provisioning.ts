import { and, eq, inArray } from "@wa/db";
import { waTemplates } from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { KapsoApiError, createTemplate, listTemplatesByName } from "./client";
import { getKapsoConnection } from "./connection";
import { VORARE_TEMPLATES, toMetaDefinition } from "./templates";

/**
 * Meta templates are approved PER WABA, so the catalog is submitted against
 * whichever WABA the connected number belongs to. Idempotent: already
 * submitted/approved names are skipped; a template that already exists on the
 * WABA (Meta error) is recorded as submitted and picked up by the next poll.
 */
export async function ensureKapsoTemplates(): Promise<void> {
  const conn = await getKapsoConnection();
  const wabaId = conn?.businessAccountId;
  if (!wabaId) {
    logger.warn("kapso templates: no WABA connected yet, skipping submit");
    return;
  }

  const existing = await db
    .select()
    .from(waTemplates)
    .where(eq(waTemplates.businessAccountId, wabaId));
  const byName = new Map(existing.map((t) => [t.name, t]));

  for (const def of VORARE_TEMPLATES) {
    const row = byName.get(def.name);
    if (row && row.status !== "draft" && row.status !== "rejected") continue;

    try {
      const res = await createTemplate(wabaId, toMetaDefinition(def));
      await db
        .insert(waTemplates)
        .values({
          name: def.name,
          language: def.language,
          category: def.category,
          bodyText: def.bodyText,
          buttons: def.buttons,
          businessAccountId: wabaId,
          metaTemplateId: res.id ?? null,
          status: res.status?.toUpperCase() === "APPROVED" ? "approved" : "submitted",
          lastCheckedAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [waTemplates.name, waTemplates.businessAccountId],
          set: {
            metaTemplateId: res.id ?? null,
            status:
              res.status?.toUpperCase() === "APPROVED" ? "approved" : "submitted",
            statusReason: null,
            lastCheckedAt: new Date(),
            updatedAt: new Date(),
          },
        });
      logger.info(
        { name: def.name, wabaId, status: res.status },
        "kapso template submitted",
      );
    } catch (err) {
      const detail = err instanceof KapsoApiError ? err.detail : String(err);
      // "already exists" → record as submitted; the status poll resolves it.
      const alreadyExists = detail.toLowerCase().includes("already exists");
      await db
        .insert(waTemplates)
        .values({
          name: def.name,
          language: def.language,
          category: def.category,
          bodyText: def.bodyText,
          buttons: def.buttons,
          businessAccountId: wabaId,
          status: alreadyExists ? "submitted" : "draft",
          statusReason: alreadyExists ? null : detail.slice(0, 500),
          lastCheckedAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [waTemplates.name, waTemplates.businessAccountId],
          set: {
            status: alreadyExists ? "submitted" : "draft",
            statusReason: alreadyExists ? null : detail.slice(0, 500),
            lastCheckedAt: new Date(),
            updatedAt: new Date(),
          },
        });
      logger.warn({ name: def.name, err: detail }, "kapso template submit failed");
    }
  }
}

/**
 * Poll Meta for approval status of non-terminal templates (Kapso has no
 * template-status webhook). Run periodically from a pg-boss cron.
 */
export async function refreshKapsoTemplateStatuses(): Promise<void> {
  const conn = await getKapsoConnection();
  const wabaId = conn?.businessAccountId;
  if (!wabaId) return;

  const pending = await db
    .select()
    .from(waTemplates)
    .where(
      and(
        eq(waTemplates.businessAccountId, wabaId),
        inArray(waTemplates.status, ["submitted", "paused"]),
      ),
    );

  for (const row of pending) {
    try {
      const results = await listTemplatesByName(wabaId, row.name);
      const match = results.find((r) => r.name === row.name) ?? results[0];
      if (!match) continue;
      const meta = match.status?.toUpperCase() ?? "";
      const status =
        meta === "APPROVED"
          ? "approved"
          : meta === "REJECTED"
            ? "rejected"
            : meta === "PAUSED"
              ? "paused"
              : "submitted";
      await db
        .update(waTemplates)
        .set({
          status,
          metaTemplateId: match.id ?? row.metaTemplateId,
          lastCheckedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(waTemplates.id, row.id));
      if (status !== row.status) {
        logger.info({ name: row.name, status }, "kapso template status changed");
      }
    } catch (err) {
      logger.warn(
        { name: row.name, err: err instanceof KapsoApiError ? err.detail : String(err) },
        "kapso template status poll failed",
      );
    }
  }
}

/** Send gate: never send a template Meta hasn't approved for this WABA. */
export async function isTemplateApproved(name: string): Promise<boolean> {
  const conn = await getKapsoConnection();
  const wabaId = conn?.businessAccountId;
  if (!wabaId) return false;
  const [row] = await db
    .select({ status: waTemplates.status })
    .from(waTemplates)
    .where(
      and(eq(waTemplates.name, name), eq(waTemplates.businessAccountId, wabaId)),
    )
    .limit(1);
  return row?.status === "approved";
}
