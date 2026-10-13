const test = require('node:test'), assert = require('node:assert/strict');
const { purchaseDiagnostic } = require('../src/doslagos/purchase-diagnostic');
test('manual duplicate diagnostic preserves confirmed state and can submit only once', async () => {
  process.env.APPROVE_DUPLICATE_PURCHASE = 'true';
  const date = '2026-10-25';
  let state = { [date]: { status: 'confirmed', confirmation: '#EXISTING', time: '06:15' } };
  let calls = 0, released = 0;
  const options = {
    store: { acquire: async () => async () => { released++; }, load: async () => structuredClone(state),
      save: async (_, value) => { state = structuredClone(value); } },
    notifier: { error: async () => {}, outcome: async () => {} },
    settings: { windowStart: '06:00', windowEnd: '07:00', preferredTime: '06:35', sundayCutoff: '07:30', golfers: 1 },
    site: { init: async () => {}, login: async () => {}, reservationHistory: async () => [],
      hasPendingCart: async () => false, searchDate: async () => {}, close: async () => {},
      getAvailableTimes: async () => [{ index: 0, time: '06:24' }],
      reserveAndReachCheckout: async (_, __, input) => { calls++; await input.beforePurchase(); return { confirmation: '#DIAGNOSTIC' }; } },
  };
  await purchaseDiagnostic(date, options);
  assert.equal(state[date].confirmation, '#EXISTING'); assert.equal(state[date].status, 'confirmed');
  assert.equal(state[date].diagnosticPurchase.confirmation, '#DIAGNOSTIC');
  await assert.rejects(purchaseDiagnostic(date, options), /already has/);
  assert.equal(calls, 1); assert.equal(released, 2);
  process.env.APPROVE_DUPLICATE_PURCHASE = 'false';
  await assert.rejects(purchaseDiagnostic(date, options), /explicit duplicate approval/);
  assert.equal(released, 2);
});
