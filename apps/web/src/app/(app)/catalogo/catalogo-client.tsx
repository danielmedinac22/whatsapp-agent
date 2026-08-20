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
  Upload,
  X,
} from "lucide-react";
import {
  conteoDeEnviables,
  etiquetaDeArchivo,
  formatoDeTamano,
  formatProductPrice,
  interruptorHabilitado,
  parseProductPrice,
  productPriceRejectionText,
  puedeEnviarse,
  rechazoDeSubida,
  whatsappLimitBytes,
  etiquetaDeTipo,
  type ProductPriceRejection,
} from "@wa/shared";
import type { CatalogFileView, CatalogRow, CatalogView } from "@/lib/catalogo";

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

type SortKey = "nombre" | "anuncios" | "origen" | "agregado" | "archivos";
type ColumnKey = "origen" | "anuncios" | "archivos" | "precio" | "agregado";

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
  {
    // Un producto del panel sin precio **no se puede vender**: el cierre no
    // tiene con qué armar la línea y el caso escala a un asesor. Es un filtro y
    // no solo un aviso en la ficha porque con decenas de productos la pregunta
    // que uno se hace es «¿cuáles me faltan?», y esa no se contesta abriendo
    // fichas de a una.
    k: "price:none",
    label: "Sin precio",
    test: (r: CatalogRow) => r.source === "native" && r.nativePrice === null,
  },
  {
    // El filtro que el nivel 2 pidió por su nombre. Mira **enviables** y no
    // «con archivos»: un producto con cuatro archivos, todos desmarcados, le
    // manda al cliente exactamente lo mismo que uno sin ninguno.
    k: "files:none",
    label: "Sin archivos enviables",
    test: (r: CatalogRow) => !r.files.some(puedeEnviarse),
  },
] as const;

const SORTS: Array<{ k: SortKey; label: string }> = [
  { k: "nombre", label: "Nombre" },
  { k: "anuncios", label: "Anuncios" },
  { k: "archivos", label: "Archivos enviables" },
  { k: "origen", label: "Origen" },
  { k: "agregado", label: "Agregado" },
];

const COLUMNS: Array<{ k: ColumnKey; label: string }> = [
  { k: "origen", label: "Origen" },
  { k: "anuncios", label: "Anuncios" },
  { k: "archivos", label: "Archivos" },
  { k: "precio", label: "Precio" },
  { k: "agregado", label: "Agregado" },
];

