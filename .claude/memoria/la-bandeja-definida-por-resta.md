---
name: la-bandeja-definida-por-resta
description: Una bandeja definida por lo que le falta se llena de lo que no es suyo — y el contador que la acompaña se lee como lo que no mide
metadata: 
  node_type: memory
  type: project
  originSessionId: 188d8f38-51c4-4d91-b7d7-b9b3dfe8870f
  modified: 2026-08-20T04:14:23.950Z
---

**La bandeja de ventas se definía por resta** —`resolveInbox` mandaba a ventas todo contacto **sin fila de pedido** (regla `no_order`)— y por eso se llenó con el sobrante histórico de Katherine: 110 conversaciones, **ninguna llegada por un anuncio**, 72 marcadas «confirmado» a mano sin pedido detrás.

Encima el contador que las acompañaba (`unread_count`) solo se apagaba **al abrir la conversación en el panel**, así que decía «nadie la abrió acá adentro» y se leía como «hay que atenderla»: de 54 supuestas urgencias, **54 estaban fuera de la ventana de 24h y 30 ya habían sido contestadas**.

**Why:** el usuario lo detectó de un vistazo y nadie del equipo lo había visto en semanas — un número que miente no se ve mintiendo, se ve alto. Y las dos causas son la misma forma de error: definir algo por su ausencia (sin pedido, sin abrir) en vez de por su presencia.

**How to apply:**

- **Define la pertenencia en positivo.** Una conversación es del vendedor si llegó por un anuncio o nació después de encenderlo — nunca «porque no tiene pedido». El lote `.scratch/ventas-bandeja-honesta/` es el arreglo, con sus 16 decisiones.
- **Definir en positivo no alcanza: hay que enumerar TODOS los motivos positivos, y uno se esconde detrás de una precondición.** «Llegó por un anuncio» parecía cubierto por la regla del recomprador, pero esa regla compara el clic contra el **último pedido** y sale antes si no hay ninguno — así que no alcanzaba a las 110 conversaciones sin pedido, que son justo las que la pauta va a traer. Una regla positiva con una guarda arriba **no es la regla que se lee**: buscá qué caso nunca llega a ella.
- **Antes de creerle a un contador, preguntá qué lo apaga**, no qué lo prende. Ahí está el error casi siempre.
- **Dos definiciones del mismo listón es un bug esperando.** El panel preguntaba «¿existe la fila de `sales_agent_settings`?» y el worker «¿`display_name` no está vacío?»: abrir la pantalla de configuración encendía el módulo. El listón correcto ya estaba escrito en tres tickets y el panel no lo aplicó.
- **Columna que escribe un solo sitio, columna que miente — pero fechá la mentira.** `last_outbound_at` estaba mal en 855 de 1.759 filas, y al agruparlas por fecha resultaron **todas anteriores al 28-jul-2026**: ya estaba arreglada. Ver [[fechar-el-desfase-antes-de-arreglarlo]].
- **`outbound_messages.conversation_id` está en `null` en 316 de los 352 envíos manuales.** Agrupar por esa columna hace invisibles las respuestas de personas. Para «¿alguien contestó?», el join va por `to_wa_id`. Este error me costó dos números seguidos: 39 en vez de 35.
- **Un contador tiene que contar sobre el mismo conjunto que muestra.** La tarjeta del Inbox contaba sobre las 200 filas cargadas —cinco días— y decía 0 mientras había 35. Si el número sale de una muestra y las filas de otra, el número no significa nada.

**Cerrado el 20-ago-2026**: bandeja de ventas 110 → 0, Inbox de Katherine 1.650 → 1.760, el rojo 90 → 35. Lote `.scratch/ventas-bandeja-honesta/`.

Ver [[ejecutar-encuentra-lo-que-leer-no]], [[lo-que-vacia-de-significado-no-lo-ve-el-tipado]], [[panel-de-ventas-estado]], [[no-romper-guatemala]].
