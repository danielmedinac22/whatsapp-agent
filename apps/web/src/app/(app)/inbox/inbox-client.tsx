"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export type ChatItem = {
  id: string;
  contactId: string;
  jid: string;
  name: string;
  agentMode: boolean;
  preview: string | null;
  unread: number;
  lastAt: string;
};

export function InboxClient({ initial }: { initial: ChatItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState<ChatItem[]>(initial);
  const [selected, setSelected] = useState<ChatItem | null>(initial[0] ?? null);

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("wa", (e) => {
      try {
        const ev = JSON.parse((e as MessageEvent).data);
        if (ev.type === "message.created") {
          router.refresh();
        }
      } catch {
        /* ignore */
      }
    });
    return () => es.close();
  }, [router]);

  // resync local list when server sends new initial
  useEffect(() => {
    setItems(initial);
    if (selected) {
      const fresh = initial.find((i) => i.id === selected.id);
      if (fresh) setSelected(fresh);
    } else if (initial[0]) {
      setSelected(initial[0]);
    }
  }, [initial, selected]);

  return (
    <div className="grid h-screen grid-cols-[320px_1fr]">
      <aside className="flex flex-col overflow-hidden border-r bg-[var(--color-panel)]">
        <div className="border-b px-4 py-3 text-sm font-medium">
          Conversaciones
        </div>
        <ul className="flex-1 overflow-y-auto">
          {items.length === 0 && (
            <li className="p-6 text-center text-sm text-[var(--color-text-dim)]">
              No hay conversaciones todavía.
            </li>
          )}
          {items.map((it) => (
            <li
              key={it.id}
              onClick={() => setSelected(it)}
              className={`cursor-pointer border-b px-4 py-3 hover:bg-[var(--color-panel-2)] ${
                selected?.id === it.id ? "bg-[var(--color-panel-2)]" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="truncate font-medium">{it.name}</p>
                {it.unread > 0 && (
                  <span className="ml-2 rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-xs text-white">
                    {it.unread}
                  </span>
                )}
              </div>
              <p className="mt-1 truncate text-xs text-[var(--color-text-dim)]">
                {it.preview ?? "—"}
              </p>
              {it.agentMode && (
                <span className="mt-1 inline-block rounded bg-[var(--color-bubble-out)]/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-text-dim)]">
                  agente
                </span>
              )}
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex min-h-0 flex-col">
        {selected ? (
          <ConversationPane key={selected.id} chat={selected} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-[var(--color-text-dim)]">
            Selecciona una conversación
          </div>
        )}
      </section>
    </div>
  );
}

type Msg = {
  id: string;
  direction: "in" | "out";
  body: string;
  fromAgent: boolean;
  createdAt: string;
};

function ConversationPane({ chat }: { chat: ChatItem }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const reload = async () => {
    const r = await fetch(`/api/conversations/${chat.id}/messages`, {
      cache: "no-store",
    });
    if (r.ok) {
      const j = (await r.json()) as { messages: Msg[] };
      setMsgs(j.messages);
    }
  };

  useEffect(() => {
    reload();
    const es = new EventSource("/api/events");
    es.addEventListener("wa", (e) => {
      try {
        const ev = JSON.parse((e as MessageEvent).data);
        if (
          ev.type === "message.created" &&
          ev.conversationId === chat.id
        ) {
          reload();
        }
      } catch {
        /* ignore */
      }
    });
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id]);

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const r = await fetch("/api/wa/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jid: chat.jid, body: text }),
      });
      if (r.ok) {
        setText("");
        setTimeout(reload, 200);
      } else {
        alert("No se pudo enviar (¿WhatsApp conectado?)");
      }
    } finally {
      setSending(false);
    }
  };

  const toggleAgent = async () => {
    await fetch(`/api/contacts/${chat.contactId}/agent-mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ on: !chat.agentMode }),
    });
    location.reload();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-bg)]">
      <header className="flex items-center justify-between border-b bg-[var(--color-panel)] px-4 py-3">
        <div>
          <p className="font-medium">{chat.name}</p>
          <p className="text-xs text-[var(--color-text-dim)]">{chat.jid}</p>
        </div>
        <button
          onClick={toggleAgent}
          className={`rounded border px-3 py-1 text-xs ${
            chat.agentMode
              ? "border-[var(--color-accent)] text-[var(--color-accent)]"
              : "text-[var(--color-text-dim)]"
          }`}
        >
          Agente: {chat.agentMode ? "ON" : "OFF"}
        </button>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {msgs.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                m.direction === "out"
                  ? "bg-[var(--color-bubble-out)]"
                  : "bg-[var(--color-bubble-in)]"
              }`}
            >
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <p className="mt-1 text-right text-[10px] text-[var(--color-text-dim)]">
                {m.fromAgent && "🤖 "}
                {new Date(m.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        ))}
      </div>

      <footer className="border-t bg-[var(--color-panel)] p-3">
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Escribe un mensaje…"
            className="flex-1 rounded bg-[var(--color-panel-2)] px-3 py-2 outline-none"
          />
          <button
            onClick={send}
            disabled={sending || !text.trim()}
            className="rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Enviar
          </button>
        </div>
      </footer>
    </div>
  );
}
