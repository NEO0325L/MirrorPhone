#!/usr/bin/env python3
"""Download the pinned WebRTC framework; never use local signing credentials."""
from pathlib import Path
import hashlib, tempfile, urllib.request, zipfile, shutil
URL = "https://github.com/stasel/WebRTC/releases/download/154.0.0/WebRTC-M154.xcframework.zip"
SHA256 = "a2bcdda93578c82452ceb6e49d54a2746e1bcb4caf7c2fa601ffac8028b58c16"
dest = Path(__file__).resolve().parents[1] / "ios" / "Vendor"
if (dest / "WebRTC.xcframework").exists():
    raise SystemExit("WebRTC ya existe; no se reemplazó. Elimina la dependencia manualmente para descargarla otra vez.")
with tempfile.TemporaryDirectory() as directory:
    archive = Path(directory) / "WebRTC.zip"
    urllib.request.urlretrieve(URL, archive)
    if hashlib.file_digest(archive.open("rb"), "sha256").hexdigest() != SHA256:
        raise SystemExit("SHA-256 incorrecto; descarga rechazada.")
    unpacked = Path(directory) / "unpacked"
    with zipfile.ZipFile(archive) as package:
        for entry in package.infolist():
            target = (unpacked / entry.filename).resolve()
            if not target.is_relative_to(unpacked.resolve()):
                raise SystemExit("Ruta inválida en el archivo.")
        package.extractall(unpacked)
    matches = list(unpacked.rglob("WebRTC.xcframework"))
    if len(matches) != 1:
        raise SystemExit("No se encontró un único framework.")
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copytree(matches[0], dest / "WebRTC.xcframework")
print("WebRTC descargado y SHA-256 verificado. Abre ios/MirrorPhone.xcodeproj en Xcode.")
