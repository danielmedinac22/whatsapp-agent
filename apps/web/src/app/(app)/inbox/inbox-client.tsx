"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buildReopenOptions, type ReopenOption } from "@/lib/reopen";
import { VoiceRecorder } from "./voice-recorder";
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  Building2,
  Check,
  CheckCheck,
  CheckCircle2,
  Clock,
  CircleDashed,
  FileText,
  HelpCircle,
  MessageSquareText,
  Package,
  Search,
  Send,
  Sparkles,
  Truck,
  Undo2,
  X,
  XCircle,
} from "lucide-react";

export type ConfirmationStatus =
  | "unknown"
  | "pending"
  | "confirmed"
  | "not_confirmed";

export type DropiStatus =
  | "unknown"
  | "pendiente_confirmacion"
  | "pendiente"
  | "guia_generada"
  | "preparado_transportadora"
  | "recolectado"
  | "en_transito"
  | "con_mensajero"
  | "en_oficina"
  | "entregado"
  | "novedad"
  | "novedad_solucionada"
  | "devolucion"
  | "rechazado"
  | "retornado"
  | "anulada";

export type ChatItem = {
  id: string;
  contactId: string;
  /** Destination wa_id (E.164 digits, sin "+"). */
  to: string;
  name: string;
  /** Último mensaje del cliente — define la ventana de 24h de Meta. */
  lastInboundAt: string | null;
  novedadReason: string | null;
  orderNumber: string | null;
  producto: string | null;
  agentMode: boolean;
  /** El último mensaje que enviamos no se entregó. */
  deliveryFailed: boolean;
  preview: string | null;
  unread: number;
  confirmationStatus: ConfirmationStatus;
  confirmationSource: "auto" | "manual" | null;
  lastAt: string;
  dropiStatus: DropiStatus | null;
  dropiHasNovedad: boolean;
  dropiGuide: string | null;
  dropiCarrier: string | null;
  dropiPdfUrl: string | null;
};

type FilterKey =
  | "all"
  | "pending"
  | "confirmed"
  | "not_confirmed"
  | "needs_attention";

const STATUS_META: Record<
  ConfirmationStatus,
  { label: string; classes: string; icon: typeof CheckCircle2 }
> = {
  confirmed: {
    label: "confirmado",
    classes: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
    icon: CheckCircle2,
  },
  not_confirmed: {
    label: "no confirmado",
    classes: "border-red-400/30 bg-red-500/10 text-red-200",
    icon: XCircle,
  },
  pending: {
    label: "pendiente",
    classes: "border-amber-400/30 bg-amber-500/10 text-amber-200",
    icon: CircleDashed,
  },
  unknown: {
    label: "sin clasificar",
    classes: "border-[var(--color-border)] text-[var(--color-text-soft)]",
    icon: HelpCircle,
  },
};

const DROPI_META: Record<
  DropiStatus,
  { label: string; classes: string; icon: typeof CheckCircle2 }
