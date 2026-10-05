const { randomUUID } = require('node:crypto');
class RedisState {
  constructor({ url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN,
    prefix = process.env.DOSLAGOS_STATE_PREFIX || 'doslagos:test', request = fetch } = {}) {
    if (!url || !token) throw new Error('Configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN');
    if (new URL(url).protocol !== 'https:') throw new Error('Redis REST endpoint must use HTTPS');
    this.url = url; this.token = token; this.request = request;
    this.stateKey = `${prefix}:state`; this.lockKey = `${prefix}:lock`;
    this.owner = randomUUID(); this.lostLease = false;
  }
  async command(...args) {
    const response = await this.request(this.url, {
      method:'POST',headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},
      body:JSON.stringify(args),signal:AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`State database request failed (${response.status}); booking stopped`);
    const body = await response.json();
    if (body.error) throw new Error('State database rejected a command; booking stopped');
    return body.result;
  }
  async load() {
    const raw = await this.command('GET',this.stateKey);
    if (raw === null) throw new Error('Cloud booking state is not initialized. Seed it from the local state before enabling cloud runs.');
    const state = JSON.parse(raw);
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid cloud booking state; refusing to reset it');
    return state;
  }
  async initialize(state) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid seed state');
    const result = await this.command('SET',this.stateKey,JSON.stringify(state),'NX');
    if (result !== 'OK') throw new Error('Cloud state already exists; never overwrite booking locks');
  }
  async save(file, state) {
    if (this.lostLease) throw new Error('Cloud checker lost its lease; booking stopped');
    const script = "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end redis.call('SET', KEYS[2], ARGV[2]) return 1";
    const result = await this.command('EVAL',script,'2',this.lockKey,this.stateKey,this.owner,JSON.stringify(state));
    if (result !== 1) { this.lostLease=true; throw new Error('Cloud checker lease expired; booking stopped'); }
  }
  async acquire() {
    if (await this.command('SET',this.lockKey,this.owner,'NX','EX','600') !== 'OK') {
      throw new Error('Another cloud checker holds the booking lock; skipping this run');
    }
    const renew = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('EXPIRE', KEYS[1], 600) end return 0";
    const timer = setInterval(async()=>{
      try { if (await this.command('EVAL',renew,'1',this.lockKey,this.owner) !== 1) this.lostLease=true; }
      catch { this.lostLease=true; }
    },60000);
    timer.unref();
    return async()=>{
      clearInterval(timer);
      const release="if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";
      await this.command('EVAL',release,'1',this.lockKey,this.owner);
    };
  }
}
module.exports = RedisState;
