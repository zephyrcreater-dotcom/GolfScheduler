// Cloud jobs perform ONE scan. Scheduling is managed by GitHub Actions.
require('dotenv').config();
// Respect the workflow's tested browser mode; other callers default to headless.
process.env.HEADLESS = process.env.HEADLESS || 'true';
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
  // Explicit manual test runs once; it does not enable scheduled purchases.
  const purchaseTest = process.argv.find(arg => arg.startsWith('--purchase-test-date='));
  const testDate = purchaseTest?.slice('--purchase-test-date='.length);
  if (purchaseTest && !/^\d{4}-\d{2}-\d{2}$/.test(testDate)) {
    throw new Error('Manual purchase test requires an explicit YYYY-MM-DD date');
  }
  const completePurchase = Boolean(purchaseTest) || process.env.DOSLAGOS_COMPLETE_PURCHASE === 'true';
  const args = completePurchase
    ? ['--fill-test-payment','--complete-test-purchase'] : [];
  if (purchaseTest) args.push(`--date=${testDate}`);
  else if (process.env.DOSLAGOS_DATE) args.push(`--date=${process.env.DOSLAGOS_DATE}`);
  await require('./check').main(args,{store,allowBooking:completePurchase});
})().catch(error=>{console.error(error.message);process.exitCode=1;});
