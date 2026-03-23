import { config } from '../config.js';
import { HttpError } from '../errors.js';
import { MockProvider } from './mockProvider.js';
import { BallDontLieProvider } from './ballDontLieProvider.js';
import { SportsDataIoProvider } from './sportsDataIoProvider.js';

const providers = {
  mock: new MockProvider(),
  balldontlie: new BallDontLieProvider(config.ballDontLie),
  sportsdataio: new SportsDataIoProvider(config.sportsDataIo)
};

function pickProviderName(league) {
  return config.providersByLeague[league] || config.defaultProvider;
}

function isConfigured(name) {
  if (name === 'balldontlie') {
    return Boolean(config.ballDontLie.apiKey);
  }
  if (name === 'sportsdataio') {
    return Boolean(config.sportsDataIo.apiKey);
  }
  return true;
}

export function getProviderNameForLeague(league) {
  const preferred = pickProviderName(league);
  if (isConfigured(preferred)) {
    return preferred;
  }
  if (config.mockWhenUnconfigured) {
    return 'mock';
  }
  return preferred;
}

export function getProviderForLeague(league) {
  const name = getProviderNameForLeague(league);
  const provider = providers[name];
  if (!provider) {
    throw new HttpError(500, `Unknown provider "${name}"`);
  }
  return provider;
}

export function getProviderDefaults() {
  return Object.fromEntries(
    Object.keys(config.providersByLeague).map((league) => [league, getProviderNameForLeague(league)])
  );
}
