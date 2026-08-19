import {
  Bot,
  Boxes,
  Cable,
  Inbox,
  MessagesSquare,
  Package2,
  Radio,
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

/**
 * Una vista de la bandeja: el mismo Inbox, acotado.
 *
 * Cuelgan del enlace de Conversaciones y llevan contador **a propósito**:
 * decisión 1 del nivel 2, el contador tiene que verse desde afuera de la
 * bandeja, porque si solo aparece estando ya adentro no sirve para que entres.
 * Es el mismo criterio por el que el riel le ganó al filo de color en el nivel 1.
 *
 * Las tres son las que el Inbox ya calcula con ese nombre —`needsAttention`,
 * `automatedCount`, el total—, no vocabulario nuevo.
 */
export interface NavView {
  /** Valor de `?v=`. `null` es la vista por defecto, sin parámetro. */
  key: "atencion" | "agente" | null;
  label: string;
  /** Cuál de los contadores la acompaña. */
  count: "needsAttention" | "automated" | "all";
}

export interface NavItem {
  /** A dónde lleva el enlace. Puede traer parámetros. */
  href: string;
  /**
   * La ruta que deciden el acceso y el resaltado. Por defecto, {@link href}.
   * Existe porque las dos bandejas son **la misma pantalla**: `/inbox` con y
   * sin `?b=ventas`. Sin esto, `resolveAccess` recibiría `/inbox?b=ventas`,
   * no la encontraría en su tabla y la cerraría.
   */
  path?: string;
  /** La bandeja que abre, si abre una. Es lo que distingue los dos enlaces. */
  bandeja?: "ventas";
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  views?: readonly NavView[];
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
      /**
       * La bandeja de ventas **no es una pantalla nueva**: es el Inbox de
       * siempre con la bandeja derivada puesta en el parámetro. Esa fue la
       * decisión del nivel 2, y por eso este enlace apunta a `/inbox` y no a
       * una ruta propia — el historial, el envío y el control del agente son
       * los mismos, y duplicarlos habría sido la segunda aplicación que el
       * veredicto rechazó.
       *
       * Solo aparece cuando la operación tiene vendedor configurado; lo decide
       * el layout, que es quien sabe si `sales_agent_settings` tiene fila.
       */
      {
        href: "/inbox?b=ventas",
        path: "/inbox",
        bandeja: "ventas",
        label: "Conversaciones",
        icon: MessagesSquare,
        views: [
          { key: "atencion", label: "Necesitan atención", count: "needsAttention" },
          { key: "agente", label: "Las lleva Sebastián", count: "automated" },
          { key: null, label: "Todas", count: "all" },
        ],
      },
      { href: "/catalogo", label: "Catálogo", icon: Boxes },
      /**
       * El estado del reporte de conversiones a Meta.
       *
       * Va en Ventas y no en Operación aunque solo la mire un admin: lo que
       * dice es si **las ventas del vendedor** le están volviendo a la pauta, y
       * la pantalla hermana que registra los anuncios —el catálogo— ya vive
       * acá. En Operación están las conexiones, que son configuración; esto es
       * salud de un camino de ventas.
       *
       * **Se llama «Reporte a Meta» y no «Conversiones»**, aunque eso sea lo
       * que reporta: en este mismo grupo ya hay un enlace que se llama
       * «Conversaciones», y dos entradas contiguas separadas por una letra son
       * dos entradas que alguien va a confundir. El nombre elegido es el que el
       * sistema ya usa cuando habla de esto — «el reporte a Meta está apagado».
       */
      { href: "/reporte-meta", label: "Reporte a Meta", icon: Radio },
      { href: "/vendedor", label: "Vendedor", icon: UserRoundCog },
    ],
  },
  {
    key: "confirmacion",
    label: "Confirmación",
    agent: "Katherine",
    items: [
      // El Inbox es área común —los dos módulos lo necesitan— y este enlace es
      // el de siempre: sin parámetro. Con vendedor configurado trae la bandeja
      // de operaciones; sin vendedor trae todo, exactamente como hasta hoy.
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

/**
 * Todas las rutas del menú, para que el layout pregunte por cada una una vez.
 * Son rutas y no enlaces: lo que el acceso entiende es `/inbox`, no
 * `/inbox?b=ventas`.
 */
export const NAV_HREFS: readonly string[] = NAV_GROUPS.flatMap((g) =>
  g.items.map((i) => i.path ?? i.href),
);
