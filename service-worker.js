const CACHE_NAME='delivery-pizzaria-v3';
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
  './account/account.js'
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

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;

  const url=new URL(req.url);
  if(url.origin!==self.location.origin) return;

  if(req.mode==='navigate'){
    event.respondWith(
      fetch(req)
        .then(response=>{
          const copy=response.clone();
          caches.open(CACHE_NAME).then(cache=>cache.put(req,copy));
          return response;
        })
        .catch(()=>caches.match(req).then(hit=>hit||caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached=>{
      const network=fetch(req).then(response=>{
        if(response.ok){
          const copy=response.clone();
          caches.open(CACHE_NAME).then(cache=>cache.put(req,copy));
        }
        return response;
      }).catch(()=>cached);
      return cached||network;
    })
  );
});
