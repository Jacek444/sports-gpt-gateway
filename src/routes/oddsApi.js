import express from 'express';
import { config } from '../config.js';
import {
  getOddsProviderUsageSummary,
  updateBetLogEntry
} from '../storage.js';

import {
  getOddsProvider,
  getOddsProviderStatus,
  getProviderNameForEventId,
  unwrapGatewayEventId,
  withOddsProviderFallback,
  withSpecificOddsProvider
} from '../oddsProviders/index.js';

export const oddsApiRouter = express.Router();

function copyQueryWithoutProvider(query) {
  const params = {
    ...query
  };

  delete params.provider;
  delete params.raw;

  return params;
}

function firstValue(...values) {
  for (const value of values) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ''
    ) {
      return value;
    }
  }

  return null;
}

function teamName(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'object') {
    return firstValue(
      value.name,
      value.fullName,
      value.displayName,
      value.title,
      value.nickname,
      value.abbreviation,
      value.id
    );
  }

  return String(value);
}

function compactEvent(event, providerName) {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const providerEventId =
    event.provider_event_id ||
    event.eventID ||
    event.eventId ||
    event.id ||
    null;

  const gatewayEventId =
    event.gateway_event_id ||
    (
      providerEventId
        ? `${providerName}:${providerEventId}`
        : null
    );

  const homeTeam =
    event?.teams?.home?.names?.long ||
    event?.teams?.home?.names?.medium ||
    event?.teams?.home?.names?.short ||
    event?.home_team ||
    event?.homeTeam ||
    null;

  const awayTeam =
    event?.teams?.away?.names?.long ||
    event?.teams?.away?.names?.medium ||
    event?.teams?.away?.names?.short ||
    event?.away_team ||
    event?.awayTeam ||
    null;

  const commenceTime =
    event?.status?.startsAt ||
    event?.commence_time ||
    event?.commenceTime ||
    event?.start_time ||
    event?.startTime ||
    null;

  let status =
    event?.status?.displayLong ||
    event?.status?.displayShort ||
    null;

  if (!status && event?.status) {
    if (event.status.live) {
      status = 'Live';
    } else if (
      event.status.completed ||
      event.status.ended
    ) {
      status = 'Final';
    } else if (event.status.cancelled) {
      status = 'Cancelled';
    } else if (event.status.delayed) {
      status = 'Delayed';
    } else if (!event.status.started) {
      status = 'Upcoming';
    }
  }

  return {
    gateway_event_id:
      gatewayEventId,

    provider_event_id:
      providerEventId
        ? String(providerEventId)
        : null,

    provider:
      providerName,

    home_team:
      homeTeam,

    away_team:
      awayTeam,

    commence_time:
      commenceTime,

    status:
      status
  };
}

function compactEventResponse(result) {
  const providerName =
    result?.provider || 'unknown';

  let events = [];

  if (Array.isArray(result?.data)) {
    events = result.data;
  } else if (
    Array.isArray(result?.data?.events)
  ) {
    events = result.data.events;
  } else if (
    result?.data &&
    typeof result.data === 'object'
  ) {
    events = [result.data];
  }

  const compactEvents =
    events
      .map((event) =>
        compactEvent(
          event,
          providerName
        )
      )
      .filter(Boolean);

  return {
    provider:
      providerName,

    data:
      compactEvents,

    count:
      compactEvents.length,

    quota:
      result?.quota || null,

    cache:
      result?.cache || {
        hit: false
      }
  };
}

function normalizeLookupText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function valuesMatch(actual, expected) {
  if (!expected) {
    return true;
  }

  const actualText =
    normalizeLookupText(actual);

  const expectedText =
    normalizeLookupText(expected);

  if (!actualText || !expectedText) {
    return false;
  }

  return (
    actualText === expectedText ||
    actualText.includes(expectedText) ||
    expectedText.includes(actualText)
  );
}

function utcDateFromCommenceTime(value) {
  if (!value) {
    return null;
  }

  const timestamp =
    Date.parse(String(value));

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp)
    .toISOString()
    .slice(0, 10);
}

function closingRowsFromData(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (!data || typeof data !== 'object') {
    return [];
  }

  const candidateKeys = [
    'data',
    'results',
    'rows',
    'closing_odds',
    'closingOdds',
    'odds',
    'markets'
  ];

  for (const key of candidateKeys) {
    if (Array.isArray(data[key])) {
      return data[key];
    }
  }

  return [];
}

function compactClosingRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const marketKey =
    firstValue(
      row.market_key,
      row.marketKey,
      row.market
    );

  const homeLine =
    firstValue(
      row.home_spread,
      row.homeSpread,
      row.home_line,
      row.homeLine
    );

  const awayLine =
    firstValue(
      row.away_spread,
      row.awaySpread,
      row.away_line,
      row.awayLine
    );

  const homePrice =
    firstValue(
      row.home_spread_odds,
      row.homeSpreadOdds,
      row.home_moneyline,
      row.homeMoneyline,
      row.home_odds,
      row.homeOdds
    );

  const awayPrice =
    firstValue(
      row.away_spread_odds,
      row.awaySpreadOdds,
      row.away_moneyline,
      row.awayMoneyline,
      row.away_odds,
      row.awayOdds
    );

  const drawPrice =
    firstValue(
      row.draw_odds,
      row.drawOdds,
      row.draw_price,
      row.drawPrice
    );

  const total =
    firstValue(
      row.total,
      row.total_points,
      row.totalPoints,
      row.over_under,
      row.overUnder
    );

  const overPrice =
    firstValue(
      row.over_odds,
      row.overOdds,
      row.over_price,
      row.overPrice
    );

  const underPrice =
    firstValue(
      row.under_odds,
      row.underOdds,
      row.under_price,
      row.underPrice
    );

  const genericLine =
    firstValue(
      row.line,
      row.point,
      row.closing_line,
      row.close_line
    );

  const genericPrice =
    firstValue(
      row.price,
      row.odds,
      row.closing_odds,
      row.close_odds
    );

  return {
    canonical_event_id:
      firstValue(
        row.canonical_event_id,
        row.canonicalEventId,
        row.event_id,
        row.eventId,
        row.id
      ),

    home_team:
      firstValue(
        row.home_team,
        row.homeTeam
      ),

    away_team:
      firstValue(
        row.away_team,
        row.awayTeam
      ),

    commence_time:
      firstValue(
        row.commence_time,
        row.commenceTime,
        row.start_time,
        row.startTime
      ),

    bookmaker:
      firstValue(
        row.bookmaker,
        row.bookmaker_key,
        row.source,
        row.book
      ),

    bookmaker_title:
      firstValue(
        row.bookmaker_title,
        row.bookmakerTitle
      ),

    market_key:
      marketKey,

    player:
      firstValue(
        row.player,
        row.player_name,
        row.playerName
      ),

    outcome:
      firstValue(
        row.outcome,
        row.side,
        row.selection,
        row.name
      ),

    line:
      genericLine,

    price:
      genericPrice,

    home_line:
      homeLine,

    home_price:
      homePrice,

    away_line:
      awayLine,

    away_price:
      awayPrice,

    draw_price:
      drawPrice,

    total:
      total,

    over_price:
      overPrice,

    under_price:
      underPrice,

    retired:
      row.retired ?? null,

    closed_on:
      firstValue(
        row.closed_on,
        row.closedOn
      )
  };
}

