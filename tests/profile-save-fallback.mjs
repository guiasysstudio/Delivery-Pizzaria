import fs from 'node:fs';
import assert from 'node:assert/strict';

const auth=fs.readFileSync('assets/customer-auth.js','utf8');
const account=fs.readFileSync('account/account.js','utf8');
const app=fs.readFileSync('assets/app.js','utf8');

assert.match(auth,/const DEMO_IDENTITY_PREFIX='deliveryDemoIdentity:';/);
assert.match(auth,/function identityBackendUnavailable\(err\)/);
assert.match(auth,/http\/404/);
assert.match(auth,/err instanceof TypeError/);
assert.match(auth,/function maskCpfForFallback\(value\)/);
assert.match(auth,/return '\*\*\*\.\*\*\*\.\*\*\*-'/);
assert.match(auth,/demoFallback:true/);

// O fallback local não pode persistir CPF bruto, nome ou telefone.
const demoStart=auth.indexOf('function saveDemoIdentity');
const demoEnd=auth.indexOf('function clearDemoIdentity',demoStart);
const demoBlock=auth.slice(demoStart,demoEnd);
assert.doesNotMatch(demoBlock,/cpf:\s*normalizeCpf/);
assert.doesNotMatch(demoBlock,/name:/);
assert.doesNotMatch(demoBlock,/phone:/);
assert.match(demoBlock,/cpfMasked:/);

// Erros de regra de negócio continuam vindo do servidor; fallback é só indisponibilidade.
assert.match(auth,/if\(!identityBackendUnavailable\(err\)\|\|!auth\.currentUser\) throw err;/);
assert.match(auth,/cpf_already_registered|customerIdentity/);

// Dados básicos devem ser persistidos antes da validação privada.
const saveStart=account.indexOf("$('#profileForm').onsubmit");
const saveEnd=account.indexOf("$('#exportMyDataBtn')",saveStart);
const saveBlock=account.slice(saveStart,saveEnd);
assert.ok(saveBlock.indexOf('await saveCustomerProfile(user.uid,payload)') <
  saveBlock.indexOf('identity=await saveCustomerIdentity({name,phone,cpf})'),
  'Perfil público precisa salvar antes da validação do CPF');
assert.match(account,/Cadastro salvo para demonstração/);
assert.match(saveBlock,/CPF ficou somente mascarado neste navegador/);

// Login não pode entrar em loop de perfil incompleto quando a demonstração local já foi salva.
assert.match(app,/getCustomerIdentity, saveCustomerIdentity/);
assert.match(app,/profile\?\.identityComplete===true\|\|identity\?\.identityComplete===true/);

// Quando Functions voltar, o servidor reassume a autoridade e limpa o fallback.
assert.match(auth,/clearDemoIdentity\(auth\.currentUser\?\.uid\);/);

console.log('Profile save fallback regression OK');
