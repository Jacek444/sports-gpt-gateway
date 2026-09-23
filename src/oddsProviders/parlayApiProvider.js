import { config } from '../config.js';
import { HttpError } from '../errors.js';

function requireApiKey() {
  const providerConfig = config.oddsProviders.parlayApi;

  if (!providerConfig.enabled) {
    throw new HttpError(503, 'ParlayAPI provider is disabled');
  }

  if (!providerConfig.apiKey) {
    throw new HttpError(500, 'PARLAY_API_KEY is not configured on the server');
  }

  return providerConfig;
}

async function call(pathname, params = {}) {
  const providerConfig = requireApiKey();

  const url = new URL(pathname, providerConfig.baseUrl);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-API-Key': providerConfig.apiKey
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
    throw new HttpError(502, 'ParlayAPI request failed', {
      provider: 'parlayApi',
      status: response.status,
      statusText: response.statusText,
      body
    });
  }

  return {
    provider: 'parlayApi',
    data: body,
    quota: null
  };
}

export const parlayApiProvider = {
  getSports(params = {}) {
    return call('/v1/sports', params);
  },

  getOddsBoard(sport, params = {}) {
    return call(`/v1/sports/${sport}/odds`, params);
  },

  getScores(sport, params = {}) {
    return call(`/v1/sports/${sport}/scores`, params);
  },

  getEvents(sport, params = {}) {
    return call(`/v1/sports/${sport}/events`, params);
  },

  getEventOdds(sport, eventId, params = {}) {
    return call(`/v1/sports/${sport}/events/${eventId}/odds`, params);
  }
};