function closingRowMatches(
  row,
  {
    homeTeam,
    awayTeam,
    market,
    bookmaker,
    player
  }
) {
  if (
    homeTeam &&
    !valuesMatch(
      firstValue(
        row.home_team,
        row.homeTeam
      ),
      homeTeam
    )
  ) {
    return false;
  }

  if (
    awayTeam &&
    !valuesMatch(
      firstValue(
        row.away_team,
        row.awayTeam
      ),
      awayTeam
    )
  ) {
    return false;
  }

  if (
    market &&
    !valuesMatch(
      firstValue(
        row.market_key,
        row.marketKey,
        row.market
      ),
      market
    )
  ) {
    return false;
  }

  if (
    bookmaker &&
    !valuesMatch(
      firstValue(
        row.bookmaker,
        row.bookmaker_key,
        row.source,
        row.book
      ),
      bookmaker
    )
  ) {
    return false;
  }

  if (
    player &&
    !valuesMatch(
      firstValue(
        row.player,
        row.player_name,
        row.playerName
      ),
      player
    )
  ) {
    return false;
  }

  return true;
}

const MAX_CLV_GROUPS_PER_REQUEST = 10;

function numberOrNull(value) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  const normalized =
    typeof value === 'string'
      ? value.replace(/[,%$]/g, '').trim()
      : value;

  const number =
    Number(normalized);

  return Number.isFinite(number)
    ? number
    : null;
}

function stringOrNull(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const textValue =
    String(value).trim();

  return textValue || null;
}

function normalizeSportKey(value) {
  const raw =
    normalizeLookupText(value);

  const aliases = {
    nfl: 'americanfootball_nfl',
    americanfootball_nfl:
      'americanfootball_nfl',

    nba: 'basketball_nba',
    basketball_nba:
      'basketball_nba',

    ncaam: 'basketball_ncaab',
    ncaab: 'basketball_ncaab',
    basketball_ncaab:
      'basketball_ncaab',

    ncaaf: 'americanfootball_ncaaf',
    americanfootball_ncaaf:
      'americanfootball_ncaaf',

    mlb: 'baseball_mlb',
    baseball_mlb:
      'baseball_mlb',

    nhl: 'icehockey_nhl',
    icehockey_nhl:
      'icehockey_nhl'
  };

  const collapsed =
    raw.replace(/\s+/g, '_');

  return aliases[collapsed] ||
    stringOrNull(value);
}

function normalizeMarketKey(value) {
  const raw =
    normalizeLookupText(value);

  if (!raw) {
    return null;
  }

  const collapsed =
    raw.replace(/\s+/g, '_');

  if (
    collapsed === 'spread' ||
    collapsed === 'spreads' ||
    collapsed.includes('point_spread')
  ) {
    return 'spreads';
  }

  if (
    collapsed === 'moneyline' ||
    collapsed === 'money_line' ||
    collapsed === 'ml' ||
    collapsed === 'h2h' ||
    collapsed === 'head_to_head'
  ) {
    return 'h2h';
  }

  if (
    collapsed === 'total' ||
    collapsed === 'totals' ||
    collapsed === 'over_under' ||
    collapsed === 'ou'
  ) {
    return 'totals';
  }

  return collapsed;
}

function normalizeOutcomeText(value) {
  return normalizeLookupText(value);
}

function parseEventTeams(eventText) {
  const value =
    stringOrNull(eventText);

  if (!value) {
    return null;
  }

  const patterns = [
    {
      regex: /\s+@\s+/i,
      orientation: 'away_home'
    },
    {
      regex: /\s+at\s+/i,
      orientation: 'away_home'
    },
    {
      regex: /\s+vs\.?\s+/i,
      orientation: 'unordered'
    },
    {
      regex: /\s+v\.?\s+/i,
      orientation: 'unordered'
    }
  ];

  for (const pattern of patterns) {
    const parts =
      value
        .split(pattern.regex)
        .map((part) =>
          part.trim()
        )
        .filter(Boolean);

    if (parts.length !== 2) {
      continue;
    }

    if (
      pattern.orientation ===
      'away_home'
    ) {
      return {
        away_team:
          parts[0],
        home_team:
          parts[1],
        team_a:
          parts[0],
        team_b:
          parts[1],
        orientation:
          'away_home'
      };
    }

    return {
      away_team:
        null,
      home_team:
        null,
      team_a:
        parts[0],
      team_b:
        parts[1],
      orientation:
        'unordered'
    };
  }

  return null;
}

function deriveClvGameDate(bet) {
  const commenceDate =
    utcDateFromCommenceTime(
      bet?.commence_time
    );

  if (commenceDate) {
    return commenceDate;
  }

  const explicitDate =
    stringOrNull(
      bet?.game_date ||
      bet?.date
    );

  if (!explicitDate) {
    return null;
  }

  return explicitDate.slice(0, 10);
}

