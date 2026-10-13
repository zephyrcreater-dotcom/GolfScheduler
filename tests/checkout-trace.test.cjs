const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {checkoutTrace} = require('../src/doslagos/checkout-trace');
test('captures token GET failures without secrets, bodies, or query values',()=>{
 const page=new EventEmitter(), trace=checkoutTrace(page);
 const request={url:()=> 'https://phx-api-be-east-1b.kenna.io/tr/token?token=secret',method:()=> 'GET'};
 page.emit('request',request);page.emit('response',{request:()=>request,status:()=>401});page.emit('requestfailed',request);
 assert.match(trace.summary(),/GET .*\/tr\/token: HTTP 401/);assert.match(trace.summary(),/network failure/);assert.doesNotMatch(trace.summary(),/secret|token=/);trace.stop();assert.equal(page.listenerCount('request'),0);
});
test('reports pending booking requests and excludes analytics',()=>{
 const page=new EventEmitter(),trace=checkoutTrace(page);
 page.emit('request',{url:()=> 'https://events.launchdarkly.com/',method:()=> 'POST'});
 assert.equal(trace.summary(),'No booking-service request observed');
 const r={url:()=> 'https://api.teeitup.com/private/customer-secret',method:()=> 'PUT'};page.emit('request',r);
 assert.match(trace.summary(),/PUT api.teeitup.com booking-service: still pending/);assert.doesNotMatch(trace.summary(),/customer-secret/);page.emit('requestfinished',r);assert.equal(trace.summary(),'No booking-service request observed');trace.stop();
});

test('captures the real purchase-service rejection even when HTTP is 200, without leaking bodies', async () => {
 const page=new EventEmitter(), trace=checkoutTrace(page,{expectedNumber:'4111111111111111'});
 const request={url:()=> 'https://tr.gnsvc.com/AddReservation?secret=private-token',method:()=> 'POST',
  postData:()=> 'Payment.CC.CreditCardNumber=4111111111111111&Token=private-token&Payment.CC.CVVCode=secret-cvv'};
 page.emit('request',request);
 page.emit('response',{request:()=>request,status:()=>200,json:async()=>({Success:false,StatusCode:42,
  Message:'Unable to authorize payment for private-user',Token:'private-token',CardNumber:'4111111111111111'})});
 await trace.settle();
 assert.match(trace.summary(),/tr\.gnsvc\.com \/AddReservation: HTTP 200/);
 assert.match(trace.summary(),/cardPresent=true; cardMatches=true/);
 assert.match(trace.failure(),/payment rejected \(code 42\)/);
 assert.doesNotMatch(trace.summary(),/411111|secret-cvv|private-|Token=/);
 trace.stop();
});

test('distinguishes a missing outgoing number from a reset field and preserves the purchase event', async () => {
 const page=new EventEmitter(),trace=checkoutTrace(page,{expectedNumber:'4111111111111111'});
 const request={url:()=> 'https://tr.gnsvc.com/AddReservation',method:()=> 'POST',postData:()=> 'Token=private-token'};
 page.emit('request',request);page.emit('response',{request:()=>request,status:()=>403,json:async()=>{throw Error('HTML contains private-token');}});
 for(let i=0;i<20;i++)page.emit('response',{request:()=>({url:()=> 'https://api.teeitup.com/private-path',method:()=> 'GET'}),status:()=>200});
 await trace.settle();
 assert.match(trace.summary(),/cardPresent=false; cardMatches=false/);
 assert.match(trace.summary(),/AddReservation: HTTP 403/);
 assert.match(trace.failure(),/HTTP 403/);assert.doesNotMatch(trace.summary(),/private/);trace.stop();
});
