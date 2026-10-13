// Retain only allowlisted booleans, numeric codes and fixed categories.
// Raw bodies, headers, tokens and payment values never enter logs or state.
function checkoutTrace(page, { expectedNumber = '' } = {}) {
  const events = [];
  const purchaseEvents = [];
  const tasks = [];
  let purchaseFailure = null;
  const isPurchase = request => {
    const url = new URL(request.url());
    return url.hostname === 'tr.gnsvc.com' &&
      ['/AddReservation', '/SmartCourse/PurchaseInvoice'].includes(url.pathname) && request.method() === 'POST';
  };
  const pending = new Map();
  const label = request => {
    try {
      const url = new URL(request.url());
      if (!/(^|\.)(kenna\.io|teeitup\.com|golfnow\.com)$/.test(url.hostname) && url.hostname !== 'tr.gnsvc.com') return null;
      const step = ['/tr/token', '/AddReservation', '/SmartCourse/PurchaseInvoice', '/invoice/complete']
        .find(path => url.pathname.endsWith(path)) || 'booking-service';
      return `${request.method()} ${url.hostname} ${step}`;
    } catch { return null; }
  };
  const request = r => {
    const name = label(r); if (name) pending.set(r, name);
    if (name && isPurchase(r) && expectedNumber) {
      try {
        const data = new URLSearchParams(r.postData() || '');
        const number = data.get('Payment.CC.CreditCardNumber') || data.get('Payments_1_CreditCard_Number') || '';
        purchaseEvents.push(`Purchase payload: cardPresent=${Boolean(number)}; cardMatches=${number.replace(/\D/g, '') === expectedNumber.replace(/\D/g, '')}`);
      } catch { purchaseEvents.push('Purchase payload: validation unavailable'); }
    }
  };
  const response = r => {
    const name = label(r.request());
    if (name) events.push(`${name}: HTTP ${r.status()}`);
    if (name && isPurchase(r.request())) {
      purchaseEvents.push(`${name}: HTTP ${r.status()}`);
      if (r.status() >= 400) purchaseFailure = `Purchase service returned HTTP ${r.status()}`;
      tasks.push((async () => {
        try {
          const data = await r.json();
          if (typeof data.Success === 'boolean') purchaseEvents.push(`Purchase result: success=${data.Success}`);
          if (data.Success === false) {
            const code = Number.isInteger(data.StatusCode) && data.StatusCode >= 0 && data.StatusCode <= 9999 ? ` (code ${data.StatusCode})` : '';
            const message = typeof data.Message === 'string' ? data.Message : '';
            const category = /maximum.*book|booking.*limit/i.test(message) ? 'reservation limit'
              : /expired|no longer available|sold out|unavailable tee/i.test(message) ? 'availability changed'
              : /credit card|payment|authorize/i.test(message) ? 'payment rejected'
              : 'server rejection';
            purchaseFailure = `Purchase service rejected reservation: ${category}${code}`;
            purchaseEvents.push(purchaseFailure);
          }
        } catch { /* HTML/invalid JSON is never copied into diagnostics. */ }
      })());
    }
  };
  const finished = r => pending.delete(r);
  const failed = r => {
    const name = label(r);
    if (name) events.push(`${name}: network failure`);
    pending.delete(r);
  };
  const listeners = { request, response, requestfinished: finished, requestfailed: failed };
  for (const [event, listener] of Object.entries(listeners)) page.on(event, listener);
  return {
    settle: async () => { await Promise.allSettled(tasks); },
    failure: () => purchaseFailure,
    summary: () => [...purchaseEvents, ...events.slice(-12), ...[...pending.values()].map(name => `${name}: still pending`)].join('; ') || 'No booking-service request observed',
    stop: () => { for (const [event, listener] of Object.entries(listeners)) page.off(event, listener); },
  };
}
module.exports = { checkoutTrace };