function normalizeClvBet(bet, index) {
  const parsedEvent =
    parseEventTeams(
      bet?.event
    );

  const homeTeam =
    stringOrNull(
      bet?.home_team
    ) ||
    parsedEvent?.home_team ||
    null;

  const awayTeam =
    stringOrNull(
      bet?.away_team
    ) ||
    parsedEvent?.away_team ||
    null;

  const teamA =
    homeTeam ||
    parsedEvent?.team_a ||
    null;

  const teamB =
    awayTeam ||
    parsedEvent?.team_b ||
    null;

  return {
    bet_index:
      index,

    bet_id:
      stringOrNull(
        bet?.bet_id ||
        bet?.id
      ),

    sport_key:
      normalizeSportKey(
        bet?.sport_key ||
        bet?.league ||
        bet?.sport
      ),

    market:
      normalizeMarketKey(
        bet?.market_key ||
        bet?.market
      ),

    player:
      stringOrNull(
        bet?.player
      ),

    line:
      numberOrNull(
        bet?.line
      ),

    outcome:
      stringOrNull(
        bet?.outcome ||
        bet?.outcome_key ||
        bet?.selection
      ),

    taken_odds:
      numberOrNull(
        bet?.taken_odds ??
        bet?.odds
      ),

    bookmaker:
      stringOrNull(
        bet?.bookmaker ||
        bet?.bookmaker_key ||
        bet?.sportsbook
      ),

    event:
      stringOrNull(
        bet?.event
      ),

    home_team:
      homeTeam,

    away_team:
      awayTeam,

    team_a:
      teamA,

    team_b:
      teamB,

    game_date:
      deriveClvGameDate(
        bet
      )
  };
}

function validateNormalizedClvBet(bet) {
  const missing = [];

  if (!bet.sport_key) {
    missing.push('sport_key or league');
  }

  if (!bet.market) {
    missing.push('market or market_key');
  }

  if (!bet.outcome) {
    missing.push('selection or outcome');
  }

  if (bet.taken_odds === null) {
    missing.push('odds or taken_odds');
  }

  if (!bet.game_date) {
    missing.push(
      'commence_time or game_date/date'
    );
  }

  if (
    !bet.team_a ||
    !bet.team_b
  ) {
    missing.push(
      'home_team/away_team or a parseable event string'
    );
  }

  return {
    valid:
      missing.length === 0,

    missing
  };
}

function clvGroupKey(bet) {
  return JSON.stringify([
    bet.sport_key,
    bet.game_date,
    bet.market,
    bet.player || ''
  ]);
}

function closingRowEventMatches(
  row,
  bet
) {
  const rowHome =
    firstValue(
      row?.home_team,
      row?.homeTeam
    );

  const rowAway =
    firstValue(
      row?.away_team,
      row?.awayTeam
    );

  if (!rowHome || !rowAway) {
    return false;
  }

  if (
    bet.home_team &&
    bet.away_team
  ) {
    return (
      valuesMatch(
        rowHome,
        bet.home_team
      ) &&
      valuesMatch(
        rowAway,
        bet.away_team
      )
    );
  }

  const directPair =
    valuesMatch(
      rowHome,
      bet.team_a
    ) &&
    valuesMatch(
      rowAway,
      bet.team_b
    );

  const reversedPair =
    valuesMatch(
      rowHome,
      bet.team_b
    ) &&
    valuesMatch(
      rowAway,
      bet.team_a
    );

  return (
    directPair ||
    reversedPair
  );
}

function closingRowMarketMatches(
  row,
  market
) {
  const rowMarket =
    normalizeMarketKey(
      firstValue(
        row?.market_key,
        row?.marketKey,
        row?.market
      )
    );

  /*
    Some historical rows omit the market field because
    the request already filtered to a single market.
  */
  if (!rowMarket) {
    return true;
  }

  return rowMarket === market;
}

function closingRowPlayerMatches(
  row,
  player
) {
  if (!player) {
    return true;
  }

  const rowPlayer =
    firstValue(
      row?.player,
      row?.player_name,
      row?.playerName
    );

  return valuesMatch(
    rowPlayer,
    player
  );
}

function bookmakerMatches(
  row,
  bookmaker
) {
  if (!bookmaker) {
    return false;
  }

  const rowBook =
    firstValue(
      row?.bookmaker,
      row?.bookmaker_key,
      row?.source,
      row?.book,
      row?.bookmaker_title,
      row?.bookmakerTitle
    );

  return valuesMatch(
    rowBook,
    bookmaker
  );
}

function americanToDecimal(value) {
  const odds =
    numberOrNull(value);

  if (
    odds === null ||
    odds === 0
  ) {
    return null;
  }

  if (odds > 0) {
    return 1 + odds / 100;
  }

  return 1 + 100 / Math.abs(odds);
}

function americanToImpliedProbability(
  value
) {
  const odds =
    numberOrNull(value);

  if (
    odds === null ||
    odds === 0
  ) {
    return null;
  }

  if (odds > 0) {
    return 100 / (odds + 100);
  }

  return (
    Math.abs(odds) /
    (Math.abs(odds) + 100)
  );
}

function impliedProbabilityToAmerican(
  probability
) {
  const p =
    Number(probability);

  if (
    !Number.isFinite(p) ||
    p <= 0 ||
    p >= 1
  ) {
    return null;
  }

  if (p >= 0.5) {
    return Math.round(
      -100 * p / (1 - p)
    );
  }

  return Math.round(
    100 * (1 - p) / p
  );
}

function median(values) {
  const numbers =
    values
      .map(numberOrNull)
      .filter(
        (value) =>
          value !== null
      )
      .sort(
        (a, b) =>
          a - b
      );

  if (!numbers.length) {
    return null;
  }

  const middle =
    Math.floor(
      numbers.length / 2
    );

  if (
    numbers.length % 2 === 1
  ) {
    return numbers[middle];
  }

  return (
    numbers[middle - 1] +
    numbers[middle]
  ) / 2;
}

