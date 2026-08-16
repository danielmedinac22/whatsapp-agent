# 01 — Segunda conexión de WhatsApp para ventas

**What to build:** Un mensaje enviado al número dedicado de ventas entra al sistema, queda registrado como conversación de ventas y es distinguible de las de confirmación. El flujo de Katherine sigue funcionando exactamente igual, sin enterarse de que existe otra conexión.

Nadie responde todavía — este ticket solo abre el canal y lo etiqueta.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] La tabla de conexión de Kapso deja de ser de fila única y cada conexión declara su rol: confirmación o ventas.
- [ ] El accesor existente sigue devolviendo la conexión de confirmación sin cambios para todos sus llamadores actuales.
- [ ] Un mensaje entrante se atribuye a la conexión por la que llegó, y su conversación queda marcada con ese rol.
- [ ] Un mensaje al número de ventas no dispara ninguna lógica de confirmación, seguimiento ni remarketing.
- [ ] Un mensaje al número de confirmación se comporta idéntico a como se comporta hoy.
- [ ] Existe forma de registrar la conexión de ventas sin editar la base a mano.
