const fs = require('node:fs');
const path = require('node:path');
// All reservation-bearing states block future attempts, including uncertain ones.
const LOCKED = new Set(['held', 'attempting', 'purchase-attempted', 'needs-review', 'confirmed']);
function load(file) {
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid booking state');
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error; // Never discard corrupt state and risk rebooking a date.
  }
}
function save(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}
function acquire(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.writeFileSync(file, String(process.pid), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(fs.readFileSync(file, 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid checker lock; inspect it before restarting');
    try { process.kill(pid, 0); }
    catch (probe) {
      if (probe.code === 'ESRCH') {
        fs.unlinkSync(file);
        fs.writeFileSync(file, String(process.pid), { flag: 'wx', mode: 0o600 });
        return () => fs.unlinkSync(file);
      }
      throw new Error('Cannot verify checker lock; another checker may be running');
    }
    throw new Error('Another Dos Lagos checker is already running');
  }
  return () => fs.unlinkSync(file);
}
module.exports = { LOCKED, load, save, acquire };
