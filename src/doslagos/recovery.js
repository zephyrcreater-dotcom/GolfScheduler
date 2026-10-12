const UNCERTAIN = new Set(['attempting', 'purchase-attempted', 'needs-review']);
const MAX_ATTEMPTS = 2;

// Called while holding the same distributed lease as the normal checker.
async function recoverDate(date, { store, file, createSite, notifier, book }) {
  let state = await store.load(file);
  const entry = state[date];
  if (!entry || !UNCERTAIN.has(entry.status)) return;
  // Legacy uncertain records already represent one attempted booking.
  const attempts = entry.attemptCount || 1;
  const site = createSite();
  try {
    await site.init();
    await site.login();
    let historyAvailable = true;
    let reservations;
    try { reservations = await site.reservationHistory(); }
    catch (error) {
      if (error.blocked || error.fatalStartup) throw error;
      historyAvailable = false;
    }
    const existing = reservations?.find(reservation => reservation.date === date);
    if (existing) {
      state[date] = { ...entry, ...existing, status: 'confirmed',
        confirmation: existing.reference || 'verified-in-reservation-history' };
      await store.save(file, state);
      await notifier.outcome({ ...existing, status: 'confirmed' });
      return;
    }
    if (attempts >= MAX_ATTEMPTS) {
      state[date] = { ...entry, status: 'retry-exhausted', attemptCount: attempts };
      await store.save(file, state);
      await notifier.outcome({ date, time: entry.time, status: 'retry-exhausted',
        reason: 'Two attempts used; check history for a possible reservation or duplicate.' });
      return;
    }
    // Never submit a cart containing an unknown hold from another date.
    // A pending cart is rechecked by the next scheduled run after its expiry.
    if (await site.hasPendingCart()) {
      if (!entry.retryWaitingNotified) {
        state[date] = { ...entry, retryWaitingNotified: true };
        await store.save(file, state);
        await notifier.error({ reason: `${date}: automatic retry waiting for the existing cart to expire; the next scheduled scan will check again.` });
      }
      return;
    }
    await notifier.error({ reason: `${date}: restarting Chromium and making the final automatic retry.${historyAvailable
      ? ' History currently shows no reservation; a delayed confirmation can still cause a duplicate.'
      : ' History could not be verified; a duplicate reservation is possible.'}` });
    state[date] = { ...entry, status: 'none', attemptCount: attempts,
      retryAuthorizedAt: new Date().toISOString(), retryHistoryAvailable: historyAvailable };
    delete state[date].error;
    await store.save(file, state);
    try { await book(site); }
    catch (error) {
      state = await store.load(file);
      if (UNCERTAIN.has(state[date]?.status) && state[date].attemptCount >= MAX_ATTEMPTS) {
        state[date].status = 'retry-exhausted';
        await store.save(file, state);
        await notifier.outcome({ date, time: state[date].time, status: 'retry-exhausted',
          reason: 'Both attempts failed to confirm; check for possible duplicate reservations.' });
      }
      throw error;
    }
  } finally { await site.close().catch(() => {}); }
}

module.exports = { recoverDate, UNCERTAIN, MAX_ATTEMPTS };
