"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Clock, HelpCircle, RefreshCw } from "lucide-react";
import {
  CAPI_COMO_SE_ENCIENDE,
  elMotivoYaEstaDicho,
  lineasDelBarrido,
  momentoDeBusqueda,
  type CapiEstado,
  type CapiFilaTrabada,
  type CapiVeredicto,
} from "@wa/shared";
import type { CapiEstadoView } from "@/lib/capi";

/**
 * El estado del reporte de conversiones.
 *
 * ## Las tres cosas que esta pantalla no puede hacer, y por qué
 *
 * 1. **No enciende nada.** No hay interruptor de modo ni botón de «mandar
 *    ahora». El modo se cambia por entorno y con un despliegue —decisión de
 *    `ventas-capi/03`— porque un evento de conversión duplicado o mal formado
 *    entra al aprendizaje del algoritmo que decide a quién le muestra Meta la
 *    pauta que Vorare paga, y **eso no se revierte borrando datos**. Lo único
 *    que la pantalla hace con eso es explicar qué falta para encenderlo.
 * 2. **No ofrece reintentar una conversión que quedó pidiendo turno.** Es el
 *    criterio más fácil de leer como un olvido y es exactamente lo contrario:
 *    de una `pending` vieja no se sabe si la petición llegó a salir, así que
 *    reintentarla a ciegas puede contar la venta dos veces. Es el mismo riesgo
 *    R7, y el ticket lo dice con todas las letras.
 * 3. **No resuelve una conversión en duda.** No puede: lo único que sabe si
 *    llegó es el administrador de eventos de Meta. Lo que sí hace es dar los
 *    tres datos con los que se la busca allá.
 *
 * ## Y la que sí hace, que es la razón de existir
 *
 * **Distinguir el silencio legítimo de la avería.** Cero conversiones se ve
 * igual cuando todo funciona y no hubo ventas por anuncio, que cuando falta el
 * dataset, que cuando el token venció. Por eso el veredicto nunca dice «bien»
 * por ausencia de problemas, y por eso el barrido se muestra entero: hoy en
 * Guatemala son cientos de pedidos que **no los tomó el vendedor**, y eso es
 * una explicación, no un cero.
 */

const TONOS = {
  blocked: {
    caja: "border-[color-mix(in_srgb,var(--state-espera-fg)_35%,transparent)] bg-[var(--state-espera-bg)]",
    texto: "text-[var(--state-espera-fg)]",
    etiqueta: "Bloqueado",
  },
  failing: {
    caja: "border-[color-mix(in_srgb,var(--state-escalada-fg)_35%,transparent)] bg-[var(--state-escalada-bg)]",
    texto: "text-[var(--color-danger)]",
    etiqueta: "Fallando",
  },
  working: {
    caja: "border-[color-mix(in_srgb,var(--color-ink)_35%,transparent)] bg-[var(--color-ink-wash)]",
    texto: "text-[var(--color-ink)]",
    etiqueta: "Funcionando",
  },
  idle: {
    caja: "border-[var(--color-border)] bg-[var(--color-surface)]",
    texto: "text-[var(--color-text-dim)]",
    etiqueta: "Encendido, sin nada que reportar",
  },
} as const satisfies Record<CapiVeredicto["state"], unknown>;

const MODOS: Record<CapiEstado["modo"], string> = {
  off: "Apagado",
  test: "Modo de prueba",
  live: "Real",
};

