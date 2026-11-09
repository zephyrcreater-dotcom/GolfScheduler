'use strict';

const db = require('./db');

const PLACEHOLDER_CONFIRMATION_NUMBERS = new Set([
  'EXISTING_RESERVATION',
  'CONFIRMED',
  'access',
]);

function isPlaceholder(value) {
  if (!value) return true;
  if (PLACEHOLDER_CONFIRMATION_NUMBERS.has(value)) return true;
  return false;
}

function isRealConfirmationNumber(value) {
  return !!value && /^\d+$/.test(value);
}

function toMinutes(t) {
  if (!t) return -1;
  const parts = t.split(':');
  if (parts.length < 2) return -1;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return -1;
  return h * 60 + m;
}

const PAIRABLE_STATUSES = new Set(['confirmed', 'pending', 'cancelled']);

async function reconcileDate(date, siteSlots, dbSlots, logger) {
  const updated = { count: 0 };
  let notFound = 0;
  const warnings = [];

  const relevant = dbSlots
    .filter(b => PAIRABLE_STATUSES.has(b.status))
    .sort((a, b) => a.slot_index - b.slot_index);

  const sortedSite = [...siteSlots].sort((a, b) => toMinutes(a.time) - toMinutes(b.time));

  logger.info(
    `[SYNC] reconcileDate ${date}: ${relevant.length} DB slot(s) | ${sortedSite.length} site reservation(s)`
  );

  for (let i = 0; i < relevant.length; i++) {
    const slot = relevant[i];

    if (i >= sortedSite.length) {
      const displayTime = slot.actual_time || slot.target_time;
      const warning =
        `[SYNC] date=${date} slot_index=${slot.slot_index} (${displayTime}): ` +
        `no site reservation at position ${i} — DB record unchanged`;
      logger.warn(warning);
      warnings.push(warning);
      notFound++;
      continue;
    }

    const site = sortedSite[i];

    const sitePlayers = typeof site.players === 'number' ? site.players : null;
    if (sitePlayers !== null && sitePlayers < 4) {
      const warning =
        `[SYNC] WARN: date=${date} slot_index=${slot.slot_index} (${slot.actual_time || slot.target_time}): ` +
        `site reservation Res#${site.confirmationNumber} shows only ${sitePlayers} player(s) — ` +
        `expected 4. Run cancel-1player.js to fix.`;
      logger.warn(warning);
      warnings.push(warning);
    }

    const timeDiffers = slot.actual_time !== site.time;

    const dbConfirmation = slot.confirmation_number;
    const siteConfirmation = site.confirmationNumber;
    const confirmationDiffers =
      isRealConfirmationNumber(siteConfirmation) &&
      (isPlaceholder(dbConfirmation) || dbConfirmation !== siteConfirmation);

    if (!timeDiffers && !confirmationDiffers) {

      logger.info(
        `[SYNC] date=${date} slot_index=${slot.slot_index}: OK ` +
        `actual_time=${slot.actual_time} confirmation_number=${slot.confirmation_number}`
      );
      continue;
    }

    logger.info(
      `[SYNC] Updated booking #${slot.id} date ${date} slot ${slot.slot_index}: ` +
      `actual_time ${slot.actual_time ?? 'null'} \u2192 ${site.time}, ` +
      `confirmation_number ${dbConfirmation ?? 'null'} \u2192 ${siteConfirmation}`
    );

    await db.updateBookingSync(slot.id, {
      actualTime: site.time,
      course: site.course,
      confirmationNumber: siteConfirmation,
      restoreConfirmed: true,
    });

    updated.count++;
  }

  return { updated: updated.count, notFound, warnings };
}

module.exports = { reconcileDate };
