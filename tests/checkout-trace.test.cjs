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
