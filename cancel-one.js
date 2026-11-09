#!/usr/bin/env node

const SiteAutomation = require('./src/site');
const config         = require('./src/config');
const logger         = require('./src/logger');

async function main() {
  const golfer = config.golfers[0];
  logger.info(`Logging in as ${golfer.email}`);

  const site = new SiteAutomation({ email: golfer.email, password: golfer.password });

  try {
    await site.init();
    await site.navigateToBooking(config.site.courses.pines.id, '2026-03-15');
    await site.login();

    const bookingsToCancel = [
      {
        confirmation_number: '230352',
        actual_time: '11:20',
        target_time: '11:20',
        course: 'Pines',
      },
    ];

    logger.info('Attempting to cancel reservation #230352 (Sunday March 15, 11:20 AM, Pines)...');
    const result = await site.cancelReservations(bookingsToCancel);

    console.log(`\nCancellation result:`);
    console.log(`  Cancelled: ${result.cancelled}`);
    console.log(`  Failed:    ${result.failed}`);
    for (const d of result.details) {
      const status = d.success ? 'CANCELLED' : `FAILED (${d.error})`;
      console.log(`  ${d.time} ${d.course} Res#${d.resNum} — ${status}`);
    }
  } finally {
    await site.close();
  }
}

main().catch(err => {
  logger.error('cancel-one.js fatal error: ' + err.message);
  console.error(err);
  process.exit(1);
});
