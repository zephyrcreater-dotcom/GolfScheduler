function findLoginEntry() {
  const controls = [...document.querySelectorAll('button, a, [role="button"], [role="link"]')]
    .filter(element => element.getClientRects().length &&
      getComputedStyle(element).visibility !== 'hidden' &&
      !element.disabled && element.getAttribute('aria-disabled') !== 'true');
  const name = element => (element.getAttribute('aria-label') || element.textContent || '')
    .replace(/\s+/g, ' ').trim();
  return controls.find(element => /\b(?:log\s*in|sign\s*in)\b/i.test(name(element))) ||
    controls.find(element => /\bsign\s*up\b/i.test(name(element))) || false;
}

async function openLogin(page, checkForBlocks) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await checkForBlocks();
    let handle;
    try {
      handle = await page.waitForFunction(findLoginEntry, null, { timeout: 25000 });
      await handle.asElement().click({ timeout: 10000 });
      return;
    } catch (error) {
      await checkForBlocks();
      if (attempt === 1) throw new Error('Login control did not become ready after waiting and one reload');
      console.log('Login control not ready; reloading the landing page once.');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    } finally { if (handle) await handle.dispose(); }
  }
}

async function waitForAutomaticCheck(page, timeoutMs = 20000) {
  if (!/just a moment|attention required/i.test(await page.title())) return;
  await page.waitForFunction(() => !/just a moment|attention required/i.test(document.title),
    null, { timeout: timeoutMs }).catch(() => {});
  if (/just a moment|attention required/i.test(await page.title())) {
    const error = new Error('BLOCKED: browser security challenge did not clear automatically');
    error.blocked = true;
    throw error;
  }
}
module.exports = { findLoginEntry, openLogin, waitForAutomaticCheck };