export function ReporteMetaClient({
  view,
  moneda,
}: {
  view: CapiEstadoView;
  moneda: string;
}) {
  const router = useRouter();
  const [recargando, startRefresh] = useTransition();

  if (!view.ok) {
    // Una consulta que falla **no es un dato que no existe**. Decir «no hay
    // conversiones sin llegar» acá sería la mentira más cara de esta pantalla.
    return (
      <div className="app-card space-y-2 p-3">
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--state-escalada-fg)_35%,transparent)] bg-[var(--state-escalada-bg)] p-3">
          <p className="text-sm font-semibold text-[var(--color-text)]">
            No se pudo leer el estado del reporte
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--state-escalada-fg)]">
            El worker no contestó. <strong>No quiere decir que el reporte esté
            bien ni que esté mal</strong>: quiere decir que no se pudo mirar.
          </p>
          <p className="mt-2 break-words text-[11px] text-[var(--state-escalada-fg)]">{view.error}</p>
        </div>
        <button
          className="app-button-secondary gap-1.5"
          onClick={() => startRefresh(() => router.refresh())}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {recargando ? "Mirando…" : "Volver a mirar"}
        </button>
      </div>
    );
  }

  const e = view.estado;
  const tono = TONOS[e.veredicto.state];

  return (
    <div className="space-y-3">
      {/* ── El veredicto ──────────────────────────────────────────────── */}
      <div className="app-card space-y-3 p-3">
        <div className={`rounded-lg border p-3 ${tono.caja}`}>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className={`app-label ${tono.texto}`}>{tono.etiqueta}</span>
            <span className="app-muted text-[11px]">
              Modo: {MODOS[e.modo]}
            </span>
          </div>
          <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">
            {e.veredicto.headline}
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-dim)]">
            {e.veredicto.detail}
          </p>
        </div>

        <dl className="grid gap-2 text-[11px] leading-5 sm:grid-cols-2">
          <div>
            <dt className="app-label">Destino</dt>
            <dd className="text-[var(--color-text-dim)]">
              {e.datasetId ? (
                <>
                  Dataset <code className="text-[11px]">{e.datasetId}</code> de la
                  cuenta de WhatsApp de esta operación.
                </>
              ) : (
                <>
                  <span className="text-[var(--state-espera-fg)]">Sin configurar.</span> El
                  destino de una conversión es un <strong>dataset</strong> de la
                  cuenta de WhatsApp, no el píxel: mandarlo al píxel llegaría a
                  un destino real y equivocado, sin error y sin alarma.
                </>
              )}
            </dd>
          </div>
          {/*
            El veredicto ya trae el motivo dentro de su explicación en el caso
            normal, así que repetirlo sería ruido. Se muestra solo cuando el
            veredicto habla de otra cosa — que pasa cuando no se pudo mirar el
            barrido y el veredicto se convierte en «no se pudo leer»: ahí el
            motivo del apagado sigue siendo un dato y no está dicho en ningún
            otro lado.
          */}
          {e.motivoApagado &&
          !elMotivoYaEstaDicho(e.veredicto.detail, e.motivoApagado) ? (
            <div>
              <dt className="app-label">Por qué está apagado</dt>
              <dd className="text-[var(--color-text-dim)]">{e.motivoApagado}</dd>
            </div>
          ) : null}
        </dl>

        {e.modo === "off" ? <ComoSeEnciende /> : null}

        <button
          className="app-button-secondary gap-1.5"
          onClick={() => startRefresh(() => router.refresh())}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {recargando ? "Mirando…" : "Volver a mirar"}
        </button>
      </div>

      {/* ── Qué se miró ───────────────────────────────────────────────── */}
      <QueSeMiro estado={e} />

      {/* ── Los dos grupos que esperan a una persona ──────────────────── */}
      <PidieronTurno estado={e} moneda={moneda} />
      <EnDuda estado={e} moneda={moneda} />
    </div>
  );
}

/**
 * Qué hace falta para encender el reporte.
 *
 * Es la pantalla honesta del estado de hoy: apagado no es un error, es lo que
 * hay, y lo que le falta al operador es **saber qué pedir y a quién**. La lista
 * termina diciendo que el último paso es un despliegue, para que nadie busque
 * el botón que a propósito no está.
 */
function ComoSeEnciende() {
  return (
    <div className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-hover)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--color-text-dim)]">
      <p className="font-semibold text-[var(--color-text)]">
        Qué falta para encenderlo
      </p>
      <ol className="mt-1 list-decimal space-y-1 pl-4">
        {CAPI_COMO_SE_ENCIENDE.map((paso) => (
          <li key={paso}>{paso}</li>
        ))}
      </ol>
      <p className="mt-2">
        <strong className="text-[var(--color-text)]">
          No se enciende desde el panel, y no es un olvido.
        </strong>{" "}
        Cambiar el modo pide un despliegue. Un evento de conversión duplicado o
        mal formado ya entró al aprendizaje del algoritmo que decide a quién le
        muestra Meta la pauta, y eso no se revierte borrando datos.
      </p>
    </div>
  );
}

/**
 * Lo que el sistema miró en el período, y lo que decidió con cada cosa.
 *
 * **Los saltados se muestran aunque no pidan nada.** Es la única forma de que
 * «no se reportó ninguna» se lea como lo que es: hoy en Guatemala, cientos de
 * pedidos que no tomó el vendedor. Sin eso, el mismo cero se leería como una
 * avería — o peor, no se leería.
 */
