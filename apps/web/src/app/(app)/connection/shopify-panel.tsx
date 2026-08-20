"use client";

import { useCallback, useEffect, useState } from "react";
import { StoreClosings } from "./store-closings";

type ConnectionState = {
  shopDomain: string | null;
  apiVersion: string | null;
  hasToken: boolean;
  /**
   * Con qué clase de credencial está conectada la tienda. **Nunca vuelve el
   * secreto**, solo su forma — que es lo único que la pantalla necesita para
   * saber qué formulario mostrar y qué decir en el detalle.
   */
  credentialKind: CredentialKind;
  /** El client id **sí** vuelve: no es secreto y es lo que identifica la app. */
  clientId: string | null;
  connectedAt: string | null;
  updatedAt: string | null;
} | null;

/**
 * Las dos formas vivas de credencial de Shopify, y la ausencia.
 *
 * No es una preferencia del usuario: **la decide la tienda**. Una tienda vieja
 * emite un `shpat_` fijo; la de Guatemala ya no emite ninguno y solo soporta el
 * modelo del Dev Dashboard, donde se guardan client id y secret y el sistema
 * acuña un token que dura 24 horas. Por eso las dos siguen existiendo en la
 * pantalla: quitar la vieja dejaría sin conectar a una tienda que funciona.
 */
type CredentialKind = "static" | "client_credentials" | "none";

type Capability = {
  capability: string;
  label: string;
  granted: boolean;
  missing: string[];
  missingConsequence: string;
};

type CapabilityReport = {
  granted: string[];
  capabilities: Capability[];
  excess: string[];
};

/**
 * Los tres estados salen del worker con `200` y un campo `store`, no como
 * error: **la tienda sin conectar es el estado normal de hoy** y va a serlo por
 * un buen rato. Tiene que poder explicarse, no verse como un fallo.
 */
type StoreStatus =
  | { store: "not_connected"; writeMode: WriteMode; requestedScopes: string[] }
  | {
      store: "unreachable";
      shopDomain: string;
      writeMode: WriteMode;
      requestedScopes: string[];
      error: string;
    }
  | {
      store: "connected";
      shopDomain: string;
      apiVersion: string;
      shopName: string;
      writeMode: WriteMode;
      requestedScopes: string[];
      productsReadable: number | null;
      productError: string | null;
      capabilities: CapabilityReport | null;
      scopeError: string | null;
    };

type WriteMode = "dry_run" | "live";

