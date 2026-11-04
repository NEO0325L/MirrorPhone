# MirrorPhone

<p align="center"><img src="desktop/server/public/app-icon.png" alt="Logo de MirrorPhone" width="96"></p>

[![Build desktop](https://github.com/NEO0325L/MirrorPhone/actions/workflows/desktop.yml/badge.svg)](https://github.com/NEO0325L/MirrorPhone/actions/workflows/desktop.yml)

Pantalla y sonido del iPhone en una aplicación de escritorio para **Windows 11 x64** y **Linux Mint 22.x x64**. Receptor Electron, emisor iOS y señalización WebRTC en Cloudflare Workers con D1.

## Uso

1. Abre MirrorPhone en el ordenador y pulsa **Crear sala** en modo Internet.
2. Introduce ese código en la app del iPhone y confirma **Compartir pantalla** en el selector de iOS.
3. Pulsa **Activar sonido** en el ordenador.

No requiere introducir OWNER_KEY ni abrir una página adicional. El servidor predeterminado está en `desktop/cloud-config.json`. Wi-Fi / hotspot permite usar un servidor local; en ese modo el iPhone necesita la dirección completa que muestra el receptor.

## Instalación

- **Linux Mint:** consulta [la guía de Linux](docs/LINUX-MINT.md). El paquete recomendado es `.deb`.
- **Windows:** consulta [la guía de Windows](docs/WINDOWS.md). Instalador `.exe` o paquete ZIP completo.
- **Desde código:** Node.js 24 LTS y npm; entra en `desktop`, ejecuta `npm ci` y `npm start`.

## Compilación

```sh
cd desktop
npm ci
npm test
npm run build:linux    # En Linux: DEB y tar.gz x64
npm run build:windows  # En Windows: instalador NSIS y ZIP x64
```

Los paquetes se crean en `desktop/dist`. El flujo de GitHub Actions `desktop.yml` compila en Ubuntu y Windows y guarda los instaladores como artefactos. Se ejecuta manualmente o al publicar una etiqueta `v*`; no publica releases ni activa servicios de pago automáticamente. Revisa la cuota de Actions de tu cuenta antes de ejecutarlo en un repositorio privado.

## Estructura

- `desktop/`: código compartido del receptor de Windows y Linux, sin duplicar la lógica de audio/vídeo.
- `ios/`: emisor iPhone, basado en Build 20. Xcode, SDK y dispositivo compatibles necesarios. Selecciona tu propio equipo de firma y un identificador de paquete único. Ejecuta `python3 scripts/prepare-ios.py` para descargar WebRTC desde su distribución oficial y verificar su SHA-256.
- `cloudflare/`: Worker, esquema D1 y pruebas locales. Las claves se configuran como secretos del proveedor; no se incluyen aquí.
- `experimental/control-wifi/`: herramientas de diagnóstico de entrada para desarrolladores. **No implementa aún control del teléfono mediante teclado o ratón.**

## Estado y límites

La imagen y el audio se habían comprobado en iPhone y receptor macOS antes de esta adaptación. Los paquetes Linux y Windows necesitan validación en equipos reales; una compilación correcta no verifica controladores, audio ni aceleración gráfica de cada equipo. No se garantiza latencia cero ni 60/120 FPS constantes. Resolución y FPS son máximos; la calidad se adapta a la red.

El tráfico multimedia usa WebRTC directo cuando es posible y TURN cuando la red lo necesita. El alojamiento y el proveedor TURN tienen cuotas propias; publicar este código no garantiza servicio gratuito ilimitado. No se almacenan grabaciones de pantalla o audio. Los diagnósticos del receptor son contadores en memoria y se consultan localmente.

## Licencia

Código propio reservado, sin licencia de redistribución concedida. Dependencias de terceros conservan sus licencias; Electron incluye sus avisos en los paquetes distribuidos. El kit experimental utiliza pymobiledevice3 como dependencia separada.

## Documentación del proyecto

- [Arquitectura y flujo de datos](docs/ARCHITECTURE.md)
- [Estado y pruebas de validación](docs/VALIDATION.md)
- [Contribuciones y desarrollo](CONTRIBUTING.md)
- [Seguridad](SECURITY.md)
- [Historial de cambios](CHANGELOG.md)
- [Avisos de terceros](THIRD_PARTY_NOTICES.md)
