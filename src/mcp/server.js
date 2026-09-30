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
  'sharpApi',
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

async function gatewayWrite(method, path, body = undefined) {
  const url = `http://127.0.0.1:${config.port}${path}`;

  const options = {
    method,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json'
    }
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const bodyText = await response.text();

  let result;

  try {
    result = JSON.parse(bodyText);
  } catch {
    result = {
      raw: bodyText
    };
  }

  if (!response.ok) {
    const message =
      result?.error?.message ||
      result?.error ||
      result?.message ||
      `SharpBet gateway request failed with HTTP ${response.status}`;

    throw new Error(message);
  }

  return result;
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
        'Check gateway availability and per-league data capabilities. ok means the service is running, not that every feed is configured. Never use test_data or mock results as live evidence.',
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
        'List league games, or betting events through the configured odds providers when general league data is unavailable. Odds coverage is not a complete schedule; an empty result does not prove no games exist. In odds mode date is UTC and season/week/cursor filters are unsupported. Prefer sharpbet_get_events with explicit time bounds for local-day betting slates. Never treat mock data as live.',
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


  server.registerTool(
    'sharpbet_create_bet',
    {
      description:
        'Save a new bet to the persistent SharpBet bet log after the user has confirmed the wager was placed.',
      inputSchema: z.object({
        date: z.string(),
        sport: z.string(),
        league: z.string(),
        event: z.string(),
        market: z.string(),
        selection: z.string(),
        line: z.union([z.string(), z.number(), z.null()]).optional(),
        odds: z.string(),
        sportsbook: z.string(),

        gateway_event_id: z.union([z.string(), z.null()]).optional(),
        provider_event_id: z.union([z.string(), z.null()]).optional(),
        sport_key: z.union([z.string(), z.null()]).optional(),
        market_key: z.union([z.string(), z.null()]).optional(),
        outcome_key: z.union([z.string(), z.null()]).optional(),
        bookmaker_key: z.union([z.string(), z.null()]).optional(),
        odds_provider: z.union([z.string(), z.null()]).optional(),
        commence_time: z.union([z.string(), z.null()]).optional(),

        stake_usd: z.union([z.number(), z.null()]).optional(),
        units: z.union([z.number(), z.null()]).optional(),
        is_bonus_bet: z.boolean().optional(),
        boost_used: z.boolean().optional(),

        ev_percent: z.union([z.number(), z.null()]).optional(),
        fair_odds: z.union([z.string(), z.number(), z.null()]).optional(),
        kelly_percent: z.union([z.number(), z.null()]).optional(),

        reason: z.union([z.string(), z.null()]).optional(),
        confidence: z.union([z.string(), z.null()]).optional(),
        primary_script: z.union([z.string(), z.null()]).optional(),
        failure_script: z.union([z.string(), z.null()]).optional(),
        supporting_evidence: z.union([z.string(), z.null()]).optional(),
        contradicting_evidence: z.union([z.string(), z.null()]).optional(),
        market_reason: z.union([z.string(), z.null()]).optional(),
        handicap_tags: z.union([z.array(z.string()), z.null()]).optional(),

        predicted_game_script: z.union([z.string(), z.null()]).optional(),
        game_read_confidence: z.union([z.string(), z.null()]).optional(),
        market_fit_confidence: z.union([z.string(), z.null()]).optional(),
        price_confidence: z.union([z.string(), z.null()]).optional(),

        recommended_line: z.union([z.string(), z.number(), z.null()]).optional(),
        recommended_price: z.union([z.string(), z.number(), z.null()]).optional(),
        worst_acceptable_line: z.union([z.string(), z.number(), z.null()]).optional(),
        worst_acceptable_price: z.union([z.string(), z.number(), z.null()]).optional(),

        execution_status: z.union([
          z.enum(['BET NOW', 'WAIT', 'PASS']),
          z.null()
        ]).optional(),

        pre_bet_information_risk: z.union([z.string(), z.null()]).optional(),
        existing_portfolio_exposure: z.union([z.string(), z.null()]).optional(),
        correlation_notes: z.union([z.string(), z.null()]).optional(),

        actual_game_script: z.union([z.string(), z.null()]).optional(),
        handicap_correct: z.union([z.boolean(), z.null()]).optional(),
        market_selection_correct: z.union([z.boolean(), z.null()]).optional(),
        key_assumption_that_failed: z.union([z.string(), z.null()]).optional(),
        unexpected_event: z.union([z.string(), z.null()]).optional(),

        result: z.union([z.string(), z.null()]).optional(),
        payout_usd: z.union([z.number(), z.null()]).optional(),

        closing_line: z.union([z.string(), z.number(), z.null()]).optional(),
        closing_odds: z.union([z.string(), z.null()]).optional(),
        closing_book: z.union([z.string(), z.null()]).optional(),
        clv_percent: z.union([z.number(), z.null()]).optional(),
        clv_status: z.union([z.string(), z.null()]).optional(),
        clv_notes: z.union([z.string(), z.null()]).optional(),

        postmortem: z.union([z.string(), z.null()]).optional()
      })
    },
    async (args) => {
      try {
        return toolSuccess(
          await gatewayWrite(
            'POST',
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
    'sharpbet_update_bet',
    {
      description:
        'Update an existing SharpBet bet-log entry by ID. Use for grading results, CLV, postmortem fields, or other supported bet-analysis metadata.',
      inputSchema: z.object({
        id: z.string(),

        gateway_event_id: z.union([z.string(), z.null()]).optional(),
        provider_event_id: z.union([z.string(), z.null()]).optional(),
        sport_key: z.union([z.string(), z.null()]).optional(),
        market_key: z.union([z.string(), z.null()]).optional(),
        outcome_key: z.union([z.string(), z.null()]).optional(),
        bookmaker_key: z.union([z.string(), z.null()]).optional(),
        odds_provider: z.union([z.string(), z.null()]).optional(),
        commence_time: z.union([z.string(), z.null()]).optional(),

        closing_line: z.union([z.string(), z.number(), z.null()]).optional(),
        closing_odds: z.union([z.string(), z.null()]).optional(),
        closing_book: z.union([z.string(), z.null()]).optional(),
        clv_percent: z.union([z.number(), z.null()]).optional(),
        clv_status: z.union([z.string(), z.null()]).optional(),
        clv_notes: z.union([z.string(), z.null()]).optional(),

        predicted_game_script: z.union([z.string(), z.null()]).optional(),
        game_read_confidence: z.union([z.string(), z.null()]).optional(),
        market_fit_confidence: z.union([z.string(), z.null()]).optional(),
        price_confidence: z.union([z.string(), z.null()]).optional(),

        recommended_line: z.union([z.string(), z.number(), z.null()]).optional(),
        recommended_price: z.union([z.string(), z.number(), z.null()]).optional(),
        worst_acceptable_line: z.union([z.string(), z.number(), z.null()]).optional(),
        worst_acceptable_price: z.union([z.string(), z.number(), z.null()]).optional(),

        execution_status: z.union([
          z.enum(['BET NOW', 'WAIT', 'PASS']),
          z.null()
        ]).optional(),

        pre_bet_information_risk: z.union([z.string(), z.null()]).optional(),
        existing_portfolio_exposure: z.union([z.string(), z.null()]).optional(),
        correlation_notes: z.union([z.string(), z.null()]).optional(),

        actual_game_script: z.union([z.string(), z.null()]).optional(),
        handicap_correct: z.union([z.boolean(), z.null()]).optional(),
        market_selection_correct: z.union([z.boolean(), z.null()]).optional(),
        key_assumption_that_failed: z.union([z.string(), z.null()]).optional(),
        unexpected_event: z.union([z.string(), z.null()]).optional(),

        result: z.union([z.string(), z.null()]).optional(),
        payout_usd: z.union([z.number(), z.null()]).optional(),
        postmortem: z.union([z.string(), z.null()]).optional(),

        ev_percent: z.union([z.number(), z.null()]).optional(),
        fair_odds: z.union([z.string(), z.number(), z.null()]).optional(),
        kelly_percent: z.union([z.number(), z.null()]).optional(),

        reason: z.union([z.string(), z.null()]).optional(),
        confidence: z.union([z.string(), z.null()]).optional(),
        primary_script: z.union([z.string(), z.null()]).optional(),
        failure_script: z.union([z.string(), z.null()]).optional(),
        supporting_evidence: z.union([z.string(), z.null()]).optional(),
        contradicting_evidence: z.union([z.string(), z.null()]).optional(),
        market_reason: z.union([z.string(), z.null()]).optional(),
        handicap_tags: z.union([z.array(z.string()), z.null()]).optional()
      })
    },
    async ({ id, ...updates }) => {
      try {
        return toolSuccess(
          await gatewayWrite(
            'PATCH',
            `/v1/logs/bet-log/${encodeURIComponent(id)}`,
            updates
          )
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );

  server.registerTool(
    'sharpbet_delete_bet',
    {
      description:
        'Permanently delete a SharpBet bet-log entry by ID. Only use when the user explicitly wants that entry deleted.',
      inputSchema: z.object({
        id: z.string()
      })
    },
    async ({ id }) => {
      try {
        return toolSuccess(
          await gatewayWrite(
            'DELETE',
            `/v1/logs/bet-log/${encodeURIComponent(id)}`
          )
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );

  server.registerTool(
    'sharpbet_create_postmortem',
    {
      description:
        'Save a daily or session-level SharpBet betting postmortem.',
      inputSchema: z.object({
        date: z.string(),
        summary: z.string(),
        best_decisions: z.array(z.string()).optional(),
        worst_decisions: z.array(z.string()).optional(),
        process_notes: z.array(z.string()).optional(),
        adjustments: z.array(z.string()).optional()
      })
    },
    async (args) => {
      try {
        return toolSuccess(
          await gatewayWrite(
            'POST',
            '/v1/logs/postmortems',
            args
          )
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );

  server.registerTool(
    'sharpbet_update_postmortem',
    {
      description:
        'Update an existing SharpBet betting postmortem by ID.',
      inputSchema: z.object({
        id: z.string(),
        date: z.string().optional(),
        summary: z.string().optional(),
        best_decisions: z.array(z.string()).optional(),
        worst_decisions: z.array(z.string()).optional(),
        process_notes: z.array(z.string()).optional(),
        adjustments: z.array(z.string()).optional()
      })
    },
    async ({ id, ...updates }) => {
      try {
        return toolSuccess(
          await gatewayWrite(
            'PATCH',
            `/v1/logs/postmortems/${encodeURIComponent(id)}`,
            updates
          )
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );

  server.registerTool(
    'sharpbet_delete_postmortem',
    {
      description:
        'Permanently delete a SharpBet postmortem by ID. Only use when the user explicitly wants it deleted.',
      inputSchema: z.object({
        id: z.string()
      })
    },
    async ({ id }) => {
      try {
        return toolSuccess(
          await gatewayWrite(
            'DELETE',
            `/v1/logs/postmortems/${encodeURIComponent(id)}`
          )
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );

  server.registerTool(
    'sharpbet_create_promo',
    {
      description:
        'Save a sportsbook promo, boost, or bonus bet to the persistent SharpBet promo inventory.',
      inputSchema: z.object({
        sportsbook: z.string(),
        promo_type: z.string(),
        promo_name: z.string(),
        boost_percent: z.union([z.number().min(0), z.null()]).optional(),
        max_stake: z.union([z.number().min(0), z.null()]).optional(),
        min_odds: z.union([z.string(), z.null()]).optional(),
        eligible_sports: z.array(z.string()).optional(),
        eligible_markets: z.array(z.string()).optional(),
        bet_type: z.union([z.string(), z.null()]).optional(),
        minimum_legs: z.union([z.number().int().min(1), z.null()]).optional(),
        minimum_combined_odds: z.union([z.string(), z.null()]).optional(),
        bonus_bet_amount: z.union([z.number().min(0), z.null()]).optional(),
        expires_at: z.union([z.string(), z.null()]).optional(),
        status: z.union([
          z.enum(['NEW', 'AVAILABLE', 'USED', 'EXPIRED', 'VOID']),
          z.null()
        ]).optional(),
        notes: z.union([z.string(), z.null()]).optional(),
        used_at: z.union([z.string(), z.null()]).optional()
      })
    },
    async (args) => {
      try {
        return toolSuccess(
          await gatewayWrite(
            'POST',
            '/v1/logs/promos',
            args
          )
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );

  server.registerTool(
    'sharpbet_update_promo',
    {
      description:
        'Update an existing SharpBet promo by ID, including availability, usage, expiration, or terms.',
      inputSchema: z.object({
        id: z.string(),
        sportsbook: z.string().optional(),
        promo_type: z.string().optional(),
        promo_name: z.string().optional(),
        boost_percent: z.union([z.number().min(0), z.null()]).optional(),
        max_stake: z.union([z.number().min(0), z.null()]).optional(),
        min_odds: z.union([z.string(), z.null()]).optional(),
        eligible_sports: z.array(z.string()).optional(),
        eligible_markets: z.array(z.string()).optional(),
        bet_type: z.union([z.string(), z.null()]).optional(),
        minimum_legs: z.union([z.number().int().min(1), z.null()]).optional(),
        minimum_combined_odds: z.union([z.string(), z.null()]).optional(),
        bonus_bet_amount: z.union([z.number().min(0), z.null()]).optional(),
        expires_at: z.union([z.string(), z.null()]).optional(),
        status: z.union([
          z.enum(['NEW', 'AVAILABLE', 'USED', 'EXPIRED', 'VOID']),
          z.null()
        ]).optional(),
        notes: z.union([z.string(), z.null()]).optional(),
        used_at: z.union([z.string(), z.null()]).optional()
      })
    },
    async ({ id, ...updates }) => {
      try {
        return toolSuccess(
          await gatewayWrite(
            'PATCH',
            `/v1/logs/promos/${encodeURIComponent(id)}`,
            updates
          )
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );

  server.registerTool(
    'sharpbet_delete_promo',
    {
      description:
        'Permanently delete a SharpBet promo by ID. Only use when the user explicitly wants the promo removed.',
      inputSchema: z.object({
        id: z.string()
      })
    },
    async ({ id }) => {
      try {
        return toolSuccess(
          await gatewayWrite(
            'DELETE',
            `/v1/logs/promos/${encodeURIComponent(id)}`
          )
        );
      } catch (error) {
        return toolFailure(error);
      }
    }
  );


  server.registerTool(
    'sharpbet_grade_and_save_clv',
    {
      description:
        'Grade up to 50 bets against historical closing odds and optionally save the resulting CLV fields back to the SharpBet bet log.',
      inputSchema: z.object({
        write_back: z.boolean().default(true),
        bets: z.array(
          z.object({
            bet_id: z.union([z.string(), z.null()]).optional(),

            sport_key: z.union([z.string(), z.null()]).optional(),
            sport: z.union([z.string(), z.null()]).optional(),
            league: z.union([z.string(), z.null()]).optional(),

            player: z.union([z.string(), z.null()]).optional(),

            market: z.union([z.string(), z.null()]).optional(),
            market_key: z.union([z.string(), z.null()]).optional(),

            line: z.union([
              z.string(),
              z.number(),
              z.null()
            ]).optional(),

            outcome: z.union([z.string(), z.null()]).optional(),
            outcome_key: z.union([z.string(), z.null()]).optional(),
            selection: z.union([z.string(), z.null()]).optional(),

            taken_odds: z.union([
              z.string(),
              z.number(),
              z.null()
            ]).optional(),

            odds: z.union([
              z.string(),
              z.number(),
              z.null()
            ]).optional(),

            sportsbook: z.union([z.string(), z.null()]).optional(),
            bookmaker: z.union([z.string(), z.null()]).optional(),
            bookmaker_key: z.union([z.string(), z.null()]).optional(),

            event: z.union([z.string(), z.null()]).optional(),
            home_team: z.union([z.string(), z.null()]).optional(),
            away_team: z.union([z.string(), z.null()]).optional(),

            game_date: z.union([z.string(), z.null()]).optional(),
            date: z.union([z.string(), z.null()]).optional(),
            commence_time: z.union([z.string(), z.null()]).optional()
          }).passthrough()
        ).min(1).max(50)
      })
    },
    async (args) => {
      try {
        return toolSuccess(
          await gatewayWrite(
            'POST',
            '/v1/odds/clv/grade-and-save',
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