export function ShopifyPanel() {
  const [snap, setSnap] = useState<ConnectionState>(null);
  const [status, setStatus] = useState<StoreStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [domain, setDomain] = useState("");
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  // El modelo nuevo por defecto: es el único que soporta una tienda creada hoy,
  // y ofrecer primero el `shpat_` mandaría al admin a buscar en el Dev Dashboard
  // un token que ya no existe.
  const [credKind, setCredKind] = useState<Exclude<CredentialKind, "none">>(
    "client_credentials",
  );
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const refresh = useCallback(async () => {
    const [conn, st] = await Promise.all([
      fetch("/api/shopify/connection", { cache: "no-store" }),
      fetch("/api/shopify/store-status", { cache: "no-store" }),
    ]);
    if (conn.ok) {
      const j = (await conn.json()) as ConnectionState;
      setSnap(j);
      if (j?.shopDomain) setDomain(j.shopDomain);
      if (j?.clientId) setClientId(j.clientId);
      if (j?.credentialKind && j.credentialKind !== "none") {
        setCredKind(j.credentialKind);
      }
    }
    if (st.ok) setStatus((await st.json()) as StoreStatus);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await refresh();
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [refresh]);

  const save = async () => {
    setMsg(null);
    setBusy(true);
    try {
      const r = await fetch("/api/shopify/connection", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          credKind === "static"
            ? { shopDomain: domain.trim(), adminAccessToken: token.trim() }
            : {
                shopDomain: domain.trim(),
                clientId: clientId.trim(),
                clientSecret: clientSecret.trim(),
              },
        ),
      });
      const j = (await r.json()) as { ok?: boolean; shopName?: string; error?: string };
      if (!r.ok || !j.ok) {
        setMsg({
          kind: "err",
          text: typeof j.error === "string" ? j.error : "no se pudo conectar",
        });
        return;
      }
      setMsg({ kind: "ok", text: `conectado a "${j.shopName ?? domain}"` });
      setToken("");
      setClientSecret("");
      setEditing(false);
      await refresh();
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : "error" });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("¿Desconectar Shopify? El agente perderá el contexto del producto.")) return;
    setBusy(true);
    try {
      await fetch("/api/shopify/connection", { method: "DELETE" });
      setSnap(null);
      setStatus(null);
      setDomain("");
      setToken("");
      setEditing(false);
      setMsg({ kind: "ok", text: "desconectado" });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const connected = Boolean(snap?.hasToken);
  /**
   * **Siempre hace falta la credencial entera, también al editar.**
   *
   * El formulario decía «déjalo vacío para mantener el actual» y era mentira:
   * el worker rechaza una conexión sin credencial y devuelve `400`. Guardar
   * medio par —client id nuevo con el secret viejo— es peor todavía: se
   * guardaría una credencial que no acuña nada, y el fallo aparecería en el
   * primer cierre, no acá.
   */
  const credencialCompleta =
    credKind === "static"
      ? token.trim().length > 0
      : clientId.trim().length > 0 && clientSecret.trim().length > 0;

  return (
    <div className="app-card w-full max-w-5xl p-4">
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Conexión de Shopify</h2>
          <p className="mt-1 text-sm leading-5 text-[var(--color-text-dim)]">
            El agente usa la descripción de tus productos para responder
            preguntas específicas, y es por aquí por donde el vendedor deja los
            pedidos que cierra.
          </p>
        </div>

        {loaded && !connected && !editing && <NotConnected />}

        {loaded && connected && !editing && (
          <div className="space-y-3">
            <div className="rounded-lg border border-emerald-400/25 bg-emerald-500/10 p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/25 text-emerald-200">
                  ✓
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs uppercase tracking-wide text-emerald-300/80">
                    Conectado
                  </p>
                  <p className="truncate text-sm font-semibold text-[var(--color-text)]">
                    {snap?.shopDomain}
                  </p>
                  <div className="mt-2 grid gap-x-6 gap-y-1 text-xs text-[var(--color-text-dim)] sm:grid-cols-2">
                    <DetailRow label="API version" value={snap?.apiVersion ?? "—"} />
                    <DetailRow
                      label="Credencial"
                      value={
                        snap?.credentialKind === "client_credentials"
                          ? `app del Dev Dashboard · ${snap.clientId ?? "sin id"}`
                          : "token de app privada · •••••• guardado"
                      }
                    />
                    {snap?.credentialKind === "client_credentials" && (
                      <DetailRow
                        label="Token"
                        value="se acuña solo · dura 24 h"
                      />
                    )}
                    {snap?.connectedAt && (
                      <DetailRow
                        label="Conectado el"
                        value={new Date(snap.connectedAt).toLocaleString()}
                      />
                    )}
                    {snap?.updatedAt && (
                      <DetailRow
                        label="Actualizado"
                        value={new Date(snap.updatedAt).toLocaleString()}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {status?.store === "unreachable" && (
              <Aviso kind="err">
                La conexión está guardada pero la tienda no contestó:{" "}
                {status.error}
              </Aviso>
            )}

            {status?.store === "connected" && (
              <>
                <WriteModeBadge mode={status.writeMode} />
                <Capabilities
                  report={status.capabilities}
                  scopeError={status.scopeError}
                />
              </>
            )}

            {msg && <Aviso kind={msg.kind}>{msg.text}</Aviso>}

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => {
                  setEditing(true);
                  setMsg(null);
                }}
                className="app-button-secondary"
              >
                Editar
              </button>
              <button
                onClick={disconnect}
                disabled={busy}
                className="app-button-secondary border-red-500/25 text-red-100 hover:bg-red-950/30"
              >
                Desconectar
              </button>
            </div>
          </div>
        )}

        {loaded && (!connected || editing) && (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-[11px] uppercase text-[var(--color-text-soft)]">
                  Dominio de la tienda
                </span>
                <input
                  className="app-input w-full"
                  placeholder="mitienda.myshopify.com"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  name="shopify-shop-domain"
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  spellCheck={false}
                />
              </label>
              {credKind === "static" ? (
                <label className="space-y-1 text-sm">
                  <span className="text-[11px] uppercase text-[var(--color-text-soft)]">
                    Admin API access token
                  </span>
                  <input
                    className="app-input w-full"
                    placeholder="shpat_..."
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    name="shopify-admin-token"
                    autoComplete="new-password"
                    data-1p-ignore
                    data-lpignore="true"
                    spellCheck={false}
                  />
                </label>
              ) : (
                <>
                  <label className="space-y-1 text-sm">
                    <span className="text-[11px] uppercase text-[var(--color-text-soft)]">
                      Client ID
                    </span>
                    <input
                      className="app-input w-full"
                      placeholder="55da1fc1b0b8..."
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      name="shopify-client-id"
                      autoComplete="off"
                      data-1p-ignore
                      data-lpignore="true"
                      spellCheck={false}
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-[11px] uppercase text-[var(--color-text-soft)]">
                      Client secret
                    </span>
                    <input
                      className="app-input w-full"
                      placeholder="shpss_..."
                      type="password"
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      name="shopify-client-secret"
                      autoComplete="new-password"
                      data-1p-ignore
                      data-lpignore="true"
                      spellCheck={false}
                    />
                  </label>
                </>
              )}
            </div>

            <ElegirCredencial value={credKind} onChange={setCredKind} />

            <ScopesHelp />

            {msg && <Aviso kind={msg.kind}>{msg.text}</Aviso>}

            <div className="flex flex-wrap gap-3">
              <button
                onClick={save}
                disabled={busy || !domain || !credencialCompleta}
                className="app-button"
              >
                {busy ? "Verificando…" : connected ? "Actualizar" : "Conectar"}
              </button>
              {editing && connected && (
                <button
                  onClick={() => {
                    setEditing(false);
                    setToken("");
                    setClientSecret("");
                    setClientId(snap?.clientId ?? "");
                    setDomain(snap?.shopDomain ?? "");
                    setMsg(null);
                  }}
                  className="app-button-secondary"
                  disabled={busy}
                >
                  Cancelar
                </button>
              )}
            </div>
          </>
        )}

        <StoreClosings />
      </div>
    </div>
  );
}

/**
 * El estado que el usuario va a ver primero, y por bastante tiempo.
 *
 * No es un error y no se dibuja como uno: es una tarea pendiente con
 * consecuencias concretas. Decir «no conectado» a secas dejaría al admin sin
 * saber qué deja de funcionar — y lo que deja de funcionar es lo más caro del
 * sistema: una venta cerrada no aterriza en ninguna parte.
 */
function NotConnected() {
  return (
    <div className="rounded-lg border border-amber-400/25 bg-amber-500/10 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-200">
          !
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs uppercase tracking-wide text-amber-300/80">
            La tienda no está conectada
          </p>
          <p className="text-sm leading-6 text-[var(--color-text)]">
            El sistema sigue recibiendo los pedidos que entran por la tienda —
            eso va por webhook y no depende de esto. Lo que no puede hacer
            todavía es <span className="font-semibold">escribir</span> en ella.
          </p>
          <ul className="space-y-1 text-sm leading-6 text-[var(--color-text-dim)]">
            <li>
              • El vendedor conversa <span className="italic">sin</span> la ficha
              de tus productos.
            </li>
            <li>
              • Una venta que se cierre en el chat{" "}
              <span className="font-semibold text-[var(--color-text)]">
                no se convierte en pedido
              </span>
              : queda guardada con sus datos en la lista de abajo y el equipo
              recibe una alerta.
            </li>
          </ul>
          <p className="text-sm leading-6 text-[var(--color-text-dim)]">
            Para conectarla hacen falta las credenciales de la app de Shopify —
            el client id y el secret del Dev Dashboard, o un token fijo si la
            tienda es de las viejas. Pégalas aquí abajo y se verifican{" "}
            <span className="italic">leyendo</span>, sin escribir nada.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * El interruptor de escritura, a la vista.
 *
 * Arranca apagado, y que se vea importa: apagado significa que un cierre no
 * crea pedidos de verdad, y alguien mirando la lista de cierres pendientes
 * tiene que poder entender por qué está vacía o por qué nada llega a la tienda.
 */
function WriteModeBadge({ mode }: { mode: WriteMode }) {
  const seco = mode === "dry_run";
  return (
    <div
      className={`rounded-lg border p-3 text-sm leading-6 ${
        seco
          ? "border-amber-400/25 bg-amber-500/10"
          : "border-emerald-400/25 bg-emerald-500/10"
      }`}
    >
      <span className="font-semibold">
        {seco ? "Modo seco: no se crean pedidos" : "Creación de pedidos activa"}
      </span>
      <span className="ml-2 text-[var(--color-text-dim)]">
        {seco
          ? "El vendedor arma el pedido y lo registra en el log, pero no escribe nada en tu tienda. Es el valor por defecto."
          : "Un cierre crea el pedido de verdad en tu tienda."}
      </span>
    </div>
  );
}

/**
 * Elegir con qué se conecta la tienda.
 *
 * Está **debajo** de los campos y no arriba a propósito: el caso abrumadoramente
 * más común es el modelo nuevo, que ya viene elegido, y poner primero una
 * pregunta que casi nadie tiene que contestar convierte conectar una tienda en
 * un examen. Quien tiene una tienda vieja va a buscar el otro camino; quien no,
 * ni lo mira.
 */
function ElegirCredencial({
  value,
  onChange,
}: {
  value: "static" | "client_credentials";
  onChange: (v: "static" | "client_credentials") => void;
}) {
  return (
    <p className="text-[11px] leading-relaxed text-[var(--color-text-dim)]">
      {value === "client_credentials" ? (
        <>
          La app se creó en el <strong>Dev Dashboard</strong>: el token de
          administración no es fijo, se pide con el client id y el secret y se
          renueva solo cada 24 horas.{" "}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-[var(--color-text)]"
            onClick={() => onChange("static")}
          >
            Tengo un token fijo (shpat_)
          </button>
        </>
      ) : (
        <>
          Token fijo de <strong>app privada</strong>: se pega una vez y no vence.
          Las tiendas creadas desde 2025 ya no emiten ninguno.{" "}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-[var(--color-text)]"
            onClick={() => onChange("client_credentials")}
          >
            Tengo client id y secret
          </button>
        </>
      )}
    </p>
  );
}

/** Qué habilitó el token, con lo que se pierde por cada permiso que falta. */
function Capabilities({
  report,
  scopeError,
}: {
  report: CapabilityReport | null;
  scopeError: string | null;
}) {
  if (!report) {
    return (
      <p className="text-xs leading-5 text-[var(--color-text-dim)]">
        No se pudieron leer los permisos del token
        {scopeError ? ` (${scopeError})` : ""}. Eso no significa que falten:
        significa que no se pudo mirar.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-soft)]">
        Qué permite este token
      </p>
      <ul className="space-y-1 text-sm leading-6">
        {report.capabilities.map((c) => (
          <li key={c.capability} className="flex items-start gap-2">
            <span className={c.granted ? "text-emerald-300" : "text-red-300"}>
              {c.granted ? "✓" : "✗"}
            </span>
            <span className="min-w-0">
              <span className="text-[var(--color-text)]">{c.label}</span>
              {!c.granted && (
                <span className="text-[var(--color-text-dim)]">
                  {" "}
                  — falta{" "}
                  <code className="rounded bg-[rgba(8,21,30,0.72)] px-1">
                    {c.missing.join(", ")}
                  </code>
                  . {c.missingConsequence}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {report.excess.length > 0 && (
        <p className="text-xs leading-5 text-[var(--color-text-dim)]">
          El token concede además{" "}
          <code className="rounded bg-[rgba(8,21,30,0.72)] px-1">
            {report.excess.join(", ")}
          </code>
          , que este sistema no necesita. No molesta, pero es capacidad de más
          sobre tu tienda.
        </p>
      )}
    </div>
  );
}

/** Los permisos que hay que marcar, y para qué sirve cada uno. */
function ScopesHelp() {
  return (
    <div className="space-y-2 text-xs leading-5 text-[var(--color-text-dim)]">
      <p>
        Crea una <span className="font-medium">custom app</span> en Shopify Admin
        → Settings → Apps → Develop apps, y otorga{" "}
        <span className="font-medium">exactamente</span> estos permisos:
      </p>
      <ul className="space-y-1">
        <li>
          <code className="rounded bg-[rgba(8,21,30,0.72)] px-1">read_products</code>{" "}
          — para que el vendedor conteste con la ficha real de tus productos.
        </li>
        <li>
          <code className="rounded bg-[rgba(8,21,30,0.72)] px-1">read_orders</code>{" "}
          — para comprobar que un cierre no cree dos veces el mismo pedido.
        </li>
        <li>
          <code className="rounded bg-[rgba(8,21,30,0.72)] px-1">write_orders</code>{" "}
          — para crear el pedido de una venta cerrada en el chat.
        </li>
      </ul>
      <p>
        No hacen falta más. Cada permiso extra es capacidad de escritura sobre tu
        tienda que nadie va a usar.
      </p>
    </div>
  );
}

function Aviso({
  kind,
  children,
}: {
  kind: "ok" | "err";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border p-3 text-sm ${
        kind === "ok"
          ? "border-emerald-400/18 bg-emerald-500/10"
          : "border-red-500/25 bg-red-950/20 text-red-100"
      }`}
    >
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-soft)]">
        {label}
      </span>
      <span className="truncate text-[var(--color-text)]">{value}</span>
    </div>
  );
}
