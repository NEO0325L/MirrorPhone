const assert=require('node:assert/strict');
const {createCloudBridge}=require('../cloud-bridge.cjs');
const config={origin:'https://mirrorphone-server.caradeboli.workers.dev',published:true,defaultMode:'internet'};
for(const [backend,available,expected] of [['basic_text',true,false],['gnome_libsecret',true,true],['kwallet6',true,true],['gnome_libsecret',false,false]]){
 const safeStorage={isEncryptionAvailable:()=>available,getSelectedStorageBackend:()=>backend,decryptString(){throw Error('must not read unprotected storage');}};
 const bridge=createCloudBridge({config,safeStorage,userData:__dirname,openExternal:()=>{}});
 assert.equal(bridge.status().secureStorage,expected);
 assert.equal(bridge.status().codeOnly,true);
 assert.equal(bridge.status().connected,true,'code-only pairing must not depend on a secret store');
}
console.log('PASS: Linux basic_text rejected, protected backends detected, code-only pairing independent of keyring');
