import test from 'node:test';
import assert from 'node:assert/strict';
import { CachedDataClient } from '../src/clients/cachedDataClient.js';
import { MoneylineProvider,normalizeMoneylineGame } from '../src/providers/moneylineProvider.js';
import { MoneylineOddsProvider } from '../src/oddsProviders/moneylineOddsProvider.js';
import { TheSportsDbProvider,normalizeSportsDbGame } from '../src/providers/theSportsDbProvider.js';
import { LeagueDataChain } from '../src/providers/leagueDataChain.js';
import { HttpError } from '../src/errors.js';
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers});
const settings={enabled:true,apiKey:'fixture-secret',baseUrl:'https://provider.example/v1'};
const now=Date.parse('2026-09-30T12:00:00Z');
const event={eventId:'nfl-ev-42',leagueId:'nfl',homeTeamId:'nfl-home',homeTeamName:'Home',awayTeamId:'nfl-away',awayTeamName:'Away',startTime:'2026-10-01T23:00:00Z',status:'scheduled',scores:{home:0,away:0}};
const market={marketType:'moneyline',isAlternate:false,isStale:false,lastUpdate:'2026-09-30T11:59:00Z',outcomes:[{name:'Different home spelling',price:-120,side:'home',isPriceable:true},{name:'Away',price:105,side:'away',isPriceable:true}]};
const odds={eventId:event.eventId,leagueId:'nfl',bookmakers:[{bookmakerId:'draftkings',bookmakerName:'DraftKings',sourceType:'sportsbook',sourceRegion:'us',markets:[market]}]};
const sportsbookRow={idEvent:'55',idLeague:'4391',strSport:'American Football',strHomeTeam:'Home',idHomeTeam:'1',strAwayTeam:'Away',idAwayTeam:'2',dateEvent:'2026-09-30',strTimestamp:'2026-09-30T23:00:00',strStatus:'Not Started',intHomeScore:'0',intAwayScore:'0'};

test('additional clients authenticate, coalesce/cache and enforce the rolling free allowance',async()=>{
  let calls=0,time=now;
  const client=new CachedDataClient({name:'moneyline',...settings,now:()=>time,fetcher:async(u,o)=>{calls++;assert.equal(o.headers['x-api-key'],settings.apiKey);assert.equal(u.pathname,'/v1/events');return json({success:true,data:[]});}});
  await Promise.all([client.get('/events'),client.get('/events')]);assert.equal(calls,1);
  for(let i=0;i<9;i++)await client.get('/events',{page:i});
  await assert.rejects(client.get('/events',{page:99}),e=>e.details.upstreamStatus===429);assert.equal(calls,10);
  await client.get('/events');assert.equal(calls,10);
  time+=60001;await client.get('/events',{page:99});assert.equal(calls,11);
  assert.ok(![...client.cache.keys()].join().includes(settings.apiKey));
});

test('SportsDB path keys never leak through transport errors or cache keys; error payloads are failures',async()=>{
  const client=new CachedDataClient({name:'thesportsdb',...settings,pathAuth:true,fetcher:async u=>{assert.equal(u.pathname,'/v1/fixture-secret/eventsday.php');throw Error(String(u));}});
  await assert.rejects(client.get('/eventsday.php'),e=>e.status===502&&!JSON.stringify(e).includes(settings.apiKey));
  await assert.rejects(client.get('/../secret'),e=>e.status===400);
  const invalid=new CachedDataClient({name:'thesportsdb',...settings,fetcher:async()=>json({events:[],Message:'Invalid League ID passed'})});
  await assert.rejects(invalid.get('/eventsday.php'),e=>e.status===503);
});

test('monthly quota failures cool down and retain cached data',async()=>{
  let calls=0;const client=new CachedDataClient({name:'moneyline',...settings,now:()=>now,fetcher:async()=>++calls===1?json({success:true,data:[]}):json({success:false,error:{message:'Monthly credits exhausted'}},429)});
  await client.get('/teams');
  await assert.rejects(client.get('/events'),e=>e.details.retryAfter===3600);
  await client.get('/teams');await assert.rejects(client.get('/leagues'));assert.equal(calls,2);
});

