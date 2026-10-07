const minutes = value => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(`Invalid time: ${value}`);
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
};

function selectTeeTime(times, date, config) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const start = minutes(config.windowStart);
  const end = minutes(config.windowEnd);
  const preferred = minutes(config.preferredTime);
  const available = times.filter(slot => !slot.maxGolfers || slot.maxGolfers >= config.golfers);
  const primary = available.filter(slot => minutes(slot.time) >= start && minutes(slot.time) <= end);
  primary.sort((a, b) => (day === 0
    ? minutes(a.time) - minutes(b.time)
    : Math.abs(minutes(a.time) - preferred) - Math.abs(minutes(b.time) - preferred))
    || minutes(a.time) - minutes(b.time) || a.index - b.index);
  if (primary.length) return primary[0];
  const cutoff = day === 6 ? config.saturdayCutoff : day === 0 ? config.sundayCutoff : config.windowEnd;
  return available.filter(slot => minutes(slot.time) > end && minutes(slot.time) <= minutes(cutoff))
    .sort((a, b) => minutes(a.time) - minutes(b.time) || a.index - b.index)[0] || null;
}

function candidateDates(config, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const today = new Date(`${values.year}-${values.month}-${values.day}T12:00:00Z`);
  const dates = [];
  for (let i = 1; i <= config.horizonDays; i++) {
    const date = new Date(today); date.setUTCDate(today.getUTCDate() + i);
    if (config.targetDays.includes(date.getUTCDay())) dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}
module.exports = { selectTeeTime, candidateDates };
