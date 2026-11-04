# Señalización

`worker.js` usa un binding D1 llamado `DB`. Ejecuta `schema.sql` en la base y configura `SESSION_SECRET` como secreto aleatorio del proveedor. La ruta actual de TURN necesita `HF_TOKEN` guardado como secreto en Cloudflare. No copies tokens en el código, archivos de configuración ni GitHub. OWNER_KEY corresponde al modo heredado; el flujo actual usa códigos de sala.

El servidor predeterminado ya está configurado en `desktop/cloud-config.json`; publicar fuentes no requiere volver a desplegarlo. Si utilizas tu propio dominio debes revisar las listas de orígenes permitidos tanto del Worker como del cliente.

Pruebas: `node check-worker.mjs` con Node.js 24. Emplean SQLite en memoria y valores ficticios; no acceden a las credenciales reales del proveedor. El servicio remoto y TURN tienen cuotas independientes. Este repositorio no activa planes de pago.
