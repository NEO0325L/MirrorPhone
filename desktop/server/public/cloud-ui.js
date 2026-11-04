'use strict';
(()=>{
 let switching=false;
 async function sync(){
  try{const info=await api('/api/cloud/status',undefined,null);if(!switching)$('connectionMode').value=info.mode;
   const internet=info.mode==='internet';$('cloudLogin').hidden=!internet||info.connected;$('cloudLogin').disabled=!info.published;$('cloudLogout').hidden=!internet||!info.connected||info.codeOnly;
   $('cloudState').textContent=internet?(info.published?(info.connected?(info.codeOnly?'Conexión por código · ':'Dispositivo autorizado · ')+info.origin+(info.relayConfigured===false?' · Relé pendiente; solo conexión directa.':''):'Autoriza este ordenador en el navegador con tu clave privada de MirrorPhone.'):'El servicio remoto está pendiente de publicación. El modo Wi-Fi sigue disponible.'):'Conecta ambos dispositivos a la misma red Wi-Fi o hotspot.';
   if(internet&&!info.connected)$('connect').disabled=true;else if(!token&&!switching)$('connect').disabled=false;
  }catch{$('cloudState').textContent='No se pudo comprobar el modo de conexión.';}
 }
 $('connectionMode').onchange=async()=>{switching=true;try{await stop();await api('/api/cloud/mode',{mode:$('connectionMode').value},null);networkSignature='';await updateNetwork();}catch(e){error(e);}finally{switching=false;await sync();}};
 $('cloudLogin').onclick=async()=>{try{const r=await api('/api/cloud/login',{},null);$('cloudState').textContent='Autoriza en el navegador la solicitud '+r.request+' y vuelve a MirrorPhone.';}catch(e){error(e);}};
 $('cloudLogout').onclick=async()=>{await stop();try{await api('/api/cloud/logout',{},null);networkSignature='';await updateNetwork();await sync();}catch(e){error(e);}};
 sync();setInterval(sync,3000);
})();