test('MoneyLine scores, TBA, stubs, unknown outcomes and league identity stay truthful',()=>{
  const scheduled=normalizeMoneylineGame('NFL',event);assert.deepEqual(scheduled.score,{home:null,away:null});
  const final=normalizeMoneylineGame('NFL',{...event,status:'final',scores:{home:21,away:0}});assert.deepEqual(final.score,{home:21,away:0});
  const tba=normalizeMoneylineGame('NFL',{...event,startTimeTBA:true,isStub:true});assert.equal(tba.start_time,null);assert.equal(tba.is_stub,true);
  const unknown=normalizeMoneylineGame('NFL',{...event,status:'no_result'});assert.equal(unknown.status.is_live,null);assert.equal(unknown.score.home,null);
  assert.throws(()=>normalizeMoneylineGame('NBA',event),e=>e.status===502);
});

test('MoneyLine game/teams flow preserves page cursors, filters and canonical merged IDs',async()=>{
  let calls=0;const p=new MoneylineProvider(settings,{fetcher:async u=>{
    calls++;
    if(u.pathname.endsWith('/teams'))return json({success:true,data:[{teamId:'nfl-home',name:'Home',leagueId:'nfl',abbreviation:'HOM'}]});
    if(u.pathname.endsWith('/old-stub'))return json({success:true,data:{...event,canonicalEventId:event.eventId}});
    assert.equal(u.searchParams.get('page'),'2');return json({success:true,data:[event],meta:{pages:3}});
  }});
  const r=await p.listGames({league:'NFL',date:'2026-10-01',cursor:'moneyline:2',team:'moneyline:NFL:nfl-home'});
  assert.equal(r.meta.next_cursor,'moneyline:3');assert.equal(r.data[0].id,'moneyline:NFL:nfl-ev-42');
  assert.equal((await p.getGame({league:'NFL',gameId:'moneyline:NFL:old-stub'})).data.provider_game_id,event.eventId);
  await p.listTeams({league:'NFL',search:'HOM'});await p.listTeams({league:'NFL',search:'Home'});assert.equal(calls,3);
  await assert.rejects(p.listGames({league:'NFL',season:2026}),e=>e.status===503);
  await assert.rejects(p.listGames({league:'NFL',cursor:'balldontlie:4'}),e=>e.status===400);
  await assert.rejects(p.getGame({league:'NFL',gameId:'moneyline:NBA:nba-42'}),e=>e.status===400);
});

function moneyOdds(fetcher){return new MoneylineOddsProvider(new MoneylineProvider(settings,{fetcher,now:()=>now}),()=>now);}
test('MoneyLine joins events by ID, honors sportsbook identity and never uses aggregate fair odds',async()=>{
  let calls=0;const p=moneyOdds(async u=>{calls++;return u.pathname==='/v1/events'?json({success:true,data:[event],meta:{pages:1}}):json({success:true,data:{...odds,summary:{fairOdds:9000}}});});
  const r=await p.getOddsBoard('NFL',{markets:'h2h'});assert.equal(r.data[0].gateway_event_id,'moneyline:nfl-ev-42');
  assert.equal(r.data[0].bookmakers[0].markets[0].outcomes[0].name,'Home');assert.equal(r.data[0].bookmakers[0].markets[0].outcomes[0].price,-120);
  await p.getOddsBoard('NFL',{markets:'h2h'});assert.equal(calls,2);
});

test('MoneyLine rejects stale, alternate, DFS, ambiguous, placeholder and incomplete prices',()=>{
  const p=moneyOdds(()=>assert.fail('normalization only')),bounds=p.validate({markets:'h2h'}),e=p.event(event,'NFL',{},bounds);
  for(const m of [{...market,isStale:true},{...market,lastUpdate:'2026-09-29T00:00:00Z'},{...market,isAlternate:true},{...market,outcomes:[market.outcomes[0]]},{...market,outcomes:market.outcomes.map(o=>({...o,isPriceable:false}))}]){
    assert.equal(p.normalize({...odds,bookmakers:[{...odds.bookmakers[0],markets:[m]}]},e,bounds,{}),null);
  }
  assert.equal(p.normalize({...odds,bookmakers:[{...odds.bookmakers[0],sourceType:'dfs'}]},e,bounds,{}),null);
  assert.equal(p.normalize({...odds,bookmakers:[{...odds.bookmakers[0],markets:[market,market]}]},e,bounds,{}),null);
  assert.equal(p.event({...event,startTimeTBA:true},'NFL',{},bounds),null);
  for(const params of [{markets:'player_points'},{live:'true'},{bookmakers:'unknown'},{regions:'uk'}])assert.throws(()=>p.validate(params),e=>e.status===503);
});

