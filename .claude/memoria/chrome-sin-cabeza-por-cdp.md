---
name: chrome-sin-cabeza-por-cdp
description: "Cuando la extensión de Chrome no conecta: headless por CDP con el WebSocket que ya trae Node, y el md5 de la captura como prueba de no-regresión"
metadata:
  type: feedback
---

**La extensión `claude-in-chrome` puede no estar conectada, y eso no deja sin
navegador.** Chrome está en `/Applications/Google Chrome.app`, y **Node 26 ya
trae `WebSocket` global**, así que se maneja por CDP sin instalar nada:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --remote-debugging-port=9222 --user-data-dir=/ruta/perfil about:blank
curl -X PUT "http://127.0.0.1:9222/json/new?about:blank"   # trae webSocketDebuggerUrl
```

Con eso alcanza para lo que un ticket de pantalla necesita de verdad:

* `Emulation.setDeviceMetricsOverride` + `setTouchEmulationEnabled` — ancho de
  teléfono real, no una ventana encogida.
* **`Input.dispatchTouchEvent` — gestos táctiles de verdad.** Es lo único que
  prueba un arrastre desde el borde; con el ratón no se ejerce el mismo camino.
* `Runtime.evaluate` para medir `getBoundingClientRect` y `getComputedStyle`, y
  `Page.captureScreenshot` para ver.

**Y la prueba de que algo no cambió es el md5 de la captura, no el ojo.** Para
«el escritorio no cambió en nada»: construir la rama sin el trabajo, capturar,
volver a construir con él, capturar, comparar hashes. En PRO-32 dieron
**idénticas byte a byte** a 1024, 1280 y 1440 px en tres pantallas, y distintas
a 1023 — que es exactamente donde el ticket cambiaba algo. Un «se ve igual» no
dice eso.

**Why:** un veredicto de diseño responsive se cobra en píxeles y en gestos, y
las dos cosas se afirman ejecutando. Encoger la ventana no dispara eventos
táctiles, y comparar dos capturas a ojo no distingue un desplazamiento de 2 px
en un riel. Es la misma lección de [[ejecutar-encuentra-lo-que-leer-no]],
aplicada a la pantalla.

**How to apply:** ante cualquier ticket que prometa un número de píxeles o un
gesto, levantar Chrome sin cabeza antes de dar por terminado; y ante cualquier
«no toqué lo otro», medir el «lo otro» con hashes de captura y con la geometría
de cada pieza, no con una mirada.
