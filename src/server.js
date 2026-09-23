import express from 'express';
import { config } from './config.js';
import { toErrorResponse } from './errors.js';
import { LEAGUE_DEFINITIONS, assertLeagueCode } from './leagues.js';
import { getProviderDefaults, getProviderForLeague } from './providers/index.js';
import { logsRouter } from './routes/logs.js';
import { oddsApiRouter } from './routes/oddsApi.js';

const app = express();

app.use('/openapi', express.static('openapi'));
app.use(express.json());
app.use('/v1/logs', logsRouter);
app.use('/v1/odds', oddsApiRouter);

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    provider_defaults: getProviderDefaults(),
    odds_api_configured: Boolean(config.oddsApi.apiKey)
  });
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
    const provider = getProviderForLeague(league);
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
