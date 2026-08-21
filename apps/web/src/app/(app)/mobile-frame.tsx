"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Menu, Search } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * El marco del teléfono: la barra de 52px, el cajón y el velo.
 *
 * Es el veredicto del nivel 4, que salió de cuatro rondas de prototipos con el
 * dueño del producto delante. Se abrió porque **Katherine contesta clientes
 * desde el móvil**, y hasta hoy el panel le pedía 620-680px de navegación
 * apilada antes del primer título: en un teléfono de 844px, cuatro quintos de
 * la pantalla para llegar a saber en qué pantalla estás.
 *
 * **No dibuja un segundo menú.** El riel y la columna llegan como `children`,
 * renderizados en el servidor, y este componente solo los mete dentro de un
 * elemento que en el teléfono está fuera de pantalla y en escritorio no tiene
 * caja (`display: contents`). Un menú duplicado es un menú que se
 * desincroniza, y además duplicaría las consultas que lo alimentan.
 *
 * De aquí sale **todo lo interactivo del marco y nada más**: qué abre y qué
 * cierra el cajón. Lo que el cajón muestra lo decide el servidor.
 */

/** A partir de cuántos píxeles un movimiento deja de ser ruido y es un gesto. */
const UMBRAL_DE_ARRASTRE = 8;

/** Velocidad (px/ms) a partir de la cual el gesto decide solo, sin mirar dónde quedó. */
const VELOCIDAD_QUE_DECIDE = 0.35;

/**
 * El buscador de la pantalla abierta, si la pantalla tiene uno.
 *
 * **Se busca en el DOM y no se recibe por props a propósito.** El único
 * buscador del panel vive hoy en el Inbox (`inbox-client.tsx`), que es de otra
 * rama en esta tanda; pedirle un contrato para esto sería coordinar dos
 * worktrees por un botón. El precio es que el selector es por el texto del
 * marcador de posición, y el seguro es que **el botón no se dibuja cuando no
 * encuentra nada**: una lupa que no hace nada es peor que ninguna lupa.
 */
function buscadorDeLaPantalla(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    '.app-main input[placeholder^="Buscar"]',
  );
}

/** Lo que hay que recordar de un arrastre mientras el dedo sigue apoyado. */
type Arrastre = {
  puntero: number;
  x0: number;
  y0: number;
  /** El ancho del cajón, que es lo que convierte píxeles en fracción. */
  ancho: number;
  /** 0 si el gesto arrancó con el cajón cerrado, 1 si arrancó abierto. */
  base: number;
  /** Deja de ser candidato y pasa a ser gesto al cruzar el umbral. */
  vivo: boolean;
  x: number;
  t: number;
  /** px/ms del último tramo, con signo. */
  v: number;
  origen: HTMLElement;
};

