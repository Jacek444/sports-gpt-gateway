import test from 'node:test';
import assert from 'node:assert/strict';
import { FreeProviderClient } from '../src/clients/freeProviderClient.js';
import { ApiSportsProvider, normalizeApiSportsGame } from '../src/providers/apiSportsProvider.js';
import { OddsPapiProvider } from '../src/oddsProviders/oddsPapiProvider.js';
const json = (body, status=200, headers={}) => new Response(JSON.stringify(body),{status,headers});
const key='sentinel-private-api-key';
const settings={enabled:true,apiKey:key,baseUrl:'https://provider.example'};

test('free client authenticates, coalesces and caches without keys in errors/cache identifiers', async()=>{
 let calls=0;
 const c=new FreeProviderClient({name:'apisports',...settings,fetcher:async(url,opts)=>{calls++;assert.equal(opts.headers['x-apisports-key'],key); assert.equal(url.searchParams.has('apiKey'),false);return json({response:[]});}});
 await Promise.all([c.get('/games'),c.get('/games')]); await c.get('/games');
 assert.equal(calls,1); assert.equal(JSON.stringify([...c.cache.keys()]).includes(key),false);
 const bad=new FreeProviderClient({name:'oddsPapi',...settings,queryAuth:true,fetcher:async(url)=>{assert.equal(url.searchParams.get('apiKey'),key);throw new Error(url.toString());}});
 await assert.rejects(bad.get('/odds'),e=>!JSON.stringify(e).includes(key)&&!e.message.includes(key));
});

