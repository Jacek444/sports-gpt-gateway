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
    throw new HttpError(500, 'SPORTSGAMEODDS_API_KEY is not configured on the server');
  }

  return providerConfig;
}

async function call(pathname, params = {}) {
  const providerConfig = requireApiKey();

  const url = new URL(pathname, providerConfig.baseUrl);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'x-api-key': providerConfig.apiKey
    }
  });

  const text = await response.text();
  let body;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new HttpError(502, 'SportsGameOdds request failed', {
      provider: 'sportsGameOdds',
      status: response.status,
      statusText: response.statusText,
      body
    });
  }

  return {
    provider: 'sportsGameOdds',
    data: body?.data ?? body,
    nextCursor: body?.nextCursor ?? null,
    quota: null
  };
}

export const sportsGameOddsProvider = {
  getSports(params = {}) {
    return call('/v2/sports', params);
  },

 getEvents(sport, params = {}) {
  return call('/v2/events', {
    leagueID: toLeagueID(sport),
    ...params
  });
},

 getEventOdds(sport, eventID, params = {}) {
  return call('/v2/events', {
    eventID,
    oddsAvailable: true,
    ...params
  });
},
  
getScores(sport, params = {}) {
  return call('/v2/events', {
    leagueID: toLeagueID(sport),
    ...params
  });
},
  
getOddsBoard(sport, params = {}) {
  return call('/v2/events', {
    leagueID: toLeagueID(sport),
    oddsAvailable: true,
    ...params
  });
}
};
