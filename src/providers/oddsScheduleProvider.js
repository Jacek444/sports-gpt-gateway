import { BaseProvider } from './base.js';
import { HttpError } from '../errors.js';

const SPORTS = {
  NFL: 'americanfootball_nfl', NBA: 'basketball_nba',
  NCAAM: 'basketball_ncaab', NCAAF: 'americanfootball_ncaaf',
  MLB: 'baseball_mlb', NHL: 'icehockey_nhl'
};

async function loadEvents(sport, params) {
  const { withOddsProviderFallback } = await import('../oddsProviders/index.js');
  return withOddsProviderFallback((provider) => provider.getEvents(sport, params), {
    cacheKey: `league-events:${sport}:${JSON.stringify(params)}`,
    cacheTtlMs: 30000,
    rememberEvents: true,
    requestType: 'events'
  });
}

function team(value) {
  const name = typeof value === 'string' ? value
    : value?.names?.long || value?.names?.medium || value?.name || value?.full_name || null;
  return { id: value?.teamID || value?.id || null, name,
    abbreviation: value?.names?.short || value?.abbreviation || null };
}

function eventStatus(event) {
  const raw = event.status;
  const display = typeof raw === 'string' ? raw : raw?.displayLong || raw?.displayShort || null;
  const text = String(display || '').toLowerCase();
  let code = 'unknown';
  if (raw?.cancelled || /cancel/.test(text)) code = 'cancelled';
  else if (raw?.completed || raw?.ended || event.completed || /final|finished|completed/.test(text)) code = 'final';
  else if (raw?.live || /^(live|in progress)$/.test(text)) code = 'live';
  else if (raw?.delayed || /postponed|delayed/.test(text)) code = 'postponed';
  else if (raw?.started === false || /upcoming|scheduled/.test(text)) code = 'scheduled';
  return { code, display: display || code, is_live: code === 'unknown' ? null : code === 'live', period: null, clock: null };
}

function normalizeEvent(event, provider, league) {
  const rawId = event.provider_event_id || event.eventID || event.eventId || event.id;
  const id = event.gateway_event_id || (rawId ? `${provider}:${rawId}` : null);
  const home = team(event.teams?.home || event.home_team || event.homeTeam);
  const away = team(event.teams?.away || event.away_team || event.awayTeam);
  if (!id || !home.name || !away.name) {
    throw new HttpError(502, 'Odds provider returned an event without an ID or both team names.');
  }
  return {
    id, gateway_event_id: id, provider_event_id: rawId ? String(rawId) : null,
    league, provider, season: null, week: null,
    start_time: event.status?.startsAt || event.commence_time || event.commenceTime || event.start_time || null,
    status: eventStatus(event), home_team: { ...home, league }, away_team: { ...away, league },
    score: { home: null, away: null }, venue: event.info?.venue?.name || null
  };
}

export class OddsScheduleProvider extends BaseProvider {
  constructor(fetchEvents = loadEvents, now = Date.now) {
    super('odds');
    this.fetchEvents = fetchEvents;
    this.now = now;
  }

  async listGames({ league, date, season, week, team: teamFilter, status, cursor, limit = 25 }) {
    const sport = SPORTS[league];
    if (!sport) throw new HttpError(400, `Unsupported league "${league}".`);
    if (season !== undefined || week !== undefined || cursor) {
      throw new HttpError(400, 'Odds-based event discovery does not support season, week, or cursor filters. Use a date, or sharpbet_get_events with an explicit time window.');
    }
    // An unbounded SportsGameOdds request starts with archived events.
    const today = new Date(this.now()).toISOString().slice(0, 10);
    const params = { dateFormat: 'iso', commenceTimeFrom: `${today}T00:00:00.000Z` };
    if (date) {
      const start = Date.parse(`${date}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== date) {
        throw new HttpError(400, 'date must be a valid YYYY-MM-DD date (UTC).');
      }
      params.commenceTimeFrom = new Date(start).toISOString();
      params.commenceTimeTo = new Date(start + 86400000 - 1000).toISOString();
    }
    const count = Number(limit);
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new HttpError(400, 'limit must be an integer from 1 to 100.');
    const result = await this.fetchEvents(sport, params);
    const raw = Array.isArray(result.data) ? result.data : result.data?.events;
    if (!Array.isArray(raw) || !result.provider || result.provider === 'mock') {
      throw new HttpError(502, 'Odds provider returned an invalid or mock event response.');
    }
    // Filter archived rows before normalizing: special historical events can
    // omit team names and must not break current event discovery.
    let games = raw.filter((event) => {
      const time = Date.parse(event.status?.startsAt || event.commence_time || event.commenceTime || event.start_time);
      if (!Number.isFinite(time)) return true; // Keep malformed rows for validation.
      return time >= Date.parse(params.commenceTimeFrom)
        && (!params.commenceTimeTo || time <= Date.parse(params.commenceTimeTo));
    }).map((event) => normalizeEvent(event, result.provider, league));
    if (teamFilter) {
      const term = String(teamFilter).toLowerCase();
      games = games.filter((game) => [game.home_team, game.away_team].some((entry) =>
        [entry.id, entry.name, entry.abbreviation].some((value) => String(value || '').toLowerCase().includes(term))));
    }
    if (status) games = games.filter((game) => game.status.code === status);
    return {
      provider: result.provider, data: games.slice(0, count),
      meta: {
        per_page: count, returned: Math.min(games.length, count),
        coverage: 'betting_events', complete_schedule: false, date_timezone: 'UTC',
        starts_at_or_after: params.commenceTimeFrom,
        truncated: games.length > count || Boolean(result.nextCursor || result.data?.nextCursor || result.meta?.next_cursor),
        note: 'Only events covered by the odds provider are included. Empty results do not prove that no games exist. For a local calendar day, use sharpbet_get_events with explicit UTC start/end timestamps.'
      },
      quota: result.quota || null, cache: result.cache || { hit: false }
    };
  }

  unavailable(resource, alternative) {
    throw new HttpError(503, `${resource} require a configured general sports-data provider. ${alternative} No test data was substituted.`);
  }

  async getGame() {
    this.unavailable('Detailed game records', 'Use sharpbet_get_events for discovery, sharpbet_get_event_odds with its gateway_event_id for prices, or sharpbet_get_scores for supported score coverage.');
  }

  async listTeams() { this.unavailable('Team directories', 'Team names are available on returned odds events.'); }
  async getStandings() { this.unavailable('Standings', 'Verify standings from an official league source.'); }
}
