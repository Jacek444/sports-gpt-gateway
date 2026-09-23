import express from 'express';
import { config } from '../config.js';
import {
  getOddsProviderStatus,
  getProviderNameForEventId,
  unwrapGatewayEventId,
  withOddsProviderFallback,
  withSpecificOddsProvider
} from '../oddsProviders/index.js';

const router = express.Router();

function cacheKey(req, suffix = '') {
  return `${req.method}:${req.originalUrl}${suffix ? `:${suffix}` : ''}`;
}

async function runProviderRequest(
  req,
  action,
  {
    order = config.oddsProviderOrder,
    cacheTtlMs = 0,
    rememberEvents = false
  } = {}
) {
  const requestedProvider = req.query.provider;

  if (requestedProvider) {
    return withSpecificOddsProvider(
      String(requestedProvider),
      action,
      {
        cacheKey: cacheKey(req),
        cacheTtlMs,
        rememberEvents
      }
    );
  }

  return withOddsProviderFallback(action, {
    order,
    cacheKey: cacheKey(req),
    cacheTtlMs,
    rememberEvents
  });
}

router.get('/providers/status', (req, res) => {
  res.json(getOddsProviderStatus());
});

router.get('/sports', async (req, res, next) => {
  try {
    const result = await runProviderRequest(
      req,
      (provider) =>
        provider.getSports({
          all: req.query.all
        }),
      {
        order: config.oddsSportsProviderOrder,
        cacheTtlMs: 6 * 60 * 60 * 1000
      }
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/:sport/odds', async (req, res, next) => {
  try {
    const result = await runProviderRequest(
      req,
      (provider) =>
        provider.getOddsBoard(req.params.sport, {
          regions: req.query.regions || 'us',
          markets: req.query.markets || 'h2h,spreads,totals',
          oddsFormat: req.query.oddsFormat || 'american',
          dateFormat: req.query.dateFormat || 'iso',
          bookmakers: req.query.bookmakers,
          commenceTimeFrom: req.query.commenceTimeFrom,
          commenceTimeTo: req.query.commenceTimeTo,
          includeLinks: req.query.includeLinks,
          includeSids: req.query.includeSids,
          includeBetLimits: req.query.includeBetLimits,
          includeRotationNumbers: req.query.includeRotationNumbers,
          eventIds: req.query.eventIds,
          includeAltLines: req.query.includeAltLines,
          limit: req.query.limit ? Number(req.query.limit) : undefined,
          cursor: req.query.cursor
        }),
      {
        cacheTtlMs: 30 * 1000,
        rememberEvents: true
      }
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/:sport/scores', async (req, res, next) => {
  try {
    const result = await runProviderRequest(
      req,
      (provider) =>
        provider.getScores(req.params.sport, {
          daysFrom: req.query.daysFrom,
          dateFormat: req.query.dateFormat || 'iso',
          eventIds: req.query.eventIds,
          limit: req.query.limit ? Number(req.query.limit) : undefined
        }),
      {
        cacheTtlMs: 15 * 1000,
        rememberEvents: true
      }
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/:sport/events', async (req, res, next) => {
  try {
    const result = await runProviderRequest(
      req,
      (provider) =>
        provider.getEvents(req.params.sport, {
          dateFormat: req.query.dateFormat || 'iso',
          eventIds: req.query.eventIds,
          commenceTimeFrom: req.query.commenceTimeFrom,
          commenceTimeTo: req.query.commenceTimeTo,
          includeRotationNumbers: req.query.includeRotationNumbers,
          bookmakers: req.query.bookmakers,
          markets: req.query.markets,
          includeAltLines: req.query.includeAltLines,
          limit: req.query.limit ? Number(req.query.limit) : undefined,
          cursor: req.query.cursor
        }),
      {
        cacheTtlMs: 60 * 1000,
        rememberEvents: true
      }
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/:sport/events/:eventId/odds', async (req, res, next) => {
  try {
    const requestedEventId = req.params.eventId;
    const providerName =
      req.query.provider ||
      getProviderNameForEventId(requestedEventId);

    const rawEventId = unwrapGatewayEventId(requestedEventId);

    if (!providerName) {
      return res.status(400).json({
        error: {
          message:
            'Provider is required for event-specific odds when the event ID was not previously returned by this gateway. Pass ?provider=theOddsApi, ?provider=parlayApi, or ?provider=sportsGameOdds.',
          status: 400
        }
      });
    }

    const result = await withSpecificOddsProvider(
      String(providerName),
      (provider) =>
        provider.getEventOdds(
          req.params.sport,
          rawEventId,
          {
            regions: req.query.regions || 'us',
            markets: req.query.markets,
            oddsFormat: req.query.oddsFormat || 'american',
            dateFormat: req.query.dateFormat || 'iso',
            bookmakers: req.query.bookmakers,
            includeMultipliers: req.query.includeMultipliers,
            includeAltLines: req.query.includeAltLines
          }
        ),
      {
        cacheKey: cacheKey(req, String(providerName)),
        cacheTtlMs: 20 * 1000,
        rememberEvents: true
      }
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
});

export const oddsApiRouter = router;
