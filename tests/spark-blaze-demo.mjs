import fs from 'node:fs';
import assert from 'node:assert/strict';

const demo=fs.readFileSync('assets/demo-mode.js','utf8');
const app=fs.readFileSync('assets/app.js','utf8');
const account=fs.readFileSync('account/account.js','utf8');
const receipt=fs.readFileSync('account/receipt.js','utf8');
const admin=fs.readFileSync('admin/admin.js','utf8');
const adminPrint=fs.readFileSync('admin/print.js','utf8');
const index=fs.readFileSync('index.html','utf8');
const adminHtml=fs.readFileSync('admin/index.html','utf8');
const accountHtml=fs.readFileSync('account/index.html','utf8');
const sw=fs.readFileSync('service-worker.js','utf8');
const functions=fs.readFileSync('functions/index.js','utf8');
const matrix=fs.readFileSync('docs/SPARK_BLAZE_DEMO.md','utf8');

assert.match(demo,/host==='guiasysstudio\.github\.io'/);
assert.match(demo,/query\.get\('demo'\)==='1'/);
assert.match(demo,/DEMO_TTL_MS=24\*60\*60\*1000/);
assert.match(demo,/id:'demo-'\+crypto\.randomUUID\(\)/);
assert.match(demo,/demoMode:true/);
assert.match(demo,/BroadcastChannel\('delivery-pizzaria-demo'\)/);

assert.match(app,/createLocalDemoOrder/);
assert.match(app,/secure-order-unavailable/);
assert.match(app,/secure-order-not-deployed/);
assert.match(app,/backendMissing&&demoEnvironmentAllowed\(\)/);
assert.match(app,/Pedido criado em modo demonstração/);
assert.match(app,/deliveryPricing:\{/);

assert.match(account,/listenDemoOrders/);
assert.match(account,/isDemoOrderId\(order\.id\)/);
assert.match(account,/updateDemoOrder\(order\.id,\{status:'cancelled'\}\)/);
assert.match(receipt,/getDemoOrder/);
assert.match(admin,/listenDemoOrders/);
assert.match(admin,/isDemoOrderId\(order\?\.id\)/);
assert.match(admin,/updateDemoOrder\(order\.id,\{status\}\)/);
assert.match(adminPrint,/getDemoOrder/);

assert.match(index,/id="publicDemoBanner"/);
assert.match(accountHtml,/id="accountDemoBanner"/);
assert.match(adminHtml,/id="adminDemoBanner"/);
assert.match(adminHtml,/Requer Blaze em produção/);
assert.match(adminHtml,/Som e notificação deste navegador funcionam sem Blaze/);
assert.match(sw,/\.\/assets\/demo-mode\.js/);

assert.match(admin,/blazeRequiredMessage\('cash'\)/);
assert.match(admin,/blazeRequiredMessage\('staffUsers'\)/);
assert.match(admin,/blazeRequiredMessage\('staffRoles'\)/);
assert.match(admin,/blazeRequiredMessage\('imageUpload'\)/);
assert.match(account,/blazeRequiredMessage\('customerDelete'\)/);
assert.match(account,/blazeRequiredMessage\('customerCancel'\)/);

const exports=[...functions.matchAll(/export const ([A-Za-z0-9_]+)\s*=\s*(?:onRequest|onDocumentUpdated|onDocumentCreated|onCall)/g)].map(m=>m[1]);
assert.equal(exports.length,15,'A matriz precisa ser revista se a quantidade de Functions mudar.');
for(const name of exports){
  assert.ok(matrix.includes('\`'+name+'\`'),'Function ausente da matriz Spark/Blaze: '+name);
}

console.log('Spark/Blaze demonstration compatibility OK');
