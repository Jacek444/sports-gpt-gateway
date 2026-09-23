import { config } from '../config.js';
import { HttpError } from '../errors.js';

/*
  SharpBet -> SportsGameOdds league mapping
*/
const SPORT_CONFIG = {
  basketball_nba: {
    leagueID: 'NBA',
    family: 'basketball'
  },

  basketball_ncaab: {
    leagueID: 'NCAAB',
    family: 'basketball'
  },

  americanfootball_nfl: {
    leagueID: 'NFL',
    family: 'football'
  },

  americanfootball_ncaaf: {
    leagueID: 'NCAAF',
    family: 'football'
  },

  baseball_mlb: {
    leagueID: 'MLB',
    family: 'baseball'
  },

  icehockey_nhl: {
    leagueID: 'NHL',
    family: 'hockey'
  }
};

/*
  Player prop stat IDs.

  Each entry is converted into a SportsGameOdds oddID:

  {statID}-PLAYER_ID-game-ou-over

  includeOpposingOdds=true then automatically returns
  the under side too.

  Special markets such as anytime TD use their own
  bet type / side configuration.
*/
const PLAYER_PROP_MAP = {
  basketball: {
    player_points: {
      statID: 'points'
    },

    points: {
      statID: 'points'
    },

    player_rebounds: {
      statID: 'rebounds'
    },

    rebounds: {
      statID: 'rebounds'
    },

    player_assists: {
      statID: 'assists'
    },

    assists: {
      statID: 'assists'
    },

    player_threes: {
      statID: 'threePointersMade'
    },

    player_three_pointers: {
      statID: 'threePointersMade'
    },

    threes: {
      statID: 'threePointersMade'
    },

    player_steals: {
      statID: 'steals'
    },

    steals: {
      statID: 'steals'
    },

    player_blocks: {
      statID: 'blocks'
    },

    blocks: {
      statID: 'blocks'
    },

    player_pra: {
      statID: 'points+rebounds+assists'
    },

    pra: {
      statID: 'points+rebounds+assists'
    },

    player_points_assists: {
      statID: 'points+assists'
    },

    points_assists: {
      statID: 'points+assists'
    },

    player_points_rebounds: {
      statID: 'points+rebounds'
    },

    points_rebounds: {
      statID: 'points+rebounds'
    },

    player_rebounds_assists: {
      statID: 'rebounds+assists'
    },

    rebounds_assists: {
      statID: 'rebounds+assists'
    },

    player_turnovers: {
      statID: 'turnovers'
    },

    turnovers: {
      statID: 'turnovers'
    }
  },

  football: {
    passing_yards: {
      statID: 'passing_yards'
    },

    player_passing_yards: {
      statID: 'passing_yards'
    },

    passing_touchdowns: {
      statID: 'passing_touchdowns'
    },

    passing_tds: {
      statID: 'passing_touchdowns'
    },

    player_passing_touchdowns: {
      statID: 'passing_touchdowns'
    },

    passing_completions: {
      statID: 'passing_completions'
    },

    player_completions: {
      statID: 'passing_completions'
    },

    passing_attempts: {
      statID: 'passing_attempts'
    },

    player_passing_attempts: {
      statID: 'passing_attempts'
    },

    passing_interceptions: {
      statID: 'passing_interceptions'
    },

    interceptions_thrown: {
      statID: 'passing_interceptions'
    },

    player_interceptions: {
      statID: 'passing_interceptions'
    },

    rushing_yards: {
      statID: 'rushing_yards'
    },

    player_rushing_yards: {
      statID: 'rushing_yards'
    },

    rushing_attempts: {
      statID: 'rushing_attempts'
    },

    player_rushing_attempts: {
      statID: 'rushing_attempts'
    },

    rushing_touchdowns: {
      statID: 'rushing_touchdowns'
    },

    rushing_tds: {
      statID: 'rushing_touchdowns'
    },

    receiving_yards: {
      statID: 'receiving_yards'
    },

    player_receiving_yards: {
      statID: 'receiving_yards'
    },

    receptions: {
      statID: 'receiving_receptions'
    },

    player_receptions: {
      statID: 'receiving_receptions'
    },

    receiving_targets: {
      statID: 'receiving_targets'
    },

    targets: {
      statID: 'receiving_targets'
    },

    receiving_touchdowns: {
      statID: 'receiving_touchdowns'
    },

    receiving_tds: {
      statID: 'receiving_touchdowns'
    },

    rushing_receiving_yards: {
      statID: 'rushing+receiving_yards'
    },

    passing_rushing_yards: {
      statID: 'passing+rushing_yards'
    },

    anytime_td: {
      statID: 'touchdowns',
      betTypeID: 'yn',
      sideID: 'yes'
    },

    anytime_touchdown: {
      statID: 'touchdowns',
      betTypeID: 'yn',
      sideID: 'yes'
    },

    player_tackles: {
      statID: 'defense_tackles'
    },

    tackles: {
      statID: 'defense_tackles'
    },

    player_sacks: {
      statID: 'defense_sacks'
    },

    sacks: {
      statID: 'defense_sacks'
    },

    field_goals_made: {
      statID: 'fieldGoals_made'
    }
  },

  baseball: {
    player_hits: {
      statID: 'batting_hits'
    },

    batter_hits: {
      statID: 'batting_hits'
    },

    hits: {
      statID: 'batting_hits'
    },

    player_total_bases: {
      statID: 'batting_totalBases'
    },

    batter_total_bases: {
      statID: 'batting_totalBases'
    },

    total_bases: {
      statID: 'batting_totalBases'
    },

    player_home_runs: {
      statID: 'batting_homeRuns'
    },

    batter_home_runs: {
      statID: 'batting_homeRuns'
    },

    home_runs: {
      statID: 'batting_homeRuns'
    },

    player_rbis: {
      statID: 'batting_RBI'
    },

    batter_rbis: {
      statID: 'batting_RBI'
    },

    rbis: {
      statID: 'batting_RBI'
    },

    player_stolen_bases: {
      statID: 'batting_stolenBases'
    },

    stolen_bases: {
      statID: 'batting_stolenBases'
    },

    batter_strikeouts: {
      statID: 'batting_strikeouts'
    },

    player_batter_strikeouts: {
      statID: 'batting_strikeouts'
    },

    hits_runs_rbis: {
      statID: 'batting_hits+runs+rbi'
    },

    runs_rbis: {
      statID: 'batting_runs+rbi'
    },

    pitcher_strikeouts: {
      statID: 'pitching_strikeouts'
    },

    player_strikeouts: {
      statID: 'pitching_strikeouts'
    },

    pitching_strikeouts: {
      statID: 'pitching_strikeouts'
    },

    pitcher_outs: {
      statID: 'pitching_outs'
    },

    pitcher_outs_recorded: {
      statID: 'pitching_outs'
    },

    outs_recorded: {
      statID: 'pitching_outs'
    },

    pitcher_hits_allowed: {
      statID: 'pitching_hits'
    },

    hits_allowed: {
      statID: 'pitching_hits'
    },

    pitcher_earned_runs: {
      statID: 'pitching_earnedRuns'
    },

    earned_runs_allowed: {
      statID: 'pitching_earnedRuns'
    },

    pitcher_walks: {
      statID: 'pitching_basesOnBalls'
    },

    pitcher_walks_allowed: {
      statID: 'pitching_basesOnBalls'
    },

    pitcher_innings: {
      statID: 'pitching_inningsPitched'
    },

    innings_pitched: {
      statID: 'pitching_inningsPitched'
    }
  },

  hockey: {
    player_shots_on_goal: {
      statID: 'shots_onGoal'
    },

    shots_on_goal: {
      statID: 'shots_onGoal'
    },

    sog: {
      statID: 'shots_onGoal'
    },

    player_points: {
      statID: 'goals+assists'
    },

    hockey_points: {
      statID: 'goals+assists'
    },

    player_assists: {
      statID: 'assists'
    },

    assists: {
      statID: 'assists'
    },

    player_goals: {
      statID: 'points'
    },

    goals: {
      statID: 'points'
    },

    player_hits: {
      statID: 'hits'
    },

    hits: {
      statID: 'hits'
    },

    player_blocks: {
      statID: 'blocks'
    },

    blocked_shots: {
      statID: 'blocks'
    },

    goalie_saves: {
      statID: 'goalie_saves'
    },

    saves: {
      statID: 'goalie_saves'
    },

    goalie_goals_against: {
      statID: 'goalie_goalsAgainst'
    },

    goalie_shots_against: {
      statID: 'goalie_shotsAgainst'
    }
  }
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

function sportConfig(sport) {
  const value =
    SPORT_CONFIG[sport];

  if (!value) {
    throw new HttpError(
      400,
      `SportsGameOdds does not have a mapping for "${sport}"`
    );
  }

  return value;
}

function addParams(url, params = {}) {
  for (
    const [key, value]
    of Object.entries(params)
  ) {
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

function normalizeMarketName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function normalizeRequestedMarkets(markets) {
  if (!markets) {
    return [];
  }

  return String(markets)
    .split(',')
    .map(normalizeMarketName)
    .filter(Boolean);
}

function cleanSharedParams(params = {}) {
  const cleaned = {
    ...params
  };

  /*
    Standard SharpBet date parameters ->
    SportsGameOdds parameters.
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
    Standard SharpBet bookmaker filter ->
    SportsGameOdds bookmakerID.
  */
  if (params.bookmakers) {
    cleaned.bookmakerID =
      params.bookmakers;
  }

  delete cleaned.commenceTimeFrom;
  delete cleaned.commenceTimeTo;
  delete cleaned.bookmakers;

  /*
    These belong to our other upstream providers.
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
    Generic SharpBet market names are translated separately.
  */
  delete cleaned.markets;

  return cleaned;
}

function pushUnique(array, value) {
  if (
    value &&
    !array.includes(value)
  ) {
    array.push(value);
  }
}

/*
  Team / game market helpers
*/

function addMoneyline(
  oddIDs,
  period = 'game'
) {
  pushUnique(
    oddIDs,
    `points-home-${period}-ml-home`
  );
}

function addSpread(
  oddIDs,
  period = 'game'
) {
  pushUnique(
    oddIDs,
    `points-home-${period}-sp-home`
  );
}

function addTotal(
  oddIDs,
  period = 'game'
) {
  pushUnique(
    oddIDs,
    `points-all-${period}-ou-over`
  );
}

function addTeamTotals(
  oddIDs,
  period = 'game'
) {
  pushUnique(
    oddIDs,
    `points-home-${period}-ou-over`
  );

  pushUnique(
    oddIDs,
    `points-away-${period}-ou-over`
  );
}

function addStandardPeriodMarkets(
  oddIDs,
  market,
  period,
  prefix
) {
  if (
    market === `${prefix}_moneyline` ||
    market === `${prefix}_ml`
  ) {
    addMoneyline(
      oddIDs,
      period
    );

    return true;
  }

  if (
    market === `${prefix}_spread` ||
    market === `${prefix}_spreads`
  ) {
    addSpread(
      oddIDs,
      period
    );

    return true;
  }

  if (
    market === `${prefix}_total` ||
    market === `${prefix}_totals`
  ) {
    addTotal(
      oddIDs,
      period
    );

    return true;
  }

  if (
    market === `${prefix}_team_total` ||
    market === `${prefix}_team_totals`
  ) {
    addTeamTotals(
      oddIDs,
      period
    );

    return true;
  }

  return false;
}

function addPlayerProp(
  oddIDs,
  definition
) {
  const periodID =
    definition.periodID ||
    'game';

  const betTypeID =
    definition.betTypeID ||
    'ou';

  const sideID =
    definition.sideID ||
    (
      betTypeID === 'yn'
        ? 'yes'
        : 'over'
    );

  pushUnique(
    oddIDs,
    `${definition.statID}-PLAYER_ID-${periodID}-${betTypeID}-${sideID}`
  );
}

function buildMarketTranslation(
  sport,
  markets
) {
  const requested =
    normalizeRequestedMarkets(
      markets
    );

  const {
    family
  } =
    sportConfig(sport);

  /*
    If no market was supplied for an odds request,
    default to the three core markets instead of
    accidentally requesting the complete event tree.
  */
  const marketsToUse =
    requested.length > 0
      ? requested
      : [
          'h2h',
          'spreads',
          'totals'
        ];

  const oddIDs = [];

  let includeAltLines = false;

  const unmapped = [];

  for (
    const market
    of marketsToUse
  ) {
    /*
      Escape hatch for future/new SportsGameOdds markets.

      Example:
      oddid:some-stat-PLAYER_ID-game-ou-over

      SharpBet normally won't need to use this directly,
      but it prevents us from having to rewrite the adapter
      immediately when SportsGameOdds adds a new market.
    */
    if (
      market.startsWith('oddid:')
    ) {
      const rawOddID =
        market.slice(
          'oddid:'.length
        );

      pushUnique(
        oddIDs,
        rawOddID
      );

      continue;
    }

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
      addMoneyline(
        oddIDs
      );

      continue;
    }

    if (
      [
        'spreads',
        'spread',
        'run_line',
        'runline',
        'puck_line',
        'puckline'
      ].includes(market)
    ) {
      addSpread(
        oddIDs
      );

      continue;
    }

    if (
      [
        'totals',
        'total',
        'game_total',
        'over_under',
        'overunder'
      ].includes(market)
    ) {
      addTotal(
        oddIDs
      );

      continue;
    }

    if (
      [
        'team_total',
        'team_totals',
        'team_points',
        'team_runs',
        'team_goals'
      ].includes(market)
    ) {
      addTeamTotals(
        oddIDs
      );

      continue;
    }

    /*
      ALT LINES
    */

    if (
      [
        'alternate_spread',
        'alternate_spreads',
        'alt_spread',
        'alt_spreads',
        'alternate_run_line',
        'alternate_puck_line'
      ].includes(market)
    ) {
      addSpread(
        oddIDs
      );

      includeAltLines = true;

      continue;
    }

    if (
      [
        'alternate_total',
        'alternate_totals',
        'alt_total',
        'alt_totals'
      ].includes(market)
    ) {
      addTotal(
        oddIDs
      );

      includeAltLines = true;

      continue;
    }

    /*
      BASKETBALL / FOOTBALL HALVES & QUARTERS
    */

    if (
      family === 'basketball' ||
      family === 'football'
    ) {
      if (
        addStandardPeriodMarkets(
          oddIDs,
          market,
          '1h',
          'first_half'
        )
      ) {
        continue;
      }

      if (
        addStandardPeriodMarkets(
          oddIDs,
          market,
          '1h',
          '1h'
        )
      ) {
        continue;
      }

      if (
        addStandardPeriodMarkets(
          oddIDs,
          market,
          '2h',
          'second_half'
        )
      ) {
        continue;
      }

      if (
        addStandardPeriodMarkets(
          oddIDs,
          market,
          '2h',
          '2h'
        )
      ) {
        continue;
      }

      let handledQuarter =
        false;

      for (
        const [
          period,
          names
        ]
        of [
          [
            '1q',
            [
              'first_quarter',
              '1q'
            ]
          ],
          [
            '2q',
            [
              'second_quarter',
              '2q'
            ]
          ],
          [
            '3q',
            [
              'third_quarter',
              '3q'
            ]
          ],
          [
            '4q',
            [
              'fourth_quarter',
              '4q'
            ]
          ]
        ]
      ) {
        for (
          const prefix
          of names
        ) {
          if (
            addStandardPeriodMarkets(
              oddIDs,
              market,
              period,
              prefix
            )
          ) {
            handledQuarter =
              true;

            break;
          }
        }

        if (
          handledQuarter
        ) {
          break;
        }
      }

      if (
        handledQuarter
      ) {
        continue;
      }
    }

    /*
      MLB DERIVATIVE MARKETS
    */

    if (
      family === 'baseball'
    ) {
      if (
        [
          'nrfi',
          'yrfi',
          'first_inning_runs',
          'first_inning_yes_no'
        ].includes(market)
      ) {
        pushUnique(
          oddIDs,
          'points-all-1i-yn-yes'
        );

        continue;
      }

      if (
        [
          'first_inning_total',
          '1st_inning_total',
          '1i_total'
        ].includes(market)
      ) {
        addTotal(
          oddIDs,
          '1i'
        );

        continue;
      }

      if (
        [
          'f3',
          'first_3',
          'first_3_innings',
          'f3_moneyline'
        ].includes(market)
      ) {
        addMoneyline(
          oddIDs,
          '1ix3'
        );

        continue;
      }

      if (
        [
          'f3_spread',
          'f3_run_line'
        ].includes(market)
      ) {
        addSpread(
          oddIDs,
          '1ix3'
        );

        continue;
      }

      if (
        [
          'f3_total',
          'first_3_total'
        ].includes(market)
      ) {
        addTotal(
          oddIDs,
          '1ix3'
        );

        continue;
      }

      if (
        [
          'f5',
          'first_5',
          'first_5_innings',
          'f5_moneyline'
        ].includes(market)
      ) {
        addMoneyline(
          oddIDs,
          '1h'
        );

        continue;
      }

      if (
        [
          'f5_spread',
          'f5_run_line'
        ].includes(market)
      ) {
        addSpread(
          oddIDs,
          '1h'
        );

        continue;
      }

      if (
        [
          'f5_total',
          'first_5_total'
        ].includes(market)
      ) {
        addTotal(
          oddIDs,
          '1h'
        );

        continue;
      }

      if (
        [
          'f7',
          'first_7',
          'first_7_innings',
          'f7_moneyline'
        ].includes(market)
      ) {
        addMoneyline(
          oddIDs,
          '1ix7'
        );

        continue;
      }

      if (
        [
          'f7_spread',
          'f7_run_line'
        ].includes(market)
      ) {
        addSpread(
          oddIDs,
          '1ix7'
        );

        continue;
      }

      if (
        [
          'f7_total',
          'first_7_total'
        ].includes(market)
      ) {
        addTotal(
          oddIDs,
          '1ix7'
        );

        continue;
      }
    }

    /*
      NHL PERIOD MARKETS
    */

    if (
      family === 'hockey'
    ) {
      let handledPeriod =
        false;

      for (
        const [
          period,
          names
        ]
        of [
          [
            '1p',
            [
              'first_period',
              '1p'
            ]
          ],
          [
            '2p',
            [
              'second_period',
              '2p'
            ]
          ],
          [
            '3p',
            [
              'third_period',
              '3p'
            ]
          ]
        ]
      ) {
        for (
          const prefix
          of names
        ) {
          if (
            addStandardPeriodMarkets(
              oddIDs,
              market,
              period,
              prefix
            )
          ) {
            handledPeriod =
              true;

            break;
          }
        }

        if (
          handledPeriod
        ) {
          break;
        }
      }

      if (
        handledPeriod
      ) {
        continue;
      }
    }

    /*
      PLAYER PROPS
    */

    const playerProp =
      PLAYER_PROP_MAP[
        family
      ]?.[market];

    if (
      playerProp
    ) {
      addPlayerProp(
        oddIDs,
        playerProp
      );

      continue;
    }

    unmapped.push(
      market
    );
  }

  if (
    unmapped.length > 0
  ) {
    throw new HttpError(
      400,
      `SportsGameOdds market(s) not mapped: ${unmapped.join(', ')}`,
      {
        provider:
          'sportsGameOdds',

        sport,

        markets:
          unmapped
      }
    );
  }

  return {
    oddID:
      oddIDs.join(','),

    includeOpposingOdds:
      true,

    ...(includeAltLines
      ? {
          includeAltLines:
            true
        }
      : {})
  };
}

async function callSportsGameOdds(
  path,
  params = {}
) {
  const providerConfig =
    requireConfig();

  const url =
    new URL(
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
    clearTimeout(
      timeout
    );
  }

  let body = null;

  try {
    body =
      await response.json();
  } catch {
    body = null;
  }

  if (
    !response.ok
  ) {
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

export const sportsGameOddsProvider = {
  name:
    'sportsGameOdds',

  async getSports(
    params = {}
  ) {
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
    const {
      leagueID
    } =
      sportConfig(
        sport
      );

    const marketParams =
      buildMarketTranslation(
        sport,
        params.markets
      );

    return callSportsGameOdds(
      '/v2/events',
      {
        leagueID,

        oddsAvailable:
          true,

        limit:
          100,

        ...marketParams,

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
    const {
      leagueID
    } =
      sportConfig(
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

  async getEvents(
    sport,
    params = {}
  ) {
    const {
      leagueID
    } =
      sportConfig(
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
    /*
      Never fetch an unfiltered full event odds tree.

      If SharpBet does not provide markets, default to
      moneyline + spread + total.
    */
    const marketParams =
      buildMarketTranslation(
        sport,
        params.markets
      );

    /*
      SportsGameOdds says eventID takes priority over
      league/date filters, so eventID is all we need
      to identify the game. Response-shaping options
      like oddID and bookmakerID still apply.
    */
    return callSportsGameOdds(
      '/v2/events',
      {
        eventID:
          eventId,

        oddsAvailable:
          true,

        ...marketParams,

        ...cleanSharedParams(
          params
        )
      }
    );
  }
};
