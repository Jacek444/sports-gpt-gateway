import 'dotenv/config';

const DEFAULT_PORT = 3000;

function env(name, fallback = '') {
  return process.env[name] ?? fallback;
}

function envBool(name, fallback = false) {
  const value = env(name);
  if (!value) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export const config = {
  port: Number(env('PORT', DEFAULT_PORT)),
  defaultProvider: env('DEFAULT_PROVIDER', 'balldontlie').toLowerCase(),
  mockWhenUnconfigured: envBool('MOCK_WHEN_UNCONFIGURED', true),
  oddsApi: {
    apiKey: env('ODDS_API_KEY'),
    baseUrl: env('ODDS_API_BASE_URL', 'https://api.the-odds-api.com')
  },
  ballDontLie: {
    apiKey: env('BALLDONTLIE_API_KEY'),
    baseUrl: env('BALLDONTLIE_BASE_URL', 'https://api.balldontlie.io')
  },
  sportsDataIo: {
    apiKey: env('SPORTSDATAIO_API_KEY'),
    baseUrl: env('SPORTSDATAIO_BASE_URL', 'https://api.sportsdata.io')
  },
  providersByLeague: {
    NBA: env('PROVIDER_NBA', '').toLowerCase(),
    NFL: env('PROVIDER_NFL', '').toLowerCase(),
    NCAAM: env('PROVIDER_NCAAM', '').toLowerCase(),
    NCAAF: env('PROVIDER_NCAAF', '').toLowerCase(),
    MLB: env('PROVIDER_MLB', '').toLowerCase(),
    NHL: env('PROVIDER_NHL', '').toLowerCase()
  }
};
