import { spawnSync } from 'node:child_process';

const commands=[
  ['node',['tests/module1-order-security.mjs']],
  ['node',['tests/module2-cash-ledger.mjs']],
  ['node',['tests/module3-security-lgpd.mjs']],
  ['node',['tests/module4-firebase-production.mjs']],
  ['node',['tests/module5-print-pwa-publication.mjs']],
  ['node',['tests/module6-scale-final-audit.mjs']],
  ['node',['scripts/production-preflight.mjs']]
];

for(const [command,args] of commands){
  const result=spawnSync(command,args,{stdio:'inherit',shell:process.platform==='win32'});
  if(result.status!==0){
    process.exit(result.status||1);
  }
}

console.log('Final audit OK: módulos 1–6 e preflight aprovados.');