/** Cuántos archivos de este producto le pueden llegar de verdad al cliente. */
function enviablesDe(r: CatalogRow): number {
  return r.files.filter(puedeEnviarse).length;
}

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
    archivos: true,
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
          r.ads.some((a) => a.adId.includes(term)) ||
          // Por nombre de archivo también: «¿dónde cargué el instructivo?» es
          // la otra pregunta que se le hace a esta barra.
          r.files.some((f) => f.filename.toLowerCase().includes(term)),
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
        case "archivos":
          return (
            (enviablesDe(a) - enviablesDe(b)) * dir || a.name.localeCompare(b.name)
          );
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
          currency={view.operation.currency}
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
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-dim)]" />
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
              <div className="px-3 py-1 text-[10px] uppercase text-[var(--color-text-dim)]">
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
                className="ml-1 text-[11px] text-[var(--color-text-dim)] underline underline-offset-2 hover:text-[var(--color-text)]"
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
                    {cols.archivos ? <th>Archivos</th> : null}
                    {cols.precio ? <th>Precio</th> : null}
                    {cols.agregado ? <th>Agregado</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setSelected(r.id)}
                      className={`cursor-pointer transition hover:bg-[var(--color-surface)] ${
                        selected === r.id ? "bg-[var(--color-hover)]" : ""
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
                              ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-card)]"
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
                            <span className="app-pill border-[color-mix(in_srgb,var(--state-escalada-fg)_35%,transparent)] bg-[var(--state-escalada-bg)] text-[var(--color-danger)]">
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
                      {cols.archivos ? (
                        <td className="align-middle text-[12px]">
                          {r.files.length === 0 ? (
                            <span className="app-muted">—</span>
                          ) : (
                            <span
                              className={
                                enviablesDe(r) === 0
                                  ? "text-[var(--color-text-dim)]"
                                  : "text-[var(--color-text)]"
                              }
                            >
                              {enviablesDe(r)}/{r.files.length}
                              <span className="app-muted ml-1 text-[11px]">
                                enviables
                              </span>
                            </span>
                          )}
                        </td>
                      ) : null}
                      {cols.precio ? (
                        <td className="app-muted align-middle text-[12px]">
                          {r.price ??
                            (r.source === "native" ? (
                              // «—» y «no se puede vender» no son lo mismo, y
                              // en la columna donde se escanea el catálogo esa
                              // diferencia es la que hace que alguien lo
                              // complete antes de que un cliente lo pida.
                              <span className="text-[var(--state-espera-fg)]">
                                Sin precio
                              </span>
                            ) : (
                              "—"
                            ))}
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
            <div className="flex items-center gap-2 border-t border-[var(--color-border)] px-3 py-2 text-[11px] text-[var(--color-text-dim)]">
              <span>
                {visible.length} de {view.rows.length} producto
                {view.rows.length === 1 ? "" : "s"}
                {filtrado ? " · filtrado" : ""}
              </span>
              <span className="ml-auto">
                {view.rows.filter((r) => r.ads.length === 0).length} sin anuncios
                {" · "}
                {view.rows.filter((r) => enviablesDe(r) === 0).length} sin archivos
                enviables
              </span>
            </div>
          ) : null}
        </div>

        <Ficha
          row={ficha}
          store={view.store}
          currency={view.operation.currency}
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
      ? "border-[color-mix(in_srgb,var(--color-ink)_35%,transparent)] bg-[var(--color-ink-wash)]"
      : "border-[color-mix(in_srgb,var(--state-espera-fg)_35%,transparent)] bg-[var(--state-espera-bg)]";

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
      <p className="mt-1 text-[10px] text-[var(--color-text-dim)]">
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
  currency,
  onChanged,
  onError,
}: {
  row: CatalogRow | null;
  store: CatalogView["store"];
  currency: string;
  onChanged: () => void;
  onError: (m: string | null) => void;
}) {
  const [desc, setDesc] = useState(row?.description ?? "");
  const [nombre, setNombre] = useState(row?.name ?? "");
  const [precio, setPrecio] = useState(precioEditable(row));
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const idRef = useRef<string | null>(row?.id ?? null);

  useEffect(() => {
    if (idRef.current !== (row?.id ?? null)) {
      idRef.current = row?.id ?? null;
      setDesc(row?.description ?? "");
      setNombre(row?.name ?? "");
      setPrecio(precioEditable(row));
      setGuardado(false);
    }
  }, [row]);

  const precioParseado = precio.trim() ? parseProductPrice(precio) : null;
  const precioMalo = precioParseado && !precioParseado.ok ? precioParseado : null;

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
        // El precio viaja siempre que la ficha lo edite: vacío significa
        // «quitáselo», que es una corrección legítima y devuelve el producto al
        // estado en que la venta escala a un asesor.
        body: JSON.stringify({ name: nombre, description: desc, price: precio }),
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

      <SinPrecioNoSeVende row={row} />

      {row.source === "shopify" ? (
        <div className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-hover)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--color-text-dim)]">
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
        <h3 className="app-section">
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
            <CampoPrecio
              currency={currency}
              value={precio}
              onChange={(v) => {
                setPrecio(v);
                setGuardado(false);
              }}
              rechazo={precioMalo}
            />
            <div className="flex items-center gap-2">
              <button
                className="app-button"
                onClick={guardar}
                disabled={guardando || !nombre.trim() || precioMalo !== null}
              >
                {guardando ? "Guardando…" : "Guardar"}
              </button>
              {guardado ? (
                <span className="text-[11px] text-[var(--color-ink)]">
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
            <DescripcionDeLaTienda texto={row.description} />
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
      <Archivos row={row} onChanged={onChanged} onError={onError} />
    </div>
  );
}

/** El precio guardado, tal como se escribe en el campo que lo edita. */
function precioEditable(row: CatalogRow | null): string {
  return row?.nativePrice === null || row?.nativePrice === undefined
    ? ""
    : String(row.nativePrice);
}

/**
 * El campo del precio de un producto del panel.
 *
 * Valida **mientras se escribe** con la misma regla que usa la ruta al guardar
 * (`@wa/shared`), para que «150.000» se vea entendido como ciento cincuenta mil
 * antes de guardarlo y no después. Es la misma razón por la que el rechazo por
 * tamaño de un archivo se hace al subir: que el problema aparezca cuando el
 * admin lo puede resolver.
 */
function CampoPrecio({
  currency,
  value,
  onChange,
  rechazo,
}: {
  currency: string;
  value: string;
  onChange: (v: string) => void;
  rechazo: { ok: false; reason: ProductPriceRejection["reason"] } | null;
}) {
  const leido = !rechazo && value.trim() ? parseProductPrice(value) : null;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="app-muted w-10 shrink-0 text-[11px] tabular-nums">
          {currency}
        </span>
        <input
          className="app-input"
          inputMode="decimal"
          placeholder="Precio — vacío mientras no lo tengas"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {rechazo ? (
        <p className="text-[11px] text-[var(--color-danger)]">
          {productPriceRejectionText(rechazo)}
        </p>
      ) : leido?.ok ? (
        <p className="app-muted text-[11px]">
          Se va a guardar como {formatProductPrice(leido.value, currency)}.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Lo que un producto del panel sin precio significa para la venta.
 *
 * No es un error ni una advertencia de formulario: es **la consecuencia
 * operativa**, dicha donde el admin la puede resolver. Sin precio no hay línea
 * de pedido, así que el vendedor no cierra y el caso pasa a un asesor — que es
 * el comportamiento correcto y no un bug, pero nadie lo adivina mirando una
 * ficha que se ve completa. Es el mismo criterio con el que la ficha explica
 * que un producto sin anuncios es una fuga de reconocimiento.
 */
function SinPrecioNoSeVende({ row }: { row: CatalogRow }) {
  if (row.source !== "native" || row.nativePrice !== null) return null;
  return (
    <div className="rounded-md border border-[color-mix(in_srgb,var(--state-espera-fg)_35%,transparent)] bg-[var(--state-espera-bg)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--color-text-dim)]">
      <strong className="text-[var(--color-text)]">
        Sin precio, este producto no se puede vender.
      </strong>{" "}
      El vendedor lo puede describir y mandarle las fotos al cliente, pero al
      registrar el pedido no hay con qué armar la línea: la venta pasa a un
      asesor en vez de cerrarse con un importe inventado.
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
  const anuncios = useAnunciosDeMeta();

  async function agregar(desde?: string) {
    const id = (desde ?? adId).trim();
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
      <h3 className="app-section">
        Anuncios que apuntan acá · {row.ads.length}
      </h3>

      {anuncios?.account === "connected" ? (
        <ElegirAnuncio
          anuncios={anuncios.ads}
          yaRegistrados={row.ads.map((a) => a.adId)}
          truncado={anuncios.truncated}
          busy={busy}
          onElegir={(id) => agregar(id)}
        />
      ) : null}

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
        <button
          className="app-button shrink-0"
          onClick={() => agregar()}
          disabled={busy}
        >
          Agregar
        </button>
      </div>

      {anuncios?.account !== "connected" && <CuentaPublicitariaSinConectar />}

      {row.ads.length === 0 ? (
        <div className="rounded-md border border-[color-mix(in_srgb,var(--state-escalada-fg)_35%,transparent)] bg-[var(--state-escalada-bg)] px-2.5 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-danger)]">
            <AlertTriangle className="h-3.5 w-3.5" />
            Los leads de este producto no se van a reconocer.
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--state-escalada-fg)]">
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
                  ? "border-[color-mix(in_srgb,var(--state-espera-fg)_35%,transparent)] bg-[var(--state-espera-bg)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface)]"
              }`}
            >
              <span className="font-mono text-[12px] font-semibold text-[var(--color-text)]">
                {ad.adId}
              </span>
              {ad.alsoPointsTo.length > 0 ? (
                <span className="text-[11px] text-[var(--color-warn)]">
                  · también apunta a{" "}
                  {ad.alsoPointsTo.map((p) => p.name).join(", ")}
                </span>
              ) : null}
              <button
                className="ml-auto text-[var(--color-text-dim)] hover:text-[var(--color-danger)]"
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
/**
 * Los archivos que el vendedor puede mandar por este producto.
 *
 * **El interruptor es por archivo y el conteo va en la cabecera** («2 de 4
 * enviables»), que es la forma que el nivel 2 cerró. El conteo cuenta lo que de
 * verdad le llega al cliente, no lo que está marcado: un archivo marcado que
 * excede el límite de WhatsApp no sale, y contarlo haría que la cabecera
 * prometa de más.
 *
 * **El rechazo por tamaño se hace al subir, y acá se hace antes de subir.** El
 * navegador conoce el peso del archivo sin mandarlo, así que un video de 27 MB
 * no viaja: se rechaza en el acto, con el motivo a la vista y sin gastar la
 * subida. Es el criterio del ticket 02 —«que el problema aparezca cuando el
 * admin puede resolverlo»— en su forma más barata. La ruta vuelve a
 * preguntarlo, porque lo que llega a una ruta llega de afuera.
 *
 * **El prototipo dibujaba el archivo rechazado como una fila permanente**, con
 * su interruptor deshabilitado. Acá no queda fila: guardar en la base un
 * archivo que nunca se va a poder enviar cuesta la base y no compra nada, y
 * además la subida del panel no podría cargarlo. El estado de interruptor
 * deshabilitado **sigue existiendo** para las filas que caigan de ese lado si
 * Meta baja un límite, que es cuando de verdad hace falta explicarlo.
 */
