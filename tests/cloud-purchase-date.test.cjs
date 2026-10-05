const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
test('manual purchase tests reject missing dates before starting a scan', () => {
  for (const date of ['', '2026-10-17,2026-10-18']) {
    const result = spawnSync(process.execPath,
      [path.join(__dirname, '../src/doslagos/cloud.js'), `--purchase-test-date=${date}`], {
        encoding: 'utf8', timeout: 5000,
        env: { ...process.env, UPSTASH_REDIS_REST_URL: 'https://example.invalid',
          UPSTASH_REDIS_REST_TOKEN: 'test-only', DOSLAGOS_COMPLETE_PURCHASE: 'false' },
      });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires an explicit YYYY-MM-DD date/);
    assert.doesNotMatch(result.stdout, /finalPurchaseClickEnabled/);
  }
});
