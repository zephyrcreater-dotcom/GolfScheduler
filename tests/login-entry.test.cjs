const test = require('node:test'), assert = require('node:assert/strict');
const { findLoginEntry, openLogin } = require('../src/doslagos/login-entry');
test('selects a visible sign-in control instead of hidden or disabled duplicates', () => {
  const previousDocument = global.document, previousStyle = global.getComputedStyle;
  const control = (text, visible = true, disabled = false, label = '') => ({ textContent: text, disabled,
    getClientRects: () => visible ? [1] : [], getAttribute: name => name === 'aria-label' ? label : null });
  const hidden = control('Login', false), disabled = control('Login', true, true);
  const signup = control('Sign Up'), login = control('', true, false, 'Sign in');
  global.document = { querySelectorAll: () => [hidden, disabled, signup, login] };
  global.getComputedStyle = () => ({ visibility: 'visible' });
  try { assert.equal(findLoginEntry(), login); }
  finally { global.document = previousDocument; global.getComputedStyle = previousStyle; }
});
test('waits for readiness, reloads once, and disposes the clicked control', async () => {
  let waits = 0, reloads = 0, clicked = 0, disposed = 0;
  const page = { waitForFunction: async (_, __, options) => {
    assert.equal(options.timeout, 25000);
    if (++waits === 1) throw Error('Timeout');
    return { asElement: () => ({ click: async () => { clicked++; } }), dispose: async () => { disposed++; } };
  }, reload: async () => { reloads++; } };
  await openLogin(page, async () => {});
  assert.equal(waits, 2); assert.equal(reloads, 1); assert.equal(clicked, 1); assert.equal(disposed, 1);
});
test('persistent loading stops after two waits; a security block never reloads', async () => {
  let reloads = 0;
  const page = { waitForFunction: async () => { throw Error('Timeout'); }, reload: async () => { reloads++; } };
  await assert.rejects(openLogin(page, async () => {}), /one reload/);
  assert.equal(reloads, 1);
  await assert.rejects(openLogin(page, async () => { throw Error('Security challenge'); }), /Security challenge/);
  assert.equal(reloads, 1);
});
