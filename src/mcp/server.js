import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { config } from '../config.js';

const leagueSchema = z.enum([
  'NBA',
  'NFL',
  'NCAAM',
  'NCAAF',
  'MLB',
  'NHL'
]);

const providerSchema = z.enum([
  'sportsGameOdds',
  'parlayApi',
  'theOddsApi',
  'oddsApiIo'
]);

const oddsFormatSchema = z.enum([
  'american',
  'decimal'
]);

const dateFormatSchema = z.enum([
  'iso',
  'unix'
]);

function buildQuery(params = {}) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ''
    ) {
      query.set(key, String(value));
    }
  }

  return query.toString();
}

async function gatewayGet(path, params = {}) {
  const query = buildQuery(params);

  const url =
    `http://127.0.0.1:${config.port}${path}` +
    (query ? `?${query}` : '');

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json'
    }
  });

  const bodyText = await response.text();

  let body;

  try {
    body = JSON.parse(bodyText);
  } catch {
    body = {
      raw: bodyText
    };
  }

  if (!response.ok) {
    const message =
      body?.error?.message ||
      body?.message ||
      `SharpBet gateway request failed with HTTP ${response.status}`;

    throw new Error(message);
  }

  return body;
}

function toolSuccess(result) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result)
      }
    ]
  };
}

function toolFailure(error) {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          error:
            error?.message ||
            'SharpBet MCP request failed'
        })
      }
    ]
  };
}

