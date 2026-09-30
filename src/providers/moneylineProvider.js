import { config } from '../config.js';
import { BaseProvider } from './base.js';
import { CachedDataClient } from '../clients/cachedDataClient.js';
import { HttpError } from '../errors.js';

export const MONEYLINE_LEAGUES={NBA:'nba',NFL:'nfl',NCAAM:'ncaa_basketball',NCAAF:'ncaa_football',MLB:'mlb',NHL:'nhl'};
const number=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const bad=message=>new HttpError(502,`MoneyLine: ${message}`);
export function validDate(date){if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new HttpError(400,'date must be YYYY-MM-DD.');return date;}
export function validLimit(limit){if(!Number.isInteger(limit)||limit<1||limit>100)throw new HttpError(400,'limit must be 1-100.');}
function team(league,id,name,abbreviation=null){
  if(!name)throw bad('missing team name.');
  return {id:id?`moneyline:${league}:${id}`:null,provider_team_id:id||null,league,name,abbreviation};
}
export function normalizeMoneylineGame(league,row){
  if(!row?.eventId||row.leagueId!==MONEYLINE_LEAGUES[league])throw bad('event identity or league mismatch.');
  const code=({scheduled:'scheduled',in_progress:'live',final:'final',postponed:'postponed',delayed:'postponed',cancelled:'cancelled'})[row.status]||'unknown';
  const start=row.startTimeTBA?null:row.startTime;
  if(start&&!Number.isFinite(Date.parse(start)))throw bad('invalid start time.');
  const hasScore=['live','final','postponed'].includes(code);
  return {id:`moneyline:${league}:${row.eventId}`,provider_game_id:row.eventId,league,provider:'moneyline',
    season:row.season??null,week:number(row.week),start_time:start,start_time_tba:row.startTimeTBA===true,
    is_stub:row.isStub===true,canonical_event_id:row.canonicalEventId||null,
    status:{code,display:row.status||'Unknown',is_live:code==='unknown'?null:code==='live',period:number(row.period),clock:row.clock??null},
    home_team:team(league,row.homeTeamId,row.homeTeamName),away_team:team(league,row.awayTeamId,row.awayTeamName),
    score:{home:hasScore?number(row.scores?.home):null,away:hasScore?number(row.scores?.away):null},venue:typeof row.venue==='string'?row.venue:row.venue?.name||null};
}
export class MoneylineProvider extends BaseProvider {
  constructor(settings,options={}){super('moneyline');this.client=new CachedDataClient({name:this.name,...settings,perMinute:10,...options});}
  league(league){const id=MONEYLINE_LEAGUES[league];if(!id)throw new HttpError(400,'Unsupported MoneyLine league.');return id;}
  envelope(data,meta={}){return {provider:this.name,data,meta:{fetched_at:this.client.lastReadAt,coverage:'provider_schedule',complete_schedule:false,...meta},quota:{requests_this_process:this.client.requests,monthly_remaining:null}};}
  status(){return this.client.status();}
  async events(league,query={}){
    const body=await this.client.get('/events',{league:this.league(league),...query});
    if(body.success!==true||!Array.isArray(body.data))throw bad('invalid events response.');return body;
  }
  async event(league,id){
    if(!/^[a-zA-Z0-9_-]+$/.test(id))throw new HttpError(400,'Invalid MoneyLine event ID.');
    const body=await this.client.get(`/events/${id}`);
    const row=body.data;
    if(body.success!==true||!row||row.leagueId!==this.league(league)||(row.eventId!==id&&row.canonicalEventId!==row.eventId))throw bad('event identity mismatch.');
    return row;
  }
  async listGames({league,date,season,week,team:filter,status,cursor,limit=25}){
    validLimit(limit);
    if(season!==undefined||week!==undefined)throw new HttpError(503,'MoneyLine game discovery supports dates, not season/week filters.');
    const day=validDate(date||new Date().toISOString().slice(0,10));
    const match=cursor&&String(cursor).match(/^moneyline:(\d+)$/),page=cursor?Number(match?.[1]):1;
    if(!Number.isSafeInteger(page)||page<1)throw new HttpError(400,'Invalid MoneyLine cursor.');
    if(filter?.includes(':')&&!filter.startsWith(`moneyline:${league}:`))throw new HttpError(400,'Team ID belongs to another provider or league.');
    const body=await this.events(league,{date:day,status:status==='live'?'in_progress':status,limit,page});
    let data=body.data.filter(r=>r.leagueId===MONEYLINE_LEAGUES[league]).map(r=>normalizeMoneylineGame(league,r));
    if(filter)data=data.filter(g=>[g.home_team,g.away_team].some(t=>filter.includes(':')?t.id===filter:t.name.toLowerCase().includes(filter.toLowerCase())));
    if(status)data=data.filter(g=>g.status.code===status);
    const more=Number.isFinite(body.meta?.pages)?body.meta.pages>page:body.data.length===limit;
    return this.envelope(data,{next_cursor:more?`moneyline:${page+1}`:null,truncated:more,filter_scope:'returned_page',date_timezone:'provider_date',note:'Team filters apply to the returned page. Follow next_cursor for more matches; TBA times remain unknown.'});
  }
  async getGame({league,gameId}){
    const prefix=`moneyline:${league}:`;if(!String(gameId).startsWith(prefix))throw new HttpError(400,'Use a MoneyLine game ID for this league.');
    return this.envelope(normalizeMoneylineGame(league,await this.event(league,String(gameId).slice(prefix.length))));
  }
  async listTeams({league,search='',limit=50}){
    validLimit(limit);const body=await this.client.get(`/leagues/${this.league(league)}/teams`,{},86400000);
    if(body.success!==true||!Array.isArray(body.data))throw bad('invalid team catalogue.');
    const rows=body.data.filter(r=>r.leagueId===this.league(league)).map(r=>team(league,r.teamId,r.name,r.abbreviation));
    const filtered=rows.filter(t=>[t.name,t.abbreviation].some(v=>String(v||'').toLowerCase().includes(search.toLowerCase())));
    return this.envelope(filtered.slice(0,limit),{truncated:filtered.length>limit,coverage:'team_directory'});
  }
  async getStandings(){throw new HttpError(503,'MoneyLine standings normalization is not enabled.');}
}
export const moneylineProvider=new MoneylineProvider(config.moneyline);
