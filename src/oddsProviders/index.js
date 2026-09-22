import { config } from '../config.js';
import { HttpError } from '../errors.js';
import { theOddsApiProvider } from './theOddsApiProvider.js';

const providers = {
  theOddsApi: theOddsApiProvider
};

function isConfigured(name) {
  const providerConfig = config.oddsProviders[name];

  if (!providerConfig) {
    return false;
  }

  return providerConfig.enabled && Boolean(providerConfig.apiKey);
}

export function getOddsProvider(name = 'theOddsApi') {
  const provider = providers[name];

  if (!provider) {
    throw new HttpError(500, `Unknown odds provider "${name}"`);
  }

  if (!isConfigured(name)) {
    throw new HttpError(503, `Odds provider "${name}" is not configured`);
  }

  return provider;
}
