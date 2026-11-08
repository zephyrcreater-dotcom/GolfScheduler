const test = require('node:test'), assert = require('node:assert/strict');
const { dateParts, searchByCalendar } = require('../src/doslagos/calendar');
const { diagnosticSettings } = require('../src/doslagos/purchase-diagnostic');
test('calendar date validation preserves the requested date across month/year boundaries', () => {
  assert.equal(dateParts('2026-11-13').label, 'Nov 13, 2026');
  assert.equal(dateParts('2027-01-01').label, 'Jan 01, 2027');
  for (const date of ['2026-02-29','2026-13-01','2026-11-31','11/13/2026']) assert.throws(() => dateParts(date));
});
function fixture({ failCalendar = false, wrongFallback = false } = {}) {
  let month = 10, year = 2026, displayed = 'Nov 07, 2026', fallback = 0, nextClicks = 0;
  const calendar = {
    isVisible: async () => !failCalendar, waitFor: async () => {},
    locator: selector => selector.includes('aria-live')
      ? { allTextContents: async () => [`${new Date(Date.UTC(year,month,1)).toLocaleString('en-US',{month:'long',timeZone:'UTC'})} ${year}`] }
      : { filter: ({hasText}) => ({ first: () => ({ click: async () => {
        const day = hasText.source.replace(/[^0-9]/g,'');
        displayed = dateParts(`${year}-${String(month+1).padStart(2,'0')}-${day.padStart(2,'0')}`).label;
      } }) }) },
    getByRole: (_, {name}) => ({ click: async () => {
      nextClicks++; month += name === 'Next month' ? 1 : -1;
      if (month === 12) { month=0;year++; } if (month === -1) { month=11;year--; }
    } }),
  };
  const page = {
    url: () => 'https://example.invalid/teetimes',
    locator: selector => selector.includes('MuiDateCalendar') ? { first: () => calendar }
      : { first: () => ({ click: async () => { throw Error('Missing calendar'); } }) },
    waitForTimeout: async () => {},
    waitForFunction: async (_, expected) => { if (expected && displayed !== expected) throw Error('Displayed date mismatch'); },
    goto: async url => { fallback++; if (!wrongFallback) displayed = dateParts(new URL(url).searchParams.get('date')).label; },
  };
  return { page, fallback: () => fallback, nextClicks: () => nextClicks, displayed: () => displayed };
}
const options = { baseUrl:'https://example.invalid', courseId:'3510', checkForBlocks:async()=>{} };
test('calendar selects the correct day across a year boundary without a URL navigation', async () => {
  const f=fixture(); await searchByCalendar(f.page,'2027-01-01',options);
  assert.equal(f.displayed(),'Jan 01, 2027'); assert.equal(f.nextClicks(),2); assert.equal(f.fallback(),0);
});
test('URL fallback is allowed only when its displayed date matches', async () => {
  const f=fixture({failCalendar:true}); await searchByCalendar(f.page,'2026-11-13',options);
  assert.equal(f.fallback(),1);
  const wrong=fixture({failCalendar:true,wrongFallback:true});
  await assert.rejects(searchByCalendar(wrong.page,'2026-11-13',options),/Displayed date mismatch/);
});
test('security challenges stop navigation instead of triggering fallback', async () => {
  const f=fixture(); await assert.rejects(searchByCalendar(f.page,'2026-11-13',{
    ...options,checkForBlocks:async()=>{throw Error('Security challenge');}
  }),/Security challenge/); assert.equal(f.fallback(),0);
});
test('calendar-only diagnostics never use a date URL when the calendar is unavailable', async () => {
  const f=fixture({failCalendar:true});
  await assert.rejects(searchByCalendar(f.page,'2026-11-13',{...options,allowUrlFallback:false}),/Missing calendar/);
  assert.equal(f.fallback(),0);
});
test('exact diagnostic time is isolated from recurring preferences and permits no fallback times', () => {
  const base=Object.freeze({preferredTime:'06:35',windowStart:'06:00',windowEnd:'07:00',saturdayCutoff:'09:00',sundayCutoff:'07:30',golfers:1});
  const override=diagnosticSettings(base,'13:23');
  const {selectTeeTime}=require('../src/doslagos/selection');
  assert.equal(base.preferredTime,'06:35'); assert.equal(override.windowStart,'13:23');
  assert.equal(selectTeeTime([{time:'13:24',index:0}],'2026-11-13',override),null);
  assert.equal(selectTeeTime([{time:'13:23',index:0}],'2026-11-13',override).time,'13:23');
  assert.throws(()=>diagnosticSettings(base,'25:00'));
});
