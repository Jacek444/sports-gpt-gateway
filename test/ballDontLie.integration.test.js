import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('BALLDONTLIE flows through HTTP and MCP with cache, details, teams and truthful fallback',async()=>{
  let calls=0,fail=false;
  const start=new Date(Date.now()+86400000).toISOString();
  const game={id:42,date:start,status_state:'final',status:'Final',home_team:{id:1,full_name:'Home'},visitor_team:{id:2,full_name:'Away'},home_team_score:28,visitor_team_score:0};
  const upstream=createServer((req,res)=>{
    const u=new URL(req.url,'http://localhost');res.setHeader('Content-Type','application/json');
    if(u.pathname.startsWith('/rest/v1/'))return res.end('[]');
    if(u.pathname.startsWith('/nfl/v1/')){
      calls++;assert.equal(req.headers.authorization,'fixture-key');
      if(fail){res.statusCode=401;return res.end('{"error":"plan restriction"}');}
      const data=u.pathname.endsWith('/teams')?[game.home_team,game.visitor_team]:u.pathname.endsWith('/42')?game:[game];
      return res.end(JSON.stringify({data,meta:{next_cursor:null}}));
    }
    if(u.pathname==='/v1/sports/americanfootball_nfl/events')return res.end(JSON.stringify([{id:'odds-game',home_team:'Home',away_team:'Away',commence_time:start}]));
    res.statusCode=404;res.end('{}');
  }).listen(0,'127.0.0.1');
  await once(upstream,'listening');const base=`http://127.0.0.1:${upstream.address().port}`;
  const reserve=createServer().listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;
  await new Promise(resolve=>reserve.close(resolve));
  const child=spawn(process.execPath,['src/server.js'],{env:{
    ...process.env,PORT:String(port),NODE_ENV:'production',DOTENV_CONFIG_PATH:'/nonexistent-test-env',
    SUPABASE_URL:base,SUPABASE_SECRET_KEY:'fixture-key',DEFAULT_PROVIDER:'balldontlie',
    BALLDONTLIE_API_KEY:'fixture-key',BALLDONTLIE_BASE_URL:base,API_SPORTS_ENABLED:'false',SPORTSDATAIO_API_KEY:'',
    PARLAY_API_ENABLED:'true',PARLAY_API_KEY:'fixture-key',PARLAY_API_BASE_URL:base,
    ODDS_PROVIDER_ORDER:'parlayApi',ODDS_SPORTS_PROVIDER_ORDER:'parlayApi',
    ...Object.fromEntries(['NBA','NFL','NCAAM','NCAAF','MLB','NHL'].map(l=>[`PROVIDER_${l}`,'']))
  },stdio:['ignore','pipe','pipe']});
  let logs='';child.stderr.on('data',chunk=>{logs+=chunk;});
  try{
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error(logs||'Server failed to start')),5000);
      child.once('exit',()=>{clearTimeout(timer);reject(Error(logs));});
      child.stdout.on('data',chunk=>{if(String(chunk).includes('listening')){clearTimeout(timer);resolve();}});
    });
    const get=async path=>{const r=await fetch(`http://127.0.0.1:${port}${path}`);return {status:r.status,body:await r.json()};};
    const health=(await get('/health')).body;
    assert.deepEqual(health.league_data.NFL.fallback_order,['balldontlie','odds']);
    const first=(await get('/v1/games?league=NFL')).body;
    assert.equal(first.provider,'balldontlie');assert.equal(first.data[0].score.away,0);assert.equal(calls,1);
    await get('/v1/games?league=NFL');assert.equal(calls,1);
    const detail=(await get('/v1/games/NFL/balldontlie%3ANFL%3A42')).body;
    assert.equal(detail.data.id,first.data[0].id);
    assert.equal((await get('/v1/teams?league=NFL')).body.data.length,2);
    const mcp=await fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'sharpbet_list_games',arguments:{league:'NFL'}}})});
    assert.equal(mcp.status,200);
    const text=await mcp.text();assert.match(text,/balldontlie:NFL:42/);
    assert.equal(calls,3); // The MCP tool uses the same cached gateway request.
    fail=true;
    const fallback=(await get('/v1/games?league=NFL&limit=10')).body;
    assert.equal(fallback.provider,'parlayApi');assert.equal(fallback.meta.fallback_from,'balldontlie');
    assert.equal(fallback.meta.coverage,'betting_events');assert.equal(fallback.data[0].score.home,null);
    const tried=calls;await get('/v1/games?league=NFL&limit=11');assert.equal(calls,tried);
    const pinned=await get('/v1/games/NFL/balldontlie%3ANFL%3A43');assert.equal(pinned.status,503);
    assert.equal((await get('/v1/games?league=NFL&season=2026')).status,503);
  }finally{
    if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}
    upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));
  }
});
