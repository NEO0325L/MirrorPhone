const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../server/public/receiver.js'),'utf8');
const start=source.indexOf('async function screenVideoAnswer('),end=source.indexOf('async function signal(',start);
assert.ok(start>0&&end>start);
const screenVideoAnswer=new Function(source.slice(start,end)+';return screenVideoAnswer;')();
(async()=>{
const sdp=['v=0','m=audio 9 UDP/TLS/RTP/SAVPF 111','a=rtpmap:111 opus/48000/2','a=fmtp:111 profile-level-id=42e01f','m=video 9 UDP/TLS/RTP/SAVPF 96 97 98','a=rtpmap:96 H264/90000','a=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f','a=rtpmap:97 rtx/90000','a=fmtp:97 apt=96','a=rtpmap:98 VP8/90000',''].join('\r\n');
const answer={type:'answer',sdp},yes={isConfigSupported:async c=>({supported:c.codec==='avc1.42e033'})};
const result=await screenVideoAnswer(answer,sdp,yes);
assert.equal(result.sdp,sdp.replace('a=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f','a=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e033'));
for(const decoder of [{},{isConfigSupported:async()=>({supported:false})},{isConfigSupported:async()=>{throw Error('unsupported')}}])assert.deepEqual(await screenVideoAnswer(answer,sdp,decoder),answer);
assert.deepEqual(await screenVideoAnswer(answer,sdp.replace('level-asymmetry-allowed=1','level-asymmetry-allowed=0'),yes),answer);
assert.deepEqual(await screenVideoAnswer({type:'answer',sdp:sdp.replace('level-asymmetry-allowed=1','level-asymmetry-allowed=0')},sdp,yes),{type:'answer',sdp:sdp.replace('level-asymmetry-allowed=1','level-asymmetry-allowed=0')});
const higher={type:'answer',sdp:sdp.replaceAll('42e01f','42e034')};assert.equal((await screenVideoAnswer(higher,higher.sdp,yes)).sdp,higher.sdp.replace('a=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e034','a=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e033'));
console.log('PASS decoder capability, video-only SDP, audio/RTX preserved, unsupported decoder, failure and asymmetric-level guards');
})().catch(e=>{console.error(e);process.exitCode=1});
