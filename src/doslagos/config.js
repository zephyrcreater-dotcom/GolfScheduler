require('dotenv').config();

const config = {
  email: process.env.GOLF_EMAIL,
  password: process.env.GOLF_PASSWORD,

  timezone: process.env.DOSLAGOS_TIMEZONE || 'America/Los_Angeles',

  horizonDays: parseInt(process.env.DOSLAGOS_HORIZON_DAYS || '12', 10),

  golfers: parseInt(process.env.DOSLAGOS_GOLFERS || '1', 10),

  windowStart: process.env.DOSLAGOS_WINDOW_START || '06:00',
  windowEnd: process.env.DOSLAGOS_WINDOW_END || '07:00',
  preferredTime: process.env.DOSLAGOS_PREFERRED_TIME || '06:35',
  saturdayCutoff: process.env.DOSLAGOS_SATURDAY_CUTOFF || '09:00',
  sundayCutoff: process.env.DOSLAGOS_SUNDAY_CUTOFF || '07:30',
  pollIntervalMs: 5 * 60 * 1000,

  confirmationSelector: process.env.DOSLAGOS_CONFIRMATION_SELECTOR || '',
  chromiumExecutablePath: process.env.DOSLAGOS_CHROMIUM_EXECUTABLE_PATH || undefined,
  browserChannel: process.env.DOSLAGOS_BROWSER_CHANNEL || undefined,
  startAtHistory: process.env.DOSLAGOS_START_AT_HISTORY === 'true',

  targetDays: (process.env.DOSLAGOS_TARGET_DAYS || '6,0')
    .split(',')
    .map(s => parseInt(s.trim(), 10)),

  site: {
    baseUrl: 'https://dos-lagos-golf-course.book.teeitup.com',
    courseId: '3510',
  },

  screenshotDir: process.env.DOSLAGOS_SCREENSHOT_DIR || './screenshots/doslagos',

  ntfy: {
    server: process.env.NTFY_SERVER || 'https://ntfy.sh',
    topic: process.env.NTFY_TOPIC || '',
  },

  card: {
    number: process.env.DOSLAGOS_CARD_NUMBER || '',
    expMonth: process.env.DOSLAGOS_CARD_EXP_MONTH || '',
    expYear: process.env.DOSLAGOS_CARD_EXP_YEAR || '',
    name: process.env.DOSLAGOS_CARD_NAME || '',
    cvv: process.env.DOSLAGOS_CARD_CVV || '',
    billingAddress: process.env.DOSLAGOS_BILLING_ADDRESS || '',
    billingPostal: process.env.DOSLAGOS_BILLING_POSTAL || '',
    billingCountry: process.env.DOSLAGOS_BILLING_COUNTRY || '',
  },
};

if (!config.email || !config.password) {
  console.error('ERROR: GOLF_EMAIL and GOLF_PASSWORD must be set in .env (shared GolfID login).');
  process.exit(1);
}

module.exports = config;
