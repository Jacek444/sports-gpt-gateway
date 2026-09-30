import test from 'node:test';
import assert from 'node:assert/strict';
import { BallDontLieClient } from '../src/clients/ballDontLieClient.js';
import { BallDontLieProvider, normalizeGame } from '../src/providers/ballDontLieProvider.js';
import { LeagueDataChain } from '../src/providers/leagueDataChain.js';
import { HttpError } from '../src/errors.js';

const key='fixture-secret-not-a-real-key';
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers});
const url=path=>new URL(path,'https://api.balldontlie.io');
const team=id=>({id,full_name:`Team ${id}`,abbreviation:`T${id}`});
const game={id:42,date:'2026-09-30T23:00:00Z',season:2026,status:'Final',home_team:team(1),visitor_team:team(2),home_team_score:21,visitor_team_score:0};
const provider=fetcher=>new BallDontLieProvider({apiKey:key,fetcher});

test('BDL caches and coalesces reads, limits misses to five/minute, and resumes after reset',async()=>{
  let now=100000,calls=0;
  const client=new BallDontLieClient({apiKey:key,now:()=>now,fetcher:async(_url,options)=>{
    calls++;assert.equal(options.headers.Authorization,key);assert.equal(options.redirect,'error');return json({data:[]});
  }});
  await Promise.all([client.get(url('/nba/v1/games')),client.get(url('/nba/v1/games'))]);
  assert.equal(calls,1);
  for(let i=0;i<4;i++)await client.get(url(`/nba/v1/games?cursor=${i}`));
  await assert.rejects(client.get(url('/nfl/v1/games')),e=>e.details.upstreamStatus===429);
  await client.get(url('/nba/v1/games'));assert.equal(calls,5);
  now+=60001;await client.get(url('/nfl/v1/games'));assert.equal(calls,6);
});

test('BDL paid-resource restrictions do not disable free endpoints or disclose credentials',async()=>{
  let calls=0;
  const client=new BallDontLieClient({apiKey:key,fetcher:async u=>{
    calls++;return u.pathname.endsWith('standings')?json({error:key},401):json({data:[]});
  }});
  await assert.rejects(client.get(url('/nba/v1/standings')),e=>e.status===503&&!JSON.stringify(e).includes(key));
  await assert.rejects(client.get(url('/nba/v1/standings?season=2026')));
  await client.get(url('/nba/v1/games'));assert.equal(calls,2);
  await assert.rejects(client.get(new URL('https://other.example/games')),e=>e.status===400);
});

test('BDL 429 cooldown and malformed/transport failures are safe',async()=>{
  let now=100000,calls=0;
  const client=new BallDontLieClient({apiKey:key,now:()=>now,fetcher:async()=>{calls++;return json({message:key},429,{'retry-after':'90'});}});
  await assert.rejects(client.get(url('/nba/v1/games')),e=>e.details.retryAfter===90);
  now+=61000;
  await assert.rejects(client.get(url('/nba/v1/teams')),e=>e.details.retryAfter===29);
  assert.equal(calls,1);
  for (const fetcher of [async()=>{throw Error(key);},async()=>new Response('not json')]) {
    const p=provider(fetcher);
    await assert.rejects(p.listGames({league:'NBA'}),e=>e.status===502&&!e.message.includes(key));
  }
});

test('BDL account diagnostic uses Bearer auth and whitelists subscription fields',async()=>{
  const p=provider(async(u,options)=>{
    assert.equal(u.pathname,'/account/v1/me');assert.equal(options.headers.Authorization,`Bearer ${key}`);
    return json({api_key:key,email:'private@example.test',subscriptions:[{sport:'nba',tier:'free',secret:key}]});
  });
  const result=await p.getAccess();
  assert.deepEqual(result.subscriptions,[{sport:'nba',tier:'free'}]);
  assert.ok(!JSON.stringify(result).includes(key));assert.equal(result.email,undefined);
});

test('BDL normalizes all six sports, MLB runs, NHL time, zero scores and explicit status',()=>{
  for(const league of ['NBA','NFL','NCAAM','NCAAF','MLB','NHL']){
    const row=normalizeGame(league,game);
    assert.equal(row.id,`balldontlie:${league}:42`);assert.equal(row.score.away,0);assert.equal(row.status.code,'final');
  }
  const baseball=normalizeGame('MLB',{...game,home_team_score:null,visitor_team_score:null,home_team_data:{runs:0},away_team_data:{runs:4}});
  assert.deepEqual(baseball.score,{home:0,away:4});
  const hockey=normalizeGame('NHL',{...game,date:undefined,start_time_utc:'2026-09-30T23:15:00Z',game_date:'2026-09-30',status:undefined,game_state:'LIVE',status_state:'in_progress',time_remaining:'01:22'});
  assert.equal(hockey.start_time,'2026-09-30T23:15:00Z');assert.equal(hockey.status.clock,'01:22');assert.equal(hockey.status.code,'live');
  const scheduled=normalizeGame('NFL',{...game,status:'Not Started'});
  assert.equal(scheduled.status.code,'scheduled');assert.deepEqual(scheduled.score,{home:null,away:null});
  assert.equal(normalizeGame('NBA',{...game,status:'Final',status_state:'unknown'}).status.is_live,null);
  assert.throws(()=>normalizeGame('NBA',{...game,home_team:{id:1}}),e=>e.status===502);
});

