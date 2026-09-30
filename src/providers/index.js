import { LeagueDataChain } from './leagueDataChain.js';
import { config } from '../config.js';
import { HttpError } from '../errors.js';
import { MockProvider } from './mockProvider.js';
import { BallDontLieProvider } from './ballDontLieProvider.js';
import { SportsDataIoProvider } from './sportsDataIoProvider.js';
import { ApiSportsProvider } from './apiSportsProvider.js';
import { OddsScheduleProvider } from './oddsScheduleProvider.js';
import { moneylineProvider } from './moneylineProvider.js';
import { theSportsDbProvider } from './theSportsDbProvider.js';

export const apiSportsProvider = new ApiSportsProvider(config.apiSports);

export const ballDontLieProvider = new BallDontLieProvider(config.ballDontLie);
const providers = {
  moneyline: moneylineProvider,
  thesportsdb: theSportsDbProvider,
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
  if (name === 'moneyline') return config.moneyline.enabled && hasKey(config.moneyline.apiKey);
  if (name === 'thesportsdb') return config.theSportsDb.enabled && hasKey(config.theSportsDb.apiKey);
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
  if (isConfigured('moneyline')) return 'moneyline';
  if (isConfigured('apisports')) return 'apisports';
  if (isConfigured('thesportsdb')) return 'thesportsdb';
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
      capabilities: ['apisports','moneyline'].includes(provider) ? ['games', 'scores', 'teams'] : provider === 'thesportsdb' ? ['limited_games','limited_teams','game_lookup'] : provider === 'odds' ? ['betting_events']
        : provider === 'balldontlie' ? ['games', 'scores', 'teams', 'standings_requires_plan'] : [],
      fallback_order: getChainNames(league),
      runtime: ['balldontlie','moneyline','thesportsdb'].includes(provider) ? providers[provider].status() : null,
      note: provider === 'odds'
        ? 'Betting-event coverage only; not a complete league schedule. Teams, standings and detailed game state require a general-data provider.'
        : provider === 'balldontlie' ? 'Endpoint access varies by sport and plan. Free-tier rate guard: five requests/minute; cached reads remain available. Odds use the separate odds-provider chain.' : null
    }];
  }));
}

function getChainNames(league) {
  const first=getProviderNameForLeague(league);
  if(['odds','mock','sportsdataio'].includes(first)||!providers[first])return [first];
  return [...new Set([first,'balldontlie','moneyline','apisports','odds','thesportsdb'])].filter(name=>name===first||isConfigured(name));
}

export function getProviderForLeague(league, gameId) {
  if (String(gameId || '').startsWith('apisports:')) return apiSportsProvider;
  if (String(gameId || '').startsWith('balldontlie:')) return ballDontLieProvider;
  if (String(gameId || '').startsWith('moneyline:')) return moneylineProvider;
  if (String(gameId || '').startsWith('thesportsdb:')) return theSportsDbProvider;
  if (gameId && String(gameId).includes(':')) throw new HttpError(400,'This is a betting-event ID. Use the event-odds tool or rediscover a league-data game ID.');
  const name = getProviderNameForLeague(league);
  const provider = providers[name];
  if (!provider) {
    throw new HttpError(500, `Unknown provider "${name}"`);
  }
  if (gameId || ['odds','mock','sportsdataio'].includes(name)) return provider;
  return new LeagueDataChain(getChainNames(league).map(name=>({name,provider:providers[name]})));
}

export async function probeLeagueProvider(name,league) {
  if(!['moneyline','thesportsdb'].includes(name))throw new HttpError(400,'Unsupported provider diagnostic.');
  const result=await providers[name].listTeams({league,limit:1});
  return {provider:name,league,verified_resource:'teams',returned:result.data.length,meta:result.meta,runtime:providers[name].status()};
}

export function getAdditionalProviderStatus() {
  return Object.fromEntries(['moneyline','thesportsdb'].map(name=>[name,{configured:isConfigured(name),...providers[name].status()}]));
}

export function getProviderDefaults() {
  return Object.fromEntries(
    Object.keys(config.providersByLeague).map((league) => [league, getProviderNameForLeague(league)])
  );
}
