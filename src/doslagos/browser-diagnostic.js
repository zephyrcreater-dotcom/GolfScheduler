// Read-only diagnostic: never creates a cart or submits a purchase.
const Site = require('./site');
const config = require('./config');

async function diagnostic(site) {
  let apiRequest;
  site.page.on('request', request => {
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.hostname === 'phx-api-be-east-1b.kenna.io' &&
        !url.pathname.includes('/profile')) apiRequest = request;
  });
  await site.login();
  const reservations = await site.reservationHistory();
  console.log(JSON.stringify({ headed: process.env.HEADLESS === 'false', reservations }));
  if (!apiRequest) throw new Error('No authenticated booking-service request observed');
  const apiBase = await site.page.evaluate(() => {
    const element = [...document.querySelectorAll('*')]
      .find(node => Object.keys(node).some(key => key.startsWith('__reactFiber')));
    let root = element?.[Object.keys(element).find(key => key.startsWith('__reactFiber'))];
    while (root?.return) root = root.return;
    const seen = new Set();
    function visit(node) {
      if (!node || seen.has(node)) return;
      seen.add(node);
      const store = node.memoizedProps?.store || node.memoizedProps?.value?.store;
      const base = store?.getState?.().app?.beApiURI;
      return base || visit(node.child) || visit(node.sibling);
    }
    return visit(root) || visit(root?.alternate);
  });
  if (!apiBase || new URL(apiBase).origin !== new URL(apiRequest.url()).origin) {
    throw new Error('Cannot verify booking API origin; stopped');
  }
  // Let Chromium supply its own transport, cookies and browser-controlled headers.
  // Forward only application headers already sent to this same API origin.
  const headers = Object.fromEntries(Object.entries(await apiRequest.allHeaders())
    .filter(([name]) => !name.startsWith(':') && !name.startsWith('sec-') &&
      !['cookie', 'host', 'origin', 'referer', 'user-agent', 'accept-encoding',
        'content-length', 'connection', 'priority'].includes(name)));
  const result = await site.page.evaluate(async ({ url, headers }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
      // Do not read or log the token response body.
      return { tokenRequestSucceeded: response.ok, status: response.status };
    } catch {
      return { tokenRequestSucceeded: false, error: 'Browser request failed or was denied by CORS' };
    } finally { clearTimeout(timer); }
  }, { url: apiBase.replace(/\/$/, '') + '/tr/token', headers });
  console.log(JSON.stringify(result));
  if (!result.tokenRequestSucceeded) throw new Error('Booking-token diagnostic failed; purchases remain disabled');
}

if (require.main === module) {
  (async () => {
    const site = new Site();
    try { await site.init(); await diagnostic(site); }
    finally { await site.close(); }
  })().catch(error => {
    let message = String(error.message);
    for (const secret of [config.email, config.password]) {
      if (secret) message = message.split(secret).join('[redacted]');
    }
    console.error(message);
    process.exitCode = 1;
  });
}
module.exports = { diagnostic };
