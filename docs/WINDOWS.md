# Windows 11 x64

Ejecuta el instalador `MirrorPhone-1.3.0-windows-x64-setup.exe`, o extrae **todo** el ZIP y abre `MirrorPhone.exe`. El paquete incluye Electron y no requiere CMD ni Node.js para usarlo. Los paquetes todavía no tienen firma comercial de editor.

Abre la aplicación, deja Internet seleccionado, pulsa Crear sala e introduce ese código en MirrorPhone del iPhone. Confirma compartir pantalla y pulsa Activar sonido en el ordenador. Usa F11 para pantalla completa.

Para compilar desde el código, instala Node.js 24 LTS y npm, abre una terminal en `desktop` y ejecuta `npm ci`, `npm test` y `npm run build:windows`. Los resultados quedan en `dist`.

La versión empaquetada necesita una prueba real en Windows. El control global del iPhone con teclado/ratón sigue pendiente; el kit experimental es solo diagnóstico.
