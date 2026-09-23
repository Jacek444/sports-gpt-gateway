import { config } from '../config.js';
import { HttpError } from '../errors.js';

const LEAGUE_MAP = {
  basketball_nba: 'NBA',
  americanfootball_nfl: 'NFL',
  baseball_mlb: 'MLB',
  icehockey_nhl: 'NHL',
  basketball_ncaab: 'NCAAB',
  americanfootball_ncaaf: 'NCAAF'
};

function toLeagueID(sport) {
  return LEAGUE_MAP[sport] || sport;
}

function requireApiKey() {
  const providerConfig = config.oddsProviders.sportsGameOdds;

  if (!providerConfig.enabled) {
    throw new HttpError(503, 'SportsGameOdds provider is disabled');
  }

  if (!providerConfig.apiKey) {
    throw new HttpError(
      500,
      'SPORTSGAMEODDS_API_KEY is not configured on the server'
    );
  }

  return providerConfig;
}

function addParams(url, params = {}) {
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
}

function cleanSharedParams(params = {}) {
  const {
    regions,
    oddsFormat,
    dateFormat,
    includeLinks,
    includeSids,
    includeBetLimits,
    includeRotationNumbers,
    includeMultipliers,
    eventIds,
    daysFrom,
    ...rest
  } = params;

  return rest;
}

async function call(pathname, params = {}) {
  const providerConfig = requireApiKey();

  const url = new URL(pathname, providerConfig.baseUrl);

  addParams(url, params);

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    config.oddsRequestTimeoutMs
  );

  let response;

  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'x-api-key': providerConfig.apiKey
      },
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeout);

    throw new HttpError(
      502,
      'SportsGameOdds request failed',
      {
        provider: 'sportsGameOdds',
        status: 0,
        upstreamStatus: 0,
        body: error?.message || String(error)
      }
    );
  }

  clearTimeout(timeout);

  const text = await response.text();

  let body;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new HttpError(
      502,
      'SportsGameOdds request failed',
      {
        provider: 'sportsGameOdds',
        status: response.status,
        upstreamStatus: response.status,
        statusText: response.statusText,
        retryAfter: response.headers.get('retry-after'),
        body
      }
    );
  }

  return {
    provider: 'sportsGameOdds',
    data: body?.data ?? body,
    nextCursor:
      body?.nextCursor ??
      body?.next_cursor ??
      null,
    quota: null
  };
}

export const sportsGameOddsProvider = {
  getSports(params = {}) {
    return call('/v2/sports', cleanSharedParams(params));
  },

  getOddsBoard(sport, params = {}) {
    const cleaned = cleanSharedParams(params);

    return call('/v2/events', {
      leagueID: toLeagueID(sport),
      oddsAvailable: true,
      ...cleaned
    });
  },

  getScores(sport, params = {}) {
    const cleaned = cleanSharedParams(params);

    return call('/v2/events', {
      leagueID: toLeagueID(sport),
      ...cleaned
    });
  },

  getEvents(sport, params = {}) {
    const cleaned = cleanSharedParams(params);

    return call('/v2/events', {
      leagueID: toLeagueID(sport),
      ...cleaned
    });
  },

  getEventOdds(sport, eventId, params = {}) {
    const cleaned = cleanSharedParams(params);

    return call('/v2/events', {
      eventID: eventId,
      oddsAvailable: true,
      ...cleaned
    });
  }
};
