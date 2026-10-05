const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const config = require('./config');
const { selectTeeTime, candidateDates } = require('./selection');
const storage = require('./state');
const notify = require('./notify');
const STATE_PATH = path.join(__dirname, '../../data/doslagos-state.json');

// A lock is written BEFORE adding anything to cart. Even a crash after the
// purchase click cannot cause another attempt for that date on the next scan.
async function checkDate(date, { file = STATE_PATH, settings = config,
  createSite = () => new (require('./site'))(), fillPayment = false, completePurchase = false,
  store = storage, notifier = notify, sharedSite = null, allowBooking = true } = {}) {
  const state = await store.load(file);
  const prior = state[date];
  if (prior && storage.LOCKED.has(prior.status)) {
    console.log(`${date}: ${prior.status}; skipping (one tee time per date).`);
    return;
  }
  const site = sharedSite || createSite();
  try {
    if (!sharedSite) {
    await site.init();
    await site.login();
    }
    await site.searchDate(date);
    const times = await site.getAvailableTimes();
    const target = selectTeeTime(times, date, settings);
    const earlyTimes = times.filter(slot => slot.time < '09:00');
    const signature = JSON.stringify(earlyTimes.map(slot => [slot.time, slot.price, slot.maxGolfers]).sort());
    if (earlyTimes.length && prior?.availabilityNotified !== signature) {
      await notifier.searchResults({date, times:earlyTimes, target, golfers:settings.golfers});
    }
    state[date] = { ...state[date], availabilityNotified:signature };
    await store.save(file, state);
    if (!target) {
      state[date] = { ...state[date], status: 'none', checkedAt: new Date().toISOString() };
      await store.save(file, state);
      console.log(`${date}: no eligible time; will check again.`);
      return;
    }
    if (!allowBooking) {
      console.log(`${date}: matching ${target.time}; booking paused while another cart/purchase needs review.`);
      return;
    }
    console.log(`${date}: selected ${target.time}, ${settings.golfers} golfer(s).`);
    state[date] = { ...state[date], status: 'attempting', time: target.time, golfers: settings.golfers,
      attemptedAt: new Date().toISOString() };
    await store.save(file, state);
    await notifier.found({date, time:target.time, golfers:settings.golfers, price:target.price});
    const result = await site.reserveAndReachCheckout(target.index, settings.golfers, {
      fillPayment, completePurchase, expectedSlot: target,
      beforePurchase: async () => {
        state[date].status = 'purchase-attempted';
        await store.save(file, state);
      },
    });
    if (result.confirmation) {
      state[date].status = 'confirmed';
      state[date].confirmation = result.confirmation;
    } else if (result.reached && !completePurchase) {
      state[date].status = 'held';
    } else {
      state[date].status = 'needs-review';
      state[date].error = result.error || 'Purchase clicked; confirmation not verified. Check reservation history.';
    }
    await store.save(file, state);
    console.log(`${date}: ${state[date].status}${state[date].error ? ` — ${state[date].error}` : ''}`);
    if (result.blocked) {
      const error = new Error(result.error);
      error.blocked = true;
      throw error;
    }
  } catch (error) {
    if (state[date] && storage.LOCKED.has(state[date].status)) {
      state[date].status = 'needs-review';
      state[date].error = error.message;
      await store.save(file, state);
    }
    error.notified = true;
    throw error;
  } finally {
    if (!sharedSite) await site.close();
  }
}

async function main(args = process.argv.slice(2), overrides = {}) {
  const notifier = overrides.notifier || notify;
  const store = overrides.store || storage;
  if (!overrides.notifier && !config.ntfy.topic) throw new Error('Set NTFY_TOPIC in the project .env for checker notifications');
  // PAYMENT INPUT OFF without --fill-test-payment; ON with it (project .env).
  const fillPayment = args.includes('--fill-test-payment');
  // FINAL CLICK OFF without --complete-test-purchase; ON with it.
  const completePurchase = args.includes('--complete-test-purchase');
  const watch = args.includes('--watch');
  const dateArg = args.find(arg => arg.startsWith('--date='));
  const date = dateArg && dateArg.slice(7);
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0,10) !== date)) {
    throw new Error('Use --date=YYYY-MM-DD with a valid date');
  }
  if (completePurchase && !fillPayment) throw new Error('Automated final purchase requires --fill-test-payment as well');
  if (fillPayment) {
    for (const field of ['number','expMonth','expYear','cvv','billingAddress','billingPostal','billingCountry']) {
      if (!config.card[field]) throw new Error(`Missing test payment configuration: ${field}`);
    }
  }
  const file = overrides.file || STATE_PATH;
  const release = await store.acquire(`${file}.lock`);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  console.log(JSON.stringify({watch, paymentInputEnabled: fillPayment, finalPurchaseClickEnabled: completePurchase}));
  let sharedSite = null;
  let sessionReady = false;
  try {
    do {
      const dates = date ? [date] : (overrides.dates || candidateDates(config));
      for (const target of dates) {
        if (controller.signal.aborted) break;
        try {
          const current = await store.load(file);
          if (current[target] && storage.LOCKED.has(current[target].status)) {
            console.log(`${target}: ${current[target].status}; skipping.`);
            continue;
          }
          if (!sharedSite) {
            sharedSite = overrides.createSite ? overrides.createSite() : new (require('./site'))();
            await sharedSite.init();
            await sharedSite.login();
            sessionReady = true;
          }
          const allowBooking = overrides.allowBooking !== false && !Object.values(current).some(entry =>
            ['held','attempting','purchase-attempted','needs-review'].includes(entry.status));
          await checkDate(target, { ...overrides, file, fillPayment, completePurchase, sharedSite, allowBooking });
        }
        catch (error) {
          console.error(`${target}: ${error.message}`);
          if (!error.notified) {
            error.notified = true;
          }
          if (error.blocked || error.fatalStartup || !sessionReady) throw error;
          if (!watch) process.exitCode = 1;
        }
      }
      const state = await store.load(file);
      const locked = dates.filter(target => state[target] && storage.LOCKED.has(state[target].status));
      if (!watch || controller.signal.aborted) break;
      console.log('Scan finished. Next scan in five minutes. Ctrl+C stops the checker.');
      await delay(config.pollIntervalMs, undefined, { signal: controller.signal });
    } while (!controller.signal.aborted);
  } catch (error) {
    if (error.name !== 'AbortError') {
      throw error;
    }
  } finally {
    if (sharedSite) await sharedSite.close().catch(() => {});
    await release();
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
if (require.main === module) main().catch(async error => {
  console.error(error.message);
  process.exitCode = 1;
});
module.exports = { main, checkDate, STATE_PATH };
