---
name: dedup-de-conversiones-capi
description: "Meta NO deduplica las conversiones de anuncios CTWA — la dedup es propia, dura más que una cola, y el fallo se parte en tres según si la petición llegó a salir"
metadata:
  type: project
---

**Meta no deduplica el flujo de *Conversions API for Business Messaging*.** Está
escrito en su documentación: dos envíos del mismo pedido cuentan **dos ventas**.
De ahí sale todo el diseño del reporte de conversiones (`ventas-capi/03`,
19-ago-2026):

- **La dedup es una tabla (`capi_conversions`, migración `0027`), no la cola.**
  El `singletonKey` de pg-boss solo es único mientras el job vive; al completarse
  se archiva a los catorce días y se borra, y desde ahí un barrido volvería a
  mandar lo mismo. La memoria de una conversión tiene que durar más que la
  memoria de una cola.
- **La fila se escribe ANTES de la llamada**, en `pending`, con
  `on conflict do nothing`. De los dos errores posibles se elige el reversible:
  perder una conversión, no contarla dos veces.
- **El fallo se parte en TRES**, y el corte no está en «hubo error» sino en **si
  la petición llegó a salir**: no poder conectarse (Meta no vio nada →
  reintentar) y colgarse esperando la respuesta (puede tenerlo adentro → NO
  reintentar, queda `unconfirmed`) son opuestos, y la clasificación clásica los
  trata igual. Si alguien quiere «simplificar» a dos estados, eso reabre la
  puerta al duplicado.
- **El modo de prueba y el real no comparten llave** (prefijo `test:`): un ensayo
  no puede consumir el turno del envío real.

Ver [[no-romper-guatemala]] (riesgo R7) y [[activos-meta-vorare]].

**Why:** un evento duplicado envenena el aprendizaje del algoritmo de la pauta
que Vorare paga, y **eso no se revierte borrando datos**. Es el único daño de
este proyecto que no se puede deshacer.

**How to apply:** ante cualquier cambio en `apps/worker/src/capi/`, comprobar que
sigue habiendo tres desenlaces y que la fila se pide antes de llamar. Correr
`ENSAYAR=si npx tsx scripts/ensayo-capi.ts` contra una base desechable — fija que
apagado el número de llamadas a Meta es cero y que un reintento no produce una
segunda conversión.
