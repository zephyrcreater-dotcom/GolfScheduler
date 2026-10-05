// Store only booking details; never persist the confirmation page's billing text.
function verifyConfirmation(text, reference, expected, golfers) {
  if (!expected?.date || !expected?.time) throw new Error('Missing expected booking details; review reservation history');
  if (!/^#[A-Za-z0-9-]+$/.test(reference.trim())) throw new Error('Missing reservation number; review reservation history');
  if (!/Order Details/.test(text) || !/Dos Lagos Golf Course/.test(text)) throw new Error('Missing confirmed order details; review reservation history');
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  // The current booking UI formats dates as "MMMM D. YYYY h:mm A".
  const dates = [...text.matchAll(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})[.,]?\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/gi)];
  const players = [...text.matchAll(/\b(\d+)\s+Players?\b/gi)];
  if (dates.length !== 1 || players.length !== 1) throw new Error('Ambiguous confirmed order; review reservation history');
  const [,month,day,year,hour,minute,period] = dates[0];
  const date = `${year}-${String(months.findIndex(m => m.toLowerCase() === month.toLowerCase()) + 1).padStart(2,'0')}-${day.padStart(2,'0')}`;
  const time = `${String(Number(hour)%12 + (period.toUpperCase()==='PM'?12:0)).padStart(2,'0')}:${minute}`;
  if (date !== expected.date || time !== expected.time || Number(players[0][1]) !== golfers) throw new Error('Confirmed booking differs from selected date, time, or golfers; review reservation history');
  return { reference: reference.trim(), date, time, golfers };
}
module.exports = { verifyConfirmation };
