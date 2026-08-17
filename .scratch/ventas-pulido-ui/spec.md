# Spec · Pulido de interfaz del Panel de Ventas

Status: ready-for-agent

Método: **`grilling-frontend-prototyping`** (instalado localmente; equivale al `grill-design` de `will-ness-ai/skills`). Cada pregunta de diseño se hace con **cinco prototipos radicalmente distintos** en un solo archivo HTML vivo, con selector flotante para alternar entre ellos, y el veredicto del usuario baja un nivel del árbol: primero el conjunto, luego los grupos de componentes, luego cada componente.

Origen: nota de voz del 16-ago-2026 · depende de [Operaciones](../ventas-multi-operacion/spec.md) y [Panel de Ventas](../ventas-panel/spec.md)

## Problem Statement

El Panel de Ventas introduce pantallas que no existen y, sobre todo, un contexto que nunca existió: **sobre qué país estoy trabajando**. Ese contexto no es un filtro más. Equivocarlo produce errores silenciosos —cargar un producto en el catálogo equivocado, editar el tono del vendedor del país que no era, mirar conversaciones de Guatemala creyendo que son de Colombia— que nadie detecta hasta que las consecuencias ya salieron por WhatsApp.

Un selector discreto en una esquina no resuelve eso. El problema es de diseño, no de funcionalidad: **la operación activa tiene que ser imposible de ignorar sin ser molesta**, y hoy no hay ninguna decisión tomada sobre cómo se ve eso.

Lo mismo aplica, en menor grado, a las demás pantallas nuevas: el catálogo de doble fuente, la configuración híbrida del vendedor y las conversaciones de venta con su estado de reconocimiento no tienen forma acordada. Construirlas sin decidirlas produce lo de siempre — una UI que funciona y que nadie quiere usar.

## Solution

Rondas de prototipos, no de conversación. Cada ronda produce cinco variantes vivas de la misma pregunta, el usuario las compara lado a lado y su veredicto fija el nivel y abre el siguiente.

El árbol de diseño baja en este orden:

**Nivel 1 · El conjunto.** Cómo se siente el Panel de Ventas dentro del producto existente, y **cómo se manifiestan las dos dimensiones de contexto**: la operación activa —el país— y el módulo activo —Katherine o Sebastián—. Son anidadas, no paralelas: primero país, módulo dentro. Es la decisión que condiciona todo lo demás.

**Nivel 2 · Grupos de componentes.** El selector de operación. El catálogo. La configuración del vendedor. Las conversaciones.

**Nivel 3 · Componentes.** La tarjeta de producto con su origen. El campo de identificador de anuncio. El marcador de archivo enviable. El estado de reconocimiento dentro de una conversación. Los controles de tomar y devolver el chat.

## User Stories

1. Como admin, quiero saber en qué operación estoy sin buscarlo, para no editar el país equivocado.
2. Como admin, quiero que cambiar de operación se sienta un cambio de contexto y no un filtro, para que mi cabeza cambie con la pantalla.
3. Como admin, quiero distinguir de un vistazo un producto conectado a la tienda de uno creado en el panel, porque se editan distinto.
4. Como admin, quiero ver cuántos anuncios tiene asociados un producto sin abrirlo, para detectar los que quedaron sin registrar.
5. Como admin, quiero que registrar un anuncio nuevo se sienta de segundos, porque lo voy a hacer cada vez que lance una campaña.
6. Como admin, quiero ver de un vistazo qué archivos de un producto son enviables y cuáles no, para no revisarlos uno por uno.
7. Como admin, quiero que la configuración del vendedor separe visualmente lo que tiene consecuencia —el límite de descuento— de lo que es tono, para no tratarlos igual.
8. Como asesor, quiero distinguir de un vistazo las conversaciones que necesitan a un humano de las que van bien, para priorizar sin leerlas.
9. Como asesor, quiero ver en la conversación qué producto se reconoció y de qué anuncio vino, para entrar con contexto.
10. Como asesor, quiero notar cuando el reconocimiento quedó ambiguo o escaló, porque son los chats donde hago falta.
11. Como asesor, quiero que tomar el chat sea inequívoco —saber que el vendedor quedó pausado— para no escribir encima de él.
12. Como asesor, quiero que la vista de ventas se sienta hermana de la de confirmaciones y no una aplicación distinta, para no aprender dos cosas.
13. Como usuario del panel, quiero que las pantallas nuevas se sientan parte del producto que ya uso, no un injerto.

## Implementation Decisions

**El método es el skill, no una revisión de diseño.** Cinco prototipos por ronda en un solo archivo HTML vivo, con selector flotante arrastrable y flechas para alternar. Los prototipos son desechables: existen para producir un veredicto, no para convertirse en el código final.

**Estados mockeados, no solo apariencias.** Las pantallas de este módulo cambian mucho según su estado, y elegir una apariencia contra el estado feliz es cómo se diseñan interfaces que se rompen en producción. El mock debe poder alternar al menos: catálogo vacío contra catálogo cargado; producto sin anuncios asociados contra producto con varios; conversación con producto reconocido, con reconocimiento ambiguo, y escalada; y **operación de Guatemala contra operación de Colombia**, para verificar que el cambio de contexto se percibe.

**La primera ronda decide la manifestación de la operación activa.** No se baja al catálogo ni a las conversaciones antes de resolver eso, porque condiciona el encuadre de todas las demás pantallas.

**Se respeta el sistema visual existente.** El panel ya tiene una identidad; este trabajo la extiende, no la reemplaza. Las variantes exploran dentro de ese marco, salvo que una ronda concluya explícitamente lo contrario.

**El resultado del spec son decisiones, no componentes.** Cada veredicto se registra para que la implementación tenga contra qué construir. Los prototipos se archivan como referencia visual, no se integran.

## Testing Decisions

**Sin tests automatizados, y es deliberado.** El repo no tiene arnés de pruebas de interfaz, y este spec produce decisiones de diseño, no lógica.

Lo que sí se verifica, y se verifica con el usuario delante de los prototipos: que el cambio de operación se perciba sin explicarlo, que un producto conectado se distinga de uno nativo sin leer, y que una conversación escalada se distinga de una normal sin abrirla. Si una variante necesita explicación para entenderse, falló.

## Out of Scope

- Rediseñar las pantallas existentes de confirmaciones, pedidos o plantillas.
- Cambiar el sistema visual del panel.
- Implementar las pantallas. Este spec decide cómo se ven; construirlas es de los otros specs.
- Accesibilidad más allá de lo que el sistema existente ya resuelve.
- Diseño móvil, salvo que una ronda lo levante como necesidad real del asesor.

## Further Notes

**Este spec se ejecuta con el usuario presente.** No es trabajo delegable a un agente en segundo plano: su insumo es el veredicto de alguien con criterio sobre el producto, y un agente que responde sus propias preguntas de diseño no está haciendo el ejercicio.

**Conviene correrlo antes que los tickets de UI** de los specs de Panel y Operaciones —el selector, el catálogo, las conversaciones—, porque de lo contrario esas pantallas se construyen dos veces.
