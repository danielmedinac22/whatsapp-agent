# Spec · Panel de Ventas

Status: ready-for-agent

Origen: [PRD Panel de Ventas §2, §9, §10](../panel-de-ventas/prd.html) · decisiones en [el mapa](../panel-de-ventas/map.md)

## Problem Statement

Todo lo que los otros tres specs construyen necesita que alguien lo configure, y ese alguien no es un desarrollador. Sin panel, cada producto nuevo, cada anuncio lanzado y cada ajuste al tono del vendedor es un ticket contra el equipo técnico — y a tarifa plana mensual eso convierte cada campaña del cliente en trabajo no cotizado.

Además, cuando Sebastián no puede resolver algo, alguien tiene que poder entrar al chat. Hoy no hay dónde ver las conversaciones de ventas ni cómo tomar el control de una.

## Solution

Una sección **Panel de Ventas** con tres partes:

**Vendedor.** Configuración híbrida de la persona de Sebastián: estructurado el nombre visible, los mensajes base y el límite de descuento; libre el tono y las instrucciones de personalidad. Los cambios aplican en la siguiente conversación, sin desplegar.

**Productos.** Catálogo de doble fuente: conectar un producto existente de Shopify —de donde se lee toda su información— o crear uno nativo con nombre, descripción, imágenes y adjuntos. Por cada producto, la lista de anuncios que le apuntan y qué archivos son enviables.

**Conversaciones.** Vista de los chats de Sebastián, con la posibilidad de tomar un chat —que pausa al agente— y devolvérselo.

## User Stories

1. Como admin, quiero conectar un producto de Shopify al panel, para no volver a escribir información que ya tengo cargada.
2. Como admin, quiero crear un producto directamente en el panel, para vender algo que todavía no está en Shopify.
3. Como admin, quiero subir imágenes y adjuntos a un producto nativo, para que el vendedor tenga con qué apoyarse.
4. Como admin, quiero marcar qué archivos de cada producto puede enviar el vendedor, para que no mande material interno.
5. Como admin, quiero asociar los IDs de mis anuncios a un producto, para que el vendedor reconozca de dónde viene cada lead.
6. Como admin, quiero asociar un anuncio a varios productos, para que mis anuncios de familia funcionen.
7. Como admin, quiero pegar el ID del anuncio en un solo campo, para que registrar una campaña nueva me tome segundos.
8. Como admin, quiero editar el nombre del vendedor, para que hable como mi marca.
9. Como admin, quiero editar el saludo, el empuje al cierre y el mensaje de embudo, para controlar los momentos clave.
10. Como admin, quiero escribir en texto libre el tono y la personalidad del vendedor, para ajustarlo sin pedir desarrollo.
11. Como admin, quiero definir el límite de descuento en un campo, para cambiarlo cuando cambie mi margen.
12. Como admin, quiero poner el límite de descuento en cero, para prohibirlos.
13. Como admin, quiero conectar el número dedicado de ventas, para separar las conversaciones comerciales de las de confirmación.
14. Como admin, quiero que mis cambios apliquen en la siguiente conversación, para probar ajustes rápido.
15. Como asesor, quiero ver la lista de conversaciones de ventas, para saber qué está pasando.
16. Como asesor, quiero distinguir las conversaciones que necesitan atención humana, para priorizar.
17. Como asesor, quiero tomar un chat y que el vendedor se pause, para que no me interrumpa mientras escribo.
18. Como asesor, quiero devolverle el chat al vendedor cuando termino, para que siga vendiendo.
19. Como asesor, quiero ver de qué anuncio y de qué producto viene la conversación, para entrar con contexto.
20. Como dueño de Vorare, quiero configurar todo esto sin depender del equipo técnico, para moverme a la velocidad de mis campañas.

## Implementation Decisions

