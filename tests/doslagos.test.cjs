const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.GOLF_EMAIL = 'test@example.invalid';
process.env.GOLF_PASSWORD = 'test-only';
process.env.DOSLAGOS_CARD_NUMBER = '0000000000000000';
process.env.DOSLAGOS_CARD_CVV = 'OFFLINE-CVV-SECRET';
const { selectTeeTime, candidateDates } = require('../src/doslagos/selection');
const storage = require('../src/doslagos/state');
const { checkDate } = require('../src/doslagos/check');
const { verifyConfirmation } = require('../src/doslagos/confirmation');
test('confirmation requires a reservation number and exactly matching booking details', () => {
 const text = 'Order Confirmed! Billing Details Order Details Dos Lagos Golf Course October 16, 2026 6:51 AM 1 Player, 18 holes, Cart Included Order Summary';
 const expected = { date:'2026-10-16', time:'06:51' };
 assert.deepEqual(verifyConfirmation(text, '#123456', expected, 1), { reference:'#123456', ...expected, golfers:1 });
 for (const slot of [{...expected,date:'2026-10-17'}, {...expected,time:'06:35'}]) assert.throws(() => verifyConfirmation(text,'#123456',slot,1), /differs/);
 assert.throws(() => verifyConfirmation(text,'#123456',expected,2), /differs/);
 assert.throws(() => verifyConfirmation(text,'',expected,1), /reservation number/);
 assert.throws(() => verifyConfirmation(text + ' October 17, 2026 6:51 AM 1 Player', '#123456',expected,1), /Ambiguous/);
 assert.throws(() => verifyConfirmation('Order Confirmed!', '#123456',expected,1), /details/);
});
const notifier = Object.fromEntries(['searchResults','found','outcome','lifecycle','error'].map(name=>[name,async()=>{}]));
const settings = {windowStart:'06:00',windowEnd:'07:00',preferredTime:'06:35',saturdayCutoff:'09:00',sundayCutoff:'07:30',golfers:1,timezone:'America/Los_Angeles',horizonDays:12,targetDays:[6,0]};
const times = values => values.map((time,index)=>({time,index,price:'10'}));
test('closest to 06:35 wins, earlier wins ties, regardless of listing order',()=>{
 assert.equal(selectTeeTime(times(['06:40','06:20','06:30']), '2026-10-10', settings).time,'06:30');
 assert.equal(selectTeeTime(times(['06:00','06:36','06:30']), '2026-10-10', settings).time,'06:36');
});
test('preferred window outranks fallback; boundaries and day-specific cutoffs',()=>{
 assert.equal(selectTeeTime(times(['07:01','07:00']),'2026-10-10',settings).time,'07:00');
 assert.equal(selectTeeTime(times(['08:00','07:10','09:00']),'2026-10-10',settings).time,'07:10');
 assert.equal(selectTeeTime(times(['09:00']),'2026-10-10',settings).time,'09:00');
 assert.equal(selectTeeTime(times(['09:01']),'2026-10-10',settings),null);
 assert.equal(selectTeeTime(times(['07:40','07:30']),'2026-10-11',settings).time,'07:30');
 assert.equal(selectTeeTime(times(['05:59','07:31']),'2026-10-11',settings),null);
 assert.equal(selectTeeTime([],'2026-10-10',settings),null);
});
test('capacity filtering and Los Angeles date boundary',()=>{
 const slots=times(['06:35','06:40']);slots[0].maxGolfers=1;
 assert.equal(selectTeeTime(slots,'2026-10-10',{...settings,golfers:2}).time,'06:40');
 assert.deepEqual(candidateDates(settings,new Date('2026-10-05T01:00:00Z')),['2026-10-10','2026-10-11']);
});
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'doslagos-test-'));return {file:path.join(dir,'state.json'),clean:()=>fs.rmSync(dir,{recursive:true,force:true})};}
test('uncertain purchase locks date across restarts; callback persists before click',async()=>{
 const f=fixture();let calls=0;let failures=0;
 const createSite=()=>({init:async()=>{},login:async()=>{},searchDate:async()=>{},getAvailableTimes:async()=>times(['06:30','06:40']),close:async()=>{},reserveAndReachCheckout:async(index,golfers,options)=>{
  calls++;assert.equal(storage.load(f.file)['2026-10-10'].status,'attempting');
  await options.beforePurchase();assert.equal(storage.load(f.file)['2026-10-10'].status,'purchase-attempted');
  return {reached:true,purchaseClicked:true};
 }});
 try{const args={file:f.file,settings,notifier:{...notifier,error:async()=>{failures++;}},createSite,fillPayment:true,completePurchase:true};
 await assert.rejects(checkDate('2026-10-10',args), /confirmation not verified/);assert.equal(storage.load(f.file)['2026-10-10'].status,'needs-review');
 await checkDate('2026-10-10',args);assert.equal(calls,1);assert.equal(failures,1);
 }finally{f.clean();}
});
test('confirmed date skipped; second date independent; crash remains blocked',async()=>{
 const f=fixture();let calls=0;let crash=false;
 const createSite=()=>({init:async()=>{},login:async()=>{},searchDate:async()=>{},getAvailableTimes:async()=>times(['06:35']),close:async()=>{},reserveAndReachCheckout:async()=>{calls++;if(crash)throw new Error('connection lost');return {reached:true,confirmation:'TEST-CONFIRMATION'};}});
 try{const args={file:f.file,settings,notifier,createSite,fillPayment:true,completePurchase:true};
 await checkDate('2026-10-10',args);await checkDate('2026-10-10',args);assert.equal(calls,1);
 crash=true;await assert.rejects(checkDate('2026-10-11',args),/connection lost/);
 await checkDate('2026-10-11',args);assert.equal(calls,2);
 }finally{f.clean();}
});
test('no availability can retry, corrupt state cannot silently reset, process lock blocks overlap',async()=>{
 const f=fixture();let count=0;const createSite=()=>({init:async()=>{count++},login:async()=>{},searchDate:async()=>{},getAvailableTimes:async()=>[],close:async()=>{}});
 try{await checkDate('2026-10-10',{file:f.file,settings,notifier,createSite});await checkDate('2026-10-10',{file:f.file,settings,notifier,createSite});assert.equal(count,2);
 fs.writeFileSync(f.file,'broken');assert.throws(()=>storage.load(f.file));
 const release=storage.acquire(f.file+'.lock');assert.throws(()=>storage.acquire(f.file+'.lock'),/already running/);release();
 }finally{f.clean();}
});
test('search notifications include every offer, split long lists, and redact sensitive input',async()=>{
 const config=require('../src/doslagos/config'); const notify=require('../src/doslagos/notify');
 const fetchBefore=global.fetch, topicBefore=config.ntfy.topic, passwordBefore=config.password;
 const bodies=[];
 config.ntfy.topic='offline-test';config.password='SECRET-TEST-PASSWORD';
 global.fetch=async(url,options)=>{bodies.push(JSON.parse(options.body));return {ok:true};};
 try{
  const offers=Array.from({length:500},(_,index)=>({label:`Offer ${index} at 06:35`,price:'10'}));
  await notify.searchResults({date:'2026-10-10',times:offers,target:{time:'06:35'},golfers:1});
  assert.ok(bodies.length>1);const messages=bodies.map(body=>body.message).join('\n');
  for(let i=0;i<500;i++)assert.ok(messages.includes(`Offer ${i} at`));
  for(const body of bodies)assert.ok(Buffer.byteLength(body.message)<4096);
  await notify.error({reason:'Failed fill SECRET-TEST-PASSWORD 0000 0000 0000 0000'});
  assert.ok(!bodies.at(-1).message.includes('SECRET-TEST-PASSWORD'));
  assert.ok(!bodies.at(-1).message.includes('0000 0000'));
  await notify.error({reason:'Browser failed\n'.repeat(2000)});
  assert.ok(Buffer.byteLength(JSON.stringify(bodies.at(-1))) <= 3200);
  global.fetch=async()=>({ok:false,status:503,statusText:'Unavailable'});
  assert.equal(await notify.lifecycle('test'),false);
 }finally{global.fetch=fetchBefore;config.ntfy.topic=topicBefore;config.password=passwordBefore;}
});
test('macOS browser registration failure stops watch mode and releases lock before any booking',async()=>{
 const {browserStartupError}=require('../src/doslagos/browser-error');
 const {main}=require('../src/doslagos/check');const f=fixture();let starts=0;let closed=0;
 const error=browserStartupError(new Error('browserType.launch SIGABRT _RegisterApplication'));
 assert.equal(error.fatalStartup,true);assert.match(error.message,/No login or booking/);
 try{
  await assert.rejects(main(['--watch','--date=2026-10-10'],{file:f.file,notifier,createSite:()=>({init:async()=>{starts++;throw error},close:async()=>{closed++}})}),/Chromium could not start/);
  assert.equal(starts,1);assert.equal(closed,1);assert.equal(fs.existsSync(f.file+'.lock'),false);assert.deepEqual(storage.load(f.file),{});
 }finally{f.clean();}
});
test('one browser and login search all dates in a scan',async()=>{
 const {main}=require('../src/doslagos/check');const f=fixture();let starts=0,logins=0,closes=0;const searched=[];
 try{await main([],{file:f.file,notifier,dates:['2026-10-10','2026-10-11','2026-10-17','2026-10-18'],createSite:()=>({init:async()=>{starts++},login:async()=>{logins++},searchDate:async date=>{searched.push(date)},getAvailableTimes:async()=>[],close:async()=>{closes++}})});
 assert.equal(starts,1);assert.equal(logins,1);assert.equal(closes,1);assert.equal(searched.length,4);
 }finally{f.clean();}
});
test('availability alerts ignore 09:00 and later and suppress unchanged scans',async()=>{
 const f=fixture();let offers=times(['08:45','09:00','10:00']);const alerts=[];
 const sharedSite={searchDate:async()=>{},getAvailableTimes:async()=>offers};
 const custom={...notifier,searchResults:async event=>{alerts.push(event)}};
 const args={file:f.file,settings,sharedSite,allowBooking:false,notifier:custom};
 try{await checkDate('2026-10-10',args);await checkDate('2026-10-10',args);
 assert.equal(alerts.length,1);assert.deepEqual(alerts[0].times.map(slot=>slot.time),['08:45']);
 offers=times(['08:30','10:00']);await checkDate('2026-10-10',args);assert.equal(alerts.length,2);
 offers=times(['09:00','10:00']);await checkDate('2026-10-10',args);assert.equal(alerts.length,2);
 }finally{f.clean();}
});
test('remote state requires initialization and lock ownership for every write',async()=>{
 const RedisState=require('../src/doslagos/redis-state');const values=new Map();
 const request=async(url,options)=>{const a=JSON.parse(options.body);let result=null;
  if(a[0]==='GET')result=values.get(a[1])??null;
  if(a[0]==='SET'){if(!a.includes('NX')||!values.has(a[1])){values.set(a[1],a[2]);result='OK';}}
  if(a[0]==='EVAL'){
   if(a[2]==='2'){result=values.get(a[3])===a[5]?1:0;if(result)values.set(a[4],a[6]);}
   else{result=values.get(a[3])===a[4]?1:0;if(result&&a[1].includes("'DEL'"))values.delete(a[3]);}
  }
  return {ok:true,json:async()=>({result})};
 };
 const store=new RedisState({url:'https://test.invalid',token:'test-token',request});
 await assert.rejects(store.load(),/not initialized/);
 await store.initialize({'2026-10-10':{status:'confirmed'}});
 await assert.rejects(store.initialize({}),/already exists/);
 await assert.rejects(store.save('',{}),/lease expired/);
 const store2=new RedisState({url:'https://test.invalid',token:'test-token',request});
 const release=await store2.acquire();
 try{await store2.save('',{'2026-10-11':{status:'purchase-attempted'}});
 assert.equal((await store2.load())['2026-10-11'].status,'purchase-attempted');
 values.set(store2.lockKey,'different-owner');await assert.rejects(store2.save('',{}),/lease expired/);
 await release();assert.equal(values.get(store2.lockKey),'different-owner');
 }finally{await release();}
});
test('cloud schedule runs once every five minutes throughout the week',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../.github/workflows/doslagos.yml'),'utf8');
 const schedules=[...source.matchAll(/cron: '([^']+)'/g)].map(match=>match[1].split(' '));
 const matches=(field,value)=>field.split(',').some(piece=>{
  if(piece==='*')return true;
  if(piece.startsWith('*/'))return value%Number(piece.slice(2))===0;
  if(piece.includes('-')){const [a,b]=piece.split('-').map(Number);return value>=a&&value<=b;}
  return value===Number(piece);
 });
 for(let day=0;day<7;day++)for(let hour=0;hour<24;hour++)for(let minute=0;minute<60;minute++){
  const hits=schedules.filter(s=>matches(s[0],minute)&&matches(s[1],hour)&&matches(s[4],day)).length;
  assert.equal(hits,Number(minute%5===0),`${day} ${hour}:${minute}`);
 }
 assert.equal((source.match(/timezone: America\/Los_Angeles/g)||[]).length,1);
});
