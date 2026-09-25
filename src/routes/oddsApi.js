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

  const text =
    String(value).trim();

  return text || null;
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

function normalizeClvBetForProvider(bet, index) {
  const normalized = {
    bet_index:
      index,

    sport_key:
      stringOrNull(
        bet?.sport_key
      ),

    player:
      stringOrNull(
        bet?.player
      ),

    market:
      stringOrNull(
        bet?.market ||
        bet?.market_key
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

    home_team:
      stringOrNull(
        bet?.home_team
      ),

    away_team:
      stringOrNull(
        bet?.away_team
      ),

    game_date:
      deriveClvGameDate(
        bet
      )
  };

  return normalized;
}

function validateClvBet(
  originalBet,
  normalizedBet
) {
  const missing = [];

  if (!normalizedBet.sport_key) {
    missing.push('sport_key');
  }

  if (!normalizedBet.market) {
    missing.push('market');
  }

  if (!normalizedBet.outcome) {
    missing.push('outcome');
  }

  if (normalizedBet.taken_odds === null) {
    missing.push('taken_odds');
  }

  if (!normalizedBet.game_date) {
    missing.push('game_date or commence_time');
  }

  if (
    !normalizedBet.home_team ||
    !normalizedBet.away_team
  ) {
    missing.push(
      'home_team and away_team'
    );
  }

  return {
    bet_id:
      stringOrNull(
        originalBet?.bet_id ||
        originalBet?.id
      ),

    valid:
      missing.length === 0,

    missing
  };
}

function extractClvResults(result) {
  const data =
    result?.data;

  if (Array.isArray(data)) {
    return data;
  }

  if (
    data &&
    Array.isArray(data.results)
  ) {
    return data.results;
  }

  if (
    data &&
    Array.isArray(data.bets)
  ) {
    return data.bets;
  }

  if (
    data &&
    Array.isArray(data.data)
  ) {
    return data.data;
  }

  if (
    Array.isArray(result?.results)
  ) {
    return result.results;
  }

  if (
    Array.isArray(result?.bets)
  ) {
    return result.bets;
  }

  return [];
}

function findClvResultForIndex(
  results,
  index
) {
  const exact =
    results.find(
      (row) =>
        Number(
          row?.bet_index
        ) === index
    );

  if (exact) {
    return exact;
  }

  return results[index] || null;
}

function buildClvLogUpdate(
  providerRow,
  normalizedBet
) {
  if (
    !providerRow ||
    typeof providerRow !== 'object'
  ) {
    return {
      clv_status:
        'no_result',

      clv_notes:
        `ParlayAPI CLV grader returned no result for bet_index=${normalizedBet.bet_index}.`
    };
  }

  const status =
    stringOrNull(
      providerRow.status
    ) ||
    'unknown';

  const rawClv =
    numberOrNull(
      firstValue(
        providerRow.clv_pct,
        providerRow.raw_clv_pct,
        providerRow.raw_clv_percent
      )
    );

  const noVigClv =
    numberOrNull(
      firstValue(
        providerRow.no_vig_clv_pct,
        providerRow.no_vig_clv_percent
      )
    );

  const preferredClv =
    noVigClv !== null
      ? noVigClv
      : rawClv;

  const closingLine =
    firstValue(
      providerRow.closing_line,
      providerRow.close_line,
      providerRow.line_at_close
    );

  const closingOdds =
    firstValue(
      providerRow.closing_odds,
      providerRow.close_odds,
      providerRow.closing_price,
      providerRow.close_price
    );

  const closingBook =
    firstValue(
      providerRow.closing_book,
      providerRow.closing_source,
      providerRow.source,
      providerRow.bookmaker
    );

  const metric =
    noVigClv !== null
      ? 'no_vig_clv_pct'
      : rawClv !== null
        ? 'clv_pct'
        : 'none';

  const noteParts = [
    'CLV graded by ParlayAPI',
    `status=${status}`,
    `game_date=${normalizedBet.game_date}`,
    `metric_stored=${metric}`
  ];

  if (rawClv !== null) {
    noteParts.push(
      `raw_clv_pct=${rawClv}`
    );
  }

  if (noVigClv !== null) {
    noteParts.push(
      `no_vig_clv_pct=${noVigClv}`
    );
  }

  const takenImplied =
    numberOrNull(
      providerRow.taken_implied_pct
    );

  const closingImplied =
    numberOrNull(
      providerRow.closing_implied_pct
    );

  const noVigClosingImplied =
    numberOrNull(
      providerRow.no_vig_closing_implied_pct
    );

  if (takenImplied !== null) {
    noteParts.push(
      `taken_implied_pct=${takenImplied}`
    );
  }

  if (closingImplied !== null) {
    noteParts.push(
      `closing_implied_pct=${closingImplied}`
    );
  }

  if (noVigClosingImplied !== null) {
    noteParts.push(
      `no_vig_closing_implied_pct=${noVigClosingImplied}`
    );
  }

  const update = {
    clv_status:
      status,

    clv_notes:
      noteParts.join('; ')
  };

  if (closingLine !== null) {
    update.closing_line =
      closingLine;
  }

  if (closingOdds !== null) {
    update.closing_odds =
      String(closingOdds);
  }

  if (closingBook !== null) {
    update.closing_book =
      String(closingBook);
  }

  if (preferredClv !== null) {
    update.clv_percent =
      preferredClv;
  }

  return update;
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
  Historical ParlayAPI CLV endpoint.

  ParlayAPI expects:
  {
    "bets": [...]
  }
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
  Batch CLV grader + optional bet-log write-back.

  The gateway:
  1. derives UTC game dates when commence_time exists;
  2. validates matching fields;
  3. sends the documented {"bets": [...]} payload to ParlayAPI;
  4. prefers no-vig CLV when available;
  5. writes the result to the existing SharpBet bet log.
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
        Array.isArray(body.bets)
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
            normalizeClvBetForProvider(
              bet,
              index
            )
        );

      const validations =
        inputBets.map(
          (bet, index) =>
            validateClvBet(
              bet,
              normalizedBets[index]
            )
        );

      const invalid =
        validations
          .map((item, index) => ({
            ...item,
            bet_index:
              index
          }))
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
        const missingBetIds =
          validations
            .map(
              (item, index) => ({
                bet_index:
                  index,
                bet_id:
                  item.bet_id
              })
            )
            .filter(
              (item) =>
                !item.bet_id
            );

        if (missingBetIds.length > 0) {
          return res.status(400).json({
            error: {
              message:
                'bet_id is required for every wager when write_back=true',
              details: {
                missing_bet_ids:
                  missingBetIds
              }
            }
          });
        }
      }

      const providerPayload = {
        bets:
          normalizedBets
      };

      const providerResult =
        await withSpecificOddsProvider(
          'parlayApi',

          (provider) =>
            provider.gradeClvHistory(
              providerPayload
            ),

          {
            requestType:
              'clv_grade_and_save'
          }
        );

      const providerRows =
        extractClvResults(
          providerResult
        );

      const results = [];

      for (
        let index = 0;
        index < normalizedBets.length;
        index += 1
      ) {
        const normalizedBet =
          normalizedBets[index];

        const providerRow =
          findClvResultForIndex(
            providerRows,
            index
          );

        const logUpdate =
          buildClvLogUpdate(
            providerRow,
            normalizedBet
          );

        let savedEntry = null;

        if (writeBack) {
          savedEntry =
            await updateBetLogEntry(
              validations[index].bet_id,
              logUpdate
            );
        }

        results.push({
          bet_index:
            index,

          bet_id:
            validations[index].bet_id,

          game_date:
            normalizedBet.game_date,

          sport_key:
            normalizedBet.sport_key,

          market:
            normalizedBet.market,

          outcome:
            normalizedBet.outcome,

          provider_result:
            providerRow,

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
          providerResult?.provider ||
          'parlayApi',

        write_back:
          writeBack,

        submitted:
          normalizedBets.length,

        provider_result_count:
          providerRows.length,

        results,

        quota:
          providerResult?.quota ||
          null,

        cache:
          providerResult?.cache || {
            hit: false
          }
      });
    } catch (error) {
      next(error);
    }
  }
);

/*
  Compact CLV lookup.

  This remains available for inspecting actual individual
  historical closes even though grade-and-save is the preferred
  tracker workflow.
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
