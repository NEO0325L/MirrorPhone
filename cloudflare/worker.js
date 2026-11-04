// MirrorPhone — Cloudflare independiente. Configurar secretos y D1 antes de conectar.
const enc=new TextEncoder(),dec=new TextDecoder();
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const un64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const random=(size=24)=>b64(crypto.getRandomValues(new Uint8Array(size)));
const fail=(status,message)=>Object.assign(new Error(message),{status});
async function mac(secret,text,hash='SHA-256') {const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(text)));}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
async function body(request){if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw fail(415,'Se requiere JSON.');const text=await request.text();if(text.length>128*1024)throw fail(413,'Solicitud demasiado grande.');try{const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw fail(400,'JSON inválido.');}}
async function signToken(env,data){const raw=b64(enc.encode(JSON.stringify(data)));return raw+'.'+b64(await mac(env.SESSION_SECRET,raw));}
async function readToken(env,request){const token=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');const [raw,sig,...extra]=token.split('.');if(!raw||!sig||extra.length)throw fail(401,'La sesión terminó. Crea una sala nueva.');const key=await crypto.subtle.importKey('raw',enc.encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);let valid=false;try{valid=await crypto.subtle.verify('HMAC',key,un64(sig),enc.encode(raw));}catch{}if(!valid)throw fail(401,'Sesión inválida.');let data;try{data=JSON.parse(dec.decode(un64(raw)));}catch{throw fail(401,'Sesión inválida.');}if(!/^\d{6}$/.test(data.code)||!['receiver','sender'].includes(data.role)||data.exp<Date.now())throw fail(401,'La sesión terminó. Crea una sala nueva.');return data;}
function validateRoom(room,session){if(!room||room.closed||Date.now()>room.expires||room[session.role]?.nonce!==session.nonce)throw fail(401,'La sala terminó. Crea una sala nueva.');}
const newPeer=()=>({nonce:random(),sequence:0,events:[],seen:Date.now()});
function emit(peer,event){peer.events.push({id:++peer.sequence,...event});if(peer.events.length>256)peer.events.shift();}
// SQLite conditional updates serialize competing peer signals without lost events.
async function readRoom(env,code){const row=await env.DB.prepare('SELECT payload, revision FROM mirror_rooms WHERE code = ?').bind(code).first();return row?{revision:row.revision,room:JSON.parse(row.payload)}:null;}
async function mutate(env,code,action){for(let i=0;i<8;i++){const row=await readRoom(env,code),room=row?.room??null;const result=await action(room);if(!row)throw fail(404,'La sala no existe.');const saved=await env.DB.prepare('UPDATE mirror_rooms SET payload = ?, revision = revision + 1, expires = ? WHERE code = ? AND revision = ?').bind(JSON.stringify(room),room.expires,code,row.revision).run();if(saved.meta.changes===1)return result;}throw fail(409,'La sala está ocupada. Intenta de nuevo.');}
// Append and number each signal in one atomic SQLite statement. No read/overwrite race.
async function appendSignal(env,session,event){
 const target=session.role==='sender'?'receiver':'sender',events=`$.${target}.events`,sequence=`$.${target}.sequence`,now=Date.now(),expires=now+30*60000;
 const result=await env.DB.prepare(`UPDATE mirror_rooms SET
 payload=json_set(
   json_insert(CASE WHEN json_array_length(payload, ?) >= 256 THEN json_remove(payload, ?) ELSE payload END,
     ?, json_set(json(?), '$.id', json_extract(payload, ?) + 1)),
   ?, json_extract(payload, ?) + 1, ?, ?, '$.expires', ?),
 revision=revision+1, expires=?
 WHERE code=? AND expires>=? AND json_extract(payload, '$.closed')=0
   AND json_extract(payload, ?)=? AND json_type(payload, ?)='object'`)
 .bind(events,events+'[0]',events+'[#]',JSON.stringify(event),sequence,sequence,sequence,`$.${session.role}.seen`,now,expires,expires,session.code,now,`$.${session.role}.nonce`,session.nonce,`$.${target}`).run();
 if(result.meta.changes===1)return{ok:true};
 const row=await readRoom(env,session.code);validateRoom(row?.room??null,session);
 throw fail(409,'El otro dispositivo se desconectó.');
}
// A fixed hashed key per IP/action bounds guesses without storing the client address.
async function limitAttempts(env,request,action,limit){
 const address=request.headers.get('CF-Connecting-IP')||'unknown';
 const code='limit:'+action+':'+b64(await mac(env.SESSION_SECRET,address));
 const now=Date.now(),expires=now+60000;
 const result=await env.DB.prepare(`INSERT INTO mirror_rooms (code,payload,revision,expires) VALUES (?, '{"count":1}',1,?)
 ON CONFLICT(code) DO UPDATE SET payload=json_object('count',CASE WHEN mirror_rooms.expires<=? THEN 1 ELSE json_extract(mirror_rooms.payload,'$.count')+1 END),
 expires=CASE WHEN mirror_rooms.expires<=? THEN ? ELSE mirror_rooms.expires END,revision=mirror_rooms.revision+1
 WHERE mirror_rooms.expires<=? OR json_extract(mirror_rooms.payload,'$.count')<?`)
 .bind(code,expires,now,now,expires,now,limit).run();
 if(result.meta.changes!==1)throw fail(429,'Demasiados intentos. Espera un minuto y vuelve a probar.');
}
async function createRoom(env){
 // Keep recently expired codes for a day, then remove a bounded batch on room creation.
 await env.DB.prepare('DELETE FROM mirror_rooms WHERE code IN (SELECT code FROM mirror_rooms WHERE expires < ? LIMIT 50)').bind(Date.now()-24*3600000).run();
 for(let i=0;i<12;i++){const code=String(100000+crypto.getRandomValues(new Uint32Array(1))[0]%900000),receiver=newPeer();const room={code,receiver,sender:null,closed:false,expires:Date.now()+30*60000};const created=await env.DB.prepare('INSERT OR IGNORE INTO mirror_rooms (code, payload, revision, expires) VALUES (?, ?, 1, ?)').bind(code,JSON.stringify(room),room.expires).run();if(created.meta.changes===1)return{code,token:await signToken(env,{code,role:'receiver',nonce:receiver.nonce,exp:Date.now()+24*3600000}),eventWait:false};}throw fail(503,'No se pudo crear la sala. Intenta de nuevo.');
}
const meteredConfigured=env=>typeof env.METERED_DOMAIN==='string'&&/^[a-z0-9-]+\.metered\.live$/.test(env.METERED_DOMAIN)&&typeof env.METERED_API_KEY==='string'&&env.METERED_API_KEY.length>0;
const hfConfigured=env=>typeof env.HF_TOKEN==='string'&&/^hf_[A-Za-z0-9]+$/.test(env.HF_TOKEN.trim());
const relayConfigured=env=>hfConfigured(env)||meteredConfigured(env)||!!(env.TURN_SECRET&&env.TURN_URLS);
function validateIceServers(data){
  if(!Array.isArray(data)||data.length===0||data.length>32)throw Error();
  const servers=data.map(server=>{
   const urls=Array.isArray(server.urls)?server.urls:[server.urls];
   if(!urls.length||urls.some(u=>typeof u!=='string'||u.length>512||!/^turns?:[a-z0-9.-]+:\d+(?:\?transport=(?:udp|tcp))?$/i.test(u)&&!/^stun:[a-z0-9.-]+:\d+$/i.test(u)))throw Error();
   const result={urls};
   if(urls.some(u=>/^turns?:/i.test(u))){if(typeof server.username!=='string'||!server.username||typeof server.credential!=='string'||!server.credential)throw Error();result.username=server.username;result.credential=server.credential;}
   return result;
  });
  if(!servers.some(s=>s.urls.some(u=>/^turns?:/i.test(u))))throw Error();
 return servers;
}
let hfCache=null;
async function hfIce(env){
 const token=env.HF_TOKEN.trim();let stage='conexión';
 if(hfCache&&hfCache.key===token&&hfCache.expires>Date.now())return hfCache.servers;
 try{
  const response=await fetch('https://fastrtc-turn-service.hf.space/credentials?ttl=3600',{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
  if(response.status===401||response.status===403)throw fail(502,'El relé rechazó el acceso. El administrador debe revisar el token HF_TOKEN y la verificación de la cuenta.');
  if(response.status===429)throw fail(503,'El relé gratuito alcanzó su límite. Intenta más tarde. No se activará un servicio de pago.');
  if(!response.ok)throw fail(502,'El servicio de relé respondió HTTP '+response.status+'.');
  stage='formato JSON';const data=await response.json();
  stage='configuración ICE';const servers=validateIceServers(data.iceServers);
  hfCache={key:token,expires:Date.now()+45000,servers};return servers;
 }catch(error){if(error.status)throw error;const kind=['TypeError','TimeoutError','AbortError','Error'].includes(error.name)?error.name:'Error';const detail=String(error.message||'').replaceAll(token,'[oculto]').replace(/hf_[A-Za-z0-9]+/g,'[oculto]').slice(0,160);throw fail(502,'No se pudo obtener el relé gratuito ('+stage+', '+kind+'): '+detail);}
}
let meteredCache=null;
async function meteredIce(env){
 if(meteredCache&&meteredCache.domain===env.METERED_DOMAIN&&meteredCache.key===env.METERED_API_KEY&&meteredCache.expires>Date.now())return meteredCache.servers;
 const url=new URL('https://'+env.METERED_DOMAIN+'/api/v1/turn/credentials');url.searchParams.set('apiKey',env.METERED_API_KEY);
 let servers;
 try{
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(8000),headers:{Accept:'application/json'}});
  if(!response.ok)throw Error();
  const data=await response.json();
  servers=validateIceServers(data);
 }catch{throw fail(502,'El relé de vídeo no respondió. Intenta de nuevo; si continúa, el administrador debe revisar la configuración TURN.');}
 meteredCache={domain:env.METERED_DOMAIN,key:env.METERED_API_KEY,expires:Date.now()+45000,servers};return servers;
}
async function ice(env,session){if(typeof env.HF_TOKEN==='string'&&env.HF_TOKEN.trim()){if(!hfConfigured(env))throw fail(503,'El administrador debe revisar el formato de HF_TOKEN.');return{iceServers:await hfIce(env),iceTransportPolicy:'all',connectionMode:'relay-available',relayProvider:'huggingface'};}if(meteredConfigured(env))return{iceServers:await meteredIce(env),iceTransportPolicy:'all',connectionMode:'relay-available'};if(!env.TURN_SECRET||!env.TURN_URLS)return{iceServers:[{urls:['stun:stun.cloudflare.com:3478']}],iceTransportPolicy:'all',connectionMode:'direct',networkWarning:'Relé pendiente: se intenta conexión directa. Algunas redes pueden impedir conectar.'};const expires=Math.floor(Date.now()/1000)+3600,username=`${expires}:${session.code}:${session.role}`;const credential=btoa(String.fromCharCode(...await mac(env.TURN_SECRET,username,'SHA-1')));return{iceServers:[{urls:env.TURN_URLS.split(','),username,credential}],iceTransportPolicy:'all',expires};}
async function sameSecret(actual,expected){
 if(typeof actual!=='string'||typeof expected!=='string'||!actual||!expected)return false;
 const a=new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(actual)));
 const b=new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(expected)));
 let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
