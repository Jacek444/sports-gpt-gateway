import { BaseProvider } from './base.js';
import { HttpError } from '../errors.js';

const LEAGUE_PATHS = {
  NBA: '/v1',
  NFL: '/nfl/v1',
  NCAAM: '/ncaab/v1',
  NCAAF: '/ncaaf/v1',
  MLB: '/mlb/v1',
  NHL: '/nhl/v1'
};

function isNumeric(value) {
  return /^\d+$/.test(String(value || '').trim());
}

function addArrayParams(searchParams, key, values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(`${key}[]`, String(value));
    }
  }
}

function pick(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isNaN(number) ? null : number;
}

function buildTeamName(team) {
  return pick(
    team.full_name,
    team.display_name,
    [team.location, team.name].filter(Boolean).join(' '),
    [team.city, team.name].filter(Boolean).join(' '),
    [team.college, team.name].filter(Boolean).join(' '),
    team.name
  );
}

function normalizeTeam(league, rawTeam = {}) {
  return {
    id: String(pick(rawTeam.id, rawTeam.team_id, 'unknown')),
    league,
    name: pick(buildTeamName(rawTeam), 'Unknown Team'),
    short_name: pick(rawTeam.short_display_name, rawTeam.name, rawTeam.full_name, 'Unknown Team'),
    market: pick(rawTeam.location, rawTeam.city, rawTeam.college),
    abbreviation: pick(rawTeam.abbreviation, rawTeam.tricode, rawTeam.slug, 'UNK'),
    conference: pick(rawTeam.conference, rawTeam.conference_name, rawTeam.conference_id),
    division: pick(rawTeam.division, rawTeam.division_name)
  };
}

function inferStatus(rawGame) {
  const display = String(pick(rawGame.status, 'Unknown'));
  const lower = display.toLowerCase();

  if (rawGame.postponed === true || lower.includes('postponed')) {
    return {
      code: 'postponed',
      display,
      is_live: false,
      period: toNumber(rawGame.period),
      clock: pick(rawGame.time, null)
    };
  }

  if (
    lower === 'final' ||
    lower === 'post' ||
    lower === 'finished' ||
    lower.includes('final')
  ) {
    return {
      code: 'final',
      display,
      is_live: false,
      period: toNumber(rawGame.period),
      clock: pick(rawGame.time, null)
    };
  }

  if (
    lower === 'in' ||
    lower.includes('qtr') ||
    lower.includes('quarter') ||
    lower.includes('half') ||
    lower.includes('period') ||
    lower.includes('ot') ||
    lower.includes('intermission') ||
    lower === 'live'
  ) {
    return {
      code: 'live',
      display,
      is_live: true,
      period: toNumber(rawGame.period),
      clock: pick(rawGame.time, null)
    };
  }

  if (lower === 'scheduled' || lower === 'pre' || /\d/.test(display)) {
    return {
      code: 'scheduled',
      display,
      is_live: false,
      period: toNumber(rawGame.period),
      clock: pick(rawGame.time, null)
    };
  }

  return {
    code: 'unknown',
    display,
    is_live: false,
    period: toNumber(rawGame.period),
    clock: pick(rawGame.time, null)
  };
}

function normalizeGame(league, rawGame) {
  const homeTeam = normalizeTeam(league, pick(rawGame.home_team, rawGame.homeTeam, {}));
  const awayTeam = normalizeTeam(league, pick(rawGame.visitor_team, rawGame.away_team, rawGame.awayTeam, {}));

  return {
    id: String(rawGame.id),
    league,
    provider: 'balldontlie',
    season: toNumber(rawGame.season),
    week: toNumber(rawGame.week),
    start_time: pick(rawGame.datetime, rawGame.date),
    status: inferStatus(rawGame),
    home_team: homeTeam,
    away_team: awayTeam,
    score: {
      home: toNumber(pick(rawGame.home_team_score, rawGame.home_score)),
      away: toNumber(pick(rawGame.visitor_team_score, rawGame.away_score, rawGame.visitor_score))
    },
    venue: pick(rawGame.venue, rawGame.venue_name)
  };
}

function parseRecord(record) {
  if (!record || typeof record !== 'string') {
    return { wins: null, losses: null, ties: null };
  }

  const [wins, losses, ties] = record.split('-').map((part) => toNumber(part));
  return {
    wins,
    losses,
    ties: ties ?? 0
  };
}

function normalizeStanding(league, rawStanding) {
  const parsedRecord = parseRecord(rawStanding.overall_record);
  const wins = pick(rawStanding.wins, parsedRecord.wins);
  const losses = pick(rawStanding.losses, parsedRecord.losses);
  const ties = pick(rawStanding.ties, parsedRecord.ties);
  const totalGames = Number(wins || 0) + Number(losses || 0) + Number(ties || 0);
  const pct = rawStanding.pct !== undefined
    ? Number(rawStanding.pct)
    : rawStanding.win_percentage !== undefined
      ? Number(rawStanding.win_percentage)
      : totalGames > 0
        ? Number((Number(wins || 0) / totalGames).toFixed(3))
        : null;

  const streak = rawStanding.win_streak
    ? `W${rawStanding.win_streak}`
    : rawStanding.loss_streak
      ? `L${rawStanding.loss_streak}`
      : pick(rawStanding.streak, null);

  return {
    team: normalizeTeam(league, rawStanding.team),
    wins: toNumber(wins),
    losses: toNumber(losses),
    ties: toNumber(ties),
    pct,
    rank: toNumber(pick(rawStanding.rank, rawStanding.playoff_seed, rawStanding.seed)),
    conference: pick(rawStanding.team?.conference, rawStanding.team?.conference_name),
    division: pick(rawStanding.team?.division, rawStanding.team?.division_name),
    streak
  };
}

