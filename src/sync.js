'use strict';

const db = require('./db');
const SiteAutomation = require('./site');
const { reconcileDate } = require('./reconcile');
const logger = require('./logger');
const config = require('./config');

const PROBE_RADIUS = 10;

const PLACEHOLDER_CONFIRMATION_NUMBERS = new Set([
  'EXISTING_RESERVATION',
  'CONFIRMED',
  'access',
]);

function isPlaceholder(value) {
  if (!value) return true;
  if (PLACEHOLDER_CONFIRMATION_NUMBERS.has(value)) return true;

  return !/^\d+$/.test(value);
}

async function runSync(siteInstance = null) {
  const startTime = new Date();
  logger.info(`[SYNC] Starting sync at ${startTime.toISOString()}`);

  const ownsSession = siteInstance === null;

  let site = siteInstance;

  let totalUpdated = 0;
  let totalWarnings = 0;
  let totalErrors = 0;

  const checkedDates = new Set();

  try {
    if (!ownsSession) {
      logger.info('[SYNC] Reusing provided SiteAutomation session');
    }

    await db.getDb();
    const allUpcoming = await db.getAllUpcoming();
    logger.info(`[SYNC] Loaded ${allUpcoming.length} upcoming DB booking(s)`);

    const dbByDate = new Map();
    for (const booking of allUpcoming) {
      if (!dbByDate.has(booking.date)) dbByDate.set(booking.date, []);
      dbByDate.get(booking.date).push(booking);
    }

    let listReservations = [];

    if (ownsSession) {
      const today = new Date().toISOString().slice(0, 10);
      logger.info(`[SYNC] Step 1: Scraping reservations for ${config.golfers.length} golfer account(s)...`);

      for (let gi = 0; gi < config.golfers.length; gi++) {
        const golfer = config.golfers[gi];
        const gSite = new SiteAutomation({ email: golfer.email, password: golfer.password });
        try {
          await gSite.init();
          await gSite.navigateToBooking(config.site.courses.pines.id, today);
          await gSite.login();
          logger.info(`[SYNC] Step 1: Logged in as golfer ${gi} (${golfer.email})`);

          const golferRes = await gSite.scrapeReservationHistory();
          logger.info(`[SYNC] Step 1: Golfer ${gi} — ${golferRes.length} reservation(s) found`);

          for (const r of golferRes) {

            if (!listReservations.some(x => x.confirmationNumber === r.confirmationNumber)) {
              listReservations.push(r);
            }
          }
        } catch (err) {
          logger.error(`[SYNC] Step 1: Golfer ${gi} (${golfer.email}) failed: ${err.message}`);
          totalErrors++;
        } finally {
          try { await gSite.close(); } catch {}
        }
      }
    } else {

      try {
        listReservations = await site.scrapeReservationHistory();
      } catch (err) {
        logger.error(`[SYNC] Step 1 scrape failed: ${err.message}`);
        totalErrors++;
      }
    }

    logger.info(`[SYNC] Step 1: Found ${listReservations.length} reservation(s) total across all accounts`);

    const siteByDate = new Map();
    for (const r of listReservations) {
      if (!r.date) continue;
      if (!siteByDate.has(r.date)) siteByDate.set(r.date, []);
      siteByDate.get(r.date).push(r);
    }

    const step1VisibleDates = new Set(siteByDate.keys());

    const placeholderRows = allUpcoming.filter(
      b =>
        ['confirmed', 'pending', 'cancelled'].includes(b.status) &&
        isPlaceholder(b.confirmation_number)
    );
    const datesToProbe = new Set(
      placeholderRows
        .map(b => b.date)
        .filter(d => !siteByDate.has(d))
    );

    if (datesToProbe.size > 0) {
      logger.info(
        `[SYNC] Step 2: ${datesToProbe.size} date(s) still need probing: ${[...datesToProbe].sort().join(', ')}`
      );

      const knownIds = allUpcoming
        .filter(b => b.confirmation_number && /^\d+$/.test(b.confirmation_number))
        .map(b => parseInt(b.confirmation_number, 10));

      if (knownIds.length === 0) {
        logger.info('[SYNC] Step 2: No known numeric confirmation IDs to probe around — skipping');
      } else {

        const probeByDate = new Map();
        let totalProbeHits = 0;

        if (ownsSession) {

          const today = new Date().toISOString().slice(0, 10);

          for (let gi = 0; gi < config.golfers.length; gi++) {
            const golfer = config.golfers[gi];

            const golferDatesToProbe = [...datesToProbe].filter(d => {
              const rows = dbByDate.get(d) || [];
              return rows.some(b => (b.golfer_index || 0) === gi);
            });
            if (golferDatesToProbe.length === 0) continue;

            const golferKnownIds = allUpcoming
              .filter(b => (b.golfer_index || 0) === gi && b.confirmation_number && /^\d+$/.test(b.confirmation_number))
              .map(b => parseInt(b.confirmation_number, 10));

            if (golferKnownIds.length === 0) {
              logger.info(`[SYNC] Step 2: Golfer ${gi} — no known IDs to probe around`);
              continue;
            }

            const probeIdSet = new Set();
            for (const id of golferKnownIds) {
              for (let delta = -PROBE_RADIUS; delta <= PROBE_RADIUS; delta++) {
                const candidate = id + delta;
                if (candidate > 0) probeIdSet.add(candidate);
              }
            }
            const sortedProbeIds = [...probeIdSet].sort((a, b) => a - b);

            logger.info(
              `[SYNC] Step 2: Golfer ${gi} (${golfer.email}) — probing ${sortedProbeIds.length} ID(s) for dates: ${golferDatesToProbe.sort().join(', ')}`
            );

            const gSite = new SiteAutomation({ email: golfer.email, password: golfer.password });
            try {
              await gSite.init();
              await gSite.navigateToBooking(config.site.courses.pines.id, today);
              await gSite.login();

              let golferHits = 0;
              for (const id of sortedProbeIds) {
                let res = null;
                try {
                  res = await gSite.fetchReservationById(id);
                } catch (err) {
                  logger.warn(`[SYNC] Step 2: Golfer ${gi} fetchReservationById(${id}) threw: ${err.message}`);
                  totalErrors++;
                  continue;
                }

                if (!res || !res.date || !res.time) continue;
                if (!datesToProbe.has(res.date)) continue;

                if (!probeByDate.has(res.date)) probeByDate.set(res.date, []);
                const existing = probeByDate.get(res.date);
                if (!existing.some(r => r.confirmationNumber === res.confirmationNumber)) {
                  logger.info(
                    `[SYNC] Step 2: Golfer ${gi} found ID ${id}: ${res.date} ${res.time} ${res.course} Res#${res.confirmationNumber}`
                  );
                  existing.push(res);
                  golferHits++;
                  totalProbeHits++;
                }
              }
              logger.info(`[SYNC] Step 2: Golfer ${gi} probe complete — ${golferHits} new reservation(s)`);
            } catch (err) {
              logger.error(`[SYNC] Step 2: Golfer ${gi} session failed: ${err.message}`);
              totalErrors++;
            } finally {
              try { await gSite.close(); } catch {}
            }
          }
        } else {

          const probeIdSet = new Set();
          for (const id of knownIds) {
            for (let delta = -PROBE_RADIUS; delta <= PROBE_RADIUS; delta++) {
              const candidate = id + delta;
              if (candidate > 0) probeIdSet.add(candidate);
            }
          }
          const sortedProbeIds = [...probeIdSet].sort((a, b) => a - b);

          logger.info(
            `[SYNC] Step 2: Probing ${sortedProbeIds.length} ID(s) around ${knownIds.length} known confirmation number(s)...`
          );

          for (const id of sortedProbeIds) {
            let res = null;
            try {
              res = await site.fetchReservationById(id);
            } catch (err) {
              logger.warn(`[SYNC] Step 2: fetchReservationById(${id}) threw: ${err.message}`);
              totalErrors++;
              continue;
            }

            if (!res || !res.date || !res.time) continue;
            if (!datesToProbe.has(res.date)) continue;

            if (!probeByDate.has(res.date)) probeByDate.set(res.date, []);
            const existing = probeByDate.get(res.date);
            if (!existing.some(r => r.confirmationNumber === res.confirmationNumber)) {
              logger.info(
                `[SYNC] Step 2: Found ID ${id}: ${res.date} ${res.time} ${res.course} Res#${res.confirmationNumber}`
              );
              existing.push(res);
              totalProbeHits++;
            }
          }
        }

        logger.info(`[SYNC] Step 2: Probe complete — ${totalProbeHits} new reservation(s) found`);

        for (const [date, slots] of probeByDate.entries()) {
          if (!siteByDate.has(date)) {
            siteByDate.set(date, slots);
          } else {
            const current = siteByDate.get(date);
            for (const s of slots) {
              if (!current.some(r => r.confirmationNumber === s.confirmationNumber)) {
                current.push(s);
              }
            }
          }
        }

        const stillMissing = [...datesToProbe].filter(d => !probeByDate.has(d));
        if (stillMissing.length > 0) {
          logger.info(
            `[SYNC] Step 2: Could not find site data for: ${stillMissing.sort().join(', ')} ` +
            `(may be beyond the site display window or use unknown reservation IDs)`
          );
        }
      }
    } else {
      logger.info('[SYNC] Step 2: No dates need direct probing');
    }

    logger.info(`[SYNC] Reconciling ${siteByDate.size} date(s)...`);

    for (const [date, siteSlots] of siteByDate.entries()) {
      checkedDates.add(date);
      const dbSlots = dbByDate.get(date) || [];

      let result;
      try {
        result = await reconcileDate(date, siteSlots, dbSlots, logger);
      } catch (err) {
        logger.error(`[SYNC] reconcileDate(${date}) threw: ${err.message}`);
        totalErrors++;
        continue;
      }

      totalUpdated += result.updated;
      totalWarnings += result.warnings.length;

      if (result.notFound > 0) {
        logger.warn(
          `[SYNC] date=${date}: ${result.notFound} DB slot(s) had no matching site reservation at their position`
        );
      }
    }

    const fr012Candidates = allUpcoming.filter(
      b =>
        b.status === 'confirmed' &&
        b.confirmation_number &&
        /^\d+$/.test(b.confirmation_number) &&
        step1VisibleDates.has(b.date) &&
        !siteByDate.has(b.date)
    );

    for (const booking of fr012Candidates) {
      const msg =
        `[SYNC] WARN: booking #${booking.id} date ${booking.date} slot ${booking.slot_index}: ` +
        `DB shows confirmed Res#${booking.confirmation_number} but not found on site — manual review required`;
      logger.warn(msg);
      totalWarnings++;
    }

  } finally {

    if (!ownsSession && site) {

    }
  }

  try {
    db.setLastSyncAt(new Date().toISOString());
  } catch (err) {
    logger.error(`[SYNC] Failed to write sync-meta.json: ${err.message}`);
    totalErrors++;
  }

  const endTime = new Date();
  const elapsedMs = endTime - startTime;
  const summary = {
    checked: checkedDates.size,
    updated: totalUpdated,
    warnings: totalWarnings,
    errors: totalErrors,
  };

  logger.info(
    `[SYNC] Completed in ${elapsedMs}ms — ` +
    `checked=${summary.checked} updated=${summary.updated} warnings=${summary.warnings} errors=${summary.errors}`
  );

  return summary;
}

module.exports = { runSync };
