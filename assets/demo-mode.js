const DEMO_ORDER_KEY='deliveryDemoOrdersV1';
const DEMO_ORDER_COUNTER_KEY='deliveryDemoOrderCounterV1';
const DEMO_TTL_MS=24*60*60*1000;
const DEMO_EVENT='delivery-demo-orders-updated';

export const BLAZE_FEATURES={
  checkout:'Finalização segura do pedido',
  customerCpf:'Validação definitiva e unicidade do CPF',
  customerDelete:'Exclusão completa da conta',
  customerCancel:'Cancelamento seguro de pedido real',
  cash:'Caixa financeiro server-side',
  staffUsers:'Cadastro, troca de senha e exclusão de funcionários',
  staffRoles:'Alterações server-side de perfis administrativos',
  privateOrder:'Acesso administrativo aos dados privados do pedido',
  imageUpload:'Upload seguro de imagens/logos para o GitHub',
  loyalty:'Entrega automática de cupons de fidelidade',
  migrations:'Migrações administrativas de privacidade'
};

export function demoEnvironmentAllowed(){
  const host=String(location.hostname||'').toLowerCase();
  const query=new URLSearchParams(location.search);
  if(query.get('demo')==='1'){
    localStorage.setItem('deliveryDemoMode','1');
  }
  if(query.get('demo')==='0'){
    localStorage.removeItem('deliveryDemoMode');
  }
  return host==='guiasysstudio.github.io' ||
    host==='localhost' ||
    host==='127.0.0.1' ||
    localStorage.getItem('deliveryDemoMode')==='1';
}

export function blazeRequiredMessage(feature){
  const label=BLAZE_FEATURES[feature]||'Este recurso';
  return `${label}: em produção usa Firebase Cloud Functions e requer o plano Blaze. Na demonstração, apenas os recursos com fallback local ficam simulados.`;
}

export function backendUnavailable(errorOrResponse){
  if(!errorOrResponse) return false;
  const status=Number(errorOrResponse?.status||0);
  if([404,500,502,503,504].includes(status)) return true;
  const code=String(errorOrResponse?.code||'');
  if(['http/404','http/500','http/502','http/503','http/504'].includes(code)) return true;
  const message=String(errorOrResponse?.message||'');
  return errorOrResponse instanceof TypeError ||
    /failed to fetch|networkerror|network error|load failed|fetch failed/i.test(message);
}

function safeJson(raw,fallback){
  try{
    const parsed=JSON.parse(raw);
    return parsed??fallback;
  }catch{
    return fallback;
  }
}

function timestamp(ms){
  const value=Number(ms||0);
  return {
    toMillis:()=>value,
    toDate:()=>new Date(value)
  };
}

function hydrateOrder(raw){
  if(!raw) return null;
  return {
    ...raw,
    demoMode:true,
    createdAt:timestamp(raw.createdAtMs),
    updatedAt:timestamp(raw.updatedAtMs||raw.createdAtMs),
    acceptedAt:raw.acceptedAtMs?timestamp(raw.acceptedAtMs):undefined,
    completedAt:raw.completedAtMs?timestamp(raw.completedAtMs):undefined,
    cancelledAt:raw.cancelledAtMs?timestamp(raw.cancelledAtMs):undefined
  };
}

function compactOrder(order){
  const clone={...order};
  delete clone.createdAt;
  delete clone.updatedAt;
  delete clone.acceptedAt;
  delete clone.completedAt;
  delete clone.cancelledAt;
  return clone;
}

function cleanExpired(list){
  const cutoff=Date.now()-DEMO_TTL_MS;
  return list.filter(order=>Number(order?.createdAtMs||0)>=cutoff);
}

function readRawOrders(){
  const list=safeJson(localStorage.getItem(DEMO_ORDER_KEY),[]);
  if(!Array.isArray(list)) return [];
  const cleaned=cleanExpired(list);
  if(cleaned.length!==list.length){
    localStorage.setItem(DEMO_ORDER_KEY,JSON.stringify(cleaned));
  }
  return cleaned;
}

