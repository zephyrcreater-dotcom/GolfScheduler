const test = require('node:test'), assert = require('node:assert/strict');
const { findLoginEntry, openLogin, waitForAutomaticCheck, waitForLoginForm } = require('../src/doslagos/login-entry');
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
test('automatic browser checks may finish normally but persistent challenges stay blocked', async () => {
  let title = 'Just a moment...', waits = 0;
  await waitForAutomaticCheck({ title: async()=>title, waitForFunction:async()=>{waits++;title='Dos Lagos';} });
  assert.equal(waits,1);
  await assert.rejects(waitForAutomaticCheck({ title:async()=> 'Just a moment...',
    waitForFunction:async()=>{throw Error('Timeout');} }), error=>error.blocked === true);
});

function loginFormPage(failures) {
  let waits = 0, reloads = 0, filtered = false;
  const timeout = Object.assign(new Error('form loading'), { name: 'TimeoutError' });
  const field = {
    or: () => field,
    filter: options => { assert.deepEqual(options, { visible: true }); filtered = true; return field; },
    first: () => { assert.equal(filtered, true); return field; },
    waitFor: async options => {
      assert.equal(options.timeout, 30000);
      if (++waits <= failures) throw timeout;
    },
  };
  return { field, getByRole: () => field, locator: () => field,
    reload: async () => { reloads++; }, url: () => 'https://example.test/login?private=value',
    counts: () => ({ waits, reloads }) };
}
test('login form filters hidden duplicates and recovers one incomplete render before credentials', async () => {
  const page = loginFormPage(1);
  assert.equal(await waitForLoginForm(page, async () => {}), page.field);
  assert.deepEqual(page.counts(), { waits: 2, reloads: 1 });
});
test('login form retry is bounded and diagnostics omit URL query values', async () => {
  const page = loginFormPage(2);
  await assert.rejects(waitForLoginForm(page, async () => {}), error =>
    /after one reload.*route: \/login/.test(error.message) && !error.message.includes('private'));
  assert.deepEqual(page.counts(), { waits: 2, reloads: 1 });
});
test('login form security challenges stop before reload', async () => {
  const page = loginFormPage(1);
  let checks = 0;
  await assert.rejects(waitForLoginForm(page, async () => {
    if (++checks === 2) throw Object.assign(Error('BLOCKED'), { blocked: true });
  }), error => error.blocked === true);
  assert.deepEqual(page.counts(), { waits: 1, reloads: 0 });
});
