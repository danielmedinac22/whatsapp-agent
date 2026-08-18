"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
 */

function isOpen(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function visibleGroups(allowed: readonly string[]): NavGroup[] {
  const set = new Set(allowed);
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => set.has(i.href)),
  })).filter((g) => g.items.length > 0);
}

/** El grupo al que pertenece la pantalla abierta, o `null` si es ninguna suya. */
function openGroupKey(
  groups: readonly NavGroup[],
  pathname: string,
): string | null {
  for (const g of groups) {
    if (g.items.some((i) => isOpen(pathname, i.href))) return g.key;
  }
  return null;
}

export function ModuleNav({ allowed }: { allowed: readonly string[] }) {
  const pathname = usePathname();
  const groups = visibleGroups(allowed);
  const open = openGroupKey(groups, pathname);

  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        <div key={g.key} className={g.key === open ? "op-group is-on" : "op-group"}>
          <div className="flex items-baseline gap-2 px-2.5 pb-1.5">
            <span className="op-group-label">{g.label}</span>
            {g.agent ? (
              <span className="text-[11px] text-[var(--color-text-soft)]">
                {g.agent}
              </span>
            ) : null}
          </div>
          <div className="op-group-items">
            {g.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                current={isOpen(pathname, item.href)}
              />
            ))}
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
 */
export function ModuleNavIcons({ allowed }: { allowed: readonly string[] }) {
  const pathname = usePathname();
  const groups = visibleGroups(allowed);
  if (groups.length === 0) return null;
  const open = openGroupKey(groups, pathname);
  const group = groups.find((g) => g.key === open) ?? groups[0]!;

  return (
    <>
      <span className="my-1 h-px w-5 bg-[var(--color-border)]" aria-hidden />
      {group.items.map((item) => {
        const Icon = item.icon;
        const current = isOpen(pathname, item.href);
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
