import express from 'express';
import { config } from '../config.js';
import {
  getOddsProvider,
  getOddsProviderStatus,
  getProviderNameForEventId,
  unwrapGatewayEventId,
  withOddsProviderFallback,
  withSpecificOddsProvider
} from '../oddsProviders/index.js';

const router = express.Router();

router.get('/status', (req, res) => {
  res.json(getOddsProviderStatus());
});

router.get('/sports', async (req, res, next) => {
  try {
    const providerName = req.query.provider
      ? String(req.query.provider)
      : null;

    const action = (provider) =>
      provider.getSports({
        all: req.query.all
      });

    const result = providerName
      ? await withSpecificOddsProvider(
          providerName,
          action,
          {
            cacheKey: `sports:${providerName}`,
            cacheTtlMs: 10 * 60 * 1000
          }
        )
      : await withOddsProviderFallback(
          action,
          {
            order: config.oddsSportsProviderOrder,
            cacheKey: 'sports:auto',
            cacheTtlMs: 10 * 60 * 1000
          }
        );

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/:sport/odds', async (req, res, next) => {
  try {
    const providerName = req.query.provider
      ? String(req.query.provider)
      : null;

    const action = (provider) =>
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
        eventIds: req.query.eventIds
      });

    const cacheKey = [
      'odds',
      providerName || 'auto',
      req.params.sport,
      req.query.regions || 'us',
      req.query.markets || 'h2h,spreads,totals',
      req.query.bookmakers || '',
      req.query.commenceTimeFrom || '',
      req.query.commenceTimeTo || '',
      req.query.eventIds || ''
    ].join(':');

    const result = providerName
      ? await withSpecificOddsProvider(
          providerName,
          action,
          {
            cacheKey,
            cacheTtlMs: 30 * 1000,
            rememberEvents: true
          }
        )
      : await withOddsProviderFallback(
          action,
          {
            cacheKey,
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
    const providerName = req.query.provider
      ? String(req.query.provider)
      : null;

    const action = (provider) =>
      provider.getScores(req.params.sport, {
        daysFrom: req.query.daysFrom,
        dateFormat: req.query.dateFormat || 'iso',
        eventIds: req.query.eventIds
      });

    const cacheKey = [
      'scores',
      providerName || 'auto',
      req.params.sport,
      req.query.daysFrom || '',
      req.query.eventIds || ''
    ].join(':');

    const result = providerName
      ? await withSpecificOddsProvider(
          providerName,
          action,
          {
            cacheKey,
            cacheTtlMs: 30 * 1000,
            rememberEvents: true
          }
        )
      : await withOddsProviderFallback(
          action,
          {
            cacheKey,
            cacheTtlMs: 30 * 1000,
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
    const providerName = req.query.provider
      ? String(req.query.provider)
      : null;

    const action = (provider) =>
      provider.getEvents(req.params.sport, {
        dateFormat: req.query.dateFormat || 'iso',
        eventIds: req.query.eventIds,
        commenceTimeFrom: req.query.commenceTimeFrom,
        commenceTimeTo: req.query.commenceTimeTo,
        includeRotationNumbers: req.query.includeRotationNumbers
      });

    const cacheKey = [
      'events',
      providerName || 'auto',
      req.params.sport,
      req.query.eventIds || '',
      req.query.commenceTimeFrom || '',
      req.query.commenceTimeTo || ''
    ].join(':');

    const result = providerName
      ? await withSpecificOddsProvider(
          providerName,
          action,
          {
            cacheKey,
            cacheTtlMs: 60 * 1000,
            rememberEvents: true
          }
        )
      : await withOddsProviderFallback(
          action,
          {
            cacheKey,
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
    const requestedProvider = req.query.provider
      ? String(req.query.provider)
      : null;

    const rememberedProvider =
      getProviderNameForEventId(req.params.eventId);

    const providerName =
      requestedProvider ||
      rememberedProvider ||
      null;

    const eventId = unwrapGatewayEventId(req.params.eventId);

    let result;

    if (providerName) {
      result = await withSpecificOddsProvider(
        providerName,
        (provider) =>
          provider.getEventOdds(
            req.params.sport,
            eventId,
            {
              regions: req.query.regions || 'us',
              markets: req.query.markets,
              oddsFormat: req.query.oddsFormat || 'american',
              dateFormat: req.query.dateFormat || 'iso',
              bookmakers: req.query.bookmakers,
              includeMultipliers: req.query.includeMultipliers
            }
          ),
        {
          cacheKey: [
            'eventOdds',
            providerName,
            req.params.sport,
            eventId,
            req.query.markets || '',
            req.query.bookmakers || ''
          ].join(':'),
          cacheTtlMs: 30 * 1000
        }
      );
    } else {
      const provider = getOddsProvider();

      result = await provider.getEventOdds(
        req.params.sport,
        eventId,
        {
          regions: req.query.regions || 'us',
          markets: req.query.markets,
          oddsFormat: req.query.oddsFormat || 'american',
          dateFormat: req.query.dateFormat || 'iso',
          bookmakers: req.query.bookmakers,
          includeMultipliers: req.query.includeMultipliers
        }
      );
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

export const oddsApiRouter = router;
