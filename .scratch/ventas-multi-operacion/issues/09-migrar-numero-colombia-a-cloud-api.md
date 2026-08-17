# 09 — Migrar el número de Colombia a Cloud API

**What to build:** El número colombiano queda operativo en Cloud API, que es la única forma en que el sistema puede usarlo.

**No es código: es trámite con Meta, y tiene espera externa.** Arranca de inmediato, en paralelo con todo lo demás — es lo único del proyecto que no se acelera trabajando más rápido.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

Verificado contra la Graph API el 16-ago-2026: el número **+57 304 5430173** ya existe, en la WABA «Vorare Living» (`1301601911943339`, moneda COP). Pero está registrado en **ON_PREMISE**, no en Cloud API — y la API On-Premises está descontinuada.

- [ ] Se confirma si el número está realmente en uso o es un registro heredado sin actividad.
- [ ] El número queda registrado y verificado en **Cloud API**.
- [ ] Queda con calidad de mensajería sana, comparable a la del número guatemalteco (que hoy está en verde).
- [ ] Queda claro **qué WABA** va a alojarlo definitivamente: hay cuatro bajo el portafolio Vorare y conviene no dejarlo en la equivocada.
- [ ] Se documenta el procedimiento seguido, porque es el mismo que haría falta para un tercer país.

**Nota:** las otras dos WABAs guatemaltecas (+502 5946 7118 y +502 4722 4176) también están en ON_PREMISE. Vale confirmar si son registros muertos antes de que alguien los tome por operativos.
