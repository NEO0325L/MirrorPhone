# Linux Mint

Objetivo inicial: Linux Mint 22.x, procesador Intel/AMD de 64 bits y sesión Cinnamon/X11. No se ha validado físicamente en Mint todavía.

## Instalación recomendada

Descarga el paquete `MirrorPhone-1.3.0-linux-amd64.deb` (el nombre puede indicar x64 según la herramienta de compilación), abre la carpeta de descarga y haz doble clic. Usa el instalador de paquetes de Mint. También puedes abrir una terminal en esa carpeta y ejecutar:

```sh
sudo apt install ./MirrorPhone-1.3.0-linux-amd64.deb
```

Sustituye el nombre por el del archivo descargado. Luego busca **MirrorPhone** en el menú de aplicaciones. No necesitas instalar Node.js para usar la versión empaquetada.

## Prueba

Crea una sala, escribe el código en el iPhone, confirma compartir pantalla y activa el sonido en MirrorPhone. Comprueba imagen vertical/horizontal, pantalla completa con F11, audio, reconexión y una reproducción de al menos dos minutos. Comprueba el dispositivo de salida de audio de Mint si no escuchas nada.

En modo Internet no se requiere abrir un puerto entrante en el router. En modo Wi-Fi local, el firewall debe permitir únicamente las conexiones necesarias desde tu red privada al puerto mostrado por la app; no desactives el firewall.

## Archivo tar.gz

Es un paquete alternativo para extraer y ejecutar `./mirrorphone`. Conserva todos los archivos, incluidas las licencias. Algunas distribuciones requieren instalar el sandbox de Chromium mediante el paquete DEB; por eso se recomienda el instalador. No ejecutes la app como root ni agregues `--no-sandbox`. Si aparece un error de sandbox, instala el DEB y conserva el mensaje para diagnosticarlo.

## Compilar en Mint

Instala Node.js 24 LTS con npm desde su distribución oficial. En la carpeta `desktop`:

```sh
npm ci
npm test
npm run build:linux
```

La primera compilación descarga Electron y las herramientas oficiales del empaquetador. Los artefactos quedan en `dist`. No se requiere cambiar la app iOS por usar Mint como receptor.
