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

function requireConfig() {
  const providerConfig =
    config.oddsProviders.sportsGameOdds;

  if (
    !providerConfig?.enabled ||
    !providerConfig?.apiKey
  ) {
    throw new HttpError(
      503,
      'SportsGameOdds is not configured'
    );
  }

  return providerConfig;
}

function addParams(url, params = {}) {
  for (const [key, value] of Object.entries(params)) {
    if (
      value === undefined ||
      value === null ||
      value === ''
    ) {
      continue;
    }

    url.searchParams.set(
      key,
      String(value)
    );
  }

  return url;
}

function cleanSharedParams(params = {}) {
  const cleaned = {
    ...params
  };

  if (params.commenceTimeFrom) {
    cleaned.startsAfter =
      params.commenceTimeFrom;
  }

  if (params.commenceTimeTo) {
    cleaned.startsBefore =
      params.commenceTimeTo;
  }

  delete cleaned.commenceTimeFrom;
  delete cleaned.commenceTimeTo;

  delete cleaned.regions;
  delete cleaned.oddsFormat;
  delete cleaned.dateFormat;
  delete cleaned.includeLinks;
  delete cleaned.includeSids;
  delete cleaned.includeBetLimits;
  delete cleaned.includeRotationNumbers;
  delete cleaned.includeMultipliers;
  delete cleaned.eventIds;
  delete cleaned.daysFrom;

  /*
    "markets" is a SharpBet/The Odds API style parameter.
    SportsGameOdds uses oddID instead, so we translate it
    separately before calling the upstream API.
  */
  delete cleaned.markets;

  return cleaned;
}

function translateBaseMarkets(markets) {
  if (!markets) {
    return null;
  }

  const requested =
    String(markets)
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

  const oddIds = [];

  /*
    We only need one side of each paired market because
    includeOpposingOdds=true will fetch the opposite side.
  */

  if (
    requested.includes('h2h') ||
    requested.includes('moneyline') ||
    requested.includes('ml')
  ) {
    oddIds.push(
      'points-home-game-ml-home'
    );
  }

  if (
    requested.includes('spreads') ||
    requested.includes('spread') ||
    requested.includes('runline') ||
    requested.includes('run_line') ||
    requested.includes('puckline') ||
    requested.includes('puck_line')
  ) {
    oddIds.push(
      'points-home-game-sp-home'
    );
  }

  if (
    requested.includes('totals') ||
    requested.includes('total') ||
    requested.includes('overunder') ||
    requested.includes('over_under')
  ) {
    oddIds.push(
      'points-all-game-ou-over'
    );
  }

  if (oddIds.length === 0) {
    return null;
  }

  return oddIds.join(',');
}

function sportsGameOddsMarketParams(params = {}) {
  const oddID =
    translateBaseMarkets(
      params.markets
    );

  if (!oddID) {
    return {};
  }

  return {
    oddID,
    includeOpposingOdds: true
  };
}

async function callSportsGameOdds(
  path,
  params = {}
) {
  const providerConfig =
    requireConfig();

  const url = new URL(
    path,
    providerConfig.baseUrl
  );

  addParams(
    url,
    params
  );

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      config.oddsRequestTimeoutMs
    );

  let response;

  try {
    response = await fetch(
      url,
      {
        headers: {
          'x-api-key':
            providerConfig.apiKey,
          accept:
            'application/json'
        },

        signal:
          controller.signal
      }
    );
  } catch (error) {
    if (
      error?.name ===
      'AbortError'
    ) {
      throw new HttpError(
        504,
        'SportsGameOdds request timed out',
        {
          provider:
            'sportsGameOdds'
        }
      );
    }

    throw new HttpError(
      502,
      'SportsGameOdds request failed',
      {
        provider:
          'sportsGameOdds',
        cause:
          error?.message ||
          String(error)
      }
    );
  } finally {
    clearTimeout(timeout);
  }

  let body = null;

  try {
    body =
      await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new HttpError(
      502,
      'SportsGameOdds upstream request failed',
      {
        provider:
          'sportsGameOdds',

        status:
          response.status,

        upstreamStatus:
          response.status,

        retryAfter:
          response.headers.get(
            'retry-after'
          ),

        body
      }
    );
  }

  return {
    provider:
      'sportsGameOdds',

    data:
      body?.data ??
      body ??
      [],

    nextCursor:
      body?.nextCursor ??
      null,

    quota:
      null
  };
}

function leagueForSport(sport) {
  const league =
    LEAGUE_MAP[sport];

  if (!league) {
    throw new HttpError(
      400,
      `SportsGameOdds does not have a league mapping for "${sport}"`
    );
  }

  return league;
}

export const sportsGameOddsProvider = {
  name:
    'sportsGameOdds',

  async getSports(params = {}) {
    return callSportsGameOdds(
      '/v2/sports',
      cleanSharedParams(params)
    );
  },

  async getOddsBoard(
    sport,
    params = {}
  ) {
    const leagueID =
      leagueForSport(sport);

    return callSportsGameOdds(
      '/v2/events',
      {
        leagueID,
        oddsAvailable: true,
        ...sportsGameOddsMarketParams(
          params
        ),
        ...cleanSharedParams(
          params
        )
      }
    );
  },

  async getScores(
    sport,
    params = {}
  ) {
    const leagueID =
      leagueForSport(sport);

    return callSportsGameOdds(
      '/v2/events',
      {
        leagueID,
        ...cleanSharedParams(
          params
        )
      }
    );
  },

  async getEvents(
    sport,
    params = {}
  ) {
    const leagueID =
      leagueForSport(sport);

    return callSportsGameOdds(
      '/v2/events',
      {
        leagueID,
        limit: 100,
        ...cleanSharedParams(
          params
        )
      }
    );
  },

  async getEventOdds(
    sport,
    eventId,
    params = {}
  ) {
    const leagueID =
      leagueForSport(sport);

    return callSportsGameOdds(
      '/v2/events',
      {
        leagueID,
        eventID:
          eventId,
        oddsAvailable:
          true,
        ...sportsGameOddsMarketParams(
          params
        ),
        ...cleanSharedParams(
          params
        )
      }
    );
  }
};
