import { eq } from "@wa/db";
import { contacts, type Contact } from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { decideNewContactAgentMode, type NewContactFacts } from "./agent-mode";

/** Lo que el emisor sabe del contacto cuando lo trae. */
export interface ContactInfo {
  pushName?: string | null;
  name?: string | null;
}

/**
 * Lo único que se le reescribe a un contacto que **ya existe**: su nombre.
 *
 * El tipo es la mitad del ticket del lead nuevo. `agent_mode` se decide **solo
 * al crear la fila** —«contacto nuevo» es un momento, no un estado— y este tipo
 * lo vuelve inescribible por este camino: un asesor que apagó al agente no lo ve
 * volver porque no hay forma de escribirlo aquí, no porque alguien se acordó de
 * no hacerlo.
 */
export interface ExistingContactPatch {
  pushName?: string;
  name?: string;
}

/**
 * Qué se le actualiza a un contacto que ya existe, dado lo que trae el mensaje.
 *
 * Puro: recibe la fila y la información nueva, devuelve el parche. El
 * `pushName` se refresca cuando cambió —la persona se cambió el nombre de
 * WhatsApp—; el `name` solo se llena si está vacío, porque el que ya está lo
 * puso la tienda o un asesor y vale más que el que WhatsApp anuncia.
 */
export function updatesForExistingContact(
  row: Pick<Contact, "pushName" | "name">,
  info: ContactInfo,
): ExistingContactPatch {
  const updates: ExistingContactPatch = {};
  if (info.pushName && info.pushName !== row.pushName) {
    updates.pushName = info.pushName;
  }
  if (info.name && !row.name) updates.name = info.name;
  return updates;
}

/**
 * Contact resolution keyed on the Cloud API wa_id (E.164 digits). Replaces the
 * Baileys LID/PN merge machinery: legacy rows are matched by phone / pn_jid /
 * jid and stamped with wa_id on first contact.
 *
 * `newContact` es obligatorio y no tiene valor por defecto a propósito: es la
 * decisión de con qué `agent_mode` nace la fila, **solo se aplica cuando la fila
 * se crea**, y el compilador tiene que encontrar a cualquiera que abra un camino
 * nuevo para crear contactos sin haberla tomado. Ver `agent-mode.ts`.
 */
export async function upsertContactByWaId(
  waId: string,
  info: ContactInfo,
  newContact: NewContactFacts,
): Promise<Contact> {
  const legacyJid = `${waId}@s.whatsapp.net`;

  let [row] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.waId, waId))
    .limit(1);

  if (!row) {
    // Legacy rows created under Baileys: match by phone, then PN-JID, then jid.
    // Encontrar una es encontrar un contacto **que ya existe**: se le estampa el
    // wa_id y nada más. No es un nacimiento y su `agent_mode` no se toca.
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
    const birth = decideNewContactAgentMode(newContact);
    [row] = await db
      .insert(contacts)
      .values({
        waId,
        jid: legacyJid,
        phone: waId,
        pushName: info.pushName ?? null,
        name: info.name ?? null,
        agentMode: birth.agentMode,
      })
      .onConflictDoNothing({ target: contacts.waId })
      .returning();
    if (!row) {
      // Raced with a concurrent insert — fetch the winner. El ganador nació con
      // esta misma regla, así que no hay nada que corregirle.
      [row] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.waId, waId))
        .limit(1);
      return row!;
    }
    // `info` cuando el contacto nace atendido —hay un vendedor en juego y hay
    // algo que mirar—, `debug` para el caso de siempre: hoy, sin vendedor
    // configurado, esta línea no aparece en producción y el volumen del log
    // queda exactamente como estaba.
    logger[birth.agentMode ? "info" : "debug"](
      {
        contactId: row.id,
        origen: newContact.origin,
        agentMode: birth.agentMode,
        regla: birth.rule,
      },
      "ingesta: contacto nuevo",
    );
    return row!;
  }

  const updates = updatesForExistingContact(row, info);
  if (Object.keys(updates).length > 0) {
    [row] = await db
      .update(contacts)
      .set(updates)
      .where(eq(contacts.id, row.id))
      .returning();
  }
  return row!;
}
