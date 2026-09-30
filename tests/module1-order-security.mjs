import fs from 'node:fs';
import assert from 'node:assert/strict';

function extractFunction(source,name){
  const marker='function '+name;
  const start=source.indexOf(marker);
  assert.notEqual(start,-1,'Função '+name+' não encontrada.');
  const brace=source.indexOf('{',start);
  assert.notEqual(brace,-1,'Corpo de '+name+' não encontrado.');

  let depth=0;
  let quote=null;
  let escaped=false;
  let lineComment=false;
  let blockComment=false;

  for(let i=brace;i<source.length;i++){
    const ch=source[i];
    const next=source[i+1];

    if(lineComment){
      if(ch==='\n') lineComment=false;
      continue;
    }
    if(blockComment){
      if(ch==='*'&&next==='/'){blockComment=false;i++;}
      continue;
    }
    if(quote){
      if(escaped){escaped=false;continue;}
      if(ch==='\\'){escaped=true;continue;}
      if(ch===quote) quote=null;
      continue;
    }
    if(ch==='/'&&next==='/'){lineComment=true;i++;continue;}
    if(ch==='/'&&next==='*'){blockComment=true;i++;continue;}
    if(ch==="'"||ch==='"'||ch==='\`'){quote=ch;continue;}

    if(ch==='{') depth++;
    if(ch==='}'){
      depth--;
      if(depth===0) return source.slice(start,i+1);
    }
  }
  throw new Error('Corpo incompleto em '+name);
}

const backend=fs.readFileSync('functions/index.js','utf8');
const frontend=fs.readFileSync('assets/app.js','utf8');

const backendHelpers=[
  extractFunction(backend,'finiteNumber'),
  extractFunction(backend,'finiteMoney'),
  extractFunction(backend,'applyPromotion'),
  extractFunction(backend,'distanceKm'),
  extractFunction(backend,'bestPromotionForSelection')
].join('\n');

const helpers=new Function(
  backendHelpers+
  '\nreturn {finiteNumber,finiteMoney,applyPromotion,distanceKm,bestPromotionForSelection};'
)();

assert.equal(helpers.finiteNumber('abc'),null);
assert.equal(helpers.finiteNumber(1.5,{min:1,max:99,integer:true}),null);
assert.equal(helpers.finiteNumber(2,{min:1,max:99,integer:true}),2);
assert.equal(helpers.finiteMoney(-1),null);
assert.equal(helpers.applyPromotion(100,{discountType:'percentage',discountValue:10}),90);
assert.equal(helpers.applyPromotion(100,{discountType:'percentage',discountValue:150}),null);
assert.equal(helpers.applyPromotion(100,{discountType:'fixed',discountValue:15}),85);
assert.equal(helpers.applyPromotion(100,{discountType:'fixed',discountValue:-1}),null);
assert.equal(Math.round(helpers.distanceKm(
  {latitude:-10.8777,longitude:-61.9325},
  {latitude:-10.8777,longitude:-61.9325}
)*1e9)/1e9,0);

// Usa a implementação real de bestPromotionForSelection com um matcher controlado
// para provar que uma promoção específica de A não vaza para A/B meio a meio.
const selectionFactory=new Function(
  'promoMatches',
  extractFunction(backend,'finiteNumber')+'\n'+
  extractFunction(backend,'finiteMoney')+'\n'+
  extractFunction(backend,'applyPromotion')+'\n'+
  extractFunction(backend,'bestPromotionForSelection')+
  '\nreturn bestPromotionForSelection;'
);
const selectionFn=selectionFactory((promo,product)=>{
  if(promo.targetType==='all') return true;
  if(promo.targetType==='category') return promo.targetId===product.categoryId;
  if(promo.targetType==='product') return promo.targetId===product.id;
  return false;
});
const a={id:'a',categoryId:'pizza'};
const b={id:'b',categoryId:'pizza'};
const promos=[
  {id:'pa',targetType:'product',targetId:'a',discountType:'percentage',discountValue:20},
  {id:'cat',targetType:'category',targetId:'pizza',discountType:'percentage',discountValue:10}
];
assert.equal(selectionFn(promos,[a],60,'UTC').promo.id,'pa');
assert.equal(selectionFn(promos,[a,b],60,'UTC').promo.id,'cat');

const deliveryFn=extractFunction(backend,'calculateServerDelivery');
assert.match(deliveryFn,/lookupCepData\(zip\)/);
assert.doesNotMatch(deliveryFn,/address\?\.location|address\.location/);
assert.match(deliveryFn,/distanceMethod:"straight_line_cep"/);

assert.match(backend,/requestFingerprint/);
assert.match(backend,/orderRequests\/\$\{requestKey\}/);
assert.match(backend,/idempotency_conflict/);
assert.match(backend,/orderRateLimits\/\$\{decoded\.uid\}/);
assert.match(backend,/rate_limited/);
assert.match(backend,/invalid_pricing_confirmation/);
assert.match(backend,/pricing_changed/);
assert.match(backend,/email_not_verified/);
assert.match(backend,/finiteNumber\(raw\.qty,\{min:1,max:99,integer:true\}\)/);

assert.match(frontend,/reconcileCartWithCatalog/);
assert.match(frontend,/refreshCommerceStateBeforeCheckout/);
assert.match(frontend,/deliveryPendingOrderRequestId/);
assert.match(frontend,/requestId:getPendingOrderRequestId\(\)/);
assert.match(frontend,/pricing:\{/);
assert.match(frontend,/address\._pricingCepVerified/);
assert.match(frontend,/Distância aproximada em linha reta pelo CEP/);

// A rotina antiga de consulta direta ViaCEP no blur não pode voltar.
assert.doesNotMatch(frontend,/fillAddressFromCep/);

console.log('Module 1 order security tests OK');
