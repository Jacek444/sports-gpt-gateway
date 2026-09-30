import { LeagueDataChain } from './leagueDataChain.js';
import { config } from '../config.js';
import { HttpError } from '../errors.js';
import { MockProvider } from './mockProvider.js';
import { BallDontLieProvider } from './ballDontLieProvider.js';
import { SportsDataIoProvider } from './sportsDataIoProvider.js';
import { ApiSportsProvider } from './apiSportsProvider.js';
import { OddsScheduleProvider } from './oddsScheduleProvider.js';

export const apiSportsProvider = new ApiSportsProvider(config.apiSports);

export const ballDontLieProvider = new BallDontLieProvider(config.ballDontLie);
const providers = {
  apisports: apiSportsProvider,
  mock: new MockProvider(),
  odds: new OddsScheduleProvider(),
  balldontlie: ballDontLieProvider,
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
  if (name === 'apisports') return config.apiSports.enabled && hasKey(config.apiSports.apiKey);
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
  if (isConfigured('balldontlie')) return 'balldontlie';
  if (isConfigured('apisports')) return 'apisports';
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
      capabilities: provider === 'apisports' ? ['games', 'scores', 'teams'] : provider === 'odds' ? ['betting_events']
        : provider === 'balldontlie' ? ['games', 'scores', 'teams', 'standings_requires_plan'] : [],
      fallback_order: getChainNames(league),
      runtime: provider === 'balldontlie' ? ballDontLieProvider.status() : null,
      note: provider === 'odds'
        ? 'Betting-event coverage only; not a complete league schedule. Teams, standings and detailed game state require a general-data provider.'
        : provider === 'balldontlie' ? 'Endpoint access varies by sport and plan. Free-tier rate guard: five requests/minute; cached reads remain available. Odds use the separate odds-provider chain.' : null
    }];
  }));
}

function getChainNames(league) {
  const first=getProviderNameForLeague(league);
  if(['odds','mock','sportsdataio'].includes(first)||!providers[first])return [first];
  return [...new Set([first,'balldontlie','apisports','odds'])].filter(name=>name===first||isConfigured(name));
}

export function getProviderForLeague(league, gameId) {
  if (String(gameId || '').startsWith('apisports:')) return apiSportsProvider;
  if (String(gameId || '').startsWith('balldontlie:')) return ballDontLieProvider;
  if (gameId && String(gameId).includes(':')) throw new HttpError(400,'This is a betting-event ID. Use the event-odds tool or rediscover a league-data game ID.');
  const name = getProviderNameForLeague(league);
  const provider = providers[name];
  if (!provider) {
    throw new HttpError(500, `Unknown provider "${name}"`);
  }
  if (gameId || ['odds','mock','sportsdataio'].includes(name)) return provider;
  return new LeagueDataChain(getChainNames(league).map(name=>({name,provider:providers[name]})));
}

export function getProviderDefaults() {
  return Object.fromEntries(
    Object.keys(config.providersByLeague).map((league) => [league, getProviderNameForLeague(league)])
  );
}
