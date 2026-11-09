const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.env.GOLF_EMAIL='offline@example.invalid';process.env.GOLF_PASSWORD='offline';
const config=require('../src/doslagos/config');
config.card={number:'4111111111111111',expMonth:'01',expYear:'2030',cvv:'123',billingAddress:'Test',billingPostal:'00000',billingCountry:'US'};
const store=require('../src/doslagos/state'),{main}=require('../src/doslagos/check');
const date='2026-11-21';
function fixture({rejectAll=false,pending=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'availability-recovery-')),file=path.join(dir,'state.json');
 let calls=0,browsers=0;const selected=[];
 const notifier=Object.fromEntries(['error','found','searchResults','outcome'].map(k=>[k,async()=>{}]));
 const options={file,store,notifier,dates:[date],settings:{windowStart:'06:00',windowEnd:'07:00',preferredTime:'06:35',saturdayCutoff:'09:00',sundayCutoff:'07:30',golfers:1},
 createSite:()=>{browsers++;return {init:async()=>{},login:async()=>{},close:async()=>{},reservationHistory:async()=>[],
 hasPendingCart:async()=>pending&&calls>0,searchDate:async()=>{},
 getAvailableTimes:async()=>['06:33','06:42','06:51'].map((time,index)=>({time,index,maxGolfers:1})),
 reserveAndReachCheckout:async(index,_,opts)=>{calls++;selected.push(index);await opts.beforePurchase();return calls===1||rejectAll
  ? {error:'Explicit server rejection',purchaseRejection:{definitive:true,category:'availability-changed',code:129}}
  : {confirmation:'#OFFLINE'};}};}};
 return {options,state:()=>store.load(file)[date],calls:()=>calls,browsers:()=>browsers,selected,clean:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
const args=['--fill-test-payment','--complete-test-purchase'];
test('explicit rejection refreshes and selects the next eligible slot in the same browser',async()=>{
 const f=fixture();try{await main(args,f.options);assert.equal(f.calls(),2);assert.equal(f.browsers(),1);
 assert.deepEqual(f.selected,[0,1]);assert.equal(f.state().status,'confirmed');assert.equal(f.state().attemptCount,1);
 await main(args,f.options);assert.equal(f.calls(),2);
 }finally{f.clean();}
});
test('two rejected slots do not exhaust the date and stale offers are skipped across restarts',async()=>{
 const f=fixture({rejectAll:true});try{await main(args,f.options);assert.equal(f.calls(),2);
 assert.equal(f.state().status,'none');assert.equal(f.state().attemptCount,0);
 await main(args,f.options);assert.equal(f.calls(),3);assert.deepEqual(f.selected,[0,1,2]);
 assert.equal(f.state().status,'none');assert.equal(f.state().attemptCount,0);
 }finally{f.clean();}
});
test('a pending cart after rejection defers another purchase without locking the date forever',async()=>{
 const f=fixture({pending:true});try{await main(args,f.options);assert.equal(f.calls(),1);
 assert.equal(f.state().status,'none');assert.equal(f.state().attemptCount,0);
 }finally{f.clean();}
});
