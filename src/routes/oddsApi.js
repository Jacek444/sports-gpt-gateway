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

  const teams =
    event.teams &&
    typeof event.teams === 'object'
      ? event.teams
      : {};

  const homeTeam =
    firstValue(
      event.home_team,
      event.homeTeam,
      event.home,
      teams.home,
      event.homeTeamName
    );

  const awayTeam =
    firstValue(
      event.away_team,
      event.awayTeam,
      event.away,
      teams.away,
      event.awayTeamName
    );

  const commenceTime =
    firstValue(
      event.commence_time,
      event.commenceTime,
      event.start_time,
      event.startTime,
      event.startsAt,
      event.starts_at,
      event.scheduled,
      event.scheduledAt,
      event.eventTime,
      event.date
    );

  const status =
    firstValue(
      event.status,
      event.eventStatus,
      event.gameStatus,
      event.state,
      event.statusText,
      event.phase
    );

  const providerEventId =
    firstValue(
      event.provider_event_id,
      event.eventID,
      event.eventId,
      event.id
    );

  const gatewayEventId =
    firstValue(
      event.gateway_event_id,
      providerEventId
        ? `${providerName}:${providerEventId}`
        : null
    );

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
      teamName(homeTeam),

    away_team:
      teamName(awayTeam),

    commence_time:
      commenceTime,

    status:
      typeof status === 'object'
        ? firstValue(
            status.display,
            status.name,
            status.code,
            status.state
          )
        : status
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
