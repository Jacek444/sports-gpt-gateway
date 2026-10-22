import { HttpError } from '../errors.js';

const paths = { NBA: 'basketball/nba', NHL: 'hockey/nhl' };
const ROOT = 'https://site.api.espn.com/apis/site/v2/sports/';
const note = 'Public ESPN feed; availability is not guaranteed. Match the fixture and athlete before grading. Missing stats are unknown. Final box scores can be corrected; sportsbook participation, overtime and void rules still apply. This lookup does not save results or calculate CLV.';

function eventId(league, value) {
  const match = String(value).match(/^espn:(NBA|NHL):(\d+)$/);
  if (!match || match[1] !== league) throw new HttpError(400, 'Use the ESPN game ID returned by box-score game discovery for this league.');
  return match[2];
}

function game(league, event) {
  const competition = event.competitions?.[0];
  if (!/^\d+$/.test(String(event.id)) || !competition) throw new HttpError(502, 'ESPN returned an incomplete game.');
  const status = competition.status?.type || event.status?.type || {};
  return {
    id: `espn:${league}:${event.id}`, league, provider: 'espn',
    start_time: competition.date || event.date || null,
    status: status.name || 'unknown', completed: status.completed === true && /^STATUS_FINAL/.test(status.name || ''),
    teams: (competition.competitors || []).map(c => ({
      id: c.team?.id ? `espn:${league}:team:${c.team.id}` : null,
      name: c.team?.displayName || null, home_away: c.homeAway || null,
      score: c.score === undefined || c.score === null || c.score === '' ? null : String(c.score)
    }))
  };
}

export class EspnBoxscore {
  constructor({ fetcher = (...args) => fetch(...args), now = Date.now } = {}) {
    Object.assign(this, { fetcher, now });
    this.cache = new Map(); this.pending = new Map(); this.blockedUntil = 0;
  }
  async read(league, resource, params) {
    if (!paths[league]) throw new HttpError(400, 'Free box-score lookup currently supports NBA and NHL.');
    const url = new URL(`${paths[league]}/${resource}`, ROOT);
    url.search = new URLSearchParams(params).toString();
    const key = url.href;
    const cached = this.cache.get(key);
    if (cached?.expires > this.now()) return cached.result;
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.blockedUntil > this.now()) throw new HttpError(503, 'ESPN lookup is cooling down after a rate limit.');
    const task = (async () => {
      let response;
      try { response = await this.fetcher(url, { signal: AbortSignal.timeout(10000), redirect: 'error', headers: { Accept: 'application/json' } }); }
      catch { throw new HttpError(502, 'ESPN box-score lookup failed or timed out.'); }
      if (response.status === 429) this.blockedUntil = this.now() + 60000;
      if (!response.ok) throw new HttpError(response.status === 404 ? 404 : 503, 'ESPN box-score resource is unavailable.', { provider: 'espn', upstreamStatus: response.status });
      const body = await response.json().catch(() => null);
      if (!body || typeof body !== 'object' || body.error) throw new HttpError(502, 'ESPN returned an invalid response.');
      const result = { body, fetched_at: new Date(this.now()).toISOString() };
      this.cache.set(key, { expires: this.now() + 60000, result });
      if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value);
      return result;
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, task); return task;
  }
  async listGames({ league, date }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new HttpError(400, 'date must be a valid YYYY-MM-DD.');
    const { body, fetched_at } = await this.read(league, 'scoreboard', { dates: date.replaceAll('-', ''), limit: '100' });
    if (!Array.isArray(body.events)) throw new HttpError(502, 'ESPN returned an invalid game list.');
    return { provider: 'espn', data: body.events.map(e => game(league, e)), meta: { fetched_at, date, date_timezone: 'provider_calendar', complete_schedule: false, note } };
  }
  async getBoxscore({ league, gameId, playerId }) {
    const id = eventId(league, gameId);
    if (playerId && !/^\d+$/.test(playerId)) throw new HttpError(400, 'playerId must be the numeric ESPN athlete ID.');
    const { body, fetched_at } = await this.read(league, 'summary', { event: id });
    if (String(body.header?.id) !== id) throw new HttpError(502, 'ESPN returned a different or missing game identity.');
    const fixture = game(league, body.header);
    const teams = body.boxscore?.players;
    if (teams !== undefined && !Array.isArray(teams)) throw new HttpError(502, 'ESPN returned invalid player box scores.');
    const players = [];
    for (const team of teams || []) for (const group of team.statistics || []) for (const row of group.athletes || []) {
      if (!row.athlete?.id || !row.athlete?.displayName) continue;
      if (playerId && String(row.athlete.id) !== playerId) continue;
      const keys = group.keys || group.labels;
      const values = row.stats;
      const aligned = Array.isArray(keys) && Array.isArray(values) && keys.length === values.length;
      players.push({
        player_id: String(row.athlete.id), name: row.athlete.displayName,
        team_id: team.team?.id ? `espn:${league}:team:${team.team.id}` : null,
        team: team.team?.displayName || null, category: group.name || 'game',
        did_not_play: row.didNotPlay ?? null, scratched: row.athlete.scratched ?? null,
        ...(row.didNotPlay === true && row.reason ? { participation_note: row.reason } : {}),
        stats_available: aligned && row.didNotPlay !== true && row.athlete.scratched !== true,
        statistics: aligned ? keys.map((key, i) => ({ key, label: group.labels?.[i] || key, value: values[i] === '' || values[i] == null || /^-+$/.test(String(values[i])) ? null : String(values[i]) })) : []
      });
    }
    return { provider: 'espn', game: fixture, players, meta: { fetched_at, final: fixture.completed, boxscore_available: players.some(p => p.stats_available), note } };
  }
}

export const espnBoxscore = new EspnBoxscore();
