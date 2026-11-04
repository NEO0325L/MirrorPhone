# Componentes de terceros

| Componente | Uso | Fuente y avisos |
| --- | --- | --- |
| Electron / Chromium | Runtime de escritorio | https://github.com/electron/electron — MIT para Electron; `LICENSE` y `LICENSES.chromium.html` incluidos en cada runtime |
| electron-builder | Herramienta de empaquetado | https://github.com/electron-userland/electron-builder — MIT |
| WebRTC para iOS | Captura/transporte codificado | https://github.com/stasel/WebRTC — distribución binaria fijada y verificada por SHA-256; conservar los avisos incluidos |
| pymobiledevice3 | Diagnóstico experimental Wi-Fi | https://github.com/doronz88/pymobiledevice3 — GPL-3.0; se instala por separado y no se incluye dentro del ejecutable Electron |

El árbol exacto de herramientas JavaScript figura en `desktop/package-lock.json`. Las dependencias transitivas tienen licencias propias. Revisa sus avisos antes de redistribuir una versión. Este documento no reemplaza los textos de licencia de los componentes.
