import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';

let sequence = 0;
const future = '2099-09-30T20:00:00Z';
const odd = { event_id: 'canonical-game', league: 'nba', home_team: 'Home', away_team: 'Away', event_start_time: future,
  market_type: 'moneyline', sportsbook: 'draftkings', selection: 'Home', odds_american: -120, odds_decimal: 1.833333,
  line: null, timestamp: new Date(Date.now() - 60000).toISOString(), is_main_line: true, is_alternate_line: false, is_live: false, is_active: true };
const payload = (data, pagination = { has_more: false }) => ({ data, pagination });
const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'x-data-delay': '60s', 'x-ratelimit-limit': '12', 'x-ratelimit-remaining': '11', ...headers }
});
async function setup(t, handler) {
  config.oddsProviders.sharpApi = { enabled: true, apiKey: 'test-secret-never-print', baseUrl: 'https://fixture.invalid' };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, options }); return handler(url, options, calls.length); });
  const { sharpApiProvider } = await import(`../src/oddsProviders/sharpApiProvider.js?test=${sequence++}`);
  return { api: sharpApiProvider, calls };
}

test('uses header authentication, discovers playable events through odds pages, deduplicates and enforces exact UTC bounds', async (t) => {
  const { api, calls } = await setup(t, (url, options, n) => n === 1
    ? response(payload([odd, { ...odd, event_id: 'outside', event_start_time: '2099-10-01T01:00:00Z' }], { has_more: true, next_cursor: 'page2' }))
    : response(payload([odd, { ...odd, event_id: 'live', is_live: true }])));
  const result = await api.getEvents('basketball_nba', { commenceTimeFrom: '2099-09-30T00:00:00Z', commenceTimeTo: '2099-09-30T23:59:59Z' });
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].provider_event_id, odd.event_id);
  assert.equal(result.meta.complete_schedule, false);
  assert.equal(result.meta.data_delay_seconds, 60);
  assert.equal(result.quota.remaining, '11');
  assert.equal(calls[1].url.searchParams.get('cursor'), 'page2');
  assert.equal(calls[0].options.headers['X-API-Key'], 'test-secret-never-print');
  assert.equal(calls[0].url.href.includes('test-secret'), false);
  assert.equal(calls[0].url.searchParams.get('league'), 'nba');
  assert.equal(calls[0].url.pathname, '/api/v1/odds');
  assert.equal(calls[0].url.searchParams.get('market'), 'moneyline');
  assert.equal(calls[0].url.searchParams.get('sportsbook'), 'draftkings,fanduel');
  assert.equal(result.meta.discovery_source, 'pregame_moneyline_odds');
  assert.equal(result.data[0].bookmakers, undefined);
});

test('cursor pagination builds bookmaker markets and preserves side, line, player and timestamp', async (t) => {
  const prop = { ...odd, market_type: 'player_points', selection: 'Over', player_name: 'A Player', line: 22.5 };
  const { api, calls } = await setup(t, (url, options, n) => n === 1
    ? response(payload([prop], { has_more: true, next_cursor: 'opaque+cursor' }))
    : response(payload([{ ...prop, selection: 'Under', odds_american: 110 }])));
  const result = await api.getEventOdds('NBA', 'canonical-game', { markets: 'player_points', oddsFormat: 'decimal' });
  assert.equal(calls[1].url.searchParams.get('cursor'), 'opaque+cursor');
  assert.equal(calls[0].url.searchParams.get('event_id'), 'canonical-game');
  assert.equal(calls[0].url.searchParams.get('is_live'), 'false');
  const outcomes = result.data.bookmakers[0].markets[0].outcomes;
  assert.equal(outcomes.length, 2);
  assert.deepEqual(outcomes[0], { name: 'Over', price: 1.833333, point: 22.5, description: 'A Player', last_update: prop.timestamp });
});

test('normalizes MLB and NHL core markets while excluding alternates from the base line', async (t) => {
  const { api, calls } = await setup(t, (url) => {
    const type = url.searchParams.get('market');
    return response(payload([{ ...odd, league: url.searchParams.get('league'), market_type: type, line: 1.5 },
      { ...odd, league: url.searchParams.get('league'), market_type: type, line: 2.5, is_main_line: false, is_alternate_line: true }]));
  });
  const mlb = await api.getOddsBoard('baseball_mlb', { markets: 'spreads' });
  assert.equal(calls[0].url.searchParams.get('market'), 'run_line');
  assert.equal(calls[0].url.searchParams.get('is_main_line'), 'true');
  assert.equal(mlb.data[0].bookmakers[0].markets[0].outcomes.length, 1);
  await api.getOddsBoard('icehockey_nhl', { markets: 'totals' });
  assert.equal(calls[1].url.searchParams.get('market'), 'total_goals');
});

