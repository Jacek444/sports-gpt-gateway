import { config } from '../config.js';
import { HttpError } from '../errors.js';

function requireApiKey() {
  const providerConfig = config.oddsProviders.oddsApiIo;

  if (!providerConfig.enabled) {
    throw new HttpError(503, 'Odds-API.io provider is disabled');
  }

  if (!providerConfig.apiKey) {
    throw new HttpError(
      500,
      'ODDS_API_IO_KEY is not configured on the server'
    );
  }

  return providerConfig;
}

function addParams(url, params = {}) {
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
}

async function call(pathname, params = {}, requireKey = true) {
  const providerConfig = config.oddsProviders.oddsApiIo;

  if (requireKey) {
    requireApiKey();
  }

  const url = new URL(pathname, providerConfig.baseUrl);

  addParams(url, params);

  if (requireKey) {
    url.searchParams.set('apiKey', providerConfig.apiKey);
  }

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    config.oddsRequestTimeoutMs
  );

  let response;

  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json'
      },
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeout);

    throw new HttpError(
      502,
      'Odds-API.io request failed',
      {
        provider: 'oddsApiIo',
        status: 0,
        upstreamStatus: 0,
        body: error?.message || String(error)
      }
    );
  }

  clearTimeout(timeout);

  const text = await response.text();

  let body;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new HttpError(
      502,
      'Odds-API.io request failed',
      {
        provider: 'oddsApiIo',
        status: response.status,
        upstreamStatus: response.status,
        statusText: response.statusText,
        retryAfter: response.headers.get('retry-after'),
        body
      }
    );
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

  getEventOdds(sport, eventId, params = {}) {
    return call('/v3/odds', {
      eventId,
      ...params
    });
  }
};
