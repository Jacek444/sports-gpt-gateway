import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('historical HTTP/MCP reads, CLV preview, caching and budget guards use only selected provider', async () => {
  let calls = 0, writes = 0;
  const event = { id: 'abc', commence_time: '2026-01-01T01:00:00Z', bookmakers: [{ key: 'betmgm', last_update: '2026-01-01T00:54:00Z', markets: [{ key: 'h2h', outcomes: [{ name: 'Home', price: -130 }] }] }] };
  const upstream = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/rest/v1/')) {
      if (req.method === 'PATCH') writes++;
      return res.end('[]');
    }
    calls++;
    assert.match(req.url, /^\/v4\/historical\/sports\/basketball_nba\//);
    res.setHeader('x-requests-last', '10');
    res.end(JSON.stringify({ timestamp: '2026-01-01T00:55:00Z', data: event }));
  }).listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const source = `http://127.0.0.1:${upstream.address().port}`;
  const reserve = createServer().listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const port = reserve.address().port; await new Promise(r => reserve.close(r));
  const child = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), DOTENV_CONFIG_PATH: '/nonexistent-test-env',
      SUPABASE_URL: source, SUPABASE_SECRET_KEY: 'fixture-only', ODDS_API_KEY: 'fixture-only', THE_ODDS_API_ENABLED: 'true', ODDS_API_BASE_URL: source },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = ''; child.stderr.on('data', c => { logs += c; });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(logs || 'Startup timeout')), 5000);
      child.once('exit', () => { clearTimeout(timer); reject(Error(logs)); });
      child.stdout.on('data', c => { if (String(c).includes('listening')) { clearTimeout(timer); resolve(); } });
    });
    const base = `http://127.0.0.1:${port}`;
    const path = '/v1/odds/basketball_nba/history?type=event_odds&event_id=theOddsApi%3Aabc&date=2026-01-01T00:59:59Z&bookmakers=betmgm';
    const first = await (await fetch(base + path)).json(); assert.equal(first.actual_credits, 10);
    const cached = await (await fetch(base + path)).json(); assert.equal(cached.actual_credits, 0); assert.equal(calls, 1);
    const post = body => fetch(base + '/v1/odds/clv/grade-and-save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const bet = { sport_key: 'basketball_nba', gateway_event_id: 'theOddsApi:abc', commence_time: event.commence_time, market_key: 'h2h', bookmaker_key: 'betmgm', outcome: 'Home', taken_odds: -110 };
    const preview = await (await post({ provider: 'theOddsApi', bets: [bet] })).json();
    assert.equal(preview.results[0].log_update.clv_percent, 7.91); assert.equal(preview.results[0].saved, false); assert.equal(writes, 0); assert.equal(calls, 1);
    assert.equal((await post({ provider: 'theOddsApi', max_credits: 1, bets: [bet] })).status, 400); assert.equal(calls, 1);
    const mcp = await fetch(base + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'sharpbet_get_historical_odds', arguments: { sport: 'basketball_nba', type: 'event_odds', event_id: 'theOddsApi:abc', date: '2026-01-01T00:59:59Z', bookmakers: 'betmgm' } } }) });
    assert.equal(mcp.status, 200); assert.match(await mcp.text(), /snapshot_note/); assert.equal(calls, 1);
  } finally {
    if (child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; }
    await new Promise(r => upstream.close(r));
  }
});
