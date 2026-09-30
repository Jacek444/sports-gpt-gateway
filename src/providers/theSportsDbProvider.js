import { config } from '../config.js';
import { BaseProvider } from './base.js';
import { CachedDataClient } from '../clients/cachedDataClient.js';
import { HttpError } from '../errors.js';
import { validDate,validLimit } from './moneylineProvider.js';

const LEAGUES={NBA:['NBA','Basketball'],NFL:['NFL','American Football'],MLB:['MLB','Baseball'],NHL:['NHL','Ice Hockey'],NCAAM:['NCAA Division I Basketball Mens','Basketball'],NCAAF:['NCAA Division 1 Football','American Football']};
const number=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const bad=message=>new HttpError(502,`TheSportsDB: ${message}`);
function team(league,id,name,abbreviation=null){if(!id||!name)throw bad('missing team identity.');return {id:`thesportsdb:${league}:${id}`,provider_team_id:String(id),league,name,abbreviation};}
export function normalizeSportsDbGame(league,row,leagueId){
  if(!row?.idEvent||String(row.idLeague)!==String(leagueId))throw bad('game belongs to another league.');
  const status=String(row.strStatus||'').toLowerCase();
  const code=/^(match finished|ft|aot|ap|final)$/.test(status)?'final':/^(not started|ns|scheduled)$/.test(status)?'scheduled':/cancel|abandon/.test(status)?'cancelled':/postpon|suspend|delay/.test(status)?'postponed':/^(live|ht|ot|[1-4]q|[1-3]p|in progress)$/.test(status)?'live':'unknown';
  // V1 timestamp fields are UTC; date-only/TBA records do not get an invented kickoff.
  let time=row.strTimestamp || (row.dateEvent&&row.strTime?`${row.dateEvent}T${row.strTime}`:null);
  if(time&&!/(Z|[+-]\d\d:\d\d)$/.test(time))time+='Z';
  if(time&&!Number.isFinite(Date.parse(time)))throw bad('invalid event timestamp.');
  const scored=!['scheduled','cancelled'].includes(code);
  return {id:`thesportsdb:${league}:${row.idEvent}`,provider_game_id:String(row.idEvent),league,provider:'thesportsdb',season:row.strSeason||null,week:['NFL','NCAAF'].includes(league)?number(row.intRound):null,start_time:time,
    status:{code,display:row.strStatus||'Unknown',is_live:code==='unknown'?null:code==='live',period:null,clock:null},
    home_team:team(league,row.idHomeTeam,row.strHomeTeam),away_team:team(league,row.idAwayTeam,row.strAwayTeam),
    score:{home:scored?number(row.intHomeScore):null,away:scored?number(row.intAwayScore):null},venue:row.strVenue||null};
}
export class TheSportsDbProvider extends BaseProvider {
  constructor(settings,options={}){super('thesportsdb');this.client=new CachedDataClient({name:this.name,...settings,pathAuth:true,perMinute:30,...options});}
  status(){return this.client.status();}
  envelope(data,extra={}){return {provider:this.name,data,meta:{fetched_at:this.client.lastReadAt,api_version:'v1',coverage:'limited_free_data',complete_schedule:false,truncated:true,note:'The free v1 feed caps day schedules at 3 events and team lists at 10. Empty results do not prove no games exist; unknown status is not live or final.',...extra}};}
  async catalogue(league){
    const mapping=LEAGUES[league];if(!mapping)throw new HttpError(400,'Unsupported TheSportsDB league.');
    const body=await this.client.get('/search_all_teams.php',{l:mapping[0]},86400000);
    if(body.teams!==null&&!Array.isArray(body.teams))throw bad('invalid team response.');
    const rows=(body.teams||[]).filter(r=>r.strLeague===mapping[0]&&r.strSport===mapping[1]);
    const ids=[...new Set(rows.map(r=>r.idLeague).filter(Boolean))];
    if(ids.length!==1)throw new HttpError(503,`TheSportsDB free catalogue could not resolve ${league}.`);
    return {id:ids[0],rows};
  }
  async listTeams({league,search='',limit=50}){
    validLimit(limit);const {rows}=await this.catalogue(league);
    const data=rows.map(r=>team(league,r.idTeam,r.strTeam,r.strTeamShort)).filter(t=>[t.name,t.abbreviation].some(v=>String(v||'').toLowerCase().includes(search.toLowerCase())));
    return this.envelope(data.slice(0,limit),{coverage:'limited_team_directory',upstream_limit:10});
  }
  async listGames({league,date,season,week,cursor,team:filter,status,limit=25}){
    validLimit(limit);if(season!==undefined||week!==undefined||cursor)throw new HttpError(503,'TheSportsDB free adapter supports date-based discovery only.');
    const day=validDate(date||new Date().toISOString().slice(0,10));
    if(filter?.includes(':')&&!filter.startsWith(`thesportsdb:${league}:`))throw new HttpError(400,'Team ID belongs to another provider or league.');
    const {id}=await this.catalogue(league);
    const body=await this.client.get('/eventsday.php',{d:day,l:id},300000);
    if(body.events!==null&&!Array.isArray(body.events))throw bad('invalid event response.');
    let data=(body.events||[]).filter(r=>String(r.idLeague)===String(id)&&r.dateEvent===day).map(r=>normalizeSportsDbGame(league,r,id));
    if(filter)data=data.filter(g=>[g.home_team,g.away_team].some(t=>filter.includes(':')?t.id===filter:t.name.toLowerCase().includes(filter.toLowerCase())));
    if(status)data=data.filter(g=>g.status.code===status);
    return this.envelope(data.slice(0,limit),{upstream_limit:3,date_timezone:'UTC',filter_scope:'limited_returned_rows'});
  }
  async getGame({league,gameId}){
    const match=String(gameId).match(/^thesportsdb:([A-Z]+):(\d+)$/);
    if(!match||match[1]!==league)throw new HttpError(400,'Use a TheSportsDB game ID for this league.');
    const {id}=await this.catalogue(league),body=await this.client.get('/lookupevent.php',{id:match[2]},300000);
    if(body.events!==null&&!Array.isArray(body.events))throw bad('invalid event response.');
    const row=body.events?.find(r=>String(r.idEvent)===match[2]&&String(r.idLeague)===String(id));
    if(!row)throw new HttpError(404,'TheSportsDB game not found in this league.');return this.envelope(normalizeSportsDbGame(league,row,id),{coverage:'single_game_lookup',truncated:false});
  }
  async getStandings(){throw new HttpError(503,'TheSportsDB standings do not support these leagues.');}
}
export const theSportsDbProvider=new TheSportsDbProvider(config.theSportsDb);
