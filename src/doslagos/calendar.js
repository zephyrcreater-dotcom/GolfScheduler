const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function dateParts(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`)) ||
      new Date(`${date}T12:00:00Z`).toISOString().slice(0,10) !== date) throw new Error('Invalid search date');
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day, label: `${MONTHS[month-1].slice(0,3)} ${String(day).padStart(2,'0')}, ${year}` };
}
async function assertDisplayedDate(page, date) {
  const { label } = dateParts(date);
  await page.waitForFunction(expected => [...document.querySelectorAll('[data-testid="teetimes-header-date-link"], [data-testid="mobile-filter-date"]')]
    .some(element => element.getClientRects().length && element.textContent.trim() === expected), label, { timeout: 15000 });
}
async function selectCalendarDate(page, date) {
  const target = dateParts(date);
  if (!new URL(page.url()).pathname.startsWith('/teetimes')) {
    await page.getByRole('link', { name: /^tee times$/i }).first().click();
  }
  let calendar = page.locator('.MuiDateCalendar-root:visible').first();
  if (!await calendar.isVisible()) {
    await page.locator('[data-testid="teetimes-header-date-link"]:visible, [data-testid="mobile-filter-date"]:visible').first().click();
    calendar = page.locator('.MuiDateCalendar-root:visible').first();
  }
  await calendar.waitFor({ state: 'visible', timeout: 25000 });
  for (let step = 0; step < 24; step++) {
    const labels = await calendar.locator('[aria-live="polite"]').allTextContents();
    const match = labels.map(text => text.trim().match(/^([A-Za-z]+) (\d{4})$/)).find(Boolean);
    if (!match || !MONTHS.includes(match[1])) throw new Error('Calendar month could not be verified');
    const difference = (target.year - Number(match[2])) * 12 + target.month - 1 - MONTHS.indexOf(match[1]);
    if (!difference) {
      await calendar.locator('button:visible:not([disabled]):not(.MuiPickersDay-dayOutsideMonth)')
        .filter({ hasText: new RegExp(`^${target.day}$`) }).first().click();
      await assertDisplayedDate(page, date);
      return;
    }
    await calendar.getByRole('button', { name: difference > 0 ? 'Next month' : 'Previous month', exact: true }).click();
    await page.waitForTimeout(200);
  }
  throw new Error('Target month is outside the supported calendar navigation range');
}
async function searchByCalendar(page, date, { baseUrl, courseId, checkForBlocks, allowUrlFallback = true }) {
  dateParts(date);
  await checkForBlocks();
  try {
    await selectCalendarDate(page, date);
    console.log(`${date}: selected through calendar; displayed date verified.`);
  } catch (error) {

    await checkForBlocks();
    if (!allowUrlFallback) throw error;
    console.log(`${date}: calendar unavailable; trying verified URL fallback.`);
    await page.goto(`${baseUrl}/teetimes?course=${encodeURIComponent(courseId)}&date=${date}&max=999999`,
      { waitUntil: 'domcontentloaded', timeout: 60000 });
    await checkForBlocks();
    await assertDisplayedDate(page, date);
  }
  await page.waitForTimeout(300);
  await page.waitForFunction(() => {
    if ([...document.querySelectorAll('[role="progressbar"]')].some(element => element.getClientRects().length)) return false;
    return [...document.querySelectorAll('button')].some(button => /book now/i.test(button.textContent)) ||
      /no results|there are no tee times|no tee times available/i.test(document.body.innerText);
  }, null, { timeout: 30000 });
  await checkForBlocks();
  await assertDisplayedDate(page, date);
}
module.exports = { dateParts, assertDisplayedDate, selectCalendarDate, searchByCalendar };
