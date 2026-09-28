import { config } from '../config.js';
import { HttpError } from '../errors.js';
import { MockProvider } from './mockProvider.js';
import { BallDontLieProvider } from './ballDontLieProvider.js';
import { SportsDataIoProvider } from './sportsDataIoProvider.js';
import { OddsScheduleProvider } from './oddsScheduleProvider.js';

const providers = {
  mock: new MockProvider(),
  odds: new OddsScheduleProvider(),
  balldontlie: new BallDontLieProvider(config.ballDontLie),
  sportsdataio: new SportsDataIoProvider(config.sportsDataIo)
};

function pickProviderName(league) {
  return config.providersByLeague[league] || config.defaultProvider;
}

function isConfigured(name) {
  if (name === 'odds') {
    return config.oddsProviderOrder.some((provider) => {
      const entry = config.oddsProviders[provider];
      return entry?.enabled && hasKey(entry.apiKey);
    });
  }
  if (name === 'balldontlie') {
    return hasKey(config.ballDontLie.apiKey);
  }
  if (name === 'sportsdataio') {
    return hasKey(config.sportsDataIo.apiKey);
  }
  return name === 'mock' && config.allowMockData;
}

function hasKey(value) {
  return Boolean(value?.trim()) && value.trim() !== 'replace_me';
}

export function getProviderNameForLeague(league) {
  const preferred = pickProviderName(league);
  if (!Object.hasOwn(providers, preferred)) return preferred;
  if (preferred === 'mock' && !config.allowMockData) {
    return 'odds';
  }
  if (isConfigured(preferred)) {
    return preferred;
  }
  if (config.allowMockData && config.mockWhenUnconfigured) {
    return 'mock';
  }
  return 'odds';
}

export function getLeagueProviderStatus() {
  return Object.fromEntries(Object.keys(config.providersByLeague).map((league) => {
    const provider = getProviderNameForLeague(league);
    const configured = isConfigured(provider);
    return [league, {
      provider,
      configured,
      status: !providers[provider] ? 'unknown_provider'
        : provider === 'mock' ? 'test_data'
        : provider === 'sportsdataio' ? 'not_implemented'
        : configured ? 'configured_not_probed' : 'unavailable',
      capabilities: provider === 'odds' ? ['betting_events']
        : provider === 'balldontlie' ? ['games', 'teams', 'standings'] : [],
      note: provider === 'odds'
        ? 'Betting-event coverage only; not a complete league schedule. Teams, standings and detailed game state require a general-data provider.'
        : null
    }];
  }));
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