function QueSeMiro({ estado }: { estado: CapiEstado }) {
  const c = estado.conteos;
  const barrido = estado.barrido;

  return (
    <div className="app-card space-y-3 p-3">
      <div>
        <h2 className="text-sm font-semibold text-[var(--color-text)]">
          Los últimos {estado.periodoDias} días
        </h2>
        <p className="app-muted mt-0.5 text-[11px] leading-5">
          Es la misma ventana que acepta Meta: un evento más viejo que eso lo
          rechaza, así que fuera de acá no hay nada que reportar.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cifra n={c.sent} label="Llegaron a Meta" />
        <Cifra n={c.failed} label="Rechazadas" alerta={c.failed > 0} />
        <Cifra n={c.unconfirmed} label="En duda" alerta={c.unconfirmed > 0} />
        <Cifra n={c.pending} label="Pidiendo turno" />
      </div>

      {barrido === null ? (
        <p className="rounded-md border border-[color-mix(in_srgb,var(--state-escalada-fg)_35%,transparent)] bg-[var(--state-escalada-bg)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--state-escalada-fg)]">
          <strong className="text-[var(--color-text)]">
            No se pudo mirar qué ventas faltan por reportar.
          </strong>{" "}
          No quiere decir que no haya ninguna: quiere decir que no se pudo
          mirar.
        </p>
      ) : (
        <Barrido barrido={barrido} />
      )}
    </div>
  );
}

function Barrido({ barrido }: { barrido: NonNullable<CapiEstado["barrido"]> }) {
  const { esperando, saltados, totalEsperando, totalSaltados } =
    lineasDelBarrido(barrido);
  const nada =
    barrido.report === 0 && totalEsperando === 0 && totalSaltados === 0;

  if (nada) {
    return (
      <p className="app-muted text-[11px] leading-5">
        No hubo ningún pedido en el período.
      </p>
    );
  }

  return (
    <div className="space-y-2 text-[11px] leading-5">
      {barrido.report > 0 ? (
        <p className="text-[var(--color-text-dim)]">
          <strong className="text-[var(--color-text)]">{barrido.report}</strong>{" "}
          {barrido.report === 1 ? "venta lista" : "ventas listas"} para
          reportarse en el próximo barrido.
        </p>
      ) : null}

      {esperando.map((l) => (
        <p key={l.clave} className="text-[var(--color-text-dim)]">
          <strong
            className={
              l.accionable ? "text-[var(--state-espera-fg)]" : "text-[var(--color-text)]"
            }
          >
            {l.cantidad}
          </strong>{" "}
          {l.cantidad === 1 ? "venta" : "ventas"} {l.texto}.
        </p>
      ))}

      {saltados.map((l) => (
        <p key={l.clave} className="app-muted">
          <strong>{l.cantidad}</strong>{" "}
          {l.cantidad === 1 ? "pedido" : "pedidos"} no se van a reportar nunca:{" "}
          {l.texto}.
        </p>
      ))}
    </div>
  );
}

function Cifra({
  n,
  label,
  alerta,
}: {
  n: number;
  label: string;
  alerta?: boolean;
}) {
  return (
    <div className="rounded-md bg-[var(--color-surface)] px-2.5 py-2">
      <p
        className={`text-lg font-semibold tabular-nums ${
          alerta ? "text-[var(--state-espera-fg)]" : "text-[var(--color-text)]"
        }`}
      >
        {n}
      </p>
      <p className="app-muted text-[11px] leading-4">{label}</p>
    </div>
  );
}

/**
 * Las conversiones que pidieron turno y nunca se resolvieron.
 *
 * **Se ven como casos que esperan a una persona, no como fallas del sistema**,
 * y el texto lo dice: casi siempre es que el worker se reinició entre pedir el
 * turno y saber qué pasó. Es el precio conocido de escribir la fila antes de
 * llamar, y el proyecto eligió ese error justamente porque es el que se puede
 * mirar.
 *
 * **Y no hay botón de reintentar.** No se sabe si la petición llegó a salir, y
 * reintentar a ciegas contra un destino que no deduplica cuenta la venta dos
 * veces.
 */
function PidieronTurno({
  estado,
  moneda,
}: {
  estado: CapiEstado;
  moneda: string;
}) {
  const { filas, desdeHoras, nota } = estado.pendientesSinResolver;
  if (filas.length === 0) return null;

  return (
    <Grupo
      icono={<Clock className="h-3.5 w-3.5" />}
      titulo={`${filas.length} ${
        filas.length === 1 ? "venta pidió turno" : "ventas pidieron turno"
      } y nunca se supo cómo terminaron`}
      subtitulo={`Llevan más de ${desdeHoras} ${desdeHoras === 1 ? "hora" : "horas"} así.`}
      detalle={nota}
      filas={filas}
      moneda={moneda}
      cierre={
        <p>
          <strong className="text-[var(--color-text)]">
            No hay botón para reintentarlas, y es deliberado.
          </strong>{" "}
          De estas no se sabe si la petición llegó a salir. Meta no deduplica
          este flujo: reintentar una que sí llegó cuenta la venta dos veces, y
          eso envenena el aprendizaje de la pauta sin forma de deshacerlo. Lo
          que se puede hacer es lo mismo que con las que quedaron en duda —
          buscarlas en el administrador de eventos de Meta.
        </p>
      }
    />
  );
}