> = {
  unknown: {
    label: "—",
    classes: "border-[var(--color-border)] text-[var(--color-text-soft)]",
    icon: HelpCircle,
  },
  pendiente_confirmacion: {
    label: "por confirmar",
    classes: "border-amber-400/30 bg-amber-500/10 text-amber-200",
    icon: CircleDashed,
  },
  pendiente: {
    label: "pendiente",
    classes: "border-amber-400/30 bg-amber-500/10 text-amber-200",
    icon: CircleDashed,
  },
  guia_generada: {
    label: "guía",
    classes: "border-sky-400/30 bg-sky-500/10 text-sky-200",
    icon: FileText,
  },
  preparado_transportadora: {
    label: "preparado",
    classes: "border-sky-400/30 bg-sky-500/10 text-sky-200",
    icon: Package,
  },
  recolectado: {
    label: "recolectado",
    classes: "border-sky-400/30 bg-sky-500/10 text-sky-200",
    icon: Package,
  },
  en_transito: {
    label: "en tránsito",
    classes: "border-sky-400/30 bg-sky-500/10 text-sky-200",
    icon: Truck,
  },
  con_mensajero: {
    label: "con mensajero",
    classes: "border-sky-400/30 bg-sky-500/10 text-sky-200",
    icon: Truck,
  },
  en_oficina: {
    label: "en oficina",
    classes: "border-orange-400/30 bg-orange-500/10 text-orange-200",
    icon: Building2,
  },
  entregado: {
    label: "entregado",
    classes: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
    icon: CheckCircle2,
  },
  novedad: {
    label: "novedad",
    classes: "border-red-400/30 bg-red-500/10 text-red-200",
    icon: AlertTriangle,
  },
  novedad_solucionada: {
    label: "novedad resuelta",
    classes: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
    icon: CheckCircle2,
  },
  devolucion: {
    label: "devolución",
    classes: "border-amber-400/30 bg-amber-500/10 text-amber-200",
    icon: Undo2,
  },
  rechazado: {
    label: "rechazado",
    classes: "border-red-400/30 bg-red-500/10 text-red-200",
    icon: XCircle,
  },
  retornado: {
    label: "retornado",
    classes: "border-amber-400/30 bg-amber-500/10 text-amber-200",
    icon: Undo2,
  },
  anulada: {
    label: "anulada",
    classes: "border-[var(--color-border)] text-[var(--color-text-soft)]",
    icon: XCircle,
  },
};

