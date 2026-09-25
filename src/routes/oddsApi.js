import express from 'express';
import { config } from '../config.js';
import { getOddsProviderUsageSummary } from '../storage.js';

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
  Historical CLV grading route.

  This intentionally uses ParlayAPI directly so CLV grading
  does not consume the normal SportsGameOdds live-odds workflow.
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
  Compact CLV lookup.

  Pulls ParlayAPI historical closing odds, then filters the
  potentially large response inside the gateway before it is
  returned to GPT.

  If commence_time is supplied, the ParlayAPI archive date is
  derived from the event's UTC start date. This avoids date
  mismatches for late U.S. games that occur on the following
  calendar date in UTC.
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

      /*
        Prefer commence_time because ParlayAPI's historical
        archive may use the UTC event date.

        Fall back to an explicitly supplied date for older
        bets that do not yet have commence_time stored.
      */
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

            /*
              Historical closes do not change once captured.
              A long cache keeps repeated CLV analysis from
              repeatedly consuming ParlayAPI credits.
            */
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
  ParlayAPI historical closing-line endpoint.
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
