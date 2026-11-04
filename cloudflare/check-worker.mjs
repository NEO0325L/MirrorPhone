import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(await readFile(new URL('./worker.js',import.meta.url))).toString('base64'));
const mac=async(s,t)=>{const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(s),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Buffer.from(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(t))).toString('base64url')};
import {DatabaseSync} from 'node:sqlite';
class D1 {
 constructor(initialize=true){this.sqlite=new DatabaseSync(':memory:');if(initialize)this.sqlite.exec(schema);}
 prepare(sql){const db=this;let args=[];return {bind(...values){args=values;return this;},async first(){const row=db.sqlite.prepare(sql).get(...args)??null;await new Promise(r=>setTimeout(r,3));return row;},async run(){await new Promise(r=>setTimeout(r,3));const result=db.sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:Number(result.changes)}};}};}
}
const schema=await readFile(new URL('./schema.sql',import.meta.url),'utf8');
const env={DB:new D1(),SESSION_SECRET:'test-only-session-secret-32-characters-long',OWNER_KEY:'test-only-owner-key-32-characters-long',TURN_SECRET:'public-test',TURN_URLS:'turn:turn.example:443?transport=tcp'};
const serviceToken=await mac(env.SESSION_SECRET,'MirrorPhone Cloudflare device access v1');
async function api(route,data,token,headers={}){const r=await worker.fetch(new Request('https://mirrorphone.example'+route,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{}),...headers},body:data===undefined?undefined:JSON.stringify(data)}),env);return{status:r.status,data:await r.json()};}
let health=await api('/api/health');assert.equal(health.data.configured,true);assert.equal(health.data.storage,'D1');
const empty=await worker.fetch(new Request('https://mirrorphone.example/api/health'),{...env,DB:new D1(false)});assert.equal((await empty.json()).configured,false);
const staleRoom={code:'000001',expires:Date.now()-25*3600000};await env.DB.prepare('INSERT OR IGNORE INTO mirror_rooms (code,payload,revision,expires) VALUES (?,?,1,?)').bind(staleRoom.code,JSON.stringify(staleRoom),staleRoom.expires).run();
const room=await api('/api/room',{});assert.equal(room.status,201);assert.equal(await env.DB.prepare('SELECT code FROM mirror_rooms WHERE code = ?').bind('000001').first(),null);const sender=await api('/api/join',{code:room.data.code});assert.equal(sender.status,200);assert.equal((await api('/api/join',{code:room.data.code})).status,409);
await Promise.all(Array.from({length:40},(_,i)=>api('/api/signal',{type:'candidate',candidate:'candidate-'+i,sdpMid:'0',sdpMLineIndex:0},sender.data.token).then(r=>assert.equal(r.status,200))));
const direct=await worker.fetch(new Request('https://mirrorphone.example/api/ice',{headers:{Authorization:'Bearer '+sender.data.token,'X-MirrorPhone-Authorization':'Bearer '+serviceToken}}),{...env,TURN_SECRET:undefined,TURN_URLS:undefined});assert.equal(direct.status,200);assert.equal((await direct.json()).connectionMode,'direct');
const events=await api('/api/events?after=0',undefined,room.data.token);assert.equal(events.data.events.length,41);assert.equal(new Set(events.data.events.map(e=>e.id)).size,41);
assert.equal((await api('/api/signal',{type:'offer',sdp:'test'},room.data.token)).status,400);assert.equal((await api('/api/signal',{type:'offer',sdp:'test'},sender.data.token)).status,200);
assert.equal((await api('/api/ice',undefined,sender.data.token)).data.iceServers[0].urls.length,1);assert.equal((await api('/api/room',{},null,{Origin:'https://evil.example'})).status,403);assert.equal((await api('/api/events',undefined,sender.data.token+'x')).status,401);
// More than the old 8-retry budget, with asynchronous database latency and both peers.
const originalNow=Date.now;const shifted=originalNow()+20000;Date.now=()=>shifted;
try{
 await Promise.all([
  api('/api/events?after=0',undefined,room.data.token).then(r=>assert.equal(r.status,200)),
  ...Array.from({length:100},(_,i)=>api('/api/signal',{type:'candidate',candidate:'duplex-sender-'+i,sdpMid:'0',sdpMLineIndex:0},sender.data.token).then(r=>assert.equal(r.status,200))),
  ...Array.from({length:100},(_,i)=>api('/api/signal',{type:'candidate',candidate:'duplex-receiver-'+i,sdpMid:'0',sdpMLineIndex:0},room.data.token).then(r=>assert.equal(r.status,200)))
 ]);
}finally{Date.now=originalNow;}
const bidirectional=await api('/api/events?after=0',undefined,sender.data.token);assert.equal(bidirectional.status,200);assert.equal(bidirectional.data.events.length,100);assert.equal(new Set(bidirectional.data.events.map(e=>e.id)).size,100);
await Promise.all(Array.from({length:300},(_,i)=>api('/api/signal',{type:'candidate',candidate:'bounded-'+i,sdpMid:'0',sdpMLineIndex:0},sender.data.token).then(r=>assert.equal(r.status,200))));
const stored=JSON.parse((await env.DB.prepare('SELECT payload FROM mirror_rooms WHERE code = ?').bind(room.data.code).first()).payload);
assert.equal(stored.receiver.events.length,256);assert.equal(new Set(stored.receiver.events.map(e=>e.id)).size,256);assert.equal(stored.receiver.events.at(-1).id,stored.receiver.sequence);
assert.ok(stored.receiver.events.every((e,i,a)=>i===0||e.id===a[i-1].id+1));
assert.equal((await api('/api/events?after=0',undefined,room.data.token)).status,409);
const retained=await api('/api/events?after='+(stored.receiver.events[0].id-1),undefined,room.data.token);assert.equal(retained.status,200);assert.equal(retained.data.events.length,256);
assert.equal((await api('/api/leave',{},room.data.token)).status,200);assert.equal((await api('/api/events',undefined,sender.data.token)).status,401);
const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']),pub=Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)).toString('base64url'),state=Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
const params=new URLSearchParams({platform:'desktop',pub,state,redirect:'http://127.0.0.1:8765/api/cloud/callback'});
assert.equal((await worker.fetch(new Request('https://mirrorphone.example/api/room',{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':'forged'},body:'{}'}),env)).status,201);
assert.equal((await worker.fetch(new Request('https://mirrorphone.example/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),{})).status,503);
assert.equal((await worker.fetch(new Request('https://mirrorphone.example/api/room',{method:'POST',headers:{'Content-Type':'application/json','X-MirrorPhone-Authorization':'Bearer wrong'},body:'{}'}),env)).status,201);
let r=await worker.fetch(new Request('https://mirrorphone.example/device/connect?'+params,{headers:{'oai-authenticated-user-id':'owner'}}),env);assert.equal(r.headers.get('Referrer-Policy'),'origin');const html=await r.text();assert.ok(!html.includes(serviceToken));assert.ok(!html.includes(env.OWNER_KEY));
const data=html.match(/name="data" value="([^"]+)"/)[1],proof=html.match(/name="proof" value="([^"]+)"/)[1];
r=await worker.fetch(new Request('https://mirrorphone.example/device/approve',{method:'POST',headers:{'oai-authenticated-user-id':'owner',Origin:'https://mirrorphone.example','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({data,proof,ownerKey:env.OWNER_KEY})}),env);const approved=await r.text();assert.equal(r.status,200);assert.ok(!approved.includes(serviceToken));
const bad=await worker.fetch(new Request('https://mirrorphone.example/device/approve',{method:'POST',headers:{Origin:'https://mirrorphone.example'},body:new URLSearchParams({data,proof,ownerKey:'wrong'})}),env);assert.equal(bad.status,401);
const cross=await worker.fetch(new Request('https://mirrorphone.example/device/approve',{method:'POST',headers:{Origin:'https://evil.example'},body:new URLSearchParams({data,proof,ownerKey:env.OWNER_KEY})}),env);assert.equal(cross.status,403);
const nullOrigin=await worker.fetch(new Request('https://mirrorphone.example/device/approve',{method:'POST',headers:{Origin:'null'},body:new URLSearchParams({data,proof,ownerKey:env.OWNER_KEY})}),env);assert.equal(nullOrigin.status,403);
const noOrigin=await worker.fetch(new Request('https://mirrorphone.example/device/approve',{method:'POST',body:new URLSearchParams({data,proof,ownerKey:env.OWNER_KEY})}),env);assert.equal(noOrigin.status,403);
const box=JSON.parse(Buffer.from(approved.match(/name="box" value="([^"]+)"/)[1],'base64url')),theirs=await crypto.subtle.importKey('raw',Buffer.from(box.pub,'base64url'),{name:'ECDH',namedCurve:'P-256'},false,[]),shared=await crypto.subtle.deriveBits({name:'ECDH',public:theirs},pair.privateKey,256),material=await crypto.subtle.importKey('raw',shared,'HKDF',false,['deriveKey']);
const key=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:Buffer.from(box.salt,'base64url'),info:new TextEncoder().encode('MirrorPhone cloud login v1:'+state)},material,{name:'AES-GCM',length:256},false,['decrypt']);
const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(box.iv,'base64url'),additionalData:new TextEncoder().encode('https://mirrorphone.example')},key,Buffer.from(box.ciphertext,'base64url'));assert.equal(JSON.parse(new TextDecoder().decode(decrypted)).token,serviceToken);
// No owner key is required; concurrent join guesses are capped atomically.
const limited={DB:new D1(),SESSION_SECRET:env.SESSION_SECRET};
const callLimited=(ip,route='/api/join',body={code:'000000'})=>worker.fetch(new Request('https://mirrorphone.example'+route,{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':ip},body:JSON.stringify(body)}),limited);
assert.equal((await (await worker.fetch(new Request('https://mirrorphone.example/api/health'),limited)).json()).configured,true);
assert.equal((await callLimited('192.0.2.1','/api/room',{})).status,201);
const attempts=await Promise.all(Array.from({length:30},()=>callLimited('192.0.2.2')));
assert.equal(attempts.filter(r=>r.status===429).length,10);assert.equal(attempts.filter(r=>r.status===404).length,20);
assert.equal((await callLimited('192.0.2.3')).status,404);
const now=Date.now;Date.now=()=>now()+61000;try{assert.equal((await callLimited('192.0.2.2')).status,404);}finally{Date.now=now;}
// Managed TURN credentials are fetched server-side, never exposing the provider API key.
const originalFetch=globalThis.fetch;
const relayEnv={...env,METERED_DOMAIN:'mirrorphone-test.metered.live',METERED_API_KEY:'test-only-provider-api-key'};
const relayRoom=await worker.fetch(new Request('https://mirrorphone.example/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),relayEnv);
const relayToken=(await relayRoom.json()).token;let fetchCalls=0;
try{
 globalThis.fetch=async(url,options)=>{fetchCalls++;assert.equal(new URL(url).hostname,relayEnv.METERED_DOMAIN);assert.equal(new URL(url).searchParams.get('apiKey'),relayEnv.METERED_API_KEY);assert.equal(options.redirect,'error');return Response.json([{urls:'stun:stun.relay.metered.ca:80'},{urls:['turn:standard.relay.metered.ca:80','turns:standard.relay.metered.ca:443?transport=tcp'],username:'test-user',credential:'test-credential'}]);};
 const request=()=>new Request('https://mirrorphone.example/api/ice',{headers:{Authorization:'Bearer '+relayToken}});
 let response=await worker.fetch(request(),relayEnv);assert.equal(response.status,200);const relayed=await response.json();assert.equal(relayed.connectionMode,'relay-available');assert.ok(relayed.iceServers.some(s=>s.urls.some(u=>u.startsWith('turns:'))));assert.ok(!JSON.stringify(relayed).includes(relayEnv.METERED_API_KEY));
 assert.equal((await worker.fetch(request(),relayEnv)).status,200);assert.equal(fetchCalls,1);
 globalThis.fetch=async()=>{throw Error('secret provider URL must not leak')};
 response=await worker.fetch(request(),{...relayEnv,METERED_API_KEY:'another-dummy-key'});assert.equal(response.status,502);assert.ok(!(await response.text()).includes('another-dummy-key'));
 globalThis.fetch=async()=>Response.json([{urls:'https://evil.example'}]);assert.equal((await worker.fetch(request(),{...relayEnv,METERED_API_KEY:'third-dummy-key'})).status,502);
 globalThis.fetch=async()=>{throw Error('Unauthenticated session must not fetch credentials')};assert.equal((await worker.fetch(new Request('https://mirrorphone.example/api/ice'),relayEnv)).status,401);
}finally{globalThis.fetch=originalFetch;}
const hfEnv={...relayEnv,HF_TOKEN:'hf_TestOnlyAlphaNumericToken'};let hfCalls=0;
try{
 globalThis.fetch=async(url,options)=>{hfCalls++;assert.equal(String(url),'https://fastrtc-turn-service.hf.space/credentials?ttl=3600');assert.equal(options.headers.Authorization,'Bearer '+hfEnv.HF_TOKEN);assert.equal(options.redirect,'manual');return Response.json({iceServers:[{urls:['stun:stun.cloudflare.com:3478']},{urls:['turn:turn.cloudflare.com:3478?transport=udp','turns:turn.cloudflare.com:5349?transport=tcp'],username:'temporary-user',credential:'temporary-password'}]});};
 const req=()=>new Request('https://mirrorphone.example/api/ice',{headers:{Authorization:'Bearer '+relayToken}});
 const result=await worker.fetch(req(),hfEnv);assert.equal(result.status,200);const resultJson=await result.json();assert.equal(resultJson.relayProvider,'huggingface');assert.ok(!JSON.stringify(resultJson).includes(hfEnv.HF_TOKEN));
 assert.equal((await worker.fetch(req(),hfEnv)).status,200);assert.equal(hfCalls,1);
 const health=await(await worker.fetch(new Request('https://mirrorphone.example/api/health'),hfEnv)).json();assert.equal(health.relayProvider,'huggingface');assert.equal(health.clientRevision,10);assert.equal(health.relayConfigured,true);
 let failures=0;globalThis.fetch=async(url)=>{failures++;assert.equal(new URL(url).hostname,'fastrtc-turn-service.hf.space');return Response.json({detail:'private provider details'},{status:429});};
 const quota=await worker.fetch(req(),{...hfEnv,HF_TOKEN:'hf_QuotaTest'});assert.equal(quota.status,503);assert.equal(failures,1);assert.ok(!(await quota.text()).includes('private provider details'));
 globalThis.fetch=async()=>Response.json({detail:'secret-data'},{status:401});assert.equal((await worker.fetch(req(),{...hfEnv,HF_TOKEN:'hf_InvalidTest'})).status,502);
 globalThis.fetch=async()=>Response.json({iceServers:[{urls:'https://evil.example'}]});assert.equal((await worker.fetch(req(),{...hfEnv,HF_TOKEN:'hf_BadPayloadTest'})).status,502);
 globalThis.fetch=async()=>{throw Error('must not fetch for malformed token')};assert.equal((await worker.fetch(req(),{...hfEnv,HF_TOKEN:'paste token here'})).status,503);
 assert.equal((await worker.fetch(new Request('https://mirrorphone.example/api/ice'),hfEnv)).status,401);
}finally{globalThis.fetch=originalFetch;}
console.log('PASS: Cloudflare fail-closed, code-only access without owner key, atomic IP rate limits and reset, managed TURN and HF validation/cache/401/429/no paid fallback and key isolation, optional legacy authorization, origin enforcement, D1 real SQLite queries, schema readiness, expired-data cleanup, atomic signal appends (40/200/300 concurrent), simultaneous heartbeat, ordered 256-event bound, room CAS, roles, revoked/tampered sessions, ICE, CSRF and encrypted owner-only device authorization');
