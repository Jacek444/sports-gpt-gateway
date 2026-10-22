import test from 'node:test';
import assert from 'node:assert/strict';
import { EspnBoxscore } from '../src/providers/espnBoxscore.js';
import { failureDetails } from '../src/oddsProviders/failureDetails.js';

const fixture = (completed = true) => ({ id: '42', competitions: [{ date: '2026-10-21T23:00Z', status: { type: { name: completed ? 'STATUS_FINAL' : 'STATUS_IN_PROGRESS', completed } }, competitors: [{ team: { id: '1', displayName: 'Home' }, homeAway: 'home', score: '0' }] }] });
const body = (completed = true) => ({ header: fixture(completed), boxscore: { players: [{ team: { id: '1', displayName: 'Home' }, statistics: [{ keys: ['points', 'assists', 'rebounds'], labels: ['PTS', 'AST', 'REB'], athletes: [
  { athlete: { id: '10', displayName: 'Player One' }, didNotPlay: false, stats: ['0', '4', ''] },
  { athlete: { id: '11', displayName: 'Player Two' }, didNotPlay: true, stats: ['0', '0', '0'] }
] }] }] } });
const response = value => new Response(JSON.stringify(value));

test('ESPN discovers source-specific games, preserves zero scores and bounds calendar queries', async () => {
  let calls = 0;
  const client = new EspnBoxscore({ fetcher: async url => { calls++; assert.equal(url.hostname, 'site.api.espn.com'); assert.equal(url.searchParams.get('dates'), '20261021'); return response({ events: [fixture()] }); } });
  const result = await client.listGames({ league: 'NBA', date: '2026-10-21' });
  assert.equal(result.data[0].id, 'espn:NBA:42'); assert.equal(result.data[0].teams[0].score, '0');
  assert.equal(result.meta.complete_schedule, false);
  for (const date of ['2026-02-30', '', '20261021']) await assert.rejects(client.listGames({ league: 'NBA', date }), e => e.status === 400);
  await assert.rejects(client.listGames({ league: 'NFL', date: '2026-10-21' }), e => e.status === 400);
  assert.equal(calls, 1);
});
test('ESPN box scores preserve player identity, missing values, DNP and live status', async () => {
  for (const league of ['NBA', 'NHL']) {
    const client = new EspnBoxscore({ fetcher: async () => response(body(false)) });
    const result = await client.getBoxscore({ league, gameId: `espn:${league}:42` });
    assert.equal(result.meta.final, false);
    assert.equal(result.players[0].statistics[0].value, '0');
    assert.equal(result.players[0].statistics[2].value, null);
    assert.equal(result.players[1].stats_available, false);
    const filtered = await client.getBoxscore({ league, gameId: `espn:${league}:42`, playerId: '10' });
    assert.equal(filtered.players.length, 1);
    assert.deepEqual((await client.getBoxscore({ league, gameId: `espn:${league}:42`, playerId: '99' })).players, []);
  }
});
test('ESPN rejects foreign IDs, mismatched fixture, missing tables and shifted columns safely', async () => {
  let calls = 0;
  const client = new EspnBoxscore({ fetcher: async () => { calls++; return response(body()); } });
  for (const id of ['42', 'balldontlie:NBA:42', 'espn:NHL:42', 'espn:NBA:../42']) await assert.rejects(client.getBoxscore({ league: 'NBA', gameId: id }), e => e.status === 400);
  assert.equal(calls, 0);
  const wrong = new EspnBoxscore({ fetcher: async () => response({ header: { ...fixture(), id: '43' } }) });
  await assert.rejects(wrong.getBoxscore({ league: 'NBA', gameId: 'espn:NBA:42' }), e => e.status === 502);
  const empty = new EspnBoxscore({ fetcher: async () => response({ header: fixture() }) });
  assert.equal((await empty.getBoxscore({ league: 'NBA', gameId: 'espn:NBA:42' })).meta.boxscore_available, false);
  const shifted = body(); shifted.boxscore.players[0].statistics[0].athletes[0].stats = ['0'];
  const malformed = new EspnBoxscore({ fetcher: async () => response(shifted) });
  assert.equal((await malformed.getBoxscore({ league: 'NBA', gameId: 'espn:NBA:42', playerId: '10' })).players[0].stats_available, false);
});
test('ESPN caches/coalesces lookups, retains observation time and respects 429 cooldown', async () => {
  let calls = 0, now = 100000;
  const client = new EspnBoxscore({ now: () => now, fetcher: async () => { calls++; return response(body()); } });
  const args = { league: 'NBA', gameId: 'espn:NBA:42' };
  const results = await Promise.all([client.getBoxscore(args), client.getBoxscore(args)]);
  now += 1000;
  assert.equal((await client.getBoxscore(args)).meta.fetched_at, results[0].meta.fetched_at); assert.equal(calls, 1);
  const limited = new EspnBoxscore({ now: () => now, fetcher: async () => { calls++; return new Response('{}', { status: 429 }); } });
  await assert.rejects(limited.getBoxscore(args), e => e.details.upstreamStatus === 429);
  await assert.rejects(limited.getBoxscore({ ...args, gameId: 'espn:NBA:43' }), /cooling down/);
  assert.equal(calls, 2);
});
test('provider diagnostics distinguish historical limits, exhausted quota and rate limits without raw secrets', () => {
  assert.equal(failureDetails({ error: 'HISTORICAL_LIMIT', allowed_from: '2026-10-20' }, 403).reason, 'historical_window_exceeded');
  assert.equal(failureDetails({ error: 'credit_limit_exceeded', next_reset_at: '2026-11-01T00:00:00Z' }, 403).nextResetAt, '2026-11-01T00:00:00Z');
  assert.equal(failureDetails({ error: { code: 'KEY_ROTATED' } }, 401).errorCode, 'KEY_ROTATED');
  assert.equal(failureDetails({ error: 'Rate limit exceeded' }, 429).reason, 'rate_limited');
  assert.ok(!JSON.stringify(failureDetails({ error: 'secret-value', allowed_from: 'secret-value' }, 403)).includes('secret-value'));
});
