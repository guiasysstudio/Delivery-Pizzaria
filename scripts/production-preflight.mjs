import { readFile, access, readdir, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'..');
const read=async path=>readFile(join(root,path),'utf8');

function fail(message){
  throw new Error('[preflight] '+message);
}

const firebaserc=JSON.parse(await read('.firebaserc'));
const firebase=JSON.parse(await read('firebase.json'));
const clientConfig=await read('firebase-config.js');
const functionsPackage=JSON.parse(await read('functions/package.json'));
const backend=await read('functions/index.js');

const project=firebaserc?.projects?.default;
if(project!=='delivery-pizzaria-f5b08') fail('Projeto padrão inesperado em .firebaserc: '+project);
if(!clientConfig.includes('projectId: "delivery-pizzaria-f5b08"')) fail('firebase-config.js aponta para outro projeto.');

if(functionsPackage?.engines?.node!=='22') fail('Functions deve usar Node 22.');
for(const [name,version] of Object.entries(functionsPackage.dependencies||{})){
  if(/^[~^]/.test(version)) fail('Dependência não fixada: '+name+' '+version);
}

const expectedExports=[
  'backendHealth',
  'uploadProductImage',
  'uploadStoreLogo',
  'grantLoyaltyCoupons',
  'resolveStaffLogin',
  'manageStaffUser',
  'manageStaffRole',
  'staffOrderPrivate',
  'migrateOrderPrivacy',
  'manageCash',
  'customerIdentity',
  'migrateCustomerPrivacy',
  'deleteCustomerAccount',
  'cancelCustomerOrder',
  'createOrder'
];
for(const name of expectedExports){
  if(!backend.includes('export const '+name+' = ')) fail('Function ausente: '+name);
}

for(const origin of [
  'https://delivery-pizzaria-f5b08.web.app',
  'https://delivery-pizzaria-f5b08.firebaseapp.com'
]){
  if(!backend.includes(origin)) fail('CORS de produção ausente: '+origin);
}

if(firebase?.hosting?.public!=='.firebase-hosting') fail('Hosting não usa bundle isolado.');
if(!Array.isArray(firebase?.hosting?.predeploy)||!firebase.hosting.predeploy.includes('node scripts/build-hosting.mjs')){
  fail('Predeploy de Hosting não configurado.');
}

const rewrites=firebase?.hosting?.rewrites||[];
for(const item of rewrites){
  const functionId=item?.function?.functionId;
  if(functionId&&!expectedExports.includes(functionId)){
    fail('Rewrite aponta para Function desconhecida: '+functionId);
  }
}

await import('./build-hosting.mjs');

const bundle=join(root,'.firebase-hosting');
for(const required of [
  'index.html',
  'privacy.html',
  'manifest.webmanifest',
  'service-worker.js',
  'firebase-config.js',
  'assets',
  'account',
  'admin'
]){
  try{ await access(join(bundle,required)); }
  catch{ fail('Arquivo público ausente do bundle: '+required); }
}

for(const forbidden of [
  'functions',
  'tests',
  'print-agent',
  'scripts',
  '.github',
  'firestore.rules',
  'firestore.indexes.json',
  '.firebaserc',
  'firebase.json'
]){
  try{
    await access(join(bundle,forbidden));
    fail('Conteúdo interno exposto no Hosting: '+forbidden);
  }catch(err){
    if(String(err?.message||'').startsWith('[preflight]')) throw err;
  }
}

const top=await readdir(bundle);
if(top.some(name=>name.startsWith('.'))) fail('Arquivo oculto publicado no bundle.');

console.log('Firebase production preflight OK');
