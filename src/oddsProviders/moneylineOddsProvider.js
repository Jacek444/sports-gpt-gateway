import { moneylineProvider, MONEYLINE_LEAGUES } from '../providers/moneylineProvider.js';
import { HttpError } from '../errors.js';
const SPORTS={basketball_nba:'NBA',americanfootball_nfl:'NFL',basketball_ncaab:'NCAAM',americanfootball_ncaaf:'NCAAF',baseball_mlb:'MLB',icehockey_nhl:'NHL'};
const csv=v=>String(v||'').split(',').map(x=>x.trim()).filter(Boolean);
const fail=message=>new HttpError(503,`MoneyLine: ${message}`,{provider:'moneyline'});
const MARKETS={moneyline:'h2h',spread:'spreads',total:'totals'};

export class MoneylineOddsProvider {
  constructor(data=moneylineProvider,now=Date.now){this.data=data;this.now=now;}
  league(sport){const league=SPORTS[sport]||(MONEYLINE_LEAGUES[sport]?sport:null);if(!league)throw fail('unsupported sport.');return league;}
  validate(params){
    if(String(params.live)==='true'||String(params.is_live)==='true')throw fail('this adapter supports pregame odds only.');
    if(params.regions&&csv(params.regions).some(r=>r!=='us'))throw fail('US sportsbooks only.');
    if(params.bookmakers&&csv(params.bookmakers).some(b=>!['draftkings','fanduel'].includes(b)))throw fail('this adapter supports DraftKings and FanDuel only.');
    if(params.oddsFormat&&!['american','decimal'].includes(params.oddsFormat)||params.dateFormat&&!['iso','unix'].includes(params.dateFormat))throw new HttpError(400,'Invalid odds or date format.');
    const from=params.commenceTimeFrom?Date.parse(params.commenceTimeFrom):this.now(),to=params.commenceTimeTo?Date.parse(params.commenceTimeTo):from+7*86400000;
    if(!Number.isFinite(from)||!Number.isFinite(to)||from>to)throw new HttpError(400,'Invalid time window.');
    const markets=csv(params.markets||'h2h,spreads,totals');if(!markets.length||markets.some(m=>!Object.values(MARKETS).includes(m)))throw fail('core h2h, spreads and totals only.');
    return {from,to,markets,books:csv(params.bookmakers||'draftkings,fanduel')};
  }
  event(row,league,params,bounds){
    const time=Date.parse(row.startTime);
    if(row.leagueId!==MONEYLINE_LEAGUES[league]||row.startTimeTBA||!Number.isFinite(time)||time<=this.now()||time<bounds.from||time>bounds.to||row.status!=='scheduled')return null;
    if(!row.eventId||!row.homeTeamName||!row.awayTeamName)throw fail('incomplete event identity.');
    return {id:row.eventId,provider_event_id:row.eventId,gateway_event_id:`moneyline:${row.eventId}`,sport_key:Object.keys(SPORTS).find(k=>SPORTS[k]===league),home_team:row.homeTeamName,away_team:row.awayTeamName,commence_time:params.dateFormat==='unix'?Math.floor(time/1000):row.startTime,status:'Upcoming',is_stub:row.isStub===true};
  }
  async allEvents(league,bounds){
    const rows=[];
    for(let page=1;page<=3;page++){
      const body=await this.data.events(league,{from:new Date(bounds.from).toISOString(),to:new Date(bounds.to).toISOString(),status:'scheduled',limit:100,page});
      rows.push(...body.data);
      if(body.meta?.pages!==undefined?body.meta.pages<=page:body.data.length<100)return rows;
    }
    throw fail('event pagination exceeds the safe request budget. Narrow the date window.');
  }
  envelope(data,extra={}){return this.data.envelope(data,{coverage:'pregame_sportsbook_odds',complete_schedule:false,price_freshness_limit_seconds:300,...extra});}
  async getEvents(sport,params={}){
    const league=this.league(sport),bounds=this.validate(params),rows=await this.allEvents(league,bounds);
    const events=rows.map(r=>this.event(r,league,params,bounds)).filter(Boolean);
    if(!events.length)throw fail('no upcoming event coverage in this window.');return this.envelope(events,{coverage:'provider_events'});
  }
  normalize(row,event,bounds,params){
    if(row.eventId!==event.id||row.leagueId!==MONEYLINE_LEAGUES[this.league(event.sport_key)])return null;
    const books=[];
    for(const book of row.bookmakers||[]){
      if(book.sourceType!=='sportsbook'||!bounds.books.includes(book.bookmakerId)||book.sourceRegion&&!['us','us2'].includes(book.sourceRegion))continue;
      const markets=[];
      for(const m of book.markets||[]){
        const key=MARKETS[m.marketType],updated=Date.parse(m.lastUpdate);
        if(!bounds.markets.includes(key)||m.isAlternate!==false||m.isStale===true||!Number.isFinite(updated)||this.now()-updated>300000||updated>this.now()+60000)continue;
        const outcomes=[];
        for(const o of m.outcomes||[]){
          if(o.isPriceable!==true||o.isPlaceholder===true||o.description)continue;
          const allowed=key==='totals'?['over','under']:['home','away'];if(!allowed.includes(o.side))continue;
          const american=Number(o.price);if(o.price===null||!Number.isFinite(american)||Math.abs(american)<100||Math.abs(american)>=9900)continue;
          const point=o.point==null?null:Number(o.point);if(key!=='h2h'&&!Number.isFinite(point))continue;
          const name=key==='totals'?(o.side==='over'?'Over':'Under'):(o.side==='home'?event.home_team:event.away_team);
          const price=params.oddsFormat==='decimal'?Number((american>0?1+american/100:1+100/-american).toFixed(6)):american;
          outcomes.push({name,price,...(key==='h2h'?{}:{point}),last_update:m.lastUpdate});
        }
        if(outcomes.length!==2||new Set(outcomes.map(o=>o.name)).size!==2)continue;
        if(key==='spreads'&&Math.abs(outcomes[0].point+outcomes[1].point)>1e-8||key==='totals'&&outcomes[0].point!==outcomes[1].point)continue;
        markets.push({key,last_update:m.lastUpdate,outcomes});
      }
      // Ambiguous repeated main-market entries are excluded, never collapsed.
      const unique=markets.filter(m=>markets.filter(x=>x.key===m.key).length===1);
      if(unique.length)books.push({key:book.bookmakerId,title:book.bookmakerName||book.bookmakerId,markets:unique});
    }
    return books.length?{...event,bookmakers:books}:null;
  }
  async odds(sport,params={},id=null){
    const league=this.league(sport),bounds=this.validate(params);
    const events=id?[await this.data.event(league,id)]:await this.allEvents(league,bounds);
    const byId=new Map(events.map(r=>{const event=this.event(r,league,params,bounds);return [r.eventId,event];}));
    const rows=[];
    if(id){
      const body=await this.data.client.get(`/events/${id}/odds`,{sourceType:'sportsbook',include:'outcomeFields'});
      if(!body.data||Array.isArray(body.data))throw fail('invalid event odds response.');rows.push(body.data);
    }else{
      for(let page=1;page<=3;page++){
        const body=await this.data.client.get('/odds',{league:MONEYLINE_LEAGUES[league],sourceType:'sportsbook',include:'outcomeFields',limit:50,page});
        if(!Array.isArray(body.data))throw fail('invalid odds board.');rows.push(...body.data);
        if(body.meta?.pages!==undefined?body.meta.pages<=page:body.data.length<50)break;
        if(page===3)throw fail('odds pagination exceeds the safe request budget.');
      }
    }
    const requested=csv(params.eventIds),data=rows.filter(r=>!requested.length||requested.includes(r.eventId)).map(r=>byId.get(r.eventId)?this.normalize(r,byId.get(r.eventId),bounds,params):null).filter(Boolean);
    const found=new Set(data.flatMap(e=>e.bookmakers.flatMap(b=>b.markets.map(m=>m.key))));
    if(!data.length||bounds.markets.some(m=>!found.has(m)))throw fail('no fresh sportsbook prices for every requested market.');
    return this.envelope(id?data[0]:data,{requested_markets:bounds.markets});
  }
  getOddsBoard(sport,params){return this.odds(sport,params);}
  getEventOdds(sport,id,params){return this.odds(sport,params,id);}
  getSports(){throw fail('use the existing sports catalogue.');}
  getScores(){throw fail('use the league game tools for MoneyLine scores.');}
}
export const moneylineOddsProvider=new MoneylineOddsProvider();
