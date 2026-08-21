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
 * columna que cuelga del selector de operación, y no son una segunda barra
 * hermana.
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
 * Es el mismo criterio por el que la placa de país le ganó al filo de color en
 * el nivel 1.
 *
 * **Cada vista se llama como la regla que calcula.** «Sin responder» es
 * literalmente eso —el cliente escribió y nadie le contestó—, y «En automático»
 * es el opuesto exacto de «Respuesta manual», que la cabecera del hilo ya dice.
 * Los nombres viejos no decían su regla: «Necesitan atención» contaba
 * `unread_count`, que mide «nadie la abrió acá adentro», y «Las lleva el
 * vendedor» nombraba a quien no existe hasta que alguien lo configura —y se veía
 * cortado, «Las lleva el ven…», porque la barra corta cerca de los 14
 * caracteres—. Los dos nuevos miden 13 y caben enteros.
 */
export interface NavView {
  /** Valor de `?v=`. `null` es la vista por defecto, sin parámetro. */
  key: "sin-responder" | "en-automatico" | null;
  label: string;
  /** Cuál de los contadores la acompaña. */
  count: "sinResponder" | "enAutomatico" | "todas";
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
  /**
   * El agente que atiende el módulo, **escrito a mano**. `null` en lo que no es
   * de un módulo, y `null` también donde el nombre no es un dato del menú sino
   * de la configuración — ver {@link NavGroup.agentFromSeller}.
   */
  agent: string | null;
  /**
   * Si el nombre del agente sale del vendedor configurado en vez de estar
   * escrito acá.
   *
   * Ventas lo usa porque su agente **no existe hasta que alguien lo nombra**:
   * el nombre vive en `sales_agent_settings.display_name` y es el mismo con el
   * que el vendedor se presenta al cliente. Hasta este ticket la barra decía
   * «VENTAS · Sebastián» siempre, incluso con la configuración vacía y el
   * vendedor apagado — la misma clase de mentira que la bandeja heredada.
   *
   * Confirmación se queda con su nombre escrito: Katherine sí existe, atiende
   * hoy, y su configuración es otra tabla que no tiene nombre visible.
   */
  agentFromSeller?: boolean;
  items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    key: "ventas",
    label: "Ventas",
    agent: null,
    agentFromSeller: true,
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
       * el layout con `salesAgentIsConfigured` —nombre visible no vacío, no la
       * existencia de la fila—, que es el mismo listón que usa el worker.
       */
      {
        href: "/inbox?b=ventas",
        path: "/inbox",
        bandeja: "ventas",
        label: "Conversaciones",
        icon: MessagesSquare,
        /**
         * **El orden es primero lo que el vendedor hace solo y después lo que
         * le toca a una persona.** Es el pedido explícito del usuario —«las que
         * le interesan son las del segundo nivel»—: se entra a la bandeja a ver
         * qué está pasando sin uno, y enseguida qué hay que atender.
         */
        views: [
          { key: "en-automatico", label: "En automático", count: "enAutomatico" },
          { key: "sin-responder", label: "Sin responder", count: "sinResponder" },
          { key: null, label: "Todas", count: "todas" },
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
