'use strict';
const $ = id => document.getElementById(id);
let token=null, pc=null, cursor=0, epoch=0, candidates=[], statsPrevious=null;
let remoteStream=null, remoteAudioStream=null, longPolling=false;
const audioPlayer=new MirrorAudioPlayer();
let senderDiagnostics={};
async function api(path, data, session=token) {
  const r=await fetch(path,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(session?{Authorization:`Bearer ${session}`}:{})},body:data===undefined?undefined:JSON.stringify(data)});
  const v=await r.json();if(!r.ok)throw Error(v.error || 'Error de conexión.');return v;
}
function status(text){$('state').textContent=text;}
function error(e){$('error').textContent=e.message;}
function resetPeer(){senderDiagnostics={};pc?.close();pc=null;remoteStream=null;remoteAudioStream=null;audioPlayer.reset();if($('audioStatus'))$('audioStatus').textContent='Audio —';candidates=[];statsPrevious=null;$('video').srcObject=null;$('video').muted=true;for(const id of ['sound','fullscreenSound']){$(id).disabled=true;$(id).textContent='Activar sonido';}$('empty').hidden=false;for(const id of ['resolution','fps','bitrate','delay'])$(id).textContent='—';}
async function stop(){++epoch;const old=token;token=null;resetPeer();$('pairing').hidden=true;$('connect').disabled=false;$('disconnect').disabled=true;status('Sin conectar');if(old)try{await api('/api/leave',{},old);}catch{}}
async function makePeer(generation,session){
  resetPeer();const ice=await api('/api/ice',undefined,session);if(generation!==epoch)throw Error('La sala se cerró.');if(ice.networkWarning)$('networkHint').textContent=ice.networkWarning;const peer=new RTCPeerConnection(ice);pc=peer;
  peer.onicecandidate=e=>{console.debug(e.candidate?'MirrorPhone: candidato de red del receptor':'MirrorPhone: búsqueda de red del receptor terminada');if(e.candidate&&generation===epoch)api('/api/signal',{type:'candidate',...e.candidate.toJSON()},session).catch(error);};
  peer.ondatachannel=e=>{
    const channel=e.channel;
    if(channel.label!=='mirrorphone-audio-stats'){channel.close();return;}
    channel.onmessage=event=>{
      if(generation!==epoch||typeof event.data!=='string'||event.data.length>2048)return;
      try{const data=JSON.parse(event.data),clean={};
        for(const key of ['senderAdaptiveFPS','senderAdaptiveWidth','senderAdaptiveHeight','senderHardwareBitrate','senderHardwareFPS','senderHardwareBytes','senderHardwareQP','senderCaptured','senderRendered','senderSilent','senderDropped','senderCoalesced','senderTickBatch','senderRenderErrors','senderQueued','senderVideoCallbacks','senderVideoComplete','senderVideoSubmitted','senderTargetFPS','senderCodecPreferenceApplied','senderH264Available','senderVideoEncoded','senderVideoSent','senderVideoFPS','senderVideoTargetBitrate','senderVideoRetransmits','senderVideoPLI','senderBandwidth','senderEncodeTime'])
          if(typeof data[key]==='number'&&Number.isFinite(data[key])&&data[key]>=0&&data[key]<=Number.MAX_SAFE_INTEGER)clean[key]=data[key];
        for(const key of ['senderEncoder','senderVideoLimit','senderVideoCodec','senderValidatedH264Level','senderVideoProfile'])if(typeof data[key]==='string'&&data[key].length<=48)clean[key]=data[key];
        senderDiagnostics=clean;
      }catch{}
    };
  };
  peer.ontrack=e=>{
    if(generation!==epoch)return;
    if(e.track.kind==='audio'){
      if(!remoteAudioStream)remoteAudioStream=new MediaStream();
      remoteAudioStream.addTrack(e.track);audioPlayer.attach(remoteAudioStream);
      // Milliseconds. WebRTC still adapts above this target under network jitter.
      try{if('jitterBufferTarget' in e.receiver)e.receiver.jitterBufferTarget=80;}catch{}
      for(const id of ['sound','fullscreenSound'])$(id).disabled=false;
      if($('audioStatus'))$('audioStatus').textContent='Audio recibido';
    }else{
      try{if('jitterBufferTarget' in e.receiver)e.receiver.jitterBufferTarget=30;}catch{}
      if(!remoteStream){remoteStream=new MediaStream();$('video').srcObject=remoteStream;}
      remoteStream.addTrack(e.track);
    }
    $('video').onloadeddata=()=>{if(generation===epoch)$('empty').hidden=true;};
    if(e.track.kind==='video')$('video').play().catch(e=>{if(e.name!=='AbortError')error(e);});
  };
  peer.onconnectionstatechange=()=>{if(generation!==epoch)return;status({connected:'Transmitiendo',connecting:'Conectando…',disconnected:'Conexión interrumpida',failed:'No se pudo conectar',closed:'Desconectado'}[peer.connectionState]||'Preparando…');if(peer.connectionState==='failed')error(Error('La red no permitió conectar. En modo Internet puede hacer falta un relé TURN; en Wi-Fi comprueba la red y el permiso de firewall de MirrorPhone.'));};
  return peer;
}
function preferHardwareVideo(peer){
  // Negotiate H.264 first for the iPhone's hardware encoder. Keep every
  // advertised fallback and RTX/FEC entry if either endpoint cannot use it.
  const codecs=RTCRtpReceiver.getCapabilities?.('video')?.codecs;
  if(!codecs?.some(c=>c.mimeType.toLowerCase()==='video/h264'))return;
  // High profile uses more efficient compression at the same network bitrate.
  // Prefer only real receiver capabilities; Baseline remains a fallback.
  const h264=codecs.filter(c=>c.mimeType.toLowerCase()==='video/h264');
  const high=c=>/(?:^|;)\s*profile-level-id=64[0-9a-f]{4}(?:;|$)/i.test(c.sdpFmtpLine||'');
  const ordered=[...h264.filter(high),...h264.filter(c=>!high(c)),...codecs.filter(c=>c.mimeType.toLowerCase()!=='video/h264')];
  for(const transceiver of peer.getTransceivers())if(transceiver.receiver.track.kind==='video'){
    try{transceiver.setCodecPreferences?.(ordered);}catch{}
  }
}
async function screenVideoAnswer(answer,offer,decoder=globalThis.VideoDecoder){
  // Chromium's default SDP advertises H264 level 3.1 even when its decoder
  // supports tall 1080p screens. Check the local decoder before raising the
  // receive level. Normalize to the validated level rather than requesting
  // an untested higher encoder level. Preserve profiles, packetization, audio
  // and repair codecs.
  if(!decoder?.isConfigSupported)return answer;
  const sections=answer.sdp.split(/(?=^m=)/m),offered=offer.split(/(?=^m=)/m);
  for(let i=0;i<sections.length;i++){
    if(!sections[i].startsWith('m=video '))continue;
    const source=offered[i]||'',h264=new Set([...sections[i].matchAll(/^a=rtpmap:(\d+) H264\/90000\r?$/gmi)].map(m=>m[1]));
    const lines=sections[i].split('\r\n');
    for(let j=0;j<lines.length;j++){
      const fmtp=lines[j].match(/^a=fmtp:(\d+) (.*)$/),id=fmtp?.[2].match(/(?:^|;)\s*profile-level-id=([0-9a-f]{6})(?:;|$)/i)?.[1];
      if(!fmtp||!h264.has(fmtp[1])||!id||parseInt(id.slice(4),16)===0x33)continue;
      const remote=source.split('\r\n').find(l=>l.startsWith(`a=fmtp:${fmtp[1]} `))||'';
      if(!/(?: |;)\s*level-asymmetry-allowed=1(?:;|$)/.test(lines[j])||!/(?: |;)\s*level-asymmetry-allowed=1(?:;|$)/.test(remote))continue;
      const profile=id.slice(0,4)+'33';
      try{
        const supported=await decoder.isConfigSupported({codec:'avc1.'+profile,codedWidth:1080,codedHeight:2336});
        if(supported.supported)lines[j]=lines[j].replace(/profile-level-id=[0-9a-f]{6}/i,'profile-level-id='+profile);
      }catch{}
    }
    sections[i]=lines.join('\r\n');
  }
  return {type:answer.type,sdp:sections.join('')};
}
async function signal(event,generation,session){
  if(event.type==='peer-joined'){resetPeer();status('Preparando transmisión…');return;}
  if(event.type==='peer-left'){resetPeer();status('Esperando al iPhone…');return;}
  if(event.type==='offer'){
    const pending=candidates;const peer=await makePeer(generation,session);
    await peer.setRemoteDescription({type:'offer',sdp:event.sdp});
    preferHardwareVideo(peer);
    for(const candidate of pending)await peer.addIceCandidate(candidate);
    const answer=await screenVideoAnswer(await peer.createAnswer(),event.sdp);await peer.setLocalDescription(answer);
    if(generation!==epoch)return;
    await api('/api/signal',{type:'answer',sdp:answer.sdp},session);
  }else if(event.type==='candidate'){
    console.debug('MirrorPhone: candidato del emisor recibido');
    const candidate={candidate:event.candidate,sdpMid:event.sdpMid,sdpMLineIndex:event.sdpMLineIndex};
    if(pc?.remoteDescription)await pc.addIceCandidate(candidate);else candidates.push(candidate);
  }
}
async function poll(generation){
  const session=token;
  let failures=0;
  while(generation===epoch&&token){
    try{
      const batch=await api(`/api/events?after=${cursor}${longPolling?'&wait=20':''}`,undefined,session);if(generation!==epoch)return;
      for(const event of batch.events){await signal(event,generation,session);if(generation!==epoch)return;cursor=event.id;}failures=0;
    }catch(e){if(generation!==epoch)return;error(e);if(++failures>=6){await stop();error(e);return;}}
    if(failures||!longPolling)await new Promise(r=>setTimeout(r,failures?1000:pc?.connectionState==='connected'?2000:350));
  }
}
$('connect').onclick=async()=>{
  $('connect').disabled=true;$('error').textContent='';const generation=++epoch;
  try{const room=await api('/api/room',{accessKey:$('accessKey').value},null);token=room.token;longPolling=room.eventWait===true;cursor=0;$('code').textContent=room.code;$('pairing').hidden=false;$('disconnect').disabled=false;$('serverHint').textContent=serverURLs[0]?`Servidor para este código: ${serverURLs[0]}`:'Usa la dirección completa mostrada arriba, incluido el puerto.';status('Esperando al iPhone…');poll(generation);}catch(e){$('connect').disabled=false;error(e);}
};
$('disconnect').onclick=stop;
audioPlayer.setVolume(Number($('volume').value));
$('volume').oninput=()=>audioPlayer.setVolume(Number($('volume').value));
async function toggleSound(){
  try{const enabled=await audioPlayer.toggle();for(const id of ['sound','fullscreenSound'])$(id).textContent=enabled?'Silenciar':'Activar sonido';}
  catch(e){error(e);}
}
$('sound').onclick=toggleSound;
$('fullscreenSound').onclick=toggleSound;
setInterval(async()=>{
  const peer=pc;if(!peer||peer.connectionState!=='connected')return;
  try{const report=await peer.getStats();if(peer!==pc)return;
    const audio=[...report.values()].find(v=>v.type==='inbound-rtp'&&v.kind==='audio');
    const video=[...report.values()].find(v=>v.type==='inbound-rtp'&&v.kind==='video');
    const codec=video?report.get(video.codecId):null;
    const transport=[...report.values()].find(v=>v.type==='transport'&&v.selectedCandidatePairId);
    const pair=transport?report.get(transport.selectedCandidatePairId):[...report.values()].find(v=>v.type==='candidate-pair'&&v.state==='succeeded'&&v.nominated);
    const local=pair?report.get(pair.localCandidateId):null,remote=pair?report.get(pair.remoteCandidateId):null;
    const track=remoteAudioStream?.getAudioTracks()[0];
    const details={...senderDiagnostics,state:peer.connectionState,audioPackets:audio?.packetsReceived,audioBytes:audio?.bytesReceived,audioEnergy:audio?.totalAudioEnergy,audioSamples:audio?.totalSamplesReceived,audioLevel:audio?.audioLevel,audioLost:audio?.packetsLost,audioConcealed:audio?.concealedSamples,audioJitter:audio?.jitter,audioBuffer:audio?.jitterBufferEmittedCount?audio.jitterBufferDelay/audio.jitterBufferEmittedCount:null,playerState:audioPlayer.context?.state||'inactive',playerEnabled:audioPlayer.enabled,playerVolume:audioPlayer.volume,playerLatency:audioPlayer.context?.baseLatency,trackMuted:track?.muted,trackEnabled:track?.enabled,videoProfile:codec?.sdpFmtpLine?.match(/profile-level-id=([0-9a-f]{6})/i)?.[1],videoCodec:codec?.mimeType,videoDecoder:video?.decoderImplementation,videoDecodeTime:video?.totalDecodeTime,videoProcDelay:video?.totalProcessingDelay,videoDropped:video?.framesDropped,videoFreezes:video?.freezeCount,videoWidth:video?.frameWidth,videoHeight:video?.frameHeight,videoQP:video?.qpSum,videoFrames:video?.framesDecoded,videoBytes:video?.bytesReceived,videoFPS:video?.framesPerSecond,videoBuffer:video?.jitterBufferEmittedCount?video.jitterBufferDelay/video.jitterBufferEmittedCount:null,roundTrip:pair?.currentRoundTripTime,transport:local?.relayProtocol||local?.protocol,localCandidate:local?.candidateType,remoteCandidate:remote?.candidateType};
    fetch('/api/diagnostics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(details)}).catch(()=>{});
    for(const value of report.values()){
     if(value.type==='inbound-rtp'&&value.kind==='audio'&&$('audioStatus')){
       const loss=Math.max(0,value.packetsLost||0),total=(value.packetsReceived||0)+loss;
       $('audioStatus').textContent=total?`Audio · ${(loss/total*100).toFixed(1)}% pérdidas`:'Audio recibido';
     }
     if(value.type==='inbound-rtp'&&value.kind==='video'){
      $('resolution').textContent=`${value.frameWidth||'—'} × ${value.frameHeight||'—'}`;
      const delta=statsPrevious?(value.timestamp-statsPrevious.timestamp)/1000:0;
      const fps=value.framesPerSecond??(delta>0?(value.framesDecoded-statsPrevious.frames)/delta:0);
      $('fps').textContent=`${Math.round(fps)} FPS`;
      if(delta>0)$('bitrate').textContent=`${((value.bytesReceived-statsPrevious.bytes)*8/delta/1e6).toFixed(1)} Mbps`;
      const emitted=statsPrevious?value.jitterBufferEmittedCount-statsPrevious.emitted:0;
      if(emitted>0)$('delay').textContent=`${Math.round((value.jitterBufferDelay-statsPrevious.delay)/emitted*1000)} ms de búfer`;
      statsPrevious={timestamp:value.timestamp,bytes:value.bytesReceived,frames:value.framesDecoded,emitted:value.jitterBufferEmittedCount,delay:value.jitterBufferDelay};
    }}
  }catch{}
},1000);

let networkSignature='', serverURLs=[];
async function updateNetwork(){
 try{const info=await api('/api/network',undefined,null),signature=JSON.stringify(info);if(signature===networkSignature)return;networkSignature=signature;serverURLs=info.serverURLs;
 if(token)$('serverHint').textContent=serverURLs[0]?`Servidor para este código: ${serverURLs[0]}`:'Usa la dirección completa mostrada arriba, incluido el puerto.';
 $('remoteAccess').hidden=!info.remote||info.privateCloud;
 $('networkHint').textContent=info.pending?'El enlace fijo estará disponible cuando se publique el servicio remoto.':info.remote?'Acceso por internet: usa este enlace en ambos dispositivos.':`Servidor iniciado automáticamente. Dirección para el iPhone:`;
 $('serverAddresses').replaceChildren();
 for(const address of info.serverURLs){const line=document.createElement('p');line.textContent=address;$('serverAddresses').append(line);}
 $('copyAddress').hidden=!info.serverURLs.length;
 if(info.serverURLs.length)$('copyAddress').onclick=async()=>{try{await navigator.clipboard.writeText(info.serverURLs[0]);$('copyAddress').textContent='Dirección copiada';setTimeout(()=>$('copyAddress').textContent='Copiar dirección',2000);}catch{error(Error('Selecciona y copia la dirección que aparece arriba.'));}};
 if(!info.serverURLs.length)$('serverAddresses').textContent=info.pending?'Servicio remoto pendiente de publicación.':'Conecta el ordenador a Wi-Fi o al hotspot del iPhone.';
 }catch{$('networkHint').textContent='No se pudo actualizar la dirección de red. Comprueba que el servidor siga abierto.';networkSignature='';}
}
updateNetwork();setInterval(updateNetwork,5000);
