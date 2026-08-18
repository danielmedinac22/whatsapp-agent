import {
  Bot,
  Boxes,
  Cable,
  Inbox,
  Package2,
  Shapes,
  UserRoundCog,
} from "lucide-react";

/**
 * El menú del panel, agrupado por módulo y **anidado dentro de la operación**.
 *
 * Es solo datos: no sabe de sesión, de rol ni de la ruta actual. Quién alcanza
 * qué lo decide `@/access/resolve` —la misma función que el borde— y qué está
 * abierto lo decide el `pathname`, ya en el cliente.
 *
 * **Primero país, módulo dentro.** Decisión 4 del nivel 1: el módulo va anidado
 * en la operación, nunca al lado. Por eso los grupos viven aquí, dentro de la
 * columna que cuelga del riel, y no son una segunda barra hermana.
 *
 * Ojo con el idioma: «Operación» como grupo de este menú es la configuración
 * del país —la conexión de WhatsApp, la tienda, la logística—, y «operaciones»
 * en `@/access/resolve` es el equipo que confirma pedidos. La colisión es del
 * lenguaje del negocio y ya se decidió respetarla en el esquema.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export interface NavGroup {
  key: string;
  label: string;
  /** El agente que atiende el módulo. `null` en lo que no es de un módulo. */
  agent: string | null;
  items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    key: "ventas",
    label: "Ventas",
    agent: "Sebastián",
    items: [
      // Las dos pantallas nuevas de esta ola. Las rutas están fijadas desde la
      // sesión coordinadora y las páginas las construyen otros worktrees: el
      // riel *es* la navegación, así que los enlaces van aquí aunque la
      // pantalla llegue después. Si al mergear esto primero el enlace apunta a
      // una pantalla que aún no existe, es temporal y se cierra en la ola.
      { href: "/catalogo", label: "Catálogo", icon: Boxes },
      { href: "/vendedor", label: "Vendedor", icon: UserRoundCog },
    ],
  },
  {
    key: "confirmacion",
    label: "Confirmación",
    agent: "Katherine",
    items: [
      // El Inbox es área común —los dos módulos lo necesitan— y aparece aquí
      // porque hoy la bandeja es una sola. El ticket 03 de ruteo la parte en
      // dos, y ahí cada mitad se va a su grupo.
      { href: "/inbox", label: "Inbox", icon: Inbox },
      { href: "/orders", label: "Pedidos", icon: Package2 },
      { href: "/templates", label: "Plantillas", icon: Shapes },
      { href: "/agent", label: "Agente", icon: Bot },
    ],
  },
  {
    key: "operacion",
    label: "Operación",
    agent: null,
    items: [{ href: "/connection", label: "Conexión", icon: Cable }],
  },
];

/** Todas las rutas del menú, para que el layout pregunte por cada una una vez. */
export const NAV_HREFS: readonly string[] = NAV_GROUPS.flatMap((g) =>
  g.items.map((i) => i.href),
);
