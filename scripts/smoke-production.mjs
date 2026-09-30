const base=String(process.argv[2]||process.env.DELIVERY_BASE_URL||'').replace(/\/+$/,'');
if(!base){
  console.error('Uso: node scripts/smoke-production.mjs https://SEU-SITE.web.app');
  process.exit(2);
}
if(!/^https:\/\//i.test(base)&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(base)){
  throw new Error('A URL de produção deve usar HTTPS.');
}

async function get(path,{expect=[200],json=false}={}){
  const response=await fetch(base+path,{redirect:'follow',cache:'no-store'});
  if(!expect.includes(response.status)){
    const body=await response.text().catch(()=>'');
    throw new Error(path+' retornou HTTP '+response.status+'; esperado '+expect.join('/')+'. '+body.slice(0,240));
  }
  return json?response.json():response.text();
}

const home=await get('/');
if(!/Delivery Pizzaria|Pizzaria/i.test(home)) throw new Error('Home não parece ser o Delivery Pizzaria.');
await get('/privacy.html');
await get('/admin/');
await get('/account/');

const health=await get('/api/health',{json:true});
if(health?.ok!==true||health?.project!=='delivery-pizzaria-f5b08'){
  throw new Error('Health check do backend inválido: '+JSON.stringify(health));
}

await get('/api/order/create',{expect:[405]});

console.log('Production smoke test OK:',base);
