import { config } from '../config.js';
import { HttpError } from '../errors.js';
import { FreeProviderClient } from '../clients/freeProviderClient.js';

const SCOPES = {
  americanfootball_nfl: ['american-football','nfl'], americanfootball_ncaaf: ['american-football','ncaa'],
  basketball_nba: ['basketball','nba'], basketball_ncaab: ['basketball','ncaa'],
  baseball_mlb: ['baseball','mlb'], icehockey_nhl: ['ice-hockey','nhl']
};
const aliases = {NFL:'americanfootball_nfl',NCAAF:'americanfootball_ncaaf',NBA:'basketball_nba',NCAAM:'basketball_ncaab',MLB:'baseball_mlb',NHL:'icehockey_nhl'};
const csv = s => String(s || '').split(',').map(s=>s.trim()).filter(Boolean);
const unavailable = (message, details={}) => new HttpError(503, `OddsPapi: ${message}`, {provider:'oddsPapi',...details});
export class OddsPapiProvider {
  constructor(settings, fetcher) {
    this.settings=settings;
    this.client=new FreeProviderClient({name:'oddsPapi',...settings,queryAuth:true,fetcher,intervalMs:2200});
    this.subscription=null; this.checkedAt=0;
  }
  async call(path, params={}, ttl=60000) {
    if (!this.settings.enabled) throw unavailable('disabled.');
    if (path !== '/v4/account') {
      await this.account();
      if (this.subscription.remaining <= 0) throw unavailable('monthly request allowance exhausted.',{upstreamStatus:429,retryAfter:3600});
    }
    const before=this.client.requests;
    try { return await this.client.get(path,{...params,language:'en'},ttl); }
    finally { if (path !== '/v4/account' && this.client.requests>before) this.subscription.remaining=Math.max(0,this.subscription.remaining-(this.client.requests-before)); }
  }
  async account() {
    if (this.subscription && Date.now()-this.checkedAt<300000) return this.subscription;
    // Whitelist only entitlement/quota information. Never return the raw
    // account response, which includes the API key and account identifiers.
    const body=await this.client.get('/v4/account',{},300000);
    const sub=body.subscriptions?.find(s=>s.subscription_id===body.current_subscription_id && s.is_active)
      || body.subscriptions?.find(s=>s.is_active);
    if (!sub || !Number.isFinite(sub.request_limit) || !Number.isFinite(sub.request_count)) throw unavailable('no active subscription with a valid request allowance.');
    this.subscription={limit:sub.request_limit,used:sub.request_count,remaining:Math.max(0,sub.request_limit-sub.request_count),
      sports:sub.sport_ids || [],bookmakers:Object.fromEntries(Object.entries(sub.bookmakers || {}).map(([name,b])=>[name,{has_live_odds:b.has_live_odds===true,has_player_props:b.has_player_props===true}])),valid_until:sub.valid_until || null};
    this.checkedAt=Date.now(); return this.subscription;
  }
  async getAccess(sport) {
    if (!this.settings.enabled) throw unavailable('disabled.');
    const a=await this.account();
    const result={provider:'oddsPapi',...a,checked_at:new Date(this.checkedAt).toISOString()};
    if (sport) {
      result.scope=await this.scope(sport);
      const catalogue=await this.catalogue(result.scope);
      const unique=new Map();
      for (const m of catalogue.filter(m=>!m.playerProp)) {
        const k=JSON.stringify([m.marketName,m.marketType,m.period]);
        if (!unique.has(k)) unique.set(k,{id:m.marketId,name:m.marketName,type:m.marketType,period:m.period,length:m.marketLength,handicap:m.handicap,outcomes:m.outcomes});
      }
      result.market_reference=[...unique.values()].slice(0,60);
    }
    return result;
  }
  async scope(sport) {
    const key=aliases[sport] || sport, mapping=SCOPES[key];
    if (!mapping) throw unavailable(`unsupported sport ${sport}.`);
    const account=await this.account();
    const sports=await this.call('/v4/sports',{},86400000);
    if (!Array.isArray(sports)) throw unavailable('invalid sports catalogue.');
    const sportRows=sports.filter(s=>s.slug===mapping[0] || (mapping[0]==='ice-hockey' && s.slug==='hockey'));
    if (sportRows.length!==1) throw unavailable(`could not resolve ${mapping[0]}.`);
    const sportId=sportRows[0].sportId;
    if (!account.sports.includes(sportId)) throw unavailable('sport is not included in this subscription.');
    const rows=await this.call('/v4/tournaments',{sportId},86400000);
    if (!Array.isArray(rows)) throw unavailable('invalid tournament catalogue.');
    const matches=rows.filter(r=>(r.tournamentSlug===mapping[1] || r.tournamentName?.toLowerCase()===mapping[1]) && ['usa','united-states','us'].includes(r.categorySlug));
    if (matches.length!==1) throw unavailable(`could not uniquely resolve ${key}.`,{available_tournaments:rows.filter(r=>/nfl|nba|ncaa|mlb|nhl/i.test(r.tournamentName || '')).slice(0,12).map(r=>({name:r.tournamentName,slug:r.tournamentSlug,category:r.categorySlug}))});
    return {key,sportId,tournamentId:matches[0].tournamentId};
  }
  validate(params={}) {
    if (params.regions && csv(params.regions).some(r=>r!=='us')) throw unavailable('this adapter supports the US region only.');
    if (String(params.live)==='true' || String(params.is_live)==='true') throw unavailable('this free-plan adapter supports pregame only.');
    if (params.oddsFormat && !['american','decimal'].includes(params.oddsFormat)) throw new HttpError(400,'Invalid oddsFormat.');
    if (params.dateFormat && !['iso','unix'].includes(params.dateFormat)) throw new HttpError(400,'Invalid dateFormat.');
    const from=params.commenceTimeFrom ? Date.parse(params.commenceTimeFrom) : Date.now();
    const to=params.commenceTimeTo ? Date.parse(params.commenceTimeTo) : from+7*86400000;
    if (!Number.isFinite(from)||!Number.isFinite(to)||to<from) throw new HttpError(400,'Invalid event time window.');
    return {from,to};
  }
  async books(params) {
    const sub=await this.account();
    // Only query books actually granted to this key; never silently ignore a
    // requested book the subscription cannot provide.
    const requested=csv(params.bookmakers);
    const books=requested.length ? requested : Object.keys(sub.bookmakers).filter(b=>['pinnacle','draftkings','fanduel','betmgm'].includes(b)).slice(0,3);
    if (!books.length || books.length>3 || books.some(b=>!Object.hasOwn(sub.bookmakers,b))) throw unavailable('requested sportsbooks are not available on this plan, or more than three were requested.');
    return books;
  }
  event(row,scope,params,bounds) {
    if (row.statusId!==0 || String(row.tournamentId)!==String(scope.tournamentId) || row.sportId!==scope.sportId) return null;
    const start=Date.parse(row.startTime);
    if (!Number.isFinite(start)||start<=Date.now()||start<bounds.from||start>bounds.to) return null;
    if (!row.fixtureId||!row.participant1Name||!row.participant2Name) throw unavailable('fixture is missing identifiers or team names.');
    return {id:row.fixtureId,provider_event_id:row.fixtureId,sport_key:scope.key,
      home_team:row.participant1Name,away_team:row.participant2Name,commence_time:params.dateFormat==='unix'?Math.floor(start/1000):row.startTime,status:'Upcoming'};
  }
  envelope(data,extra={}) { return {provider:'oddsPapi',data,quota:{limit:this.subscription?.limit,remaining:this.subscription?.remaining},meta:{coverage:'pregame_betting_events',complete_schedule:false,fetched_at:this.client.lastReadAt,note:'Prices are the latest returned snapshot; changedAt is a price-change time, not a feed-refresh timestamp. Verify availability at the sportsbook.',...extra}}; }
  async getEvents(sport,params={}) {
    const bounds=this.validate(params), books=await this.books(params), scope=await this.scope(sport);
    const rows=await this.call('/v4/fixtures',{tournamentId:scope.tournamentId,from:new Date(bounds.from).toISOString(),to:new Date(bounds.to).toISOString(),statusId:0,hasOdds:true,bookmakers:books.join(',')},60000);
    if (!Array.isArray(rows)) throw unavailable('invalid fixture response.');
    const data=rows.map(r=>this.event(r,scope,params,bounds)).filter(Boolean);
    if (!data.length) throw unavailable('no matching pregame fixtures with odds.');
    return this.envelope(data);
  }
  async catalogue(scope) {
    const rows=await this.call('/v4/markets',{},86400000);
    if (!Array.isArray(rows)) throw unavailable('invalid market catalogue.');
    return rows.filter(r=>r.sportId===scope.sportId);
  }
  // Deliberately exact: never label DNB, half/period or three-way regulation
  // results as the gateway's two-way full-game moneyline.
  marketKey(m) {
    const name=String(m.marketName || '').toLowerCase();
    if (m.playerProp || !['fulltime','including-overtime','inclovertime'].includes(String(m.period).toLowerCase())) return null;
    if (m.marketLength!==2) return null;
    if (['moneyline','money line','winner (incl. overtime)','winner incl. overtime','full time winner','match winner','winner'].includes(name)) return 'h2h';
    if (['asian handicap','handicap','point spread','spread','run line','puck line','handicap (incl. overtime)'].includes(name)) return 'spreads';
    if (['over under full time','over/under','total points','total runs','total goals','totals','total (incl. overtime)'].includes(name)) return 'totals';
    return null;
  }
  normalizeOdds(row,scope,params,bounds,books,catalogue,markets) {
    const event=this.event(row,scope,params,bounds); if (!event) return null;
    event.bookmakers=[];
    for (const key of books) {
      const b=row.bookmakerOdds?.[key];
      if (!b || b.bookmakerIsActive!==true || b.suspended===true) continue;
      const grouped=new Map();
      for (const [id, raw] of Object.entries(b.markets || {})) {
        if (raw.marketActive===false) continue;
        const def=catalogue.find(m=>String(m.marketId)===id), normalized=def && this.marketKey(def);
        if (!normalized || !markets.includes(normalized)) continue;
        const outcomes=[];
        for (const outcome of def.outcomes || []) {
          const p=raw.outcomes?.[outcome.outcomeId]?.players?.['0'];
          if (!p || p.active!==true || p.playerName || (normalized!=='h2h' && p.mainLine!==true)) continue;
          const decimal=Number(p.price);
          if (!Number.isFinite(decimal)||decimal<=1) continue;
          const label=String(outcome.outcomeName).toLowerCase();
          const side=['1','home','home team'].includes(label)?'home':['2','away','away team'].includes(label)?'away':null;
          const name=normalized==='totals' ? (label==='over'?'Over':label==='under'?'Under':null) : side==='home'?event.home_team:side==='away'?event.away_team:null;
          if (!name) continue;
          const point=Number(def.handicap);
          if (normalized!=='h2h' && (def.handicap===null||!Number.isFinite(point))) continue;
          const price=params.oddsFormat==='decimal'?decimal:Math.round(decimal>=2?(decimal-1)*100:-100/(decimal-1));
          outcomes.push({name,price,...(normalized!=='h2h'?{point:normalized==='spreads'&&side==='away'?-point:point}:{}),...(p.changedAt?{last_update:p.changedAt}:{})});
        }
        if (outcomes.length===2) {
          if (!grouped.has(normalized)) grouped.set(normalized,[]);
          grouped.get(normalized).push(...outcomes);
        }
      }
      const mapped=[...grouped].map(([key,outcomes])=>({key,outcomes}));
      if (mapped.length) event.bookmakers.push({key,title:key,markets:mapped});
    }
    return event.bookmakers.length?event:null;
  }
  async odds(sport,params={},eventId=null) {
    const bounds=this.validate(params), markets=csv(params.markets || 'h2h,spreads,totals');
    if (!markets.length || markets.some(m=>!['h2h','spreads','totals'].includes(m))) throw unavailable('this adapter currently supports h2h, spreads and totals only; use another provider for props or alternates.');
    const books=await this.books(params), scope=await this.scope(sport), catalogue=await this.catalogue(scope);
    const args={bookmakers:books.join(','),verbosity:3};
    const body=eventId ? await this.call('/v4/odds',{...args,fixtureId:eventId},60000) : await this.call('/v4/odds-by-tournaments',{...args,tournamentIds:scope.tournamentId},60000);
    const rows=eventId?[body]:Array.isArray(body)?body:null;
    if (!rows) throw unavailable('invalid odds response.');
    const ids=eventId?[eventId]:csv(params.eventIds);
    const data=rows.filter(r=>!ids.length||ids.includes(r.fixtureId)).map(r=>this.normalizeOdds(r,scope,params,bounds,books,catalogue,markets)).filter(Boolean);
    const found=new Set(data.flatMap(e=>e.bookmakers.flatMap(b=>b.markets.map(m=>m.key))));
    if (!data.length||markets.some(m=>!found.has(m))) throw unavailable('no usable odds for every requested market.',{market_reference:catalogue.filter(m=>m.marketLength===2&&!m.playerProp).slice(0,15).map(m=>({name:m.marketName,type:m.marketType,period:m.period}))});
    return this.envelope(eventId?data[0]:data,{requested_markets:markets});
  }
  getOddsBoard(sport,params) {return this.odds(sport,params);}
  getEventOdds(sport,eventId,params) {return this.odds(sport,params,eventId);}
  getSports() {throw unavailable('use another provider for the sports catalogue.');}
  getScores() {throw unavailable('use the API-Sports game tools for scores.');}
}
export const oddsPapiProvider=new OddsPapiProvider(config.oddsProviders.oddsPapi);
