"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Link2,
  Plus,
  Search,
  Store,
  Trash2,
  X,
} from "lucide-react";
import type { CatalogRow, CatalogView } from "@/lib/catalogo";

/**
 * El catálogo: tabla densa con el origen **como columna**.
 *
 * La forma la cerró el nivel 2 del árbol de diseño con el usuario y su razón no
 * fue el catálogo de hoy sino el de mañana: 17 productos caben en cualquier
 * cosa; la tabla es la que sigue funcionando cuando sean 60. No cambiarla por
 * algo más vistoso mirando el catálogo actual.
 *
 * Se descartó explícitamente partir la lista en dos secciones —tienda arriba,
 * panel abajo—: el error no se comete mirando la lista sino al abrir e intentar
 * editar, y ahí lo ataja el aviso de solo lectura de la ficha. Partirla rompería
 * el orden por volumen, que es como Vorare piensa su catálogo.
 *
 * Buscar, filtrar y ordenar corren **en el navegador** y no en la URL, al revés
 * que la tabla de pedidos: son 17 filas y serán decenas, así que traerlas todas
 * es correcto y el filtro no necesita ir al servidor. Si el catálogo creciera a
 * miles, esto es lo que cambia.
 */

type SortKey = "nombre" | "anuncios" | "origen" | "agregado";
type ColumnKey = "origen" | "anuncios" | "precio" | "agregado";

const FILTERS = [
  { k: "src:shopify", label: "Origen: Tienda", test: (r: CatalogRow) => r.source === "shopify" },
  { k: "src:native", label: "Origen: Panel", test: (r: CatalogRow) => r.source === "native" },
  { k: "ads:none", label: "Sin anuncios", test: (r: CatalogRow) => r.ads.length === 0 },
  { k: "ads:some", label: "Con anuncios", test: (r: CatalogRow) => r.ads.length > 0 },
  {
    k: "ads:shared",
    label: "Con anuncio compartido",
    test: (r: CatalogRow) => r.ads.some((a) => a.alsoPointsTo.length > 0),
  },
] as const;

const SORTS: Array<{ k: SortKey; label: string }> = [
  { k: "nombre", label: "Nombre" },
  { k: "anuncios", label: "Anuncios" },
  { k: "origen", label: "Origen" },
  { k: "agregado", label: "Agregado" },
];

const COLUMNS: Array<{ k: ColumnKey; label: string }> = [
  { k: "origen", label: "Origen" },
  { k: "anuncios", label: "Anuncios" },
  { k: "precio", label: "Precio" },
  { k: "agregado", label: "Agregado" },
];

