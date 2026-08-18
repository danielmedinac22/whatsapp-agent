# 03 — Bandejas separadas por módulo

**What to build:** Quien entra al módulo de ventas ve las conversaciones que le toca vender. Quien entra al de confirmación ve los pedidos por confirmar y en camino. Cada uno ve lo suyo, sin filtrar a ojo.

**Blocked by:** 01 · 02 · ventas-multi-operacion 07 · Selector de operación en el panel

**Status:** claimed — worktree `bandejas`, ola del 18-ago (2)

- [ ] Cada módulo tiene su bandeja, alimentada por la función de ruteo.
- [ ] Una conversación que cierra la venta **desaparece de la bandeja de ventas y aparece en la de operaciones**, sola.
- [ ] **Al abrir un chat se ve el historial completo**, incluida la parte de venta. Los módulos separan pantallas y configuración, no el historial: operaciones necesita saber qué le prometieron al cliente.
- [ ] El módulo vive **dentro** de la operación: primero se elige país, después módulo.
- [ ] Las conversaciones escaladas a humano se distinguen a simple vista dentro de su bandeja.
- [ ] **Apagar el módulo de ventas no afecta la confirmación.** Es lo que hoy factura.