test('HTTP 200 quota errors are failures, daily cooldown blocks requests but permits status',async()=>{
 let calls=0;
 const c=new FreeProviderClient({name:'apisports',...settings,fetcher:async(url)=>{calls++;return url.pathname==='/status'?json({response:{}}):json({errors:{requests:`Daily limit ${key}`}},200,{'x-ratelimit-requests-remaining':'0'});}});
 await assert.rejects(c.get('/games'),e=>e.details.upstreamStatus===429&&!e.message.includes(key));
 await assert.rejects(c.get('/teams')); assert.equal(calls,1); assert.ok(c.blockedUntil>Date.now());
 await c.get('/status'); assert.equal(calls,2);
});
const game=(status='FT')=>({game:{id:9,date:{timestamp:Date.parse('2026-09-29T23:30:00Z')/1000},status:{short:status,long:status},week:'Week 4'},league:{id:1,season:2026},teams:{home:{id:1,name:'Home'},away:{id:2,name:'Away'}},scores:{home:{total:0},away:{total:7}}});
test('NFL and hockey scores retain true zero, null scheduled scores and unknown statuses',()=>{
 assert.deepEqual(normalizeApiSportsGame('NFL',game()).score,{home:0,away:7});
 assert.deepEqual(normalizeApiSportsGame('NFL',game('NS')).score,{home:null,away:null});
 assert.equal(normalizeApiSportsGame('NFL',game('NEW')).status.is_live,null);
 const h={...game(),id:9,date:'2026-09-29T23:30:00Z',status:{short:'P2'},scores:{home:2,away:0}};delete h.game;
 assert.deepEqual(normalizeApiSportsGame('NHL',h).score,{home:2,away:0});
 assert.equal(normalizeApiSportsGame('NHL',h).status.code,'live');
});
function apiProvider(fetcher,fallback=null){const p=new ApiSportsProvider(settings,fallback,fetcher);p.client('NFL').intervalMs=0;return p;}
test('API-Sports filters UTC date/league, preserves IDs and refuses incorrect event IDs',async()=>{
 const p=apiProvider(async(url)=>url.pathname==='/leagues'?json({response:[{id:1,name:'NFL',country:{name:'USA'},seasons:[{season:2026,current:true}]}]}):json({response:[game(),{...game(),league:{id:2}}, {...game(),game:{...game().game,id:10,date:{timestamp:Date.parse('2026-09-30T01:00Z')/1000}}}]}));
 const r=await p.listGames({league:'NFL',date:'2026-09-29'});assert.equal(r.data.length,1);assert.equal(r.data[0].id,'apisports:NFL:9');
 await assert.rejects(p.getGame({league:'NFL',gameId:'sharpApi:9'}),e=>e.status===400);
 await assert.rejects(p.listGames({league:'NFL',date:'2026-02-30'}),e=>e.status===400);
});
test('API-Sports access diagnostics whitelist account fields and fallback labels plan failures',async()=>{
 const p=apiProvider(async(url)=>url.pathname==='/status'?json({response:{account:{email:key},subscription:{plan:'Free',active:true,secret:key},requests:{current:3,limit_day:100}}}):json({errors:{plan:`Free plan ${key}`}}),{listGames:async()=>({provider:'sharpApi',data:[],meta:{coverage:'betting_events'}})});
 assert.equal(JSON.stringify(await p.getAccess('NFL')).includes(key),false);
 const r=await p.listGames({league:'NFL',date:'2026-09-29'});assert.equal(r.provider,'sharpApi');assert.equal(r.meta.fallback_from,'apisports');
 await assert.rejects(p.listGames({league:'NFL',season:2026}));
});
const account={api_key:key,current_subscription_id:1,subscriptions:[{subscription_id:1,is_active:true,request_limit:250,request_count:2,sport_ids:[12],bookmakers:{pinnacle:{has_live_odds:false,has_player_props:false,secret:key}}}]};
const scope={key:'americanfootball_nfl',sportId:12,tournamentId:100};
const markets=[{marketId:1,marketName:'Moneyline',marketLength:2,sportId:12,period:'fulltime',handicap:0,outcomes:[{outcomeId:11,outcomeName:'1'},{outcomeId:12,outcomeName:'2'}]},
{marketId:2,marketName:'Handicap',marketLength:2,sportId:12,period:'fulltime',handicap:-3.5,outcomes:[{outcomeId:21,outcomeName:'1'},{outcomeId:22,outcomeName:'2'}]},
{marketId:3,marketName:'Over Under Full Time',marketLength:2,sportId:12,period:'fulltime',handicap:44.5,outcomes:[{outcomeId:31,outcomeName:'Over'},{outcomeId:32,outcomeName:'Under'}]}];
const fixture=()=>({fixtureId:'fixture1',sportId:12,tournamentId:100,statusId:0,startTime:new Date(Date.now()+86400000).toISOString(),participant1Name:'Home',participant2Name:'Away',bookmakerOdds:{pinnacle:{bookmakerIsActive:true,suspended:false,markets:Object.fromEntries(markets.map(m=>[m.marketId,{marketActive:true,outcomes:Object.fromEntries(m.outcomes.map(o=>[o.outcomeId,{players:{'0':{active:true,price:1.91,mainLine:true,playerName:null,changedAt:'2026-09-29T00:00Z'}}}]))}]))}}});
function oddsProvider(fetcher){const p=new OddsPapiProvider(settings,fetcher);p.client.intervalMs=0;return p;}
test('OddsPapi access whitelists secrets and refuses unsubscribed books before charged calls',async()=>{
 let calls=0;const p=oddsProvider(async()=>{calls++;return json(account);});
 const a=await p.getAccess();assert.equal(a.remaining,248);assert.equal(JSON.stringify(a).includes(key),false);
 await assert.rejects(p.books({bookmakers:'draftkings'}));assert.equal(calls,1);
 await assert.rejects(p.getOddsBoard('NFL',{markets:'player_points'}));assert.equal(calls,1);
});
test('OddsPapi normalizes both sides and signs while excluding inactive, props and alternate markets',()=>{
 const p=oddsProvider(); const f=fixture();const bounds={from:Date.now(),to:Date.now()+2*86400000};
 let r=p.normalizeOdds(f,scope,{},bounds,['pinnacle'],markets,['h2h','spreads','totals']);
 assert.deepEqual(r.bookmakers[0].markets.find(m=>m.key==='spreads').outcomes.map(o=>[o.name,o.point]),[['Home',-3.5],['Away',3.5]]);
 assert.equal(r.bookmakers[0].markets[0].outcomes[0].price,-110);
 f.bookmakerOdds.pinnacle.markets[2].outcomes[21].players[0].mainLine=false;
 r=p.normalizeOdds(f,scope,{},bounds,['pinnacle'],markets,['spreads']);assert.equal(r,null);
 assert.equal(p.marketKey({...markets[0],period:'firsthalf'}),null);
 assert.equal(p.marketKey({...markets[0],playerProp:true}),null);
 assert.equal(p.marketKey({...markets[0],marketLength:3}),null);
 f.bookmakerOdds.pinnacle.suspended=true;assert.equal(p.normalizeOdds(f,scope,{},bounds,['pinnacle'],markets,['h2h']),null);
});
test('OddsPapi discovers exact competition, returns pregame board, reuses reference cache and budgets failures',async()=>{
 const calls=[];
 const p=oddsProvider(async(url)=>{calls.push(url.pathname);const body={'/v4/account':account,'/v4/sports':[{slug:'american-football',sportId:12}],'/v4/tournaments':[{tournamentId:100,tournamentSlug:'nfl',categorySlug:'usa'}],'/v4/markets':markets,'/v4/odds-by-tournaments':[fixture()]}[url.pathname];return json(body);});
 const r=await p.getOddsBoard('NFL',{});assert.equal(r.data.length,1);assert.equal(r.data[0].bookmakers[0].markets.length,3);
 await p.getOddsBoard('NFL',{});assert.equal(calls.length,5);assert.equal(p.subscription.remaining,244);
});
