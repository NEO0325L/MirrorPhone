"""Prueba de emparejamiento Wi-Fi iOS27+. No inyecta entradas al comprobar."""
import argparse
import asyncio
import contextlib
import importlib.metadata
import json
import os
from pathlib import Path
from unittest.mock import patch

VERSION = '11.33.1'
ROOT = Path.home() / '.mirrorphone-control'
STATE = ROOT / 'device.json'
os.umask(0o077)


def save_target(target):
    if not isinstance(target, str) or not target or len(target)>100 or any(not (c.isalnum() or c=='-') for c in target):
        raise ValueError('Identificador de dispositivo inválido.')
    ROOT.mkdir(parents=True,exist_ok=True)
    STATE.write_text(json.dumps({'target':target}),encoding='utf-8')


def load_target():
    if not STATE.exists():
        raise RuntimeError('Primero ejecuta 2 - Emparejar por WiFi.cmd.')
    target=json.loads(STATE.read_text(encoding='utf-8')).get('target')
    if not isinstance(target,str) or not target or len(target)>100 or any(not (c.isalnum() or c=='-') for c in target):
        raise RuntimeError('El registro local del dispositivo no es válido.')
    return target


@contextlib.asynccontextmanager
async def wifi_rsd(target):
    from pymobiledevice3.remote import userspace_tunnel, tunnel_service
    # This pinned library tries USB before Wi-Fi. Select its paired Wi-Fi
    # provider explicitly inside this isolated process; do not touch the OS,
    # other processes, trust records or the library's cryptographic checks.
    async def provider(serial, autopair, remotepairing_fallback=True):
        if serial != target:
            raise RuntimeError('Dispositivo inesperado.')
        services=await tunnel_service.get_remote_pairing_tunnel_services(udid=target)
        if not services:
            raise RuntimeError('iPhone no encontrado por Wi-Fi. Revisa la misma red, el emparejamiento y mDNS.')
        chosen=services[0]
        for other in services[1:]:
            await other.close()
        return chosen,None
    tunnel=userspace_tunnel.UserspaceRsdTunnel(serial=target,autopair=False)
    try:
        with patch.object(userspace_tunnel,'_create_no_root_tunnel_provider',provider):
            rsd=await asyncio.wait_for(tunnel.aopen(),timeout=35)
        yield rsd
    finally:
        await tunnel.aclose()


async def pair():
    from pymobiledevice3.remote.tunnel_service import PairableHostInfo, serve_pairable_host
    print('El iPhone y Windows deben estar en la misma red Wi-Fi. No requiere Bluetooth ni USB.',flush=True)
    print('En iOS27 abre Ajustes > Privacidad y seguridad > Modo de desarrollador; busca el PC para emparejar.',flush=True)
    print('Según la versión, la lista está en Ajustes > Desarrollador > Macs emparejadas.',flush=True)
    print('Selecciona MirrorPhone-Windows y escribe el PIN que aparecerá aquí al iniciar el emparejamiento.',flush=True)
    print('Esta autorización concede acceso de desarrollo a ESTE PC. Continúa solo con tu iPhone.',flush=True)
    def pin(value): print('\nPIN de autorización de iOS (no es el código de sala): '+value+'\n',flush=True)
    def waiting(elapsed): print('Esperando que selecciones MirrorPhone-Windows en el iPhone...',flush=True)
    result=await serve_pairable_host(PairableHostInfo(name='MirrorPhone-Windows'),pin_callback=pin,timeout=180,waiting_callback=waiting)
    if not result.peer_device.udid:
        raise RuntimeError('El iPhone no entregó un identificador. No se seleccionará otro dispositivo automáticamente.')
    save_target(result.peer_device.udid)
    print('Emparejamiento guardado en el perfil local de este usuario. No se envió a Cloudflare.',flush=True)
    print('Ahora ejecuta 3 - Comprobar control WiFi.cmd.',flush=True)


async def check(mount=False):
    from pymobiledevice3.remote.core_device.hid_service import UniversalHIDServiceService
    from pymobiledevice3.exceptions import AlreadyMountedError
    target=load_target()
    async with wifi_rsd(target) as rsd:
        if mount:
            from pymobiledevice3.services.mobile_image_mounter import auto_mount
            print('Preparando componentes de desarrollo Apple; puede necesitar una descarga.',flush=True)
            try: await asyncio.wait_for(auto_mount(rsd),timeout=180)
            except AlreadyMountedError: pass
        async with UniversalHIDServiceService(rsd) as hid:
            response=await asyncio.wait_for(hid.list_connected_services(),timeout=15)
            ids=[s.get('_ServiceID') for s in response.get('connectedServices',[]) if isinstance(s,dict)]
            ready=257 in ids or 1281 in ids
            report={'wifiConnected':True,'hidServiceAvailable':True,'touchSurfaceAvailable':ready,'inputSent':False,'windowsInputVerified':False}
            ROOT.mkdir(parents=True,exist_ok=True)
            (ROOT/'resultado.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
            print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)
            print('Conexión y superficies comprobadas. Todavía falta validar clics y teclado e integrarlos en MirrorPhone.',flush=True)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=['pair','check','prepare'])
    args=parser.parse_args()
    if importlib.metadata.version('pymobiledevice3') != VERSION:
        raise RuntimeError('Ejecuta la preparación: esta prueba requiere pymobiledevice3 '+VERSION)
    # Never print tracebacks that could include pairing protocol payloads/keys.
    try:
        if args.action=='pair': asyncio.run(pair())
        else: asyncio.run(check(mount=args.action=='prepare'))
    except KeyboardInterrupt: print('Prueba detenida. No se cambió la transmisión de MirrorPhone.')
    except asyncio.TimeoutError: print('Tiempo agotado. Revisa la misma red y que iOS esté desbloqueado.');return 2
    except Exception as error:
        print('No se pudo completar la prueba ('+type(error).__name__+').')
        print('Verifica el emparejamiento, la red local, Modo de desarrollador y los componentes de desarrollo.')
        print('Si el servicio HID no está preparado, ejecuta 4 - Preparar componentes Apple.cmd.')
        return 2
    return 0


if __name__=='__main__': raise SystemExit(main())
