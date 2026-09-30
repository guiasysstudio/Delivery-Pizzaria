import fs from 'node:fs';
import assert from 'node:assert/strict';

const firebase=JSON.parse(fs.readFileSync('firebase.json','utf8'));
const firebaserc=JSON.parse(fs.readFileSync('.firebaserc','utf8'));
const indexes=JSON.parse(fs.readFileSync('firestore.indexes.json','utf8'));
const pkg=JSON.parse(fs.readFileSync('functions/package.json','utf8'));
const backend=fs.readFileSync('functions/index.js','utf8');
const admin=fs.readFileSync('admin/admin.js','utf8');
const preflight=fs.readFileSync('scripts/production-preflight.mjs','utf8');
const buildHosting=fs.readFileSync('scripts/build-hosting.mjs','utf8');
const deployPs=fs.readFileSync('scripts/deploy-production.ps1','utf8');

assert.equal(firebaserc.projects.default,'delivery-pizzaria-f5b08');
assert.equal(pkg.engines.node,'22');
for(const version of Object.values(pkg.dependencies||{})){
  assert.doesNotMatch(version,/^[~^]/);
}

assert.match(backend,/setGlobalOptions\(\{[\s\S]*?maxInstances:20/);
assert.match(backend,/export const backendHealth = onRequest/);
assert.match(backend,/https:\/\/delivery-pizzaria-f5b08\.web\.app/);
assert.match(backend,/https:\/\/delivery-pizzaria-f5b08\.firebaseapp\.com/);

assert.equal(firebase.hosting.public,'.firebase-hosting');
assert.ok(firebase.hosting.predeploy.includes('node scripts/build-hosting.mjs'));
assert.ok(firebase.hosting.headers.some(x=>x.source==='service-worker.js'));
assert.ok(firebase.hosting.headers.some(x=>x.source==='**'));
assert.ok(firebase.hosting.rewrites.some(x=>x.source==='/api/health'&&x.function?.functionId==='backendHealth'));
assert.ok(firebase.hosting.rewrites.some(x=>x.source==='/api/order/create'&&x.function?.functionId==='createOrder'));

for(const forbidden of ['functions','tests','print-agent','scripts','.github']){
  assert.doesNotMatch(buildHosting,new RegExp("publicDirectories[\\s\\S]*?['\"]"+forbidden+"['\"]"));
}
assert.match(preflight,/Firebase production preflight OK/);
assert.match(deployPs,/firebase deploy --project \$Project --only/);

assert.match(backend,/expiresAt:new Date\(now\.getTime\(\)\+7\*24\*60\*60\*1000\)/);
assert.match(backend,/expiresAt:new Date\(now\.getTime\(\)\+24\*60\*60\*1000\)/);
const ttlGroups=new Map((indexes.fieldOverrides||[]).map(x=>[x.collectionGroup,x]));
for(const group of ['orderRequests','cashOperationRequests','orderRateLimits']){
  assert.equal(ttlGroups.get(group)?.fieldPath,'expiresAt');
  assert.equal(ttlGroups.get(group)?.ttl,true);
  assert.deepEqual(ttlGroups.get(group)?.indexes,[]);
}

assert.match(backend,/publicUrl:\s*`https:\/\/raw\.githubusercontent\.com/);
assert.match(admin,/result\.publicUrl\|\|result\.path/);

console.log('Module 4 Firebase production tests OK');