function chooseConsensusLine(
  results
) {
  const lineValues =
    results
      .map(
        (result) =>
          result.line
      )
      .filter(
        (value) =>
          value !== null
      );

  if (!lineValues.length) {
    return null;
  }

  const medianLine =
    median(lineValues);

  let chosen =
    lineValues[0];

  let chosenDistance =
    Math.abs(
      chosen -
      medianLine
    );

  for (
    const line of lineValues
  ) {
    const distance =
      Math.abs(
        line -
        medianLine
      );

    if (
      distance <
      chosenDistance
    ) {
      chosen =
        line;

      chosenDistance =
        distance;
    }
  }

  return chosen;
}

function outcomeIsOver(value) {
  const normalized =
    normalizeOutcomeText(value);

  return (
    normalized === 'over' ||
    normalized.startsWith('over ')
  );
}

function outcomeIsUnder(value) {
  const normalized =
    normalizeOutcomeText(value);

  return (
    normalized === 'under' ||
    normalized.startsWith('under ')
  );
}

function extractClosingSelection(
  row,
  bet
) {
  const homeTeam =
    firstValue(
      row?.home_team,
      row?.homeTeam
    );

  const awayTeam =
    firstValue(
      row?.away_team,
      row?.awayTeam
    );

  const outcome =
    bet.outcome;

  const isHome =
    homeTeam &&
    valuesMatch(
      outcome,
      homeTeam
    );

  const isAway =
    awayTeam &&
    valuesMatch(
      outcome,
      awayTeam
    );

  const genericLine =
    numberOrNull(
      firstValue(
        row?.line,
        row?.point,
        row?.closing_line,
        row?.close_line
      )
    );

  const genericPrice =
    numberOrNull(
      firstValue(
        row?.price,
        row?.odds,
        row?.closing_odds,
        row?.close_odds
      )
    );

  if (bet.market === 'spreads') {
    if (isHome) {
      return {
        line:
          numberOrNull(
            firstValue(
              row?.home_spread,
              row?.homeSpread,
              row?.home_line,
              row?.homeLine
            )
          ),

        odds:
          numberOrNull(
            firstValue(
              row?.home_spread_odds,
              row?.homeSpreadOdds,
              row?.home_odds,
              row?.homeOdds
            )
          ),

        side:
          'home'
      };
    }

    if (isAway) {
      return {
        line:
          numberOrNull(
            firstValue(
              row?.away_spread,
              row?.awaySpread,
              row?.away_line,
              row?.awayLine
            )
          ),

        odds:
          numberOrNull(
            firstValue(
              row?.away_spread_odds,
              row?.awaySpreadOdds,
              row?.away_odds,
              row?.awayOdds
            )
          ),

        side:
          'away'
      };
    }

    return null;
  }

  if (bet.market === 'h2h') {
    if (isHome) {
      return {
        line:
          null,

        odds:
          numberOrNull(
            firstValue(
              row?.home_moneyline,
              row?.homeMoneyline,
              row?.home_ml,
              row?.homeMl,
              row?.home_odds,
              row?.homeOdds
            )
          ),

        side:
          'home'
      };
    }

    if (isAway) {
      return {
        line:
          null,

        odds:
          numberOrNull(
            firstValue(
              row?.away_moneyline,
              row?.awayMoneyline,
              row?.away_ml,
              row?.awayMl,
              row?.away_odds,
              row?.awayOdds
            )
          ),

        side:
          'away'
      };
    }

    const drawOutcome =
      normalizeOutcomeText(
        outcome
      );

    if (
      drawOutcome === 'draw' ||
      drawOutcome === 'tie'
    ) {
      return {
        line:
          null,

        odds:
          numberOrNull(
            firstValue(
              row?.draw_odds,
              row?.drawOdds,
              row?.draw_price,
              row?.drawPrice
            )
          ),

        side:
          'draw'
      };
    }

    return null;
  }

  if (bet.market === 'totals') {
    const total =
      numberOrNull(
        firstValue(
          row?.total,
          row?.total_points,
          row?.totalPoints,
          row?.over_under,
          row?.overUnder,
          genericLine
        )
      );

    if (
      outcomeIsOver(
        outcome
      )
    ) {
      return {
        line:
          total,

        odds:
          numberOrNull(
            firstValue(
              row?.over_odds,
              row?.overOdds,
              row?.over_price,
              row?.overPrice,
              genericPrice
            )
          ),

        side:
          'over'
      };
    }

    if (
      outcomeIsUnder(
        outcome
      )
    ) {
      return {
        line:
          total,

        odds:
          numberOrNull(
            firstValue(
              row?.under_odds,
              row?.underOdds,
              row?.under_price,
              row?.underPrice,
              genericPrice
            )
          ),

        side:
          'under'
      };
    }

    return null;
  }

  /*
    Generic player-prop / alternate-market fallback.
  */
  const rowOutcome =
    firstValue(
      row?.outcome,
      row?.side,
      row?.selection,
      row?.name
    );

  if (
    rowOutcome &&
    !valuesMatch(
      rowOutcome,
      outcome
    )
  ) {
    return null;
  }

  let odds =
    genericPrice;

  if (
    odds === null &&
    outcomeIsOver(
      outcome
    )
  ) {
    odds =
      numberOrNull(
        firstValue(
          row?.over_odds,
          row?.overOdds,
          row?.over_price,
          row?.overPrice
        )
      );
  }

  if (
    odds === null &&
    outcomeIsUnder(
      outcome
    )
  ) {
    odds =
      numberOrNull(
        firstValue(
          row?.under_odds,
          row?.underOdds,
          row?.under_price,
          row?.underPrice
        )
      );
  }

  return {
    line:
      genericLine,

    odds,

    side:
      outcomeIsOver(outcome)
        ? 'over'
        : outcomeIsUnder(outcome)
          ? 'under'
          : 'generic'
  };
}

