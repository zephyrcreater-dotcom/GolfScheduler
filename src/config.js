require('dotenv').config();
const path = require('path');
const fs = require('fs');

const dayMap = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const schedulePath = path.join(__dirname, '..', 'schedule.json');
let rawSchedule = [];
if (fs.existsSync(schedulePath)) {
  rawSchedule = JSON.parse(fs.readFileSync(schedulePath, 'utf8'));
} else {
  console.error('ERROR: schedule.json not found in project root.');
  process.exit(1);
}

function formatTimeLabel(start, end) {
  const fmt = (t) => {
    const [h, m] = t.split(':').map(Number);
    const hour = h % 12 || 12;
    const ampm = h < 12 ? 'AM' : 'PM';
    return m === 0 ? `${hour} ${ampm}` : `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
  };
  return `${fmt(start)}-${fmt(end)}`;
}

function resolveAlternatingCourse(dateStr) {

  const [year, month, day] = dateStr.split('-').map(Number);

  const d = new Date(Date.UTC(year, month - 1, day));

  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const isoWeek = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return isoWeek % 2 === 0 ? 'Pines' : 'Oaks';
}

const schedule = rawSchedule.map(entry => {
  const dayNum = dayMap[entry.day.toLowerCase()];
  if (dayNum === undefined) {
    console.error(`ERROR: Invalid day "${entry.day}" in schedule.json. Use: Sunday, Monday, ..., Saturday`);
    process.exit(1);
  }
  return {
    day: dayNum,
    windowStart: entry.windowStart,
    windowEnd: entry.windowEnd,
    players: entry.players,
    slots: entry.slots,

    preferredCourse: entry.course || 'Pines',
    label: `${entry.day} ${formatTimeLabel(entry.windowStart, entry.windowEnd)}`,
  };
});

const config = {

  email: process.env.GOLF_EMAIL,
  password: process.env.GOLF_PASSWORD,

  golfers: (() => {
    const all = [
      { email: process.env.GOLF_EMAIL,  password: process.env.GOLF_PASSWORD },
      { email: process.env.GOLF_EMAIL2, password: process.env.GOLF_PASSWORD2 },
      { email: process.env.GOLF_EMAIL3, password: process.env.GOLF_PASSWORD3 },
    ];
    return all.filter(g => g.email && g.password);
  })(),

  timezone: process.env.TIMEZONE || 'America/Chicago',

  horizonDays: parseInt(process.env.BOOKING_HORIZON_DAYS || '30', 10),

  maxRetries: 3,

  screenshotDir: process.env.SCREENSHOT_DIR || './screenshots',
  dbPath: process.env.DB_PATH || './data/bookings.db',

  logLevel: process.env.LOG_LEVEL || 'info',

  schedulerHour: (() => {
    const raw = parseInt(process.env.SCHEDULER_HOUR || '6', 10);
    if (isNaN(raw) || raw < 0 || raw > 23) {
      console.warn(`WARNING: SCHEDULER_HOUR="${process.env.SCHEDULER_HOUR}" is out of range (0–23) — defaulting to 6`);
      return 6;
    }
    return raw;
  })(),

  site: {
    memberUrl: 'https://fort-walton-member.book.teeitup.golf',
    apiBase: 'https://phx-api-be-east-1b.kenna.io',
    golfIdHost: 'https://my.golfid.io',
    golfIdClientId: 'VYvYEb6eIdfMvxxz',
    entityId: '615c8bd29f92380015e2d984',
    alias: 'fort-walton-member',
    courses: {
      pines: { id: '9437', name: 'Pines' },
      oaks: { id: '9438', name: 'Oaks' },
    },
  },

  schedule,
};

if (!config.email || !config.password) {
  console.error('ERROR: GOLF_EMAIL and GOLF_PASSWORD environment variables are required.');
  console.error('Copy .env.example to .env and fill in your credentials.');
  process.exit(1);
}

module.exports = config;
module.exports.resolveAlternatingCourse = resolveAlternatingCourse;
