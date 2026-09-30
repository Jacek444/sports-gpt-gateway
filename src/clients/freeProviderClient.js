import { HttpError } from '../errors.js';

// Cached promises also coalesce simultaneous requests. Never cache keys in URLs
// or expose upstream bodies/URLs: OddsPapi places the secret in its query string.
export class FreeProviderClient {
  constructor({ name, apiKey, baseUrl, queryAuth = false, fetcher = (...args) => fetch(...args), intervalMs = 0 }) {
    Object.assign(this, { name, apiKey, baseUrl, queryAuth, fetcher, intervalMs });
    this.cache = new Map(); this.failures = new Map(); this.pending = new Map(); this.nextCall = 0; this.blockedUntil = 0;
    this.quota = null; this.lastError = null; this.lastSuccessAt = null; this.requests = 0;
  }
  async get(path, params = {}, ttl = 60000) {
    if (!this.apiKey || this.apiKey === 'replace_me') throw new HttpError(503, `${this.name} key is not configured.`);
    const cacheKey = JSON.stringify([path, params]);
    const cached = this.cache.get(cacheKey);
    if (cached?.expires > Date.now()) { this.lastReadAt = cached.observedAt; return cached.body; }
    const failure = this.failures.get(cacheKey);
    if (failure?.expires > Date.now()) throw failure.error;
    if (this.pending.has(cacheKey)) return this.pending.get(cacheKey);
    const task = this.request(path, params).then(body => {
      if (ttl > 0) this.cache.set(cacheKey, { body, observedAt: this.lastSuccessAt, expires: Date.now() + ttl });
      if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value);
      return body;
    }).catch(error => {
      if (error.details?.reason === 'access_or_plan_restriction') this.failures.set(cacheKey,{error,expires:Date.now()+900000});
      if (this.failures.size > 500) this.failures.delete(this.failures.keys().next().value);
      throw error;
    }).finally(() => this.pending.delete(cacheKey));
    this.pending.set(cacheKey, task);
    return task;
  }
  async request(path, params) {
    const unmetered = ['/status','/v4/account'].includes(path);
    const checkCooldown = () => { if (!unmetered && this.blockedUntil > Date.now()) throw new HttpError(503, `${this.name} is cooling down after an upstream limit.`, { upstreamStatus: 429, retryAfter: Math.ceil((this.blockedUntil - Date.now()) / 1000) }); };
    checkCooldown();
    const at = Math.max(Date.now(), this.nextCall);
    if (at - Date.now() > 15000) throw new HttpError(503, `${this.name} request queue is busy.`);
    this.nextCall = at + this.intervalMs;
    await new Promise(resolve => setTimeout(resolve, Math.max(0, at - Date.now())));
    checkCooldown();
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    const headers = this.queryAuth ? {} : { 'x-apisports-key': this.apiKey };
    if (this.queryAuth) url.searchParams.set('apiKey', this.apiKey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      this.requests++;
      const res = await this.fetcher(url, { headers, signal: controller.signal, redirect: 'error' });
      const body = await res.json().catch(() => null);
      this.quota = {
        daily_limit: res.headers.get('x-ratelimit-requests-limit'),
        daily_remaining: res.headers.get('x-ratelimit-requests-remaining'),
        minute_limit: res.headers.get('x-ratelimit-limit'),
        minute_remaining: res.headers.get('x-ratelimit-remaining')
      };
      const errorText = JSON.stringify(body?.errors || body?.error || body?.message || {}).split(this.apiKey).join('[REDACTED]');
      const hasErrors = body?.errors && Object.keys(body.errors).length > 0;
      if (!res.ok || hasErrors) {
        const limited = res.status === 429 || /rateLimit|request limit|too many|daily limit/i.test(errorText);
        const restricted = res.status === 401 || res.status === 403 || /subscription|free plan|access|token|api.?key/i.test(errorText);
        const reason = limited ? 'quota_or_rate_limit' : restricted ? 'access_or_plan_restriction' : 'upstream_error';
        const dailyExhausted = limited && this.quota.daily_remaining === '0';
        const delay = dailyExhausted ? 86400000 - Date.now() % 86400000 : limited ? 60000 : 900000;
        if (limited || res.status === 401 || res.status === 403 || /token|api.?key/i.test(errorText)) this.blockedUntil = Date.now() + delay;
        const upstreamMessage = errorText.split(this.apiKey).join('[REDACTED]')
          .replace(/https?:\/\/[^\s"]+/g,'[URL]').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]+/g,'[EMAIL]').slice(0,300);
        throw new HttpError(503, `${this.name}: ${reason}.`, { upstream_message: upstreamMessage, provider: this.name, fields: Object.keys(body?.errors || {}).filter(k=>['name','league','season','date','timezone','requests','token','rateLimit','plan','endpoint','bug','page'].includes(k)), upstreamStatus: limited ? 429 : res.status, reason, retryAfter: Math.ceil(delay / 1000) });
      }
      if (body === null) throw new HttpError(502, `${this.name} returned invalid JSON.`);
      this.lastSuccessAt = new Date().toISOString(); this.lastReadAt = this.lastSuccessAt; this.lastError = null;
      return body;
    } catch (error) {
      const safe = error instanceof HttpError ? error : new HttpError(502, `${this.name} request failed or timed out.`);
      this.lastError = safe.message;
      throw safe;
    } finally { clearTimeout(timer); }
  }
  status() { return { requests: this.requests, lastSuccessAt: this.lastSuccessAt, lastError: this.lastError, quota: this.quota }; }
}
