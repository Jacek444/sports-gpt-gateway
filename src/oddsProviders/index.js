import { config } from '../config.js';
import { HttpError } from '../errors.js';
import { theOddsApiProvider } from './theOddsApiProvider.js';
import { oddsApiIoProvider } from './oddsApiIoProvider.js';
import { sportsGameOddsProvider } from './sportsGameOddsProvider.js';
import { parlayApiProvider } from './parlayApiProvider.js';

const providers = {
  theOddsApi: theOddsApiProvider,
  oddsApiIo: oddsApiIoProvider,
  sportsGameOdds: sportsGameOddsProvider,
  parlayApi: parlayApiProvider
};

function isConfigured(name) {
  const providerConfig = config.oddsProviders[name];

  if (!providerConfig) {
    return false;
  }

  return providerConfig.enabled && Boolean(providerConfig.apiKey);
}

export function getOddsProvider(name) {
  if (name) {
    const provider = providers[name];

    if (!provider) {
      throw new HttpError(500, `Unknown odds provider "${name}"`);
    }

    if (!isConfigured(name)) {
      throw new HttpError(503, `Odds provider "${name}" is not configured`);
    }

    return provider;
  }

  for (const providerName of config.oddsProviderOrder) {
    if (isConfigured(providerName) && providers[providerName]) {
      return providers[providerName];
    }
  }

  throw new HttpError(503, 'No odds providers are configured');
}
export async function withOddsProviderFallback(action) {
  const errors = [];

  for (const providerName of config.oddsProviderOrder) {
    if (!isConfigured(providerName)) {
      continue;
    }

    const provider = providers[providerName];

    if (!provider) {
      continue;
    }

    try {
      return await action(provider, providerName);
    } catch (error) {
      errors.push({
        provider: providerName,
        message: error.message,
        status: error.status
      });
    }
  }

  throw new HttpError(502, 'All configured odds providers failed', {
    providersTried: errors
  });
} 
