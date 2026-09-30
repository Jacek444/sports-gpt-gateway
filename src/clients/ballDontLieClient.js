import { HttpError } from '../errors.js';

// BALLDONTLIE's free key is limited to five requests/minute. Cache hits do
// not consume the local budget; a full budget fails promptly into fallback.
export class BallDontLieClient {
  constructor({apiKey, baseUrl='https://api.balldontlie.io', fetcher=(...args)=>fetch(...args), now=Date.now}) {
    Object.assign(this,{apiKey,baseUrl,fetcher,now});
    this.cache=new Map(); this.pending=new Map(); this.restricted=new Map(); this.calls=[];
    this.blockedUntil=0; this.requests=0; this.lastError=null; this.lastSuccessAt=null; this.lastReadAt=null;
    this.quota=null;
  }
  async get(url, ttl=60000) {
    if (!this.apiKey?.trim() || this.apiKey==='replace_me') throw new HttpError(503,'BALLDONTLIE key is not configured.');
    const key=url.pathname+url.search;
    if (url.origin!==new URL(this.baseUrl).origin) throw new HttpError(400,'Invalid BALLDONTLIE destination.');
    const cached=this.cache.get(key);
    if (cached?.expires>this.now()) {this.lastReadAt=cached.observedAt;return cached.body;}
    if(this.pending.has(key)) return this.pending.get(key);
    const task=this.request(url).then(body=>{
      this.cache.set(key,{body,expires:this.now()+ttl,observedAt:this.lastSuccessAt});
      if(this.cache.size>500)this.cache.delete(this.cache.keys().next().value);
      return body;
    }).finally(()=>this.pending.delete(key));
    this.pending.set(key,task); return task;
  }
  async request(url) {
    // Restrict the resource family, not the whole key: a paid standings
    // endpoint returning 401 must not disable free games on the same sport.
    const scope=url.pathname.replace(/\/\d+$/,'');
    if(this.restricted.get(scope)>this.now())throw new HttpError(503,'BALLDONTLIE resource is unavailable on this key.',{provider:'balldontlie',reason:'access_or_plan_restriction'});
    this.calls=this.calls.filter(t=>t>this.now()-60000);
    const reset=Math.max(this.blockedUntil,this.calls.length>=5?this.calls[0]+60000:0);
    if(reset>this.now())throw new HttpError(503,'BALLDONTLIE is at its request limit.',{provider:'balldontlie',upstreamStatus:429,retryAfter:Math.ceil((reset-this.now())/1000)});
    this.calls.push(this.now());this.requests++;
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),10000);
    try {
      const auth=url.pathname==='/account/v1/me'?`Bearer ${this.apiKey}`:this.apiKey;
      const res=await this.fetcher(url,{headers:{Authorization:auth},signal:controller.signal,redirect:'error'});
      const body=await res.json().catch(()=>null);
      this.quota={limit_per_minute:5,remaining:res.headers.get('x-ratelimit-remaining'),reset:res.headers.get('x-ratelimit-reset')};
      if(!res.ok || body?.error || body?.errors && Object.keys(body.errors).length) {
        const code=res.status;
        if(code===401||code===403)this.restricted.set(scope,this.now()+900000);
        const retry=Number(res.headers.get('retry-after'));
        if(code===429)this.blockedUntil=this.now()+Math.max(60,Number.isFinite(retry)?Math.min(retry,3600):60)*1000;
        const status=code===400||code===404?code:503;
        throw new HttpError(status,code===401||code===403?'BALLDONTLIE resource is unavailable on this key.':code===429?'BALLDONTLIE rate limit reached.':'BALLDONTLIE request failed.',{provider:'balldontlie',upstreamStatus:code,reason:code===401||code===403?'access_or_plan_restriction':'upstream_error',retryAfter:code===429?Math.ceil((this.blockedUntil-this.now())/1000):undefined});
      }
      if(!body || typeof body!=='object')throw new HttpError(502,'BALLDONTLIE returned invalid JSON.');
      this.lastSuccessAt=new Date(this.now()).toISOString();this.lastReadAt=this.lastSuccessAt;this.lastError=null;
      return body;
    }catch(error){
      const safe=error instanceof HttpError?error:new HttpError(502,'BALLDONTLIE request failed or timed out.');
      this.lastError=safe.message;throw safe;
    }finally{clearTimeout(timer);}
  }
  status(){return {requests:this.requests,quota:this.quota,lastSuccessAt:this.lastSuccessAt,lastError:this.lastError};}
}
