import express from 'express';
import { config } from '../config.js';
import { HttpError } from '../errors.js';

const router = express.Router();

function requireOddsApiKey() {
  if (!config.oddsApi.apiKey) {
    throw new HttpError(500, 'ODDS_API_KEY is not configured on the server');
  }
}

function copyAllowedParams(source, allowedKeys) {
  const target = new URLSearchParams();
  for (const key of allowedKeys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== '') {
      target.set(key, String(value));
    }
  }
  return target;
}

async function callOddsApi(pathname, params) {
  requireOddsApiKey();

  const url = new URL(pathname, config.oddsApi.baseUrl);
  const query = copyAllowedParams(params, Object.keys(params));
  query.set('apiKey', config.oddsApi.apiKey);
  url.search = query.toString();

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  });

  const text = await response.text();
  let body;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new HttpError(502, 'The Odds API request failed', {
      status: response.status,
      statusText: response.statusText,
      body
    });
  }

  return {
    data: body,
    quota: {
      remaining: response.headers.get('x-requests-remaining'),
      used: response.headers.get('x-requests-used'),
      last: response.headers.get('x-requests-last')
    }
  };
}

router.get('/sports', async (req, res, next) => {
  try {
    const result = await callOddsApi('/v4/sports', {
      all: req.query.all
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/:sport/odds', async (req, res, next) => {
  try {
    const result = await callOddsApi(`/v4/sports/${req.params.sport}/odds`, {
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
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/:sport/scores', async (req, res, next) => {
  try {
    const result = await callOddsApi(`/v4/sports/${req.params.sport}/scores`, {
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
    const result = await callOddsApi(`/v4/sports/${req.params.sport}/events`, {
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
    const result = await callOddsApi(
      `/v4/sports/${req.params.sport}/events/${req.params.eventId}/odds`,
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
