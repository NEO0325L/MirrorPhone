'use strict';
// The receiver and its signaling server live in the same desktop process.
async function isMirrorPhone(port, minimumRevision = 0) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {signal:AbortSignal.timeout(1500), redirect:'error'});
    if (!response.ok) return false;
    const health = await response.json();
    return health.service === 'MirrorPhone' && health.version === 1 && health.remote === false && (health.receiverRevision || 0) >= minimumRevision;
  } catch { return false; }
}
async function listen(server, preferredPort = 8765, {reuseCompatible = false, minimumRevision = 0} = {}) {
  async function attempt(port) {
    return new Promise((resolve, reject) => {
      const failed = error => { server.off('listening', ready); reject(error); };
      const ready = () => { server.off('error', failed); resolve(server.address().port); };
      server.once('error', failed);
      server.once('listening', ready);
      server.listen(port, '0.0.0.0');
    });
  }
  try { return await attempt(preferredPort); }
  catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    if (reuseCompatible && await isMirrorPhone(preferredPort, minimumRevision)) {
      // Close our unused instance (including its sweep timer), never the shared server.
      server.close(() => {});
      return preferredPort;
    }
    // Use a small predictable port range when another application owns 8765.
    for (let port = preferredPort + 1; port <= preferredPort + 10; port++) {
      try { return await attempt(port); }
      catch (nextError) {
        if (nextError.code !== 'EADDRINUSE') throw nextError;
        if (reuseCompatible && await isMirrorPhone(port, minimumRevision)) {
          server.close(() => {});
          return port;
        }
      }
    }
    throw new Error('Los puertos 8765–8775 están ocupados. Cierra las otras instancias de MirrorPhone y vuelve a abrir la app.');
  }
}
module.exports = { listen, isMirrorPhone };
