# Validación de versiones

## Automatización

- `desktop`: `npm test` comprueba puertos, salas, intercambio de señales, cierre de sesiones, orígenes, ruta audible única, limpieza del audio, negociación H.264 y almacenamiento de Linux.
- `cloudflare`: `node check-worker.mjs` comprueba SQLite real en memoria, concurrencia, roles, revocación, límites, ICE y aislamiento de credenciales ficticias.
- Los paquetes deben contener el runtime, `resources/app.asar`, las licencias y el ejecutable de su plataforma.
- El paquete DEB debe incluir propietario root, permisos ejecutables y entrada en el menú; el ZIP de Windows debe pasar su verificación CRC.

## Estado inicial de 1.3.0

Las pruebas locales de escritorio y Worker pasaron en macOS. Se generaron DEB/tar.gz de Linux y ZIP de Windows en macOS; se revisaron formato, contenido y correspondencia del código empaquetado. El instalador NSIS requiere el runner Windows porque la herramienta descargada en esta Mac necesita otra arquitectura.

Las pruebas anteriores de imagen y audio corresponden a iPhone y receptor macOS. No equivalen a una prueba en Mint o Windows.

## Prueba física pendiente por plataforma

1. Instalar en un equipo limpio, abrir desde el menú y crear sala.
2. Conectar iPhone sin cable y confirmar la captura de iOS.
3. Revisar orientación vertical, ambas posiciones horizontales y pantalla completa.
4. Reproducir durante al menos dos minutos un vídeo local con voz; verificar audio, sincronización, bloqueos y desconexión.
5. Medir FPS, resolución y latencia con contenido en movimiento; distinguir RTT, búfer y retraso total.
6. Probar reconexión, cambio de red y cierre de ambas apps.
7. Repetir en red local y en redes distintas; indicar si la ruta usa TURN.

Registra modelo de equipo, versión del sistema, versión de iOS y síntoma. No adjuntes contenido privado ni credenciales.
