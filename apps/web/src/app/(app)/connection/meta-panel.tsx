"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Los dos identificadores de Meta de la operación del riel.
 *
 * `hasAdsToken` no es el token: es si el worker tiene uno. Son dos causas
 * distintas de «no salen anuncios» y se arreglan en lugares distintos —una acá,
 * la otra en el entorno del worker con un despliegue—, así que la pantalla
 * tiene que poder decir cuál de las dos es.
 */
type MetaConfig = {
  operation: string;
  metaAdAccountId: string | null;
  capiDatasetId: string | null;
  hasAdsToken: boolean;
} | null;

type AdsRead =
  | { account: "not_configured" }
  | { account: "no_token" }
  | { account: "unreachable"; adAccountId: string; error: string }
  | {
      account: "connected";
      adAccountId: string;
      ads: Array<{ id: string; name: string; status: string; campaignName: string | null }>;
      truncated: boolean;
    };

/**
 * Conectar Meta para un país: de qué cuenta se leen los anuncios y a qué
 * dataset se reportan las conversiones.
 *
 * **Los dos campos viven juntos aunque los use código muy distinto** —uno la
 * pantalla de catálogo, el otro el reporte de conversiones— porque son el mismo
 * acto de configuración y del mismo país, y porque separarlos en dos pantallas
 * es cómo se llega a una operación con la cuenta puesta y el dataset olvidado.
 *
 * **Guardar acá no enciende nada.** El reporte a Meta lo enciende
 * `META_CAPI_MODE` en el entorno del worker, que es un despliegue y no un clic:
 * un evento de conversión mal formado envenena el aprendizaje de la pauta que
 * el cliente paga y eso no se revierte borrando datos.
 */
export function MetaPanel() {
  const [cfg, setCfg] = useState<MetaConfig>(null);
  const [ads, setAds] = useState<AdsRead | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [adAccount, setAdAccount] = useState("");
  const [dataset, setDataset] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const refresh = useCallback(async () => {
    const [c, a] = await Promise.all([
      fetch("/api/meta/config", { cache: "no-store" }),
      fetch("/api/meta/ads", { cache: "no-store" }),
    ]);
    if (c.ok) {
      const j = (await c.json()) as MetaConfig;
      setCfg(j);
      setAdAccount(j?.metaAdAccountId ?? "");
      setDataset(j?.capiDatasetId ?? "");
    }
    if (a.ok) setAds((await a.json()) as AdsRead);
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
      const r = await fetch("/api/meta/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          metaAdAccountId: adAccount.trim() || null,
          capiDatasetId: dataset.trim() || null,
        }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) {
        setMsg({
          kind: "err",
          text: typeof j.error === "string" ? j.error : "no se pudo guardar",
        });
        return;
      }
      setMsg({ kind: "ok", text: "guardado" });
      await refresh();
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-card w-full max-w-5xl p-4">
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Meta</h2>
          <p className="mt-1 text-sm leading-5 text-[var(--color-text-dim)]">
            De qué cuenta publicitaria se leen los anuncios para el catálogo, y a
            qué dataset se reportan las conversiones de los anuncios de clic a
            WhatsApp. Guardar aquí no enciende el reporte.
          </p>
        </div>

        {loaded && <EstadoDeAnuncios read={ads} hasToken={cfg?.hasAdsToken ?? false} />}

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-[11px] uppercase text-[var(--color-text-dim)]">
              Cuenta publicitaria
            </span>
            <input
              className="app-input w-full"
              placeholder="act_2042265076620189"
              value={adAccount}
              onChange={(e) => setAdAccount(e.target.value)}
              name="meta-ad-account"
              autoComplete="off"
              spellCheck={false}
            />
            <span className="block text-[11px] text-[var(--color-text-dim)]">
              Solo se lee. Habilita elegir el anuncio por su nombre en el
              catálogo, en vez de pegar el ID.
            </span>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[11px] uppercase text-[var(--color-text-dim)]">
              Dataset de conversiones
            </span>
            <input
              className="app-input w-full"
              placeholder="solo números"
              value={dataset}
              onChange={(e) => setDataset(e.target.value)}
              name="meta-capi-dataset"
              autoComplete="off"
              spellCheck={false}
            />
            <span className="block text-[11px] text-[var(--color-text-dim)]">
              <strong>No es el píxel.</strong> Es el dataset de la cuenta de
              WhatsApp — el píxel es un destino real y equivocado, y equivocarse
              no da error ni alarma.
            </span>
          </label>
        </div>

        {msg && (
          <p
            className={`text-sm ${
              msg.kind === "ok" ? "text-[var(--state-auto-fg)]" : "text-[var(--state-escalada-fg)]"
            }`}
          >
            {msg.text}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <button onClick={save} disabled={busy} className="app-button">
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * En qué estado está la lectura de anuncios, con el remedio de cada caso.
 *
 * Los cuatro estados no significan lo mismo ni se arreglan igual, y decirlos
 * como uno solo —«no hay anuncios»— manda al admin al lugar equivocado tres de
 * cuatro veces.
 */
function EstadoDeAnuncios({
  read,
  hasToken,
}: {
  read: AdsRead | null;
  hasToken: boolean;
}) {
  if (!read) return null;

  if (read.account === "not_configured") {
    return (
      <Aviso kind="info">
        No hay cuenta publicitaria configurada para esta operación. Mientras
        tanto, en el catálogo el anuncio se registra pegando su ID — que es el
        camino de respaldo permanente.
      </Aviso>
    );
  }

  if (read.account === "no_token") {
    return (
      <Aviso kind="warn">
        La cuenta está configurada pero el worker no tiene el token de lectura
        (<code>META_ADS_SYSTEM_USER_TOKEN</code>). Se carga en el entorno del
        worker, no aquí: hace falta un despliegue.
      </Aviso>
    );
  }

  if (read.account === "unreachable") {
    return (
      <Aviso kind="err">
        Meta no contestó por <code>{read.adAccountId}</code>: {read.error}
      </Aviso>
    );
  }

  return (
    <Aviso kind="ok">
      {read.ads.length} anuncios leídos de <code>{read.adAccountId}</code>
      {read.truncated && " (recortado al máximo de 500)"}. En el catálogo el
      anuncio ya se puede elegir por su nombre.
      {!hasToken && " (el token no figura en el worker, revisá el entorno)"}
    </Aviso>
  );
}

function Aviso({
  kind,
  children,
}: {
  kind: "ok" | "info" | "warn" | "err";
  children: React.ReactNode;
}) {
  const tone = {
    ok: "border-[color-mix(in_srgb,var(--state-auto-fg)_35%,transparent)] bg-[var(--state-auto-bg)] text-[var(--state-auto-fg)]",
    info: "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-dim)]",
    warn: "border-[color-mix(in_srgb,var(--state-espera-fg)_35%,transparent)] bg-[var(--state-espera-bg)] text-[var(--state-espera-fg)]",
    err: "border-[color-mix(in_srgb,var(--state-escalada-fg)_35%,transparent)] bg-[var(--state-escalada-bg)] text-[var(--state-escalada-fg)]",
  }[kind];
  return (
    <p className={`rounded-lg border p-3 text-sm leading-6 ${tone}`}>{children}</p>
  );
}
