# 03 — Envío asíncrono con reintentos

**What to build:** El evento llega a Meta después de que el pedido está creado y el cliente ya recibió su confirmación. Si Meta falla, se reintenta; si sigue fallando, se registra y se sigue.

**Blocked by:** 02 · ventas-cierre-orden 03 · Sebastián cierra y crea el pedido en la tienda

**Status:** ready-for-agent

- [ ] El envío ocurre **después** de que el pedido está creado y confirmado al cliente.
- [ ] **Un fallo de Meta no afecta la venta ni la conversación.** Nunca bloquea ni demora la respuesta al cliente.
- [ ] Se usa el **token de usuario de sistema**, no el de usuario. Advertido por quien administra la cuenta: el de sistema sirve para CAPI y lectura pero no crea anuncios, y este proceso no tiene persona detrás.
- [ ] Un evento fallido entra a cola de reintentos.
- [ ] Agotados los reintentos se registra y se sigue: **nunca escala a un humano**, porque es telemetría, no una venta.
- [ ] Un reintento no produce un evento duplicado en Meta.
- [ ] El admin puede saber si el reporte está funcionando, sin esperar un mes para descubrir que no se envió nada.
