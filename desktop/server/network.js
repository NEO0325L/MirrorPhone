'use strict';
const os=require('node:os'),crypto=require('node:crypto');
function readConfig(env=process.env) {
 const publicURL=env.MIRRORPHONE_PUBLIC_URL?.trim()||'';
 const accessKey=env.MIRRORPHONE_ACCESS_KEY||'';
 const turnURLs=(env.MIRRORPHONE_TURN_URLS||'').split(',').map(v=>v.trim()).filter(Boolean);
 const turnSecret=env.MIRRORPHONE_TURN_SECRET||'';
 if(publicURL){const u=new URL(publicURL);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||(u.pathname!=='/'&&u.pathname!==''))throw Error('MIRRORPHONE_PUBLIC_URL debe ser un origen HTTPS.');if(accessKey.length<24)throw Error('Configura MIRRORPHONE_ACCESS_KEY de al menos 24 caracteres.');if(!turnURLs.length||!turnSecret)throw Error('El modo remoto requiere TURN_URLS y TURN_SECRET.');}
 if(turnURLs.some(v=>!/^turns?:[^\s]+$/i.test(v)))throw Error('TURN_URLS debe contener direcciones turn: o turns:.');
 return {publicURL:publicURL?new URL(publicURL).origin:'',accessKey,turnURLs,turnSecret};
}
function requireAccess(config,key){if(!config.publicURL)return true;const expected=Buffer.from(config.accessKey),supplied=Buffer.from(typeof key==='string'?key:'');return expected.length===supplied.length&&crypto.timingSafeEqual(expected,supplied);}
function networkInfo(config,port,interfaces=os.networkInterfaces()) {
 const addresses=[];
 for(const entries of Object.values(interfaces))for(const item of entries||[]){if(item.family!=='IPv4'||item.internal)continue;const a=item.address.split('.').map(Number);if(a[0]===10||(a[0]===172&&a[1]>=16&&a[1]<=31)||(a[0]===192&&a[1]===168)||(a[0]===169&&a[1]===254))addresses.push(`http://${item.address}:${port}`);}
 return {remote:!!config.publicURL,receiverURL:config.publicURL||`http://localhost:${port}`,serverURLs:config.publicURL?[config.publicURL]:[...new Set(addresses)]};
}
function iceConfiguration(config,session,now=Date.now()){
 if(!config.turnURLs.length)return {iceServers:[],iceTransportPolicy:'all'};
 const expires=Math.floor(now/1000)+86400;
 const username=`${expires}:${session.room.code}:${session.role}`;
 const credential=crypto.createHmac('sha1',config.turnSecret).update(username).digest('base64');
 return {iceServers:[{urls:config.turnURLs,username,credential}],iceTransportPolicy:'all',expires};
}
module.exports={readConfig,requireAccess,networkInfo,iceConfiguration};
