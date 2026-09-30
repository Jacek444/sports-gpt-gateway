import { HttpError } from '../errors.js';

// Identity-bearing requests never move to another provider. Discovery can
// fall back, but keeps the true source, quota, IDs and coverage metadata.
export class LeagueDataChain {
  constructor(entries) {this.entries=entries;this.name=entries[0]?.name;}
  async getGame(params) {return this.entries[0].provider.getGame(params);}
  async run(method,params) {
    const errors=[];
    const pinned=Boolean(params.cursor || params.team && (/^\d+$/.test(params.team)||params.team.includes(':')));
    const source = [params.cursor, params.team].filter(Boolean).map(value=>String(value).split(':')).filter(parts=>parts.length>1).map(parts=>parts[0]);
    if (new Set(source).size > 1) throw new HttpError(400,'Cursor and team ID belong to different providers.');
    const entries = source.length ? this.entries.filter(entry=>entry.name===source[0]) : this.entries;
    if (!entries.length) throw new HttpError(400,'The provider for this cursor or team ID is not configured.');
    for (const {name,provider} of entries) {
      if(errors.length && pinned)break;
      if(name==='odds' && (method!=='listGames'||params.season!==undefined||params.week!==undefined||params.cursor))continue;
      if(name==='apisports' && method==='getStandings')continue;
      if(name==='apisports' && (params.week!==undefined||params.cursor))continue;
      if(['moneyline','thesportsdb'].includes(name) && method==='getStandings')continue;
      if(['moneyline','thesportsdb'].includes(name) && (params.season!==undefined||params.week!==undefined))continue;
      if(name==='thesportsdb' && params.cursor)continue;
      try {
        const result=await provider[method](params);
        return {...result,provider:result.provider||name,meta:{...result.meta,...(errors.length?{fallback_from:errors[0].provider,fallback_attempts:errors}: {})}};
      }catch(error){
        if(![401,403,404,429].includes(error.status)&&!(error.status>=500))throw error;
        errors.push({provider:name,message:error.message,upstreamStatus:error.details?.upstreamStatus??error.status});
      }
    }
    throw new HttpError(503,'No configured league-data provider could fulfill this request.',{providersTried:errors});
  }
  listGames(params){return this.run('listGames',params);}
  listTeams(params){return this.run('listTeams',params);}
  getStandings(params){return this.run('getStandings',params);}
}
