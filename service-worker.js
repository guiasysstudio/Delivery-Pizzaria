const CACHE_NAME='delivery-pizzaria-v9';
const SHELL=[
  './',
  './index.html',
  './manifest.webmanifest',
  './firebase-config.js',
  './assets/styles.css',
  './assets/app.js',
  './assets/customer-auth.js',
  './assets/app-icon.svg',
  './assets/products/placeholder.svg',
  './account/',
  './account/index.html',
  './account/account.js',
  './account/receipt.html',
  './account/receipt.js'
];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache=>cache.addAll(SHELL))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

async function networkFirst(req,fallback){
  try{
    const response=await fetch(req);
    if(response.ok){
      const cache=await caches.open(CACHE_NAME);
      cache.put(req,response.clone());
    }
    return response;
  }catch{
    return (await caches.match(req)) || (fallback?await caches.match(fallback):undefined) || Response.error();
  }
}

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;

  const url=new URL(req.url);
  if(url.origin!==self.location.origin) return;

  if(req.mode==='navigate'){
    event.respondWith(networkFirst(req,'./index.html'));
    return;
  }

  const destination=req.destination;
  if(['script','style','worker','document'].includes(destination)){
    event.respondWith(networkFirst(req));
    return;
  }

  event.respondWith(
    caches.match(req).then(cached=>{
      const network=fetch(req).then(async response=>{
        if(response.ok){
          const cache=await caches.open(CACHE_NAME);
          cache.put(req,response.clone());
        }
        return response;
      }).catch(()=>cached);
      return cached||network;
    })
  );
});
