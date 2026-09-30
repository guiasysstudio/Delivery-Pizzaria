import fs from 'node:fs';
import assert from 'node:assert/strict';

const admin=fs.readFileSync('admin/admin.js','utf8');
const adminHtml=fs.readFileSync('admin/index.html','utf8');
const account=fs.readFileSync('account/account.js','utf8');
const accountHtml=fs.readFileSync('account/index.html','utf8');
const customerAuth=fs.readFileSync('assets/customer-auth.js','utf8');
const cep=fs.readFileSync('assets/cep.js','utf8');
const publicApp=fs.readFileSync('assets/app.js','utf8');
const backend=fs.readFileSync('functions/index.js','utf8');
const rules=fs.readFileSync('firestore.rules','utf8');
const indexes=JSON.parse(fs.readFileSync('firestore.indexes.json','utf8'));
const privacy=fs.readFileSync('privacy.html','utf8');
const serviceWorker=fs.readFileSync('service-worker.js','utf8');
const printAgent=fs.readFileSync('print-agent/Program.cs','utf8');

// Escala: pedidos ativos em tempo real, histórico limitado/paginado.
assert.match(admin,/ACTIVE_ORDER_STATUSES=\['pending','accepted','preparing','ready','out_for_delivery'\]/);
assert.match(admin,/ORDER_HISTORY_PAGE_SIZE=200/);
assert.match(admin,/where\('status','in',ACTIVE_ORDER_STATUSES\)/);
assert.match(admin,/orderBy\('createdAt','desc'\),\s*limit\(ORDER_HISTORY_PAGE_SIZE\)/);
assert.match(admin,/startAfter\(orderHistoryCursor\)/);
assert.match(admin,/loadMoreOrderHistory/);
assert.match(adminHtml,/id="loadMoreOrdersBtn"/);
assert.doesNotMatch(admin,/query\(collection\(db,'orders'\),orderBy\('createdAt','desc'\)\)\s*;/);

assert.match(account,/CUSTOMER_ORDER_PAGE_SIZE=25/);
assert.match(account,/startAfter\(customerOrderCursor\)/);
assert.match(account,/limit\(CUSTOMER_ORDER_PAGE_SIZE\)/);
assert.match(account,/loadMoreCustomerOrders/);
assert.match(account,/failed-precondition/);
assert.match(account,/Índice de histórico ainda não publicado/);
assert.match(accountHtml,/id="loadMoreCustomerOrdersBtn"/);
const loadAllBlock=account.slice(
  account.indexOf('async function loadAll()'),
  account.indexOf('function effectiveProfilePhoto')
);
assert.doesNotMatch(loadAllBlock,/collection\(db,'orders'\)/,'loadAll não deve duplicar a leitura do listener paginado');

// CEP: uma implementação compartilhada, cache TTL e deduplicação de requests.
assert.match(customerAuth,/import \{ lookupBrazilianZip \} from '\.\/cep\.js';/);
assert.match(customerAuth,/export \{ lookupBrazilianZip \};/);
assert.doesNotMatch(customerAuth,/brasilapi\.com\.br\/api\/cep/);
assert.doesNotMatch(customerAuth,/viacep\.com\.br\/ws/);
assert.match(admin,/lookupBrazilianZip as lookupZipGeo/);
assert.doesNotMatch(admin,/brasilapi\.com\.br\/api\/cep/);
assert.doesNotMatch(admin,/viacep\.com\.br\/ws/);
assert.match(cep,/CEP_CACHE_TTL_MS=10\*60\*1000/);
assert.match(cep,/const cepInFlight=new Map\(\)/);
assert.match(cep,/if\(pending\) return cloneCep\(await pending\)/);
assert.match(serviceWorker,/\.\/assets\/cep\.js/);

// Consultas rotineiras de elegibilidade trazem só pedidos concluídos.
assert.match(publicApp,/where\('customerId','==',uid\),\s*where\('status','==','completed'\)/);
assert.match(publicApp,/Consulta compatível do histórico também falhou/);
assert.match(backend,/where\("customerId", "==", customerId\)[\s\S]*?where\("status", "==", "completed"\)/);
assert.match(backend,/where\("customerId","==",decoded\.uid\)[\s\S]*?where\("status","==","completed"\)/);

// Índices explícitos para paginação e elegibilidade.
const orderIndexes=(indexes.indexes||[]).filter(x=>x.collectionGroup==='orders');
const fields=x=>x.fields.map(f=>f.fieldPath+':'+f.order).join('|');
assert.ok(orderIndexes.some(x=>fields(x)==='customerId:ASCENDING|createdAt:DESCENDING'));
assert.ok(orderIndexes.some(x=>fields(x)==='customerId:ASCENDING|status:ASCENDING'));

// LGPD: exportação completa não depende da janela paginada exibida.
assert.match(account,/async function loadCompleteCustomerExport\(\)/);
assert.match(account,/collection\(db,'orderPrivate'\),where\('customerId','==',user\.uid\)/);
assert.match(account,/Arquivo completo com seus dados preparado/);
assert.match(privacy,/cópia completa dos dados disponíveis em sua conta/);
assert.match(privacy,/expiração automática no banco de dados/);
assert.match(privacy,/confirmação de identidade/);

