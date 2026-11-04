# Desarrollo y contribuciones

## Preparación

Usa Node.js 24 LTS y npm. Clona el repositorio y ejecuta `npm ci` en `desktop`. El archivo de bloqueo fija el árbol de dependencias; evita sustituirlo por instalaciones globales.

```sh
cd desktop
npm ci
npm test
node ../cloudflare/check-worker.mjs
npm start
```

## Organización de cambios

Mantén una sola implementación de escritorio para Windows y Linux. Añade diferencias de plataforma únicamente donde sean necesarias. Mantén las herramientas de control Wi-Fi en `experimental` hasta verificar entrada real en las plataformas objetivo.

Crea una rama descriptiva y commits pequeños. La pull request debe explicar el problema, el comportamiento resultante, las pruebas realizadas y las plataformas no comprobadas. No presentes la compilación como prueba física de imagen, audio o latencia.

## Compilación y publicación

`npm run build:linux` se ejecuta en Linux; `npm run build:windows`, en Windows. GitHub Actions proporciona ambos entornos. Las compilaciones se solicitan manualmente o mediante etiquetas `v*`; los ejecutables se guardan como artefactos. Publicar una release requiere seleccionar explícitamente los paquetes y documentar su estado de validación.

No subas `node_modules`, paquetes de distribución al historial Git, credenciales, archivos de emparejamiento, certificados, perfiles de firma, vídeos, capturas personales ni diagnósticos de sesiones reales. Distribuye binarios mediante Releases y dependencias grandes mediante descargas verificadas.

Antes de una versión, sigue [VALIDATION.md](docs/VALIDATION.md). La política de licencia se encuentra en `LICENSE`; que el código sea público no concede automáticamente una licencia de redistribución.
