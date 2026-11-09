const test = require('node:test'), assert = require('node:assert/strict');
process.env.GOLF_EMAIL='offline@example.invalid';process.env.GOLF_PASSWORD='offline';
process.env.DOSLAGOS_START_AT_HISTORY='true';
const Module=require('node:module'), original=Module._load;
let Site;
try {
  Module._load=function(id,...args){return id==='playwright'?{chromium:{}}:original.call(this,id,...args);};
  Site=require('../src/doslagos/site');
} finally {Module._load=original;}
const config=require('../src/doslagos/config');
test('unparameterized scheduled/recovery login uses the configured history entry', async () => {
  assert.equal(config.startAtHistory,true);
  for (const enabled of [true,false]) {
    config.startAtHistory=enabled;
    let visited;
    await assert.rejects(Site.prototype.login.call({page:{goto:async url=>{
      visited=url;throw Error('TEST_STOP_BEFORE_NETWORK');
    }}}),/TEST_STOP_BEFORE_NETWORK/);
    assert.equal(new URL(visited).pathname,enabled?'/reservation/history':'/');
  }
});
