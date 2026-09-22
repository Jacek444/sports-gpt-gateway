import { config } from '../config.js';
import { HttpError } from '../errors.js';

function requireApiKey() {
  const providerConfig = config.oddsProviders.oddsApiIo;

  if (!providerConfig.enabled) {
    throw new HttpError(503, 'Odds-API.io provider is disabled');
  }

  if (!providerConfig.apiKey) {
    throw new HttpError(500, 'ODDS_API_IO_KEY is not configured on the server');
  }

  return providerConfig;
}

async function call(pathname, params = {}, requireKey = true) {
  const providerConfig = config.oddsProviders.oddsApiIo;

  if (requireKey) {
    requireApiKey();
  }

  const url = new URL(pathname, providerConfig.baseUrl);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  if (requireKey) {
    url.searchParams.set('apiKey', providerConfig.apiKey);
  }

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
    throw new HttpError(502, 'Odds-API.io request failed', {
      provider: 'oddsApiIo',
      status: response.status,
      statusText: response.statusText,
      body
    });
  }

  return {
    provider: 'oddsApiIo',
    data: body,
    quota: null
  };
}

export const oddsApiIoProvider = {
  getSports() {
    return call('/v3/sports', {}, false);
  },

  getLeagues(sport, params = {}) {
    return call('/v3/leagues', {
      sport,
      ...params
    });
  },

  getEvents(sport, params = {}) {
    return call('/v3/events', {
      sport,
      ...params
    });
  },

  getEventOdds(eventId, params = {}) {
    return call('/v3/odds', {
      eventId,
      ...params
    });
  }
};
