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
  ParlayAPI historical closing-line endpoint.

  This remains useful for direct historical closing-line
  inspection even though the CLV grader can handle most
  automatic grading use cases.
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
