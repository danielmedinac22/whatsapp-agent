import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { WaEvent } from "@wa/shared";
import { panelOperation } from "../operations";
import { events as bus } from "../lib/events";
import { getKapsoConnection } from "../kapso/connection";

export const events = new Hono();

events.post("/notify", async (c) => {
  const ev = (await c.req.json().catch(() => null)) as WaEvent | null;
  if (!ev || typeof ev !== "object" || !("type" in ev)) {
    return c.json({ error: "invalid event" }, 400);
  }
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
    const conn = await panelOperation(c)
      .then((op) => getKapsoConnection(op))
      .catch(() => null);
    await send({
      type: "status",
      status: conn?.phoneNumberId ? "connected" : "disconnected",
      phone: conn?.displayPhoneNumber ?? undefined,
    });

    const off = bus.onEvent((ev) => {
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
