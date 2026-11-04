# Componentes de terceros

La licencia MIT de la raíz cubre el código propio de MirrorPhone. No cambia las licencias de las dependencias ni sus avisos de autoría.

| Componente | Uso | Fuente y avisos |
| --- | --- | --- |
| Electron / Chromium | Runtime de escritorio | https://github.com/electron/electron — MIT para Electron; `LICENSE` y `LICENSES.chromium.html` incluidos en cada runtime |
| electron-builder | Herramienta de empaquetado | https://github.com/electron-userland/electron-builder — MIT |
| WebRTC para iOS | Captura/transporte codificado | https://github.com/stasel/WebRTC — distribución binaria fijada y verificada por SHA-256; conservar los avisos incluidos |
| pymobiledevice3 | Diagnóstico experimental Wi-Fi | https://github.com/doronz88/pymobiledevice3 — GPL-3.0; se instala por separado y no se incluye dentro del ejecutable Electron |

El árbol exacto de herramientas JavaScript figura en `desktop/package-lock.json`. Las dependencias transitivas tienen licencias propias. Revisa sus avisos antes de redistribuir una versión. Este documento no reemplaza los textos de licencia de los componentes.

## Distribución

- Conservar el texto MIT y el aviso de autoría de MirrorPhone al distribuir copias o partes sustanciales de su código.
- Conservar los archivos `LICENSE` y `LICENSES.chromium.html` del runtime Electron, además de los avisos de las demás dependencias incluidas.
- El kit experimental depende de pymobiledevice3 bajo GPL-3.0. Instalarlo por separado no elimina sus condiciones: cualquier distribución que lo incorpore o constituya una obra cubierta debe respetar la GPL correspondiente. La licencia MIT del código propio es compatible con su incorporación en una distribución GPL; no convierte el componente GPL en MIT.
- Las futuras compilaciones de escritorio incluyen el texto MIT de MirrorPhone y este documento en `resources/licenses/`. Las descargas preliminares ya publicadas se generaron antes de este cambio y no se han recompilado como parte de esta actualización de licencias.
