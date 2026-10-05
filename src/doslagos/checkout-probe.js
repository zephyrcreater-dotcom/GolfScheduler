const config = require('./config');
const notify = require('./notify');
const {selectTeeTime} = require('./selection');
async function checkoutProbe(store, {date='2026-10-16', createSite=()=>new(require('./site'))(), notifier=notify}={}) {
  const release = await store.acquire();
  const site=createSite();
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid checkout test date');
    await site.init();await site.login();
    const state=await store.load();
    let time=state.__checkoutProbe?.time;
    let result;
    await site.reservationHistory();
    if (await site.hasPendingCart()) {
      if (state.__checkoutProbe?.date !== date) throw new Error('Existing cart is not owned by this checkout test; stopped');
      result=await site.resumeTestCheckout();
    } else {
      await site.searchDate(date);
      const times=await site.getAvailableTimes();
      console.log(JSON.stringify({checkoutTestDate:date,availableTimes:times.map(t=>({time:t.time,maxGolfers:t.maxGolfers}))}));
      const target=selectTeeTime(times,date,config);
      if (!target) throw new Error(`No eligible checkout test time for ${date}`);
      time=target.time;
      state.__checkoutProbe={date,time,status:'needs-review',testOnly:true};
      await store.save(null,state);
      result=await site.reserveAndReachCheckout(target.index,config.golfers,{fillPayment:false,completePurchase:false,expectedSlot:{...target,date}});
    }
    if (!result.reached) throw new Error(result.error || 'Checkout test did not reach checkout');
    await site.assertTestCheckout();
    console.log(`${date} ${time}: CHECKOUT_TEST_REACHED; payment and purchase disabled.`);
    if (!await notifier.push({title:'Checkout test — about to book',message:`${date} at ${time}: checkout reached. Test stopped before payment input or purchase. No booking submitted.`,tags:'golf,test_tube'})) throw new Error('Checkout reached but test notification delivery failed');
  } catch(error) {
    await notifier.error({reason:`Checkout test: ${error.message}`});
    throw error;
  } finally {await site.close().catch(()=>{});await release();}
}
module.exports={checkoutProbe};
