import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('SharpAPI works through HTTP with cache, compact metadata, event IDs, fallback and rate-limit cooldown', async () => {
  const start = new Date(Date.now() + 86400000).toISOString();
  let rateLimited = false;
  let sharpCalls = 0;
  const upstream = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname.startsWith('/rest/v1/')) return res.end(req.method === 'GET' ? '[]' : '{}');
    if (url.pathname.startsWith('/api/v1/')) {
      sharpCalls++;
      assert.equal(req.headers['x-api-key'], 'fixture-key');
      if (rateLimited) {
        res.statusCode = 429;
        res.setHeader('Retry-After', '60');
        return res.end(JSON.stringify({ error: { code: 'rate_limited' } }));
      }
      res.setHeader('X-Data-Delay', '60');
      res.setHeader('X-RateLimit-Remaining', '10');
      const event = { id: 'game', league: 'nba', home_team: 'Home', away_team: 'Away', start_time: start, status: 'upcoming' };
      const data = url.pathname === '/api/v1/events' ? [event] : [{
        event_id: 'game', league: 'nba', home_team: 'Home', away_team: 'Away', event_start_time: start,
        market_type: 'moneyline', sportsbook: 'draftkings', selection: 'Home', odds_american: -120,
        odds_decimal: 1.833333, timestamp: new Date().toISOString(), is_live: false, is_main_line: true
      }];
      return res.end(JSON.stringify({ data, pagination: { has_more: false } }));
    }
    if (url.pathname === '/v1/sports/basketball_nba/odds') {
      return res.end(JSON.stringify([{ id: 'parlay-game', home_team: 'Home', away_team: 'Away', commence_time: start, bookmakers: [] }]));
    }
    if (url.pathname === '/v1/sports/basketball_nba/events') {
      return res.end(JSON.stringify([{ id: 'parlay-game', home_team: 'Home', away_team: 'Away', commence_time: start }]));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const base = `http://127.0.0.1:${upstream.address().port}`;
  const reserve = createServer().listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  const child = spawn(process.execPath, ['src/server.js'], { env: {
    ...process.env, PORT: String(port), NODE_ENV: 'production', DOTENV_CONFIG_PATH: '/nonexistent-test-env',
    SUPABASE_URL: base, SUPABASE_SECRET_KEY: 'fixture-only',
    SHARP_API_KEY: 'fixture-key', SHARP_API_ENABLED: 'true', SHARP_API_BASE_URL: base,
    PARLAY_API_ENABLED: 'true', PARLAY_API_KEY: 'fixture-key', PARLAY_API_BASE_URL: base,
    THE_ODDS_API_ENABLED: 'false', SPORTSGAMEODDS_ENABLED: 'false', ODDS_API_IO_ENABLED: 'false',
    ODDS_PROVIDER_ORDER: 'sharpApi,parlayApi', ODDS_SPORTS_PROVIDER_ORDER: 'sharpApi,parlayApi'
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stderr.on('data', (chunk) => { logs += chunk; });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server startup: ${logs}`)), 5000);
      child.once('exit', () => { clearTimeout(timer); reject(new Error(logs)); });
      child.stdout.on('data', (chunk) => { if (String(chunk).includes('listening')) { clearTimeout(timer); resolve(); } });
    });
    const get = async (path) => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      return { status: res.status, body: await res.json() };
    };
    const health = await get('/health');
    assert.equal(health.body.odds.providers.sharpApi.configured, true);
    const events = await get('/v1/odds/basketball_nba/events');
    assert.equal(events.body.provider, 'sharpApi');
    assert.equal(events.body.data[0].gateway_event_id, 'sharpApi:game');
    assert.equal(events.body.data[0].status, 'Upcoming');
    assert.equal(events.body.meta.data_delay_seconds, 60);
    const count = sharpCalls;
    const cached = await get('/v1/odds/basketball_nba/events');
    assert.equal(cached.body.cache.hit, true);
    assert.equal(sharpCalls, count);
    const eventOdds = await get('/v1/odds/basketball_nba/events/sharpApi%3Agame/odds?markets=h2h');
    assert.equal(eventOdds.status, 200);
    assert.equal(eventOdds.body.data.gateway_event_id, 'sharpApi:game');
    assert.equal(eventOdds.body.data.bookmakers[0].markets[0].outcomes[0].price, -120);
    const board = await get('/v1/odds/basketball_nba/odds?markets=h2h');
    assert.equal(board.body.provider, 'sharpApi');
    const fallback = await get('/v1/odds/basketball_nba/odds?markets=h2h&bookmakers=betmgm');
    assert.equal(fallback.body.provider, 'parlayApi');
    rateLimited = true;
    const limited = await get('/v1/odds/basketball_nba/events?commenceTimeFrom=2099-01-01T00%3A00%3A00Z');
    assert.equal(limited.body.provider, 'parlayApi');
    const status = await get('/v1/odds/status');
    assert.equal(status.body.runtime.providers.sharpApi.temporarilyUnavailable, true);
  } finally {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  }
});