test('BDL league queries preserve filters, provider IDs, cursor and incomplete-page metadata',async()=>{
  const p=provider(async u=>{
    assert.equal(u.pathname,'/nfl/v1/games');assert.equal(u.searchParams.get('seasons[]'),'2026');
    assert.equal(u.searchParams.get('weeks[]'),'4');assert.equal(u.searchParams.get('team_ids[]'),'1');
    assert.equal(u.searchParams.get('cursor'),'99');assert.equal(u.searchParams.has('dates[]'),false);
    return json({data:[game],meta:{next_cursor:101,per_page:25}});
  });
  const r=await p.listGames({league:'NFL',season:2026,week:4,team:'balldontlie:NFL:1',cursor:'balldontlie:99'});
  assert.equal(r.meta.next_cursor,'balldontlie:101');assert.equal(r.meta.truncated,true);assert.equal(r.provider,'balldontlie');
  for(const params of [{date:'2026-02-30'},{team:'apisports:NFL:1'},{team:'balldontlie:NBA:1'},{cursor:'other:99'},{limit:0}]){
    await assert.rejects(p.listGames({league:'NFL',...params}),e=>e.status===400);
  }
});

test('BDL default discovery is bounded to today; valid empty data has no fabricated cursor',async()=>{
  const p=provider(async u=>{assert.equal(u.searchParams.get('dates[]'),new Date().toISOString().slice(0,10));return json({data:[],meta:{next_cursor:null}});});
  const r=await p.listGames({league:'NBA'});assert.deepEqual(r.data,[]);assert.equal(r.meta.next_cursor,null);
});

test('BDL NHL detail uses filtered game list and never accepts a foreign game identity',async()=>{
  const p=provider(async u=>{assert.equal(u.pathname,'/nhl/v1/games');assert.equal(u.searchParams.get('game_ids[]'),'42');return json({data:[game]});});
  assert.equal((await p.getGame({league:'NHL',gameId:'balldontlie:NHL:42'})).data.id,'balldontlie:NHL:42');
  for(const id of ['balldontlie:NBA:42','apisports:NHL:42','42/../teams'])await assert.rejects(p.getGame({league:'NHL',gameId:id}),e=>e.status===400);
});

test('BDL team directory searches reuse the cached catalogue',async()=>{
  let calls=0;const p=provider(async()=>{calls++;return json({data:[team(1),team(2)]});});
  assert.equal((await p.listTeams({league:'NBA',search:'T1'})).data[0].id,'balldontlie:NBA:1');
  await p.listTeams({league:'NBA',search:'T2'});assert.equal(calls,1);
});

const unavailable=()=>{throw new HttpError(503,'Plan restriction',{upstreamStatus:401});};
const entry=(name,listGames)=>({name,provider:{listGames,getGame:unavailable,listTeams:unavailable,getStandings:unavailable}});
test('league fallback retains real source and failure reason, and never replaces valid empty data',async()=>{
  let calls=0;
  const chain=new LeagueDataChain([entry('balldontlie',unavailable),entry('apisports',unavailable),entry('odds',async()=>{calls++;return {provider:'sharpApi',data:[],meta:{coverage:'betting_events'}};})]);
  const r=await chain.listGames({league:'NFL',date:'2026-09-30'});
  assert.equal(r.provider,'sharpApi');assert.equal(r.meta.fallback_attempts.length,2);assert.equal(r.meta.coverage,'betting_events');
  await assert.rejects(chain.listGames({league:'NFL',season:2026}),e=>e.status===503);assert.equal(calls,1);
  const empty=new LeagueDataChain([entry('balldontlie',async()=>({provider:'balldontlie',data:[]})),entry('odds',()=>assert.fail('empty result must remain empty'))]);
  assert.deepEqual((await empty.listGames({league:'NFL'})).data,[]);
});

test('league cursors/team IDs stay with their source; validation and detail requests never fall back',async()=>{
  const chain=new LeagueDataChain([entry('apisports',()=>assert.fail('foreign ID must not reach primary')),entry('balldontlie',async()=>({provider:'balldontlie',data:[]}))]);
  assert.equal((await chain.listGames({league:'NFL',team:'balldontlie:NFL:1'})).provider,'balldontlie');
  await assert.rejects(chain.listGames({league:'NFL',cursor:'balldontlie:99',team:'apisports:NFL:1'}),e=>e.status===400);
  const failing=new LeagueDataChain([entry('balldontlie',unavailable),entry('apisports',()=>assert.fail('pinned request'))]);
  for(const params of [{team:'1'},{cursor:'balldontlie:99'}])await assert.rejects(failing.listGames({league:'NFL',...params}));
  await assert.rejects(failing.getGame({league:'NFL',gameId:'42'}));
  const invalid=new LeagueDataChain([entry('balldontlie',()=>{throw new HttpError(400,'Invalid date');}),entry('odds',()=>assert.fail('validation must not fall back'))]);
  await assert.rejects(invalid.listGames({league:'NFL'}),e=>e.status===400);
});