export class BallDontLieProvider extends BaseProvider {
  constructor({ apiKey, baseUrl }) {
    super('balldontlie');
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl || 'https://api.balldontlie.io').replace(/\/$/, '');
  }

  ensureConfigured() {
    if (!this.apiKey) {
      throw new HttpError(503, 'BALLDONTLIE is not configured. Set BALLDONTLIE_API_KEY.');
    }
  }

  resourceUrl(league, resource, resourceId = null, query = {}) {
    const basePath = LEAGUE_PATHS[league];
    if (!basePath) {
      throw new HttpError(400, `No BALLDONTLIE path is configured for ${league}`);
    }

    const url = new URL(`${this.baseUrl}${basePath}/${resource}${resourceId ? `/${resourceId}` : ''}`);
    const searchParams = url.searchParams;

    if (query.cursor) {
      searchParams.set('cursor', String(query.cursor));
    }

    if (query.limit) {
      searchParams.set('per_page', String(query.limit));
    }

    addArrayParams(searchParams, 'dates', query.dates || []);
    addArrayParams(searchParams, 'seasons', query.seasons || []);
    addArrayParams(searchParams, 'weeks', query.weeks || []);
    addArrayParams(searchParams, 'game_ids', query.gameIds || []);
    addArrayParams(searchParams, 'team_ids', query.teamIds || []);

    if (query.startDate) {
      searchParams.set('start_date', query.startDate);
    }

    if (query.endDate) {
      searchParams.set('end_date', query.endDate);
    }

    if (query.season !== undefined && query.season !== null) {
      searchParams.set('season', String(query.season));
    }

    if (query.conference) {
      searchParams.set('conference', query.conference);
    }

    if (query.division) {
      searchParams.set('division', query.division);
    }

    if (query.search) {
      searchParams.set('search', query.search);
    }

    if (query.postseason !== undefined && query.postseason !== null) {
      searchParams.set('postseason', String(query.postseason));
    }

    return url;
  }

  async fetchJson(url) {
    this.ensureConfigured();

    const response = await fetch(url, {
      headers: {
        Authorization: this.apiKey
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new HttpError(response.status, `BALLDONTLIE request failed: ${response.status} ${text}`);
    }

    return response.json();
  }

  async listGames({ league, date, season, week, team, status, cursor, limit = 25 }) {
    const query = {
      cursor,
      limit,
      dates: date ? [date] : [],
      seasons: season ? [season] : []
    };

    if ((league === 'NFL' || league === 'NCAAF') && week) {
      query.weeks = [week];
    }

    if (team && isNumeric(team)) {
      query.teamIds = [team];
    }

    const payload = await this.fetchJson(this.resourceUrl(league, 'games', null, query));
    let games = (payload.data || []).map((game) => normalizeGame(league, game));

    if (team && !isNumeric(team)) {
      const term = team.trim().toLowerCase();
      games = games.filter((game) => {
        const haystacks = [
          game.home_team.name,
          game.home_team.abbreviation,
          game.away_team.name,
          game.away_team.abbreviation
        ].filter(Boolean).map((value) => value.toLowerCase());
        return haystacks.some((value) => value.includes(term));
      });
    }

    if (status) {
      const normalizedStatus = String(status).toLowerCase();
      games = games.filter((game) => game.status.code === normalizedStatus);
    }

    return {
      data: games,
      meta: {
        cursor: cursor ? String(cursor) : null,
        next_cursor: payload.meta?.next_cursor !== undefined ? String(payload.meta.next_cursor) : null,
        per_page: payload.meta?.per_page ?? limit
      }
    };
  }

  async getGame({ league, gameId }) {
    const payload = await this.fetchJson(this.resourceUrl(league, 'games', gameId));
    if (!payload.data) {
      throw new HttpError(404, `Game ${gameId} not found`);
    }

    return {
      data: normalizeGame(league, payload.data)
    };
  }

  async listTeams({ league, search = '', limit = 50 }) {
    let cursor = null;
    let pages = 0;
    const teams = [];
    const fetchLimit = search ? 100 : Math.min(limit, 100);

    do {
      const payload = await this.fetchJson(this.resourceUrl(league, 'teams', null, {
        cursor,
        limit: fetchLimit
      }));

      const pageItems = (payload.data || []).map((team) => normalizeTeam(league, team));
      teams.push(...pageItems);
      cursor = payload.meta?.next_cursor ?? null;
      pages += 1;
    } while (cursor && (search ? pages < 10 : teams.length < limit) && pages < 10);

    const term = search.trim().toLowerCase();
    const filtered = term
      ? teams.filter((team) => {
        const haystack = [
          team.name,
          team.short_name,
          team.market,
          team.abbreviation
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(term);
      })
      : teams;

    return {
      data: filtered.slice(0, limit)
    };
  }

  async getStandings({ league, season, conference, division }) {
    const payload = await this.fetchJson(this.resourceUrl(league, 'standings', null, {
      season,
      limit: 100
    }));

    let data = (payload.data || []).map((standing) => normalizeStanding(league, standing));

    if (conference) {
      const term = String(conference).toLowerCase();
      data = data.filter((row) => String(row.conference || '').toLowerCase().includes(term));
    }

    if (division) {
      const term = String(division).toLowerCase();
      data = data.filter((row) => String(row.division || '').toLowerCase().includes(term));
    }

    return {
      data
    };
  }
}
