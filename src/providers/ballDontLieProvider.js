import { BallDontLieClient } from '../clients/ballDontLieClient.js';
import { BaseProvider } from './base.js';
import { HttpError } from '../errors.js';

const LEAGUE_PATHS = {
  NBA: '/nba/v1',
  NFL: '/nfl/v1',
  NCAAM: '/ncaab/v1',
  NCAAF: '/ncaaf/v1',
  MLB: '/mlb/v1',
  NHL: '/nhl/v1'
};

function isNumeric(value) {
  return /^\d+$/.test(String(value || '').trim());
}

function addArrayParams(searchParams, key, values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(`${key}[]`, String(value));
    }
  }
}

function pick(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildTeamName(team) {
  return pick(
    team.full_name,
    team.display_name,
    team.location ? [team.location, team.name].filter(Boolean).join(' ') : null,
    team.city ? [team.city, team.name].filter(Boolean).join(' ') : null,
    team.college ? [team.college, team.name].filter(Boolean).join(' ') : null,
    team.name
  );
}

function normalizeTeam(league, rawTeam = {}) {
  const id=pick(rawTeam.id,rawTeam.team_id), name=buildTeamName(rawTeam);
  if (!id || !name) throw new HttpError(502,'BALLDONTLIE returned an incomplete team.');
  return {
    id: `balldontlie:${league}:${id}`,
    provider_team_id: String(id),
    league,
    name: pick(buildTeamName(rawTeam), 'Unknown Team'),
    short_name: pick(rawTeam.short_display_name, rawTeam.name, rawTeam.full_name, 'Unknown Team'),
    market: pick(rawTeam.location, rawTeam.city, rawTeam.college),
    abbreviation: pick(rawTeam.abbreviation, rawTeam.tricode, rawTeam.slug, 'UNK'),
    conference: pick(rawTeam.conference, rawTeam.conference_name, rawTeam.conference_id),
    division: pick(rawTeam.division, rawTeam.division_name)
  };
}

export function normalizeGame(league, rawGame) {
  if (!rawGame?.id) throw new HttpError(502,'BALLDONTLIE returned a game without an ID.');
  const homeTeam=normalizeTeam(league,pick(rawGame.home_team,rawGame.homeTeam,{}));
  const awayTeam=normalizeTeam(league,pick(rawGame.visitor_team,rawGame.away_team,rawGame.awayTeam,{}));
  const display=String(pick(rawGame.status,rawGame.game_state,'Unknown'));
  const state=String(rawGame.status_state || '').toLowerCase();
  let code=({scheduled:'scheduled',in_progress:'live',final:'final',postponed:'postponed',delayed:'postponed',suspended:'postponed',canceled:'cancelled',abandoned:'cancelled',unknown:'unknown'})[state];
  if (!code) {
    const lower=display.toLowerCase();
    code=rawGame.postponed || /postponed|delayed|suspended/.test(lower)?'postponed'
      : /cancel|abandon/.test(lower)?'cancelled'
      : /^(final.*|post|finished|off)$/.test(lower)?'final'
      : /^(in|live|in progress|in_progress|ht|ot|crit)$/.test(lower) || /\b(quarter|qtr|halftime|half time|intermission)\b|^q[1-4]$|^p[1-3]$/.test(lower)?'live'
      : /^(scheduled|pre|not started|future|fut)$/.test(lower) || /^\d{1,2}:\d{2}\s*(am|pm)?(?:\s*(et|est|edt))?$/i.test(lower)?'scheduled':'unknown';
  }
  const start=pick(rawGame.datetime,rawGame.start_time_utc,rawGame.date,rawGame.game_date);
  if (!Number.isFinite(Date.parse(start))) throw new HttpError(502,'BALLDONTLIE returned an invalid game time.');
  const score=(...values)=>['scheduled','cancelled'].includes(code)?null:toNumber(pick(...values));
  return {
    id:`balldontlie:${league}:${rawGame.id}`,provider_game_id:String(rawGame.id),league,provider:'balldontlie',
    season:toNumber(rawGame.season),week:toNumber(rawGame.week),start_time:start,
    status:{code,display,is_live:code==='unknown'?null:code==='live',period:toNumber(rawGame.period),clock:pick(rawGame.time,rawGame.display_clock,rawGame.time_remaining)},
    home_team:homeTeam,away_team:awayTeam,
    score:{home:score(rawGame.home_team_score,rawGame.home_score,rawGame.home_team_data?.runs),away:score(rawGame.visitor_team_score,rawGame.away_score,rawGame.visitor_score,rawGame.away_team_data?.runs)},
    venue:pick(rawGame.venue,rawGame.venue_name)
  };
}

function parseRecord(record) {
  if (!record || typeof record !== 'string') {
    return { wins: null, losses: null, ties: null };
  }

  const [wins, losses, ties] = record.split('-').map((part) => toNumber(part));
  return {
    wins,
    losses,
    ties: ties ?? 0
  };
}

function normalizeStanding(league, rawStanding) {
  const parsedRecord = parseRecord(rawStanding.overall_record);
  const wins = pick(rawStanding.wins, parsedRecord.wins);
  const losses = pick(rawStanding.losses, parsedRecord.losses);
  const ties = pick(rawStanding.ties, parsedRecord.ties);
  const totalGames = Number(wins || 0) + Number(losses || 0) + Number(ties || 0);
  const pct = rawStanding.pct !== undefined
    ? Number(rawStanding.pct)
    : rawStanding.win_percentage !== undefined
      ? Number(rawStanding.win_percentage)
      : totalGames > 0
        ? Number((Number(wins || 0) / totalGames).toFixed(3))
        : null;

  const streak = rawStanding.win_streak
    ? `W${rawStanding.win_streak}`
    : rawStanding.loss_streak
      ? `L${rawStanding.loss_streak}`
      : pick(rawStanding.streak, null);

  return {
    team: normalizeTeam(league, rawStanding.team),
    wins: toNumber(wins),
    losses: toNumber(losses),
    ties: toNumber(ties),
    pct,
    rank: toNumber(pick(rawStanding.rank, rawStanding.playoff_seed, rawStanding.seed)),
    conference: pick(rawStanding.team?.conference, rawStanding.team?.conference_name),
    division: pick(rawStanding.team?.division, rawStanding.team?.division_name),
    streak
  };
}

export class BallDontLieProvider extends BaseProvider {
  constructor({ apiKey, baseUrl, ...options }) {
    super('balldontlie');
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl || 'https://api.balldontlie.io').replace(/\/$/, '');
    this.client=new BallDontLieClient({apiKey,baseUrl:this.baseUrl,...options});
  }

  ensureConfigured() {
    if (!this.apiKey) {
      throw new HttpError(503, 'BALLDONTLIE is not configured. Set BALLDONTLIE_API_KEY.');
    }
  }

  resourceUrl(league, resource, resourceId = null, query = {}) {
    const basePath = LEAGUE_PATHS[league];
    if (!basePath) {
      throw new HttpError(400, `No BALLDONTLIE path is configured for ${league}`);
    }

    const url = new URL(`${this.baseUrl}${basePath}/${resource}${resourceId ? `/${resourceId}` : ''}`);
    const searchParams = url.searchParams;

    if (query.cursor) {
      searchParams.set('cursor', String(query.cursor));
    }

    if (query.limit) {
      searchParams.set('per_page', String(query.limit));
    }

    addArrayParams(searchParams, 'dates', query.dates || []);
    addArrayParams(searchParams, 'seasons', query.seasons || []);
    addArrayParams(searchParams, 'weeks', query.weeks || []);
    addArrayParams(searchParams, 'game_ids', query.gameIds || []);
    addArrayParams(searchParams, 'team_ids', query.teamIds || []);

    if (query.startDate) {
      searchParams.set('start_date', query.startDate);
    }

    if (query.endDate) {
      searchParams.set('end_date', query.endDate);
    }

    if (query.season !== undefined && query.season !== null) {
      searchParams.set('season', String(query.season));
    }

    if (query.conference) {
      searchParams.set('conference', query.conference);
    }

    if (query.division) {
      searchParams.set('division', query.division);
    }

    if (query.search) {
      searchParams.set('search', query.search);
    }

    if (query.postseason !== undefined && query.postseason !== null) {
      searchParams.set('postseason', String(query.postseason));
    }

    return url;
  }

  async fetchJson(url, ttl) { return this.client.get(url,ttl); }
  envelope(data,meta={}) {return {provider:this.name,data,meta:{fetched_at:this.client.lastReadAt,coverage:'provider_schedule',complete_schedule:false,...meta},quota:this.client.quota};}
  status() {return this.client.status();}
  async getAccess() {
    const body=await this.fetchJson(new URL('/account/v1/me',this.baseUrl),300000);
    const r=body.data || body;
    if(!Array.isArray(r.subscriptions))throw new HttpError(502,'BALLDONTLIE returned invalid subscription information.');
    return {provider:this.name,tier:r.tier,subscriptions:r.subscriptions.map(s=>({sport:s.sport,tier:s.tier})),checked_at:this.client.lastReadAt};
  }
  validate({date,season,week,limit=25,team}) {
    if(!Number.isInteger(limit)||limit<1||limit>100)throw new HttpError(400,'limit must be 1-100.');
    if(date && (!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))throw new HttpError(400,'date must be YYYY-MM-DD.');
    if(season!==undefined&&!Number.isInteger(season)||week!==undefined&&(!Number.isInteger(week)||week<1))throw new HttpError(400,'Invalid season or week.');
    if(team?.includes(':')&&!/^balldontlie:[A-Z]+:\d+$/.test(team))throw new HttpError(400,'Use a BALLDONTLIE team ID or a team name.');
  }
  async listGames(params) {
    this.validate(params);
    const {league,season,week,status,limit=25}=params;
    const date=params.date || (season===undefined&&week===undefined?new Date().toISOString().slice(0,10):undefined);
    const cursor=params.cursor?String(params.cursor).replace(/^balldontlie:/,''):undefined;
    if(cursor&&!/^\d+$/.test(cursor))throw new HttpError(400,'Invalid BALLDONTLIE cursor.');
    let team=params.team;
    if(team?.startsWith('balldontlie:')) {
      const parts=team.split(':');if(parts[1]!==league)throw new HttpError(400,'Team ID belongs to another league.');team=parts[2];
    }
    const query={cursor,limit,dates:date?[date]:[],seasons:season!==undefined?[season]:[]};
    if(week!==undefined) {
      if(!['NFL','NCAAF'].includes(league))throw new HttpError(400,'week applies to football only.');
      query.weeks=[week];
    }
    if(team&&isNumeric(team))query.teamIds=[team];
    const payload=await this.fetchJson(this.resourceUrl(league,'games',null,query));
    if(!Array.isArray(payload.data))throw new HttpError(502,'BALLDONTLIE returned an invalid games response.');
    let games=payload.data.map(game=>normalizeGame(league,game));
    if(team&&!isNumeric(team)) {
      const term=String(team).toLowerCase();games=games.filter(g=>[g.home_team,g.away_team].some(t=>[t.name,t.abbreviation].some(v=>String(v).toLowerCase().includes(term))));
    }
    if(status)games=games.filter(g=>g.status.code===status);
    const next=payload.meta?.next_cursor;
    return this.envelope(games,{cursor:params.cursor||null,next_cursor:next==null?null:`balldontlie:${next}`,per_page:payload.meta?.per_page??limit,truncated:next!=null,filter_scope:'returned_page',date_timezone:'provider_date',note:'Team-name and status filters apply to the returned page; follow next_cursor for additional matches. Dates use the provider date field; preserve returned start-time offsets.'});
  }
  async getGame({league,gameId}) {
    const match=String(gameId).match(/^balldontlie:([A-Z]+):(\d+)$/);
    if(match&&match[1]!==league)throw new HttpError(400,'Game ID belongs to another league.');
    const id=match?match[2]:String(gameId);
    if(!/^\d+$/.test(id))throw new HttpError(400,'Use a BALLDONTLIE game ID for this league.');
    const payload=await this.fetchJson(this.resourceUrl(league,'games',league==='NHL'?null:id,league==='NHL'?{gameIds:[id]}:{}));
    const row=Array.isArray(payload.data)?payload.data.find(g=>String(g.id)===id):payload.data;
    if(!row)throw new HttpError(404,'BALLDONTLIE game was not found.');
    if(String(row.id)!==id)throw new HttpError(502,'BALLDONTLIE returned a different game.');
    return this.envelope(normalizeGame(league,row));
  }
  async listTeams({league,search='',limit=50}) {
    this.validate({limit});
    const payload=await this.fetchJson(this.resourceUrl(league,'teams',null,{limit:100}),86400000);
    if(!Array.isArray(payload.data))throw new HttpError(502,'BALLDONTLIE returned an invalid teams response.');
    const term=search.toLowerCase();
    const rows=payload.data.map(t=>normalizeTeam(league,t)).filter(t=>!term||[t.name,t.abbreviation,t.market].some(v=>String(v||'').toLowerCase().includes(term)));
    return this.envelope(rows.slice(0,limit),{truncated:rows.length>limit||payload.meta?.next_cursor!=null,next_cursor:payload.meta?.next_cursor??null,filter_scope:'returned_page'});
  }
  async getStandings({league,season,conference,division}) {
    this.validate({season});
    const payload=await this.fetchJson(this.resourceUrl(league,'standings',null,{season,limit:100}),300000);
    if(!Array.isArray(payload.data))throw new HttpError(502,'BALLDONTLIE returned invalid standings.');
    let data=payload.data.map(s=>normalizeStanding(league,s));
    if(conference)data=data.filter(r=>String(r.conference||'').toLowerCase().includes(conference.toLowerCase()));
    if(division)data=data.filter(r=>String(r.division||'').toLowerCase().includes(division.toLowerCase()));
    return this.envelope(data,{truncated:payload.meta?.next_cursor!=null});
  }
}