export const mcpHandler = createMcpHandler(() => {
  const server = new McpServer({
    name: 'sharpbet-sports-gateway',
    version: '1.0.0'
  });

  server.registerTool(
    'sharpbet_health',
    {
      description:
        'Check whether the SharpBet gateway and MCP service are running.',
      inputSchema: z.object({})
    },
    async () => {
      try {
        return toolSuccess(
          await gatewayGet('/health')
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );

  server.registerTool(
    'sharpbet_list_leagues',
    {
      description:
        'List all sports leagues supported by SharpBet.',
      inputSchema: z.object({})
    },
    async () => {
      try {
        return toolSuccess(
          await gatewayGet('/v1/leagues')
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );

  server.registerTool(
    'sharpbet_list_games',
    {
      description:
        'List games for a supported league. Use this for schedules and game discovery.',
      inputSchema: z.object({
        league: leagueSchema,
        date: z.string().optional(),
        season: z.number().int().optional(),
        week: z.number().int().optional(),
        team: z.string().optional(),
        status: z.enum([
          'scheduled',
          'live',
          'final',
          'postponed'
        ]).optional(),
        limit: z.number().int().min(1).max(100).default(25),
        cursor: z.string().optional()
      })
    },
    async (args) => {
      try {
        return toolSuccess(
          await gatewayGet('/v1/games', args)
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );

  server.registerTool(
    'sharpbet_get_game',
    {
      description:
        'Get details for one specific SharpBet game.',
      inputSchema: z.object({
        league: leagueSchema,
        gameId: z.string()
      })
    },
    async ({ league, gameId }) => {
      try {
        return toolSuccess(
          await gatewayGet(
            `/v1/games/${encodeURIComponent(league)}/${encodeURIComponent(gameId)}`
          )
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );

  server.registerTool(
    'sharpbet_list_teams',
    {
      description:
        'List or search teams in a supported league.',
      inputSchema: z.object({
        league: leagueSchema,
        search: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50)
      })
    },
    async (args) => {
      try {
        return toolSuccess(
          await gatewayGet('/v1/teams', args)
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );

  server.registerTool(
    'sharpbet_get_standings',
    {
      description:
        'Get standings for a supported league and optional season, conference, or division.',
      inputSchema: z.object({
        league: leagueSchema,
        season: z.number().int().optional(),
        conference: z.string().optional(),
        division: z.string().optional()
      })
    },
    async (args) => {
      try {
        return toolSuccess(
          await gatewayGet('/v1/standings', args)
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );

  server.registerTool(
    'sharpbet_odds_status',
    {
      description:
        'Check SharpBet odds-provider health, fallback configuration, quotas, usage, cache activity, and recent errors.',
      inputSchema: z.object({})
    },
    async () => {
      try {
        return toolSuccess(
          await gatewayGet('/v1/odds/status')
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );

  server.registerTool(
    'sharpbet_list_odds_sports',
    {
      description:
        'List sports currently supported by the SharpBet odds gateway.',
      inputSchema: z.object({
        provider: providerSchema.optional(),
        all: z.boolean().optional()
      })
    },
    async (args) => {
      try {
        return toolSuccess(
          await gatewayGet('/v1/odds/sports', args)
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );

  server.registerTool(
    'sharpbet_get_odds',
    {
      description:
        'Get the current sportsbook odds board for a sport. Use for moneylines, spreads, totals, bookmaker comparison, and available market pricing.',
      inputSchema: z.object({
        sport: z.string(),
        provider: providerSchema.optional(),
        regions: z.string().default('us'),
        markets: z.string().default('h2h,spreads,totals'),
        oddsFormat: oddsFormatSchema.default('american'),
        dateFormat: dateFormatSchema.default('iso'),
        bookmakers: z.string().optional(),
        commenceTimeFrom: z.string().optional(),
        commenceTimeTo: z.string().optional(),
        eventIds: z.string().optional()
      })
    },
    async ({ sport, ...params }) => {
      try {
        return toolSuccess(
          await gatewayGet(
            `/v1/odds/${encodeURIComponent(sport)}/odds`,
            params
          )
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );

  server.registerTool(
    'sharpbet_get_scores',
    {
      description:
        'Get live, upcoming, or recent scores for a sport.',
      inputSchema: z.object({
        sport: z.string(),
        provider: providerSchema.optional(),
        daysFrom: z.number().int().min(1).max(3).optional(),
        dateFormat: dateFormatSchema.default('iso')
      })
    },
    async ({ sport, ...params }) => {
      try {
        return toolSuccess(
          await gatewayGet(
            `/v1/odds/${encodeURIComponent(sport)}/scores`,
            params
          )
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );

  server.registerTool(
    'sharpbet_get_events',
    {
      description:
        'Get the event list and gateway event IDs for a sport. Use before requesting event-specific props or alternate markets.',
      inputSchema: z.object({
        sport: z.string(),
        provider: providerSchema.optional(),
        dateFormat: dateFormatSchema.default('iso'),
        commenceTimeFrom: z.string().optional(),
        commenceTimeTo: z.string().optional()
      })
    },
    async ({ sport, ...params }) => {
      try {
        return toolSuccess(
          await gatewayGet(
            `/v1/odds/${encodeURIComponent(sport)}/events`,
            params
          )
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );

  server.registerTool(
    'sharpbet_get_event_odds',
    {
      description:
        'Get odds for one specific event. Use this for player props, alternate lines, game props, and other event-specific markets.',
      inputSchema: z.object({
        sport: z.string(),
        eventId: z.string(),
        provider: providerSchema.optional(),
        regions: z.string().default('us'),
        markets: z.string(),
        oddsFormat: oddsFormatSchema.default('american'),
        dateFormat: dateFormatSchema.default('iso'),
        bookmakers: z.string().optional()
      })
    },
    async ({
      sport,
      eventId,
      ...params
    }) => {
      try {
        return toolSuccess(
          await gatewayGet(
            `/v1/odds/${encodeURIComponent(sport)}/events/${encodeURIComponent(eventId)}/odds`,
            params
          )
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );

  server.registerTool(
    'sharpbet_get_closing_odds',
    {
      description:
        'Get historical closing odds from ParlayAPI for CLV analysis.',
      inputSchema: z.object({
        sport: z.string(),
        date: z.string().optional(),
        event_id: z.string().optional(),
        markets: z.string().optional(),
        bookmakers: z.string().optional()
      })
    },
    async ({ sport, ...params }) => {
      try {
        return toolSuccess(
          await gatewayGet(
            `/v1/odds/${encodeURIComponent(sport)}/closing-odds`,
            params
          )
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );

  server.registerTool(
    'sharpbet_clv_lookup',
    {
      description:
        'Look up compact historical closing-line data for CLV analysis by event, market, sportsbook, and optional player.',
      inputSchema: z.object({
        sport: z.string(),
        date: z.string().optional(),
        commence_time: z.string().optional(),
        home_team: z.string().optional(),
        away_team: z.string().optional(),
        market: z.string(),
        bookmaker: z.string().optional(),
        player: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(25)
      })
    },
    async ({ sport, ...params }) => {
      try {
        return toolSuccess(
          await gatewayGet(
            `/v1/odds/${encodeURIComponent(sport)}/clv-lookup`,
            params
          )
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );

  server.registerTool(
    'sharpbet_list_bet_log',
    {
      description:
        'Read the existing SharpBet betting log. Use this when analyzing new bets so current exposure, prior bets, results, and bankroll context can be considered.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
        start_date: z.string().optional(),
        end_date: z.string().optional(),
        sport: z.string().optional(),
        result: z.string().optional()
      })
    },
    async (args) => {
      try {
        return toolSuccess(
          await gatewayGet(
            '/v1/logs/bet-log',
            args
          )
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );

  server.registerTool(
    'sharpbet_list_postmortems',
    {
      description:
        'Read saved SharpBet betting postmortems so prior wins, losses, process lessons, and handicap reviews can inform future analysis.',
      inputSchema: z.object({})
    },
    async () => {
      try {
        return toolSuccess(
          await gatewayGet(
            '/v1/logs/postmortems'
          )
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );

  server.registerTool(
    'sharpbet_list_promos',
    {
      description:
        'Read the current SharpBet sportsbook promo inventory. Use this before recommending how to deploy boosts, bonus bets, or other active promotions.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
        status: z.enum([
          'NEW',
          'AVAILABLE',
          'USED',
          'EXPIRED',
          'VOID'
        ]).optional(),
        sportsbook: z.string().optional(),
        promo_type: z.string().optional(),
        expires_before: z.string().optional(),
        expires_after: z.string().optional()
      })
    },
    async (args) => {
      try {
        return toolSuccess(
          await gatewayGet(
            '/v1/logs/promos',
            args
          )
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );

  return server;
});
