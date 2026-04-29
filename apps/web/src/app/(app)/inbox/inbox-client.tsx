"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, MessageSquareText, Send, Sparkles } from "lucide-react";

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
  const automatedCount = items.filter((item) => item.agentMode).length;
  const unreadCount = items.reduce((sum, item) => sum + item.unread, 0);

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
    <div className="app-page flex h-full min-h-[calc(100vh-46px)] flex-col gap-3">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="app-title">Inbox</h1>
          <p className="mt-1 text-sm text-[var(--color-text-dim)]">
            Conversaciones en vivo
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <SummaryCard label="Conversaciones" value={String(items.length)} />
          <SummaryCard label="Sin leer" value={String(unreadCount)} />
          <SummaryCard label="Modo agente" value={String(automatedCount)} />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[336px_1fr]">
        <aside className="app-card flex min-h-[520px] flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2.5">
            <div>
              <p className="text-sm font-semibold">Conversaciones</p>
            </div>
            <span className="rounded-md border border-[var(--color-border)] bg-[rgba(8,21,30,0.72)] px-2 py-1 text-xs text-[var(--color-text-dim)]">
              {items.length} activas
            </span>
          </div>
          <ul className="flex-1 overflow-y-auto p-2">
          {items.length === 0 && (
            <li className="p-4 text-center text-sm text-[var(--color-text-dim)]">
              No hay conversaciones todavía.
            </li>
          )}
          {items.map((it) => (
            <li
              key={it.id}
              onClick={() => setSelected(it)}
              className={`mb-1 cursor-pointer rounded-lg border px-3 py-2.5 transition ${
                selected?.id === it.id
                  ? "border-[rgba(110,231,183,0.3)] bg-[rgba(18,42,53,0.92)]"
                  : "border-transparent bg-transparent hover:border-[var(--color-border)] hover:bg-[rgba(18,35,48,0.68)]"
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="truncate font-medium text-[var(--color-text)]">
                  {it.name}
                </p>
                {it.unread > 0 && (
                  <span className="ml-2 rounded-md bg-[var(--color-accent)] px-2 py-0.5 text-xs font-semibold text-[#032617]">
                    {it.unread}
                  </span>
                )}
              </div>
              <p className="mt-1 truncate text-xs text-[var(--color-text-dim)]">
                {it.preview ?? "—"}
              </p>
              <div className="mt-2 flex items-center justify-between">
                {it.agentMode ? (
                  <span className="inline-flex items-center gap-1 rounded-md border border-emerald-400/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase text-emerald-200">
                    <Sparkles className="h-3 w-3" />
                    agente
                  </span>
                ) : (
                  <span className="text-[10px] uppercase text-[var(--color-text-soft)]">
                    manual
                  </span>
                )}
                <span className="text-[11px] text-[var(--color-text-soft)]">
                  {new Date(it.lastAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            </li>
          ))}
        </ul>
        </aside>

        <section className="flex min-h-0 flex-col">
        {selected ? (
          <ConversationPane key={selected.id} chat={selected} />
        ) : (
          <div className="app-card flex flex-1 items-center justify-center text-[var(--color-text-dim)]">
            Selecciona una conversación
          </div>
        )}
        </section>
      </div>
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
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [msgs]);

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
    <div className="app-card flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <div>
          <p className="text-base font-semibold">{chat.name}</p>
          <p className="text-xs text-[var(--color-text-dim)]">{chat.jid}</p>
        </div>
        <button
          onClick={toggleAgent}
          className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs uppercase ${
            chat.agentMode
              ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
              : "border-[var(--color-border)] text-[var(--color-text-dim)]"
          }`}
        >
          <Bot className="h-3.5 w-3.5" />
          Agente: {chat.agentMode ? "ON" : "OFF"}
        </button>
      </header>

      <div className="border-b border-[var(--color-border)] px-4 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-dim)]">
          <span className="inline-flex h-7 items-center gap-2 rounded-md border border-[var(--color-border)] bg-[rgba(8,21,30,0.72)] px-2">
            <MessageSquareText className="h-3.5 w-3.5" />
            {msgs.length} mensajes
          </span>
          <span className="inline-flex h-7 items-center gap-2 rounded-md border border-[var(--color-border)] bg-[rgba(8,21,30,0.72)] px-2">
            <span className="h-2 w-2 rounded-full bg-[var(--color-accent)]" />
            {chat.agentMode ? "Automatización activa" : "Respuesta manual"}
          </span>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-2 overflow-y-auto bg-[linear-gradient(180deg,rgba(9,19,28,0.3),rgba(5,12,18,0.18))] p-4"
      >
        {msgs.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[78%] rounded-lg px-3 py-2 text-sm shadow-[0_10px_28px_rgba(3,10,16,0.2)] ${
                m.direction === "out"
                  ? "bg-[image:var(--color-bubble-out)]"
                  : "bg-[image:var(--color-bubble-in)]"
              }`}
            >
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <p className="mt-1 text-right text-[10px] uppercase text-[var(--color-text-dim)]">
                {m.fromAgent && "BOT "}
                {new Date(m.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        ))}
      </div>

      <footer className="border-t border-[var(--color-border)] bg-[rgba(10,24,34,0.84)] p-3">
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
            className="app-input flex-1"
          />
          <button
            onClick={send}
            disabled={sending || !text.trim()}
            className="app-button gap-2"
          >
            <Send className="h-4 w-4" />
            Enviar
          </button>
        </div>
      </footer>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="app-card min-w-[132px] px-3 py-2">
      <p className="text-[11px] uppercase text-[var(--color-text-soft)]">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold text-[var(--color-text)]">
        {value}
      </p>
    </div>
  );
}
