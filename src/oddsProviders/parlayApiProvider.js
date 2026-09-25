import { config } from '../config.js';
import { HttpError } from '../errors.js';

function requireApiKey() {
  const providerConfig = config.oddsProviders.parlayApi;

  if (!providerConfig.enabled) {
    throw new HttpError(503, 'ParlayAPI provider is disabled');
  }

  if (!providerConfig.apiKey) {
    throw new HttpError(
      500,
      'PARLAY_API_KEY is not configured on the server'
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

async function call(pathname, params = {}) {
  const providerConfig = requireApiKey();

  const url = new URL(pathname, providerConfig.baseUrl);

  addParams(url, params);

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    config.oddsRequestTimeoutMs
  );

  let response;

  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-API-Key': providerConfig.apiKey
      },
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeout);

    throw new HttpError(
      502,
      'ParlayAPI request failed',
      {
        provider: 'parlayApi',
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
      'ParlayAPI request failed',
      {
        provider: 'parlayApi',
        status: response.status,
        upstreamStatus: response.status,
        statusText: response.statusText,
        retryAfter: response.headers.get('retry-after'),
        body
      }
    );
  }

  return {
    provider: 'parlayApi',
    data: body,
    quota: {
      remaining:
        response.headers.get('x-credits-remaining') ??
        response.headers.get('x-requests-remaining'),
      used:
        response.headers.get('x-credits-used') ??
        response.headers.get('x-requests-used'),
      last:
        response.headers.get('x-credits-cost') ??
        response.headers.get('x-requests-last')
    }
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
    return call(
      `/v1/sports/${sport}/events/${eventId}/odds`,
      params
    );
  },

  getClosingOdds(sport, params = {}) {
    return call(
      `/v1/historical/sports/${sport}/closing-odds`,
      params
    );
  }
};