**Entidades nuevas.** Producto del panel —con su origen, Shopify o nativo—, mapeo anuncio→productos en relación de muchos a muchos, archivos del producto con su marca de enviable, y la configuración del vendedor como registro propio del agente de ventas.

**Los productos de Shopify se leen, no se copian.** Un producto conectado toma su información de Shopify en tiempo de uso. Duplicarla crea desincronización silenciosa el día que el cliente edita el producto en Shopify.

**Los productos quedan uno a uno con Shopify.** No hay concepto de familia ni de agrupación en el panel: cuando varios productos se venden desde un mismo anuncio, eso lo expresa el mapeo de muchos a muchos. Se verificó que la familia REVITALHAIR son cuatro productos distintos en Shopify sin variantes; el panel no los reestructura.

**Configuración del vendedor híbrida.** Campos estructurados para nombre visible, mensajes base y límite de descuento; un campo de texto libre para tono e instrucciones. Ni todo estructurado, que es mucha UI a tarifa fija, ni todo libre, que deja que una edición del cliente rompa al vendedor sin que nadie se entere.

**Sin perillas sobre la cascada de reconocimiento.** El panel no expone activar o desactivar niveles, reordenarlos ni ajustar umbrales. Cada perilla es superficie de falla y soporte no cotizado.

**Carga de anuncios de la forma más barata posible.** Pegar el identificador desde el Administrador de anuncios de Meta y asociarlo a uno o varios productos. Es responsabilidad del cliente, así que la interacción tiene que ser trivial.

**Vista de conversaciones.** Puede resolverse como pantalla nueva o como pestaña filtrada del inbox existente. La diferencia de esfuerzo es grande y la decisión cae dentro de esta fase; se prefiere reutilizar el inbox si el filtro por conexión resulta suficiente.

**Tomar y devolver el chat.** Tomar un chat pausa al agente para esa conversación; devolverlo lo reactiva. El estado es de la conversación, no global.

**Validación de adjuntos nativos.** Los videos deben respetar el límite de tamaño de la API de WhatsApp. El panel lo valida al subir, no al enviar, para que el problema aparezca cuando el admin puede resolverlo.

## Testing Decisions

**Este spec no agrega seams de prueba, y es deliberado.** Es CRUD sobre entidades nuevas más pantallas. El repo no tiene tests de componentes ni de rutas, y agregar el primer arnés de UI aquí sería teatro: costaría más que el valor que aporta y no es lo que este spec arriesga.

La lógica que sí decide algo ya está cubierta en otros specs: la forma del catálogo y el mapeo de muchos a muchos se prueban en el spec de ingesta, a través de la función de reconocimiento; el límite de descuento se prueba en el spec de cierre, dentro del constructor de orden.

Lo que este spec debe garantizar se verifica **a mano contra los criterios de aceptación**: que un producto conectado muestre la información de Shopify, que un anuncio pueda apuntar a varios productos, que un cambio de configuración aplique en la siguiente conversación, y que tomar un chat efectivamente pause al vendedor.

Si en el futuro el repo adopta un arnés de pruebas de UI, esta es la sección a revisitar.

## Out of Scope

- Auto-registro de anuncios desde la API de Meta Ads.
- Varias personas de vendedor. Una sola.
- Configuración multi-tienda o multi-cliente. El modelo de datos se prepara, la UI no lo expone.
- Reportería y analítica de ventas.
- Edición de productos de Shopify desde el panel. Se leen, no se escriben.

## Further Notes

Esta es la parte del sistema que determina cuánto trabajo recurrente genera el módulo después de entregado. El mantenimiento cotizado incluye cargar productos y anuncios nuevos hasta una cantidad razonable al mes; si la interacción de carga queda incómoda, ese límite se consume en soporte en vez de en producto.

La vista de conversaciones es la pieza con más rango de esfuerzo del proyecto entero. Vale decidir temprano si el inbox existente se puede filtrar por conexión, porque la respuesta mueve la estimación de la fase.
