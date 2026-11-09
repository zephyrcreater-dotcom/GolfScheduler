#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const db = require('./src/db');
const config = require('./src/config');

const FROM_DATE = '2026-03-16';

async function main() {
  const sqlDb = await db.getDb();

  sqlDb.run(`
    UPDATE bookings
    SET status        = 'pending',
        attempts      = 0,
        error_message = NULL,
        golfer_index  = 0,
        updated_at    = datetime('now')
    WHERE status = 'cancelled'
      AND date >= ?
  `, [FROM_DATE]);
  const cancelledReset = sqlDb.getRowsModified();
  console.log(`Cancelled → pending: ${cancelledReset} row(s)`);

  sqlDb.run(`
    UPDATE bookings
    SET status        = 'pending',
        attempts      = 0,
        error_message = NULL,
        golfer_index  = 0,
        updated_at    = datetime('now')
    WHERE status = 'failed'
      AND date >= ?
  `, [FROM_DATE]);
  const failedReset = sqlDb.getRowsModified();
  console.log(`Failed → pending: ${failedReset} row(s)`);

  sqlDb.run(`
    UPDATE bookings
    SET golfer_index = 0,
        updated_at   = datetime('now')
    WHERE status = 'pending'
      AND date >= ?
  `, [FROM_DATE]);
  const pendingReassigned = sqlDb.getRowsModified();
  console.log(`Pending rows reassigned to golfer_index=0: ${pendingReassigned} row(s)`);

  const data = sqlDb.export();
  fs.writeFileSync(config.dbPath, Buffer.from(data));
  console.log(`\nDB saved to ${config.dbPath}`);
  console.log(`Total rows modified: ${cancelledReset + failedReset + pendingReassigned}`);
}

main().catch(err => {
  console.error('reset-to-golfer1.js error:', err);
  process.exit(1);
});
