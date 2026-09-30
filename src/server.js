import express from 'express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { config } from './config.js';
import { oddsPapiProvider } from './oddsProviders/oddsPapiProvider.js';
import { HttpError, toErrorResponse } from './errors.js';
import { LEAGUE_DEFINITIONS, assertLeagueCode } from './leagues.js';
import { getProviderDefaults, getProviderForLeague, getLeagueProviderStatus, apiSportsProvider, ballDontLieProvider, probeLeagueProvider, getAdditionalProviderStatus } from './providers/index.js';
import { getOddsProviderStatus } from './oddsProviders/index.js';
import { logsRouter } from './routes/logs.js';
import { oddsApiRouter } from './routes/oddsApi.js';
import { mcpHandler } from './mcp/server.js';

const app = express();

app.use('/openapi', express.static('openapi'));
app.use(express.json());

const mcpNodeHandler = toNodeHandler(mcpHandler);

app.all('/mcp', (req, res) => {
  void mcpNodeHandler(req, res, req.body);
});
app.use('/v1/logs', logsRouter);
app.use('/v1/odds', oddsApiRouter);

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    provider_defaults: getProviderDefaults(),
    league_data: getLeagueProviderStatus(),
    additional_providers: getAdditionalProviderStatus(),
    odds: getOddsProviderStatus()
  });
});

// Fixed read-only diagnostics: never expose raw account responses or API keys.
app.get('/v1/providers/access', async (req, res, next) => {
  try {
    if (['moneyline','thesportsdb'].includes(req.query.provider)) return res.json(await probeLeagueProvider(req.query.provider,assertLeagueCode(req.query.league)));
    if (req.query.provider === 'balldontlie') return res.json(await ballDontLieProvider.getAccess());
    if (req.query.provider === 'apisports') return res.json(await apiSportsProvider.getAccess(assertLeagueCode(req.query.league)));
    if (req.query.provider === 'oddsPapi') return res.json(await oddsPapiProvider.getAccess(req.query.sport));
    throw new HttpError(400, 'provider must be balldontlie, moneyline, thesportsdb, apisports or oddsPapi.');
  } catch (error) { next(error); }
});

app.get('/v1/leagues', (req, res) => {
  res.json({
    data: LEAGUE_DEFINITIONS
  });
});

app.get('/v1/games', async (req, res, next) => {
  try {
    const league = assertLeagueCode(req.query.league);
    const provider = getProviderForLeague(league);
    const result = await provider.listGames({
      league,
      date: req.query.date,
      season: req.query.season ? Number(req.query.season) : undefined,
      week: req.query.week ? Number(req.query.week) : undefined,
      team: req.query.team,
      status: req.query.status,
      cursor: req.query.cursor,
      limit: req.query.limit ? Number(req.query.limit) : 25
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/v1/games/:league/:gameId', async (req, res, next) => {
  try {
    const league = assertLeagueCode(req.params.league);
    const provider = getProviderForLeague(league, req.params.gameId);
    const result = await provider.getGame({
      league,
      gameId: req.params.gameId
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/v1/teams', async (req, res, next) => {
  try {
    const league = assertLeagueCode(req.query.league);
    const provider = getProviderForLeague(league);
    const result = await provider.listTeams({
      league,
      search: String(req.query.search || ''),
      limit: req.query.limit ? Number(req.query.limit) : 50
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/v1/standings', async (req, res, next) => {
  try {
    const league = assertLeagueCode(req.query.league);
    const provider = getProviderForLeague(league);
    const result = await provider.getStandings({
      league,
      season: req.query.season ? Number(req.query.season) : undefined,
      conference: req.query.conference,
      division: req.query.division
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  const status = error.status || 500;

  if (status >= 500) {
    console.error(error);
  }

  res.status(status).json(toErrorResponse(error));
});

app.listen(config.port, () => {
  console.log(`Sports GPT Gateway listening on http://localhost:${config.port}`);
});
