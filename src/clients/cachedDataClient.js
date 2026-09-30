import { HttpError } from '../errors.js';

// Shared transport for MoneyLine and TheSportsDB. Credentials never become
// cache keys, diagnostic fields or upstream-error messages.
export class CachedDataClient {
  constructor({name,apiKey,baseUrl,enabled=true,pathAuth=false,perMinute=10,fetcher=(...args)=>fetch(...args),now=Date.now}) {
    Object.assign(this,{name,apiKey,baseUrl,enabled,pathAuth,perMinute,fetcher,now});
    this.cache=new Map();this.pending=new Map();this.calls=[];this.blockedUntil=0;
    this.requests=0;this.lastSuccessAt=null;this.lastReadAt=null;this.lastError=null;
  }
  unavailable(message,status=503,details={}) {return new HttpError(status,`${this.name}: ${message}`,{provider:this.name,...details});}
  async get(path,params={},ttl=60000) {
    if(!this.enabled||!this.apiKey?.trim()||this.apiKey==='replace_me')throw this.unavailable('not configured.');
    if(!/^\/[a-zA-Z0-9_/-]+(?:\.php)?$/.test(path)||path.includes('..'))throw this.unavailable('invalid resource.',400);
    const query=new URLSearchParams(Object.entries(params).filter(([,v])=>v!==undefined&&v!==null&&v!==''));
    const cacheKey=path+'?'+query;
    const cached=this.cache.get(cacheKey);
    if(cached?.expires>this.now()){this.lastReadAt=cached.at;return cached.body;}
    if(this.pending.has(cacheKey))return this.pending.get(cacheKey);
    const task=this.request(path,query).then(body=>{
      this.cache.set(cacheKey,{body,expires:this.now()+ttl,at:this.lastSuccessAt});
      if(this.cache.size>500)this.cache.delete(this.cache.keys().next().value);
      return body;
    }).finally(()=>this.pending.delete(cacheKey));
    this.pending.set(cacheKey,task);return task;
  }
  async request(path,query) {
    this.calls=this.calls.filter(t=>t>this.now()-60000);
    const reset=Math.max(this.blockedUntil,this.calls.length>=this.perMinute?this.calls[0]+60000:0);
    if(reset>this.now())throw this.unavailable('temporarily unavailable or at its request limit.',503,{upstreamStatus:429,retryAfter:Math.ceil((reset-this.now())/1000)});
    this.calls.push(this.now());this.requests++;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const url=new URL(this.baseUrl.replace(/\/$/,'')+(this.pathAuth?'/'+encodeURIComponent(this.apiKey):'')+path);
      url.search=query.toString();
      const res=await this.fetcher(url,{headers:this.pathAuth?{}:{'x-api-key':this.apiKey},signal:controller.signal,redirect:'error'});
      const body=await res.json().catch(()=>null);
      if(!res.ok||body?.success===false||body?.error||body?.Message){
        if([401,403].includes(res.status))this.blockedUntil=this.now()+900000;
        const monthly=/credit|monthly|quota/i.test(String(body?.error?.message||''));
        if(res.status===429){const retry=Number(res.headers.get('retry-after'));this.blockedUntil=this.now()+Math.max(monthly?3600:60,Number.isFinite(retry)?Math.min(retry,3600):60)*1000;}
        throw this.unavailable('request rejected or unavailable.',res.status===404?404:503,{upstreamStatus:res.status,retryAfter:res.status===429?Math.ceil((this.blockedUntil-this.now())/1000):undefined});
      }
      if(!body||typeof body!=='object')throw this.unavailable('invalid JSON response.',502);
      this.lastSuccessAt=new Date(this.now()).toISOString();this.lastReadAt=this.lastSuccessAt;this.lastError=null;return body;
    }catch(error){const safe=error instanceof HttpError?error:this.unavailable('request failed or timed out.',502);this.lastError=safe.message;throw safe;}
    finally{clearTimeout(timer);}
  }
  status(){return {requests:this.requests,limit_per_minute:this.perMinute,lastSuccessAt:this.lastSuccessAt,lastError:this.lastError};}
}
