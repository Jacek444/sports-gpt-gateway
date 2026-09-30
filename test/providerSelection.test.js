import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

function inspect(overrides = {}) {
  const env = { ...process.env, DOTENV_CONFIG_PATH: '/nonexistent-sharpbet-test-env',
    NODE_ENV: 'production', DEFAULT_PROVIDER: 'balldontlie',
    API_SPORTS_API_KEY: '', BALLDONTLIE_API_KEY: '', SPORTSDATAIO_API_KEY: '',
    MOCK_WHEN_UNCONFIGURED: '', ALLOW_MOCK_DATA: '',
    SPORTSGAMEODDS_ENABLED: 'true', SPORTSGAMEODDS_API_KEY: 'test-key',
    PARLAY_API_ENABLED: 'false', THE_ODDS_API_ENABLED: 'false',
    ODDS_PROVIDER_ORDER: 'sportsGameOdds,parlayApi,theOddsApi',
    ...Object.fromEntries(['NBA', 'NFL', 'NCAAM', 'NCAAF', 'MLB', 'NHL'].map((league) => [`PROVIDER_${league}`, ''])),
    ...overrides
  };
  const script = `import { getProviderDefaults, getLeagueProviderStatus } from './src/providers/index.js'; console.log(JSON.stringify({ defaults: getProviderDefaults(), status: getLeagueProviderStatus() }));`;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' }));
}

test('missing general data key selects odds, not mock', () => {
  const result = inspect();
  assert.deepEqual(new Set(Object.values(result.defaults)), new Set(['odds']));
  assert.equal(result.status.NFL.configured, true);
  assert.deepEqual(result.status.NFL.capabilities, ['betting_events']);
});

test('legacy mock fallback and explicit mock settings cannot enable production samples', () => {
  for (const overrides of [{ MOCK_WHEN_UNCONFIGURED: 'true' }, { DEFAULT_PROVIDER: 'mock' }, { PROVIDER_NFL: 'mock' }]) {
    const result = inspect({ ALLOW_MOCK_DATA: 'true', ...overrides });
    assert.equal(result.defaults.NFL, 'odds');
  }
});

test('configured general data providers are preserved per league', () => {
  const result = inspect({ BALLDONTLIE_API_KEY: 'real-looking-test-key', PROVIDER_NFL: 'odds' });
  assert.equal(result.defaults.NBA, 'balldontlie');
  assert.equal(result.defaults.NFL, 'odds');
});

test('absent odds credentials are reported unavailable without synthetic data', () => {
  const result = inspect({ SPORTSGAMEODDS_API_KEY: '', BALLDONTLIE_API_KEY: 'replace_me' });
  assert.equal(result.defaults.NFL, 'odds');
  assert.equal(result.status.NFL.status, 'unavailable');
});

test('mock data requires explicit opt-in outside production', () => {
  assert.equal(inspect({ NODE_ENV: 'development', DEFAULT_PROVIDER: 'mock' }).defaults.NFL, 'odds');
  assert.equal(inspect({ NODE_ENV: 'development', DEFAULT_PROVIDER: 'mock', ALLOW_MOCK_DATA: 'true' }).status.NFL.status, 'test_data');
});

test('unfinished and unknown adapters are not reported ready', () => {
  assert.equal(inspect({ DEFAULT_PROVIDER: 'sportsdataio', SPORTSDATAIO_API_KEY: 'test' }).status.NFL.status, 'not_implemented');
  const unknown = inspect({ DEFAULT_PROVIDER: 'typo' });
  assert.equal(unknown.status.NFL.status, 'unknown_provider');
  assert.equal(unknown.status.NFL.configured, false);
});

 test('API-Sports supplies missing general data but respects configured preferences', () => {
 const result = inspect({API_SPORTS_API_KEY:'test-key', PROVIDER_NFL:'odds'});
 assert.equal(result.defaults.NBA,'apisports'); assert.equal(result.defaults.NFL,'odds');
 assert.deepEqual(result.status.NBA.capabilities,['games','scores','teams']);
 assert.equal(inspect({API_SPORTS_API_KEY:'test-key', API_SPORTS_ENABLED:'false'}).defaults.NBA,'odds');
});
