export const LEAGUE_DEFINITIONS = [
  {
    code: 'NBA',
    name: 'National Basketball Association',
    season_type: 'season',
    notes: 'Pro basketball'
  },
  {
    code: 'NFL',
    name: 'National Football League',
    season_type: 'season',
    notes: 'Pro football'
  },
  {
    code: 'NCAAM',
    name: "NCAA Men's Basketball",
    season_type: 'season',
    notes: 'Division I men only in the default adapter'
  },
  {
    code: 'NCAAF',
    name: 'NCAA Football',
    season_type: 'season',
    notes: 'FBS-focused in the default adapter'
  },
  {
    code: 'MLB',
    name: 'Major League Baseball',
    season_type: 'season',
    notes: 'Pro baseball'
  },
  {
    code: 'NHL',
    name: 'National Hockey League',
    season_type: 'season',
    notes: 'Pro hockey'
  }
];

export const SUPPORTED_LEAGUES = new Set(LEAGUE_DEFINITIONS.map((league) => league.code));

export function normalizeLeagueCode(value) {
  return String(value || '').trim().toUpperCase();
}

export function assertLeagueCode(value) {
  const league = normalizeLeagueCode(value);
  if (!SUPPORTED_LEAGUES.has(league)) {
    const error = new Error(`Unsupported league "${value}". Use one of: ${[...SUPPORTED_LEAGUES].join(', ')}`);
    error.status = 400;
    throw error;
  }
  return league;
}
