import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('MoneyLine odds, game details and SportsDB fallback flow through the gateway',async()=>{
  let failed=false;const start=new Date(Date.now()+86400000).toISOString(),day=start.slice(0,10);
  const event={eventId:'nfl-42',leagueId:'nfl',homeTeamName:'Home',awayTeamName:'Away',startTime:start,status:'scheduled'};
  const upstream=createServer((req,res)=>{
    const u=new URL(req.url,'http://localhost');res.setHeader('Content-Type','application/json');
    const send=body=>res.end(JSON.stringify(body));
    if(u.pathname.startsWith('/rest/v1/'))return send([]);
    if(u.pathname.startsWith('/ml/')){
      assert.equal(req.headers['x-api-key'],'fixture-key');
      if(failed){res.statusCode=429;return send({success:false,error:{message:'Rate limit'}});}
      if(u.pathname.endsWith('/teams'))return send({success:true,data:[{teamId:'nfl-home',name:'Home',leagueId:'nfl'}]});
      if(u.pathname.endsWith('/odds'))return send({success:true,data:{eventId:'nfl-42',leagueId:'nfl',bookmakers:[{bookmakerId:'draftkings',sourceType:'sportsbook',sourceRegion:'us',markets:[{marketType:'moneyline',isAlternate:false,isStale:false,lastUpdate:new Date().toISOString(),outcomes:[{name:'Home',side:'home',price:-120,isPriceable:true},{name:'Away',side:'away',price:110,isPriceable:true}]}]}]},meta:{pages:1}});
      return send({success:true,data:u.pathname.endsWith('/nfl-42')?event:[event],meta:{pages:1}});
    }
    if(u.pathname==='/db/123/search_all_teams.php')return send({teams:[{strLeague:'NFL',strSport:'American Football',idLeague:'4391',idTeam:'1',strTeam:'Home'}]});
    if(u.pathname==='/db/123/eventsday.php')return send({events:[{idLeague:'4391',idEvent:'55',dateEvent:day,strTimestamp:start,strHomeTeam:'Home',idHomeTeam:'1',strAwayTeam:'Away',idAwayTeam:'2',strStatus:'NS'}]});
    res.statusCode=404;send({});
  }).listen(0,'127.0.0.1');await once(upstream,'listening');const base=`http://127.0.0.1:${upstream.address().port}`;
  const reserve=createServer().listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
  const child=spawn(process.execPath,['src/server.js'],{env:{...process.env,PORT:String(port),NODE_ENV:'production',DOTENV_CONFIG_PATH:'/nonexistent-test-env',SUPABASE_URL:base,SUPABASE_SECRET_KEY:'fixture-key',
    DEFAULT_PROVIDER:'balldontlie',BALLDONTLIE_API_KEY:'',API_SPORTS_ENABLED:'false',SPORTSDATAIO_API_KEY:'',
    MONEY_LINE_API:'fixture-key',MONEYLINE_BASE_URL:base+'/ml',MONEYLINE_ENABLED:'true',THESPORTSDB_API_KEY:'123',THESPORTSDB_BASE_URL:base+'/db',THESPORTSDB_ENABLED:'true',
    ODDS_PROVIDER_ORDER:'moneyline',...Object.fromEntries(['NBA','NFL','NCAAM','NCAAF','MLB','NHL'].map(l=>[`PROVIDER_${l}`,'']))},stdio:['ignore','pipe','pipe']});
  let logs='';child.stderr.on('data',s=>{logs+=s;});
  try{
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(logs||'Startup timeout')),5000);child.once('exit',()=>{clearTimeout(timer);reject(Error(logs));});child.stdout.on('data',s=>{if(String(s).includes('listening')){clearTimeout(timer);resolve();}});});
    const get=async path=>{const r=await fetch(`http://127.0.0.1:${port}${path}`);return {status:r.status,body:await r.json()};};
    const health=(await get('/health')).body;assert.equal(health.provider_defaults.NFL,'moneyline');assert.equal(health.additional_providers.thesportsdb.configured,true);
    const board=await get('/v1/odds/americanfootball_nfl/odds?provider=moneyline&markets=h2h');assert.equal(board.status,200);assert.equal(board.body.provider,'moneyline');
    assert.equal(board.body.data[0].bookmakers[0].markets[0].outcomes[0].price,-120);
    const games=(await get(`/v1/games?league=NFL&date=${day}`)).body;assert.equal(games.data[0].id,'moneyline:NFL:nfl-42');
    assert.equal((await get('/v1/games/NFL/moneyline%3ANFL%3Anfl-42')).body.data.provider,'moneyline');
    assert.equal((await get('/v1/providers/access?provider=moneyline&league=NFL')).body.returned,1);
    failed=true;
    const fallback=(await get(`/v1/games?league=NFL&date=${day}&limit=3`)).body;
    assert.equal(fallback.provider,'thesportsdb');assert.equal(fallback.meta.complete_schedule,false);assert.equal(fallback.meta.fallback_from,'moneyline');
    assert.equal(fallback.data[0].id,'thesportsdb:NFL:55');
    assert.equal((await get('/v1/games/NFL/moneyline%3ANFL%3Anfl-unknown')).status,503);
  }finally{if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}upstream.closeAllConnections();await new Promise(r=>upstream.close(r));}
});
