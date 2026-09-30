const CACHE_NAME='delivery-pizzaria-v19';
const OFFLINE_URL='./offline.html';
const SHELL=[
  './',
  './index.html',
  './privacy.html',
  OFFLINE_URL,
  './manifest.webmanifest',
  './firebase-config.js',
  './assets/styles.css',
  './assets/app.js',
  './assets/customer-auth.js',
  './assets/cep.js',
  './assets/demo-mode.js',
  './assets/ui.js',
  './assets/print-agent-version.json',
  './assets/app-icon.svg',
  './assets/icons/badge-percent.svg',
  './assets/icons/banknote.svg',
  './assets/icons/bell-ring.svg',
  './assets/icons/chevron-down.svg',
  './assets/icons/circle-check.svg',
  './assets/icons/circle-x.svg',
  './assets/icons/clipboard-list.svg',
  './assets/icons/clock-3.svg',
  './assets/icons/copy.svg',
  './assets/icons/credit-card.svg',
  './assets/icons/download.svg',
  './assets/icons/external-link.svg',
  './assets/icons/folders.svg',
  './assets/icons/heart.svg',
  './assets/icons/info.svg',
  './assets/icons/key-round.svg',
  './assets/icons/log-out.svg',
  './assets/icons/map-pin.svg',
  './assets/icons/minus.svg',
  './assets/icons/package-open.svg',
  './assets/icons/pencil.svg',
  './assets/icons/pizza.svg',
  './assets/icons/plus.svg',
  './assets/icons/power.svg',
  './assets/icons/printer.svg',
  './assets/icons/qr-code.svg',
  './assets/icons/receipt-text.svg',
  './assets/icons/repeat-2.svg',
  './assets/icons/search.svg',
  './assets/icons/shield-check.svg',
  './assets/icons/shopping-cart.svg',
  './assets/icons/store.svg',
  './assets/icons/ticket-percent.svg',
  './assets/icons/trash.svg',
  './assets/icons/user-round.svg',
  './assets/icons/users.svg',
  './assets/icons/volume-2.svg',
  './assets/icons/wallet-cards.svg',
  './assets/pwa/icon-192.svg',
  './assets/pwa/icon-512.svg',
  './assets/pwa/icon-maskable.svg',
  './assets/pwa/icon-192.png',
  './assets/pwa/icon-512.png',
  './assets/pwa/icon-maskable-512.png',
  './assets/pwa/apple-touch-icon-180.png',
  './assets/pwa/favicon-32.png',
  './assets/social-card.svg',
  './assets/social-card.png',
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
      await cache.put(req,response.clone());
      return response;
    }
    throw new Error('network-response-'+response.status);
  }catch{
    return (await caches.match(req,{ignoreSearch:true})) ||
      (fallback?await caches.match(fallback):undefined) ||
      Response.error();
  }
}

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;

  const url=new URL(req.url);
  if(url.origin!==self.location.origin) return;

  // API e conteúdo operacional nunca devem ser atendidos por cache do PWA.
  if(url.pathname.startsWith('/api/')) return;

  // A versão do Print Agent precisa ficar fresca para bloquear versões incompatíveis.
  if(url.pathname.endsWith('/assets/print-agent-version.json')){
    event.respondWith(networkFirst(req));
    return;
  }

  if(req.mode==='navigate'){
    event.respondWith(networkFirst(req,OFFLINE_URL));
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
