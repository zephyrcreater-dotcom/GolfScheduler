// Never retain request bodies, headers, query strings, or response bodies.
function checkoutTrace(page) {
  const events = [];
  const pending = new Map();
  const label = request => {
    try {
      const url = new URL(request.url());
      if (!/(^|\.)(kenna\.io|teeitup\.com|golfnow\.com)$/.test(url.hostname)) return null;
      const step = ['/tr/token', '/AddReservation', '/SmartCourse/PurchaseInvoice', '/invoice/complete']
        .find(path => url.pathname.endsWith(path)) || 'booking-service';
      return `${request.method()} ${url.hostname} ${step}`;
    } catch { return null; }
  };
  const request = r => { const name = label(r); if (name) pending.set(r, name); };
  const response = r => {
    const name = label(r.request());
    if (name) events.push(`${name}: HTTP ${r.status()}`);
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
    summary: () => [...events.slice(-12), ...[...pending.values()].map(name => `${name}: still pending`)].join('; ') || 'No booking-service request observed',
    stop: () => { for (const [event, listener] of Object.entries(listeners)) page.off(event, listener); },
  };
}
module.exports = { checkoutTrace };
