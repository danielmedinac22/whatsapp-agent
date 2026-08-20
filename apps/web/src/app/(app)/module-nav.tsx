"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NAV_GROUPS, type NavGroup, type NavItem } from "./nav";

/**
 * La navegación de módulos, anidada dentro de la operación.
 *
 * Es lo único del marco que corre en el cliente, y por una sola razón: un
 * layout de Next no recibe el `pathname`, y sin él no se puede decir qué
 * pantalla está abierta. Recibe del servidor **las rutas que el rol alcanza** —
 * la decisión de acceso no se toma aquí— y el resto lo saca de `./nav`, que es
 * estático.
 *
 * Esconder un enlace **no es el control de acceso**: quien escribe la URL a mano
 * no pasa por aquí, lo rebota el proxy. Es solo no ofrecer una puerta cerrada.
 *
 * Desde la bandeja por módulo también recibe **los contadores de las vistas de
 * ventas**, que se calculan en el servidor porque dependen de la bandeja
 * derivada, y `null` cuando la operación no tiene vendedor configurado — que es
 * como este componente sabe que no hay vistas que dibujar.
 */

/** Los contadores de las tres vistas de la bandeja de ventas. */
export type SalesInboxCounts = {
  sinResponder: number;
  enAutomatico: number;
  todas: number;
};

/** Lo que el servidor sabe del vendedor de esta operación. */
export type SalesNav = {
  counts: SalesInboxCounts;
  /**
   * El nombre configurado. Va al lado del módulo —«VENTAS · Sebastián»— y ya no
   * dentro de las vistas: una vista se llama por lo que cuenta, no por quién la
   * atiende, y el nombre metido en la etiqueta era lo que la barra cortaba.
   */
  sellerName: string;
};

function isOpen(pathname: string, item: NavItem, bandeja: string | null): boolean {
  const path = item.path ?? item.href;
  const enLaRuta = pathname === path || pathname.startsWith(`${path}/`);
  if (!enLaRuta) return false;
  // Los dos enlaces al Inbox comparten ruta y los distingue la bandeja: sin
  // esto, entrar a Conversaciones encendería también el Inbox de Katherine.
  return (item.bandeja ?? null) === bandeja;
}

function visibleGroups(
  allowed: readonly string[],
  sales: SalesNav | null,
): NavGroup[] {
  const set = new Set(allowed);
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => {
      // Sin vendedor configurado no hay bandeja de ventas: el enlace no se
      // ofrece, y `/inbox` sigue trayendo todo como hasta hoy.
      if (i.bandeja === "ventas" && sales === null) return false;
      return set.has(i.path ?? i.href);
    }),
  })).filter((g) => g.items.length > 0);
}

/** El grupo al que pertenece la pantalla abierta, o `null` si es ninguna suya. */
function openGroupKey(
  groups: readonly NavGroup[],
  pathname: string,
  bandeja: string | null,
): string | null {
  for (const g of groups) {
    if (g.items.some((i) => isOpen(pathname, i, bandeja))) return g.key;
  }
  return null;
}

/**
 * El nombre del agente que se pinta al lado del módulo, o `null` si no hay
 * ninguno que decir.
 *
 * **No se pinta un nombre que nadie escribió.** El de Ventas sale del vendedor
 * configurado, y `sales` es `null` justo cuando no lo hay: entonces el módulo se
 * dibuja con su etiqueta y sin agente, en vez de anunciar a un vendedor apagado
 * como si atendiera.
 */
function agentName(group: NavGroup, sales: SalesNav | null): string | null {
  return group.agentFromSeller ? sales?.sellerName ?? null : group.agent;
}

export function ModuleNav({
  allowed,
  sales,
}: {
  allowed: readonly string[];
  sales: SalesNav | null;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const bandeja = params.get("b");
  const vista = params.get("v");
  const groups = visibleGroups(allowed, sales);
  const open = openGroupKey(groups, pathname, bandeja);

  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        <div key={g.key} className={g.key === open ? "op-group is-on" : "op-group"}>
          <div className="flex items-baseline gap-2 px-2.5 pb-1.5">
            <span className="op-group-label">{g.label}</span>
            {agentName(g, sales) ? (
              <span className="text-[11px] text-[var(--color-text-soft)]">
                {agentName(g, sales)}
              </span>
            ) : null}
          </div>
          <div className="op-group-items">
            {g.items.map((item) => {
              const current = isOpen(pathname, item, bandeja);
              // Fragment y no `div`: un enlace sin vistas tiene que producir
              // exactamente el mismo DOM que antes de este ticket, porque
              // `.op-group-items` reparte su `gap` entre hijos directos.
              return (
                <Fragment key={item.href}>
                  <NavLink item={item} current={current} />
                  {item.views && sales ? (
                    <div className="mb-1 flex flex-col gap-px pl-[26px]">
                      {item.views.map((view) => (
                        <Link
                          key={view.key ?? "todas"}
                          href={
                            view.key
                              ? `${item.href}&v=${view.key}`
                              : item.href
                          }
                          className="app-nav-link h-7 text-xs"
                          aria-current={
                            current && (vista ?? null) === view.key
                              ? "page"
                              : undefined
                          }
                        >
                          {/* La etiqueta es la de `./nav`, tal cual. Antes se
                              rearmaba acá con el nombre del vendedor —«Las
                              lleva Sebastián»— y la barra la cortaba en «Las
                              lleva el ven…»; ahora la vista se llama por su
                              regla, que no depende de quién la atienda. */}
                          <span className="flex-1 truncate">{view.label}</span>
                          <span className="tabular-nums text-[10.5px] text-[var(--color-text-soft)]">
                            {sales.counts[view.count]}
                          </span>
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </Fragment>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function NavLink({ item, current }: { item: NavItem; current: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className="app-nav-link group"
      aria-current={current ? "page" : undefined}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center text-[var(--color-text-dim)] transition group-hover:text-[var(--color-text)]">
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex-1 truncate">{item.label}</span>
    </Link>
  );
}

/**
 * La misma navegación reducida a iconos, para el riel plegado de 46px.
 *
 * Muestra **solo el módulo de la pantalla abierta**, que es lo que decidió la
 * ronda 3: plegado se conserva el país, que existe el otro, y la navegación de
 * donde uno está. Lo que se pierde son los nombres de las pantallas. Si la ruta
 * actual no es de ningún grupo, cae al primero que el rol alcance en vez de
 * quedarse en blanco — un riel sin navegación no es un colapso, es una
 * mutilación.
 *
 * Las vistas no bajan aquí: son tres contadores sin sitio en 46px, y plegado lo
 * que se conserva es a dónde ir, no cuánto hay.
 */
export function ModuleNavIcons({
  allowed,
  sales,
}: {
  allowed: readonly string[];
  sales: SalesNav | null;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const bandeja = params.get("b");
  const groups = visibleGroups(allowed, sales);
  if (groups.length === 0) return null;
  const open = openGroupKey(groups, pathname, bandeja);
  const group = groups.find((g) => g.key === open) ?? groups[0]!;

  return (
    <>
      <span className="my-1 h-px w-5 bg-[var(--color-border)]" aria-hidden />
      {group.items.map((item) => {
        const Icon = item.icon;
        const current = isOpen(pathname, item, bandeja);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="op-rail-icon"
            aria-current={current ? "page" : undefined}
            title={`${group.label} · ${item.label}`}
          >
            <Icon className="h-4 w-4" />
          </Link>
        );
      })}
    </>
  );
}
