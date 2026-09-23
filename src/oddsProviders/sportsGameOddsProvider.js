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
    SharpBet uses common date names.

    SportsGameOdds uses startsAfter / startsBefore.
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
    Translate bookmaker filtering when supplied.
  */
  if (params.bookmakers) {
    cleaned.bookmakerID =
      params.bookmakers;
  }

  delete cleaned.commenceTimeFrom;
  delete cleaned.commenceTimeTo;
  delete cleaned.bookmakers;

  /*
    Parameters used by our other odds providers that should
    not be forwarded directly to SportsGameOdds.
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

  /*
    SharpBet's generic market name is translated into
    SportsGameOdds oddIDs below.
  */
  delete cleaned.markets;

  return cleaned;
}

function normalizeRequestedMarkets(markets) {
  if (!markets) {
    return [];
  }

  return String(markets)
    .split(',')
    .map((value) =>
      value
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
    )
    .filter(Boolean);
}

function buildMarketTranslation(markets) {
  const requested =
    normalizeRequestedMarkets(
      markets
    );

  if (requested.length === 0) {
    return null;
  }

  const oddIDs = [];
  let includeAltLines = false;

  function add(oddID) {
    if (
      oddID &&
      !oddIDs.includes(oddID)
    ) {
      oddIDs.push(oddID);
    }
  }

  for (const market of requested) {
    /*
      FULL GAME CORE MARKETS
    */

    if (
      [
        'h2h',
        'moneyline',
        'money_line',
        'ml'
      ].includes(market)
    ) {
      add(
        'points-home-game-ml-home'
      );
      continue;
    }

    if (
      [
        'spreads',
        'spread',
        'runline',
        'run_line',
        'puckline',
        'puck_line'
      ].includes(market)
    ) {
      add(
        'points-home-game-sp-home'
      );
      continue;
    }

    if (
      [
        'totals',
        'total',
        'overunder',
        'over_under',
        'game_total'
      ].includes(market)
    ) {
      add(
        'points-all-game-ou-over'
      );
      continue;
    }

    /*
      TEAM TOTALS
    */

    if (
      [
        'team_totals',
        'team_total',
        'team_runs',
        'team_runs_total'
      ].includes(market)
    ) {
      add(
        'points-home-game-ou-over'
      );

      add(
        'points-away-game-ou-over'
      );

      continue;
    }

    /*
      MLB FIRST INNING / NRFI / YRFI
    */

    if (
      [
        'nrfi',
        'yrfi',
        'first_inning_run',
        'first_inning_runs',
        'first_inning_yes_no'
      ].includes(market)
    ) {
      add(
        'points-all-1i-yn-yes'
      );

      continue;
    }

    if (
      [
        'first_inning_total',
        '1st_inning_total',
        'first_inning_over_under'
      ].includes(market)
    ) {
      add(
        'points-all-1i-ou-over'
      );

      continue;
    }

    /*
      MLB F3
    */

    if (
      [
        'f3',
        'first_3',
        'first_3_innings',
        'f3_moneyline'
      ].includes(market)
    ) {
      add(
        'points-home-1ix3-ml-home'
      );

      continue;
    }

    if (
      [
        'f3_spread',
        'f3_run_line'
      ].includes(market)
    ) {
      add(
        'points-home-1ix3-sp-home'
      );

      continue;
    }

    if (
      [
        'f3_total',
        'first_3_total'
      ].includes(market)
    ) {
      add(
        'points-all-1ix3-ou-over'
      );

      continue;
    }

    /*
      MLB F5

      SportsGameOdds documentation recommends 1h as the
      newer Baseball first-five / first-half period code.
    */

    if (
      [
        'f5',
        'first_5',
        'first_5_innings',
        'f5_moneyline'
      ].includes(market)
    ) {
      add(
        'points-home-1h-ml-home'
      );

      continue;
    }

    if (
      [
        'f5_spread',
        'f5_run_line'
      ].includes(market)
    ) {
      add(
        'points-home-1h-sp-home'
      );

      continue;
    }

    if (
      [
        'f5_total',
        'first_5_total'
      ].includes(market)
    ) {
      add(
        'points-all-1h-ou-over'
      );

      continue;
    }

    /*
      MLB F7
    */

    if (
      [
        'f7',
        'first_7',
        'first_7_innings',
        'f7_moneyline'
      ].includes(market)
    ) {
      add(
        'points-home-1ix7-ml-home'
      );

      continue;
    }

    if (
      [
        'f7_spread',
        'f7_run_line'
      ].includes(market)
    ) {
      add(
        'points-home-1ix7-sp-home'
      );

      continue;
    }

    if (
      [
        'f7_total',
        'first_7_total'
      ].includes(market)
    ) {
      add(
        'points-all-1ix7-ou-over'
      );

      continue;
    }

    /*
      MLB BATTER PROPS

      PLAYER_ID is a SportsGameOdds wildcard that requests
      this particular market across all players.
    */

    if (
      [
        'player_hits',
        'batter_hits',
        'hits'
      ].includes(market)
    ) {
      add(
        'batting_hits-PLAYER_ID-game-ou-over'
      );

      continue;
    }

    if (
      [
        'player_total_bases',
        'total_bases',
        'batter_total_bases'
      ].includes(market)
    ) {
      add(
        'batting_totalBases-PLAYER_ID-game-ou-over'
      );

      continue;
    }

    /*
      MLB PITCHER PROPS
    */

    if (
      [
        'player_strikeouts',
        'pitcher_strikeouts',
        'strikeouts'
      ].includes(market)
    ) {
      add(
        'pitching_strikeouts-PLAYER_ID-game-ou-over'
      );

      continue;
    }

    if (
      [
        'pitcher_hits_allowed',
        'hits_allowed'
      ].includes(market)
    ) {
      add(
        'pitching_hits-PLAYER_ID-game-ou-over'
      );

      continue;
    }

    if (
      [
        'pitcher_earned_runs',
        'earned_runs_allowed'
      ].includes(market)
    ) {
      add(
        'pitching_earnedRuns-PLAYER_ID-game-ou-over'
      );

      continue;
    }

    /*
      ALTERNATE MARKETS

      SportsGameOdds attaches alternate lines to the
      underlying spread or total market.
    */

    if (
      [
        'alternate_spreads',
        'alternate_spread',
        'alt_spreads',
        'alt_spread'
      ].includes(market)
    ) {
      add(
        'points-home-game-sp-home'
      );

      includeAltLines = true;
      continue;
    }

    if (
      [
        'alternate_totals',
        'alternate_total',
        'alt_totals',
        'alt_total'
      ].includes(market)
    ) {
      add(
        'points-all-game-ou-over'
      );

      includeAltLines = true;
      continue;
    }
  }

  if (oddIDs.length === 0) {
    return null;
  }

  return {
    oddIDs:
      oddIDs.join(','),

    includeOpposingOddIDs:
      true,

    ...(includeAltLines
      ? {
          includeAltLines: true
        }
      : {})
  };
}

