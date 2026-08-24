# CONTEXT.md

Lo que hay que saber de este negocio y que **no se deduce leyendo el código**.

`CLAUDE.md` cubre las herramientas: cuentas de git, Linear, Railway, Vercel, el
flujo de deploy. Este archivo cubre el dominio y las trampas de medición, que es
lo que cuesta caro reaprender.

Existe además por un motivo concreto: **una sesión en la nube arranca de un clon
limpio del repo**. Nada de lo que vive en la máquina de Daniel llega ahí. Lo que
no esté escrito acá, no está.

## Quién es quién

**Vorare opera en Guatemala.** Moneda GTQ, teléfonos `+502`, transportadora
FORZA vía Dropi (`app.dropi.gt`). No es Colombia. Cualquier cambio que asuma
pesos colombianos, `+57` o festivos colombianos está roto antes de empezar. Hay
una segunda operación colombiana abriéndose; hasta que exista de verdad,
**operación única** es la suposición que sostiene varias consultas.

**No romper Guatemala** es la restricción permanente. Es la operación que
factura, con más de 1.700 conversaciones vivas y unos 1.678 pedidos confirmados
por el agente. Todo cambio se mide contra la no-regresión de esa operación.

Los dos agentes tienen nombre y no hacen lo mismo:

| | quién | qué hace | configuración |
| -- | -- | -- | -- |
| Confirmación | Katherine | confirma pedidos, postventa, logística | `agent_settings` |
| Ventas | Sebastián | atiende leads de anuncios, cierra | `sales_agent_settings` |

Mezclarles la configuración es un error real que ya se cometió: la ventana de
memoria de Katherine no es la de Sebastián, y leer una columna de la otra tabla
es contaminación aunque compile.

**La asesora trabaja desde el teléfono.** Nada de la interfaz se valida solo en
escritorio: si no funciona a 390 px, no funciona.

## Cómo se llega a producción

**La base de producción no se alcanza por el dominio privado.** `DATABASE_URL`
apunta a `postgres.railway.internal`, que solo resuelve dentro de Railway. Desde
fuera se entra por el proxy público (`DATABASE_PUBLIC_URL`, host `rlwy.net`). Los
scripts de `scripts/` hacen este cambio ellos mismos:

```ts
if (process.env.DATABASE_PUBLIC_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}
```

**El panel y la base están en costas opuestas.** El worker usa el cable privado;
el dashboard cruza el país. Por eso una consulta de más en un render cuesta
mucho más de lo que el número de milisegundos local sugiere.

**La descripción de un producto de Shopify no es una ficha: es una landing.**
Trae el carrusel de ofertas, la marquesina de sellos repetida para la animación,
las reseñas y las instrucciones para tocar un botón que solo existe en el
navegador. Las dos de Vorare miden 5.821 y 4.069 caracteres de texto plano, y lo
que sirve para contestar —dosis, ficha, contraindicaciones— vive **al final**:
en el REVITALHAIR la dosis empieza en el carácter 2.603 y las contraindicaciones
en el 4.565. Un tope de caracteres corta justo lo útil, porque una landing abre
vendiendo. Lo que el vendedor lee del producto es `products.sales_brief` —la
ficha que escribe el equipo— y solo si no hay, la landing limpia.

**La credencial de Shopify caduca.** No hay token fijo: se acuña cada 24 horas.
Preguntar por la columna vieja devuelve un valor que miente.

## Trampas de medición que ya se pagaron caras

Estas son las que hacen que un número parezca correcto y no lo sea.

**`outbound_messages.conversation_id` viene nulo en la mayoría de los envíos
manuales** (316 de 352 medidos). Agrupar por esa columna hace invisibles las
respuestas de personas. Para «¿alguien contestó?», cruzá también por `to_wa_id` y
por el espejo en `messages`.

**Contestar es `agent` o `manual`, nada más.** Lo decide
`esSalienteConversacional` en `@wa/db`. Un `confirmation_ack` o una notificación
de Dropi **no** son una respuesta. Pero tampoco son silencio: el cliente que
pulsa el botón de una plantilla recibe su ack en segundo y medio y ese lazo ya se
cerró. Contestarlo otra vez es duplicar.

**`sinResponder` exige `agent_mode = false`.** La regla es correcta —si el agente
la lleva, no espera a una persona— pero deja al panel **ciego justo cuando el
agente se cae**. Ver [el incidente del 21-ago](#el-incidente-del-21-ago-2026).

**Un contador tiene que contar sobre el mismo conjunto que muestra.** La tarjeta
del Inbox contaba sobre las 200 filas cargadas, o sea cinco días, y decía 0
mientras la base decía 90.

**Antes de creerle a un contador, preguntá qué lo apaga**, no qué lo prende.

**Una consulta que falla no es un dato que no existe.** Y cero filas de una
consulta improvisada puede ser un filtro de más, no ausencia.

**Fechá el desfase antes de arreglarlo.** 855 filas mal en `last_outbound_at`
resultaron ser todas anteriores al 28-jul-2026: el bug ya estaba muerto.
Agrupar por fecha antes de tocar nada ahorra el arreglo entero.

**Reproducí la línea base antes de tocar.** El número viejo exacto contra una
base desechable, y el volcado a JSON que convierte «las mismas filas» en un diff.
`scripts/volcado-de-bandeja.ts` es el instrumento.

**Ejecutar encuentra lo que leer no.** Varias veces el error no estuvo en la
decisión sino en qué filas llegaban. Ensayá contra una base desechable; hay una
de desarrollo con Docker para eso.

## El proveedor del modelo

El agente corre sobre OpenRouter. Dos cosas que no se ven desde el código:

**La llave tiene tope de gasto propio**, aparte del saldo de la cuenta. Cuando el
tope se agota, OpenRouter responde 402 y **la capa de `@openrouter/sdk` no logra
parsear ese cuerpo**, así que en `agent_runs` queda escrito «Response validation
failed»: un error de pago disfrazado de error de parseo.

`scripts/prueba-openrouter.ts` pregunta el saldo y prueba la llamada. Es el
primer sitio al que ir cuando el agente deja de contestar.

**Las tool calls sí funcionan**, medido contra el proveedor real. Lo que falla es
que el modelo a veces miente al recibir el resultado.

## El incidente del 21-ago-2026

Vale la pena conocerlo porque combina casi todas las trampas de arriba.

El agente dejó de contestar a las 16:03 hora de Guatemala y estuvo apagado 25
horas. Las plantillas siguieron saliendo, porque no pasan por el modelo, así que
desde afuera parecía «la IA no contesta» sin ningún error visible.

La causa: sin `maxOutputTokens` el SDK reservaba los 65.536 tokens del modelo,
OpenRouter cobra esa reserva por adelantado y el saldo de la llave no la cubría.
Arreglado en `apps/worker/src/agent/techo-de-respuesta.ts`.

Lo que lo volvió invisible 25 horas: el contador de «sin responder» no puede ver
una caída del agente, porque las conversaciones represadas son justo las que
tienen `agent_mode = true`. Nos enteramos porque un cliente preguntó por
WhatsApp.

**Sigue pendiente**: no hay ningún aviso cuando `agent_runs` acumula errores
seguidos. Es la única señal que habría visto esto a tiempo.

`scripts/represados-de-la-caida.ts` hace el inventario de lo que queda sin
contestar tras una caída, con las tres trampas de arriba ya resueltas.
