const test = require('node:test');
const assert = require('node:assert/strict');
const { cardDigits, enterCardNumber, ensureCardReady } = require('../src/doslagos/payment');
const testNumber = '4111111111111111';

test('validates configured numbers without including them in errors', () => {
  assert.equal(cardDigits('4111 1111-1111 1111'), testNumber);
  for (const number of ['4111111111111112', 'secret', '0000000000000000']) {
    assert.throws(() => cardDigits(number), error => !error.message.includes(number));
  }
});

// Simulate the checkout mask and a form rerender resetting its field.
function fixture({ reset = false, reject = false, disabled = false } = {}) {
  const input = { value: reset ? '' : '4111 1111 1111 1111', disabled,
    validity: { valid: true }, getAttribute: () => reject ? 'true' : 'false' };
  let fills = 0;
  const field = {
    fill: async value => { fills++; input.value = value.replace(/(\d{4})(?=\d)/g, '$1 '); },
    blur: async () => {},
    evaluate: async (callback, argument) => callback(input, argument),
  };
  return { page: { locator: () => field, waitForTimeout: async () => {} }, input,
    fills: () => fills };
}

test('restores a reset masked number before submission and validates the final value', async () => {
  const f = fixture({ reset: true });
  await ensureCardReady(f.page, testNumber);
  assert.equal(f.input.value.replace(/\D/g, ''), testNumber);
  assert.equal(f.fills(), 2);
});

test('does not overwrite a ready card or retry a purchase', async () => {
  const f = fixture();
  await ensureCardReady(f.page, testNumber);
  assert.equal(f.fills(), 0);
});

test('stops for rejected or disabled fields without exposing payment data', async () => {
  for (const options of [{ reject: true }, { disabled: true }]) {
    const f = fixture(options);
    await assert.rejects(enterCardNumber(f.page, testNumber), error =>
      /purchase stopped/.test(error.message) && !error.message.includes(testNumber));
  }
});
