import test from 'node:test';
import assert from 'node:assert/strict';
import { OddsScheduleProvider } from '../src/providers/oddsScheduleProvider.js';

const event = { id: 'event-1', home_team: 'Chicago Bears', away_team: 'Philadelphia Eagles', commence_time: '2026-09-29T00:15:00Z' };
const response = (data = [event]) => ({ provider: 'theOddsApi', data });

test('normalizes real event identity without inventing score or live state', async () => {
  const provider = new OddsScheduleProvider(async (sport) => {
    assert.equal(sport, 'americanfootball_nfl');
    return response();
  });
  const result = await provider.listGames({ league: 'NFL' });
  assert.equal(result.data[0].id, 'theOddsApi:event-1');
  assert.equal(result.data[0].home_team.name, 'Chicago Bears');
  assert.deepEqual(result.data[0].score, { home: null, away: null });
  assert.equal(result.data[0].status.is_live, null);
  assert.equal(result.meta.complete_schedule, false);
});

test('normalizes SportsGameOdds data and explicit live status', async () => {
  const provider = new OddsScheduleProvider(async () => ({ provider: 'sportsGameOdds', data: [{
    eventID: 'sgo-1', gateway_event_id: 'sportsGameOdds:sgo-1',
    teams: { home: { teamID: 'CHI', names: { long: 'Chicago Bears', short: 'CHI' } }, away: { names: { long: 'Philadelphia Eagles' } } },
    status: { startsAt: event.commence_time, live: true }
  }] }));
  const result = await provider.listGames({ league: 'NFL', team: 'CHI', status: 'live' });
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].status.code, 'live');
  assert.equal(result.data[0].id, 'sportsGameOdds:sgo-1');
});

test('date filtering is UTC and enforced even if an upstream ignores it', async () => {
  const provider = new OddsScheduleProvider(async (_sport, params) => {
    assert.equal(params.commenceTimeFrom, '2026-09-28T00:00:00.000Z');
    assert.equal(params.commenceTimeTo, '2026-09-28T23:59:59.000Z');
    return response([event, { ...event, id: 'in-range', commence_time: '2026-09-28T20:00:00Z' }]);
  });
  const result = await provider.listGames({ league: 'NFL', date: '2026-09-28' });
  assert.deepEqual(result.data.map((game) => game.id), ['theOddsApi:in-range']);
});

test('empty coverage and pagination remain explicitly incomplete', async () => {
  const empty = await new OddsScheduleProvider(async () => response([])).listGames({ league: 'NFL' });
  assert.equal(empty.meta.complete_schedule, false);
  assert.match(empty.meta.note, /Empty results do not prove/);
  const limited = await new OddsScheduleProvider(async () => ({ ...response([event, { ...event, id: 'two' }]), nextCursor: 'next' })).listGames({ league: 'NFL', limit: 1 });
  assert.equal(limited.meta.truncated, true);
  assert.equal(limited.data.length, 1);
});

test('invalid dates and unsupported filters fail before consuming provider quota', async () => {
  const provider = new OddsScheduleProvider(async () => { assert.fail('must not call upstream'); });
  for (const extra of [{ date: '2026-02-30' }, { season: 2026 }, { week: 3 }, { cursor: 'next' }, { limit: 0 }]) {
    await assert.rejects(provider.listGames({ league: 'NFL', ...extra }), { status: 400 });
  }
});

test('malformed and mock upstream responses cannot masquerade as live events', async () => {
  for (const result of [{ provider: 'mock', data: [event] }, { provider: 'theOddsApi', data: {} }, response([{ id: 'broken' }])]) {
    await assert.rejects(new OddsScheduleProvider(async () => result).listGames({ league: 'NFL' }), { status: 502 });
  }
});

test('provider failures propagate instead of manufacturing games', async () => {
  const provider = new OddsScheduleProvider(async () => { throw new Error('quota exhausted'); });
  await assert.rejects(provider.listGames({ league: 'NFL' }), /quota exhausted/);
});

test('unsupported general-data requests return actionable errors', async () => {
  const provider = new OddsScheduleProvider();
  for (const method of ['getGame', 'listTeams', 'getStandings']) {
    await assert.rejects(provider[method]({ league: 'NFL' }), (error) => error.status === 503 && /No test data/.test(error.message));
  }
});
