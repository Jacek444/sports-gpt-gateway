import { config } from '../config.js';
import { HttpError } from '../errors.js';
import {
  addQueryParams,
  fetchJson
} from './providerUtils.js';

const LEAGUE_MAP = {
  basketball_nba: 'NBA',
  americanfootball_nfl: 'NFL',
  baseball_mlb: 'MLB',
  icehockey_nhl: 'NHL',
  basketball_ncaab: 'NCAAB',
  americanfootball_ncaaf: 'NCAAF'
};

const CORE_MARKET_ODD_IDS = {
  h2h: [
    'points-home-game-ml-home',
    'points-away-game-ml-away'
  ],
  spreads: [
    'points-home-game-sp-home',
    'points-away-game-sp-away'
  ],
  totals: [
    'points-all-game-ou-over',
    'points-all-game-ou-under'
  ]
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

function marketParams(markets) {
  if (!markets) {
    return {};
  }

  const requested = String(markets)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const allCore = requested.every((market) =>
    Object.prototype.hasOwnProperty.call(CORE_MARKET_ODD_IDS, market)
  );

  // SportsGameOdds uses oddID rather than The-Odds-API market names.
  // If a prop/derivative market is requested, do not guess at a mapping:
  // fetch the event odds payload and let the caller inspect the provider data.
  if (!allCore) {
    return {};
  }

  const oddID = [
    ...new Set(
      requested.flatMap((market) => CORE_MARKET_ODD_IDS[market])
    )
  ].join(',');

  return {
    oddID,
    includeOpposingOdds: true
  };
}

function commonEventParams(params = {}) {
  return {
    eventIDs: params.eventIds,
    startsAfter: params.commenceTimeFrom,
    startsBefore: params.commenceTimeTo,
    bookmakerID: params.bookmakers,
    includeAltLines: params.includeAltLines,
    cursor: params.cursor,
    limit: params.limit,
    ...marketParams(params.markets)
  };
}

async function call(pathname, params = {}) {
  const providerConfig = requireApiKey();

  const url = new URL(pathname, providerConfig.baseUrl);
  addQueryParams(url, params);

  const { body } = await fetchJson({
    provider: 'sportsGameOdds',
    url,
    headers: {
      Accept: 'application/json',
      'x-api-key': providerConfig.apiKey
    },
    timeoutMs: config.oddsRequestTimeoutMs
  });

  return {
    provider: 'sportsGameOdds',
    data: body?.data ?? body,
    nextCursor: body?.nextCursor ?? null,
    notice: body?.notice ?? null,
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
      ...commonEventParams(params),
      limit: params.limit || 50
    });
  },

  getEventOdds(sport, eventId, params = {}) {
    return call('/v2/events', {
      eventID: eventId,
      oddsAvailable: true,
      bookmakerID: params.bookmakers,
      includeAltLines: params.includeAltLines,
      ...marketParams(params.markets)
    });
  },

  getScores(sport, params = {}) {
    const daysFrom = Number(params.daysFrom || 1);
    const now = Date.now();
    const startsAfter = new Date(
      now - Math.max(1, daysFrom) * 24 * 60 * 60 * 1000
    ).toISOString();
    const startsBefore = new Date(
      now + 24 * 60 * 60 * 1000
    ).toISOString();

    return call('/v2/events', {
      leagueID: toLeagueID(sport),
      eventIDs: params.eventIds,
      startsAfter,
      startsBefore,
      limit: params.limit || 100
    });
  },

  getOddsBoard(sport, params = {}) {
    return call('/v2/events', {
      leagueID: toLeagueID(sport),
      oddsAvailable: true,
      ...commonEventParams(params),
      limit: params.limit || 50
    });
  },

  getUsage() {
    return call('/v2/account/usage');
  }
};
