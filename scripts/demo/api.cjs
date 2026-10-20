'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {parseEnv}=require('node:util');
const {ROOT}=require('./files.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class ApiError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
function config(){
 const filename=path.join(ROOT,'.env.demo');
 if(!fs.existsSync(filename))throw Error('Live commands require the ignored .env.demo file. Copy .env.example and configure it locally; never paste the key into chat.');
 const env=parseEnv(fs.readFileSync(filename,'utf8'));
 const url=(env.SUPABASE_URL||'').replace(/\/$/,'');const key=env.SUPABASE_SERVICE_ROLE_KEY;
 const expected=fs.readFileSync(path.join(ROOT,'public/supabase-config.js'),'utf8').match(/https:\/\/[a-z0-9-]+\.supabase\.co/)?.[0];
 if(url!==expected)throw Error('The configured Supabase URL must match this prototype project.');
 if(!key||(!key.startsWith('sb_secret_')&&!key.startsWith('eyJ')))throw Error('Configure a server-only service-role/secret key in .env.demo.');
 if(key.startsWith('eyJ')){let payload;try{payload=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());}catch{throw Error('Invalid administrative JWT.');}if(payload.role!=='service_role')throw Error('Use the service-role key; a browser/publishable key cannot seed accounts.');}
 return {url,key,presentationPassword:env.DEMO_PRESENTATION_PASSWORD||null};
}
class SupabaseAPI{
 constructor(settings,fetcher=fetch){this.settings=settings;this.fetch=fetcher;}
 async request(route,{method='GET',body,token,headers={},retry=true}={}){
  const {url,key}=this.settings;
  // New secret keys belong only in apikey. Bearer accepts a user JWT or the
  // legacy service-role JWT: https://supabase.com/docs/guides/getting-started/api-keys
  const bearer=token||(!key.startsWith('sb_secret_')?key:null);
  for(let attempt=0;;attempt++){
   let response;
   try{response=await this.fetch(url+route,{method,headers:{apikey:key,...(bearer?{Authorization:'Bearer '+bearer}:{}),...(body instanceof Uint8Array?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body),signal:AbortSignal.timeout(30000),redirect:'error'});}
   catch(error){if(!retry||attempt>=3)throw new ApiError(0,'NETWORK','Network request failed; progress was preserved.');await sleep(500*2**attempt);continue;}
   const text=await response.text();let data;try{data=text?JSON.parse(text):null;}catch{data=null;}
   if(response.ok)return data;
   if(retry&&[429,502,503,504].includes(response.status)&&attempt<3){const requested=Number(response.headers.get('retry-after'))*1000;await sleep(Math.min(30000,Math.max(500*2**attempt,Number.isFinite(requested)?requested:0)));continue;}
   const code=data?.code||data?.error_code||(typeof data?.error==='string'?data.error:'API_ERROR');
   const message=String(data?.message||data?.msg||data?.error_description||`Request failed (${response.status}).`).replaceAll(key,'[redacted]');
   throw new ApiError(response.status,code,message);
  }
 }
 rpc(name,args={},token){return this.request('/rest/v1/rpc/'+name,{method:'POST',body:args,token});}
 async users(){const result=[];for(let page=1;page<=10000;page++){const data=await this.request(`/auth/v1/admin/users?page=${page}&per_page=200`);if(!Array.isArray(data?.users))throw Error('Unexpected Auth account listing response.');result.push(...data.users);if(data.users.length===0)return result;}throw Error('Auth pagination limit exceeded; no partial inventory will be used.');}
 createUser(payload){return this.request('/auth/v1/admin/users',{method:'POST',body:payload});}
 async signIn(email,password){const data=await this.request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});if(!data?.access_token)throw Error('Auth login did not return a session.');return data.access_token;}
 async table(name,filter,columns='*'){const rows=[];for(let offset=0;offset<100000;){const query=new URLSearchParams({...filter,select:columns,order:'id.asc',offset:String(offset),limit:'500'});const page=await this.request('/rest/v1/'+name+'?'+query);if(!Array.isArray(page))throw Error('Unexpected table response.');if(page.length===0)return rows;rows.push(...page);offset+=page.length;}throw Error('Table exceeds the complete-inventory limit.');}
 async upload(name,bytes){try{await this.request('/storage/v1/object/mentor-academic-records/'+name.split('/').map(encodeURIComponent).join('/'),{method:'POST',body:bytes,headers:{'Content-Type':'application/pdf','x-upsert':'false'}});}catch(e){if(![409].includes(e.status)&&e.code!=='Duplicate')throw e;}}
}
module.exports={SupabaseAPI,ApiError,config,sleep};
