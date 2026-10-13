// Manual only: one explicitly approved extra purchase, preserving existing bookings.
async function purchaseDiagnostic(date, { store, site, settings, notifier }) {
  if (process.env.APPROVE_DUPLICATE_PURCHASE !== 'true' || !/^\d{4}-\d{2}-\d{2}$/.test(date || '') ||
      new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error('Diagnostic purchase requires a valid date and explicit duplicate approval');
  }
  const release = await store.acquire();
  let state;
  try {
    state = await store.load();
    if (state[date]?.diagnosticPurchase) throw new Error('This date already has a diagnostic attempt; refusing another');
    await site.init();
    await site.login();
    await site.reservationHistory();
    if (await site.hasPendingCart()) throw new Error('Pending cart; diagnostic stopped');
    await site.searchDate(date);
    const target = require('./selection').selectTeeTime(await site.getAvailableTimes(), date, settings);
    if (!target) throw new Error('No eligible time for diagnostic purchase');
    state[date] = { ...state[date], diagnosticPurchase: { status: 'attempting', time: target.time,
      attemptedAt: new Date().toISOString() } };
    await store.save(null, state);
    console.log(`${date}: diagnostic selected ${target.time}, ${settings.golfers} golfer(s); duplicate authorized`);
    await notifier.error({ reason: `${date} at ${target.time}: one explicitly approved diagnostic purchase; a duplicate is possible.` });
    const result = await site.reserveAndReachCheckout(target.index, settings.golfers, {
      fillPayment: true, completePurchase: true, expectedSlot: { ...target, date },
      beforePurchase: async () => {
        state[date].diagnosticPurchase.status = 'purchase-attempted';
        await store.save(null, state);
      },
    });
    Object.assign(state[date].diagnosticPurchase, { status: result.confirmation ? 'confirmed' : 'needs-review',
      ...(result.confirmation ? { confirmation: result.confirmation } : { error: result.error || 'No confirmation received' }) });
    await store.save(null, state);
    if (!result.confirmation) throw new Error(result.error || 'Diagnostic purchase not confirmed');
    console.log(JSON.stringify({ date, time: target.time, confirmation: result.confirmation }));
    await notifier.outcome({ date, time: target.time, status: 'confirmed', reason: 'Additional diagnostic reservation confirmed.' });
  } catch (error) {
    await notifier.error({ reason: `${date}: diagnostic purchase: ${error.message}` });
    throw error;
  } finally {
    await site.close().catch(() => {});
    await release();
  }
}
if (require.main === module) {
  require('dotenv').config();
  const Redis = require('./redis-state'), Site = require('./site');
  purchaseDiagnostic(process.env.DIAGNOSTIC_DATE, {
    store: new Redis(), site: new Site(), settings: require('./config'), notifier: require('./notify'),
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { purchaseDiagnostic };
