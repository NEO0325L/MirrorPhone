'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const { listen } = require('./runtime.cjs');
const { server } = require('./server/server.js');
async function api(origin, path, data, token) {
  const response = await fetch(origin + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { ...(data === undefined ? {} : {'Content-Type':'application/json'}), ...(token ? {Authorization:`Bearer ${token}`} : {}) },
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  const json = await response.json();
  assert.ok(response.ok, JSON.stringify(json));
  return json;
}
(async () => {
  const occupied = http.createServer();
  await new Promise(resolve => occupied.listen(0, '0.0.0.0', resolve));
  try {
    const port = await listen(server, occupied.address().port);
    assert.notEqual(port, occupied.address().port);
    const origin = `http://127.0.0.1:${port}`;
    assert.equal((await api(origin, '/api/health')).service, 'MirrorPhone');
    const page = await (await fetch(origin)).text();
    assert.ok(page.includes('WINDOWS · LINUX'));
    assert.ok(page.includes('copyAddress'));
    const net = await api(origin, '/api/network');
    assert.ok(net.serverURLs.every(url => url.endsWith(`:${port}`)));
    const room = await api(origin, '/api/room', {});
    const sender = await api(origin, '/api/join', {code:room.code});
    await api(origin, '/api/signal', {type:'offer', sdp:'desktop-test-offer'}, sender.token);
    const received = await api(origin, '/api/events?after=0', undefined, room.token);
    assert.ok(received.events.some(event => event.type === 'offer' && event.sdp === 'desktop-test-offer'));
    await api(origin, '/api/signal', {type:'answer', sdp:'desktop-test-answer'}, room.token);
    const answer = await api(origin, '/api/events?after=0', undefined, sender.token);
    assert.ok(answer.events.some(event => event.type === 'answer'));
    const bad = await fetch(origin + '/api/room', {method:'POST', headers:{Origin:'https://wrong.invalid','Content-Type':'application/json'}, body:'{}'});
    assert.equal(bad.status, 403);
    await api(origin, '/api/leave', {}, room.token);
    assert.equal((await fetch(origin+'/api/events', {headers:{Authorization:`Bearer ${sender.token}`}})).status, 401);
    console.log('PASS: automatic server, occupied-port fallback, assets, actual LAN port, pairing, bidirectional signaling, origin validation and session shutdown');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => occupied.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
