import { eq } from "@wa/db";
import { contacts, type Contact } from "@wa/db";
import { db } from "../db";

/**
 * Contact resolution keyed on the Cloud API wa_id (E.164 digits). Replaces the
 * Baileys LID/PN merge machinery: legacy rows are matched by phone / pn_jid /
 * jid and stamped with wa_id on first contact.
 */
export async function upsertContactByWaId(
  waId: string,
  info: { pushName?: string | null; name?: string | null } = {},
): Promise<Contact> {
  const legacyJid = `${waId}@s.whatsapp.net`;

  let [row] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.waId, waId))
    .limit(1);

  if (!row) {
    // Legacy rows created under Baileys: match by phone, then PN-JID, then jid.
    for (const cond of [
      eq(contacts.phone, waId),
      eq(contacts.pnJid, legacyJid),
      eq(contacts.jid, legacyJid),
    ]) {
      [row] = await db.select().from(contacts).where(cond).limit(1);
      if (row) break;
    }
    if (row && !row.waId) {
      [row] = await db
        .update(contacts)
        .set({ waId, phone: row.phone ?? waId })
        .where(eq(contacts.id, row.id))
        .returning();
    }
  }

  if (!row) {
    [row] = await db
      .insert(contacts)
      .values({
        waId,
        jid: legacyJid,
        phone: waId,
        pushName: info.pushName ?? null,
        name: info.name ?? null,
      })
      .onConflictDoNothing({ target: contacts.waId })
      .returning();
    if (!row) {
      // Raced with a concurrent insert — fetch the winner.
      [row] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.waId, waId))
        .limit(1);
    }
    return row!;
  }

  const updates: Partial<typeof contacts.$inferInsert> = {};
  if (info.pushName && info.pushName !== row.pushName) {
    updates.pushName = info.pushName;
  }
  if (info.name && !row.name) updates.name = info.name;
  if (Object.keys(updates).length > 0) {
    [row] = await db
      .update(contacts)
      .set(updates)
      .where(eq(contacts.id, row.id))
      .returning();
  }
  return row!;
}
