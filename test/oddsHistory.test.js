import test from 'node:test';
import assert from 'node:assert/strict';
import { historyRequest, fetchHistory, prepareClv, gradeSnapshot } from '../src/history/oddsHistory.js';
const bet = { sport_key: 'basketball_nba', gateway_event_id: 'theOddsApi:abc', commence_time: '2026-01-01T01:00:00Z', market_key: 'player_points', bookmaker_key: 'betmgm', player: 'Test Player', outcome: 'Over', line: 20.5, taken_odds: -110 };
const archive = () => ({ data: { timestamp: '2026-01-01T00:55:00Z', data: { id: 'abc', commence_time: bet.commence_time, bookmakers: [{ key: 'betmgm', markets: [{ key: 'player_points', last_update: '2026-01-01T00:54:00Z', outcomes: [{ name: 'Over', description: 'Test Player', point: 20.5, price: -130 }] }] }] } } });
test('historical credit estimates and validation reject excessive or invalid requests', () => {
  const q = { date: '2026-01-01T00:55:00Z', markets: 'h2h,spreads,totals' };
  assert.equal(historyRequest('basketball_nba', q).estimated_credits, 30);
  assert.throws(() => historyRequest('basketball_nba', { ...q, regions: 'us,eu' }), /exceeds/);
  assert.equal(historyRequest('basketball_nba', { ...q, regions: 'us,eu', bookmakers: 'betmgm' }).estimated_credits, 30);
  assert.throws(() => historyRequest('basketball_nba', { ...q, date: '2026-01-01' }), /timezone/);
  assert.throws(() => historyRequest('basketball_nba', { ...q, markets: 'player_points' }), /event_odds/);
  assert.throws(() => prepareClv([{ ...bet, gateway_event_id: 'parlayApi:abc' }]), /original/);
});
test('CLV batches deduplicate requests and cap total estimated credits', () => {
  assert.equal(prepareClv([bet, { ...bet, player: 'Other Player' }]).estimated_credits, 10);
  assert.throws(() => prepareClv(Array.from({ length: 11 }, (_, i) => ({ ...bet, gateway_event_id: `theOddsApi:event${i}` }))), /exceeds/);
  assert.throws(() => prepareClv([{ ...bet, line: null }]), /numeric line/);
});
test('same-line CLV and line movement are distinct and retain evidence timestamps', () => {
  const item = prepareClv([bet]).prepared[0];
  const grade = gradeSnapshot(item, archive());
  assert.equal(grade.status, 'pregame_snapshot_same_line');
  assert.equal(grade.log_update.clv_percent, 7.91);
  assert.match(grade.log_update.clv_notes, /not verified exact close/);
  const changed = archive(); changed.data.data.bookmakers[0].markets[0].outcomes[0].point = 21.5;
  assert.equal(gradeSnapshot(item, changed).log_update.clv_percent, null);
});
test('wrong fixture/player and stale or in-play evidence cannot grade or overwrite', () => {
  for (const mutate of [d => { d.data.data.id = 'other'; }, d => { d.data.timestamp = bet.commence_time; }, d => { d.data.timestamp = '2026-01-01T00:00:00Z'; }, d => { d.data.data.bookmakers[0].markets[0].last_update = bet.commence_time; }, d => { d.data.data.bookmakers[0].markets[0].outcomes[0].description = 'Other Player'; }]) {
    const data = archive(); mutate(data);
    assert.equal(gradeSnapshot(prepareClv([bet]).prepared[0], data).log_update, null);
  }
});
test('validated event requests retain source ID and actual quota or zero cache cost', async () => {
  const request = historyRequest('basketball_nba', { type: 'event_odds', event_id: 'theOddsApi:abc', markets: 'player_points', date: '2026-01-01T00:55:00Z' });
  const result = await fetchHistory(request, async (name, action, opts) => {
    assert.equal(name, 'theOddsApi'); assert.equal(opts.cacheTtlMs, 86400000);
    return action({ getHistoricalEventOdds: async (sport, id, params) => {
      assert.equal(id, 'abc'); assert.equal(params.oddsFormat, 'american'); return { quota: { last: '10' } };
    } });
  });
  assert.equal(result.actual_credits, 10);
  assert.equal((await fetchHistory(request, async () => ({ cache: { hit: true } }))).actual_credits, 0);
});
