// Cloud jobs perform ONE scan. Scheduling is managed by GitHub Actions.
require('dotenv').config();
process.env.HEADLESS = 'true';
delete process.env.DOSLAGOS_CHROMIUM_EXECUTABLE_PATH;
const RedisState = require('./redis-state');
(async()=>{
  const store = new RedisState();
  if (process.argv.includes('--seed-local-state')) {
    const storage = require('./state');
    const path = require('node:path');
    const file=path.join(__dirname,'../../data/doslagos-state.json');
    // No credentials are stored: only dates, notification history, booking locks.
    const release=await store.acquire();
    try {
      const local = storage.load(file);
      const state = Object.fromEntries(Object.entries(local).map(([date, entry]) => [date,
        Object.fromEntries(['status','time','golfers','attemptedAt','availabilityNotified']
          .filter(key => entry[key] !== undefined).map(key => [key,entry[key]]))]));
      await store.initialize(state);
      console.log('Cloud state initialized without overwriting existing locks.');
    }
    finally { await release(); }
    return;
  }
  const args = process.env.DOSLAGOS_COMPLETE_PURCHASE === 'true'
    ? ['--fill-test-payment','--complete-test-purchase'] : [];
  await require('./check').main(args,{store,allowBooking:process.env.DOSLAGOS_COMPLETE_PURCHASE === 'true'});
})().catch(error=>{console.error(error.message);process.exitCode=1;});
