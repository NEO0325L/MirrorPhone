'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const allowed=new Set(['/api/health','/api/network','/api/room','/api/join','/api/events','/api/signal','/api/leave','/api/ice']);
const fail=(status,message)=>Object.assign(new Error(message),{status});
function originOf(value){const url=new URL(value);if(url.protocol!=='https:'||!(url.hostname.endsWith('.chatgpt.site')||url.hostname==='mirrorphone-server.caradeboli.workers.dev')||url.username||url.password||url.search||url.hash||(url.pathname!==''&&url.pathname!=='/'))throw fail(400,'Usa el enlace HTTPS privado de MirrorPhone de tu servidor.');return url.origin;}
function decryptBox(box,state,privateKey,origin){const value=JSON.parse(Buffer.from(box,'base64url'));const pub=Buffer.from(value.pub,'base64url');if(pub.length!==65)throw fail(400,'Autorización inválida.');const publicKey=crypto.createPublicKey({key:{kty:'EC',crv:'P-256',x:pub.subarray(1,33).toString('base64url'),y:pub.subarray(33).toString('base64url')},format:'jwk'});const shared=crypto.diffieHellman({privateKey,publicKey});const key=crypto.hkdfSync('sha256',shared,Buffer.from(value.salt,'base64url'),Buffer.from('MirrorPhone cloud login v1:'+state),32);const cipher=Buffer.from(value.ciphertext,'base64url');const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(value.iv,'base64url'));decipher.setAAD(Buffer.from(origin));decipher.setAuthTag(cipher.subarray(-16));const result=JSON.parse(Buffer.concat([decipher.update(cipher.subarray(0,-16)),decipher.final()]));if(result.origin!==origin||typeof result.token!=='string'||result.token.length<24)throw fail(400,'La autorización corresponde a otro servicio.');return result.token;}
async function readBody(req,limit=32768){let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>limit)throw fail(413,'Solicitud demasiado grande.');chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');}
function reply(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
function createCloudBridge({config,safeStorage,userData,openExternal,fetcher=fetch}){
 const secureStorage=()=>safeStorage.isEncryptionAvailable()&&safeStorage.getSelectedStorageBackend?.()!=='basic_text';
 const file=path.join(userData,'mirrorphone-cloud.enc');let token='',mode=config.defaultMode==='internet'?'internet':'local',origin=config.origin?originOf(config.origin):'',pending=null,localOrigin='',relayConfigured=null;
 try{if(secureStorage()&&fs.existsSync(file)){const saved=JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));if(saved.origin===origin&&origin){token=saved.token;mode='internet';}}}catch{}
 const codeOnly=origin==='https://mirrorphone-server.caradeboli.workers.dev';
 function status(){return{mode,origin,codeOnly,published:config.published&&!!origin,connected:codeOnly||!!token,relayConfigured,secureStorage:secureStorage()};}
 function sameLocal(req){const remote=req.socket.remoteAddress;if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote))throw fail(403,'Configura la cuenta desde este ordenador.');if(req.headers.origin&&req.headers.origin!==localOrigin)throw fail(403,'Origen no permitido.');}
 async function handle(req,res){const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/cloud/callback'){
   if(req.method!=='POST'||!pending||Date.now()-pending.created>5*60000)throw fail(403,'La autorización terminó. Pulsa Conectar cuenta de nuevo.');
   if(req.headers.origin!==origin)throw fail(403,'Origen de autorización inválido.');
   const data=new URLSearchParams(await readBody(req));if(data.get('state')!==pending.state)throw fail(403,'La autorización no pertenece a esta app.');
   token=decryptBox(data.get('box')||'',pending.state,pending.privateKey,origin);pending=null;mode='internet';
   if(secureStorage()){fs.mkdirSync(userData,{recursive:true});fs.writeFileSync(file,safeStorage.encryptString(JSON.stringify({origin,token})),{mode:0o600});}
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"});res.end('<h1>MirrorPhone conectado</h1><p>Vuelve a la app y crea una sala.</p>');return true;
  }
  if(url.pathname.startsWith('/api/cloud/')){
   sameLocal(req);
   if(url.pathname==='/api/cloud/status'&&req.method==='GET'){reply(res,200,status());return true;}
   if(req.method!=='POST')throw fail(405,'Método no admitido.');
   const data=JSON.parse(await readBody(req)||'{}');
   if(url.pathname==='/api/cloud/mode'){if(!['local','internet'].includes(data.mode))throw fail(400,'Modo inválido.');mode=data.mode;reply(res,200,status());return true;}
   if(url.pathname==='/api/cloud/login'){
    if(!config.published||!origin)throw fail(503,'El servicio remoto está pendiente de publicación. Puedes usar el modo Wi-Fi mientras tanto.');
    const health=await fetcher(new URL('/api/health',origin),{redirect:'error',signal:AbortSignal.timeout(10000)});
    const info=await health.json();if(!health.ok||info.service!=='MirrorPhone'||![1,2].includes(info.version)||info.configured===false)throw fail(503,'El servidor remoto aún no está configurado. Revisa D1 y los secretos.');
    relayConfigured=info.relayConfigured??null;
    const pair=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=pair.publicKey.export({format:'jwk'}),pub=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('base64url');
    pending={state:crypto.randomBytes(24).toString('base64url'),privateKey:pair.privateKey,created:Date.now()};
    const auth=new URL('/device/connect',origin);auth.search=new URLSearchParams({state:pending.state,pub,platform:'desktop',redirect:localOrigin+'/api/cloud/callback'}).toString();await openExternal(auth.href);reply(res,200,{waiting:true,request:pending.state.slice(0,8)});return true;
   }
   if(url.pathname==='/api/cloud/logout'){pending=null;token='';mode='local';try{fs.unlinkSync(file);}catch{}reply(res,200,status());return true;}
   throw fail(404,'No encontrado.');
  }
  if(mode!=='internet'||!allowed.has(url.pathname))return false;
  // The desktop-only API is proxied by the main process; the renderer never sees the service credential.
  sameLocal(req);
  if(url.pathname==='/api/network'){reply(res,200,{remote:true,privateCloud:true,receiverURL:origin,serverURLs:origin?[origin]:[],pending:!config.published});return true;}
  if(!config.published||!origin)throw fail(503,'El servidor de internet todavía no está publicado. Selecciona Wi-Fi / hotspot para probar localmente.');
  if(!token&&!codeOnly)throw fail(401,'Pulsa Conectar cuenta para autorizar este ordenador.');
  const headers={};if(token&&!codeOnly)headers[new URL(origin).hostname.endsWith('.chatgpt.site')?'OAI-Sites-Authorization':'X-MirrorPhone-Authorization']='Bearer '+token;if(req.headers.authorization)headers.Authorization=req.headers.authorization;if(req.headers['content-type'])headers['Content-Type']=req.headers['content-type'];
  const response=await fetcher(new URL(url.pathname+url.search,origin),{method:req.method,headers,body:['POST','PUT'].includes(req.method)?await readBody(req,131072):undefined,redirect:'error',signal:AbortSignal.timeout(25000)});
  const content=await response.text();if(!response.headers.get('Content-Type')?.includes('application/json'))throw fail(502,'El servicio remoto no respondió como MirrorPhone. Revisa la publicación y la cuenta.');
  res.writeHead(response.status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(content);return true;
 }
 return{handle,status,setLocalOrigin(value){localOrigin=value;}};
}
module.exports={createCloudBridge,decryptBox,originOf};
