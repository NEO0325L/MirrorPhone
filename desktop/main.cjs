'use strict';
const { app, BrowserWindow, dialog, Menu, session, safeStorage, shell } = require('electron');
const path = require('node:path');
const { listen } = require('./runtime.cjs');
const { createCloudBridge } = require('./cloud-bridge.cjs');
const cloudConfig=require('./cloud-config.json');
app.setName('MirrorPhone');
if (process.platform === 'win32') app.setAppUserModelId('com.mirrorphone.desktop');
let window, server, port, ownsServer = false;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.show(); window?.focus();
  });
  app.whenReady().then(async () => {
    // The portable app hosts a LAN server. Remote hosting remains a separate mode.
    for (const key of ['MIRRORPHONE_PUBLIC_URL', 'MIRRORPHONE_ACCESS_KEY', 'MIRRORPHONE_TURN_URLS', 'MIRRORPHONE_TURN_SECRET']) delete process.env[key];
    const backend=require('./server/server.js');
    server=backend.server;
    port = await listen(server, 8765, {reuseCompatible:false});
    ownsServer = server.listening;
    const origin = `http://127.0.0.1:${port}`;
    const bridge=createCloudBridge({config:cloudConfig,safeStorage,userData:app.getPath('userData'),openExternal:url=>shell.openExternal(url)});
    bridge.setLocalOrigin(origin);backend.setDesktopBridge(bridge.handle);
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
      callback(contents === window?.webContents && contents.getURL().startsWith(origin + '/') && ['clipboard-sanitized-write', 'fullscreen'].includes(permission));
    });
    session.defaultSession.setPermissionCheckHandler((contents, permission) =>
      contents === window?.webContents && contents.getURL().startsWith(origin + '/') && ['clipboard-sanitized-write', 'fullscreen'].includes(permission));
    Menu.setApplicationMenu(null);
    window = new BrowserWindow({
      width: 1180, height: 820, minWidth: 720, minHeight: 560,
      title: 'MirrorPhone', backgroundColor: '#101215', show: false,
      icon: path.join(__dirname, 'server/public/app-icon.png'),
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling:false }
    });
    window.removeMenu();
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== origin) event.preventDefault();
    });
    window.webContents.on('will-redirect', (event, url) => {
      if (new URL(url).origin !== origin) event.preventDefault();
    });
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F11') {
        event.preventDefault(); window.setFullScreen(!window.isFullScreen());
      }
    });
    window.once('ready-to-show', () => window.show());
    window.on('closed', () => { window = null; });
    await window.loadURL(origin + '/');
  }).catch(error => {
    dialog.showErrorBox('No se pudo abrir MirrorPhone', error.message);
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    if (ownsServer) { server?.close(); server?.closeAllConnections(); }
  });
}