export function MobileFrame({
  barra,
  children,
}: {
  /** Lo que dice la barra: la bandera y el nombre de la operación activa. */
  barra: React.ReactNode;
  /** El riel y la columna, tal cual los dibuja el servidor. */
  children: React.ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  /** La fracción abierta mientras manda el dedo, o `null` si no hay gesto. */
  const [fraccion, setFraccion] = useState<number | null>(null);
  const [hayBuscador, setHayBuscador] = useState(false);

  const cajonRef = useRef<HTMLDivElement>(null);
  const botonRef = useRef<HTMLButtonElement>(null);
  const arrastre = useRef<Arrastre | null>(null);
  /** Para devolver el foco al botón solo cuando el cajón estuvo abierto. */
  const estuvoAbierto = useRef(false);

  const ruta = usePathname();
  const params = useSearchParams();
  const pantalla = `${ruta}?${params}`;

  // Navegar cierra el cajón. Los dos enlaces al Inbox se distinguen solo por la
  // consulta, así que la ruta sola no alcanza para saber que hubo un viaje.
  useEffect(() => {
    setAbierto(false);
  }, [pantalla]);

  /**
   * La lupa se dibuja solo donde hay algo que buscar.
   *
   * **Se mira con un observador y no una sola vez**, porque mirar una sola vez
   * es una carrera que se pierde: la pantalla se pinta en más de un paso —el
   * Inbox trae su lista después del primer fotograma— y en la mitad de las
   * cargas el campo todavía no estaba puesto. Se comprobó perdiéndola.
   *
   * El costo está acotado: la reacción va coalescida a un fotograma y es un
   * `querySelector`, y `setHayBuscador` devuelve el mismo valor cuando no
   * cambió, así que React ni siquiera vuelve a dibujar.
   */
  useEffect(() => {
    const main = document.querySelector<HTMLElement>(".app-main");
    if (!main) return;
    let pedido = 0;
    const mirar = () => {
      cancelAnimationFrame(pedido);
      pedido = requestAnimationFrame(() =>
        setHayBuscador((antes) => {
          const ahora = buscadorDeLaPantalla() !== null;
          return ahora === antes ? antes : ahora;
        }),
      );
    };
    mirar();
    const vigia = new MutationObserver(mirar);
    vigia.observe(main, { childList: true, subtree: true });
    return () => {
      vigia.disconnect();
      cancelAnimationFrame(pedido);
    };
  }, [pantalla]);

  /**
   * Abierto, el cajón es modal: `Escape` lo cierra, el foco entra, y lo que
   * quedó detrás del velo deja de ser alcanzable con el tabulador.
   *
   * `inert` sobre `.app-main` y no una trampa de foco escrita a mano: es la
   * misma idea en una línea, y la pone el navegador. Solo puede correr en el
   * teléfono —en escritorio no hay forma de abrir el cajón, porque la barra y
   * el borde vivo no se dibujan— así que no hay riesgo de dejar el contenido
   * inerte en una pantalla grande.
   */
  useEffect(() => {
    const main = document.querySelector<HTMLElement>(".app-main");
    if (!abierto) {
      if (main) main.inert = false;
      if (estuvoAbierto.current) {
        estuvoAbierto.current = false;
        botonRef.current?.focus({ preventScroll: true });
      }
      return;
    }
    estuvoAbierto.current = true;
    if (main) main.inert = true;
    cajonRef.current?.focus({ preventScroll: true });
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("keydown", alTeclado);
    return () => {
      document.removeEventListener("keydown", alTeclado);
      if (main) main.inert = false;
    };
  }, [abierto]);

  // Ensanchar la ventana hasta escritorio deja el cajón sin sitio: el riel y la
  // columna vuelven a la retícula y «abierto» deja de significar algo.
  useEffect(() => {
    const ancha = window.matchMedia("(min-width: 1024px)");
    const alCambiar = () => {
      if (ancha.matches) setAbierto(false);
    };
    ancha.addEventListener("change", alCambiar);
    return () => ancha.removeEventListener("change", alCambiar);
  }, []);

  const empezar = useCallback(
    (e: React.PointerEvent<HTMLElement>, base: number) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const cajon = cajonRef.current;
      if (!cajon) return;
      arrastre.current = {
        puntero: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        ancho: cajon.getBoundingClientRect().width || 288,
        base,
        vivo: false,
        x: e.clientX,
        t: e.timeStamp,
        v: 0,
        origen: e.currentTarget,
      };
      // Desde el borde el puntero se captura de entrada: la tira mide 20px y el
      // dedo la abandona en el primer milímetro. Sobre el cajón se captura solo
      // al cruzar el umbral, porque capturar antes le robaría el clic a los
      // enlaces del menú.
      if (base === 0) e.currentTarget.setPointerCapture(e.pointerId);
    },
    [],
  );

  const mover = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const g = arrastre.current;
    if (!g || g.puntero !== e.pointerId) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.vivo) {
      // Un movimiento más vertical que horizontal es scroll, no es este gesto.
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > UMBRAL_DE_ARRASTRE) {
        arrastre.current = null;
        return;
      }
      if (Math.abs(dx) < UMBRAL_DE_ARRASTRE) return;
      // Abierto solo se arrastra hacia la izquierda; cerrado, solo hacia la
      // derecha. Al revés no hay a dónde ir y el cajón se quedaría pegado.
      if (g.base === 1 ? dx > 0 : dx < 0) {
        arrastre.current = null;
        return;
      }
      g.vivo = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const dt = Math.max(1, e.timeStamp - g.t);
    g.v = (e.clientX - g.x) / dt;
    g.x = e.clientX;
    g.t = e.timeStamp;
    setFraccion(Math.min(1, Math.max(0, g.base + dx / g.ancho)));
  }, []);

  const soltar = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const g = arrastre.current;
    arrastre.current = null;
    setFraccion(null);
    if (!g || g.puntero !== e.pointerId || !g.vivo) return;
    const donde = Math.min(1, Math.max(0, g.base + (e.clientX - g.x0) / g.ancho));
    // Un envión rápido decide solo: soltar a mitad de camino después de tirar
    // fuerte tiene que abrir, aunque el cajón esté todavía por la mitad.
    setAbierto(
      g.v > VELOCIDAD_QUE_DECIDE
        ? true
        : g.v < -VELOCIDAD_QUE_DECIDE
          ? false
          : donde > 0.5,
    );
    // El clic que sigue a un arrastre no es un clic: sin esto, cerrar el cajón
    // tirando de él sobre un enlace del menú además navegaría.
    const tragar = (ev: MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    g.origen.addEventListener("click", tragar, { capture: true, once: true });
    setTimeout(() => g.origen.removeEventListener("click", tragar, true), 0);
  }, []);

  const buscar = useCallback(() => {
    const campo = buscadorDeLaPantalla();
    if (!campo) {
      setHayBuscador(false);
      return;
    }
    campo.scrollIntoView({ block: "center", behavior: "smooth" });
    campo.focus({ preventScroll: true });
  }, []);

  const encendido = abierto || fraccion !== null;
  const arrastrando = fraccion !== null;

  return (
    <>
      <div className="app-topbar">
        <button
          ref={botonRef}
          type="button"
          className="app-topbar-btn"
          onClick={() => setAbierto(true)}
          aria-expanded={abierto}
          aria-controls="app-drawer"
          aria-label="Abrir el menú"
        >
          <Menu className="h-[18px] w-[18px]" />
        </button>
        <div className="app-topbar-op">{barra}</div>
        {hayBuscador ? (
          <button
            type="button"
            className="app-topbar-btn"
            onClick={buscar}
            aria-label="Buscar en esta pantalla"
          >
            <Search className="h-[18px] w-[18px]" />
          </button>
        ) : null}
      </div>

      {/* El borde vivo solo existe con el cajón cerrado: abierto, quien manda
          es el propio cajón, que es el que se arrastra para cerrarlo. */}
      {abierto ? null : (
        <div
          className="app-edge"
          onPointerDown={(e) => empezar(e, 0)}
          onPointerMove={mover}
          onPointerUp={soltar}
          onPointerCancel={soltar}
        />
      )}

      <div
        className={`app-scrim${encendido ? " is-on" : ""}${arrastrando ? " is-dragging" : ""}`}
        style={fraccion === null ? undefined : { opacity: fraccion }}
        onClick={() => setAbierto(false)}
        aria-hidden
      />

      <div
        id="app-drawer"
        ref={cajonRef}
        tabIndex={-1}
        className={`app-drawer${abierto ? " is-open" : ""}${arrastrando ? " is-dragging" : ""}`}
        style={
          fraccion === null
            ? undefined
            : {
                transform: `translateX(${(fraccion - 1) * 100}%)`,
                visibility: "visible",
              }
        }
        onPointerDown={(e) => empezar(e, 1)}
        onPointerMove={mover}
        onPointerUp={soltar}
        onPointerCancel={soltar}
      >
        {children}
      </div>
    </>
  );
}