function writeRawOrders(list){
  localStorage.setItem(DEMO_ORDER_KEY,JSON.stringify(list.map(compactOrder)));
  window.dispatchEvent(new CustomEvent(DEMO_EVENT));
  try{
    const channel=new BroadcastChannel('delivery-pizzaria-demo');
    channel.postMessage({type:'orders'});
    channel.close();
  }catch{}
}

function nextOrderNumber(){
  const previous=Number(localStorage.getItem(DEMO_ORDER_COUNTER_KEY)||9000);
  const next=Number.isFinite(previous)?previous+1:9001;
  localStorage.setItem(DEMO_ORDER_COUNTER_KEY,String(next));
  return next;
}

export function readDemoOrders(){
  if(!demoEnvironmentAllowed()) return [];
  return readRawOrders().map(hydrateOrder);
}

export function getDemoOrder(id){
  if(!demoEnvironmentAllowed()||!String(id||'').startsWith('demo-')) return null;
  return hydrateOrder(readRawOrders().find(order=>order.id===id)||null);
}

export function createDemoOrder(order){
  if(!demoEnvironmentAllowed()){
    throw Object.assign(new Error('demo_not_allowed'),{code:'demo_not_allowed'});
  }
  const now=Date.now();
  const record={
    ...order,
    id:'demo-'+crypto.randomUUID(),
    orderNumber:nextOrderNumber(),
    status:order.status||'pending',
    createdAtMs:now,
    updatedAtMs:now,
    demoMode:true
  };
  const list=readRawOrders();
  list.unshift(record);
  writeRawOrders(list);
  return hydrateOrder(record);
}

export function updateDemoOrder(id,patch={}){
  if(!demoEnvironmentAllowed()||!String(id||'').startsWith('demo-')) return null;
  const list=readRawOrders();
  const index=list.findIndex(order=>order.id===id);
  if(index<0) return null;
  const now=Date.now();
  const status=patch.status||list[index].status;
  const next={
    ...list[index],
    ...patch,
    updatedAtMs:now
  };
  if(status==='accepted'&&!next.acceptedAtMs) next.acceptedAtMs=now;
  if(status==='completed'&&!next.completedAtMs) next.completedAtMs=now;
  if(status==='cancelled'&&!next.cancelledAtMs) next.cancelledAtMs=now;
  list[index]=next;
  writeRawOrders(list);
  return hydrateOrder(next);
}

export function isDemoOrderId(id){
  return String(id||'').startsWith('demo-');
}

export function listenDemoOrders(callback){
  if(!demoEnvironmentAllowed()) return ()=>{};
  let channel=null;
  const emit=()=>callback(readDemoOrders());
  const storageHandler=event=>{
    if(event.key===DEMO_ORDER_KEY) emit();
  };
  const customHandler=()=>emit();

  window.addEventListener('storage',storageHandler);
  window.addEventListener(DEMO_EVENT,customHandler);

  if('BroadcastChannel' in window){
    channel=new BroadcastChannel('delivery-pizzaria-demo');
    channel.addEventListener('message',emit);
  }

  emit();
  return ()=>{
    window.removeEventListener('storage',storageHandler);
    window.removeEventListener(DEMO_EVENT,customHandler);
    channel?.close();
  };
}

export function notifyDemoOrdersChanged(){
  if(!demoEnvironmentAllowed()) return;
  try{
    const channel=new BroadcastChannel('delivery-pizzaria-demo');
    channel.postMessage({type:'orders'});
    channel.close();
  }catch{}
}

export function clearDemoOrders(){
  localStorage.removeItem(DEMO_ORDER_KEY);
  localStorage.removeItem(DEMO_ORDER_COUNTER_KEY);
  window.dispatchEvent(new CustomEvent(DEMO_EVENT));
}
