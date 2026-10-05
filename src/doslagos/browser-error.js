function browserStartupError(cause) {
  const details = String(cause.message || cause);
  const registrationDenied = /MachPortRendezvous|_RegisterApplication|Permission denied|SIGABRT/i.test(details);
  const error = new Error(registrationDenied
    ? 'Chromium could not start: macOS application registration or process access failed. No login or booking was attempted. Enable browser-launch access in the host application or run the checker from macOS Terminal.'
    : 'Chromium could not start. Check the configured browser executable and Playwright installation before restarting. No login or booking was attempted.');
  error.cause = cause;
  error.fatalStartup = true;
  return error;
}
module.exports = { browserStartupError };
