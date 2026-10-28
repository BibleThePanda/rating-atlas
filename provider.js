/**
 * OPTIONAL community-source adapter. This consumes a public, unofficial API,
 * not the official AOTY website. Availability, access and source accuracy are
 * NOT guaranteed. No Cloudflare bypass or AOTY session cookies are used.
 * Schema fields are centralized in decodeRating().
 */
const API_ORIGIN='https://aoty.prigoana.com';
const SITE_ORIGIN='https://www.albumoftheyear.org';
const TTL=20*60*1000, MAX_PAGES=300, REQUEST_GAP=1200;
const cache=new Map(), pending=new Map();
let queue=Promise.resolve(), nextAt=0;
export class ProviderError extends Error {
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function queuedFetch(url){
  const job=queue.catch(()=>{}).then(async()=>{
    const remaining=nextAt-Date.now();
    if(remaining>0)await delay(remaining);
    nextAt=Date.now()+REQUEST_GAP;
    return fetch(url,{signal:AbortSignal.timeout(14000),headers:{Accept:'application/json','User-Agent':'RatingAtlas/1.1 (music ratings analytics)'}});
  });
  queue=job.then(()=>{},()=>{});
  return job;
}
function safeLink(link){
  if(!link||typeof link!=='string')return null;
  try{
    const url=new URL(link,SITE_ORIGIN);
    return url.protocol==='https:'&&['www.albumoftheyear.org','albumoftheyear.org'].includes(url.hostname)?url.href:null;
  }catch{return null;}
}
export function decodeRating(item){
  if(!item||typeof item!=='object')return null;
  // The upstream's documented fields: artist, title, userRating, url, albumId.
  const artist=String(item.artist??'').trim(),album=String(item.title??item.album??'').trim();
  const raw=item.userRating;
  if(raw===undefined||raw===null||String(raw).trim()==='')return null;
  const score=Number(raw);
  if(!artist||!album||!Number.isFinite(score)||score<0||score>100)return null;
  return {artist,album,score,url:safeLink(item.url??item.albumUrl),id:Number.isSafeInteger(item.albumId)?item.albumId:null};
}
async function pageRequest(username,page){
  const url=new URL('/user/ratings',API_ORIGIN);
  url.searchParams.set('username',username);
  url.searchParams.set('page',String(page));
  let response;
  try{response=await queuedFetch(url.href);}
  catch{throw new ProviderError(502,'PROVIDER_UNAVAILABLE','The community data provider could not be reached. Please try later or import your AOTY CSV.');}
  if(response.status===404)throw new ProviderError(404,'USER_NOT_FOUND','The username could not be found.');
  if(response.status===401||response.status===403)throw new ProviderError(403,'ACCESS_BLOCKED','Automatic access is blocked for this profile or provider. Use the AOTY CSV import instead.');
  if(response.status===429)throw new ProviderError(429,'RATE_LIMITED','The community data provider is rate limiting requests. Please try later.');
  if(!response.ok)throw new ProviderError(502,'UPSTREAM_ERROR','Community API returned HTTP '+response.status+'. Please try a CSV import.');
  let payload;
  try{payload=await response.json();}catch{throw new ProviderError(502,'INVALID_RESPONSE','The data provider did not return valid JSON.');}
  if(!payload||!Array.isArray(payload.ratings))throw new ProviderError(502,'LAYOUT_CHANGED','The provider changed its response format. Import a CSV while this is fixed.');
  return payload;
}
async function collect(username){
  const ratings=[],seen=new Set(),pageFingerprints=new Set();
  for(let page=1;page<=MAX_PAGES;page++){
    const payload=await pageRequest(username,page);
    const batch=payload.ratings;
    if(batch.length===0){
      if(page===1)throw new ProviderError(404,'NO_RATINGS','No ratings were returned. This user may not exist, may have no ratings, or may be private.');
      return {username,ratings:ratings.map(({id,...r})=>r),pagesFetched:page,profileUrl:SITE_ORIGIN+'/user/'+username+'/ratings/',source:'unofficial community API',fetchedAt:new Date().toISOString(),cached:false};
    }
    const fingerprint=batch.map(item=>String(item?.albumId??item?.url??'')).join('|');
    if(pageFingerprints.has(fingerprint))throw new ProviderError(502,'PAGINATION_ERROR','The provider repeated a ratings page, so collection completeness cannot be verified.');
    pageFingerprints.add(fingerprint);
    for(const item of batch){
      const entry=decodeRating(item);
      if(!entry)continue;
      const key=entry.id!==null?'id:'+entry.id:entry.url||entry.artist.toLowerCase()+'\0'+entry.album.toLowerCase();
      if(seen.has(key))continue;
      seen.add(key);ratings.push(entry);
    }
    if(Number.isInteger(payload.totalPages)&&payload.totalPages>=1&&page>=payload.totalPages){
      return {username,ratings:ratings.map(({id,...r})=>r),pagesFetched:page,profileUrl:SITE_ORIGIN+'/user/'+username+'/ratings/',source:'unofficial community API',fetchedAt:new Date().toISOString(),cached:false};
    }
  }
  throw new ProviderError(502,'TOO_MANY_PAGES','The safety page limit was reached before completeness could be verified. Nothing partial was displayed.');
}
export async function loadUserRatings(username){
  if(typeof username!=='string'||!/^[A-Za-z0-9_-]{1,40}$/.test(username))throw new ProviderError(400,'INVALID_USERNAME','Enter a valid AOTY username.');
  const key=username.toLowerCase(),entry=cache.get(key);
  if(entry&&Date.now()-entry.at<TTL)return {...entry.value,cached:true};
  if(pending.has(key))return pending.get(key);
  const task=collect(username).then(value=>{
    cache.set(key,{at:Date.now(),value});
    if(cache.size>150)cache.delete(cache.keys().next().value);
    return value;
  }).finally(()=>pending.delete(key));
  pending.set(key,task);return task;
}
