const {test}=require('node:test');
const assert=require('node:assert/strict');
const {manage}=require('../src/doslagos/qstash');
const env={QSTASH_URL:'https://qstash-eu-central-1.upstash.io',QSTASH_TOKEN:'QSTASH-TEST-SECRET',GITHUB_WORKFLOW_TOKEN:'github_pat_TEST_SECRET'};
const ok=body=>({ok:true,json:async()=>body});
test('activation preflights GitHub and updates a stable five-minute timer with redacted headers',async()=>{
 const calls=[];const request=async(url,options)=>{calls.push({url,options});return calls.length===1?ok({state:'active'}):ok({scheduleId:'scheduled-browser-checks'});};
 assert.deepEqual(await manage('activate',env,request),{scheduleId:'scheduled-browser-checks',intervalMinutes:5,activated:true});
 assert.equal(calls.length,2);assert.match(calls[0].url,/api.github.com.*doslagos.yml$/);
 const {headers,body}=calls[1].options;assert.equal(headers['Upstash-Cron'],'*/5 * * * *');assert.equal(headers['Upstash-Schedule-Id'],'scheduled-browser-checks');assert.equal(headers['Upstash-Redact-Fields'],'headers');assert.equal(headers['Upstash-Forward-Authorization'],'Bearer '+env.GITHUB_WORKFLOW_TOKEN);assert.deepEqual(JSON.parse(body),{ref:'master',inputs:{timer_source:'qstash'}});
});
test('failed GitHub preflight creates no schedule and leaks no service response',async()=>{
 let calls=0;await assert.rejects(manage('activate',env,async()=>{calls++;return {ok:false,status:403,text:async()=>env.GITHUB_WORKFLOW_TOKEN};}),error=>error.message.includes('HTTP 403')&&!error.message.includes(env.GITHUB_WORKFLOW_TOKEN));assert.equal(calls,1);
});
test('verification returns only safe status fields, including trigger timestamps',async()=>{
 const result=await manage('verify',env,async()=>ok({destination:'https://api.github.com/repos/zephyrcreater-dotcom/GolfScheduler/actions/workflows/doslagos.yml/dispatches',cron:'*/5 * * * *',isPaused:false,lastScheduleTime:1000,nextScheduleTime:2000,header:{Authorization:env.GITHUB_WORKFLOW_TOKEN}}));assert.equal(result.lastTriggerAt,'1970-01-01T00:00:01.000Z');assert.equal(result.paused,false);assert.ok(!JSON.stringify(result).includes(env.GITHUB_WORKFLOW_TOKEN));
});
test('invalid endpoints and broad classic tokens are rejected before any request',async()=>{
 const request=async()=>{throw Error('Must not make a request');};await assert.rejects(manage('activate',{...env,QSTASH_URL:'https://example.invalid'},request),/REST URL/);await assert.rejects(manage('activate',{...env,GITHUB_WORKFLOW_TOKEN:'ghp_test'},request),/fine-grained/);
});
test('paused schedule verification and pause operation do not require the GitHub token',async()=>{
 const local={...env,GITHUB_WORKFLOW_TOKEN:undefined};let url;assert.deepEqual(await manage('pause',local,async target=>{url=target;return ok({});}),{scheduleId:'scheduled-browser-checks',paused:true});assert.match(url,/scheduled-browser-checks\/pause$/);
});
test('malformed service responses never expose credential-containing parser errors',async()=>{
 await assert.rejects(manage('verify',env,async()=>({ok:true,json:async()=>{throw Error('Malformed '+env.GITHUB_WORKFLOW_TOKEN);}})),error=>error.message.includes('invalid JSON')&&!error.message.includes(env.GITHUB_WORKFLOW_TOKEN));
});
