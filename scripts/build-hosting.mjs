import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root=resolve(new URL('..',import.meta.url).pathname);
const destination=join(root,'.firebase-hosting');

const publicFiles=[
  'index.html',
  '404.html',
  'privacy.html',
  'manifest.webmanifest',
  'service-worker.js',
  'firebase-config.js'
];

const publicDirectories=[
  'assets',
  'account',
  'admin'
];

async function mustExist(path){
  try{
    await stat(path);
  }catch{
    throw new Error('Arquivo obrigatório de Hosting ausente: '+path);
  }
}

await rm(destination,{recursive:true,force:true});
await mkdir(destination,{recursive:true});

for(const relative of publicFiles){
  const source=join(root,relative);
  await mustExist(source);
  await cp(source,join(destination,relative));
}

for(const relative of publicDirectories){
  const source=join(root,relative);
  await mustExist(source);
  await cp(source,join(destination,relative),{recursive:true});
}

console.log('Firebase Hosting bundle preparado em .firebase-hosting');
