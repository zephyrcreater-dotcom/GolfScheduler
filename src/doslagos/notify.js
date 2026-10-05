const config = require('./config');

/**
 * Push a notification via ntfy (https://ntfy.sh/docs/). No account needed —
 * the topic name itself is the shared secret, so anyone who knows (or
 * subscribes to) the topic can read these. Keep the topic unguessable.
 */
async function push({ title, message, priority = 'default', clickUrl, tags }) {
  if (!config.ntfy.topic) {
    console.error('ntfy disabled: NTFY_TOPIC is missing.');
    return false;
  }
  // Errors can include browser input values. Never publish payment/login data.
  const redact = value => {
    let text = String(value).replace(/\b(?:\d[ -]?){12,19}\b/g, '[redacted card number]');
    for (const secret of [config.password, config.card.number, config.card.cvv]) {
      if (secret) text = text.split(String(secret)).join('[redacted]');
    }
    return text;
  };
  // Use ntfy's JSON publish format rather than headers — HTTP headers must be
  // Latin-1, which breaks on emoji in the title. JSON body handles UTF-8 fine.
  const body = {
    topic: config.ntfy.topic,
    title: redact(title),
    message: redact(message),
    priority: { urgent: 5, high: 4, default: 3, low: 2, min: 1 }[priority] || 3,
  };
  // Browser launch failures can contain several pages of logs. Keep the
  // entire JSON request below ntfy's size limit, even with Unicode/escaping.
  body.title = Array.from(body.title).slice(0, 120).join('');
  while (Buffer.byteLength(JSON.stringify(body), 'utf8') > 3200) {
    body.message = Array.from(body.message).slice(0, -200).join('');
  }
  if (clickUrl) body.click = clickUrl;
  if (tags) body.tags = tags.split(',').map(t => t.trim());

  try {
    const res = await fetch(config.ntfy.server, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error(`ntfy push failed: ${res.status} ${res.statusText}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('ntfy delivery failed or timed out; booking state remains saved.');
    return false;
  }
}

function holdReadyToPay({ date, dayLabel, time, price, checkoutUrl }) {
  return push({
    title: '⛳ Dos Lagos tee time held — pay to confirm',
    message: `${dayLabel} ${date} at ${time}, $${price}. Reserved in cart — finish payment now before the hold expires.`,
    priority: 'urgent',
    tags: 'golf,moneybag',
    clickUrl: checkoutUrl,
  });
}

function onlyLaterAvailable({ date, dayLabel, earliestTime, siteUrl }) {
  return push({
    title: '⛳ Dos Lagos — nothing before 7am',
    message: `${dayLabel} ${date}: earliest open slot is ${earliestTime}. Nothing in your 6-7am window. Book manually if that's good enough.`,
    priority: 'default',
    tags: 'golf,clock9',
    clickUrl: siteUrl,
  });
}

function nothingAvailable({ date, dayLabel }) {
  return push({
    title: '⛳ Dos Lagos — no times yet',
    message: `${dayLabel} ${date}: no tee times open at all yet.`,
    priority: 'low',
    tags: 'golf',
  });
}

function blocked({ reason, screenshotPath }) {
  return push({
    title: '🚫 Dos Lagos bot blocked',
    message: `${reason}${screenshotPath ? ` (screenshot: ${screenshotPath})` : ''}. Manual check needed.`,
    priority: 'high',
    tags: 'golf,warning',
  });
}

function error({ reason }) {
  return push({
    title: '⚠️ Dos Lagos bot error',
    message: reason,
    priority: 'default',
    tags: 'golf,warning',
  });
}

async function searchResults({ date, times, target, golfers }) {
  const heading = `${date}: ${times.length} offer(s) before 9 a.m., ${golfers} golfer(s) requested.\n`;
  const lines = times.map(time => `${time.label || time.time}${time.price ? ` — $${time.price}` : ''}${time.maxGolfers ? ` — up to ${time.maxGolfers} golfers` : ''}`);
  const ending = target ? `Selected ${target.time}.` : 'These times are before 9 a.m., but none matches your automatic booking rules.';
  const chunks = []; let chunk = heading;
  for (const line of lines) {
    if (Buffer.byteLength(chunk + line + '\n', 'utf8') > 2400) { chunks.push(chunk); chunk = heading; }
    chunk += line + '\n';
  }
  chunks.push(chunk + ending);
  for (let i = 0; i < chunks.length; i++) await push({title:`Dos Lagos search — ${date}${chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ''}`,message:chunks[i],priority:'low',tags:'golf,mag'});
}
function found({ date, time, golfers, price }) {
  return push({title:'Dos Lagos — matching tee time found',message:`${date} at ${time}, ${golfers} golfer(s)${price ? `, $${price}` : ''}. Starting one booking attempt for this date.`,priority:'high',tags:'golf'});
}
function outcome({ date, time, status, reason }) {
  const titles = {confirmed:'Dos Lagos — booking confirmed',held:'Dos Lagos — checkout reached', 'needs-review':'Dos Lagos — booking needs review'};
  return push({title:titles[status] || 'Dos Lagos booking update',message:`${date} at ${time}: ${status}.${reason ? ` ${reason}` : ''} This date is locked against further booking attempts.`,priority:status === 'held' ? 'default' : 'high',tags:'golf'});
}
function lifecycle(message) {
  return push({title:'Dos Lagos checker',message,priority:'low',tags:'golf'});
}
module.exports = { push, holdReadyToPay, onlyLaterAvailable, nothingAvailable, blocked, error,
  searchResults, found, outcome, lifecycle };