test('MoneyLine spreads/totals require compatible paired points and preserve decimal conversion',()=>{
  const p=moneyOdds(()=>assert.fail()),bounds=p.validate({markets:'spreads,totals'}),e=p.event(event,'NFL',{},bounds);
  const spread={...market,marketType:'spread',outcomes:[{...market.outcomes[0],point:-3},{...market.outcomes[1],point:3}]};
  const total={...market,marketType:'total',outcomes:[{...market.outcomes[0],side:'over',point:42.5},{...market.outcomes[1],side:'under',point:42.5}]};
  const row={...odds,bookmakers:[{...odds.bookmakers[0],markets:[spread,total]}]};
  assert.equal(p.normalize(row,e,bounds,{oddsFormat:'decimal'}).bookmakers[0].markets.length,2);
  total.outcomes[1].point=43;spread.outcomes[1].point=4;assert.equal(p.normalize(row,e,bounds,{}),null);
});

test('MoneyLine refuses unfinished pagination before reporting a complete board',async()=>{
  const p=moneyOdds(async()=>json({success:true,data:[event],meta:{pages:99}}));
  await assert.rejects(p.getEvents('NFL'),e=>e.status===503&&/pagination/.test(e.message));
});

test('MoneyLine free-budget board requests at most four event prices and labels partial coverage',async()=>{
  const ids=[];
  const p=moneyOdds(async u=>{
    if(u.pathname==='/v1/events')return json({success:true,data:Array.from({length:6},(_,i)=>({...event,eventId:`nfl-${i}`})),meta:{pages:1}});
    const id=u.pathname.split('/').at(-2);ids.push(id);return json({success:true,data:{...odds,eventId:id}});
  });
  const r=await p.getOddsBoard('NFL',{markets:'h2h'});assert.equal(ids.length,4);assert.equal(r.meta.truncated,true);assert.equal(r.meta.events_discovered,6);
  await assert.rejects(p.getOddsBoard('NFL',{markets:'h2h',eventIds:'missing'}));
});

test('TheSportsDB free v1 uses league IDs and marks the capped schedule/directory partial',async()=>{
  let calls=0;const p=new TheSportsDbProvider({...settings,apiKey:'123'},{fetcher:async u=>{
    calls++;assert.match(u.pathname,/\/123\//);
    if(u.pathname.endsWith('search_all_teams.php'))return json({teams:[{idTeam:'1',strTeam:'Home',strLeague:'NFL',idLeague:'4391',strSport:'American Football'}]});
    if(u.pathname.endsWith('eventsday.php'))assert.equal(u.searchParams.get('l'),'4391');
    return json({events:[sportsbookRow]});
  }});
  const r=await p.listGames({league:'NFL',date:'2026-09-30'});assert.equal(r.meta.upstream_limit,3);assert.equal(r.meta.truncated,true);assert.equal(r.data[0].score.home,null);
  assert.equal(r.data[0].start_time,'2026-09-30T23:00:00Z');
  const directory=await p.listTeams({league:'NFL'});assert.equal(directory.meta.upstream_limit,10);assert.equal(calls,2);
  assert.equal((await p.getGame({league:'NFL',gameId:r.data[0].id})).data.id,r.data[0].id);
  await assert.rejects(p.getGame({league:'NBA',gameId:r.data[0].id}),e=>e.status===400);
  await assert.rejects(p.listGames({league:'NFL',season:2026}),e=>e.status===503);
  const unknown=normalizeSportsDbGame('NFL',{...sportsbookRow,strStatus:null,intHomeScore:'0',intAwayScore:'7'},'4391');
  assert.equal(unknown.status.is_live,null);assert.deepEqual(unknown.score,{home:0,away:7});
});

test('MoneyLine and TheSportsDB participate in discovery fallback without crossing identities',async()=>{
  const fail=async()=>{throw new HttpError(503,'unavailable');};
  const entries=[{name:'balldontlie',provider:{listGames:fail}},{name:'moneyline',provider:{listGames:async()=>({provider:'moneyline',data:[]})}},{name:'thesportsdb',provider:{listGames:()=>assert.fail('must not replace valid empty')}}];
  const chain=new LeagueDataChain(entries);const r=await chain.listGames({league:'NFL'});
  assert.equal(r.provider,'moneyline');assert.equal(r.meta.fallback_from,'balldontlie');
  await assert.rejects(chain.listGames({league:'NFL',team:'balldontlie:NFL:1'}));
  await assert.rejects(chain.listGames({league:'NFL',season:2026}));
});
