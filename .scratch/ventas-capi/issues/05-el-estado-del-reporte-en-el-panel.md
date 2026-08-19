# 05 — El estado del reporte de conversiones, en el panel

**What to build:** Que un admin pueda ver si las ventas le están volviendo a Meta
—y cuáles no— sin pedirle a nadie que corra un comando.

**Blocked by:** 03 · Envío asíncrono con reintentos

**Status:** resolved — ola final del 19-ago-2026, mergeado y desplegado

Levantado el 19-ago-2026 al cerrar la ola 4. El worker del ticket 03 quedó
construido, desplegado y con su estado consultable por `GET /api/capi/estado`,
pero **no hay nada en el panel**: `apps/web` no era del worktree que lo
construyó, y lo dejó dicho.

## Por qué esto no es cosmético

Es la regla del proyecto de que **un ticket resuelto que el operador no puede
usar no está resuelto**. Y acá pesa más que de costumbre, por dos razones que ya
están registradas:

1. **El reporte a Meta puede estar muerto y verse sano.** Es el hallazgo del
   nivel 3 del árbol de diseño sobre la variante elegida para registrar anuncios:
   se registran los anuncios, la pantalla se ve completa y correcta, y **no pasa
   nada** si la referencia del anuncio nunca llega. Sin una señal explícita,
   nadie se entera hasta preguntarse por qué la pauta no aprende.
2. **Hay dos estados que sólo un humano puede resolver**, y el ticket 03 los dejó
   consultables justamente para eso:
   - **`pending` viejo** — una conversión que se escribió antes de llamar y cuyo
     proceso se murió en el medio. **No se reintenta sola a propósito**: hacerlo
     reintroduce el duplicado que toda esa arquitectura existe para evitar. Es
     una venta que Meta nunca supo, y alguien tiene que decidir.
   - **`unconfirmed`** — la petición salió y nunca se supo si llegó. Lo único que
     puede resolverlo es el administrador de eventos de Meta, que es el ticket
     `ventas-capi/04`. Cada fila trae `dataset`, `event_time` y valor, que son
     las tres cosas con las que se busca allá.

## Lo que ya existe y no rehacés

- `GET /api/capi/estado` en el worker, que ya contesta con el veredicto
  (`blocked` / `failing` / lo que corresponda), los `pending` viejos **listados**
  —no contados—, y los `unconfirmed` con sus tres datos de búsqueda.
- La tabla `capi_conversions` (migración `0027`, aplicada) con `status`
  (`pending` · `sent` · `failed` · `unconfirmed`), `attempts`, `last_error`,
  `event_time`, `value`, `currency`.
- El interruptor por entorno: `META_CAPI_MODE` (`off` \| `test` \| `live`),
  arranca en `off`. **Hoy en producción el estado contesta `blocked`**, porque
  falta el token de usuario de sistema.

## Lo que hay que respetar de lo ya decidido

- **La pantalla va dentro de la operación**, como todo el panel: primero país,
  módulo dentro.
- **El marco ubica; la pantalla confirma** — si escribe o si muestra algo que
  depende del país, lleva el país en su propio encabezado.
- **No inventes vocabulario.** Si el panel ya nombra algo, se llama igual.
- El estado normal hoy es **«sin conectar»**, y tiene que ser una pantalla
  honesta y esperada, no un error.

## Criterios

- [x] Un admin ve si el reporte de conversiones está encendido, apagado o
      bloqueado, y **por qué**.
- [x] Ve las conversiones que **no llegaron**, con su motivo.
- [x] Los `pending` viejos y los `unconfirmed` **se ven como lo que son: casos
      que esperan a una persona**, no como fallas del sistema.
- [x] Un `unconfirmed` muestra los tres datos con los que se busca en el
      administrador de eventos de Meta.
- [x] **La pantalla no ofrece reintentar un `pending` viejo.** Es deliberado: el
      reintento automático reintroduce el duplicado, que es el riesgo R7 y no se
      revierte borrando datos.
- [x] `pnpm -r typecheck` limpio y la suite del worker en verde.

## No-regresión

Es una pantalla de sólo lectura sobre una tabla que hoy tiene **0 filas**. No
toca el camino que factura. Lo único que hay que cuidar es que **no encienda
nada**: el modo se cambia por entorno y **con un despliegue, no con un clic** —
decisión del ticket 03, y es lo que evita que alguien encienda el reporte real
sin querer.

## Answer

**El reporte a Meta ya se mira desde el panel.** Está en Ventas → **Reporte a
Meta**, dentro de la operación, y contesta las tres preguntas que antes sólo se
podían hacer por `curl`: si está funcionando, qué no llegó, y qué está esperando
a que alguien haga algo.

### Lo que un admin ve

1. **El veredicto, con su color y su explicación.** Bloqueado, fallando,
   funcionando, o *encendido y todavía sin nada que reportar*. Ese último es un
   estado propio a propósito: se ve igual que una avería y no lo es.
