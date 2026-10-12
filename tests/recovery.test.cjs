const test = require('node:test');
const assert = require('node:assert/strict');
const { recoverDate } = require('../src/doslagos/recovery');
const date = '2026-10-24';
function fixture({ history = [], historyFails = false, pending = false, attempts = 1, fail = false } = {}) {
  let state = { [date]: { status: 'needs-review', time: '06:33', attemptCount: attempts } };
  let calls = 0, closed = 0, initialized = 0;
  const notifications = [];
  const options = {
    store: { load: async () => structuredClone(state), save: async (_, value) => { state = structuredClone(value); } },
    notifier: { error: async event => notifications.push(event), outcome: async event => notifications.push(event) },
    createSite: () => ({
      init: async () => { initialized++; }, login: async () => {},
      reservationHistory: async () => { if (historyFails) throw Error('Timeout'); return history; },
      hasPendingCart: async () => pending, close: async () => { closed++; },
    }),
    book: async () => {
      calls++;
      assert.equal(state[date].status, 'none');
      state[date].attemptCount++;
      state[date].status = fail ? 'needs-review' : 'confirmed';
      if (fail) throw Error('Submission timed out');
    },
  };
  return { options, state: () => state[date], calls: () => calls, closed: () => closed,
    initialized: () => initialized, notifications };
}
test('restarts and retries an uncertain purchase once when history cannot be verified', async () => {
  const f = fixture({ historyFails: true });
  await recoverDate(date, f.options);
  assert.equal(f.calls(), 1); assert.equal(f.initialized(), 1); assert.equal(f.closed(), 1);
  assert.equal(f.state().status, 'confirmed'); assert.equal(f.state().attemptCount, 2);
  assert.match(f.notifications[0].reason, /duplicate reservation is possible/);
  await recoverDate(date, f.options); assert.equal(f.calls(), 1);
});
test('history confirmation prevents a second purchase without requiring a confirmation screen number', async () => {
  const f = fixture({ history: [{ date, time: '06:33', golfers: 1 }] });
  await recoverDate(date, f.options);
  assert.equal(f.calls(), 0); assert.equal(f.state().status, 'confirmed');
  assert.equal(f.state().confirmation, 'verified-in-reservation-history');
});
test('second failed attempt exhausts persistent budget across restarts', async () => {
  const f = fixture({ fail: true });
  await assert.rejects(recoverDate(date, f.options), /timed out/);
  assert.equal(f.state().status, 'retry-exhausted'); assert.equal(f.state().attemptCount, 2);
  await recoverDate(date, f.options); assert.equal(f.calls(), 1);
  const crash = fixture({ attempts: 2 });
  await recoverDate(date, crash.options);
  assert.equal(crash.calls(), 0); assert.equal(crash.state().status, 'retry-exhausted');
});
test('pending cart defers retry without spending its budget or repeating alerts', async () => {
  const f = fixture({ pending: true });
  await recoverDate(date, f.options); await recoverDate(date, f.options);
  assert.equal(f.calls(), 0); assert.equal(f.state().attemptCount, 1);
  assert.equal(f.notifications.length, 1); assert.equal(f.closed(), 2);
});
test('legacy uncertain records receive only one extra attempt and blocked history never retries', async () => {
  const f = fixture({ attempts: undefined });
  // Remove the counter to model an old deployed state record.
  const store = f.options.store;
  const state = await store.load(); delete state[date].attemptCount; await store.save(null, state);
  await recoverDate(date, f.options); assert.equal(f.state().attemptCount, 2);
  const blocked = fixture();
  blocked.options.createSite = () => ({ init: async () => {}, login: async () => {},
    reservationHistory: async () => { const error = Error('Blocked'); error.blocked = true; throw error; },
    close: async () => {} });
  await assert.rejects(recoverDate(date, blocked.options), /Blocked/); assert.equal(blocked.calls(), 0);
});

test('normal checker immediately closes the failed browser and confirms on its one recovery attempt', async () => {
  process.env.GOLF_EMAIL = 'offline@example.invalid'; process.env.GOLF_PASSWORD = 'offline';
  const config = require('../src/doslagos/config');
  const original = config.card;
  config.card = { number: '4111111111111111', expMonth: '01', expYear: '2030', cvv: '123',
    billingAddress: 'Test', billingPostal: '00000', billingCountry: 'US' };
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-integration-'));
  const file = path.join(directory, 'state.json');
  const storage = require('../src/doslagos/state');
  const { main } = require('../src/doslagos/check');
  let created = 0, closed = 0, submitted = 0;
  const notifier = Object.fromEntries(['error','found','searchResults','outcome'].map(name => [name, async () => {}]));
  const createSite = () => {
    const number = ++created;
    if (number === 2) assert.equal(closed, 1);
    return { init: async () => {}, login: async () => {}, close: async () => { closed++; },
      reservationHistory: async () => [], hasPendingCart: async () => false,
      searchDate: async () => {}, getAvailableTimes: async () => [{ index: 0, time: '06:33', maxGolfers: 1 }],
      reserveAndReachCheckout: async (_, __, options) => {
        submitted++; await options.beforePurchase();
        return number === 1 ? { reached: true, purchaseClicked: true } : { reached: true, confirmation: '#OFFLINE' };
      } };
  };
  try {
    const options = { file, store: storage, notifier, createSite, allowBooking: true };
    const args = [`--date=${date}`, '--fill-test-payment', '--complete-test-purchase'];
    await main(args, options);
    assert.equal(submitted, 2); assert.equal(created, 2); assert.equal(closed, 2);
    assert.equal(storage.load(file)[date].status, 'confirmed');
    assert.equal(storage.load(file)[date].attemptCount, 2);
    await main(args, options); assert.equal(submitted, 2);
  } finally { config.card = original; fs.rmSync(directory, { recursive: true, force: true }); }
});
