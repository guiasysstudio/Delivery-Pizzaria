const CEP_CACHE_TTL_MS=10*60*1000;
const CEP_NEGATIVE_TTL_MS=60*1000;
const CEP_REQUEST_TIMEOUT_MS=5000;

const cepCache=new Map();
const cepInFlight=new Map();

function cloneCep(value){
  if(!value) return null;
  return {
    ...value,
    location:value.location?{...value.location}:null
  };
}

function normalizeDigits(zip){
  return String(zip||'').replace(/\D/g,'').slice(0,8);
}

function formattedZip(digits){
  return digits.replace(/^(\d{5})(\d{3})$/,'$1-$2');
}

async function fetchJson(url){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),CEP_REQUEST_TIMEOUT_MS);
  try{
    const response=await fetch(url,{cache:'no-store',signal:controller.signal});
    if(!response.ok) return null;
    return await response.json();
  }finally{
    clearTimeout(timer);
  }
}

async function lookupRemote(digits){
  let primary=null;

  try{
    const data=await fetchJson(`https://brasilapi.com.br/api/cep/v2/${digits}`);
    if(data){
      const lat=Number(data?.location?.coordinates?.latitude);
      const lng=Number(data?.location?.coordinates?.longitude);
      primary={
        zip:formattedZip(digits),
        street:data.street||'',
        neighborhood:data.neighborhood||'',
        city:data.city||'',
        state:data.state||'',
        location:Number.isFinite(lat)&&Number.isFinite(lng)
          ?{latitude:lat,longitude:lng,source:'brasilapi-cep-v2'}
          :null
      };

      if(primary.street&&primary.neighborhood&&primary.city&&primary.state){
        return primary;
      }
    }
  }catch(err){
    console.warn('BrasilAPI CEP v2 indisponível; tentando ViaCEP.',err);
  }

  try{
    const data=await fetchJson(`https://viacep.com.br/ws/${digits}/json/`);
    if(!data||data?.erro) return primary;
    return {
      zip:formattedZip(digits),
      street:primary?.street||data.logradouro||'',
      neighborhood:primary?.neighborhood||data.bairro||'',
      city:primary?.city||data.localidade||'',
      state:primary?.state||data.uf||'',
      location:primary?.location||null
    };
  }catch(err){
    console.warn('ViaCEP indisponível.',err);
    return primary;
  }
}

export async function lookupBrazilianZip(zip,{force=false}={}){
  const digits=normalizeDigits(zip);
  if(digits.length!==8) return null;

  const now=Date.now();
  if(!force){
    const cached=cepCache.get(digits);
    if(cached&&cached.expiresAt>now) return cloneCep(cached.value);

    const pending=cepInFlight.get(digits);
    if(pending) return cloneCep(await pending);
  }

  const request=lookupRemote(digits)
    .then(value=>{
      cepCache.set(digits,{
        value:cloneCep(value),
        expiresAt:Date.now()+(value?CEP_CACHE_TTL_MS:CEP_NEGATIVE_TTL_MS)
      });
      return value;
    })
    .finally(()=>cepInFlight.delete(digits));

  cepInFlight.set(digits,request);
  return cloneCep(await request);
}

export function clearBrazilianZipCache(zip=''){
  const digits=normalizeDigits(zip);
  if(digits) cepCache.delete(digits);
  else cepCache.clear();
}