function buildConsensusClose(
  rows,
  bet
) {
  const selections =
    rows
      .map((row) => {
        const extracted =
          extractClosingSelection(
            row,
            bet
          );

        if (!extracted) {
          return null;
        }

        return {
          ...extracted,

          bookmaker:
            firstValue(
              row?.bookmaker,
              row?.bookmaker_key,
              row?.source,
              row?.book,
              row?.bookmaker_title,
              row?.bookmakerTitle
            )
        };
      })
      .filter(Boolean);

  if (!selections.length) {
    return null;
  }

  const chosenLine =
    chooseConsensusLine(
      selections
    );

  let comparable =
    selections;

  if (chosenLine !== null) {
    comparable =
      selections.filter(
        (selection) =>
          selection.line !== null &&
          Math.abs(
            selection.line -
            chosenLine
          ) < 1e-9
      );
  }

  const implied =
    comparable
      .map(
        (selection) =>
          americanToImpliedProbability(
            selection.odds
          )
      )
      .filter(
        (value) =>
          value !== null
      );

  const medianImplied =
    median(implied);

  const consensusOdds =
    medianImplied !== null
      ? impliedProbabilityToAmerican(
          medianImplied
        )
      : null;

  return {
    line:
      chosenLine,

    odds:
      consensusOdds,

    bookmaker:
      'CONSENSUS',

    source:
      'consensus',

    contributing_books:
      comparable.length
  };
}

function chooseClosingForBet(
  rows,
  bet
) {
  const eventRows =
    rows.filter(
      (row) =>
        closingRowEventMatches(
          row,
          bet
        ) &&
        closingRowMarketMatches(
          row,
          bet.market
        ) &&
        closingRowPlayerMatches(
          row,
          bet.player
        )
    );

  if (!eventRows.length) {
    return {
      match:
        null,

      status:
        'no_event_match'
    };
  }

  if (bet.bookmaker) {
    const bookRows =
      eventRows.filter(
        (row) =>
          bookmakerMatches(
            row,
            bet.bookmaker
          )
      );

    for (const row of bookRows) {
      const selection =
        extractClosingSelection(
          row,
          bet
        );

      if (!selection) {
        continue;
      }

      return {
        match: {
          ...selection,

          bookmaker:
            firstValue(
              row?.bookmaker_title,
              row?.bookmakerTitle,
              row?.bookmaker,
              row?.bookmaker_key,
              row?.source,
              row?.book
            ) ||
            bet.bookmaker,

          source:
            'exact_book',

          contributing_books:
            1
        },

        status:
          'matched_exact_book'
      };
    }
  }

  const consensus =
    buildConsensusClose(
      eventRows,
      bet
    );

  if (!consensus) {
    return {
      match:
        null,

      status:
        'no_selection_match'
    };
  }

  return {
    match:
      consensus,

    status:
      'matched_consensus'
  };
}

function calculateLineEdge(
  bet,
  closingLine
) {
  if (
    bet.line === null ||
    closingLine === null
  ) {
    return null;
  }

  if (bet.market === 'spreads') {
    return (
      bet.line -
      closingLine
    );
  }

  if (
    bet.market === 'totals' ||
    outcomeIsOver(
      bet.outcome
    ) ||
    outcomeIsUnder(
      bet.outcome
    )
  ) {
    if (
      outcomeIsOver(
        bet.outcome
      )
    ) {
      return (
        closingLine -
        bet.line
      );
    }

    if (
      outcomeIsUnder(
        bet.outcome
      )
    ) {
      return (
        bet.line -
        closingLine
      );
    }
  }

  return null;
}

function calculatePriceClvPercent(
  takenOdds,
  closingOdds
) {
  const takenDecimal =
    americanToDecimal(
      takenOdds
    );

  const closingDecimal =
    americanToDecimal(
      closingOdds
    );

  if (
    takenDecimal === null ||
    closingDecimal === null
  ) {
    return null;
  }

  return (
    (takenDecimal /
      closingDecimal) -
    1
  ) * 100;
}

function roundMetric(
  value,
  decimals = 3
) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(
      Number(value)
    )
  ) {
    return null;
  }

  const factor =
    10 ** decimals;

  return (
    Math.round(
      Number(value) *
      factor
    ) /
    factor
  );
}

function buildLocalClvUpdate(
  bet,
  chosen
) {
  if (!chosen?.match) {
    return {
      closing_line:
        null,

      closing_odds:
        null,

      closing_book:
        null,

      clv_percent:
        null,

      clv_status:
        'manual_required',

      clv_notes:
        [
          'Local CLV tracker could not match a historical closing row',
          `match_status=${chosen?.status || 'unknown'}`,
          `game_date=${bet.game_date}`,
          `market=${bet.market}`
        ].join('; ')
    };
  }

  const closing =
    chosen.match;

  const closingLine =
    numberOrNull(
      closing.line
    );

  const closingOdds =
    numberOrNull(
      closing.odds
    );

  const lineApplicable =
    bet.market !== 'h2h' &&
    bet.line !== null &&
    closingLine !== null;

  const sameLine =
    !lineApplicable ||
    Math.abs(
      bet.line -
      closingLine
    ) < 1e-9;

  const lineEdge =
    lineApplicable
      ? calculateLineEdge(
          bet,
          closingLine
        )
      : null;

  const priceClv =
    sameLine
      ? calculatePriceClvPercent(
          bet.taken_odds,
          closingOdds
        )
      : null;

  let clvStatus;

  if (
    lineApplicable &&
    !sameLine &&
    lineEdge !== null
  ) {
    if (lineEdge > 0) {
      clvStatus =
        'positive_line';
    } else if (lineEdge < 0) {
      clvStatus =
        'negative_line';
    } else {
      clvStatus =
        'neutral_line';
    }
  } else if (priceClv !== null) {
    if (priceClv > 0.05) {
      clvStatus =
        'positive';
    } else if (priceClv < -0.05) {
      clvStatus =
        'negative';
    } else {
      clvStatus =
        'neutral';
    }
  } else {
    clvStatus =
      'matched_no_price';
  }

  const noteParts = [
    'CLV calculated locally from ParlayAPI historical closing odds',
    `source=${closing.source}`,
    `game_date=${bet.game_date}`,
    `market=${bet.market}`,
    `taken_odds=${bet.taken_odds}`,
    `closing_odds=${closingOdds ?? 'null'}`
  ];

  if (bet.line !== null) {
    noteParts.push(
      `taken_line=${bet.line}`
    );
  }

  if (closingLine !== null) {
    noteParts.push(
      `closing_line=${closingLine}`
    );
  }

  if (lineEdge !== null) {
    noteParts.push(
      `line_edge=${roundMetric(lineEdge)}`
    );
  }

  if (priceClv !== null) {
    noteParts.push(
      `price_clv_pct=${roundMetric(priceClv)}`
    );

    noteParts.push(
      'clv_percent_metric=decimal_price_ratio_same_line'
    );
  } else if (
    lineApplicable &&
    !sameLine
  ) {
    noteParts.push(
      'clv_percent_metric=not_computed_when_line_changed'
    );
  }

  if (
    closing.source ===
    'consensus'
  ) {
    noteParts.push(
      `consensus_books=${closing.contributing_books || 0}`
    );
  }

  return {
    closing_line:
      closingLine,

    closing_odds:
      closingOdds !== null
        ? String(
            closingOdds
          )
        : null,

    closing_book:
      closing.bookmaker ||
      null,

    clv_percent:
      priceClv !== null
        ? roundMetric(
            priceClv
          )
        : null,

    clv_status:
      clvStatus,

    clv_notes:
      noteParts.join('; ')
  };
}

