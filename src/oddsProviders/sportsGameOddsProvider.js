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

  /*
    SharpBet uses The Odds API style names internally.

    SportsGameOdds uses:
      commenceTimeFrom -> startsAfter
      commenceTimeTo   -> startsBefore
  */
  if (params.commenceTimeFrom) {
    cleaned.startsAfter =
      params.commenceTimeFrom;
  }

  if (params.commenceTimeTo) {
    cleaned.startsBefore =
      params.commenceTimeTo;
  }

  /*
    Remove the original names so SportsGameOdds does not
    receive unsupported query parameters.
  */
  delete cleaned.commenceTimeFrom;
  delete cleaned.commenceTimeTo;

  /*
    These parameters belong to other provider APIs and
    should not be forwarded directly to SportsGameOdds.
  */
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

  return cleaned;
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
        ...cleanSharedParams(
          params
        )
      }
    );
  }
};
