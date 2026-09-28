import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { config } from '../config.js';
import { assertLeagueCode } from '../leagues.js';
import { getProviderForLeague } from '../providers/index.js';
import {
  withOddsProviderFallback,
  withSpecificOddsProvider
} from '../oddsProviders/index.js';

export const mcpHandler = createMcpHandler(() => {
  const server = new McpServer({
    name: 'sharpbet-sports-gateway',
    version: '1.0.0'
  });

  server.registerTool(
    'sharpbet_health',
    {
      description: 'Check whether the SharpBet MCP server is running.',
      inputSchema: z.object({})
    },
    async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ok: true,
            service: 'SharpBet Sports Gateway',
            mcp: true
          })
        }
      ]
    })
  );

  server.registerTool(
    'sharpbet_list_games',
    {
      description: 'List games for a supported league using the existing SharpBet provider logic.',
      inputSchema: z.object({
        league: z.enum(['NBA', 'NFL', 'NCAAM', 'NCAAF', 'MLB', 'NHL']),
        date: z.string().optional(),
        season: z.number().int().optional(),
        week: z.number().int().optional(),
        team: z.string().optional(),
        status: z.enum(['scheduled', 'live', 'final', 'postponed']).optional(),
        limit: z.number().int().min(1).max(100).default(25),
        cursor: z.string().optional()
      })
    },
    async ({ league, date, season, week, team, status, limit, cursor }) => {
      try {
        const validatedLeague = assertLeagueCode(league);
        const provider = getProviderForLeague(validatedLeague);

        const result = await provider.listGames({
          league: validatedLeague,
          date,
          season,
          week,
          team,
          status,
          limit,
          cursor
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error?.message || 'Failed to list games'
              })
            }
          ]
        };
      }
    }
  );

  server.registerTool(
    'sharpbet_get_odds',
    {
      description:
        'Get the current SharpBet odds board for a sport using the existing provider fallback chain.',
      inputSchema: z.object({
        sport: z.string(),
        provider: z.enum([
          'sportsGameOdds',
          'parlayApi',
          'theOddsApi',
          'oddsApiIo'
        ]).optional(),
        regions: z.string().default('us'),
        markets: z.string().default('h2h,spreads,totals'),
        oddsFormat: z.enum(['american', 'decimal']).default('american'),
        bookmakers: z.string().optional(),
        commenceTimeFrom: z.string().optional(),
        commenceTimeTo: z.string().optional(),
        eventIds: z.string().optional()
      })
    },
    async ({
      sport,
      provider,
      regions,
      markets,
      oddsFormat,
      bookmakers,
      commenceTimeFrom,
      commenceTimeTo,
      eventIds
    }) => {
      try {
        const params = {
          regions,
          markets,
          oddsFormat
        };

        if (bookmakers) params.bookmakers = bookmakers;
        if (commenceTimeFrom) params.commenceTimeFrom = commenceTimeFrom;
        if (commenceTimeTo) params.commenceTimeTo = commenceTimeTo;
        if (eventIds) params.eventIds = eventIds;

        let result;

        if (provider) {
          result = await withSpecificOddsProvider(
            provider,
            (selectedProvider) =>
              selectedProvider.getOddsBoard(sport, params),
            {
              cacheKey: `mcp:odds:${provider}:${sport}:${JSON.stringify(params)}`,
              cacheTtlMs: 30 * 1000,
              rememberEvents: true,
              requestType: 'odds'
            }
          );
        } else {
          result = await withOddsProviderFallback(
            (selectedProvider) =>
              selectedProvider.getOddsBoard(sport, params),
            {
              order: config.oddsSportsProviderOrder,
              cacheKey: `mcp:odds:auto:${sport}:${JSON.stringify(params)}`,
              cacheTtlMs: 30 * 1000,
              rememberEvents: true,
              requestType: 'odds'
            }
          );
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result)
            }
          ]
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error?.message || 'Failed to retrieve odds'
              })
            }
          ]
        };
      }
    }
  );

  return server;
});