oddsApiRouter.get(
  '/status',
  async (req, res, next) => {
    try {
      const runtime =
        getOddsProviderStatus();

      const history =
        await getOddsProviderUsageSummary();

      res.json({
        runtime,
        history
      });
    } catch (error) {
      next(error);
    }
  }
);

oddsApiRouter.get(
  '/sports',
  async (req, res, next) => {
    try {
      const providerName =
        req.query.provider || null;

      const params =
        copyQueryWithoutProvider(
          req.query
        );

      if (providerName) {
        const result =
          await withSpecificOddsProvider(
            providerName,

            (provider) =>
              provider.getSports(
                params
              ),

            {
              cacheKey:
                `sports:${providerName}:${JSON.stringify(params)}`,

              cacheTtlMs:
                10 * 60 * 1000,

              requestType:
                'sports'
            }
          );

        return res.json(result);
      }

      const result =
        await withOddsProviderFallback(
          (provider) =>
            provider.getSports(
              params
            ),

          {
            order:
              config.oddsSportsProviderOrder,

            cacheKey:
              `sports:auto:${JSON.stringify(params)}`,

            cacheTtlMs:
              10 * 60 * 1000,

            requestType:
              'sports'
          }
        );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

oddsApiRouter.get(
  '/:sport/odds',
  async (req, res, next) => {
    try {
      const sport =
        req.params.sport;

      const providerName =
        req.query.provider || null;

      const params =
        copyQueryWithoutProvider(
          req.query
        );

      if (providerName) {
        const result =
          await withSpecificOddsProvider(
            providerName,

            (provider) =>
              provider.getOddsBoard(
                sport,
                params
              ),

            {
              cacheKey:
                `odds:${providerName}:${sport}:${JSON.stringify(params)}`,

              cacheTtlMs:
                30 * 1000,

              rememberEvents:
                true,

              requestType:
                'odds'
            }
          );

        return res.json(result);
      }

      const result =
        await withOddsProviderFallback(
          (provider) =>
            provider.getOddsBoard(
              sport,
              params
            ),

          {
            order:
              config.oddsSportsProviderOrder,

            cacheKey:
              `odds:auto:${sport}:${JSON.stringify(params)}`,

            cacheTtlMs:
              30 * 1000,

            rememberEvents:
              true,

            requestType:
              'odds'
          }
        );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

oddsApiRouter.get(
  '/:sport/scores',
  async (req, res, next) => {
    try {
      const sport =
        req.params.sport;

      const providerName =
        req.query.provider || null;

      const params =
        copyQueryWithoutProvider(
          req.query
        );

      if (providerName) {
        const result =
          await withSpecificOddsProvider(
            providerName,

            (provider) =>
              provider.getScores(
                sport,
                params
              ),

            {
              cacheKey:
                `scores:${providerName}:${sport}:${JSON.stringify(params)}`,

              cacheTtlMs:
                30 * 1000,

              rememberEvents:
                true,

              requestType:
                'scores'
            }
          );

        return res.json(result);
      }

      const result =
        await withOddsProviderFallback(
          (provider) =>
            provider.getScores(
              sport,
              params
            ),

          {
            cacheKey:
              `scores:auto:${sport}:${JSON.stringify(params)}`,

            cacheTtlMs:
              30 * 1000,

            rememberEvents:
              true,

            requestType:
              'scores'
          }
        );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

oddsApiRouter.get(
  '/:sport/events',
  async (req, res, next) => {
    try {
      const sport =
        req.params.sport;

      const providerName =
        req.query.provider || null;

      const rawMode =
        String(
          req.query.raw || ''
        ).toLowerCase() === 'true';

      const params =
        copyQueryWithoutProvider(
          req.query
        );

      let result;

      if (providerName) {
        result =
          await withSpecificOddsProvider(
            providerName,

            (provider) =>
              provider.getEvents(
                sport,
                params
              ),

            {
              cacheKey:
                `events:${providerName}:${sport}:${JSON.stringify(params)}`,

              cacheTtlMs:
                60 * 1000,

              rememberEvents:
                true,

              requestType:
                'events'
            }
          );
      } else {
        result =
          await withOddsProviderFallback(
            (provider) =>
              provider.getEvents(
                sport,
                params
              ),

            {
              cacheKey:
                `events:auto:${sport}:${JSON.stringify(params)}`,

              cacheTtlMs:
                60 * 1000,

              rememberEvents:
                true,

              requestType:
                'events'
            }
          );
      }

      /*
        Raw mode is available only for debugging.

        Normal SharpBet requests receive the compact slate
        so an entire league/day can fit inside a GPT action
        response.
      */
      if (rawMode) {
        return res.json(result);
      }

      res.json(
        compactEventResponse(result)
      );
    } catch (error) {
      next(error);
    }
  }
);

/*
  Diagnostic only.

  ParlayAPI's /v1/clv/history endpoint is currently disabled
  upstream. The working SharpBet tracker below does not depend
  on this route.
*/
oddsApiRouter.post(
  '/clv/history',
  async (req, res, next) => {
    try {
      const body =
        req.body &&
        typeof req.body === 'object'
          ? req.body
          : {};

      const result =
        await withSpecificOddsProvider(
          'parlayApi',

          (provider) =>
            provider.gradeClvHistory(
              body
            ),

          {
            requestType:
              'clv_history'
          }
        );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/*
  Working CLV tracker.

  This does not depend on ParlayAPI's disabled /v1/clv/history
  endpoint. Instead it batches historical closing-odds lookups,
  matches each wager locally, calculates CLV, and optionally
  writes the result into the SharpBet bet log.
*/
oddsApiRouter.post(
  '/clv/grade-and-save',
  async (req, res, next) => {
    try {
      const body =
        req.body &&
        typeof req.body === 'object'
          ? req.body
          : {};

      const inputBets =
        Array.isArray(
          body.bets
        )
          ? body.bets
          : [];

      const writeBack =
        body.write_back !== false;

      if (
        inputBets.length < 1 ||
        inputBets.length > 50
      ) {
        return res.status(400).json({
          error: {
            message:
              'bets must contain between 1 and 50 wager objects'
          }
        });
      }

      const normalizedBets =
        inputBets.map(
          (bet, index) =>
            normalizeClvBet(
              bet,
              index
            )
        );

      const validations =
        normalizedBets.map(
          (bet) =>
            validateNormalizedClvBet(
              bet
            )
        );

      const invalid =
        validations
          .map(
            (validation, index) => ({
              bet_index:
                index,

              bet_id:
                normalizedBets[index]
                  .bet_id,

              missing:
                validation.missing,

              valid:
                validation.valid
            })
          )
          .filter(
            (item) =>
              !item.valid
          );

      if (invalid.length > 0) {
        return res.status(400).json({
          error: {
            message:
              'One or more CLV bets are missing required matching fields',

            details: {
              invalid
            }
          }
        });
      }

      if (writeBack) {
        const missingIds =
          normalizedBets
            .filter(
              (bet) =>
                !bet.bet_id
            )
            .map(
              (bet) =>
                bet.bet_index
            );

        if (missingIds.length > 0) {
          return res.status(400).json({
            error: {
              message:
                'bet_id is required for every wager when write_back=true',

              details: {
                missing_bet_indexes:
                  missingIds
              }
            }
          });
        }
      }

      const groups =
        new Map();

      for (
        const bet of
          normalizedBets
      ) {
        const key =
          clvGroupKey(
            bet
          );

        if (!groups.has(key)) {
          groups.set(
            key,
            {
              key,
              sport:
                bet.sport_key,
              date:
                bet.game_date,
              market:
                bet.market,
              player:
                bet.player,
              bets: []
            }
          );
        }

        groups
          .get(key)
          .bets
          .push(bet);
      }

      if (
        groups.size >
        MAX_CLV_GROUPS_PER_REQUEST
      ) {
        return res.status(400).json({
          error: {
            message:
              `CLV batch would require ${groups.size} historical provider calls. Split it into batches of ${MAX_CLV_GROUPS_PER_REQUEST} groups or fewer.`,

            details: {
              group_count:
                groups.size,

              max_groups:
                MAX_CLV_GROUPS_PER_REQUEST
            }
          }
        });
      }

      const groupData =
        new Map();

      const groupSummaries = [];

      for (
        const group of
          groups.values()
      ) {
        const params = {
          date:
            group.date,

          markets:
            group.market
        };

        if (group.player) {
          params.player =
            group.player;
        }

        const result =
          await withSpecificOddsProvider(
            'parlayApi',

            (provider) =>
              provider.getClosingOdds(
                group.sport,
                params
              ),

            {
              /*
                Do not filter by bookmaker upstream.

                One historical archive call can service
                multiple sportsbooks and also allows
                consensus fallback without spending another
                provider request.
              */
              cacheKey:
                `clv-grade:parlayApi:${group.sport}:${JSON.stringify(params)}`,

              cacheTtlMs:
                24 * 60 * 60 * 1000,

              requestType:
                'clv_grade_closing_odds'
            }
          );

        const rows =
          closingRowsFromData(
            result?.data
          );

        groupData.set(
          group.key,
          {
            rows,

            provider:
              result?.provider ||
              'parlayApi',

            quota:
              result?.quota ||
              null,

            cache:
              result?.cache || {
                hit: false
              }
          }
        );

        groupSummaries.push({
          sport:
            group.sport,

          date:
            group.date,

          market:
            group.market,

          player:
            group.player,

          bet_count:
            group.bets.length,

          source_row_count:
            rows.length,

          cache_hit:
            Boolean(
              result?.cache?.hit
            ),

          quota:
            result?.quota ||
            null
        });
      }

      const results = [];

      for (
        const bet of
          normalizedBets
      ) {
        const group =
          groupData.get(
            clvGroupKey(
              bet
            )
          );

        const chosen =
          chooseClosingForBet(
            group?.rows || [],
            bet
          );

        const logUpdate =
          buildLocalClvUpdate(
            bet,
            chosen
          );

        let savedEntry = null;

        if (writeBack) {
          savedEntry =
            await updateBetLogEntry(
              bet.bet_id,
              logUpdate
            );
        }

        results.push({
          bet_index:
            bet.bet_index,

          bet_id:
            bet.bet_id,

          sport_key:
            bet.sport_key,

          game_date:
            bet.game_date,

          market:
            bet.market,

          outcome:
            bet.outcome,

          bookmaker:
            bet.bookmaker,

          match_status:
            chosen.status,

          closing_match:
            chosen.match,

          log_update:
            logUpdate,

          saved:
            writeBack,

          saved_entry:
            savedEntry
        });
      }

      res.json({
        provider:
          'parlayApi',

        method:
          'local_clv_from_historical_closing_odds',

        write_back:
          writeBack,

        submitted:
          normalizedBets.length,

        group_count:
          groups.size,

        max_groups:
          MAX_CLV_GROUPS_PER_REQUEST,

        groups:
          groupSummaries,

        results
      });
    } catch (error) {
      next(error);
    }
  }
);

/*
  Compact CLV lookup.

  Pulls ParlayAPI historical closing odds, then filters the
  potentially large response inside the gateway before it is
  returned to GPT.

  If commence_time is supplied, the ParlayAPI archive date is
  derived from the event's UTC start date.
*/
oddsApiRouter.get(
  '/:sport/clv-lookup',
  async (req, res, next) => {
    try {
      const sport =
        req.params.sport;

      const commenceTime =
        req.query.commence_time ||
        null;

      const suppliedDate =
        req.query.date ||
        null;

      const derivedDate =
        utcDateFromCommenceTime(
          commenceTime
        );

      const date =
        derivedDate ||
        suppliedDate;

      const homeTeam =
        req.query.home_team ||
        null;

      const awayTeam =
        req.query.away_team ||
        null;

      const market =
        req.query.market ||
        req.query.markets ||
        null;

      const bookmaker =
        req.query.bookmaker ||
        req.query.bookmakers ||
        null;

      const player =
        req.query.player ||
        null;

      const requestedLimit =
        Number(req.query.limit);

      const limit =
        Number.isFinite(
          requestedLimit
        )
          ? Math.min(
              Math.max(
                Math.trunc(
                  requestedLimit
                ),
                1
              ),
              100
            )
          : 25;

      if (!date) {
        return res.status(400).json({
          error: {
            message:
              'date or commence_time is required for CLV lookup'
          }
        });
      }

      if (
        commenceTime &&
        !derivedDate
      ) {
        return res.status(400).json({
          error: {
            message:
              'commence_time must be a valid date-time'
          }
        });
      }

      if (!market) {
        return res.status(400).json({
          error: {
            message:
              'market is required for CLV lookup'
          }
        });
      }

      const params = {
        date,

        markets:
          market,

        bookmakers:
          bookmaker ||
          undefined,

        player:
          player ||
          undefined
      };

      const result =
        await withSpecificOddsProvider(
          'parlayApi',

          (provider) =>
            provider.getClosingOdds(
              sport,
              params
            ),

          {
            cacheKey:
              `clv-lookup:parlayApi:${sport}:${JSON.stringify(params)}`,

            cacheTtlMs:
              6 * 60 * 60 * 1000,

            requestType:
              'clv_lookup'
          }
        );

      const rows =
        closingRowsFromData(
          result?.data
        );

      const matchedRows =
        rows
          .filter((row) =>
            closingRowMatches(
              row,
              {
                homeTeam,
                awayTeam,
                market,
                bookmaker,
                player
              }
            )
          )
          .slice(0, limit)
          .map(
            compactClosingRow
          )
          .filter(Boolean);

      res.json({
        provider:
          result?.provider ||
          'parlayApi',

        filters: {
          sport,

          archive_date:
            date,

          supplied_date:
            suppliedDate,

          commence_time:
            commenceTime,

          date_source:
            derivedDate
              ? 'commence_time_utc'
              : 'supplied_date',

          home_team:
            homeTeam,

          away_team:
            awayTeam,

          market,

          bookmaker,

          player,

          limit
        },

        source_row_count:
          rows.length,

        matched_count:
          matchedRows.length,

        data:
          matchedRows,

        quota:
          result?.quota ||
          null,

        cache:
          result?.cache || {
            hit: false
          },

        note:
          matchedRows.length > 0
            ? null
            : 'No closing rows matched the supplied filters. Missing archive coverage or naming differences are possible.'
      });
    } catch (error) {
      next(error);
    }
  }
);

/*
  Raw ParlayAPI historical closing-line endpoint.
*/
oddsApiRouter.get(
  '/:sport/closing-odds',
  async (req, res, next) => {
    try {
      const sport =
        req.params.sport;

      const params =
        copyQueryWithoutProvider(
          req.query
        );

      const result =
        await withSpecificOddsProvider(
          'parlayApi',

          (provider) =>
            provider.getClosingOdds(
              sport,
              params
            ),

          {
            cacheKey:
              `closing-odds:parlayApi:${sport}:${JSON.stringify(params)}`,

            cacheTtlMs:
              5 * 60 * 1000,

            requestType:
              'closing_odds'
          }
        );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

oddsApiRouter.get(
  '/:sport/events/:eventId/odds',
  async (req, res, next) => {
    try {
      const sport =
        req.params.sport;

      const eventId =
        req.params.eventId;

      const queryProvider =
        req.query.provider || null;

      const rememberedProvider =
        getProviderNameForEventId(
          eventId
        );

      const providerName =
        queryProvider ||
        rememberedProvider;

      const rawEventId =
        unwrapGatewayEventId(
          eventId
        );

      const params =
        copyQueryWithoutProvider(
          req.query
        );

      if (providerName) {
        const result =
          await withSpecificOddsProvider(
            providerName,

            (provider) =>
              provider.getEventOdds(
                sport,
                rawEventId,
                params
              ),

            {
              cacheKey:
                `event-odds:${providerName}:${sport}:${rawEventId}:${JSON.stringify(params)}`,

              cacheTtlMs:
                30 * 1000,

              rememberEvents:
                true,

              requestType:
                'event_odds'
            }
          );

        return res.json(result);
      }

      /*
        Event IDs belong to individual providers.

        If the event ID does not tell us which provider
        created it, use the current primary provider only.
      */

      const provider =
        getOddsProvider();

      const selectedProviderName =
        Object.keys(
          config.oddsProviders
        ).find(
          (name) => {
            try {
              return (
                getOddsProvider(name) ===
                provider
              );
            } catch {
              return false;
            }
          }
        );

      if (!selectedProviderName) {
        throw new Error(
          'Unable to determine odds provider for event'
        );
      }

      const result =
        await withSpecificOddsProvider(
          selectedProviderName,

          (selectedProvider) =>
            selectedProvider.getEventOdds(
              sport,
              rawEventId,
              params
            ),

          {
            cacheKey:
              `event-odds:${selectedProviderName}:${sport}:${rawEventId}:${JSON.stringify(params)}`,

            cacheTtlMs:
              30 * 1000,

            rememberEvents:
              true,

            requestType:
              'event_odds'
          }
        );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);