function fecha(iso: string): string {
  return new Date(iso).toLocaleDateString("es", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

export function CatalogoClient({ view }: { view: CatalogView }) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());

  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<string[]>([]);
  const [sort, setSort] = useState<{ k: SortKey; dir: "asc" | "desc" }>({
    k: "anuncios",
    dir: "desc",
  });
  const [cols, setCols] = useState<Record<ColumnKey, boolean>>({
    origen: true,
    anuncios: true,
    precio: true,
    agregado: true,
  });
  const [menu, setMenu] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(
    view.rows[0]?.id ?? null,
  );
  const [alta, setAlta] = useState<"native" | "shopify" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Tras un alta o un borrado el servidor manda filas nuevas: la selección
    // tiene que seguir existiendo.
    if (selected && !view.rows.some((r) => r.id === selected)) {
      setSelected(view.rows[0]?.id ?? null);
    }
    setPicked((p) => p.filter((id) => view.rows.some((r) => r.id === id)));
  }, [view.rows, selected]);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = view.rows;
    if (term) {
      // Buscar por nombre **o por id de anuncio**: pegar el id que aparece en
      // el administrador de anuncios y ver a qué producto llega es la consulta
      // que el admin hace de verdad.
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(term) ||
          (r.shopifyProductId ?? "").toLowerCase().includes(term) ||
          r.ads.some((a) => a.adId.includes(term)),
      );
    }
    for (const key of filters) {
      const f = FILTERS.find((x) => x.k === key);
      if (f) list = list.filter(f.test);
    }
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sort.k) {
        case "anuncios":
          return (a.ads.length - b.ads.length) * dir || a.name.localeCompare(b.name);
        case "origen":
          return a.source.localeCompare(b.source) * dir || a.name.localeCompare(b.name);
        case "agregado":
          return (Date.parse(a.createdAt) - Date.parse(b.createdAt)) * dir;
        default:
          return a.name.localeCompare(b.name) * dir;
      }
    });
  }, [view.rows, q, filters, sort]);

  const ficha = view.rows.find((r) => r.id === selected) ?? null;
  const filtrado = visible.length !== view.rows.length;

  function toggleFilter(k: string) {
    setFilters((f) => (f.includes(k) ? f.filter((x) => x !== k) : [...f, k]));
  }

  return (
    <div className="space-y-3">
      <SenalDeReferencias signal={view.signal} />
      {error ? (
        <div className="app-card border-[var(--color-danger)] px-3 py-2 text-xs text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          className="app-button-secondary gap-2"
          onClick={() => setAlta(alta === "shopify" ? null : "shopify")}
        >
          <Store className="h-4 w-4" />
          Conectar de la tienda
        </button>
        <button
          className="app-button gap-2"
          onClick={() => setAlta(alta === "native" ? null : "native")}
        >
          <Plus className="h-4 w-4" />
          Crear producto
        </button>
      </div>

      {alta === "native" ? (
        <AltaNativo
          onDone={() => {
            setAlta(null);
            refresh();
          }}
          onError={setError}
        />
      ) : null}
      {alta === "shopify" ? (
        <ConectarDeLaTienda
          store={view.store}
          yaConectados={view.rows
            .map((r) => r.shopifyProductId)
            .filter((id): id is string => Boolean(id))}
          onDone={() => {
            setAlta(null);
            refresh();
          }}
          onError={setError}
        />
      ) : null}

      <div className="grid items-start gap-3 xl:grid-cols-[1fr_360px]">
        <div className="app-card overflow-hidden">
          {/* ── barra: buscar · filtrar · ordenar · columnas ─────────── */}
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] p-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-soft)]" />
              <input
                className="app-input pl-7"
                placeholder="Buscar producto o ID de anuncio"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            <Menu
              id="filtrar"
              open={menu === "filtrar"}
              onOpen={setMenu}
              label="Filtrar"
              count={filters.length}
            >
              {FILTERS.map((f) => (
                <MenuItem
                  key={f.k}
                  on={filters.includes(f.k)}
                  onClick={() => toggleFilter(f.k)}
                >
                  {f.label}
                </MenuItem>
              ))}
            </Menu>

            <Menu
              id="ordenar"
              open={menu === "ordenar"}
              onOpen={setMenu}
              label={`Ordenar: ${SORTS.find((s) => s.k === sort.k)?.label ?? ""}`}
            >
              {SORTS.map((s) => (
                <MenuItem
                  key={s.k}
                  on={sort.k === s.k}
                  onClick={() => setSort((v) => ({ ...v, k: s.k }))}
                >
                  {s.label}
                </MenuItem>
              ))}
              <div className="px-3 py-1 text-[10px] uppercase text-[var(--color-text-soft)]">
                Dirección
              </div>
              <MenuItem
                on={sort.dir === "desc"}
                onClick={() => setSort((v) => ({ ...v, dir: "desc" }))}
              >
                Descendente
              </MenuItem>
              <MenuItem
                on={sort.dir === "asc"}
                onClick={() => setSort((v) => ({ ...v, dir: "asc" }))}
              >
                Ascendente
              </MenuItem>
            </Menu>

            <Menu id="columnas" open={menu === "columnas"} onOpen={setMenu} label="Columnas">
              {COLUMNS.map((c) => (
                <MenuItem
                  key={c.k}
                  on={cols[c.k]}
                  onClick={() => setCols((v) => ({ ...v, [c.k]: !v[c.k] }))}
                >
                  {c.label}
                </MenuItem>
              ))}
            </Menu>
          </div>

          {/* ── los filtros activos, como chips removibles ───────────── */}
          {filters.length > 0 || q ? (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--color-border)] px-2 py-1.5">
              {q ? (
                <Chip onRemove={() => setQ("")}>Busca «{q}»</Chip>
              ) : null}
              {filters.map((k) => (
                <Chip key={k} onRemove={() => toggleFilter(k)}>
                  {FILTERS.find((f) => f.k === k)?.label ?? k}
                </Chip>
              ))}
              <button
                className="ml-1 text-[11px] text-[var(--color-text-soft)] underline underline-offset-2 hover:text-[var(--color-text)]"
                onClick={() => {
                  setFilters([]);
                  setQ("");
                }}
              >
                Limpiar
              </button>
            </div>
          ) : null}

          {/* ── selección múltiple: el camino corto del N:M ──────────── */}
          {picked.length > 0 ? (
            <AsociarAVarios
              picked={picked}
              onDone={() => {
                setPicked([]);
                refresh();
              }}
              onClear={() => setPicked([])}
              onError={setError}
            />
          ) : null}

          {view.rows.length === 0 ? (
            <VacioTotal operacion={view.operation.name} />
          ) : visible.length === 0 ? (
            <div className="px-3 py-10 text-center">
              <p className="text-sm font-medium">Ningún producto coincide</p>
              <p className="app-muted mt-1 text-xs">
                Quitá algún filtro para ver el resto del catálogo.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="app-table">
                <thead>
                  <tr>
                    <th className="w-8" />
                    <th>Producto</th>
                    {cols.origen ? <th>Origen</th> : null}
                    {cols.anuncios ? <th>Anuncios</th> : null}
                    {cols.precio ? <th>Precio</th> : null}
                    {cols.agregado ? <th>Agregado</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setSelected(r.id)}
                      className={`cursor-pointer transition hover:bg-[rgba(18,35,48,0.6)] ${
                        selected === r.id ? "bg-[rgba(18,35,48,0.9)]" : ""
                      }`}
                    >
                      <td
                        className="align-middle"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPicked((p) =>
                            p.includes(r.id)
                              ? p.filter((x) => x !== r.id)
                              : [...p, r.id],
                          );
                        }}
                      >
                        <span
                          className={`flex h-4 w-4 items-center justify-center rounded border ${
                            picked.includes(r.id)
                              ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[#04121a]"
                              : "border-[var(--color-border-strong)]"
                          }`}
                        >
                          {picked.includes(r.id) ? (
                            <Check className="h-3 w-3" strokeWidth={3} />
                          ) : null}
                        </span>
                      </td>
                      <td>
                        <div className="font-medium text-[var(--color-text)]">
                          {r.name}
                        </div>
                        <div className="app-muted text-[11px]">
                          {r.nameSource === "tienda"
                            ? "nombre leído de la tienda"
                            : r.nameSource === "panel"
                              ? "creado en el panel"
                              : "no se pudo leer el nombre de la tienda"}
                        </div>
                      </td>
                      {cols.origen ? (
                        <td className="align-middle">
                          <OrigenPill source={r.source} />
                        </td>
                      ) : null}
                      {cols.anuncios ? (
                        <td className="align-middle">
                          {r.ads.length === 0 ? (
                            <span className="app-pill border-[rgba(248,113,113,0.4)] bg-[rgba(248,113,113,0.12)] text-[var(--color-danger)]">
                              sin anuncios
                            </span>
                          ) : (
                            <span className="text-[var(--color-text)]">
                              {r.ads.length}
                              {r.ads.some((a) => a.alsoPointsTo.length > 0) ? (
                                <span className="app-muted ml-1 text-[11px]">
                                  · compartido
                                </span>
                              ) : null}
                            </span>
                          )}
                        </td>
                      ) : null}
                      {cols.precio ? (
                        <td className="app-muted align-middle text-[12px]">
                          {r.price ?? "—"}
                        </td>
                      ) : null}
                      {cols.agregado ? (
                        <td className="app-muted align-middle text-[12px]">
                          {fecha(r.createdAt)}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── total y estado del filtro, al pie ────────────────────── */}
          {view.rows.length > 0 ? (
            <div className="flex items-center gap-2 border-t border-[var(--color-border)] px-3 py-2 text-[11px] text-[var(--color-text-soft)]">
              <span>
                {visible.length} de {view.rows.length} producto
                {view.rows.length === 1 ? "" : "s"}
                {filtrado ? " · filtrado" : ""}
              </span>
              <span className="ml-auto">
                {view.rows.filter((r) => r.ads.length === 0).length} sin anuncios
              </span>
            </div>
          ) : null}
        </div>

        <Ficha
          row={ficha}
          store={view.store}
          onChanged={refresh}
          onError={setError}
        />
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   La señal que impide que el módulo esté muerto y se vea sano
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Registrar no es reconocer.
 *
 * El registro llena el mapa; el reconocimiento hace lo contrario —toma el id de
 * anuncio del mensaje entrante y lo busca ahí—. **Si la referencia no llega, el
 * mapa queda perfecto y nunca se consulta**: la pantalla se ve completa y
 * correcta, y no pasa nada. Esta banda es lo único que lo hace visible.
 */
function SenalDeReferencias({ signal }: { signal: CatalogView["signal"] }) {
  const tono =
    signal.health === "el_mapa_se_esta_consultando"
      ? "border-[rgba(110,231,183,0.35)] bg-[rgba(110,231,183,0.08)]"
      : "border-[rgba(244,193,109,0.35)] bg-[rgba(244,193,109,0.08)]";

  const titulo =
    signal.health === "el_mapa_se_esta_consultando"
      ? `Llegaron ${signal.clicksInWindow} clics de anuncio en los últimos ${signal.windowDays} días · ${signal.registeredClicksInWindow} de anuncios registrados`
      : signal.health === "llegan_clics_sin_registrar"
        ? `Llegaron ${signal.clicksInWindow} clics de anuncio y ninguno estaba registrado acá`
        : signal.health === "sin_clics_en_la_ventana"
          ? `Ningún clic de anuncio en los últimos ${signal.windowDays} días`
          : "Nunca llegó una referencia de anuncio al panel";

  const cuerpo =
    signal.health === "el_mapa_se_esta_consultando"
      ? "El mapa se está consultando: los leads que hacen clic llegan con su anuncio y el reconocimiento lo encuentra."
      : signal.health === "llegan_clics_sin_registrar"
        ? "Los leads llegan con su anuncio, pero ninguno de esos identificadores está en el catálogo: el reconocimiento tiene que adivinar. Registrar esos anuncios lo resuelve."
        : signal.health === "sin_clics_en_la_ventana"
          ? "Hubo clics antes, así que la captura funciona. Puede ser que la pauta esté pausada."
          : `De ${signal.conversations.toLocaleString("es")} conversaciones, ninguna trajo referencia de anuncio. Registrar anuncios acá no sirve de nada hasta que la pauta apunte al número que escucha el panel: hoy va a otra WhatsApp Business, y los dos números se unifican después. Mientras tanto el catálogo puede verse completo y no reconocer a nadie.`;

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${tono}`}>
      <p className="text-xs font-semibold text-[var(--color-text)]">{titulo}</p>
      <p className="app-muted mt-1 text-[11px] leading-relaxed">{cuerpo}</p>
      <p className="mt-1 text-[10px] text-[var(--color-text-soft)]">
        {signal.registeredAds} anuncio{signal.registeredAds === 1 ? "" : "s"} registrado
        {signal.registeredAds === 1 ? "" : "s"} · {signal.clicksAllTime} clic
        {signal.clicksAllTime === 1 ? "" : "s"} recibidos desde siempre
        {signal.lastClickAt ? ` · último ${fecha(signal.lastClickAt)}` : ""}
      </p>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   La ficha
   ──────────────────────────────────────────────────────────────────────── */

function Ficha({
  row,
  store,
  onChanged,
  onError,
}: {
  row: CatalogRow | null;
  store: CatalogView["store"];
  onChanged: () => void;
  onError: (m: string | null) => void;
}) {
  const [desc, setDesc] = useState(row?.description ?? "");
  const [nombre, setNombre] = useState(row?.name ?? "");
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const idRef = useRef<string | null>(row?.id ?? null);

  useEffect(() => {
    if (idRef.current !== (row?.id ?? null)) {
      idRef.current = row?.id ?? null;
      setDesc(row?.description ?? "");
      setNombre(row?.name ?? "");
      setGuardado(false);
    }
  }, [row]);

  if (!row) {
    return (
      <div className="app-card px-3 py-10 text-center">
        <p className="app-muted text-xs">Elegí un producto para ver su ficha.</p>
      </div>
    );
  }

  const editable = row.source === "native";

  async function guardar() {
    if (!row) return;
    setGuardando(true);
    onError(null);
    try {
      const r = await fetch(`/api/catalogo/productos/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: nombre, description: desc }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "no se pudo guardar");
      setGuardado(true);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  }

  async function borrar() {
    if (!row) return;
    onError(null);
    const r = await fetch(`/api/catalogo/productos/${row.id}`, {
      method: "DELETE",
    });
    if (!r.ok) {
      const j = (await r.json()) as { error?: string };
      onError(j.error ?? "no se pudo borrar");
      return;
    }
    onChanged();
  }

  return (
    <div className="app-card space-y-3 p-3">
      <div>
        <div className="flex items-start gap-2">
          <h2 className="flex-1 text-sm font-semibold leading-snug text-[var(--color-text)]">
            {row.name}
          </h2>
          <OrigenPill source={row.source} />
        </div>
        {row.price ? (
          <p className="app-muted mt-1 text-xs">{row.price}</p>
        ) : null}
      </div>

      {row.source === "shopify" ? (
        <div className="rounded-md border border-[rgba(157,187,210,0.28)] bg-[rgba(18,35,48,0.9)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--color-text-dim)]">
          {store.store === "connected" ? (
            <>
              Este producto vive en <strong>{store.shopDomain}</strong>. Nombre,
              descripción y precio se leen de ahí cada vez que se usan — editarlos
              allá se refleja acá.{" "}
              <strong className="text-[var(--color-text)]">
                El panel no escribe sobre la tienda.
              </strong>
            </>
          ) : (
            <>
              Este producto está conectado a la tienda, pero{" "}
              <strong className="text-[var(--color-text)]">
                {store.store === "not_connected"
                  ? "la tienda no está conectada"
                  : "no se pudo leer la tienda"}
              </strong>
              : su nombre y su descripción no se pueden mostrar. El identificador
              guardado es <code className="text-[11px]">{row.shopifyProductId}</code>.
            </>
          )}
        </div>
      ) : null}

      <section className="space-y-1.5">
        <h3 className="app-eyebrow">
          {editable ? "Información · editable acá" : "Información · de la tienda"}
        </h3>
        {editable ? (
          <>
            <input
              className="app-input"
              value={nombre}
              onChange={(e) => {
                setNombre(e.target.value);
                setGuardado(false);
              }}
              placeholder="Nombre del producto"
            />
            <textarea
              className="app-textarea"
              rows={4}
              value={desc}
              onChange={(e) => {
                setDesc(e.target.value);
                setGuardado(false);
              }}
              placeholder="Descripción que el vendedor usa al hablar del producto"
            />
            <div className="flex items-center gap-2">
              <button
                className="app-button"
                onClick={guardar}
                disabled={guardando || !nombre.trim()}
              >
                {guardando ? "Guardando…" : "Guardar"}
              </button>
              {guardado ? (
                <span className="text-[11px] text-[var(--color-accent)]">
                  Guardado
                </span>
              ) : null}
              <button
                className="app-button-secondary ml-auto gap-1.5 text-[var(--color-danger)]"
                onClick={borrar}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Quitar
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="app-muted whitespace-pre-line text-xs leading-relaxed">
              {row.description || "Sin descripción en la tienda."}
            </p>
            <button
              className="app-button-secondary gap-1.5 text-[var(--color-danger)]"
              onClick={borrar}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Desconectar del catálogo
            </button>
          </>
        )}
      </section>

      <Anuncios row={row} onChanged={onChanged} onError={onError} />
    </div>
  );
}

