import { config } from '../config.js';
import { HttpError } from '../errors.js';
import {
  addQueryParams,
  fetchJson,
  getHeader,
  parseNumberOrNull
} from './providerUtils.js';

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

async function call(pathname, params = {}) {
  const providerConfig = requireApiKey();

  const url = new URL(pathname, providerConfig.baseUrl);
  addQueryParams(url, params);
  url.searchParams.set('apiKey', providerConfig.apiKey);

  const { response, body } = await fetchJson({
    provider: 'theOddsApi',
    url,
    headers: { Accept: 'application/json' },
    timeoutMs: config.oddsRequestTimeoutMs
  });

  return {
    provider: 'theOddsApi',
    data: body,
    quota: {
      remaining: parseNumberOrNull(
        getHeader(response, 'x-requests-remaining')
      ),
      used: parseNumberOrNull(getHeader(response, 'x-requests-used')),
      last: parseNumberOrNull(getHeader(response, 'x-requests-last'))
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
