# 04 — Asignación de conversación

**What to build:** Un asesor marca que está trabajando una conversación, y sus compañeros lo ven. Es lo único que el sistema no puede deducir solo — de ahí que sea lo único que se guarda.

**Blocked by:** 03

**Status:** resolved — ola del 18-ago (2), mergeado y desplegado

- [x] Un asesor puede tomar una conversación y queda registrado como quien la trabaja.
- [x] El resto del equipo ve quién la tiene, **antes de escribir**.
- [x] Se puede soltar, y vuelve a quedar libre.
- [x] La asignación es por conversación y **no cambia a qué bandeja pertenece** — eso lo decide el ruteo derivado, no la persona.
- [x] Que una conversación cambie de bandeja **libera la asignación anterior**: quien la vendía ya no la está trabajando.
- [x] Es independiente de tomar el chat al agente: se puede estar asignado sin haber pausado al vendedor.

## Answer — esquema puesto por la `0022` (17-ago-2026)

*(La funcionalidad la cerró la ola del 18-ago; ver el Answer siguiente.)*

El worktree `esquema-0022` dejó las columnas aplicadas en producción. **Este ticket no genera migración.**

### En `conversations` — lo único que se guarda del ruteo

| columna | tipo | notas |
| -- | -- | -- |
| `assigned_user_id` | uuid nullable → `users` (`set null`) | el asesor que la está trabajando. Borrar el usuario la libera |
| `assigned_at` | timestamptz nullable | desde cuándo. Sin default: la pone quien asigna |

En drizzle: `conversations.assignedUserId`, `assignedAt`.

**Semántica:** tomar = escribir las dos; soltar = poner las dos en `null`; libre = `assigned_user_id is null`. Es **por conversación** (una por contacto, para siempre) y **no cambia a qué bandeja pertenece**: la bandeja se deriva con la función de ruteo (`ventas-modulos-y-ruteo/02`, en curso en el worktree `ruteo-bandeja`) a partir de `conversations.ad_referral_at` —también de la `0022`— y de los pedidos del contacto. **No hay columna de bandeja ni de estado**, a propósito: el spec lo prohíbe y el ticket 02 lo repite.

«Que una conversación cambie de bandeja libera la asignación anterior» es lógica de código, no de esquema: al detectar el cambio de bandeja se ponen las dos columnas en `null`. Es independiente de `contacts.agent_mode` (tomar el chat al agente): se puede estar asignado sin haber pausado al vendedor.

Sin índice sobre `assigned_user_id`: 1.693 conversaciones, y la lista ya trae la fila entera. Si aparece un filtro «las mías» y pesa, es un índice, no una migración de esquema que bloquee a nadie.

### Verificado en producción tras aplicar

Las dos columnas existen, nullable, y ninguna conversación tiene asignación (`0` filas con `assigned_user_id` no nulo).

## Answer — la funcionalidad, sobre las columnas que la `0022` ya había dejado

**Sin migración**, como decía el ticket. Lo único que se escribe son las dos
columnas que ya existían.

### Cómo se ve en la pantalla

En la cabecera del hilo, al lado del botón `Agente: ON/OFF` y **sin mezclarse con
él**: si está libre dice *«Trabajarla yo»*; si la tomaste, *«La trabajo yo ·
soltar»*; si la tomó otro, *«La trabaja Ana»*. En la lista, la fila lleva su
marca. Y pegado al compositor —no arriba del todo, que es donde se lee cuando ya
escribiste— sale el aviso: *«Ana está trabajando esta conversación. Si vas a
escribir, avisale primero: el cliente ve un solo hilo.»*

Quien toma es **siempre el de la sesión**: el cuerpo del `POST` no puede nombrar
a otro, porque asignarle conversaciones a un compañero no es lo que el ticket
pide. Soltar sí lo puede hacer cualquiera del equipo — una conversación tomada
por quien se fue a almorzar tiene que poder liberarse.

### Lo interesante: cómo se detecta el cambio de bandeja sin columna de bandeja

«Que una conversación cambie de bandeja libera la asignación anterior» parecía
pedir un estado anterior contra el que comparar, y **no hay ninguno**: la
bandeja se deriva y no se guarda, que es el punto de todo el ticket 02.

La salida fue no guardar nada y **volver a preguntarle a la misma regla por un
instante pasado**. `resolveInboxAsOf(facts, assignedAt)` le pasa a `resolveInbox`
solo los hechos que ya existían cuando alguien la tomó —pedidos creados antes,
clic anterior— y compara con la bandeja de hoy. Si difieren, se sueltan las dos
columnas.

Que eso sea **exacto y no una aproximación** sale de leer las cuatro reglas: la
bandeja depende de si había pedidos y de si el clic es posterior al último, y las
dos son fechas de creación, que ya no cambian. La fase del pedido sí cambia, pero
las dos fases rutean a operaciones, así que no puede alterar la respuesta. Queda
escrito en el código para que se vea el día que alguien cambie eso.

Se comparan **bandejas y no reglas**, a propósito: un pedido nuevo sobre una
conversación que ya estaba en operaciones cambia la regla —de `order_finished` a
`order_in_progress`— y no la mueve de sitio. Soltarla ahí sería castigar a un
asesor por un hecho que no lo movió.

**La liberación es una escritura disparada por una lectura.** No hay otro
momento donde engancharla: nadie mueve la conversación, la mueve un pedido que
nació o un clic que llegó, y eso se descubre al volver a derivar. Es idempotente
y solo corre cuando hay algo que soltar.

### Verificado, no supuesto

En la base de ensayo: «Elena Barrios» estaba asignada a Ana desde antes de que le
entrara el pedido; al abrir la bandeja aparece libre **y las dos columnas quedan
en `null` en la base**. «Byron Chacón», que nunca cambió de bandeja, conserva a
Luis. Tomar y soltar por la ruta devuelven `200` y dejan la fila como corresponde;
un id que no es de la operación devuelve `404`, no un `ok: true` sobre una fila
que no se tocó.

### Lo que queda abierto

1. **La asignación solo aparece con vendedor configurado.** Es deliberado: sin
   `sales_agent_settings` el panel de Katherine no cambia en nada, que es el
   criterio que manda sobre todo el proyecto. Si se quiere también para el equipo
   de confirmación sin vendedor, es quitar esa condición en dos sitios
   (`inbox-client.tsx` y la cabecera del hilo) — pero es una decisión sobre
   Guatemala y por eso no se tomó de paso.
2. **Un clic de anuncio pisado se lleva la historia por delante.**
   `ad_referral_at` guarda solo el más reciente, así que si hubo un clic antes de
   la asignación y otro después, el de antes ya no existe para nadie y la bandeja
   histórica se calcula sin él. Es un límite del esquema, no de esta lógica.
3. **Sin índice sobre `assigned_user_id`**, como decía el ticket. La lista trae
   la fila entera y el filtro «las mías» todavía no existe.