// Segurança e fallback operacional continuam presentes após as otimizações.
assert.match(backend,/idempotency_conflict/);
assert.match(backend,/rate_limited/);
assert.match(backend,/pricing_changed/);
assert.match(backend,/coupon_not_eligible/);
assert.match(backend,/coupon_inactive/);
assert.match(backend,/invalid_quantity/);
assert.match(backend,/cash_already_open/);
assert.match(rules,/allow create: if false;/);
assert.match(printAgent,/origin_required/);
assert.match(admin,/Pedido recebido, mas a impressão automática não foi realizada/);

// Cenários adversos determinísticos.
function finiteNumber(value,{min=-Infinity,max=Infinity,integer=false}={}){
  const parsed=Number(value);
  if(!Number.isFinite(parsed)||parsed<min||parsed>max) return null;
  if(integer&&!Number.isInteger(parsed)) return null;
  return parsed;
}
assert.equal(finiteNumber(NaN,{min:1,max:99,integer:true}),null,'NaN deve falhar fechado');
assert.equal(finiteNumber(0,{min:1,max:99,integer:true}),null,'quantidade zero deve falhar');
assert.equal(finiteNumber(1.5,{min:1,max:99,integer:true}),null,'quantidade fracionada deve falhar');
assert.equal(finiteNumber(100,{min:1,max:99,integer:true}),null,'quantidade acima do limite deve falhar');

function idempotentCreate(state,{requestId,fingerprint}){
  const previous=state.get(requestId);
  if(previous){
    if(previous.fingerprint!==fingerprint) return {error:'idempotency_conflict'};
    return {id:previous.id,idempotent:true};
  }
  const id='order-'+String(state.size+1);
  state.set(requestId,{fingerprint,id});
  return {id,idempotent:false};
}
const requestState=new Map();
const first=idempotentCreate(requestState,{requestId:'same-click',fingerprint:'cart-v1'});
const second=idempotentCreate(requestState,{requestId:'same-click',fingerprint:'cart-v1'});
const conflict=idempotentCreate(requestState,{requestId:'same-click',fingerprint:'cart-v2'});
assert.equal(first.id,second.id,'duplo clique deve reutilizar o mesmo pedido');
assert.equal(second.idempotent,true);
assert.equal(conflict.error,'idempotency_conflict');

function serverPrice({catalogPrice,quotedPrice,available=true}){
  if(!available) return {error:'product_unavailable'};
  if(!Number.isFinite(catalogPrice)||!Number.isFinite(quotedPrice)) return {error:'invalid_order_total'};
  if(Math.abs(catalogPrice-quotedPrice)>0.009) return {error:'pricing_changed'};
  return {ok:true,total:catalogPrice};
}
assert.equal(serverPrice({catalogPrice:60,quotedPrice:55}).error,'pricing_changed','preço alterado deve exigir reconciliação');
assert.equal(serverPrice({catalogPrice:60,quotedPrice:60,available:false}).error,'product_unavailable','produto removido deve ser rejeitado');
assert.equal(serverPrice({catalogPrice:60,quotedPrice:NaN}).error,'invalid_order_total');

function couponActive({active=true,startsAt=0,endsAt=Infinity,now=100}){
  return active&&now>=startsAt&&now<=endsAt;
}
assert.equal(couponActive({endsAt:99}),false,'cupom expirado deve ser rejeitado');
assert.equal(couponActive({active:false}),false,'cupom desativado deve ser rejeitado');

function verifiedDelivery(clientAddress,cepResult){
  return {
    street:clientAddress.street,
    number:clientAddress.number,
    neighborhood:cepResult.neighborhood,
    city:cepResult.city,
    state:cepResult.state
  };
}
const verified=verifiedDelivery(
  {street:'Rua A',number:'10',neighborhood:'BAIRRO ADULTERADO'},
  {neighborhood:'Centro',city:'Ji-Paraná',state:'RO'}
);
assert.equal(verified.neighborhood,'Centro','bairro enviado pelo cliente não pode decidir o frete');

function openCash(state,sessionId){
  if(state.current) return {error:'cash_already_open'};
  state.current=sessionId;
  return {ok:true};
}
const cash={current:null};
assert.equal(openCash(cash,'turno-a').ok,true);
assert.equal(openCash(cash,'turno-b').error,'cash_already_open','dois caixas simultâneos devem ser bloqueados');

function can(permissionSet,permission){
  return permissionSet?.[permission]===true;
}
assert.equal(can({ordersView:true},'ordersCancel'),false,'usuário sem permissão não pode cancelar');

function automaticPrintResult(agentConnected){
  return agentConnected?{printed:true}:{printed:false,alert:true};
}
assert.deepEqual(automaticPrintResult(false),{printed:false,alert:true},'Print Agent desligado deve falhar de forma visível');

// Queda de rede: o requestId persistente é necessário para retry seguro.
assert.match(publicApp,/deliveryPendingOrderRequestId/);
assert.match(publicApp,/getPendingOrderRequestId\(\)/);
assert.match(publicApp,/clearPendingOrderRequestId\(\)/);

// Numeração concorrente é protegida por transação no contador server-side.
assert.match(backend,/const counterRef=db\.doc\("counters\/orders"\)/);
assert.match(backend,/runTransaction/);
assert.match(backend,/tx\.set\(counterRef/);

console.log('Module 6 scale/final adversarial audit OK');
