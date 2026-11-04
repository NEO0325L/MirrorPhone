'use strict';
// Node.js 22+; no npm packages. The server carries signaling, never screen video.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {readConfig,requireAccess,networkInfo,iceConfiguration}=require('./network');
const config=readConfig();
let desktopBridge=null, lastDiagnostics=null;

const rooms = new Map(), sessions = new Map(), attempts = new Map();
const publicDir = path.join(__dirname, 'public');
const ttl = 90_000;
// A displayed pairing code must survive a pause/lock while the user switches devices.
const receiverTTL = 30 * 60_000;
function reply(res, status, value) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'});
  res.end(JSON.stringify(value));
}
function fail(status, message) { return Object.assign(new Error(message), {status}); }
function wake(session) { for (const complete of session?.waiters || []) complete(); }
function emit(session, message) {
  if (!session) return;
  session.events.push({id: ++session.sequence, ...message});
  if (session.events.length > 256) session.events.shift();
  wake(session);
}
function remove(session) {
  if (!session || !sessions.has(session.token)) return;
  sessions.delete(session.token);
  wake(session);
  const room = session.room;
  if (session.role === 'receiver') {
    sessions.delete(room.sender?.token);
    wake(room.sender);
    rooms.delete(room.code);
  } else {
    room.sender = null;
    emit(room.receiver, {type:'peer-left'});
  }
}
function createSession(room, role) {
  const session = {token:crypto.randomBytes(24).toString('hex'), room, role,
    events:[], waiters:new Set(), sequence:0, lastSeen:Date.now()};
  sessions.set(session.token, session);
  return session;
}
function waitForEvent(session,res,milliseconds) {
  if (session.waiters.size >= 2) throw fail(429,'Hay demasiadas consultas simultáneas en esta sesión.');
  return new Promise(resolve => {
    const complete=()=>{clearTimeout(timer);session.waiters.delete(complete);res.off('close',complete);resolve();};
    const timer=setTimeout(complete,milliseconds);
    session.waiters.add(complete);res.once('close',complete);
  });
}
async function body(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json'))
    throw fail(415, 'Se requiere JSON.');
  let size = 0, chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 128 * 1024) throw fail(413, 'Solicitud demasiado grande.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value;
  }
  catch { throw fail(400, 'JSON inválido.'); }
}
function authorize(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
  const session = sessions.get(token);
  if (!session) throw fail(401, 'La sala terminó. Crea una nueva conexión.');
  session.lastSeen = Date.now();
  return session;
}
const server = http.createServer(async (req, res) => {
  try {
    if(desktopBridge && await desktopBridge(req,res))return;
    // Browser requests must originate in this server. Native iOS has no Origin.
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== config.publicURL)
      throw fail(403, 'Origen no permitido.');
    const url = new URL(req.url, 'http://localhost');
    if(url.pathname==='/api/diagnostics'){
      if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))throw fail(403,'Diagnóstico disponible solo en este ordenador.');
      if(req.method==='GET')return reply(res,200,lastDiagnostics||{state:'waiting'});
      if(req.method!=='POST')throw fail(405,'Método no admitido.');
      const data=await body(req);const fields=['senderAdaptiveFPS','senderAdaptiveWidth','senderAdaptiveHeight','senderHardwareBitrate','senderHardwareFPS','senderHardwareBytes','senderHardwareQP','senderCaptured','senderRendered','senderSilent','senderDropped','senderCoalesced','senderTickBatch','senderRenderErrors','senderQueued','senderVideoCallbacks','senderVideoComplete','senderVideoSubmitted','senderTargetFPS','senderCodecPreferenceApplied','senderH264Available','senderVideoEncoded','senderVideoSent','senderVideoFPS','senderVideoTargetBitrate','senderVideoRetransmits','senderVideoPLI','senderBandwidth','senderEncodeTime','senderEncoder','senderVideoLimit','senderVideoCodec','senderValidatedH264Level','senderVideoProfile','state','audioPackets','audioBytes','audioEnergy','audioSamples','audioLevel','audioLost','audioConcealed','audioJitter','audioBuffer','playerState','playerEnabled','playerVolume','playerLatency','trackMuted','trackEnabled','videoProfile','videoCodec','videoDecoder','videoDecodeTime','videoProcDelay','videoDropped','videoFreezes','videoWidth','videoHeight','videoQP','videoFrames','videoBytes','videoFPS','videoBuffer','roundTrip','transport','localCandidate','remoteCandidate'];
      const clean={at:Date.now()};for(const key of fields){const v=data[key];if(typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)||typeof v==='string'&&v.length<=48)clean[key]=v;}
      lastDiagnostics=clean;return reply(res,200,{ok:true});
    }
    if (url.pathname === '/api/health' && req.method === 'GET')
      return reply(res, 200, {service:'MirrorPhone', version:1, control:false, receiverRevision:3, eventWait:true, remote:!!config.publicURL});
    if (url.pathname === '/api/network' && req.method === 'GET')
      return reply(res, 200, networkInfo(config,server.address()?.port||8765));
    if (url.pathname === '/api/ice' && req.method === 'GET')
      return reply(res, 200, iceConfiguration(config,authorize(req)));
    if (url.pathname === '/api/room' && req.method === 'POST') {
      const data = await body(req);
      if (!requireAccess(config,data.accessKey)) throw fail(401,'Introduce la clave de acceso del servidor remoto.');
      if (rooms.size >= 32) throw fail(429, 'Hay demasiadas salas abiertas.');
      let code;
      do { code = String(crypto.randomInt(100000, 1000000)); } while (rooms.has(code));
      const room = {code, receiver:null, sender:null};
      room.receiver = createSession(room, 'receiver');
      rooms.set(code, room);
      return reply(res, 201, {code, token:room.receiver.token, eventWait:true});
    }
    if (url.pathname === '/api/join' && req.method === 'POST') {
      const address = req.socket.remoteAddress;
      const now = Date.now();
      let limit = attempts.get(address);
      if (!limit || limit.until < now) { limit = {count:0, until:now+60_000}; attempts.set(address,limit); }
      if (++limit.count > 12) throw fail(429, 'Espera un minuto antes de volver a conectar.');
      const data = await body(req);
      if (!requireAccess(config,data.accessKey)) throw fail(401,'Clave de acceso del servidor remoto incorrecta.');
      const code = String(data.code || '').trim();
      if (!/^\d{6}$/.test(code)) throw fail(400, 'Introduce el código de seis dígitos de la sala.');
      const room = rooms.get(code);
      if (!room) throw fail(404, `Este servidor (${req.headers.host}) no tiene esa sala. Comprueba que la dirección y el puerto del iPhone coincidan con los de la app de escritorio, y crea una sala nueva si cerraste el receptor.`);
      if (room.sender) throw fail(409, 'La sala ya tiene un emisor conectado.');
      room.sender = createSession(room, 'sender');
      emit(room.receiver, {type:'peer-joined'});
      return reply(res, 200, {token:room.sender.token});
    }
    if (url.pathname === '/api/events' && req.method === 'GET') {
      const session = authorize(req);
      const cursor = Number(url.searchParams.get('after') || 0);
      if (!Number.isSafeInteger(cursor) || cursor < 0) throw fail(400,'Cursor inválido.');
      if (session.events.length && cursor < session.events[0].id - 1)
        throw fail(409, 'Se perdió la señalización. Vuelve a conectar.');
      const seconds=Number(url.searchParams.get('wait')||0);
      if(!Number.isInteger(seconds)||seconds<0||seconds>20)throw fail(400,'Espera inválida.');
      if(seconds && !session.events.some(e=>e.id>cursor))await waitForEvent(session,res,seconds*1000);
      if(res.destroyed)return;
      if(!sessions.has(session.token))throw fail(401,'La sala terminó. Crea una nueva conexión.');
      session.lastSeen=Date.now();
      return reply(res, 200, {events:session.events.filter(e=>e.id>cursor)});
    }
    if (url.pathname === '/api/signal' && req.method === 'POST') {
      const session = authorize(req), data = await body(req);
      const type = data.type;
      if (type === 'offer' || type === 'answer') {
        if (type !== (session.role === 'sender' ? 'offer' : 'answer') ||
            typeof data.sdp !== 'string' || data.sdp.length > 100_000)
          throw fail(400, 'Descripción de conexión inválida.');
      } else if (type === 'candidate') {
        if (typeof data.candidate !== 'string' || data.candidate.length > 4096 ||
            !Number.isInteger(data.sdpMLineIndex) || data.sdpMLineIndex < 0 ||
            (data.sdpMid !== null && typeof data.sdpMid !== 'string'))
          throw fail(400, 'Candidato de red inválido.');
      } else throw fail(400, 'Señal no admitida.');
      const peer = session.role === 'sender' ? session.room.receiver : session.room.sender;
      if (!peer) throw fail(409, 'El otro dispositivo se desconectó.');
      emit(peer, type === 'candidate'
        ? {type, candidate:data.candidate, sdpMid:data.sdpMid, sdpMLineIndex:data.sdpMLineIndex}
        : {type, sdp:data.sdp});
      return reply(res, 200, {ok:true});
    }
    if (url.pathname === '/api/leave' && req.method === 'POST') {
      remove(authorize(req));
      return reply(res, 200, {ok:true});
    }
    const assets = {'/':'index.html','/receiver.js':'receiver.js','/viewer.js':'viewer.js','/audio-player.js':'audio-player.js','/cloud-ui.js':'cloud-ui.js','/style.css':'style.css',
      '/app-icon.png':'app-icon.png','/test-sender':'test-sender.html','/test-sender.js':'test-sender.js'};
    if (req.method === 'GET' && assets[url.pathname]) {
      const file = path.join(publicDir, assets[url.pathname]);
      const content = fs.readFileSync(file);
      const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'}[path.extname(file)];
      res.writeHead(200, {'Content-Type':mime.startsWith('text/')?`${mime}; charset=utf-8`:mime, 'Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
        'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; frame-ancestors 'none'"});
      return res.end(content);
    }
    reply(res, 404, {error:'No encontrado.'});
  } catch (error) { reply(res, error.status || 500, {error:error.status ? error.message : 'Error del servidor.'}); }
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
const sweep = setInterval(() => {
  for (const session of sessions.values()) if (!session.waiters.size && Date.now() - session.lastSeen > (session.role === 'receiver' ? receiverTTL : ttl)) remove(session);
  for (const [key,value] of attempts) if (value.until < Date.now()) attempts.delete(key);
}, 10_000);
sweep.unref();
server.on('close', () => clearInterval(sweep));
if (require.main === module) {
  const port = Number(process.env.MIRRORPHONE_PORT || 8765);
  server.on('error', e => { console.error(`No se pudo iniciar: ${e.message}`); process.exitCode=1; });
  server.listen(port, process.env.MIRRORPHONE_BIND || (config.publicURL?'127.0.0.1':'0.0.0.0'), () => {
    console.log(`\nMirrorPhone — deja esta ventana abierta.\nReceptor: ${config.publicURL||`http://localhost:${port}`}\n`);
    for (const address of networkInfo(config,port).serverURLs)
      console.log(`Servidor para introducir en el iPhone: ${address}`);
    console.log(config.publicURL?'\nModo remoto: HTTPS y TURN configurados. Ctrl+C para detener.':'\nWi-Fi o hotspot. La página actualiza la IP automáticamente. Ctrl+C para detener.');
    if (process.argv.includes('--open')) {
      const {spawn} = require('node:child_process');
      if (process.platform === 'win32') spawn('cmd.exe',['/c','start','',config.publicURL||`http://localhost:${port}`],{stdio:'ignore'});
      else if (process.platform === 'darwin') spawn('open',[config.publicURL||`http://localhost:${port}`],{stdio:'ignore'});
    }
  });
}
module.exports = {server, setDesktopBridge(handler){desktopBridge=handler;}};
