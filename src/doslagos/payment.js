function cardDigits(number) {
  const digits = String(number || '').replace(/[\s-]/g, '');
  if (!/^\d{12,19}$/.test(digits)) throw new Error('Configured card number must contain 12–19 digits');
  let sum = 0;
  for (let i = digits.length - 1, position = 0; i >= 0; i--, position++) {
    let digit = Number(digits[i]);
    if (position % 2) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  if (!sum || sum % 10) throw new Error('Configured card number failed its checksum; purchase stopped');
  return digits;
}

async function cardStatus(page, number) {
  const digits = cardDigits(number);
  return page.locator('#credit-card-number-input').evaluate((input, expected) => ({
    numberMatches: input.value.replace(/\D/g, '') === expected,
    empty: !input.value,
    invalid: input.getAttribute('aria-invalid') === 'true' || !input.validity.valid,
    disabled: input.disabled,
  }), digits);
}

async function enterCardNumber(page, number) {
  const digits = cardDigits(number);
  const field = page.locator('#credit-card-number-input');
  await field.fill('');
  // One input event avoids intermediate masked values during React rerenders.
  await field.fill(digits);
  await field.blur();
  await page.waitForTimeout(250);
  const status = await cardStatus(page, digits);
  if (!status.numberMatches || status.invalid || status.disabled) {
    throw new Error(`Card number not ready; purchase stopped. Card field: ${JSON.stringify(status)}`);
  }
}

async function ensureCardReady(page, number) {
  const status = await cardStatus(page, number);
  if (!status.numberMatches || status.invalid) await enterCardNumber(page, number);
  const final = await cardStatus(page, number);
  if (!final.numberMatches || final.invalid || final.disabled) {
    throw new Error(`Card number not ready; purchase stopped. Card field: ${JSON.stringify(final)}`);
  }
}

module.exports = { cardDigits, cardStatus, enterCardNumber, ensureCardReady };