/**
 * Las conversiones en duda: la petición salió y Meta nunca respondió.
 *
 * **Este panel no las puede resolver y no lo va a intentar.** Cada fila viaja
 * con los tres datos con los que se la busca en el administrador de eventos —
 * dataset, momento y valor—, porque un estado que nadie sabe cómo verificar es
 * un estado que nadie verifica.
 */
function EnDuda({ estado, moneda }: { estado: CapiEstado; moneda: string }) {
  const { filas, comoVerificar } = estado.enDuda;
  if (filas.length === 0) return null;

  return (
    <Grupo
      icono={<HelpCircle className="h-3.5 w-3.5" />}
      titulo={`${filas.length} ${
        filas.length === 1 ? "conversión quedó" : "conversiones quedaron"
      } en duda`}
      subtitulo="La petición salió y Meta no respondió: de este lado no se puede saber si llegó."
      detalle={comoVerificar}
      filas={filas}
      moneda={moneda}
      cierre={
        <p>
          Los tres datos de cada fila —<strong>dataset</strong>,{" "}
          <strong>momento</strong> y <strong>valor</strong>— son con los que se
          busca el evento <code className="text-[11px]">Purchase</code> allá.
        </p>
      }
    />
  );
}

/** Un grupo de casos que esperan a una persona, con sus filas. */
function Grupo({
  icono,
  titulo,
  subtitulo,
  detalle,
  filas,
  moneda,
  cierre,
}: {
  icono: React.ReactNode;
  titulo: string;
  subtitulo: string;
  detalle: string;
  filas: CapiFilaTrabada[];
  moneda: string;
  cierre: React.ReactNode;
}) {
  return (
    <div className="app-card space-y-3 p-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-[var(--state-espera-fg)]">{icono}</span>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            {titulo}
          </h2>
          <p className="app-muted mt-0.5 text-[11px] leading-5">{subtitulo}</p>
        </div>
      </div>

      <p className="rounded-md border border-[color-mix(in_srgb,var(--state-espera-fg)_35%,transparent)] bg-[var(--state-espera-bg)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--color-text-dim)]">
        {detalle}
      </p>

      <ul className="space-y-2">
        {filas.map((f) => (
          <Fila key={`${f.orderId}-${f.createdAt}`} fila={f} moneda={moneda} />
        ))}
      </ul>

      <div className="text-[11px] leading-relaxed text-[var(--color-text-dim)]">
        {cierre}
      </div>
    </div>
  );
}

/**
 * Una conversión trabada, con lo que hace falta para buscarla en Meta.
 *
 * La moneda que muestra es **la de la fila**, no la de la operación del panel:
 * es la que viajó en el evento, y si algún día no coincidieran, lo que hay que
 * ver es la que viajó.
 */
function Fila({ fila, moneda }: { fila: CapiFilaTrabada; moneda: string }) {
  return (
    <li className="rounded-md bg-[var(--color-surface)] p-2 text-[11px] leading-5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-[var(--color-text)]">
          Pedido {fila.orderId}
        </span>
        <span className="tabular-nums text-[var(--color-text-dim)]">
          {fila.value} {fila.currency || moneda}
        </span>
        {fila.mode === "test" ? (
          <span className="app-muted">(modo de prueba)</span>
        ) : null}
      </div>
      <dl className="mt-1 grid gap-x-3 gap-y-0.5 text-[var(--color-text-dim)] sm:grid-cols-2">
        <div className="flex gap-1.5">
          <dt className="app-muted shrink-0">Dataset</dt>
          <dd className="truncate">
            <code className="text-[11px]">{fila.datasetId}</code>
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="app-muted shrink-0">Momento</dt>
          <dd className="tabular-nums">{momentoDeBusqueda(fila.eventTime)}</dd>
        </div>
      </dl>
      {fila.lastError ? (
        <p className="app-muted mt-1 flex items-start gap-1.5">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="break-words">{fila.lastError}</span>
        </p>
      ) : null}
      <p className="app-muted mt-0.5">
        {fila.attempts === 1 ? "1 intento" : `${fila.attempts} intentos`} · desde{" "}
        {momentoDeBusqueda(fila.createdAt)}
      </p>
    </li>
  );
}