test('keeps base and alternate lines in separate markets', async (t) => {
  const { api } = await setup(t, () => response(payload([
    { ...odd, market_type: 'point_spread', line: -3.5 },
    { ...odd, market_type: 'point_spread', line: -5.5, is_main_line: false, is_alternate_line: true }
  ])));
  const result = await api.getOddsBoard('NBA', { markets: 'spreads,alternate_spreads' });
  assert.deepEqual(result.data[0].bookmakers[0].markets.map((m) => [m.key, m.outcomes[0].point]), [['spreads', -3.5], ['alternate_spreads', -5.5]]);
});

test('rejects inactive, live, stale, malformed and already-started prices', async (t) => {
  const { api } = await setup(t, () => response(payload([
    { ...odd, is_live: true }, { ...odd, is_active: false }, { ...odd, is_stale_pregame_price: true },
    { ...odd, event_start_time: '2000-01-01T00:00:00Z' }, { ...odd, odds_american: 0 },
    { ...odd, timestamp: 'invalid' }, { ...odd, event_status: 'final' }, { ...odd, timestamp: '2000-01-01T00:00:00Z' }
  ])));
  await assert.rejects(api.getOddsBoard('NBA', { markets: 'h2h' }), /no usable odds/);
});

test('missing markets fail rather than silently claiming a complete requested board', async (t) => {
  const { api } = await setup(t, () => response(payload([odd])));
  await assert.rejects(api.getOddsBoard('NBA', { markets: 'h2h,totals' }), /requested markets: totals/);
});

test('unsupported books, regions, live calls, market aliases and scores consume no credits', async (t) => {
  const { api, calls } = await setup(t, () => { throw new Error('Unexpected network'); });
  for (const params of [{ bookmakers: 'betmgm' }, { bookmakers: 'draftkings,betmgm' }, { regions: 'uk' }, { live: true }, { markets: 'pitcher_strikeouts' }]) {
    await assert.rejects(api.getOddsBoard('NBA', params));
  }
  assert.throws(() => api.getScores('NBA'), /does not supply scores/);
  assert.equal(calls.length, 0);
});

test('partial or looping pagination never escapes as a full slate', async (t) => {
  const { api } = await setup(t, () => response(payload([odd], { has_more: true, next_cursor: 'page2' })));
  await assert.rejects(api.getEvents('NBA'), /pagination/);
});

test('oversized scans stop at the page budget', async (t) => {
  const { api, calls } = await setup(t, (url, opts, n) => response(payload([odd], { has_more: true, next_cursor: `cursor${n}` })));
  await assert.rejects(api.getOddsBoard('NBA', { markets: 'h2h' }), /page budget/);
  assert.equal(calls.length, 6);
});

test('upstream 429 retains retry information without reflecting provider secrets', async (t) => {
  const { api } = await setup(t, () => response({ error: { message: 'test-secret-never-print', retry_after: 17 } }, 429));
  await assert.rejects(api.getEvents('NBA'), (error) => {
    assert.equal(error.details.upstreamStatus, 429);
    assert.equal(error.details.retryAfter, 17);
    assert.equal(JSON.stringify(error).includes('test-secret'), false);
    return true;
  });
});

test('warming, invalid response and missing pagination fail explicitly', async (t) => {
  let body = { data: [], meta: { store: { reason: 'warming' } } };
  const { api } = await setup(t, () => response(body));
  await assert.rejects(api.getEvents('NBA'), /not ready/);
  body = { data: 'bad' };
  await assert.rejects(api.getEvents('NBA'), /invalid data/);
  body = { data: [odd] };
  await assert.rejects(api.getEvents('NBA'), /pagination/);
});

test('local rolling quota prevents a thirteenth upstream request', async (t) => {
  const { api, calls } = await setup(t, () => response(payload([odd])));
  for (let n = 0; n < 12; n++) await api.getEvents('NBA');
  await assert.rejects(api.getEvents('NBA'), (error) => error.details.upstreamStatus === 429);
  assert.equal(calls.length, 12);
});

test('invalid windows and missing configuration consume no upstream requests', async (t) => {
  const { api, calls } = await setup(t, () => response(payload([odd])));
  await assert.rejects(api.getEvents('NBA', { commenceTimeFrom: 'invalid' }), /Invalid commence/);
  config.oddsProviders.sharpApi.apiKey = '';
  await assert.rejects(api.getEvents('NBA'), /not configured/);
  assert.equal(calls.length, 0);
});
