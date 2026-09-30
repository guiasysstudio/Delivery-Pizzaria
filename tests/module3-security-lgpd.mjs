import fs from 'node:fs';
import assert from 'node:assert/strict';

const backend=fs.readFileSync('functions/index.js','utf8');
const rules=fs.readFileSync('firestore.rules','utf8');
const admin=fs.readFileSync('admin/admin.js','utf8');
const adminPrint=fs.readFileSync('admin/print.js','utf8');
const account=fs.readFileSync('account/account.js','utf8');
const accountReceipt=fs.readFileSync('account/receipt.js','utf8');
const customerAuth=fs.readFileSync('assets/customer-auth.js','utf8');
const publicApp=fs.readFileSync('assets/app.js','utf8');
const indexHtml=fs.readFileSync('index.html','utf8');
const privacyHtml=fs.readFileSync('privacy.html','utf8');

// Staff identity and authorization.
assert.match(backend,/export const resolveStaffLogin = onRequest/);
assert.match(backend,/export const manageStaffUser = onRequest/);
assert.match(backend,/export const manageStaffRole = onRequest/);
assert.match(backend,/caller\.role!==\"master\"/);
assert.match(backend,/password\.length>=10/);
assert.match(backend,/\/\[A-Za-z\]\/.test\(password\)/);
assert.match(backend,/\/\\d\/.test\(password\)/);
assert.match(backend,/revokeRefreshTokens/);

// A fake staff username must receive an internal e-mail with the same shape as a
// real mapping, so the resolver does not expose an obvious existence oracle.
assert.match(backend,/staff\.\$\{safeUsername\}\.\$\{token\}@delivery-pizzaria\.local/);

// Firestore: sensitive administrative collections are not writable by browser.
const staffLoginRules=rules.slice(
  rules.indexOf('match /staffLogins/{username}'),
  rules.indexOf('match /users/{uid}')
);
assert.match(staffLoginRules,/allow read, write: if false;/);

const userRules=rules.slice(
  rules.indexOf('match /users/{uid}'),
  rules.indexOf('match /roles/{roleId}')
);
assert.match(userRules,/allow get: if signedIn\(\) && request\.auth\.uid == uid;/);
assert.match(userRules,/allow list: if isMaster\(\);/);
assert.match(userRules,/allow create, update, delete: if false;/);

const roleRules=rules.slice(
  rules.indexOf('match /roles/{roleId}'),
  rules.indexOf('match /customers/{uid}')
);
assert.match(roleRules,/allow create, update, delete: if false;/);

// Customer profile/address/favorites are owner-only.
const customerRules=rules.slice(
  rules.indexOf('match /customers/{uid}'),
  rules.indexOf('match /customerPrivate/{uid}')
);
assert.doesNotMatch(customerRules,/hasPermission\(/);
assert.match(customerRules,/allow read: if isOwnCustomer\(uid\);/);
assert.match(customerRules,/validCustomerProfileShape/);
assert.match(customerRules,/validCustomerAddressShape/);

// CPF/index stay server-only.
const privateIdentityRules=rules.slice(
  rules.indexOf('match /customerPrivate/{uid}'),
  rules.indexOf('match /settings/store')
);
assert.match(privateIdentityRules,/allow read, write: if false;/);

// Order contact data is separated from the operational order.
assert.match(rules,/match \/orderPrivate\/\{orderId\}/);
assert.match(rules,/resource\.data\.customerId == request\.auth\.uid/);
assert.match(backend,/const orderPrivateRef=db\.doc\(\`orderPrivate\/\$\{orderRef\.id\}\`\)/);
assert.match(backend,/tx\.set\(orderPrivateRef,\{/);

const orderWriteStart=backend.indexOf('tx.set(orderRef,{');
const privateWriteStart=backend.indexOf('tx.set(orderPrivateRef,{',orderWriteStart);
assert.ok(orderWriteStart>0 && privateWriteStart>orderWriteStart,'Bloco createOrder não localizado.');
const publicOrderWrite=backend.slice(orderWriteStart,privateWriteStart);
assert.doesNotMatch(publicOrderWrite,/customer:\s*\{/);
assert.doesNotMatch(publicOrderWrite,/address:\s*fulfillment/);

// Legacy PII has a controlled migration path.
assert.match(backend,/export const staffOrderPrivate = onRequest/);
assert.match(backend,/export const migrateOrderPrivacy = onRequest/);
assert.match(backend,/FieldValue\.delete\(\)/);
assert.match(backend,/systemMigrations\/orderPrivacyV1/);

// Raw CPF must not be persisted after validation.
assert.match(backend,/cpfHash:hash/);
assert.match(backend,/cpfMasked:masked/);
assert.match(backend,/cpfVerified:true/);
assert.match(backend,/cpf:FieldValue\.delete\(\)/);
const privateSetIndex=backend.indexOf('tx.set(privateRef,{',backend.indexOf('export const customerIdentity'));
assert.ok(privateSetIndex>0,'Persistência customerPrivate não localizada.');
const privateSetEnd=backend.indexOf('tx.set(customerRef,{',privateSetIndex);
const privateSet=backend.slice(privateSetIndex,privateSetEnd);
assert.doesNotMatch(privateSet,/\n\s*cpf,\s*$/m);

// Account deletion/anonymization.
assert.match(backend,/export const deleteCustomerAccount = onRequest/);
assert.match(backend,/error:\"active_orders\"/);
assert.match(backend,/customerDeleted:true/);
assert.match(backend,/customerId:FieldValue\.delete\(\)/);
assert.match(backend,/writer\.delete\(db\.doc\(\`orderPrivate\/\$\{orderDoc\.id\}\`\)\)/);

// ADM: Master-only staff administration and anonymized customer directory.
assert.doesNotMatch(admin,/createUserWithEmailAndPassword/);
assert.doesNotMatch(admin,/deleteUser\(/);
assert.doesNotMatch(admin,/getDocs\(collection\(db,'customers'\)\)/);
assert.match(admin,/Resumo operacional anonimizado/);
assert.match(admin,/staffCanViewOrderPrivate/);
assert.match(admin,/hydrateOrderPrivate/);
assert.match(admin,/ORDER_PRIVACY_MIGRATION_ENDPOINT/);
assert.match(admin,/Pedido #\$\{String\(o\.orderNumber/);

// Printing obtains contact data only through the dedicated endpoint once privacy
// migration is active; legacy snapshot fallback remains only for pre-deploy bridge.
assert.match(adminPrint,/STAFF_ORDER_PRIVATE_ENDPOINT/);
assert.match(adminPrint,/Authorization':'Bearer '/);
assert.match(accountReceipt,/getDoc\(doc\(db,'orderPrivate',id\)\)/);

// Customer controls: strong password, masked CPF, export/delete and notice.
assert.match(customerAuth,/validCustomerPassword/);
assert.match(customerAuth,/password\.length>=8/);
assert.match(customerAuth,/CUSTOMER_DELETE_ENDPOINT/);
assert.match(account,/deleteCustomerAccount/);
assert.match(account,/meus-dados-delivery-pizzaria\.json/);
assert.match(account,/cpfMasked/);
assert.doesNotMatch(account,/identity\?\.cpf\?/);
assert.match(indexHtml,/id=\"registerPrivacyNotice\"/);
assert.match(indexHtml,/href=\"\.\/privacy\.html\"/);
assert.match(publicApp,/validCustomerPassword/);
assert.match(publicApp,/registerPrivacyNotice/);

// Privacy notice must be present and describe the implemented minimization.
assert.match(privacyHtml,/Aviso de Privacidade/);
assert.match(privacyHtml,/CPF/);
assert.match(privacyHtml,/não é mantido no cadastro operacional/);
assert.match(privacyHtml,/Minha Conta/);

// Functional password checks mirror the production client policy.
function validCustomerPassword(value){
  const password=String(value||'');
  return password.length>=8 &&
    password.length<=128 &&
    /[A-Za-z]/.test(password) &&
    /\d/.test(password);
}
assert.equal(validCustomerPassword('12345678'),false);
assert.equal(validCustomerPassword('abcdefgh'),false);
assert.equal(validCustomerPassword('abc12345'),true);
assert.equal(validCustomerPassword('Abcdefg1'),true);

console.log('Module 3 security and LGPD tests OK');
