import { BaseProvider } from './base.js';
import { FreeProviderClient } from '../clients/freeProviderClient.js';
import { HttpError } from '../errors.js';

const SCOPES = {
  NBA: ['basketball', 'NBA'], NCAAM: ['basketball', 'NCAA'],
  NFL: ['american-football', 'NFL'], NCAAF: ['american-football', 'NCAA'],
  MLB: ['baseball', 'MLB'], NHL: ['hockey', 'NHL']
};
const number = value => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const bad = message => new HttpError(502, `API-Sports ${message}`);
function dateOnly(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new HttpError(400, 'date must be YYYY-MM-DD (UTC).');
  return date;
}
function team(league, raw) {
  if (!raw?.id || !raw.name) throw bad('returned an incomplete team.');
  return { id: `apisports:${league}:${raw.id}`, provider_team_id: String(raw.id), league, name: raw.name, abbreviation: raw.code || null };
}
export function normalizeApiSportsGame(league, row) {
  const game = row.game || row;
  const rawStatus = game.status?.short;
  const code = rawStatus === 'NS' ? 'scheduled'
    : ['FT','AOT','AP','AWD'].includes(rawStatus) ? 'final'
    : ['POST','SUSP','INTR'].includes(rawStatus) ? 'postponed'
    : ['CANC','ABD'].includes(rawStatus) ? 'cancelled'
    : /^(Q[1-4]|P[1-3]|IN\d+|OT|BT|HT|PT|LIVE)$/.test(rawStatus || '') ? 'live' : 'unknown';
  const time = typeof game.date === 'string' ? game.date : game.date?.timestamp ? new Date(game.date.timestamp * 1000).toISOString() : null;
  if (!game.id || !Number.isFinite(Date.parse(time))) throw bad('returned an incomplete game.');
  const score = side => {
    if (code === 'scheduled' || code === 'cancelled') return null;
    const value = row.scores?.[side];
    return number(value && typeof value === 'object' ? value.total : value);
  };
  return {
    id: `apisports:${league}:${game.id}`, provider_game_id: String(game.id), league, provider: 'apisports',
    season: row.league?.season ?? null, week: game.week ?? null, start_time: time,
    status: { code, display: game.status?.long || code, is_live: code === 'unknown' ? null : code === 'live', period: null, clock: game.status?.timer ?? null },
    home_team: team(league, row.teams?.home), away_team: team(league, row.teams?.away),
    score: { home: score('home'), away: score('away') }, venue: game.venue?.name || (typeof game.venue === 'string' ? game.venue : null)
  };
}
export class ApiSportsProvider extends BaseProvider {
  constructor(settings, fallback = null, fetcher) {
    super('apisports'); this.settings = settings; this.fallback = fallback; this.clients = new Map(); this.access = {};
    this.fetcher = fetcher;
  }
  client(league) {
    const sport = SCOPES[league]?.[0];
    if (!sport) throw new HttpError(400, 'Unsupported API-Sports league.');
    if (!this.settings.enabled) throw new HttpError(503, 'API-Sports is disabled.');
    if (!this.clients.has(sport)) this.clients.set(sport, new FreeProviderClient({ name: 'apisports', apiKey: this.settings.apiKey, baseUrl: this.settings.baseUrl || `https://v1.${sport}.api-sports.io`, fetcher: this.fetcher, intervalMs: 6100 }));
    return this.clients.get(sport);
  }
  async rows(league, path, params, ttl) {
    const body = await this.client(league).get(path, params, ttl);
    if (!Array.isArray(body.response) || (body.paging?.total > 1)) throw bad('returned malformed or paginated data; refusing an incomplete result.');
    return body.response;
  }
  async scope(league, season) {
    const name = SCOPES[league]?.[1];
    const rows = await this.rows(league, '/leagues', { name }, 86400000);
    const matches = rows.filter(r => (r.league?.name || r.name) === name && ['USA','United States'].includes(r.country?.name));
    if (matches.length !== 1) throw new HttpError(503, `API-Sports could not uniquely resolve ${league}.`);
    const row = matches[0], id = row.league?.id || row.id;
    const seasons = row.seasons || [];
    const selected = season === undefined ? seasons.find(s => s.current) : seasons.find(s => String(s.season ?? s.year).split('-')[0] === String(season));
    if (season !== undefined && !selected) throw new HttpError(503, `API-Sports has no matching season for ${league}.`);
    return { id, season: selected?.season ?? selected?.year, coverage: selected?.coverage || null };
  }
  envelope(league, data, extra = {}) {
    return { provider: this.name, data, meta: { fetched_at: this.client(league).lastReadAt, date_timezone: 'UTC', coverage: 'provider_schedule', ...extra }, quota: this.client(league).quota };
  }
  async getAccess(league) {
    const body = await this.client(league).get('/status', {}, 60000);
    const r = body.response;
    if (!r?.subscription || !r?.requests) throw bad('returned invalid account status.');
    const safe = { provider: this.name, league, plan: r.subscription.plan, active: r.subscription.active, requests: { current: r.requests.current, limit_day: r.requests.limit_day }, checked_at: new Date().toISOString() };
    this.access[league] = safe; return safe;
  }
  status(league) { return { ...this.clients.get(SCOPES[league]?.[0])?.status(), access: this.access[league] || null }; }
  async listGames(params) {
    const { league, date, season, week, team: filter, status, cursor, limit = 25 } = params;
    if (cursor || week !== undefined) throw new HttpError(400, 'API-Sports adapter supports date/season filtering; week and cursor are not supported.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'limit must be 1-100.');
    const day = date ? dateOnly(date) : season === undefined ? new Date().toISOString().slice(0,10) : undefined;
    try {
      const scope = await this.scope(league, season);
      const rows = await this.rows(league, '/games', { league: scope.id, date: day, season: season !== undefined ? scope.season : undefined, timezone: 'UTC' }, 60000);
      let games = rows.filter(r => String(r.league?.id) === String(scope.id)).map(r => normalizeApiSportsGame(league,r));
      if (day) games = games.filter(g => new Date(g.start_time).toISOString().slice(0,10) === day);
      if (filter) games = games.filter(g => [g.home_team,g.away_team].some(t => [t.id,t.provider_team_id,t.name].some(v=>String(v).toLowerCase().includes(String(filter).toLowerCase()))));
      if (status) games = games.filter(g => g.status.code === status);
      return this.envelope(league, games.slice(0,limit), { returned: Math.min(games.length,limit), truncated: games.length > limit, season: scope.season, complete_schedule: false });
    } catch (error) {
      if (!this.fallback || error.status < 500 || season !== undefined) throw error;
      const result = await this.fallback.listGames(params);
      return { ...result, meta: { ...result.meta, fallback_from: this.name, fallback_reason: error.message } };
    }
  }
  async getGame({ league, gameId }) {
    const match = String(gameId).match(/^apisports:([A-Z]+):(\d+)$/);
    if (!match || match[1] !== league) throw new HttpError(400, 'Use an API-Sports game ID returned for this league. Rediscover odds events separately for betting prices.');
    const scope = await this.scope(league);
    const rows = await this.rows(league,'/games',{id:match[2],timezone:'UTC'},60000);
    const row = rows.find(r => String((r.game || r).id) === match[2] && String(r.league?.id) === String(scope.id));
    if (!row) throw new HttpError(404,'API-Sports game was not found in this league.');
    return this.envelope(league,normalizeApiSportsGame(league,row));
  }
  async listTeams({league, search = '',limit = 50}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'limit must be 1-100.');
    const scope = await this.scope(league);
    if (!scope.season) throw new HttpError(503,'API-Sports has no current season for team discovery.');
    const rows = await this.rows(league,'/teams',{league:scope.id,season:scope.season},86400000);
    const teams = rows.map(r=>team(league,r.team || r)).filter(t=>t.name.toLowerCase().includes(search.toLowerCase()));
    return this.envelope(league,teams.slice(0,limit),{truncated:teams.length>limit});
  }
  async getStandings() {
    throw new HttpError(503,'API-Sports standings normalization is not enabled. Verify standings from an official league source.');
  }
}
