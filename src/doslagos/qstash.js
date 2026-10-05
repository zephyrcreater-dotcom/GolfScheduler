// Local timer administration only. Credentials stay in ignored data/timer.env.
const path = require('node:path');
const ID = 'scheduled-browser-checks';
const DESTINATION = 'https://api.github.com/repos/zephyrcreater-dotcom/GolfScheduler/actions/workflows/doslagos.yml/dispatches';
function settings(env) {
  const url = (env.QSTASH_URL || '').replace(/\/$/, '');
  if (!/^https:\/\/qstash(?:-[a-z0-9-]+)?\.upstash\.io$/.test(url)) throw new Error('Set QSTASH_URL to the REST URL shown in the Upstash QStash console');
  if (!env.QSTASH_TOKEN) throw new Error('Set QSTASH_TOKEN in ignored data/timer.env');
  return {url, token:env.QSTASH_TOKEN, githubToken:env.GITHUB_WORKFLOW_TOKEN};
}
async function response(request, url, options, label) {
  let result;
  try { result = await request(url, {...options,signal:AbortSignal.timeout(15000)}); }
  catch { throw new Error(`${label} request timed out or failed; no credentials were logged`); }
  if (!result.ok) throw new Error(`${label} request failed (HTTP ${result.status}); check token permissions and plan in the service console`);
  return result;
}
async function json(result, label) {
  try { return await result.json(); }
  catch { throw new Error(`${label} returned invalid JSON; response contents were not logged`); }
}
async function manage(action, env=process.env, request=fetch) {
  if (!['activate','verify','pause'].includes(action)) throw new Error('Use --activate, --verify, or --pause');
  const config = settings(env);
  const auth = {Authorization:`Bearer ${config.token}`};
  if (action === 'activate') {
    if (!config.githubToken?.startsWith('github_pat_')) throw new Error('Use a dedicated fine-grained GITHUB_WORKFLOW_TOKEN restricted to GolfScheduler, with Actions read/write');
    const github = await response(request, DESTINATION.replace(/\/dispatches$/, ''), {
      headers:{Authorization:`Bearer ${config.githubToken}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'},
    }, 'GitHub workflow validation');
    if ((await json(github, 'GitHub')).state !== 'active') throw new Error('GitHub workflow is not active; timer was not created');
    const created = await response(request, `${config.url}/v2/schedules/${DESTINATION}`, {
      method:'POST',headers:{...auth,'Content-Type':'application/json',
        'Upstash-Schedule-Id':ID,'Upstash-Cron':'*/5 * * * *','Upstash-Method':'POST',
        'Upstash-Retries':'1','Upstash-Timeout':'15s',
        'Upstash-Forward-Authorization':`Bearer ${config.githubToken}`,
        'Upstash-Forward-Accept':'application/vnd.github+json',
        'Upstash-Forward-User-Agent':'scheduled-workflow-timer',
        'Upstash-Forward-X-GitHub-Api-Version':'2026-03-10',
        'Upstash-Redact-Fields':'headers',
      },body:JSON.stringify({ref:'master',inputs:{timer_source:'qstash'}}),
    }, 'QStash schedule update');
    if ((await json(created, 'QStash')).scheduleId !== ID) throw new Error('Unexpected timer ID; check QStash console before retrying');
    return {scheduleId:ID,intervalMinutes:5,activated:true};
  }
  if (action === 'pause') {
    await response(request, `${config.url}/v2/schedules/${ID}/pause`, {method:'POST',headers:auth}, 'QStash schedule pause');
    return {scheduleId:ID,paused:true};
  }
  const result = await response(request, `${config.url}/v2/schedules/${ID}`, {headers:auth}, 'QStash schedule verification');
  const schedule = await json(result, 'QStash');
  if (schedule.destination !== DESTINATION || schedule.cron !== '*/5 * * * *' || typeof schedule.isPaused !== 'boolean') throw new Error('Timer destination, frequency, or status differs; inspect QStash console');
  // Never print QStash responses: they can contain forwarded credentials.
  return {scheduleId:ID,intervalMinutes:5,paused:schedule.isPaused,
    lastTriggerAt:Number.isFinite(schedule.lastScheduleTime) ? new Date(schedule.lastScheduleTime).toISOString() : null,
    nextTriggerAt:Number.isFinite(schedule.nextScheduleTime) ? new Date(schedule.nextScheduleTime).toISOString() : null};
}
if (require.main === module) {
  require('dotenv').config({path:path.join(__dirname,'../../data/timer.env'),quiet:true});
  manage(process.argv[2]?.replace(/^--/, '')).then(result=>console.log(JSON.stringify(result)))
    .catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports = {manage};
