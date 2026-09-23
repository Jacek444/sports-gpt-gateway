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

  return params;
}

oddsApiRouter.get('/status', async (req, res, next) => {
  try {
    const runtime = getOddsProviderStatus();

    const history =
      await getOddsProviderUsageSummary();

    res.json({
      runtime,
      history
    });
  } catch (error) {
    next(error);
  }
});

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

      const params =
        copyQueryWithoutProvider(
          req.query
        );

      if (providerName) {
        const result =
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

        return res.json(result);
      }

      const result =
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
        Event IDs are provider-specific.

        If we do not know which provider created the ID,
        use the current primary provider only instead of
        sending the same event ID across several providers.
      */

      const provider =
        getOddsProvider();

      const selectedProviderName =
        Object.entries({
          sportsGameOdds:
            config.oddsProviders
              .sportsGameOdds,

          parlayApi:
            config.oddsProviders
              .parlayApi,

          theOddsApi:
            config.oddsProviders
              .theOddsApi,

          oddsApiIo:
            config.oddsProviders
              .oddsApiIo
        }).find(
          ([name]) => {
            try {
              return (
                getOddsProvider(name) ===
                provider
              );
            } catch {
              return false;
            }
          }
        )?.[0];

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
