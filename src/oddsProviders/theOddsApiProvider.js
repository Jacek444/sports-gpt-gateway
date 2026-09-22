import { config } from '../config.js';
import { HttpError } from '../errors.js';

function requireApiKey() {
  const providerConfig = config.oddsProviders.theOddsApi;

  if (!providerConfig.enabled) {
    throw new HttpError(503, 'The Odds API provider is disabled');
  }

  if (!providerConfig.apiKey) {
    throw new HttpError(500, 'ODDS_API_KEY is not configured on the server');
  }

  return providerConfig;
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

async function call(pathname, params = {}) {
  const providerConfig = requireApiKey();

  const url = new URL(pathname, providerConfig.baseUrl);
  const query = copyAllowedParams(params, Object.keys(params));

  query.set('apiKey', providerConfig.apiKey);
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
      provider: 'theOddsApi',
      status: response.status,
      statusText: response.statusText,
      body
    });
  }

  return {
    provider: 'theOddsApi',
    data: body,
    quota: {
      remaining: response.headers.get('x-requests-remaining'),
      used: response.headers.get('x-requests-used'),
      last: response.headers.get('x-requests-last')
    }
  };
}

export const theOddsApiProvider = {
  getSports(params = {}) {
    return call('/v4/sports', params);
  },

  getOddsBoard(sport, params = {}) {
    return call(`/v4/sports/${sport}/odds`, params);
  },

  getScores(sport, params = {}) {
    return call(`/v4/sports/${sport}/scores`, params);
  },

  getEvents(sport, params = {}) {
    return call(`/v4/sports/${sport}/events`, params);
  },

  getEventOdds(sport, eventId, params = {}) {
    return call(`/v4/sports/${sport}/events/${eventId}/odds`, params);
  }
};