function Archivos({
  row,
  onChanged,
  onError,
}: {
  row: CatalogRow;
  onChanged: () => void;
  onError: (m: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [rechazo, setRechazo] = useState<string | null>(null);
  const conteo = conteoDeEnviables(row.files);

  async function subir(file: File) {
    setRechazo(null);
    onError(null);

    const propuesto = {
      filename: file.name || "archivo",
      mime: (file.type || "application/octet-stream").toLowerCase(),
      byteSize: file.size,
    };
    // Antes de mandar nada: es lo que hace que el rechazo sea instantáneo y que
    // un archivo que no se puede enviar no gaste una subida entera.
    const motivo = rechazoDeSubida(propuesto);
    if (motivo) {
      setRechazo(motivo.texto);
      return;
    }

    setSubiendo(true);
    try {
      const form = new FormData();
      form.append("productId", row.id);
      form.append("file", file);
      const r = await fetch("/api/catalogo/archivos", {
        method: "POST",
        body: form,
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) {
        setRechazo(j.error ?? "no se pudo subir el archivo");
        return;
      }
      onChanged();
    } catch {
      onError("no se pudo subir el archivo");
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function marcar(file: CatalogFileView, sendable: boolean) {
    onError(null);
    setRechazo(null);
    const r = await fetch(`/api/catalogo/archivos/${file.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sendable }),
    });
    if (!r.ok) {
      const j = (await r.json()) as { error?: string };
      onError(j.error ?? "no se pudo cambiar el interruptor");
      return;
    }
    onChanged();
  }

  async function quitar(file: CatalogFileView) {
    onError(null);
    const r = await fetch(`/api/catalogo/archivos/${file.id}`, {
      method: "DELETE",
    });
    if (!r.ok) {
      const j = (await r.json()) as { error?: string };
      onError(j.error ?? "no se pudo quitar el archivo");
      return;
    }
    onChanged();
  }

  return (
    <section className="space-y-1.5 border-t border-[var(--color-border)] pt-3">
      <div className="flex items-center gap-2">
        <h3 className="app-section flex-1">
          Archivos
          {row.files.length > 0 ? (
            <span className="ml-1.5 text-[var(--color-text-dim)]">
              · {conteo.texto}
            </span>
          ) : null}
        </h3>
      </div>

      {row.files.length === 0 ? (
        <p className="app-muted text-[11px] leading-relaxed">
          Sin archivos cargados. Lo que subas acá no se envía hasta que lo
          marques: el vendedor solo manda lo autorizado.
        </p>
      ) : null}

      {row.files.map((f) => {
        const habilitado = interruptorHabilitado(f);
        const sale = puedeEnviarse(f);
        return (
          <div
            key={f.id}
            className={`flex items-center gap-2.5 rounded-md border px-2.5 py-2 ${
              habilitado
                ? "border-[var(--color-border)]"
                : "border-[color-mix(in_srgb,var(--state-escalada-fg)_35%,transparent)] bg-[var(--state-escalada-bg)]"
            }`}
          >
            <span
              className={`flex h-7 w-9 flex-none items-center justify-center rounded text-[9.5px] font-bold tracking-wide ${
                habilitado
                  ? "bg-[var(--color-hover)] text-[var(--color-text-dim)]"
                  : "bg-[var(--state-escalada-bg)] text-[var(--color-danger)]"
              }`}
            >
              {habilitado ? (
                etiquetaDeArchivo(f.filename, f.mime)
              ) : (
                <AlertTriangle className="h-3.5 w-3.5" />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-[var(--color-text)]">
                {f.filename}
              </div>
              <div className="app-muted text-[11px]">
                {etiquetaDeArchivo(f.filename, f.mime)} ·{" "}
                {formatoDeTamano(f.byteSize)}
                {habilitado ? null : (
                  <span className="text-[var(--color-danger)]">
                    {" "}
                    — excede el límite de WhatsApp para{" "}
                    {etiquetaDeTipo(f.mime)} (
                    {formatoDeTamano(whatsappLimitBytes(f.mime))}); no se puede
                    enviar
                  </span>
                )}
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={sale}
              aria-label={`Enviable: ${f.filename}`}
              disabled={!habilitado}
              title={
                !habilitado
                  ? "Excede el límite de la API de WhatsApp: no se puede enviar"
                  : sale
                    ? "El vendedor puede enviarlo"
                    : "El vendedor no lo envía"
              }
              onClick={() => marcar(f, !f.sendable)}
              className={`relative h-[19px] w-[34px] flex-none rounded-full border transition ${
                !habilitado
                  ? "cursor-not-allowed border-[var(--color-border)] bg-[var(--color-surface)] opacity-40"
                  : sale
                    ? "border-[color-mix(in_srgb,var(--color-ink)_40%,transparent)] bg-[var(--color-ink-soft)]"
                    : "border-[var(--color-border)] bg-[var(--color-surface)]"
              }`}
            >
              <span
                className={`absolute top-[2px] h-[13px] w-[13px] rounded-full transition-all ${
                  sale
                    ? "left-[18px] bg-[var(--color-ink)]"
                    : "left-[2px] bg-[var(--color-text-soft)]"
                }`}
              />
            </button>

            <button
              type="button"
              onClick={() => quitar(f)}
              aria-label={`Quitar ${f.filename}`}
              className="flex-none rounded p-1 text-[var(--color-text-dim)] transition hover:text-[var(--color-danger)]"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}

      {rechazo ? (
        <p className="rounded-md border border-[color-mix(in_srgb,var(--state-escalada-fg)_35%,transparent)] bg-[var(--state-escalada-bg)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--color-danger)]">
          {rechazo}
        </p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void subir(file);
        }}
      />
      <button
        type="button"
        className="app-button-secondary gap-1.5"
        disabled={subiendo}
        onClick={() => inputRef.current?.click()}
      >
        {subiendo ? (
          <>Subiendo…</>
        ) : (
          <>
            <Upload className="h-3.5 w-3.5" />
            Subir archivo
          </>
        )}
      </button>
    </section>
  );
}

/**
 * La lista de anuncios de Meta, leída una vez por sesión de pantalla.
 *
 * La caché es de módulo y no de componente porque la ficha se monta y se
 * desmonta cada vez que el admin cambia de producto, y registrar anuncios en
 * varios productos seguidos es justamente el trabajo recurrente que el ticket
 * quiere que dure segundos. Con caché por componente, cada cambio de producto
 * pagaría una vuelta entera a la Graph API.
 *
 * Un fallo devuelve `null` y no lanza: sin lista, la ficha muestra el campo a
 * mano — el respaldo permanente — en vez de romper la pantalla de catálogo.
 */
let anunciosPromise: Promise<AdsRead | null> | null = null;

type AdsRead =
  | { account: "not_configured" }
  | { account: "no_token" }
  | { account: "unreachable"; adAccountId: string; error: string }
  | { account: "connected"; adAccountId: string; ads: AnuncioDeMeta[]; truncated: boolean };

type AnuncioDeMeta = {
  id: string;
  name: string;
  status: string;
  campaignName: string | null;
};

function useAnunciosDeMeta(): AdsRead | null {
  const [read, setRead] = useState<AdsRead | null>(null);
  useEffect(() => {
    let alive = true;
    anunciosPromise ??= fetch("/api/meta/ads", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<AdsRead>) : null))
      .catch(() => null);
    anunciosPromise.then((v) => {
      if (alive) setRead(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return read;
}

/**
 * Elegir el anuncio por su nombre.
 *
 * **Se busca por nombre de anuncio y de campaña a la vez**, y eso no es
 * generosidad del buscador: de 200 anuncios de la cuenta, 92 comparten nombre
 * —«VIDEO 1» aparece 23 veces— así que el nombre del anuncio solo no distingue
 * nada. Lo que identifica es la campaña, que es donde vive el producto y el
 * país (`DHT WHATSAPP SEBAS CBO GTM 12 08 2026`).
 *
 * **Los ya registrados no desaparecen de la lista: se marcan.** Desaparecer
 * haría que el admin busque un anuncio, no lo encuentre y crea que Meta no lo
 * devolvió — cuando lo que pasa es que ya está hecho.
 *
 * El campo a mano sigue abajo y no se toca. Es la regla del nivel 3: «F no
 * reemplaza a las otras, las envuelve», y es el camino que queda el día que el
 * token se revoque.
 */
function ElegirAnuncio({
  anuncios,
  yaRegistrados,
  truncado,
  busy,
  onElegir,
}: {
  anuncios: AnuncioDeMeta[];
  yaRegistrados: string[];
  truncado: boolean;
  busy: boolean;
  onElegir: (adId: string) => void;
}) {
  const [q, setQ] = useState("");
  const registrados = useMemo(() => new Set(yaRegistrados), [yaRegistrados]);
  const termino = q.trim().toLowerCase();
  const encontrados = useMemo(() => {
    if (!termino) return anuncios.slice(0, 8);
    return anuncios
      .filter(
        (a) =>
          a.name.toLowerCase().includes(termino) ||
          (a.campaignName ?? "").toLowerCase().includes(termino) ||
          a.id.includes(termino),
      )
      .slice(0, 8);
  }, [anuncios, termino]);

  return (
    <div className="space-y-1.5">
      <input
        className="app-input w-full"
        placeholder={`Buscar entre ${anuncios.length} anuncios de Meta…`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        spellCheck={false}
      />
      {encontrados.length === 0 ? (
        <p className="app-muted text-[11px]">
          Ningún anuncio coincide{truncado ? " entre los 500 leídos" : ""}. Si
          es reciente, puede tardar unos minutos en aparecer — mientras tanto se
          pega el ID abajo.
        </p>
      ) : (
        <div className="space-y-0.5">
          {encontrados.map((a) => {
            const ya = registrados.has(a.id);
            return (
              <button
                key={a.id}
                type="button"
                disabled={busy || ya}
                onClick={() => onElegir(a.id)}
                className={`flex w-full items-baseline gap-2 rounded-md border px-2 py-1.5 text-left transition ${
                  ya
                    ? "cursor-default border-[var(--color-border)] bg-[var(--color-surface)] opacity-60"
                    : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-ink)]"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold text-[var(--color-text)]">
                    {a.name}
                  </span>
                  <span className="app-muted block truncate text-[11px]">
                    {a.campaignName ?? "sin campaña"}
                  </span>
                </span>
                <span
                  className={`shrink-0 text-[10px] uppercase ${
                    a.status === "ACTIVE"
                      ? "text-[var(--color-success)]"
                      : "text-[var(--color-text-dim)]"
                  }`}
                >
                  {ya ? "ya registrado" : a.status === "ACTIVE" ? "activo" : "pausado"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * La descripción del producto, tal como vive en la tienda.
 *
 * **Va plegada, y no es una preferencia estética.** La descripción de un
 * producto de esta tienda no es un párrafo: es una **página de venta entera** —
 * medida contra la ficha real, 27.655 caracteres de HTML que quedan en ~3.600
 * de texto, con letreros rotativos, tablas de packs y bloques de objeciones.
 * Dibujada completa empujaba Anuncios y Archivos tan abajo que para registrar
 * un anuncio había que scrollear una landing entera — y registrar anuncios es
 * el trabajo recurrente que esta pantalla existe para hacer corto.
 *
 * **Desplegada tampoco crece sin límite: scrollea adentro.** Un panel que se
 * estira hasta donde llegue el texto vuelve al mismo problema con un clic de
 * distancia, y la altura de la ficha pasaría a depender de cuánto copy escribió
 * el cliente.
 *
 * Lo que **no** hace es recortar el texto. Esto es material de referencia para
 * saber qué se está vendiendo; esconder el final sin decirlo es cómo alguien
 * concluye que el producto no menciona la garantía.
 */
function DescripcionDeLaTienda({ texto }: { texto: string }) {
  const [abierta, setAbierta] = useState(false);
  const limpio = texto?.trim() ?? "";

  if (!limpio) {
    return (
      <p className="app-muted text-xs leading-relaxed">
        Sin descripción en la tienda.
      </p>
    );
  }

  // El listón es el alto plegado, no el largo del texto: una descripción de
  // cuatro renglones entra entera y no necesita botón. Aproximado en líneas
  // para no medir el DOM — el error de más se paga con un botón de más, y el
  // de menos con una descripción cortada sin aviso, así que el umbral es bajo.
  const lineas = limpio.split("\n").length;
  const cabeEntera = lineas <= 8 && limpio.length <= 400;

  if (cabeEntera) {
    return (
      <p className="app-muted whitespace-pre-line text-xs leading-relaxed">
        {limpio}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <p
          className={`app-muted whitespace-pre-line text-xs leading-relaxed ${
            abierta ? "max-h-72 overflow-y-auto pr-1" : "max-h-24 overflow-hidden"
          }`}
        >
          {limpio}
        </p>
        {!abierta && (
          // El degradado dice «hay más» sin ocupar una línea diciéndolo.
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8"
            style={{
              background:
                "linear-gradient(to bottom, transparent, var(--color-card))",
            }}
          />
        )}
      </div>
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        className="text-[11px] text-[var(--color-ink)] underline underline-offset-2 hover:text-[var(--color-ink)]"
      >
        {abierta
          ? "Ver menos"
          : `Ver la descripción completa · ${lineas} líneas`}
      </button>
    </div>
  );
}

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

/**
 * Crear un producto que todavía no está en la tienda.
 *
 * **El precio se pide acá y no es obligatorio**, y las dos mitades de esa frase
 * son decisión del ticket `ventas-panel/05`. Se pide acá porque sin él el
 * vendedor no puede cerrar la venta y el caso escala a un asesor — y descubrir
 * eso con un cliente esperando es tarde. No es obligatorio porque un producto
 * sin precio sigue sirviendo para lo demás: que el vendedor lo describa y le
 * mande sus fotos. Lo que hace la ficha es **decir cuál es la consecuencia**,
 * en vez de bloquear el alta.
 */
function AltaNativo({
  currency,
  onDone,
  onError,
}: {
  currency: string;
  onDone: () => void;
  onError: (m: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const precio = price.trim() ? parseProductPrice(price) : null;
  const precioMalo = precio && !precio.ok ? precio : null;

  async function crear() {
    if (!name.trim() || precioMalo) return;
    setBusy(true);
    onError(null);
    try {
      const r = await fetch("/api/catalogo/productos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "native", name, description, price }),
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
        Para vender algo que todavía no está en la tienda. Su nombre, su
        descripción y su precio viven acá, y se editan acá.
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
      <CampoPrecio
        currency={currency}
        value={price}
        onChange={setPrice}
        rechazo={precioMalo}
      />
      <button
        className="app-button"
        onClick={crear}
        disabled={busy || !name.trim() || precioMalo !== null}
      >
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
        <div className="rounded-md border border-[color-mix(in_srgb,var(--state-espera-fg)_35%,transparent)] bg-[var(--state-espera-bg)] px-2.5 py-2 text-[11px] leading-relaxed">
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
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-dim)]" />
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
                    className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5"
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
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-ink-wash)] px-2 py-2">
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
    <span className="app-pill border-[color-mix(in_srgb,var(--color-ink)_35%,transparent)] bg-[var(--color-ink-wash)] text-[var(--color-ink)]">
      Tienda
    </span>
  ) : (
    <span className="app-pill border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-dim)]">
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
    <span className="app-pill border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[11px]">
      {children}
      <button
        onClick={onRemove}
        className="text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
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
          <span className="rounded bg-[var(--color-ink)] px-1 text-[10px] font-bold text-[var(--color-card)]">
            {count}
          </span>
        ) : null}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 min-w-[190px] overflow-hidden rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-panel)]">
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
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--color-text-dim)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]"
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
