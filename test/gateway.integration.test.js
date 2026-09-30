import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('HTTP schedule route uses real adapter flow, falls back, and never substitutes test games', async () => {
  let primaryFails = false;
  let secondaryFails = false;
  const calls = [];
  const upstream = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/rest/v1/bet_log' && req.method === 'GET') {
      return res.end(JSON.stringify([{ id: 'fixture-bet', result: 'pending', stake_usd: 2.5 }]));
    }
    if (url.pathname === '/rest/v1/promos' && req.method === 'GET') {
      return res.end(JSON.stringify([{ id: 'fixture-promo', status: 'AVAILABLE', boost_percent: 33 }]));
    }
    if (url.pathname.startsWith('/rest/v1/')) return res.end('{}');
    calls.push(url.pathname);
    if (url.pathname === '/v2/events') {
      res.statusCode = primaryFails ? 503 : 200;
      return res.end(JSON.stringify(primaryFails ? { error: 'unavailable' } : { data: [{
        eventID: 'fixture-sgo', teams: { home: { names: { long: 'Chicago Bears' } }, away: { names: { long: 'Philadelphia Eagles' } } },
        status: { startsAt: '2026-09-29T00:15:00Z', started: false }
      }] }));
    }
    if (url.pathname === '/v1/sports/americanfootball_nfl/events') {
      res.statusCode = secondaryFails ? 503 : 200;
      return res.end(JSON.stringify(secondaryFails ? { error: 'unavailable' } : [{
        id: 'fixture-parlay', home_team: 'Chicago Bears', away_team: 'Philadelphia Eagles', commence_time: new Date(Date.now() + 86400000).toISOString()
      }]));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  const portReservation = createServer();
  portReservation.listen(0, '127.0.0.1');
  await once(portReservation, 'listening');
  const port = portReservation.address().port;
  await new Promise((resolve) => portReservation.close(resolve));
  const child = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port),
      DOTENV_CONFIG_PATH: '/nonexistent-sharpbet-test-env',
      SUPABASE_URL: upstreamUrl, SUPABASE_SECRET_KEY: 'test-only-placeholder',
      DEFAULT_PROVIDER: 'balldontlie', BALLDONTLIE_API_KEY: '',
      MOCK_WHEN_UNCONFIGURED: 'true', ALLOW_MOCK_DATA: 'true',
      SPORTSGAMEODDS_ENABLED: 'true', SPORTSGAMEODDS_API_KEY: 'test', SPORTSGAMEODDS_BASE_URL: upstreamUrl,
      PARLAY_API_ENABLED: 'true', PARLAY_API_KEY: 'test', PARLAY_API_BASE_URL: upstreamUrl,
      THE_ODDS_API_ENABLED: 'false', ODDS_API_IO_ENABLED: 'false',
      ODDS_PROVIDER_ORDER: 'sportsGameOdds,parlayApi',
      ...Object.fromEntries(['NBA', 'NFL', 'NCAAM', 'NCAAF', 'MLB', 'NHL'].map((league) => [`PROVIDER_${league}`, '']))
    }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stderr.on('data', (chunk) => { logs += chunk; });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Server did not start: ${logs}`)), 5000);
      child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${logs}`)); });
      child.stdout.on('data', (chunk) => {
        if (String(chunk).includes('listening')) { clearTimeout(timeout); resolve(); }
      });
    });
    const get = (path) => fetch(`http://127.0.0.1:${port}${path}`);
    const health = await (await get('/health')).json();
    assert.equal(health.provider_defaults.NFL, 'odds');
    assert.equal(health.league_data.NFL.status, 'configured_not_probed');
    const primary = await (await get('/v1/games?league=NFL&date=2026-09-29')).json();
    assert.equal(primary.data[0].id, 'sportsGameOdds:fixture-sgo');
    assert.equal(primary.meta.complete_schedule, false);
    assert.equal(primary.data[0].score.home, null);
    // Existing Custom GPT paths keep their response wrappers and saved values.
    const boardResponse = await get('/v1/odds/americanfootball_nfl/odds?markets=h2h');
    assert.equal(boardResponse.status, 200);
    const board = await boardResponse.json();
    assert.equal(board.provider, 'sportsGameOdds');
    assert.equal(board.data[0].eventID, 'fixture-sgo');
    const betResponse = await get('/v1/logs/bet-log?limit=10');
    assert.equal(betResponse.status, 200);
    const bets = await betResponse.json();
    assert.equal(bets.data[0].id, 'fixture-bet');
    assert.equal(bets.data[0].stake_usd, 2.5);
    const promoResponse = await get('/v1/logs/promos?status=AVAILABLE&limit=10');
    assert.equal(promoResponse.status, 200);
    const promos = await promoResponse.json();
    assert.equal(promos.data[0].id, 'fixture-promo');
    assert.equal(promos.data[0].boost_percent, 33);
    primaryFails = true;
    const secondary = await (await get('/v1/games?league=NFL')).json();
    assert.equal(secondary.data[0].id, 'parlayApi:fixture-parlay');
    assert.ok(calls.includes('/v1/sports/americanfootball_nfl/events'));
    for (const path of ['/v1/standings?league=NFL', '/v1/teams?league=NFL', '/v1/games/NFL/anything']) {
      const result = await get(path);
      assert.equal(result.status, 503);
      assert.match((await result.json()).error.message, /No test data/);
    }
    secondaryFails = true;
    const failed = await get('/v1/games?league=NFL&date=2026-09-30');
    assert.ok(failed.status >= 500);
    const body = await failed.json();
    assert.ok(body.error);
    assert.equal(body.data, undefined);
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  }
});
