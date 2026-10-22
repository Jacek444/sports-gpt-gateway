import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('free box-score evidence works through HTTP and MCP without closing odds or log writes', async () => {
  const event = { id: '42', competitions: [{ date: '2026-10-21T23:00Z', status: { type: { name: 'STATUS_FINAL', completed: true } }, competitors: [] }] };
  const summary = { header: event, boxscore: { players: [{ team: { id: '1', displayName: 'Home' }, statistics: [{ keys: ['points'], labels: ['PTS'], athletes: [{ athlete: { id: '10', displayName: 'Fixture Player' }, stats: ['0'] }] }] }] } };
  // Only this child process intercepts the fixed ESPN host. Any unintended
  // upstream access or mutation fails; loopback MCP-to-HTTP requests pass through.
  const preload = `const original=globalThis.fetch;globalThis.fetch=async(input,options)=>{const url=new URL(input);if(url.hostname==='127.0.0.1')return original(input,options);if(url.hostname!=='site.api.espn.com')throw Error('Unexpected upstream');return new Response(JSON.stringify(url.pathname.endsWith('/scoreboard')?${JSON.stringify({ events: [event] })}:${JSON.stringify(summary)}));};`;
  const reserve = createServer().listen(0, '127.0.0.1');
  await once(reserve, 'listening'); const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const child = spawn(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, 'src/server.js'], {
    env: { ...process.env, PORT: String(port), NODE_ENV: 'production', DOTENV_CONFIG_PATH: '/nonexistent-test-env', SUPABASE_URL: 'https://unused-fixture.invalid', SUPABASE_SECRET_KEY: 'fixture-only', BALLDONTLIE_API_KEY: '', PARLAY_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = ''; child.stderr.on('data', chunk => { logs += chunk; });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(logs || 'Startup timeout')), 5000);
      child.once('exit', () => { clearTimeout(timer); reject(Error(logs)); });
      child.stdout.on('data', chunk => { if (String(chunk).includes('listening')) { clearTimeout(timer); resolve(); } });
    });
    const base = `http://127.0.0.1:${port}`;
    const discovery = await (await fetch(`${base}/v1/boxscores/games?league=NBA&date=2026-10-21`)).json();
    assert.equal(discovery.data[0].id, 'espn:NBA:42');
    const box = await (await fetch(`${base}/v1/boxscores/NBA/espn%3ANBA%3A42?playerId=10`)).json();
    assert.equal(box.meta.final, true); assert.equal(box.players[0].statistics[0].value, '0');
    assert.equal((await fetch(`${base}/v1/boxscores/NBA/balldontlie%3ANBA%3A42`)).status, 400);
    for (const [name, args, expected] of [
      ['sharpbet_list_boxscore_games', { league: 'NBA', date: '2026-10-21' }, /espn:NBA:42/],
      ['sharpbet_get_player_boxscore', { league: 'NBA', gameId: 'espn:NBA:42', playerId: '10' }, /Fixture Player/]
    ]) {
      const result = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
      assert.equal(result.status, 200); assert.match(await result.text(), expected);
    }
    assert.ok(!logs.includes('Unexpected upstream'));
  } finally {
    if (child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; }
  }
});
