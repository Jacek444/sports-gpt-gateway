import { BaseProvider } from './base.js';

function sampleTeam(league, id, name, abbreviation) {
  const parts = name.split(' ');
  return {
    id: String(id),
    league,
    name,
    short_name: parts[parts.length - 1],
    market: parts.slice(0, -1).join(' ') || name,
    abbreviation,
    conference: null,
    division: null
  };
}

export class MockProvider extends BaseProvider {
  constructor() {
    super('mock');
  }

  async listGames({ league, date }) {
    const home = sampleTeam(league, 1, league === 'NCAAM' ? 'Duke Blue Devils' : 'Boston Bruins', league === 'NCAAM' ? 'DUKE' : 'BOS');
    const away = sampleTeam(league, 2, league === 'NCAAM' ? 'North Carolina Tar Heels' : 'New York Rangers', league === 'NCAAM' ? 'UNC' : 'NYR');

    return {
      data: [
        {
          id: 'mock-1',
          league,
          provider: 'mock',
          season: new Date().getUTCFullYear(),
          week: null,
          start_time: date ? `${date}T19:00:00.000Z` : new Date().toISOString(),
          status: {
            code: 'scheduled',
            display: 'Scheduled',
            is_live: false,
            period: null,
            clock: null
          },
          home_team: home,
          away_team: away,
          score: {
            home: 0,
            away: 0
          },
          venue: 'Mock Arena'
        }
      ],
      meta: {
        cursor: null,
        next_cursor: null,
        per_page: 1
      }
    };
  }

  async getGame({ league, gameId }) {
    const result = await this.listGames({ league });
    return {
      data: {
        ...result.data[0],
        id: String(gameId)
      }
    };
  }

  async listTeams({ league, search = '' }) {
    const teams = [
      sampleTeam(league, 1, 'Boston Team', 'BOS'),
      sampleTeam(league, 2, 'Chicago Team', 'CHI'),
      sampleTeam(league, 3, 'New York Team', 'NY')
    ];
    const term = search.trim().toLowerCase();
    return {
      data: term
        ? teams.filter((team) => `${team.name} ${team.abbreviation}`.toLowerCase().includes(term))
        : teams
    };
  }

  async getStandings({ league }) {
    return {
      data: [
        {
          team: sampleTeam(league, 1, 'Boston Team', 'BOS'),
          wins: 10,
          losses: 2,
          ties: 0,
          pct: 0.833,
          rank: 1,
          conference: null,
          division: null,
          streak: 'W4'
        }
      ]
    };
  }
}
