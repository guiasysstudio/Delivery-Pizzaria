import fs from 'node:fs';
import assert from 'node:assert/strict';

const backend=fs.readFileSync('functions/index.js','utf8');
const frontend=fs.readFileSync('assets/app.js','utf8');
const admin=fs.readFileSync('admin/admin.js','utf8');

// Guardas que precisam existir no código de produção.
assert.match(backend,/function finiteNumber\(/);
assert.match(backend,/Number\.isFinite\(parsed\)/);
assert.match(backend,/integer && !Number\.isInteger\(parsed\)/);
assert.match(backend,/finiteNumber\(raw\.qty,\{min:1,max:99,integer:true\}\)/);
assert.match(backend,/invalid_quantity/);
assert.match(backend,/invalid_order_total/);

assert.match(backend,/lookupCepData\(zip\)/);
assert.match(backend,/verifiedAddress=await lookupCepData\(zip\)/);
assert.match(backend,/addressLocation=validLocation\(verifiedAddress\.location\)/);
assert.match(backend,/distanceMethod:"straight_line_cep"/);
assert.match(backend,/verifiedNeighborhood/);

assert.match(backend,/requestFingerprint/);
assert.match(backend,/orderRequests\/\$\{requestKey\}/);
assert.match(backend,/requestSnap\.exists/);
assert.match(backend,/idempotency_conflict/);
assert.match(backend,/orderRateLimits\/\$\{decoded\.uid\}/);
assert.match(backend,/rate_limited/);
assert.match(backend,/nowMs-lastCreatedMs<5000/);

assert.match(backend,/invalid_pricing_confirmation/);
assert.match(backend,/pricing_changed/);
assert.match(backend,/email_not_verified/);
assert.match(backend,/flavorProducts/);
assert.match(backend,/selection\.every\(product => promoMatches/);
assert.match(backend,/flavor\.allowHalfHalf===false/);

assert.match(frontend,/reconcileCartWithCatalog/);
assert.match(frontend,/refreshCommerceStateBeforeCheckout/);
assert.match(frontend,/deliveryPendingOrderRequestId/);
assert.match(frontend,/requestId:getPendingOrderRequestId\(\)/);
assert.match(frontend,/pricing:\{/);
assert.match(frontend,/_pricingCepVerified/);
assert.match(frontend,/Distância aproximada em linha reta pelo CEP/);
assert.match(frontend,/productsToPrice\.every\(product=>promotionMatchesProduct/);
assert.doesNotMatch(frontend,/fillAddressFromCep/);

assert.match(admin,/finiteAdminNumber/);
assert.match(admin,/discount>100/);
assert.match(admin,/invalidZoneRows/);
assert.match(admin,/duplicateKmBands/);

// Casos funcionais da regra numérica que o backend implementa.
function finiteNumber(value,{min=-Infinity,max=Infinity,integer=false}={}){
  const parsed=Number(value);
  if(!Number.isFinite(parsed)||parsed<min||parsed>max) return null;
  if(integer&&!Number.isInteger(parsed)) return null;
  return parsed;
}
assert.equal(finiteNumber('abc'),null);
assert.equal(finiteNumber(1.5,{min:1,max:99,integer:true}),null);
assert.equal(finiteNumber(0,{min:1,max:99,integer:true}),null);
assert.equal(finiteNumber(100,{min:1,max:99,integer:true}),null);
assert.equal(finiteNumber(2,{min:1,max:99,integer:true}),2);

// Regra comercial meio a meio: promoção de produto específico só pode valer
// quando todos os sabores da seleção pertencem ao alvo da promoção.
function matches(promo,product){
  if(promo.targetType==='all') return true;
  if(promo.targetType==='category') return promo.targetId===product.categoryId;
  if(promo.targetType==='product') return promo.targetId===product.id;
  return false;
}
function promoPrice(base,promo){
  if(promo.discountType==='percentage'){
    if(!(promo.discountValue>0&&promo.discountValue<=100)) return null;
    return Math.max(0,base*(1-promo.discountValue/100));
  }
  if(promo.discountType==='fixed'&&promo.discountValue>0){
    return Math.max(0,base-promo.discountValue);
  }
  return null;
}
function best(selection,base,promotions){
  return promotions
    .filter(p=>selection.every(product=>matches(p,product)))
    .map(p=>({promo:p,price:promoPrice(base,p)}))
    .filter(x=>Number.isFinite(x.price))
    .sort((a,b)=>a.price-b.price)[0]||null;
}
const a={id:'a',categoryId:'pizza'};
const b={id:'b',categoryId:'pizza'};
const promotions=[
  {id:'product-a',targetType:'product',targetId:'a',discountType:'percentage',discountValue:20},
  {id:'all-pizzas',targetType:'category',targetId:'pizza',discountType:'percentage',discountValue:10}
];
assert.equal(best([a],60,promotions).promo.id,'product-a');
assert.equal(best([a,b],60,promotions).promo.id,'all-pizzas');
assert.equal(promoPrice(100,{discountType:'percentage',discountValue:150}),null);

console.log('Module 1 order security tests OK');