function sportsGameOddsMarketParams(
  params = {}
) {
  return (
    buildMarketTranslation(
      params.markets
    ) || {}
  );
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
      () =>
        controller.abort(),
      config.oddsRequestTimeoutMs
    );

  let response;

  try {
    response =
      await fetch(
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
      cleanSharedParams(
        params
      )
    );
  },

  async getOddsBoard(
    sport,
    params = {}
  ) {
    const leagueID =
      leagueForSport(
        sport
      );

    return callSportsGameOdds(
      '/v2/events',
      {
        leagueID,

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
  },

  async getScores(
    sport,
    params = {}
  ) {
    const leagueID =
      leagueForSport(
        sport
      );

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
      leagueForSport(
        sport
      );

    return callSportsGameOdds(
      '/v2/events',
      {
        leagueID,

        limit:
          100,

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
      leagueForSport(
        sport
      );

    const translatedMarkets =
      sportsGameOddsMarketParams(
        params
      );

    /*
      Important safety behavior:

      Do NOT silently request the entire SportsGameOdds
      event when SharpBet requested a market that we do
      not yet know how to translate. Full event payloads
      can be extremely large.

      Instead, return an explicit error. The gateway can
      then try another configured provider when appropriate,
      or SharpBet can request a supported market.
    */
    if (
      params.markets &&
      Object.keys(
        translatedMarkets
      ).length === 0
    ) {
      throw new HttpError(
        400,
        `SportsGameOdds market "${params.markets}" is not yet mapped by the SharpBet adapter`,
        {
          provider:
            'sportsGameOdds',

          markets:
            params.markets
        }
      );
    }

    return callSportsGameOdds(
      '/v2/events',
      {
        leagueID,

        eventID:
          eventId,

        oddsAvailable:
          true,

        ...translatedMarkets,

        ...cleanSharedParams(
          params
        )
      }
    );
  }
};