const configured=env=>typeof env.SESSION_SECRET==='string'&&env.SESSION_SECRET.length>=32&&typeof env.DB?.prepare==='function';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function page(content,formAction="'self'"){return new Response(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MirrorPhone · Conexión privada</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101215;color:#edf3fb;font:16px system-ui}main{max-width:480px;margin:24px;padding:30px;background:#191e25;border:1px solid #334042;border-radius:20px}h1{margin-top:0;font-size:28px}p{line-height:1.6;color:#bcc8d3}button,a{display:inline-block;border:0;border-radius:10px;padding:14px 20px;background:#82d9c5;color:#102c25;font:600 16px system-ui;text-decoration:none}code{color:#82d9c5}small{color:#9ba6b6}input[type=hidden]{display:none}input[type=password]{box-sizing:border-box;width:100%;padding:12px;margin:10px 0 20px;border:1px solid #52636a;border-radius:8px;font:16px system-ui}</style><main>${content}</main></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'origin','X-Content-Type-Options':'nosniff','Content-Security-Policy':`default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}; frame-ancestors 'none'; base-uri 'none'`}});}
function deviceParams(search){const state=search.get('state')||'',pub=search.get('pub')||'',platform=search.get('platform')||'',redirect=search.get('redirect')||'';if(!/^[A-Za-z0-9_-]{32,64}$/.test(state)||!/^[A-Za-z0-9_-]{86,88}$/.test(pub)||!['ios','desktop'].includes(platform))throw fail(400,'Solicitud de dispositivo inválida.');if(platform==='desktop'){let url;try{url=new URL(redirect);}catch{throw fail(400,'Dirección de retorno inválida.');}if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.pathname!=='/api/cloud/callback'||url.search||url.hash)throw fail(400,'Dirección de retorno inválida.');}else if(redirect!=='mirrorphone://cloud-login')throw fail(400,'Retorno de iPhone inválido.');return{state,pub,platform,redirect};}
async function sealDevice(params,env,origin){const theirs=await crypto.subtle.importKey('raw',un64(params.pub),{name:'ECDH',namedCurve:'P-256'},false,[]);const ours=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);const shared=await crypto.subtle.deriveBits({name:'ECDH',public:theirs},ours.privateKey,256);const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));const material=await crypto.subtle.importKey('raw',shared,'HKDF',false,['deriveKey']);const key=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt,info:enc.encode('MirrorPhone cloud login v1:'+params.state)},material,{name:'AES-GCM',length:256},false,['encrypt']);const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(origin)},key,enc.encode(JSON.stringify({origin,token:env.DEVICE_SERVICE_TOKEN})));return b64(enc.encode(JSON.stringify({pub:b64(await crypto.subtle.exportKey('raw',ours.publicKey)),salt:b64(salt),iv:b64(iv),ciphertext:b64(ciphertext)})));}
export default {async fetch(request,env){try{
 const url=new URL(request.url),path=url.pathname;
 if(path==='/api/health'&&request.method==='GET'){let databaseReady=false;if(typeof env.DB?.prepare==='function'){try{await env.DB.prepare('SELECT code FROM mirror_rooms LIMIT 1').first();databaseReady=true;}catch{}}return json({service:'MirrorPhone',version:2,clientRevision:10,accessMode:'room-code',storage:'D1',receiverRevision:3,remote:true,eventWait:false,configured:configured(env)&&databaseReady,databaseReady,relayConfigured:relayConfigured(env),relayProvider:hfConfigured(env)?'huggingface':meteredConfigured(env)?'metered':env.TURN_SECRET&&env.TURN_URLS?'turn':null});}
 if(!configured(env))throw fail(503,'Configuración pendiente: añade SESSION_SECRET y la base D1 con binding DB.');
 // This Cloudflare deployment authenticates requests itself; it never trusts Sites identity headers.
 const serviceToken=b64(await mac(env.SESSION_SECRET,'MirrorPhone Cloudflare device access v1'));
 const origin=request.headers.get('Origin');if(origin&&origin!==url.origin)throw fail(403,'Origen no permitido.');
 if(path==='/device/connect'&&request.method==='GET'){
  const p=deviceParams(url.searchParams);const data=b64(enc.encode(JSON.stringify({...p,created:Date.now()})));const proof=b64(await mac(env.SESSION_SECRET,data));
  return page(`<h1>Conectar MirrorPhone</h1><p>Introduce tu clave privada de MirrorPhone para autorizar la app de ${p.platform==='ios'?'tu iPhone':'Windows/Mac'} para acceder a tu servicio privado. Guardará el acceso protegido en este dispositivo.</p><p>Identificador de solicitud: <code>${escape(p.state.slice(0,8))}</code></p><p>Autoriza solo si acabas de pulsar «Conectar cuenta» en tu app. Esta clave es independiente de tu contraseña de Cloudflare.</p><form method="post" action="/device/approve"><input type="hidden" name="data" value="${data}"><input type="hidden" name="proof" value="${proof}"><label for="ownerKey">Clave privada de MirrorPhone</label><input id="ownerKey" type="password" name="ownerKey" required minlength="32" maxlength="256" autocomplete="off"><button>Autorizar este dispositivo</button></form>`);
 }
 if(path==='/device/approve'&&request.method==='POST'){
  if(origin!==url.origin)throw fail(403,'Origen de autorización inválido.');const raw=await request.text();if(raw.length>8192)throw fail(413,'Solicitud demasiado grande.');const f=new URLSearchParams(raw);if(!await sameSecret(f.get('ownerKey'),env.OWNER_KEY))throw fail(401,'Clave de MirrorPhone incorrecta.');const data=f.get('data')||'',proof=f.get('proof')||'';if(proof!==b64(await mac(env.SESSION_SECRET,data)))throw fail(403,'Solicitud inválida.');const saved=JSON.parse(dec.decode(un64(data)));if(Date.now()-saved.created>5*60000||saved.created>Date.now())throw fail(403,'La autorización caducó. Abre Conectar cuenta otra vez.');const p=deviceParams(new URLSearchParams(saved));const box=await sealDevice(p,{...env,DEVICE_SERVICE_TOKEN:serviceToken},url.origin);
  if(p.platform==='ios'){const callback=`mirrorphone://cloud-login?state=${p.state}&box=${box}`;return page(`<h1>Dispositivo autorizado</h1><p>Vuelve a MirrorPhone para terminar la conexión.</p><a href="${escape(callback)}">Volver a MirrorPhone</a>`);}
  return page(`<h1>Dispositivo autorizado</h1><p>Entrega la autorización cifrada a la app que abriste en este ordenador.</p><form method="post" action="${escape(p.redirect)}"><input type="hidden" name="state" value="${p.state}"><input type="hidden" name="box" value="${box}"><button>Volver a MirrorPhone</button></form>`,new URL(p.redirect).origin);
 }

 if(path==='/api/network'&&request.method==='GET')return json({remote:true,receiverURL:url.origin,serverURLs:[url.origin],privateCloud:true});
 if(path==='/api/room'&&request.method==='POST'){await body(request);await limitAttempts(env,request,'create',10);return json(await createRoom(env),201);}
 if(path==='/api/join'&&request.method==='POST'){const data=await body(request),code=String(data.code||'').trim();if(!/^\d{6}$/.test(code))throw fail(400,'Introduce el código de seis dígitos.');await limitAttempts(env,request,'join',20);return json(await mutate(env,code,async room=>{if(!room||room.closed||room.expires<Date.now())throw fail(404,'La sala no existe o ha terminado. Crea una nueva en MirrorPhone.');if(room.sender&&Date.now()-room.sender.seen<90000)throw fail(409,'La sala ya tiene un iPhone conectado.');room.sender=newPeer();room.expires=Date.now()+30*60000;emit(room.receiver,{type:'peer-joined'});return{token:await signToken(env,{code,role:'sender',nonce:room.sender.nonce,exp:Date.now()+24*3600000})};}));}
 if(['/api/events','/api/signal','/api/leave','/api/ice'].includes(path)){
  if((path==='/api/events'||path==='/api/ice')?request.method!=='GET':request.method!=='POST')throw fail(405,'Método no admitido.');
  const session=await readToken(env,request);
  if(path==='/api/ice'){const row=await readRoom(env,session.code);validateRoom(row?.room??null,session);return json(await ice(env,session));}
  if(path==='/api/events'){const cursor=Number(url.searchParams.get('after')||0);if(!Number.isSafeInteger(cursor)||cursor<0)throw fail(400,'Cursor inválido.');const row=await readRoom(env,session.code),room=row?.room??null;validateRoom(room,session);const peer=room[session.role];if(peer.events.length&&cursor<peer.events[0].id-1)throw fail(409,'Se perdió la señalización. Vuelve a conectar.');if(Date.now()-peer.seen>15000)await mutate(env,session.code,async current=>{validateRoom(current,session);current[session.role].seen=Date.now();current[session.role].events=current[session.role].events.filter(event=>event.id>cursor);current.expires=Date.now()+30*60000;});return json({events:peer.events.filter(e=>e.id>cursor)});}
  const data=await body(request);
  if(path==='/api/signal'){
   const type=data.type;let event;
   if(type==='offer'||type==='answer'){if(type!==(session.role==='sender'?'offer':'answer')||typeof data.sdp!=='string'||data.sdp.length>100000)throw fail(400,'Descripción de conexión inválida.');event={type,sdp:data.sdp};}
   else if(type==='candidate'){if(typeof data.candidate!=='string'||data.candidate.length>4096||!Number.isInteger(data.sdpMLineIndex)||data.sdpMLineIndex<0||(data.sdpMid!==null&&typeof data.sdpMid!=='string'))throw fail(400,'Candidato inválido.');event={type,candidate:data.candidate,sdpMid:data.sdpMid,sdpMLineIndex:data.sdpMLineIndex};}else throw fail(400,'Señal no admitida.');
   return json(await appendSignal(env,session,event));
  }
  return json(await mutate(env,session.code,async room=>{validateRoom(room,session);room[session.role].seen=Date.now();room.expires=Date.now()+30*60000;
   if(path==='/api/leave'){if(session.role==='receiver'){room.closed=true;room.receiver.events=[];room.sender=null;}else{room.sender=null;emit(room.receiver,{type:'peer-left'});}return{ok:true};}

  }));
 }
 if(path==='/'&&request.method==='GET')return page('<h1>MirrorPhone</h1><p>Abre MirrorPhone en el ordenador, crea una sala e introduce su código en la app del iPhone. No se necesita cuenta ni clave de propietario.</p><small>La imagen y el sonido se transmiten con WebRTC. Este servicio conserva únicamente los datos temporales de conexión.</small>');
 return json({error:'No encontrado.'},404);
 }catch(error){return json({error:error.status?error.message:'No se pudo completar la solicitud.'},error.status||500);}}};
