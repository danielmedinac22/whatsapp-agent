import { agentPromptVersions, desc, sql } from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";

/** Cuántas versiones conservamos. Las más viejas se podan al guardar. */
const MAX_VERSIONS = 50;

export interface PromptVersionSummary {
  id: string;
  label: string | null;
  authorEmail: string | null;
  createdAt: Date;
  length: number;
  preview: string;
}

/**
 * Guarda una versión del prompt. Es idempotente: si el texto es idéntico a la
 * última versión no crea una entrada nueva (guardar dos veces seguidas sin
 * cambios no ensucia el historial).
 */
export async function recordPromptVersion({
  prompt,
  label,
  authorEmail,
}: {
  prompt: string;
  label?: string | null;
  authorEmail?: string | null;
}): Promise<void> {
  const [latest] = await db
    .select({ prompt: agentPromptVersions.prompt })
    .from(agentPromptVersions)
    .orderBy(desc(agentPromptVersions.createdAt))
    .limit(1);

  if (latest?.prompt === prompt) return;

  await db.insert(agentPromptVersions).values({
    prompt,
    label: label?.trim() ? label.trim().slice(0, 200) : null,
    authorEmail: authorEmail ?? null,
  });

  // Poda: conservar sólo las MAX_VERSIONS más recientes.
  await db
    .execute(
      sql`DELETE FROM ${agentPromptVersions} WHERE ${agentPromptVersions.id} NOT IN (
        SELECT ${agentPromptVersions.id} FROM ${agentPromptVersions}
        ORDER BY ${agentPromptVersions.createdAt} DESC
        LIMIT ${MAX_VERSIONS}
      )`,
    )
    .catch((err) => {
      logger.warn({ err }, "prompt version prune failed");
    });
}

export async function listPromptVersions(): Promise<PromptVersionSummary[]> {
  const rows = await db
    .select()
    .from(agentPromptVersions)
    .orderBy(desc(agentPromptVersions.createdAt))
    .limit(MAX_VERSIONS);

  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    authorEmail: r.authorEmail,
    createdAt: r.createdAt,
    length: r.prompt.length,
    preview: r.prompt.slice(0, 240),
  }));
}

export async function getPromptVersion(id: string) {
  const [row] = await db
    .select()
    .from(agentPromptVersions)
    .where(sql`${agentPromptVersions.id} = ${id}`)
    .limit(1);
  return row ?? null;
}
