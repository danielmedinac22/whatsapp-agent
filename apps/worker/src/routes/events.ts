import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { panelOperation, panelOperationId } from "../operations";
import { events as bus } from "../lib/events";
import { esParaElPanel, normalizarAvisoDelPanel } from "../lib/eventos";
import { getKapsoConnection } from "../kapso/connection";

export const events = new Hono();

/**
 * El sexto emisor: el aviso que `apps/web` manda al tocar un botón de la
 * bandeja —tomar la conversación, marcar la confirmación—.
 *
 * No lo señala el compilador como a los otros cinco, porque del otro lado es un
 * objeto literal dentro de un `JSON.stringify`. Por eso el evento se **arma**
 * acá en vez de reenviarse tal cual: {@link normalizarAvisoDelPanel} le pega la
 * operación —la que ya viaja en `x-operation-id`, sin consulta— y deja la
 * instantánea en `null`, que es la verdad de estos dos botones.
 */
events.post("/notify", async (c) => {
  const crudo = await c.req.json().catch(() => null);
  const ev = normalizarAvisoDelPanel(crudo, panelOperationId(c));
  if (!ev) return c.json({ error: "invalid event" }, 400);
  bus.emitEvent(ev);
  return c.json({ ok: true });
});

events.get("/", (c) =>
  streamSSE(c, async (stream) => {
    let id = 0;
    const send = async (data: unknown) => {
      await stream.writeSSE({
        id: String(id++),
        event: "wa",
        data: JSON.stringify(data),
      });
    };

    // initial snapshot — connection state now lives in kapso_connection.
    // La conexión que se reporta es la de la operación elegida en el riel.
    // Aquí el fallo se traga a propósito: un SSE de estado que no puede resolver
    // la operación reporta "disconnected", no rompe la pantalla entera.
    const op = await panelOperation(c).catch(() => null);
    const conn = op ? await getKapsoConnection(op).catch(() => null) : null;
    await send({
      type: "status",
      status: conn?.phoneNumberId ? "connected" : "disconnected",
      phone: conn?.displayPhoneNumber ?? undefined,
    });

    // **El filtro que no existía.** Hasta acá el bus le mandaba todo a todas
    // las pestañas: con dos operaciones abiertas, la bandeja de Guatemala se
    // refrescaba con tráfico de Colombia. Se decide en el servidor, que es
    // donde ya se sabe qué operación pidió esta pestaña, y no en el cliente:
    // un evento que no sale no hay que confiar en que nadie lo mire. Con una
    // sola operación con datos —hoy— no descarta nada.
    const off = bus.onEvent((ev) => {
      if (!esParaElPanel(ev, op?.id ?? null)) return;
      void send(ev);
    });

    const heartbeat = setInterval(() => {
      stream.writeSSE({
        id: String(id++),
        event: "ping",
        data: String(Date.now()),
      });
    }, 25_000);

    stream.onAbort(() => {
      off();
      clearInterval(heartbeat);
    });

    // keep open until client disconnects
    await new Promise<void>((resolve) => {
      stream.onAbort(() => resolve());
    });
  }),
);