2. **El destino.** Si la operación tiene su dataset configurado o no, y —cuando
   no— que el destino de una conversión es un **dataset de la cuenta de
   WhatsApp** y no el píxel. Mandarlo al píxel llegaría a un destino real y
   equivocado, sin error y sin alarma.
3. **Los últimos siete días**, que es la ventana que Meta acepta: cuántas
   llegaron, cuántas rechazó, cuántas quedaron en duda y cuántas pidiendo turno.
4. **Qué se miró y qué se decidió con cada cosa.** Es la parte que impide que un
   cero se lea como «todo bien» o como «todo roto». Hoy en Guatemala se lee
   así: *«206 pedidos no se van a reportar nunca: no los tomó el vendedor. El
   reporte solo cubre las ventas por conversación.»* Eso es una explicación, no
   un cero. Y los motivos que **sí** puede destrabar una persona salen primero y
   en ámbar: con seis motivos posibles y uno solo que pide trabajo, el orden es
   la diferencia entre verlo y no verlo.
5. **Los dos grupos que esperan a una persona**, cada uno con sus filas.

### Los dos grupos, que no son lo mismo

- **«Pidieron turno y nunca se supo cómo terminaron»** — una venta que Meta
  **nunca supo**. Casi siempre el worker se reinició entre pedir el turno y
  llamar. Sólo aparecen las que llevan más de una hora así: una de hace un
  minuto es un envío en curso, no un caso trabado.
- **«Quedaron en duda»** — una venta que **quizá sí** llegó: la petición salió y
  Meta no respondió. Cada fila trae los tres datos con los que se la busca en el
  administrador de eventos de Meta —dataset, momento y valor— y la instrucción
  de qué hacer con ella, al lado.

Los dos se presentan como **casos que esperan a una persona**, en ámbar y con su
explicación, y no como fallas del sistema en rojo.

**El momento va en UTC y lo dice.** Es la zona en la que viajó el evento, que es
como se lo busca en Meta; traducirlo obligaría a destraducirlo para cruzarlo, que
es donde se cometen los errores de una hora.

### Lo que la pantalla NO hace, y es decisión y no falta

- **No enciende nada.** No hay interruptor de modo ni botón de «mandar ahora».
  El modo se cambia por entorno y **con un despliegue**. Lo que la pantalla hace
  en cambio es decir **qué falta para encenderlo**: el token de usuario de
  sistema —el de usuario normal no sirve—, el dataset de la cuenta de WhatsApp, y
  probar primero en modo de prueba contra el administrador de eventos. Y dice
  que no se enciende desde acá, para que nadie busque el botón que a propósito
  no está.
- **No ofrece reintentar una conversión que pidió turno.** De esas no se sabe si
  la petición llegó a salir. Meta no deduplica este flujo: reintentar una que sí
  llegó cuenta la venta dos veces, y eso envenena el aprendizaje de la pauta que
  el cliente paga sin forma de deshacerlo. La pantalla lo dice con esas palabras,
  para que la ausencia del botón se lea como una decisión y no como un olvido.
- **No resuelve una conversión en duda.** No puede: lo único que sabe si llegó es
  el administrador de eventos de Meta.

### Una corrección al ticket

El ticket decía que hoy el estado contesta *«falta el token de usuario de
sistema»*. Medido contra producción (sólo lectura, 18-ago-2026), lo que contesta
es **«el reporte a Meta está apagado (META_CAPI_MODE sin poner)»**. No es lo
mismo y el orden es deliberado: el interruptor se comprueba antes que la
credencial, porque no tiene sentido reportar como problema un token que nadie
pidió usar. Faltan las dos cosas —y también el dataset, que la pantalla muestra
como «sin configurar»—, y la lista de «qué falta para encenderlo» las nombra a
las tres.

### Qué hay hoy en producción, y cómo se ve

Medido el 18-ago-2026 contra el worker desplegado, sólo lectura: modo `off`, sin
dataset, `capi_conversions` en **0 filas**, y el barrido viendo **206 pedidos en
el período, ninguno tomado por el vendedor**. La pantalla se renderizó con ese
estado exacto reproducido en una base desechable: sale como una pantalla honesta
y esperada —«Bloqueado · El reporte a Meta está apagado», el destino sin
configurar, los tres pasos para encenderlo y la línea de los 206 pedidos— y sin
una sola lista vacía ni un error.

### Lo técnico que conviene no perder

**La forma de la respuesta es un contrato compartido** entre el worker y el
panel, y vive en un solo lugar. No es ceremonia: el modo de fallar de este
tablero **es el silencio**, así que una pantalla leyendo un campo que el worker
renombró diría «no hay conversiones sin llegar» y nadie lo notaría. Ahora eso no
compila.

Y los motivos del barrido se traducen a lenguaje de operación en una función
pura con un test que **no compila si el worker agrega un motivo nuevo** sin que
alguien escriba cómo se dice. Un motivo desconocido, además, se muestra con su
nombre crudo en vez de desaparecer: una deriva tiene que verse.
