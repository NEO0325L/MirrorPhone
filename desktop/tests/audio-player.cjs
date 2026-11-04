const assert=require('node:assert/strict');
const {MirrorAudioPlayer}=require('../server/public/audio-player');
(async()=>{
 const contexts=[];
 function contextFactory(){
  const context={state:'suspended',currentTime:0,destination:{},sources:[],gain:{gain:{value:0,setTargetAtTime(v){this.value=v;}},connect(){},disconnect(){}},createGain(){return this.gain;},createMediaStreamSource(stream){const node={stream,connections:0,connect(){this.connections++;},disconnect(){this.connections--;}};this.sources.push(node);return node;},async resume(){this.state='running';},async close(){this.state='closed';}};
  contexts.push(context);return context;
 }
 const sinks=[];function makeSink(){const sink={muted:false,autoplay:false,srcObject:null,playing:false,async play(){this.playing=true;},pause(){this.playing=false;}};sinks.push(sink);return sink;}
 const player=new MirrorAudioPlayer(contextFactory,makeSink),stream={getAudioTracks:()=>[{}]};
 player.attach(stream);assert.equal(contexts.length,0);assert.equal(sinks[0].muted,true);assert.equal(sinks[0].playing,true);assert.equal(sinks[0].srcObject,stream);
 assert.equal(await player.toggle(),true);assert.equal(contexts.length,1);assert.equal(contexts[0].sources[0].connections,1);assert.equal(contexts[0].gain.gain.value,.8);
 player.setVolume(.5);assert.equal(contexts[0].gain.gain.value,.5);
 assert.equal(await player.toggle(),false);assert.equal(contexts[0].gain.gain.value,0);
 player.attach(stream);assert.equal(contexts[0].sources[0].connections,0);assert.equal(contexts[0].sources[1].connections,1);
 player.reset();assert.equal(sinks[0].playing,false);assert.equal(sinks[0].srcObject,null);assert.equal(contexts[0].state,'closed');assert.equal(contexts[0].sources[1].connections,0);
 player.attach(stream);assert.equal(await player.toggle(),true);assert.equal(contexts.length,2);assert.equal(contexts[1].gain.gain.value,.5);
 player.reset();await assert.rejects(()=>player.toggle());
 // A resume completing after disconnect must never reactivate old audio.
 let finish;
 const delayed=new MirrorAudioPlayer(()=>{const ctx=contextFactory();ctx.resume=()=>new Promise(r=>{finish=r});return ctx;},makeSink);
 delayed.attach(stream);const pending=delayed.toggle();delayed.reset();finish();assert.equal(await pending,false);
 console.log('PASS: one audio clock, one output route, user gesture activation, mute and smooth volume, replacement without duplicate output, disconnect cleanup, stale resume cancellation');
})().catch(e=>{console.error(e);process.exitCode=1});
