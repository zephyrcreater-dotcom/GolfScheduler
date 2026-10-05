const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
process.env.GOLF_EMAIL = 'diagnostic@example.invalid';
process.env.GOLF_PASSWORD = 'diagnostic-password';
const { diagnostic } = require('../src/doslagos/browser-diagnostic');

test('public diagnostics never log reservations, authentication headers or token contents', async () => {
  const page = new EventEmitter();
  const origin = 'https://phx-api-be-east-1b.kenna.io';
  page.evaluate = async (fn, args) => args ? fn(args) : origin;
  const site = {
    page,
    login: async () => page.emit('request', {
      method: () => 'GET', url: () => `${origin}/reservations`,
      allHeaders: async () => ({ authorization: 'private-authentication', cookie: 'private-cookie' }),
    }),
    reservationHistory: async () => [{ date: 'private-reservation-date', time: 'private-time', golfers: 1 }],
  };
  const output = [];
  const log = console.log, request = global.fetch;
  console.log = value => output.push(value);
  global.fetch = async (url, options) => {
    assert.equal(url, `${origin}/tr/token`);
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.cookie, undefined);
    return { ok: true, status: 200,
      text: () => { throw new Error('Token body must never be read'); },
      json: () => { throw new Error('Token body must never be read'); } };
  };
  try {
    await diagnostic(site);
    assert.match(output.join('\n'), /historyReadSucceeded/);
    assert.match(output.join('\n'), /tokenRequestSucceeded/);
    assert.doesNotMatch(output.join('\n'), /private-|authorization|cookie|reservations/);
  } finally { console.log = log; global.fetch = request; }
});
