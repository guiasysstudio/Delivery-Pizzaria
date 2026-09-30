import fs from 'node:fs';
import assert from 'node:assert/strict';

const backend=fs.readFileSync('functions/index.js','utf8');
const admin=fs.readFileSync('admin/admin.js','utf8');
const rules=fs.readFileSync('firestore.rules','utf8');

// O caixa deve ser autoridade server-side.
assert.match(backend,/export const manageCash = onRequest/);
for(const action of ['open','movement','close','completeOrder']){
  assert.match(backend,new RegExp('\"'+action+'\"'));
}
assert.match(backend,/verifyActiveStaffRequest\(req,requiredPermission\)/);
assert.match(backend,/requiredPermission=action===\"completeOrder\"\?\"ordersComplete\":\"cashOperate\"/);

// Concorrência e integridade.
assert.match(backend,/cashState\/current/);
assert.match(backend,/financialRevision/);
assert.match(backend,/cash_changed_recheck/);
assert.match(backend,/insufficient_cash/);
assert.match(backend,/idempotent:true/);
assert.match(backend,/cashSessionId:sessionId/);
assert.match(backend,/salesSummary/);
assert.match(backend,/movementSummary/);
assert.match(backend,/roundCashMoney/);
assert.match(backend,/ensureCashLedgerV2/);
assert.match(backend,/buildLegacyCashLedger/);
assert.match(backend,/cashOperationRequests\/\$\{requestKey\}/);
assert.match(backend,/requestFingerprint/);

// Sessões podem ser sequenciais no mesmo dia, mas não simultâneas.
assert.match(backend,/cash_already_open/);
assert.match(backend,/sessionIds:\[\.\.\.previousIds,sessionRef\.id\]/);
assert.match(backend,/sessionNumber=previousIds\.length\+1/);

// O navegador não pode mais gravar diretamente no livro financeiro.
const cashRules=rules.slice(
  rules.indexOf('match /cashSessions/{sessionId}'),
  rules.indexOf('match /counters/orders')
);
assert.match(cashRules,/allow create, update, delete: if false;/);
assert.match(cashRules,/match \/movements\/\{movementId\}/);
assert.match(cashRules,/allow read: if hasPermission\('cashView'\);/);
assert.match(cashRules,/match \/cashState\/\{stateId\}/);
assert.match(cashRules,/match \/cashDays\/\{businessDate\}/);
assert.doesNotMatch(cashRules,/allow create, update: if hasPermission\('cashOperate'\)/);

// Conclusão de pedido não pode mais acontecer diretamente pelo SDK do navegador.
const canUpdateStart=rules.indexOf('function canUpdateOrder()');
const canUpdateEnd=rules.indexOf('match /staffLogins',canUpdateStart);
const canUpdate=rules.slice(canUpdateStart,canUpdateEnd);
assert.doesNotMatch(canUpdate,/completeTransition\(\)/);

// O ADM deve usar a Function para concluir pedidos e para todas as operações de caixa.
assert.match(admin,/CASH_OPERATION_ENDPOINT/);
assert.match(admin,/cashOperation\('completeOrder',\{orderId:order\.id\}\)/);
assert.match(admin,/cashOperation\('open'/);
assert.match(admin,/cashOperation\('movement'/);
assert.match(admin,/cashOperation\('close'/);
assert.doesNotMatch(admin,/patch\.completedAt=serverTimestamp\(\)/);
assert.doesNotMatch(admin,/runTransaction\(db/);
assert.match(admin,/getDoc\(doc\(db,'cashState','current'\)\)/);
assert.match(admin,/expectedRevision:cashCloseRevision/);
assert.match(admin,/cashOpenRequestId/);
assert.match(admin,/cashMovementRequestId/);
assert.match(admin,/requestId:cashOpenRequestId/);
assert.match(admin,/requestId:cashMovementRequestId/);

// Testes funcionais dos cálculos financeiros em centavos.
function roundCashMoney(value){
  const parsed=Number(value);
  if(!Number.isFinite(parsed)) return null;
  return Math.round((parsed+Number.EPSILON)*100)/100;
}
function bucket(method){
  const value=String(method||'').toLowerCase();
  if(value.includes('dinheiro')) return 'money';
  if(value.includes('pix')) return 'pix';
  if(value.includes('débito')||value.includes('debito')) return 'debit';
  if(value.includes('crédito')||value.includes('credito')) return 'credit';
  return 'other';
}

assert.equal(roundCashMoney(0.1+0.2),0.3);
assert.equal(roundCashMoney(10.005),10.01);
assert.equal(bucket('Dinheiro'),'money');
assert.equal(bucket('PIX'),'pix');
assert.equal(bucket('Cartão de débito'),'debit');
assert.equal(bucket('Crédito'),'credit');
assert.equal(bucket('Vale refeição'),'other');

const opening=100;
const cashSales=250.50;
const supplies=20;
const withdrawals=30;
assert.equal(roundCashMoney(opening+cashSales+supplies-withdrawals),340.50);
assert.equal(roundCashMoney(338.50-340.50),-2);

console.log('Module 2 cash ledger tests OK');