/**
 * Los anuncios que apuntan a este producto.
 *
 * Dos cosas de acá son criterio y no adorno:
 *
 * 1. **El anuncio compartido dice a qué otros productos apunta.** Desde la ficha
 *    de un producto un anuncio N:M parece exclusivo, y no lo es.
 * 2. **Un producto sin anuncios no es «incompleto»: es una fuga de
 *    reconocimiento**, y se dice con su consecuencia. Es la única parte del
 *    panel que explica por qué existe registrar anuncios; sin eso, cargar ids
 *    parece burocracia y el cliente deja de hacerlo.
 */
function Anuncios({
  row,
  onChanged,
  onError,
}: {
  row: CatalogRow;
  onChanged: () => void;
  onError: (m: string | null) => void;
}) {
  const [adId, setAdId] = useState("");
  const [busy, setBusy] = useState(false);

  async function agregar() {
    const id = adId.trim();
    if (!id) return;
    setBusy(true);
    onError(null);
    try {
      const r = await fetch("/api/catalogo/anuncios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ adId: id, productIds: [row.id] }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "no se pudo registrar el anuncio");
      setAdId("");
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function quitar(id: string) {
    onError(null);
    await fetch("/api/catalogo/anuncios", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ adId: id, productId: row.id }),
    });
    onChanged();
  }

  return (
    <section className="space-y-2 border-t border-[var(--color-border)] pt-3">
      <h3 className="app-eyebrow">
        Anuncios que apuntan acá · {row.ads.length}
      </h3>

      <div className="flex gap-1.5">
        <input
          className="app-input"
          placeholder="Pegá el ID del anuncio"
          value={adId}
          onChange={(e) => setAdId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") agregar();
          }}
        />
        <button className="app-button shrink-0" onClick={agregar} disabled={busy}>
          Agregar
        </button>
      </div>

      <CuentaPublicitariaSinConectar />

      {row.ads.length === 0 ? (
        <div className="rounded-md border border-[rgba(248,113,113,0.35)] bg-[rgba(248,113,113,0.08)] px-2.5 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-danger)]">
            <AlertTriangle className="h-3.5 w-3.5" />
            Los leads de este producto no se van a reconocer.
          </p>
          <p className="app-muted mt-1 text-[11px] leading-relaxed">
            Sin un anuncio registrado, el reconocimiento tiene que adivinar entre
            los nombres casi idénticos del catálogo — y ahí está el grueso del
            volumen. Registrar el ID lo resuelve para siempre.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {row.ads.map((ad) => (
            <div
              key={ad.adId}
              className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border px-2 py-1.5 ${
                ad.alsoPointsTo.length > 0
                  ? "border-[rgba(244,193,109,0.35)] bg-[rgba(244,193,109,0.07)]"
                  : "border-[var(--color-border)] bg-[rgba(18,35,48,0.6)]"
              }`}
            >
              <span className="font-mono text-[12px] font-semibold text-[var(--color-text)]">
                {ad.adId}
              </span>
              {ad.alsoPointsTo.length > 0 ? (
                <span className="text-[11px] text-[var(--color-highlight)]">
                  · también apunta a{" "}
                  {ad.alsoPointsTo.map((p) => p.name).join(", ")}
                </span>
              ) : null}
              <button
                className="ml-auto text-[var(--color-text-soft)] hover:text-[var(--color-danger)]"
                onClick={() => quitar(ad.adId)}
                aria-label={`Quitar el anuncio ${ad.adId}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * El estado «cuenta publicitaria de Meta sin conectar».
 *
 * La forma decidida elige el anuncio **por su nombre** de una lista leída de la
 * cuenta publicitaria; eso necesita un token de usuario de sistema con
 * `ads_read`, que hoy no existe en el entorno. Este estado no es un error: es el
 * que el usuario ve primero, y **va a volver a pasar solo** cuando el token
 * venza. Por eso el campo a mano de arriba no es un atajo temporal: es el
 * respaldo permanente.
 */
function CuentaPublicitariaSinConectar() {
  return (
    <p className="app-muted text-[11px] leading-relaxed">
      <Link2 className="mr-1 inline h-3 w-3" />
      La cuenta publicitaria de Meta no está conectada, así que el anuncio no se
      puede elegir por su nombre todavía. Mientras tanto se pega el ID — que es
      el mismo camino que queda cuando el token vence.
    </p>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Alta de producto
   ──────────────────────────────────────────────────────────────────────── */

function AltaNativo({
  onDone,
  onError,
}: {
  onDone: () => void;
  onError: (m: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function crear() {
    if (!name.trim()) return;
    setBusy(true);
    onError(null);
    try {
      const r = await fetch("/api/catalogo/productos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "native", name, description }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "no se pudo crear");
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-card space-y-2 p-3">
      <h2 className="text-sm font-semibold">Crear un producto en el panel</h2>
      <p className="app-muted text-[11px]">
        Para vender algo que todavía no está en la tienda. Su nombre y su
        descripción viven acá, y se editan acá.
      </p>
      <input
        className="app-input"
        placeholder="Nombre — por ejemplo: REVITALHAIR Serum Capilar"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <textarea
        className="app-textarea"
        rows={3}
        placeholder="Descripción"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <button className="app-button" onClick={crear} disabled={busy || !name.trim()}>
        {busy ? "Creando…" : "Crear producto"}
      </button>
    </div>
  );
}

interface TiendaProducto {
  id: string;
  title: string;
  description: string;
  priceRange: { min: string; max: string; currency: string } | null;
}

type BusquedaTienda =
  | { store: "not_connected" }
  | { store: "unreachable"; error: string }
  | { store: "connected"; shopDomain: string; result: TiendaProducto[] };

/**
 * Buscar y conectar un producto que ya existe en la tienda.
 *
 * **El estado «tienda no conectada» es una pantalla, no un error.** Hoy
 * `shopify_connection` está vacía en producción: este es el estado que el
 * usuario ve primero, y decirle qué falta y dónde arreglarlo es la diferencia
 * entre una pantalla honesta y un fallo mudo.
 */
function ConectarDeLaTienda({
  store,
  yaConectados,
  onDone,
  onError,
}: {
  store: CatalogView["store"];
  yaConectados: string[];
  onDone: () => void;
  onError: (m: string | null) => void;
}) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<BusquedaTienda | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let vivo = true;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await fetch(`/api/catalogo/tienda?q=${encodeURIComponent(q)}`);
        const j = (await r.json()) as BusquedaTienda;
        if (vivo) setRes(j);
      } finally {
        if (vivo) setBusy(false);
      }
    }, 300);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [q]);

  async function conectar(gid: string) {
    onError(null);
    const r = await fetch("/api/catalogo/productos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "shopify", shopifyProductId: gid }),
    });
    if (!r.ok) {
      const j = (await r.json()) as { error?: string };
      onError(j.error ?? "no se pudo conectar el producto");
      return;
    }
    onDone();
  }

  // El estado del servidor sirve de primer dibujo mientras la búsqueda va en
  // camino; la lista de productos solo puede venir de la búsqueda.
  const estado: BusquedaTienda =
    res ??
    (store.store === "connected"
      ? { store: "connected", shopDomain: store.shopDomain, result: [] }
      : store);

  return (
    <div className="app-card space-y-2 p-3">
      <h2 className="text-sm font-semibold">Conectar un producto de la tienda</h2>

      {estado.store !== "connected" ? (
        <div className="rounded-md border border-[rgba(244,193,109,0.35)] bg-[rgba(244,193,109,0.08)] px-2.5 py-2 text-[11px] leading-relaxed">
          {estado.store === "not_connected" ? (
            <>
              <strong className="text-[var(--color-text)]">
                La tienda no está conectada.
              </strong>{" "}
              Sin las credenciales de administración de Shopify no se puede
              buscar ni leer productos. Se configuran en{" "}
              <strong>Conexión → Shopify</strong>; las trae el dueño de la
              tienda, no el panel.
              <br />
              Mientras tanto se puede crear el producto en el panel y registrarle
              sus anuncios: el reconocimiento funciona igual.
            </>
          ) : (
            <>
              <strong className="text-[var(--color-text)]">
                No se pudo leer la tienda.
              </strong>{" "}
              La conexión existe pero no contestó. Se puede reintentar; si
              persiste, revisá la conexión en <strong>Conexión → Shopify</strong>.
            </>
          )}
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-soft)]" />
            <input
              className="app-input pl-7"
              placeholder={`Buscar en ${estado.shopDomain}`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {busy ? (
            <p className="app-muted text-[11px]">Buscando…</p>
          ) : estado.result.length === 0 ? (
            <p className="app-muted text-[11px]">
              La tienda no devolvió productos para esa búsqueda.
            </p>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {estado.result.map((p) => {
                const ya =
                  yaConectados.includes(p.id) ||
                  yaConectados.includes(p.id.split("/").pop() ?? "");
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[rgba(18,35,48,0.6)] px-2 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{p.title}</div>
                      <div className="app-muted truncate text-[11px]">
                        {p.priceRange
                          ? `${p.priceRange.currency} ${p.priceRange.min}`
                          : "sin precio"}
                      </div>
                    </div>
                    <button
                      className="app-button-secondary shrink-0 text-xs"
                      disabled={ya}
                      onClick={() => conectar(p.id)}
                    >
                      {ya ? "Ya está" : "Conectar"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Asociar un anuncio a los productos seleccionados.
 *
 * La selección múltiple acá **no es genérica**: asociar un anuncio a varios
 * productos a la vez es literalmente el N:M del ticket y su camino más corto —
 * es como se registra un anuncio de familia o de combo sin inventar un producto
 * falso.
 */
function AsociarAVarios({
  picked,
  onDone,
  onClear,
  onError,
}: {
  picked: string[];
  onDone: () => void;
  onClear: () => void;
  onError: (m: string | null) => void;
}) {
  const [adId, setAdId] = useState("");
  const [busy, setBusy] = useState(false);

  async function asociar() {
    const id = adId.trim();
    if (!id) return;
    setBusy(true);
    onError(null);
    try {
      const r = await fetch("/api/catalogo/anuncios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ adId: id, productIds: picked }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "no se pudo asociar");
      setAdId("");
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[rgba(110,231,183,0.06)] px-2 py-2">
      <strong className="text-xs">{picked.length} seleccionados</strong>
      <input
        className="app-input h-8 max-w-[220px] flex-1"
        placeholder="ID del anuncio"
        value={adId}
        onChange={(e) => setAdId(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") asociar();
        }}
      />
      <button
        className="app-button h-8 text-xs"
        onClick={asociar}
        disabled={busy || !adId.trim()}
      >
        Asociar a los {picked.length}
      </button>
      <button className="app-button-secondary h-8 text-xs" onClick={onClear}>
        Quitar selección
      </button>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Piezas chicas
   ──────────────────────────────────────────────────────────────────────── */

function OrigenPill({ source }: { source: CatalogRow["source"] }) {
  return source === "shopify" ? (
    <span className="app-pill border-[rgba(110,231,183,0.35)] bg-[rgba(110,231,183,0.1)] text-[var(--color-accent)]">
      Tienda
    </span>
  ) : (
    <span className="app-pill border-[rgba(157,187,210,0.28)] bg-[rgba(26,47,62,0.78)] text-[var(--color-text-dim)]">
      Panel
    </span>
  );
}

function Chip({
  children,
  onRemove,
}: {
  children: React.ReactNode;
  onRemove: () => void;
}) {
  return (
    <span className="app-pill border-[var(--color-border-strong)] bg-[rgba(26,47,62,0.78)] text-[11px]">
      {children}
      <button
        onClick={onRemove}
        className="text-[var(--color-text-soft)] hover:text-[var(--color-text)]"
        aria-label="Quitar filtro"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function Menu({
  id,
  open,
  onOpen,
  label,
  count,
  children,
}: {
  id: string;
  open: boolean;
  onOpen: (id: string | null) => void;
  label: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        className={`app-button-secondary gap-1.5 text-xs ${
          open ? "border-[var(--color-border-strong)]" : ""
        }`}
        onClick={() => onOpen(open ? null : id)}
      >
        {label}
        {count ? (
          <span className="rounded bg-[var(--color-accent)] px-1 text-[10px] font-bold text-[#04121a]">
            {count}
          </span>
        ) : null}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 min-w-[190px] overflow-hidden rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg-soft)] py-1 shadow-[var(--shadow-panel)]">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--color-text-dim)] hover:bg-[rgba(18,35,48,0.9)] hover:text-[var(--color-text)]"
      onClick={onClick}
    >
      <span className="w-3">{on ? <Check className="h-3 w-3" /> : null}</span>
      {children}
    </button>
  );
}

function VacioTotal({ operacion }: { operacion: string }) {
  return (
    <div className="px-3 py-12 text-center">
      <p className="text-sm font-medium">El catálogo de {operacion} está vacío</p>
      <p className="app-muted mx-auto mt-1 max-w-[46ch] text-xs leading-relaxed">
        Conectá un producto de la tienda para leer su información, o creá uno en
        el panel si todavía no está allá. Sin productos con anuncios registrados,
        el reconocimiento no puede saber de qué le escriben.
      </p>
    </div>
  );
}
