'use strict';
const $=id=>document.getElementById(id), canvas=$('pattern'), context=canvas.getContext('2d');
let pc=null, token=null, generation=0, stream=null, remoteReady=false, candidates=[];
function draw(time){
  context.fillStyle='#111a25';context.fillRect(0,0,1920,1080);
  for(let i=0;i<12;i++){context.fillStyle=`hsl(${i*30},65%,50%)`;context.fillRect(i*160,0,160,80);}
  context.fillStyle='#80ddca';context.beginPath();context.arc(960+Math.sin(time/900)*650,500+Math.cos(time/1200)*270,95,0,Math.PI*2);context.fill();
  context.fillStyle='white';context.font='64px sans-serif';context.fillText('MirrorPhone · patrón WebRTC',90,940);context.font='36px monospace';context.fillText(`${(time/1000).toFixed(2)} s · 1920 × 1080`,90,1010);requestAnimationFrame(draw);
}requestAnimationFrame(draw);
async function api(path,data,session=token){const response=await fetch(path,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(session?{Authorization:`Bearer ${session}`}:{})},body:data===undefined?undefined:JSON.stringify(data)});const value=await response.json();if(!response.ok)throw Error(value.error);return value;}
function show(error){$('error').textContent=error.message;}
async function stop(){++generation;const old=token;token=null;pc?.close();pc=null;stream?.getTracks().forEach(t=>t.stop());stream=null;remoteReady=false;candidates=[];$('start').disabled=false;$('stop').disabled=true;$('state').textContent='Sin conectar';if(old)try{await api('/api/leave',{},old);}catch{}}
$('start').onclick=async()=>{
  $('start').disabled=true;$('error').textContent='';const current=++generation;
  try{
    const joined=await api('/api/join',{code:$('code').value},null);token=joined.token;
    const peer=new RTCPeerConnection({iceServers:[]});pc=peer;stream=canvas.captureStream(Number($('rate').value));for(const track of stream.getTracks())peer.addTrack(track,stream);
    peer.onicecandidate=e=>{console.debug(e.candidate?'MirrorPhone: candidato de red del emisor':'MirrorPhone: búsqueda de red del emisor terminada');if(e.candidate&&current===generation)api('/api/signal',{type:'candidate',...e.candidate.toJSON()}).catch(show);};
    peer.onconnectionstatechange=()=>{$('state').textContent=peer.connectionState;};
    const offer=await peer.createOffer();await peer.setLocalDescription(offer);await api('/api/signal',{type:'offer',sdp:offer.sdp});$('stop').disabled=false;
    let cursor=0;
    while(current===generation){
      const response=await api(`/api/events?after=${cursor}`);if(current!==generation)return;
      for(const event of response.events){
        if(event.type==='answer'){await peer.setRemoteDescription({type:'answer',sdp:event.sdp});remoteReady=true;for(const c of candidates)await peer.addIceCandidate(c);candidates=[];}
        else if(event.type==='candidate'){const c={candidate:event.candidate,sdpMid:event.sdpMid,sdpMLineIndex:event.sdpMLineIndex};if(remoteReady)await peer.addIceCandidate(c);else candidates.push(c);}
        cursor=event.id;
      }
      await new Promise(r=>setTimeout(r,350));
    }
  }catch(error){if(current===generation){await stop();show(error);}}
};
$('stop').onclick=stop;