export function InboxClient({
  initial,
  approvedTemplates,
  query,
  selectedId,
}: {
  initial: ChatItem[];
  approvedTemplates: string[];
  /** Término de búsqueda vigente en la URL (?q=), resuelto en el servidor. */
  query: string;
  /** Conversación pedida por URL (?c=), p. ej. desde un pedido. */
  selectedId: string | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState<ChatItem[]>(initial);
  const [selected, setSelected] = useState<ChatItem | null>(
    (selectedId ? initial.find((i) => i.id === selectedId) : null) ??
      initial[0] ??
      null,
  );
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState(query);
  const [searching, startSearch] = useTransition();

  // La búsqueda vive en la URL y la resuelve el servidor sobre TODAS las
  // conversaciones — la lista solo carga las 200 más recientes, así que un
  // filtro local no encontraría a nadie de hace meses.
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => {
      const term = search.trim();
      startSearch(() => {
        router.replace(term ? `/inbox?q=${encodeURIComponent(term)}` : "/inbox");
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [search, query, router]);
  const automatedCount = items.filter((item) => item.agentMode).length;
  const unreadCount = items.reduce((sum, item) => sum + item.unread, 0);
  const pendingCount = items.filter(
    (item) => item.confirmationStatus === "pending",
  ).length;
  const confirmedCount = items.filter(
    (item) => item.confirmationStatus === "confirmed",
  ).length;
  const notConfirmedCount = items.filter(
    (item) => item.confirmationStatus === "not_confirmed",
  ).length;
  const needsAttentionCount = items.filter(
    (item) => !item.agentMode && item.unread > 0,
  ).length;

  const visibleItems =
    filter === "all"
      ? items
      : filter === "needs_attention"
        ? items.filter((item) => !item.agentMode && item.unread > 0)
        : items.filter((item) => item.confirmationStatus === filter);

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("wa", (e) => {
      try {
        const ev = JSON.parse((e as MessageEvent).data);
        if (
          ev.type === "message.created" ||
          ev.type === "conversation.updated" ||
          // Los chulos de la lista solo cambian con un fallo; refrescar con
          // cada delivered/read sería un refresh por cada mensaje enviado.
          (ev.type === "message.status" && ev.status === "failed")
        ) {
          router.refresh();
        }
      } catch {
        /* ignore */
      }
    });
    return () => es.close();
  }, [router]);

  // Un ?c= nuevo (salto desde Pedidos) selecciona esa conversación una sola
  // vez: si se reaplicara en cada refresh del servidor, pisaría el click del
  // asesor cada vez que entra un mensaje.
  const appliedSelectedId = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId || appliedSelectedId.current === selectedId) return;
    const target = initial.find((i) => i.id === selectedId);
    if (target) {
      appliedSelectedId.current = selectedId;
      setSelected(target);
    }
  }, [selectedId, initial]);

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
    <div className="app-page flex min-h-[calc(100vh-46px)] flex-col gap-3 xl:h-[calc(100vh-46px)] xl:min-h-0">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="app-title">Inbox</h1>
          <p className="mt-1 text-sm text-[var(--color-text-dim)]">
            Conversaciones en vivo
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryCard
            label="Conversaciones"
            value={String(items.length)}
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <SummaryCard label="Sin leer" value={String(unreadCount)} />
          <SummaryCard label="Modo agente" value={String(automatedCount)} />
          <SummaryCard
            label="Por confirmar"
            value={String(pendingCount)}
            accent={pendingCount > 0 ? "text-amber-200" : undefined}
            active={filter === "pending"}
            onClick={() => setFilter("pending")}
          />
          <SummaryCard
            label="Necesita atención"
            value={String(needsAttentionCount)}
            accent={needsAttentionCount > 0 ? "text-red-200" : undefined}
            active={filter === "needs_attention"}
            onClick={() => setFilter("needs_attention")}
          />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[336px_1fr]">
        <aside className="app-card flex min-h-[520px] flex-col overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-[var(--color-border)] px-3 py-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-soft)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar nombre, teléfono o mensaje…"
                className="app-input h-8 w-full pl-8 pr-8 text-xs"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  title="Limpiar búsqueda"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-soft)] hover:text-[var(--color-text)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">
              {query ? (searching ? "Buscando…" : "Resultados") : "Conversaciones"}
            </p>
            <div className="flex items-center gap-2">
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as FilterKey)}
                className="h-7 rounded-md border border-[var(--color-border)] bg-[rgba(8,21,30,0.72)] px-2 text-xs text-[var(--color-text-dim)] outline-none transition hover:border-[rgba(110,231,183,0.3)] focus:border-[rgba(110,231,183,0.5)]"
              >
                <option value="all">Todas ({items.length})</option>
                <option value="pending">Pendientes ({pendingCount})</option>
                <option value="confirmed">Confirmadas ({confirmedCount})</option>
                <option value="not_confirmed">No conf. ({notConfirmedCount})</option>
                <option value="needs_attention">Atención ({needsAttentionCount})</option>
              </select>
              <span className="rounded-md border border-[var(--color-border)] bg-[rgba(8,21,30,0.72)] px-2 py-1 text-xs text-[var(--color-text-dim)]">
                {visibleItems.length}/{items.length}
              </span>
            </div>
            </div>
          </div>
          <ul className="flex-1 overflow-y-auto p-2">
          {visibleItems.length === 0 && (
            <li className="p-4 text-center text-sm text-[var(--color-text-dim)]">
              {query && items.length === 0
                ? `Sin resultados para «${query}».`
                : items.length === 0
                  ? "No hay conversaciones todavía."
                  : "Sin resultados con este filtro."}
            </li>
          )}
          {visibleItems.map((it) => {
            const needsAttention = !it.agentMode && it.unread > 0;
            return (
            <li
              key={it.id}
              onClick={() => setSelected(it)}
              className={`mb-2 cursor-pointer rounded-lg border px-3 py-2.5 transition ${
                selected?.id === it.id
                  ? "border-[rgba(110,231,183,0.35)] bg-[rgba(18,42,53,0.92)] shadow-[0_6px_18px_rgba(3,10,16,0.45)]"
                  : "border-[var(--color-border)] bg-[rgba(12,26,36,0.55)] shadow-[0_2px_8px_rgba(3,10,16,0.3)] hover:border-[rgba(110,231,183,0.2)] hover:bg-[rgba(18,35,48,0.78)]"
              } ${needsAttention ? "border-l-2 border-l-red-400/60" : ""}`}
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
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1">
                  {it.agentMode ? (
                    <span
                      title="Agente IA activo"
                      className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                    >
                      <Sparkles className="h-3 w-3" />
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase text-[var(--color-text-soft)]">
                      manual
                    </span>
                  )}
                  <ConfirmationChip status={it.confirmationStatus} />
                  {it.dropiStatus && it.dropiStatus !== "unknown" && (
                    <DropiChip status={it.dropiStatus} />
                  )}
                  {it.deliveryFailed && (
                    <span
                      title="El último mensaje que enviamos no se entregó — revisa si el número es válido"
                      className="inline-flex items-center gap-1 rounded-md border border-red-400/30 bg-red-500/10 px-2 py-0.5 text-[10px] uppercase text-red-200"
                    >
                      <AlertCircle className="h-3 w-3" />
                      no entregado
                    </span>
                  )}
                  {it.dropiHasNovedad && it.dropiStatus !== "novedad" && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-red-400/30 bg-red-500/10 px-2 py-0.5 text-[10px] uppercase text-red-200">
                      <AlertTriangle className="h-3 w-3" />
                      novedad
                    </span>
                  )}
                </div>
                <span
                  className="text-[11px] text-[var(--color-text-soft)]"
                  suppressHydrationWarning
                >
                  {new Date(it.lastAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            </li>
            );
          })}
        </ul>
        </aside>

        <section className="flex min-h-0 flex-col">
        {selected ? (
          <ConversationPane
            key={selected.id}
            chat={selected}
            approvedTemplates={approvedTemplates}
          />
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

type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";

type Msg = {
  id: string;
  direction: "in" | "out";
  body: string;
  fromAgent: boolean;
  status: MessageStatus;
  deliveryError: string | null;
  mediaUrl: string | null;
  mediaMime: string | null;
  createdAt: string;
};

/** Chulos de entrega, como en WhatsApp: reloj → 1 → 2 → 2 azules → error. */
function DeliveryTicks({
  status,
}: {
  status: MessageStatus;
}) {
  if (status === "failed") {
    return <AlertCircle className="h-3 w-3 text-red-300" />;
  }
  if (status === "pending") {
    return <Clock className="h-3 w-3 text-[var(--color-text-soft)]" />;
  }
  if (status === "sent") {
    return <Check className="h-3 w-3 text-[var(--color-text-soft)]" />;
  }
  return (
    <CheckCheck
      className={`h-3 w-3 ${
        status === "read" ? "text-sky-300" : "text-[var(--color-text-soft)]"
      }`}
    />
  );
}

const STATUS_TITLE: Record<MessageStatus, string> = {
  pending: "En cola",
  sent: "Enviado a WhatsApp",
  delivered: "Entregado en el teléfono del cliente",
  read: "Leído por el cliente",
  failed: "No entregado",
};

const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

type WindowState = "open" | "closed" | "unknown";

/** Estado de la ventana de 24h de Meta. `unknown` (sin inbound registrado) no
 *  bloquea: solo bloqueamos con evidencia; si Kapso rechaza, el outbox lo marca. */
function windowStateOf(lastInboundAt: string | null): WindowState {
  if (!lastInboundAt) return "unknown";
  const t = Date.parse(lastInboundAt);
  if (!Number.isFinite(t)) return "unknown";
  return Date.now() - t <= SERVICE_WINDOW_MS ? "open" : "closed";
}

function ConversationPane({
  chat,
  approvedTemplates,
}: {
  chat: ChatItem;
  approvedTemplates: string[];
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [reopenSending, setReopenSending] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // La ventana se calcula con el inbound más reciente que conozcamos: el de la
  // lista del servidor o uno recién llegado por SSE a este hilo.
  const latestInboundFromMsgs = msgs
    .filter((m) => m.direction === "in")
    .map((m) => m.createdAt)
    .sort()
    .at(-1);
  const effectiveLastInbound =
    [chat.lastInboundAt, latestInboundFromMsgs]
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1) ?? null;
  const windowState = windowStateOf(effectiveLastInbound);

  const reopenOptions = buildReopenOptions({
    contactName: chat.name.startsWith("+") ? null : chat.name,
    producto: chat.producto,
    dropiGuide: chat.dropiGuide,
    novedadReason: chat.novedadReason,
    approvedTemplates,
  });

  const sendReopen = async (opt: ReopenOption) => {
    if (reopenSending) return;
    setReopenSending(opt.templateName);
    try {
      const r = await fetch("/api/wa/send-template", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          to: chat.to,
          templateName: opt.templateName,
          params: opt.params,
          conversationId: chat.id,
        }),
      });
      if (r.ok) {
        setTimeout(reload, 400);
      } else {
        const j = (await r.json().catch(() => null)) as { error?: unknown } | null;
        alert(
          `No se pudo enviar la plantilla: ${typeof j?.error === "string" ? j.error : r.status}`,
        );
      }
    } finally {
      setReopenSending(null);
    }
  };

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
          (ev.type === "message.created" || ev.type === "message.status") &&
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
        body: JSON.stringify({ to: chat.to, body: text }),
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
          <p className="text-xs text-[var(--color-text-dim)]">+{chat.to}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ConfirmationMenu chat={chat} />
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
        </div>
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
          {chat.dropiStatus && chat.dropiStatus !== "unknown" && (
            <DropiChip status={chat.dropiStatus} />
          )}
          {chat.dropiGuide && (
            <span className="inline-flex h-7 items-center gap-2 rounded-md border border-[var(--color-border)] bg-[rgba(8,21,30,0.72)] px-2">
              <Package className="h-3.5 w-3.5" />
              {chat.dropiGuide}
              {chat.dropiCarrier ? ` · ${chat.dropiCarrier}` : ""}
            </span>
          )}
          {chat.dropiPdfUrl && (
            <a
              href={chat.dropiPdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 items-center gap-2 rounded-md border border-sky-400/30 bg-sky-500/10 px-2 text-sky-200 hover:bg-sky-500/20"
            >
              <FileText className="h-3.5 w-3.5" />
              PDF guía
            </a>
          )}
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
              } ${
                m.status === "failed" && m.direction === "out"
                  ? "border border-red-400/40"
                  : ""
              }`}
            >
              {m.mediaUrl && m.mediaMime?.startsWith("audio/") ? (
                <div className="space-y-1">
                  <audio
                    src={m.mediaUrl}
                    controls
                    preload="metadata"
                    className="h-9 w-[240px] max-w-full"
                  />
                  {/* Para el audio entrante el body es la transcripción de
                      Kapso: se muestra como pie para poder leer sin escuchar. */}
                  {m.direction === "in" && m.body.trim() && (
                    <p className="whitespace-pre-wrap break-words text-xs italic text-[var(--color-text-dim)]">
                      “{m.body}”
                    </p>
                  )}
                </div>
              ) : (
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
              )}
              {m.direction === "out" && m.status === "failed" && (
                <p className="mt-1 text-[11px] leading-4 text-red-200">
                  ⚠ No entregado
                  {m.deliveryError ? ` · ${m.deliveryError}` : ""}
                </p>
              )}
              <p
                className="mt-1 flex items-center justify-end gap-1 text-[10px] uppercase text-[var(--color-text-dim)]"
                suppressHydrationWarning
              >
                {m.fromAgent && "BOT "}
                {new Date(m.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {m.direction === "out" && (
                  <span title={STATUS_TITLE[m.status]} className="ml-0.5 flex">
                    <DeliveryTicks status={m.status} />
                  </span>
                )}
              </p>
            </div>
          </div>
        ))}
      </div>

      <footer className="border-t border-[var(--color-border)] bg-[rgba(10,24,34,0.84)] p-3">
        {windowState === "closed" ? (
          <div className="space-y-2">
            <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
              ⏳ <strong>Ventana de 24h cerrada.</strong> El cliente lleva más
              de 24 horas sin escribir y WhatsApp solo permite reabrir con una
              plantilla aprobada por Meta. Cuando responda, el chat libre se
              habilita de nuevo.
            </div>
            <div className="space-y-2">
              {reopenOptions.map((opt) => (
                <div
                  key={opt.templateName}
                  className={`flex items-start justify-between gap-3 rounded-lg border p-2.5 ${
                    opt.sendable
                      ? "border-[var(--color-border)]"
                      : "border-[var(--color-border)] opacity-50"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-[var(--color-text)]">
                      {opt.label}
                      {!opt.sendable && opt.reason && (
                        <span className="ml-2 font-normal text-amber-200/80">
                          · {opt.reason}
                        </span>
                      )}
                    </p>
                    <p className="mt-1 line-clamp-2 whitespace-pre-line text-xs text-[var(--color-text-dim)]">
                      {opt.preview}
                    </p>
                  </div>
                  <button
                    onClick={() => sendReopen(opt)}
                    disabled={!opt.sendable || reopenSending !== null}
                    className="app-button shrink-0 gap-1.5 text-xs"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {reopenSending === opt.templateName ? "Enviando…" : "Enviar"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {windowState === "unknown" && (
              <p className="text-[11px] leading-4 text-[var(--color-text-dim)]">
                Este contacto aún no ha escrito — si WhatsApp rechaza el envío
                por falta de ventana activa, usa una plantilla.
              </p>
            )}
            <div className="flex flex-wrap items-start gap-2">
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
                className="app-input min-w-[180px] flex-1"
              />
              {/* Solo con la ventana abierta: una nota de voz no puede reabrir
                  una conversación de más de 24h, eso exige plantilla. */}
              <VoiceRecorder
                to={chat.to}
                conversationId={chat.id}
                onSent={() => setTimeout(reload, 400)}
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
          </div>
        )}
      </footer>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent,
  active,
  onClick,
}: {
  label: string;
  value: string;
  accent?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const clickable = typeof onClick === "function";
  const className = `app-card min-w-[132px] px-3 py-2 text-left transition ${
    clickable ? "cursor-pointer" : ""
  } ${
    active
      ? "border-[rgba(110,231,183,0.4)] bg-[rgba(18,42,53,0.92)]"
      : clickable
        ? "hover:border-[var(--color-border)] hover:bg-[rgba(18,35,48,0.68)]"
        : ""
  }`;
  const inner = (
    <>
      <p className="text-[11px] uppercase text-[var(--color-text-soft)]">
        {label}
      </p>
      <p
        className={`mt-1 text-xl font-semibold text-[var(--color-text)] ${accent ?? ""}`}
      >
        {value}
      </p>
    </>
  );
  if (clickable) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {inner}
      </button>
    );
  }
  return <div className={className}>{inner}</div>;
}

