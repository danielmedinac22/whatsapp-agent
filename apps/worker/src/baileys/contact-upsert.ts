import { eq, or, sql, type Contact } from "@wa/db";
import { contacts, conversations, messages, shopifyOrders } from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import type { ResolvedIdentity } from "./jid-resolver";

export type UpsertExtras = {
  pushName?: string | null;
  name?: string | null;
};

/**
 * Idempotent contact upsert keyed on (lid, pn_jid).
 *
 * - 0 matches → INSERT.
 * - 1 match   → UPDATE missing fields (e.g. fill in pn_jid when we only had lid).
 * - 2 matches → MERGE: reassign conversations / shopify_orders / messages from the
 *               duplicate to the canonical (older) row, then DELETE the duplicate.
 *
 * Always wrapped in a transaction so concurrent inbounds don't race.
 */
export async function upsertContactByIdentity(
  identity: ResolvedIdentity,
  extras: UpsertExtras = {},
): Promise<Contact> {
  return db.transaction(async (tx) => {
    const matchPredicates = [
      identity.lid ? eq(contacts.lid, identity.lid) : null,
      identity.pnJid ? eq(contacts.pnJid, identity.pnJid) : null,
    ].filter((p): p is NonNullable<typeof p> => p !== null);

    const found =
      matchPredicates.length === 0
        ? []
        : await tx
            .select()
            .from(contacts)
            .where(
              matchPredicates.length === 1
                ? matchPredicates[0]
                : or(...matchPredicates),
            );

    // ── Case A: no match → INSERT ────────────────────────────────────────────
    if (found.length === 0) {
      const [created] = await tx
        .insert(contacts)
        .values({
          jid: identity.preferredJid,
          lid: identity.lid,
          pnJid: identity.pnJid,
          phone: identity.phone,
          pushName: extras.pushName ?? null,
          name: extras.name ?? extras.pushName ?? identity.phone ?? null,
        })
        .returning();
      return created!;
    }

    // ── Case B: single match → fill in missing fields ────────────────────────
    if (found.length === 1) {
      const existing = found[0]!;
      const updates: Partial<typeof contacts.$inferInsert> = {};

      if (!existing.lid && identity.lid) updates.lid = identity.lid;
      if (!existing.pnJid && identity.pnJid) updates.pnJid = identity.pnJid;
      // identity.phone (extracted from PN-JID) is authoritative when available;
      // legacy rows may have stored the LID's numeric id in `phone`.
      if (identity.phone && existing.phone !== identity.phone) {
        updates.phone = identity.phone;
      }
      // Refresh jid to the preferred (LID > PN) so outbound sendMessage uses LID.
      if (existing.jid !== identity.preferredJid) {
        updates.jid = identity.preferredJid;
      }
      if (extras.pushName && existing.pushName !== extras.pushName) {
        updates.pushName = extras.pushName;
      }
      if (extras.name && !existing.name) updates.name = extras.name;

      if (Object.keys(updates).length === 0) return existing;

      const [updated] = await tx
        .update(contacts)
        .set(updates)
        .where(eq(contacts.id, existing.id))
        .returning();
      return updated!;
    }

    // ── Case C: two matches → MERGE the duplicates ───────────────────────────
    // Canonical = older row (smaller createdAt). Drop the other.
    const sorted = [...found].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const canonical = sorted[0]!;
    const dup = sorted[1]!;

    logger.warn(
      {
        canonicalId: canonical.id,
        canonicalJid: canonical.jid,
        dupId: dup.id,
        dupJid: dup.jid,
        identity,
      },
      "contact_merge: collapsing LID/PN duplicate rows",
    );

    // Move ownership of related rows.
    await tx
      .update(shopifyOrders)
      .set({ contactId: canonical.id })
      .where(eq(shopifyOrders.contactId, dup.id));

    // Conversations: if the duplicate has its own conversation, fold its messages
    // into the canonical's conversation (creating one if needed) and delete the
    // duplicate's conversation row. unique(contactId) prevents simply reparenting.
    const dupConvs = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.contactId, dup.id));

    if (dupConvs.length > 0) {
      let [canonicalConv] = await tx
        .select()
        .from(conversations)
        .where(eq(conversations.contactId, canonical.id))
        .limit(1);
      if (!canonicalConv) {
        [canonicalConv] = await tx
          .insert(conversations)
          .values({ contactId: canonical.id })
          .returning();
      }
      for (const dupConv of dupConvs) {
        await tx
          .update(messages)
          .set({ conversationId: canonicalConv!.id })
          .where(eq(messages.conversationId, dupConv.id));
        // Aggregate unread + preserve latest timestamps.
        await tx
          .update(conversations)
          .set({
            unreadCount: sql`${conversations.unreadCount} + ${dupConv.unreadCount ?? 0}`,
            lastInboundAt: sql`greatest(coalesce(${conversations.lastInboundAt}, 'epoch'::timestamptz), coalesce(${dupConv.lastInboundAt}, 'epoch'::timestamptz))`,
            lastOutboundAt: sql`greatest(coalesce(${conversations.lastOutboundAt}, 'epoch'::timestamptz), coalesce(${dupConv.lastOutboundAt}, 'epoch'::timestamptz))`,
            lastMessagePreview:
              dupConv.lastMessagePreview ?? canonicalConv!.lastMessagePreview,
          })
          .where(eq(conversations.id, canonicalConv!.id));
        await tx.delete(conversations).where(eq(conversations.id, dupConv.id));
      }
    }

    // Merge fields onto canonical.
    const merged: Partial<typeof contacts.$inferInsert> = {};
    if (!canonical.lid && (dup.lid || identity.lid)) {
      merged.lid = canonical.lid ?? dup.lid ?? identity.lid;
    }
    if (!canonical.pnJid && (dup.pnJid || identity.pnJid)) {
      merged.pnJid = canonical.pnJid ?? dup.pnJid ?? identity.pnJid;
    }
    // Prefer identity.phone (resolved from PN-JID) over either row's stored phone:
    // legacy LID rows may have a corrupt phone (the LID's numeric id).
    if (identity.phone) {
      merged.phone = identity.phone;
    } else if (!canonical.phone && dup.phone) {
      merged.phone = dup.phone;
    }
    if (!canonical.name && dup.name) merged.name = dup.name;
    if (!canonical.pushName && dup.pushName) merged.pushName = dup.pushName;
    if (extras.pushName && canonical.pushName !== extras.pushName) {
      merged.pushName = extras.pushName;
    }
    if (extras.name && !canonical.name && !merged.name) merged.name = extras.name;
    if (canonical.agentMode || dup.agentMode) merged.agentMode = true;
    if (
      dup.lastMessageAt &&
      (!canonical.lastMessageAt ||
        dup.lastMessageAt > canonical.lastMessageAt)
    ) {
      merged.lastMessageAt = dup.lastMessageAt;
    }
    merged.jid = identity.preferredJid;

    // Delete dup BEFORE updating canonical so partial-unique indexes on
    // (lid, pn_jid) don't conflict when canonical adopts dup's values.
    await tx.delete(contacts).where(eq(contacts.id, dup.id));

    const [updated] = await tx
      .update(contacts)
      .set(merged)
      .where(eq(contacts.id, canonical.id))
      .returning();
    return updated!;
  });
}
