import { config } from '../config.js';
import { HttpError } from '../errors.js';
import {
  addQueryParams,
  fetchJson,
  getHeader,
  parseNumberOrNull
} from './providerUtils.js';

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
  addQueryParams(url, params);

  const { response, body } = await fetchJson({
    provider: 'parlayApi',
    url,
    headers: {
      Accept: 'application/json',
      'X-API-Key': providerConfig.apiKey
    },
    timeoutMs: config.oddsRequestTimeoutMs
  });

  return {
    provider: 'parlayApi',
    data: body,
    quota: {
      remaining: parseNumberOrNull(
        getHeader(
          response,
          'x-credits-remaining',
          'x-requests-remaining'
        )
      ),
      used: parseNumberOrNull(getHeader(response, 'x-requests-used')),
      last: parseNumberOrNull(
        getHeader(response, 'x-credits-cost', 'x-requests-last')
      ),
      rateLimitRemaining: parseNumberOrNull(
        getHeader(response, 'x-rate-limit-remaining')
      ),
      rateLimitReset: getHeader(response, 'x-rate-limit-reset')
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
    return call(`/v1/sports/${sport}/odds`, {
      ...params,
      eventIds: eventId
    });
  }
};