function DropiChip({ status }: { status: DropiStatus }) {
  const meta = DROPI_META[status];
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] uppercase ${meta.classes}`}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

function ConfirmationChip({ status }: { status: ConfirmationStatus }) {
  if (status === "unknown") return null;
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] uppercase ${meta.classes}`}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

function ConfirmationMenu({ chat }: { chat: ChatItem }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const meta = STATUS_META[chat.confirmationStatus];
  const Icon = meta.icon;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const set = async (status: ConfirmationStatus) => {
    setBusy(true);
    try {
      await fetch(`/api/conversations/${chat.id}/confirmation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      setOpen(false);
      location.reload();
    } finally {
      setBusy(false);
    }
  };

  const options: ConfirmationStatus[] = [
    "confirmed",
    "not_confirmed",
    "pending",
    "unknown",
  ];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs uppercase ${meta.classes}`}
        disabled={busy}
      >
        <Icon className="h-3.5 w-3.5" />
        {meta.label}
        {chat.confirmationSource === "manual" && (
          <span className="ml-1 rounded bg-[rgba(8,21,30,0.72)] px-1 text-[9px]">
            manual
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-md border border-[var(--color-border)] bg-[rgba(8,21,30,0.96)] p-1 text-xs shadow-lg">
          {options.map((status) => (
            <button
              key={status}
              onClick={() => set(status)}
              disabled={busy}
              className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-[rgba(18,42,53,0.92)]"
            >
              <ConfirmationChip status={status} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
