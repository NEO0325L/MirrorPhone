'use strict';
// Play the remote audio through its own 48 kHz audio clock. Video remains muted.
// Chromium needs a playing media element to pull/decode remote WebRTC audio.
// That element stays muted; only the Web Audio gain node reaches the speakers.
// No microphone or recording is used.
class MirrorAudioPlayer {
  constructor(makeContext = () => new AudioContext({sampleRate:48000, latencyHint:'playback'}), makeSink = () => document.createElement('audio')) {
    this.makeContext=makeContext; this.makeSink=makeSink; this.sink=null; this.context=null; this.source=null; this.gain=null;
    this.stream=null; this.enabled=false; this.volume=0.8; this.epoch=0;
  }
  attach(stream) {
    this.stream=stream;
    if(!this.sink) {
      this.sink=this.makeSink(); this.sink.muted=true; this.sink.autoplay=true;
    }
    this.sink.srcObject=stream;
    this.sink.play().catch(()=>{});
    if(this.context) this.connect();
  }
  connect() {
    this.source?.disconnect(); this.source=null;
    if(this.stream?.getAudioTracks().length) {
      this.source=this.context.createMediaStreamSource(this.stream);
      this.source.connect(this.gain);
    }
  }
  async toggle() {
    if(!this.stream?.getAudioTracks().length) throw Error('No se ha recibido audio del iPhone.');
    const epoch=this.epoch;
    if(!this.context) {
      this.context=this.makeContext(); this.gain=this.context.createGain();
      this.gain.gain.value=0; this.gain.connect(this.context.destination); this.connect();
    }
    const context=this.context;
    const resume=context.resume();
    await Promise.all([resume,this.sink.play()]);
    if(epoch!==this.epoch) return false;
    if(context.state!=='running') throw Error('Pulsa Activar sonido para iniciar la reproducción.');
    this.enabled=!this.enabled; this.applyVolume(); return this.enabled;
  }
  setVolume(value) { this.volume=Math.max(0,Math.min(1,value)); this.applyVolume(); }
  applyVolume() {
    if(this.gain) this.gain.gain.setTargetAtTime(this.enabled?this.volume:0,this.context.currentTime,0.015);
  }
  reset() {
    ++this.epoch; this.enabled=false; this.stream=null;
    if(this.sink) { this.sink.pause(); this.sink.srcObject=null; this.sink=null; }
    this.source?.disconnect(); this.source=null; this.gain?.disconnect(); this.gain=null;
    const context=this.context; this.context=null;
    if(context) context.close().catch(()=>{});
  }
}
if(typeof module!=='undefined') module.exports={MirrorAudioPlayer};
