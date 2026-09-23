import express from 'express';
import {
  getOddsProvider,
  withOddsProviderFallback
} from '../oddsProviders/index.js';

const router = express.Router();

router.get('/sports', async (req, res, next) => {
  try {
    const provider = getOddsProvider();

    const result = await provider.getSports({
      all: req.query.all
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/:sport/odds', async (req, res, next) => {
  try {
    const result = await withOddsProviderFallback((provider) =>
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
      })
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/:sport/scores', async (req, res, next) => {
  try {
    const provider = getOddsProvider();

    const result = await provider.getScores(req.params.sport, {
      daysFrom: req.query.daysFrom,
      dateFormat: req.query.dateFormat || 'iso',
      eventIds: req.query.eventIds
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/:sport/events', async (req, res, next) => {
  try {
    const provider = getOddsProvider();

    const result = await provider.getEvents(req.params.sport, {
      dateFormat: req.query.dateFormat || 'iso',
      eventIds: req.query.eventIds,
      commenceTimeFrom: req.query.commenceTimeFrom,
      commenceTimeTo: req.query.commenceTimeTo,
      includeRotationNumbers: req.query.includeRotationNumbers
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/:sport/events/:eventId/odds', async (req, res, next) => {
  try {
    const provider = getOddsProvider();

    const result = await provider.getEventOdds(
      req.params.sport,
      req.params.eventId,
      {
        regions: req.query.regions || 'us',
        markets: req.query.markets,
        oddsFormat: req.query.oddsFormat || 'american',
        dateFormat: req.query.dateFormat || 'iso',
        bookmakers: req.query.bookmakers,
        includeMultipliers: req.query.includeMultipliers
      }
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
});

export const oddsApiRouter = router;
