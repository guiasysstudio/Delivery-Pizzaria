import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp, writeBatch } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from '../firebase-config.js';
import { showToast, confirmAction, emptyStateHtml, iconHtml, skeletonListHtml, applyBrandTheme } from '../assets/ui.js';

const app=initializeApp(firebaseConfig);
const auth=getAuth(app);
const db=getFirestore(app);
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0));

function readStoredJson(storage,key,fallback){
  try{
    const raw=storage.getItem(key);
    if(!raw) return fallback;
    const parsed=JSON.parse(raw);
    return parsed??fallback;
  }catch(err){
    console.warn(`Storage inválido em ${key}; restaurando valor padrão.`,err);
    storage.removeItem(key);
    return fallback;
  }
}

function businessDateTimeKey(date=new Date(),timezone='America/Porto_Velho'){
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:timezone,
    year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(date);
  const values=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function dateTimeWindowActive(startsAt,endsAt,timezone='America/Porto_Velho'){
  const nowMs=Date.now();
  const nowKey=businessDateTimeKey(new Date(nowMs),timezone);
  const boundary=(value,isStart)=>{
    if(!value) return true;
    const raw=String(value).trim();
    const localMatch=raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2})?$/);
    if(localMatch) return isStart?nowKey>=localMatch[1]:nowKey<=localMatch[1];
    const epoch=Date.parse(raw);
    if(!Number.isFinite(epoch)) return false;
    return isStart?nowMs>=epoch:nowMs<=epoch;
  };
  return boundary(startsAt,true)&&boundary(endsAt,false);
}

const statusLabels={
  pending:'Aguardando confirmação',
  accepted:'Confirmado',
  preparing:'Em preparo',
  ready:'Pronto',
  out_for_delivery:'Saiu para entrega',
  completed:'Concluído',
  cancelled:'Cancelado'
};
const dayNames=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

const permissionDefinitions=[
  ['ordersView','Pedidos','Visualizar pedidos'],
  ['ordersAccept','Pedidos','Aceitar pedidos'],
  ['ordersPrepare','Pedidos','Alterar preparo e marcar como pronto'],
  ['ordersDispatch','Pedidos','Marcar saída para entrega'],
  ['ordersComplete','Pedidos','Concluir pedidos/entregas'],
  ['ordersCancel','Pedidos','Cancelar/recusar pedidos'],
  ['productsView','Cardápio','Visualizar produtos'],
  ['productsCreate','Cardápio','Cadastrar produtos'],
  ['productsEdit','Cardápio','Editar produtos'],
  ['productsDelete','Cardápio','Excluir produtos'],
  ['categoriesManage','Cardápio','Gerenciar categorias'],
  ['promotionsManage','Comercial','Gerenciar promoções'],
  ['couponsManage','Comercial','Gerenciar cupons'],
  ['customersView','Clientes','Visualizar resumo operacional de clientes'],
  ['printingManage','Operação','Configurar impressão'],
  ['cashView','Financeiro','Visualizar caixa e financeiro'],
  ['cashOperate','Financeiro','Abrir e fechar caixa'],
  ['settingsManage','Sistema','Alterar configurações da pizzaria']
];

const defaultRoleTemplates={
  manager:{name:'Gerente',permissions:{
    ordersView:true,ordersAccept:true,ordersPrepare:true,ordersDispatch:true,ordersComplete:true,ordersCancel:true,
    productsView:true,productsCreate:true,productsEdit:true,productsDelete:true,categoriesManage:true,
    promotionsManage:true,couponsManage:true,customersView:true,printingManage:true,cashView:true,cashOperate:true,
    settingsManage:true
  }},
  cashier:{name:'Caixa',permissions:{
    ordersView:true,ordersAccept:true,ordersPrepare:false,ordersDispatch:false,ordersComplete:false,ordersCancel:true,
    productsView:false,productsCreate:false,productsEdit:false,productsDelete:false,categoriesManage:false,
    promotionsManage:false,couponsManage:false,customersView:true,printingManage:true,cashView:true,cashOperate:true,
    settingsManage:false
  }},
  kitchen:{name:'Cozinha',permissions:{
    ordersView:true,ordersAccept:false,ordersPrepare:true,ordersDispatch:false,ordersComplete:false,ordersCancel:false,
    productsView:false,productsCreate:false,productsEdit:false,productsDelete:false,categoriesManage:false,
    promotionsManage:false,couponsManage:false,customersView:false,printingManage:false,cashView:false,cashOperate:false,
    settingsManage:false
  }},
  delivery:{name:'Entrega',permissions:{
    ordersView:true,ordersAccept:false,ordersPrepare:false,ordersDispatch:true,ordersComplete:true,ordersCancel:false,
    productsView:false,productsCreate:false,productsEdit:false,productsDelete:false,categoriesManage:false,
    promotionsManage:false,couponsManage:false,customersView:false,printingManage:false,cashView:false,cashOperate:false,
    settingsManage:false
  }},
  operator:{name:'Operador',permissions:{
    ordersView:true,ordersAccept:true,ordersPrepare:true,ordersDispatch:true,ordersComplete:true,ordersCancel:true,
    productsView:false,productsCreate:false,productsEdit:false,productsDelete:false,categoriesManage:false,
    promotionsManage:false,couponsManage:false,customersView:false,printingManage:false,cashView:false,cashOperate:false,
    settingsManage:false
  }}
};

let categories=[],products=[],orders=[],settings={},users=[],customers=[],roles=[],promotions=[],coupons=[],cashSessions=[],cashMovements=[],currentCashSession=null,currentProfile=null;
const orderPrivateCache=new Map();
let unsubscribeOrders=null,unsubscribeCashState=null,unsubscribeCashSession=null,unsubscribeCashMovements=null,cashLiveSessionId='',soundEnabled=localStorage.getItem('deliverySoundEnabled')==='1',knownOrderIds=new Set();
let cashOpenRequestId='',cashOpenFingerprint='',cashMovementRequestId='',cashMovementFingerprint='',cashCloseRevision=0;

function renderSoundButton(){
  const button=$('#soundBtn');
  if(!button) return;
  button.innerHTML=iconHtml('bell-ring')+`<span>${soundEnabled?'Som ativado':'Ativar som'}</span>`;
  button.setAttribute('aria-pressed',soundEnabled?'true':'false');
}

function showAdminSkeletons(){
  const targets=[
    ['#ordersList',5],
    ['#productsTable',4],
    ['#categoriesTable',3],
    ['#promotionsTable',3],
    ['#couponsTable',3],
    ['#customersTable',4],
    ['#usersTable',3],
    ['#rolesTable',3],
    ['#cashHistory',3]
  ];
  for(const [selector,count] of targets){
    const host=$(selector);
    if(host&&!host.children.length) host.innerHTML=skeletonListHtml(count);
  }
}
let printConfig={
  autoPrint:localStorage.getItem('deliveryAutoPrint')==='1',
  printPending:localStorage.getItem('deliveryPrintPending')==='1',
  model:localStorage.getItem('deliveryPrintModel')||'thermal80'
};
const PRINT_AGENT='http://127.0.0.1:17329';
const PRINT_AGENT_VERSION_MANIFEST='../assets/print-agent-version.json';
const FALLBACK_PRINT_AGENT_VERSION='1.4.0';
const PRINT_AGENT_UPDATE_INTERVAL_MS=15*60*1000;
let printAgentReleaseInfo={
  latestVersion:FALLBACK_PRINT_AGENT_VERSION,
  minimumVersion:FALLBACK_PRINT_AGENT_VERSION,
  downloadUrl:'https://github.com/guiasysstudio/Delivery-Pizzaria/releases/download/print-agent-latest/DeliveryPizzaria-PrintAgent-win-x64.zip',
  message:'Há uma nova versão do Print Agent disponível.'
};
let printAgentReleaseLoaded=false;
let printAgentReleasePromise=null;
let printAgentUpdateTimer=null;
let promptedPrintAgentVersion='';
const IMAGE_UPLOAD_ENDPOINT='https://southamerica-east1-delivery-pizzaria-f5b08.cloudfunctions.net/uploadProductImage';
const STORE_LOGO_UPLOAD_ENDPOINT='https://southamerica-east1-delivery-pizzaria-f5b08.cloudfunctions.net/uploadStoreLogo';
const STAFF_LOGIN_ENDPOINT='https://southamerica-east1-delivery-pizzaria-f5b08.cloudfunctions.net/resolveStaffLogin';
const STAFF_USER_ADMIN_ENDPOINT='https://southamerica-east1-delivery-pizzaria-f5b08.cloudfunctions.net/manageStaffUser';
const STAFF_ROLE_ADMIN_ENDPOINT='https://southamerica-east1-delivery-pizzaria-f5b08.cloudfunctions.net/manageStaffRole';
const STAFF_ORDER_PRIVATE_ENDPOINT='https://southamerica-east1-delivery-pizzaria-f5b08.cloudfunctions.net/staffOrderPrivate';
const CASH_OPERATION_ENDPOINT='https://southamerica-east1-delivery-pizzaria-f5b08.cloudfunctions.net/manageCash';
async function cashOperation(action,payload={}){
  const user=auth.currentUser;
  if(!user) throw Object.assign(new Error('auth-required'),{code:'auth-required'});
  const token=await user.getIdToken();
  const response=await fetch(CASH_OPERATION_ENDPOINT,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'Authorization':'Bearer '+token
    },
    body:JSON.stringify({action,...payload})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const err=new Error(data?.error||'cash-operation-failed');
    err.code=data?.error||'cash-operation-failed';
    err.data=data;
    throw err;
  }
  return data;
}

function staffCanViewOrderPrivate(){
  return isMaster() || [
    'ordersAccept','ordersDispatch','ordersComplete','ordersCancel','printingManage','cashOperate'
  ].some(key=>hasPermission(key));
}

async function fetchOrderPrivate(orderId){
  if(!staffCanViewOrderPrivate()||!orderId) return null;
  if(orderPrivateCache.has(orderId)) return orderPrivateCache.get(orderId);

  const user=auth.currentUser;
  if(!user) return null;
  const token=await user.getIdToken();
  const response=await fetch(STAFF_ORDER_PRIVATE_ENDPOINT,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
    body:JSON.stringify({orderId})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    if(response.status===403) return null;
    const err=new Error(data?.error||'order-private-failed');
    err.code=data?.error||'order-private-failed';
    throw err;
  }
  const safe={customer:data.customer||null,address:data.address||null};
  orderPrivateCache.set(orderId,safe);
  return safe;
}

async function hydrateOrderPrivate(order,{required=false}={}){
  const base={...order};
  if(!staffCanViewOrderPrivate()){
    delete base.customer;
    delete base.address;
    return base;
  }

  if(order?.customer||order?.address){
    base.customer=order.customer||null;
    base.address=order.address||null;
  }

  try{
    const data=await fetchOrderPrivate(order?.id);
    if(data){
      base.customer=data.customer;
      base.address=data.address;
    }
  }catch(err){
    if(required) throw err;
    console.warn('Dados privados do pedido indisponíveis.',err);
  }

  if(required&&!base.customer){
    throw Object.assign(new Error('order-private-unavailable'),{code:'order-private-unavailable'});
  }
  return base;
}

function cashOperationMessage(err){
  const code=String(err?.code||err?.message||'');
  const messages={
    cash_already_open:'Já existe um caixa aberto.',
    cash_session_changed:'O caixa atual mudou em outro computador. Atualize e confira os dados.',
    cash_not_open:'É necessário manter um caixa aberto para concluir esta operação.',
    cash_changed_recheck:'O caixa recebeu uma venda ou movimento enquanto você conferia. Revise os valores antes de fechar.',
    insufficient_cash:'A sangria é maior que o dinheiro disponível esperado no caixa.',
    idempotency_conflict:'A mesma tentativa foi reutilizada com valores diferentes. Revise e tente novamente.',
    invalid_opening_amount:'Informe um valor inicial válido.',
    invalid_cash_movement:'Informe um movimento e valor válidos.',
    invalid_closing_amount:'Informe um valor contado válido.',
    invalid_order_transition:'O pedido mudou de status e não pode mais ser concluído desta forma.',
    invalid_cash_ledger:'O livro financeiro está inconsistente e o fechamento foi bloqueado para evitar perda de dados.',
    permission_denied:'Seu perfil não possui permissão para esta operação financeira.',
    user_disabled:'Seu usuário está desativado.',
    order_not_found:'O pedido não existe mais.'
  };
  return messages[code]||'Não foi possível concluir a operação financeira. Verifique as Firebase Functions e tente novamente.';
}

const storedPrintedOrderIds=readStoredJson(sessionStorage,'deliveryPrintedOrders',[]);
const printedOrderIds=new Set(Array.isArray(storedPrintedOrderIds)?storedPrintedOrderIds:[]);

const defaults={
  storeName:'Delivery Pizzaria',
  subtitle:'Pizza quentinha, do forno para sua casa.',
  phone:'',
  whatsapp:'',
  storeAddress:'',
  storeZip:'',
  storeStreet:'',
  storeNumber:'',
  storeNeighborhood:'',
  storeComplement:'',
  storeCity:'',
  storeState:'',
  storeLocation:null,
  storeLogo:'',
  primaryColor:'#b91c1c',
  heroBanner:'',
  googleMapsUrl:'',
  customerCancelMinutes:2,
  notificationSound:'bell',
  notificationVolume:70,
  deliveryPricingMode:'fixed',
  deliveryFee:5,
  deliveryZones:[],
  deliveryNeighborhoodFallbackFee:5,
  restrictDeliveryZones:false,
  deliveryKmBands:[],
  restrictDeliveryKm:true,
  minimumOrder:0,
  allowPickup:true,
  openMode:'schedule',
  payments:['Dinheiro','PIX na entrega','Cartão de débito','Cartão de crédito'],
  timezone:'America/Porto_Velho',
  autoAcceptOrders:false,
  schedule:{
    0:{enabled:true,open:'18:00',close:'23:30'},
    1:{enabled:false,open:'18:00',close:'23:30'},
    2:{enabled:true,open:'18:00',close:'23:30'},
    3:{enabled:true,open:'18:00',close:'23:30'},
    4:{enabled:true,open:'18:00',close:'23:30'},
    5:{enabled:true,open:'18:00',close:'23:59'},
    6:{enabled:true,open:'18:00',close:'23:59'}
  }
};

function normalizeUsername(value){
  return String(value||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9._-]/g,'');
}
function legacyUsernameEmail(username){
  return `${normalizeUsername(username)}@delivery-pizzaria.local`;
}
function randomStaffEmail(username){
  const token=crypto.randomUUID().replace(/-/g,'').slice(0,18);
  return `staff.${normalizeUsername(username)}.${token}@delivery-pizzaria.local`;
}
async function resolveStaffEmail(username){
  const normalized=normalizeUsername(username);
  const response=await fetch(STAFF_LOGIN_ENDPOINT,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username:normalized})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data?.email) throw new Error('staff-login-lookup-failed');
  return String(data.email);
}
function roleLabel(role){
  if(role==='master') return 'Master';
  return roles.find(r=>r.id===role)?.name||defaultRoleTemplates[role]?.name||role||'Sem perfil';
}
function isMaster(){
  return currentProfile?.role==='master';
}
const permissionDependencies={
  ordersAccept:'ordersView',
  ordersPrepare:'ordersView',
  ordersDispatch:'ordersView',
  ordersComplete:'ordersView',
  ordersCancel:'ordersView',
  productsCreate:'productsView',
  productsEdit:'productsView',
  productsDelete:'productsView',
  categoriesManage:'productsView',
  promotionsManage:'productsView',
  cashOperate:'cashView'
};

function withPermissionDependencies(source={}){
  const permissions={...source};
  let changed=true;
  while(changed){
    changed=false;
    for(const [permission,required] of Object.entries(permissionDependencies)){
      if(permissions[permission]===true&&permissions[required]!==true){
        permissions[required]=true;
        changed=true;
      }
    }
  }
  return permissions;
}

function rolePermissions(role=currentProfile?.role){
  if(role==='master'){
    return Object.fromEntries(permissionDefinitions.map(([key])=>[key,true]));
  }
  const raw=roles.find(r=>r.id===role)?.permissions||defaultRoleTemplates[role]?.permissions||{};
  return withPermissionDependencies(raw);
}
function hasPermission(key){
  return isMaster()||rolePermissions()[key]===true;
}

$('#loginForm').onsubmit=async e=>{
  e.preventDefault();
  $('#loginError').classList.add('hidden');
  const username=normalizeUsername($('#loginUsername').value);
  if(!username){
    $('#loginError').textContent='Informe o usuário.';
    $('#loginError').classList.remove('hidden');
    return;
  }
  try{
    const email=await resolveStaffEmail(username);
    await signInWithEmailAndPassword(auth,email,$('#loginPassword').value);
  }catch(err){
    $('#loginError').textContent='Usuário ou senha inválidos.';
    $('#loginError').classList.remove('hidden');
  }
};

$('#logoutBtn').onclick=async()=>{
  stopCashLedgerListeners();
  await signOut(auth);
};

onAuthStateChanged(auth,async user=>{
  $('#loginError').classList.add('hidden');

  if(!user){
    currentProfile=null;
    stopCashLedgerListeners();
    $('#loginView').classList.remove('hidden');
    $('#adminApp').classList.add('hidden');
    if(unsubscribeOrders) unsubscribeOrders();
    return;
  }

  const username=(user.email||'').split('@')[0];

  try{
    let profileSnap;
    try{
      profileSnap=await getDoc(doc(db,'users',user.uid));
    }catch(profileError){
      console.error(profileError);
      await signOut(auth);
      showLoginError('Não foi possível validar este usuário no banco de dados.');
      return;
    }

    if(!profileSnap.exists()){
      await signOut(auth);
      showLoginError('Usuário sem perfil administrativo. Entre com uma conta criada pelo Master.');
      return;
    }

    currentProfile={uid:user.uid,...profileSnap.data()};
    if(currentProfile.active===false){
      await signOut(auth);
      showLoginError('Este usuário está desativado.');
      return;
    }

    // A autenticação terminou com sucesso. O painel não volta para a tela
    // de login por causa de uma falha posterior do Firestore.
    $('#loginView').classList.add('hidden');
    $('#adminApp').classList.remove('hidden');
    $('#currentUserDisplay').textContent=`${currentProfile.displayName||currentProfile.username||username} • ${roleLabel(currentProfile.role)}`;
    $$('.master-only').forEach(el=>el.classList.toggle('hidden',!isMaster()));
    applyRoleUI();

    try{
      await initializeAdmin();
      clearSystemAlert();
    }catch(initError){
      console.error('Falha ao iniciar painel:',initError);
      showSystemAlert(describeFirestoreError(initError));
    }
  }catch(err){
    console.error(err);
    await signOut(auth).catch(()=>{});
    showLoginError('Não foi possível concluir o acesso ao painel.');
  }
});

function showLoginError(message){
  $('#loginView').classList.remove('hidden');
  $('#adminApp').classList.add('hidden');
  $('#loginError').textContent=message;
  $('#loginError').classList.remove('hidden');
}

function showSystemAlert(message){
  const el=$('#adminSystemAlert');
  el.textContent=message;
  el.classList.remove('hidden');
}

function clearSystemAlert(){
  $('#adminSystemAlert').classList.add('hidden');
  $('#adminSystemAlert').textContent='';
}

function describeFirestoreError(err){
  const code=String(err?.code||'');
  if(code.includes('permission-denied')){
    return 'Login realizado. O Firestore recusou o acesso aos dados administrativos. É necessário publicar as regras de segurança do projeto.';
  }
  if(code.includes('failed-precondition')||code.includes('not-found')){
    return 'Login realizado. O Cloud Firestore ainda não está disponível para este projeto. Crie/ative o banco Firestore e tente novamente.';
  }
  if(code.includes('unavailable')){
    return 'Login realizado, mas o Firebase está temporariamente indisponível. Tente novamente em instantes.';
  }
  return 'Login realizado, mas houve uma falha ao carregar os dados do sistema. Código: '+(code||'desconhecido');
}

async function initializeAdmin(){
  await loadRoles();
  applyRoleUI();
  $('#currentUserDisplay').textContent=`${currentProfile.displayName||currentProfile.username||'Usuário'} • ${roleLabel(currentProfile.role)}`;

  await loadSettings();

  showAdminSkeletons();
  const tasks=[];

  // Produtos também são carregados para quem trabalha com pedidos, pois o
  // painel confere os preços antes de aceitar/imprimir.
  if(
    hasPermission('ordersView') ||
    hasPermission('productsView') ||
    hasPermission('productsCreate') ||
    hasPermission('productsEdit') ||
    hasPermission('productsDelete') ||
    hasPermission('categoriesManage') ||
    hasPermission('promotionsManage')
  ){
    tasks.push(loadCategories(),loadProducts());
  }

  if(hasPermission('customersView')) tasks.push(loadCustomers());
  if(isMaster()) tasks.push(loadUsers());
  if(hasPermission('ordersView')||hasPermission('promotionsManage')) tasks.push(loadPromotions());
  if(hasPermission('ordersView')||hasPermission('couponsManage')) tasks.push(loadCoupons());
  if(hasPermission('cashView')) tasks.push(loadCashSessions());

  await Promise.all(tasks);

  if(hasPermission('ordersView')||hasPermission('cashView')) listenOrders();
  if(hasPermission('cashView')) listenCashLedger();

  if(hasPermission('settingsManage')){
    renderSchedules();
    renderSettings();
  }

  if(hasPermission('printingManage')){
    loadPrintSettingsUI();
    await loadPrintAgentReleaseInfo();
    checkPrintAgent();
    detectPrintAgentUpdate({showPrompt:true});
    startPrintAgentUpdateWatch();
  }

  if(hasPermission('cashView')) renderCash();
  renderSoundButton();
}
async function staffRoleAdminAction(action,payload={}){
  const user=auth.currentUser;
  if(!user) throw Object.assign(new Error('auth-required'),{code:'auth-required'});
  const token=await user.getIdToken();
  const response=await fetch(STAFF_ROLE_ADMIN_ENDPOINT,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
    body:JSON.stringify({action,...payload})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const err=new Error(data?.error||'staff-role-action-failed');
    err.code=data?.error||'staff-role-action-failed';
    throw err;
  }
  return data;
}

async function loadRoles(){
  try{
    let snap=await getDocs(collection(db,'roles'));
    roles=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.name||'').localeCompare(b.name||''));

    if(!roles.length&&isMaster()){
      await staffRoleAdminAction('seedDefaults');
      snap=await getDocs(collection(db,'roles'));
      roles=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
    }
  }catch(err){
    console.warn('Perfis personalizados ainda não disponíveis. Usando perfis padrão.',err);
    roles=Object.entries(defaultRoleTemplates).map(([id,v])=>({id,name:v.name,permissions:v.permissions,system:true,active:true}));
  }
  refreshUserRoleSelect();
  renderRoles();
}

function refreshUserRoleSelect(){
  const select=$('#userRole');
  if(!select) return;
  const current=select.value;
  const opts=roles.filter(r=>r.active!==false).map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('');
  select.innerHTML=opts+(isMaster()?'<option value="master">Master</option>':'');
  if([...select.options].some(o=>o.value===current)) select.value=current;
}

function renderAdminBranding(){
  $('#adminStoreName').textContent=settings.storeName||'Pizzaria';
  applyBrandTheme(settings.primaryColor||'#b91c1c');

  const storeLogo=String(settings.storeLogo||'').trim();
  const logo=$('#adminHeaderStoreLogo');
  const fallback=$('#adminHeaderStoreLogoFallback');
  if(logo&&fallback){
    logo.classList.toggle('hidden',!storeLogo);
    fallback.classList.toggle('hidden',!!storeLogo);
    if(storeLogo){
      logo.src=/^https?:\/\//i.test(storeLogo)?storeLogo:'../'+storeLogo.replace(/^\.?\//,'').replace(/^\//,'');
      logo.alt='Logo da '+(settings.storeName||'pizzaria');
      logo.onerror=()=>{
        logo.classList.add('hidden');
        fallback.classList.remove('hidden');
      };
    }else{
      logo.removeAttribute('src');
      logo.alt='';
    }
  }
}

async function loadSettings(){
  const snap=await getDoc(doc(db,'settings','store'));
  settings=snap.exists()?{...defaults,...snap.data()}:defaults;
  if(!snap.exists()&&['master','manager'].includes(currentProfile?.role)){
    await setDoc(doc(db,'settings','store'),settings);
  }
  renderAdminBranding();
}

async function loadCategories(){
  const s=await getDocs(collection(db,'categories'));
  categories=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.order||0)-(b.order||0));
  renderCategories();
  refreshCategorySelect();
}

async function loadProducts(){
  const s=await getDocs(collection(db,'products'));
  products=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.order||0)-(b.order||0));
  renderProducts();
}

function listenOrders(){
  if(unsubscribeOrders) unsubscribeOrders();
  const q=query(collection(db,'orders'),orderBy('createdAt','desc'));
  let first=true;

  unsubscribeOrders=onSnapshot(q,snap=>{
    const incoming=[];

    snap.docChanges().forEach(ch=>{
      if(ch.type==='added'&&!first&&!knownOrderIds.has(ch.doc.id)){
        incoming.push({id:ch.doc.id,...ch.doc.data()});
      }
    });

    orders=snap.docs.map(d=>({id:d.id,...d.data()}));
    knownOrderIds=new Set(orders.map(o=>o.id));

    renderOrders();
    renderStats();
    if(hasPermission('customersView')) renderCustomers();
    if(hasPermission('cashView')) renderCash();

    if(!first&&incoming.length){
      for(const o of incoming){
        notifyNewOrder(o);

        if(printConfig.autoPrint){
          const shouldPrint=o.status==='accepted'||(o.status==='pending'&&printConfig.printPending);
          if(shouldPrint){
            const pricing=verifyOrderPricing(o);
            if(pricing.valid){
              printOrder(o,true);
            }else{
              showSystemAlert(`Pedido #${String(o.orderNumber||0).padStart(4,'0')} não foi impresso automaticamente porque os valores divergem do cardápio. Revise o pedido antes de aceitar.`);
            }
          }
        }
      }
    }

    first=false;
  },err=>{
    console.error('Falha no acompanhamento de pedidos:',err);
    showSystemAlert('Não foi possível acompanhar os pedidos em tempo real. Verifique as regras do Firestore.');
  });
}

function notifyNewOrder(o){
  if(soundEnabled) beep();
  if('Notification' in window&&Notification.permission==='granted'){
    new Notification(`Novo pedido #${String(o.orderNumber||'').padStart(4,'0')}`,{
      body:`${o.customer?.name||'Cliente'} • ${money(o.total)}`
    });
  }
}

function beep(){playNotificationSound();}

$('#soundBtn').onclick=async()=>{
  soundEnabled=!soundEnabled;
  localStorage.setItem('deliverySoundEnabled',soundEnabled?'1':'0');
  if(soundEnabled&&'Notification' in window&&Notification.permission==='default'){
    await Notification.requestPermission();
  }
  renderSoundButton();
  if(soundEnabled) beep();
};

$$('.nav-item').forEach(b=>b.onclick=()=>switchView(b.dataset.view));

function allowedViews(){
  const views=[];
  if(hasPermission('ordersView')) views.push('orders');
  if(hasPermission('cashView')) views.push('cash');
  if(hasPermission('productsView')||hasPermission('productsCreate')||hasPermission('productsEdit')||hasPermission('productsDelete')) views.push('products');
  if(hasPermission('categoriesManage')) views.push('categories');
  if(hasPermission('promotionsManage')) views.push('promotions');
  if(hasPermission('couponsManage')) views.push('coupons');
  if(hasPermission('customersView')) views.push('customers');
  if(hasPermission('printingManage')) views.push('printing');
  if(isMaster()) views.push('users','roles');
  if(hasPermission('settingsManage')) views.push('settings');
  return views.length?views:['orders'];
}
function applyRoleUI(){
  const allowed=allowedViews();
  $$('.nav-item').forEach(item=>item.classList.toggle('hidden',!allowed.includes(item.dataset.view)));
  $$('.master-only').forEach(el=>{
    const view=el.dataset.view;
    if(view) el.classList.toggle('hidden',!allowed.includes(view));
  });
  if(!allowed.includes(document.querySelector('.admin-view.active')?.id?.replace('view-',''))){
    switchView('orders');
  }
}

function switchView(v){
  const allowed=allowedViews();
  if(!allowed.includes(v)) return;

  $$('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===v));
  $$('.admin-view').forEach(x=>x.classList.toggle('active',x.id===`view-${v}`));

  const titles={
    orders:['OPERAÇÃO','Pedidos'],
    cash:['FINANCEIRO','Caixa'],
    products:['CARDÁPIO','Produtos'],
    categories:['CARDÁPIO','Categorias'],
    promotions:['COMERCIAL','Promoções'],
    coupons:['COMERCIAL','Cupons'],
    customers:['CLIENTES','Clientes'],
    printing:['ESTAÇÃO','Impressão'],
    users:['SEGURANÇA','Usuários'],
    roles:['SEGURANÇA','Perfis de acesso'],
    settings:['PIZZARIA','Dados da Pizzaria']
  };

  $('#viewEyebrow').textContent=titles[v][0];
  $('#viewTitle').textContent=titles[v][1];

  if(v==='printing') checkPrintAgent();
  if(v==='cash'){
    loadCashSessions().catch(err=>console.warn('Não foi possível atualizar o caixa.',err));
    renderCash();
  }
  if(v==='roles') renderRoles();
}

function formatPhoneInput(value){
  const d=String(value||'').replace(/\D/g,'').slice(0,11);
  if(d.length<=2) return d?('('+d):'';
  if(d.length<=6) return '('+d.slice(0,2)+') '+d.slice(2);
  if(d.length<=10) return '('+d.slice(0,2)+') '+d.slice(2,6)+'-'+d.slice(6);
  return '('+d.slice(0,2)+') '+d.slice(2,7)+'-'+d.slice(7);
}

function formatCepInput(value){
  const d=String(value||'').replace(/\D/g,'').slice(0,8);
  return d.length>5?d.slice(0,5)+'-'+d.slice(5):d;
}

function bindAdminFormattedInput(selector,formatter){
  const input=$(selector);
  if(!input) return;
  input.addEventListener('input',()=>{input.value=formatter(input.value);});
}

bindAdminFormattedInput('#setPhone',formatPhoneInput);
bindAdminFormattedInput('#setWhatsapp',formatPhoneInput);
bindAdminFormattedInput('#setStoreZip',formatCepInput);
bindAdminFormattedInput('#deliveryTestZip',formatCepInput);

$('#setPrimaryColor')?.addEventListener('input',e=>{
  const color=applyBrandTheme(e.target.value);
  $('#primaryColorValue').textContent=color.toUpperCase();
});

function renderStoreLogoPreview(){
  const host=$('#storeLogoPreview');
  if(!host) return;
  const value=$('#setStoreLogo')?.value?.trim()||'';
  host.replaceChildren();
  if(!value){
    host.innerHTML=iconHtml('pizza');
    host.classList.remove('has-image');
    return;
  }
  const img=document.createElement('img');
  img.alt='Logo da pizzaria';
  img.src=/^https?:\/\//i.test(value)?value:'../'+value.replace(/^\.?\//,'').replace(/^\//,'');
  img.onerror=()=>{
    host.innerHTML=iconHtml('pizza');
    host.classList.remove('has-image');
  };
  host.appendChild(img);
  host.classList.add('has-image');
}

$('#chooseStoreLogoBtn')?.addEventListener('click',()=>$('#storeLogoFile').click());
$('#removeStoreLogoBtn')?.addEventListener('click',()=>{
  $('#setStoreLogo').value='';
  $('#storeLogoStatus').textContent='Logo padrão selecionada.';
  renderStoreLogoPreview();
});

$('#storeLogoFile')?.addEventListener('change',async e=>{
  const file=e.target.files?.[0];
  if(!file) return;
  if(file.size>8*1024*1024){
    showToast('Escolha uma imagem de até 8 MB.','warning');
    e.target.value='';
    return;
  }

  const button=$('#chooseStoreLogoBtn');
  button.disabled=true;
  $('#storeLogoStatus').textContent='Preparando logo...';

  try{
    const dataUrl=await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result||''));
      reader.onerror=reject;
      reader.readAsDataURL(file);
    });

    const img=await new Promise((resolve,reject)=>{
      const image=new Image();
      image.onload=()=>resolve(image);
      image.onerror=reject;
      image.src=dataUrl;
    });

    const size=512;
    const canvas=document.createElement('canvas');
    canvas.width=size;canvas.height=size;
    const ctx=canvas.getContext('2d');
    ctx.clearRect(0,0,size,size);
    const scale=Math.min(size/img.naturalWidth,size/img.naturalHeight);
    const w=img.naturalWidth*scale,h=img.naturalHeight*scale;
    ctx.drawImage(img,(size-w)/2,(size-h)/2,w,h);
    // PNG mantém transparência e é decodificado de forma nativa pelo Windows/Print Agent.
    const base64=canvas.toDataURL('image/png').split(',')[1];

    const token=await auth.currentUser.getIdToken();
    const response=await fetch(STORE_LOGO_UPLOAD_ENDPOINT,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      body:JSON.stringify({base64})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(result?.message||result?.error||'upload');

    $('#setStoreLogo').value=result.path;
    $('#storeLogoStatus').textContent='Logo enviada com sucesso.';
    renderStoreLogoPreview();
  }catch(err){
    console.error(err);
    $('#storeLogoStatus').textContent='Não foi possível enviar a logo. Verifique se as Firebase Functions estão publicadas.';
  }finally{
    button.disabled=false;
    e.target.value='';
  }
});

function playNotificationSound(name=settings.notificationSound||'bell',volume=settings.notificationVolume??70){
  if(name==='none') return;
  const ctx=new (window.AudioContext||window.webkitAudioContext)();
  const gain=ctx.createGain();
  gain.gain.value=Math.max(0,Math.min(1,Number(volume||0)/100))*.16;
  gain.connect(ctx.destination);

  const patterns={
    bell:[[880,0,.12],[1174,.13,.18]],
    chime:[[659,0,.12],[784,.12,.12],[988,.24,.22]],
    pop:[[520,0,.08],[740,.08,.11]],
    alert:[[880,0,.1],[880,.16,.1],[1046,.32,.16]],
    classic:[[523,0,.12],[659,.14,.12],[784,.28,.2]]
  };
  const pattern=patterns[name]||patterns.bell;
  const now=ctx.currentTime;
  for(const [frequency,offset,duration] of pattern){
    const osc=ctx.createOscillator();
    osc.type='sine';
    osc.frequency.value=frequency;
    osc.connect(gain);
    osc.start(now+offset);
    osc.stop(now+offset+duration);
  }
  setTimeout(()=>ctx.close().catch(()=>{}),900);
}

$('#previewNotificationSoundBtn')?.addEventListener('click',()=>{
  playNotificationSound($('#setNotificationSound').value,$('#setNotificationVolume').value);
});

function normalizePriceKey(value){
  return String(value||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ');
}

function finiteAdminNumber(value,{min=-Infinity,max=Infinity,integer=false}={}){
  const parsed=Number(value);
  if(!Number.isFinite(parsed)||parsed<min||parsed>max) return null;
  if(integer&&!Number.isInteger(parsed)) return null;
  return parsed;
}

function validMoneyValue(value,max=1_000_000){
  return finiteAdminNumber(value,{min:0,max});
}

function distanceKmBetween(a,b){
  const lat1=Number(a?.latitude),lng1=Number(a?.longitude);
  const lat2=Number(b?.latitude),lng2=Number(b?.longitude);
  if(![lat1,lng1,lat2,lng2].every(Number.isFinite)) return null;
  const toRad=v=>v*Math.PI/180;
  const R=6371;
  const dLat=toRad(lat2-lat1),dLng=toRad(lng2-lng1);
  const q=Math.sin(dLat/2)**2+
    Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));
}

function deliveryFeeFromSettings(address){
  const mode=settings.deliveryPricingMode||'fixed';
  if(mode==='fixed') return {supported:true,fee:Number(settings.deliveryFee||0),mode};

  if(mode==='neighborhood'){
    const zones=Array.isArray(settings.deliveryZones)?settings.deliveryZones:[];
    const neighborhood=normalizePriceKey(address?.neighborhood);
    const zone=zones.find(z=>normalizePriceKey(z.neighborhood)===neighborhood);
    if(zone) return {supported:true,fee:Number(zone.fee||0),mode,zone:zone.neighborhood};
    if(settings.restrictDeliveryZones===true&&zones.length) return {supported:false,fee:0,mode};
    return {supported:true,fee:Number(settings.deliveryNeighborhoodFallbackFee??settings.deliveryFee??0),mode,zone:null};
  }

  if(mode==='km'){
    const distance=distanceKmBetween(settings.storeLocation,address?.location);
    if(distance==null) return {supported:false,fee:0,mode,distanceKm:null};
    const bands=(Array.isArray(settings.deliveryKmBands)?settings.deliveryKmBands:[])
      .slice().sort((a,b)=>Number(a.maxKm||0)-Number(b.maxKm||0));
    const band=bands.find(b=>distance<=Number(b.maxKm||0));
    if(band) return {supported:true,fee:Number(band.fee||0),mode,distanceKm:distance,maxKm:Number(band.maxKm||0)};
    if(settings.restrictDeliveryKm===true&&bands.length) return {supported:false,fee:0,mode,distanceKm:distance};
    const last=bands.at(-1);
    return {supported:true,fee:last?Number(last.fee||0):Number(settings.deliveryFee||0),mode,distanceKm:distance};
  }

  return {supported:true,fee:Number(settings.deliveryFee||0),mode:'fixed'};
}

function expectedDeliveryFee(order){
  if(order.fulfillment==='pickup') return 0;
  const snapshotFee=Number(order.deliveryPricing?.fee);
  if(Number.isFinite(snapshotFee)&&snapshotFee>=0) return snapshotFee;
  return deliveryFeeFromSettings(order.address).fee;
}

function applyOrderPromotion(base,item){
  if(!item?.promotion) return {ok:true,value:base};

  // A promoção gravada no pedido é um snapshot histórico. Uma promoção pode
  // expirar, ser editada ou excluída depois da compra sem invalidar a comanda.
  const snapshot=item.promotion||{};
  const promo=promotions.find(p=>p.id===snapshot.id);
  const sameCurrent=promo &&
    promo.discountType===snapshot.discountType &&
    Math.abs(Number(promo.discountValue||0)-Number(snapshot.discountValue||0))<0.009;

  const historicalBase=Number(snapshot.originalBasePrice);
  if(Number.isFinite(historicalBase)&&historicalBase>=0){
    const discounted=snapshot.discountType==='percentage'
      ?Math.max(0,historicalBase-(historicalBase*Number(snapshot.discountValue||0)/100))
      :Math.max(0,historicalBase-Number(snapshot.discountValue||0));
    return {ok:true,value:discounted,historical:!sameCurrent};
  }

  if(!sameCurrent){
    // Pedidos antigos não tinham originalBasePrice. Neles, o preço final
    // armazenado no próprio pedido é a referência histórica segura para
    // impressão e auditoria visual.
    return {ok:true,value:Number(item.unitPrice||0),historical:true,useStoredUnit:true};
  }

  const discounted=promo.discountType==='percentage'
    ?Math.max(0,base-(base*Number(promo.discountValue||0)/100))
    :Math.max(0,base-Number(promo.discountValue||0));
  return {ok:true,value:discounted};
}

function expectedItemUnitPrice(item){
  const first=products.find(p=>p.id===item.productId);
  if(!first) return {ok:false,reason:'Produto não existe mais no cardápio.',value:0};

  let base=Number(first.price||0);
  const sizeName=item.size?.name||'';
  if(first.sizes?.length){
    const size=first.sizes.find(s=>normalizePriceKey(s.name)===normalizePriceKey(sizeName));
    if(!size) return {ok:false,reason:`Tamanho inválido em ${item.name}.`,value:0};
    base=Number(size.price||0);
  }

  const ids=Array.isArray(item.flavorProductIds)?item.flavorProductIds:[item.productId];
  if(ids.length>1&&sizeName){
    for(const id of ids.slice(1)){
      const flavor=products.find(p=>p.id===id);
      if(!flavor) return {ok:false,reason:'Um dos sabores não existe mais no cardápio.',value:0};
      const size=flavor.sizes?.find(s=>normalizePriceKey(s.name)===normalizePriceKey(sizeName));
      if(!size) return {ok:false,reason:`Segundo sabor indisponível no tamanho ${sizeName}.`,value:0};
      base=Math.max(base,Number(size.price||0));
    }
  }

  const promoted=applyOrderPromotion(base,item);
  if(!promoted.ok) return promoted;
  if(promoted.useStoredUnit) return {ok:true,value:Number(item.unitPrice||0),historical:true};
  base=promoted.value;

  let extras=0;
  for(const extra of (item.extras||[])){
    const catalogExtra=first.extras?.find(x=>normalizePriceKey(x.name)===normalizePriceKey(extra.name));
    if(!catalogExtra) return {ok:false,reason:`Adicional inválido em ${item.name}: ${extra.name}.`,value:0};
    extras+=Number(catalogExtra.price||0);
  }

  return {ok:true,value:base+extras};
}

function verifyOrderPricing(order){
  const issues=[];
  let expectedSubtotal=0;

  for(const item of (order.items||[])){
    const result=expectedItemUnitPrice(item);
    if(!result.ok){
      issues.push(result.reason);
      continue;
    }
    const qty=Math.max(1,Number(item.qty||1));
    expectedSubtotal+=result.value*qty;
    if(Math.abs(result.value-Number(item.unitPrice||0))>0.009){
      issues.push(`Preço divergente em ${item.name}: pedido ${money(item.unitPrice)}, cardápio ${money(result.value)}.`);
    }
  }

  if(Math.abs(expectedSubtotal-Number(order.subtotal||0))>0.009){
    issues.push(`Subtotal divergente: pedido ${money(order.subtotal)}, calculado ${money(expectedSubtotal)}.`);
  }

  const expectedFee=expectedDeliveryFee(order);
  if(Math.abs(expectedFee-Number(order.deliveryFee||0))>0.009){
    issues.push(`Taxa de entrega divergente: pedido ${money(order.deliveryFee)}, atual ${money(expectedFee)}.`);
  }

  let expectedDiscount=0;
  if(order.coupon){
    const snapshotAmount=Number(order.coupon.amount);
    if(Number.isFinite(snapshotAmount)&&snapshotAmount>=0){
      expectedDiscount=Math.max(0,Math.min(expectedSubtotal,snapshotAmount));
    }else{
      // Compatibilidade com pedidos antigos que não gravavam o valor final do
      // cupom. Para pedidos novos, o snapshot é a fonte histórica.
      const coupon=coupons.find(cp=>cp.id===order.coupon.id||cp.code===order.coupon.code);
      if(coupon){
        expectedDiscount=coupon.type==='percentage'
          ?expectedSubtotal*Number(coupon.value||0)/100
          :Number(coupon.value||0);
        if(Number(coupon.maxDiscount||0)>0) expectedDiscount=Math.min(expectedDiscount,Number(coupon.maxDiscount));
        expectedDiscount=Math.max(0,Math.min(expectedSubtotal,expectedDiscount));
      }else{
        expectedDiscount=Number(order.discount||0);
      }
    }
  }
  if(Math.abs(expectedDiscount-Number(order.discount||0))>0.009){
    issues.push(`Desconto divergente: pedido ${money(order.discount)}, calculado ${money(expectedDiscount)}.`);
  }

  const expectedTotal=Math.max(0,expectedSubtotal-expectedDiscount+expectedFee);
  if(Math.abs(expectedTotal-Number(order.total||0))>0.009){
    issues.push(`Total divergente: pedido ${money(order.total)}, calculado ${money(expectedTotal)}.`);
  }

  return {valid:issues.length===0,issues,expectedSubtotal,expectedDiscount,expectedFee,expectedTotal};
}

function renderStats(){
  const timezone=settings.timezone||'America/Porto_Velho';
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:timezone}).format(new Date());
  const dateInBusinessDay=ts=>{
    const d=ts?.toDate?.();
    return d&&new Intl.DateTimeFormat('en-CA',{timeZone:timezone}).format(d)===today;
  };
  $('#statPending').textContent=orders.filter(o=>o.status==='pending').length;
  $('#statAccepted').textContent=orders.filter(o=>o.status==='accepted').length;
  $('#statPreparing').textContent=orders.filter(o=>o.status==='preparing').length;
  const todayOrders=orders.filter(o=>dateInBusinessDay(o.createdAt));
  const completedToday=orders.filter(o=>o.status==='completed'&&dateInBusinessDay(o.completedAt||o.createdAt));
  $('#statToday').textContent=todayOrders.length;
  $('#statRevenueToday').textContent=money(completedToday.reduce((sum,o)=>sum+Number(o.total||0),0));
  const p=orders.filter(o=>o.status==='pending').length;
  $('#pendingBadge').textContent=p;
  $('#pendingBadge').classList.toggle('hidden',p===0);
}

function quickTransition(order){
  const candidates={
    pending:{status:'accepted',label:'Aceitar'},
    accepted:{status:'preparing',label:'Iniciar preparo'},
    preparing:{status:'ready',label:'Marcar pronto'},
    ready:order.fulfillment==='pickup'
      ?{status:'completed',label:'Concluir retirada'}
      :{status:'out_for_delivery',label:'Saiu p/ entrega'},
    out_for_delivery:{status:'completed',label:'Concluir entrega'}
  };
  const next=candidates[order.status];
  if(!next) return null;
  return allowedStatusTargets(order).includes(next.status)?next:null;
}

async function updateOrderStatus(order,status){
  if(!order||status===order.status) return;
  if(status==='accepted'){
    const pricing=verifyOrderPricing(order);
    if(!pricing.valid){
      const proceed=await confirmAction('Os valores deste pedido divergem do cardápio atual. Deseja aceitar mesmo assim?\n\n'+pricing.issues.join('\n'),{title:'Valores divergentes',confirmText:'Aceitar mesmo assim',danger:true});
      if(!proceed) return;
    }
  }
  if(status==='completed'){
    try{
      await cashOperation('completeOrder',{orderId:order.id});
      if(hasPermission('cashView')) await loadCashSessions();
    }catch(err){
      console.error('Falha ao concluir pedido com vínculo ao caixa:',err);
      showToast(cashOperationMessage(err),'error',{duration:7000});
      err.handled=true;
      throw err;
    }
    return;
  }

  const patch={status,updatedAt:serverTimestamp()};
  if(status==='accepted') patch.acceptedAt=serverTimestamp();
  if(status==='cancelled') patch.cancelledAt=serverTimestamp();
  await updateDoc(doc(db,'orders',order.id),patch);
  if(status==='accepted'&&printConfig.autoPrint){
    await printOrder({...order,status:'accepted'},true);
  }
}

function renderOrders(){
  const f=$('#orderStatusFilter').value;
  const term=$('#orderSearch').value.trim().toLowerCase();
  const list=orders.filter(o=>{
    if(f==='active'&&['completed','cancelled'].includes(o.status)) return false;
    if(f!=='all'&&f!=='active'&&o.status!==f) return false;
    const itemText=(o.items||[]).map(item=>item.name||'').join(' ');
    const text=`${o.orderNumber} ${o.fulfillment||''} ${itemText}`.toLowerCase();
    return !term||text.includes(term);
  });

  $('#ordersList').innerHTML=list.length?list.map(o=>{
    const pricing=verifyOrderPricing(o);
    const quick=quickTransition(o);
    return `<article class="order-row order-row-modern" data-id="${o.id}">
      <button class="order-main-hit" data-open-order="${o.id}" type="button" aria-label="Abrir pedido #${o.orderNumber}">
        <span class="order-number">#${String(o.orderNumber||0).padStart(4,'0')}</span>
        <span class="order-meta"><strong>Pedido #${String(o.orderNumber||0).padStart(4,'0')}</strong><small>${o.fulfillment==='pickup'?'Retirada':'Entrega'} • ${formatDate(o.createdAt)}${pricing.valid?'':' • ⚠ valores divergentes'}</small></span>
        <span class="status-pill status-${o.status}">${statusLabels[o.status]||o.status}</span>
        <strong class="order-total">${money(o.total)}</strong>
      </button>
      <div class="order-row-actions">
        ${quick?`<button class="btn btn-primary quick-order-action" data-id="${o.id}" data-status="${quick.status}" type="button">${quick.label}</button>`:''}
        <button class="btn btn-secondary order-details-action" data-id="${o.id}" type="button">Detalhes</button>
      </div>
    </article>`;
  }).join(''):emptyStateHtml({icon:'clipboard-list',title:'Nenhum pedido encontrado',description:'Os pedidos aparecerão aqui assim que entrarem ou quando corresponderem aos filtros.'});

  $$('[data-open-order]').forEach(b=>b.onclick=()=>openOrder(b.dataset.openOrder));
  $$('.order-details-action').forEach(b=>b.onclick=()=>openOrder(b.dataset.id));
  $$('.quick-order-action').forEach(b=>b.onclick=async()=>{
    b.disabled=true;
    try{
      const order=orders.find(o=>o.id===b.dataset.id);
      await updateOrderStatus(order,b.dataset.status);
    }catch(err){
      console.error(err);
      if(!err?.handled) showToast('Não foi possível atualizar o pedido.','error');
    }finally{
      b.disabled=false;
    }
  });
}
$('#orderStatusFilter').onchange=renderOrders;
$('#orderSearch').oninput=renderOrders;

function allowedStatusTargets(order){
  const current=order.status;
  const targets=[current];

  if(current==='pending'&&hasPermission('ordersAccept')) targets.push('accepted');
  if(current==='pending'&&hasPermission('ordersCancel')) targets.push('cancelled');
  if(current==='accepted'&&hasPermission('ordersPrepare')) targets.push('preparing');
  if(current==='accepted'&&hasPermission('ordersCancel')) targets.push('cancelled');
  if(current==='preparing'&&hasPermission('ordersPrepare')) targets.push('ready');
  if(current==='ready'&&order.fulfillment==='pickup'&&hasPermission('ordersComplete')) targets.push('completed');
  if(current==='ready'&&order.fulfillment!=='pickup'&&hasPermission('ordersDispatch')) targets.push('out_for_delivery');
  if(current==='out_for_delivery'&&hasPermission('ordersComplete')) targets.push('completed');

  if(hasPermission('ordersCancel')&&!['completed','cancelled'].includes(current)&&!targets.includes('cancelled')){
    targets.push('cancelled');
  }
  return [...new Set(targets)];
}
function orderAddressText(o){
  if(o.fulfillment==='pickup') return 'Retirada no local';

  const a=o.address||{};
  if(a.street){
    return `${a.street}, ${a.number||''} — ${a.neighborhood||''}${a.complement?` • ${a.complement}`:''}${a.reference?` • Ref.: ${a.reference}`:''}${a.city?` • ${a.city}/${a.state||''}`:''}`;
  }

  return `${o.customer?.address||''}, ${o.customer?.number||''} — ${o.customer?.neighborhood||''}`;
}

function deliveryPricingText(order){
  if(order.fulfillment==='pickup') return 'Retirada no local';
  const snap=order.deliveryPricing||{};
  if(snap.mode==='km'&&Number.isFinite(Number(snap.distanceKm))){
    return `Frete por km • ${Number(snap.distanceKm).toFixed(1).replace('.',',')} km • ${money(order.deliveryFee)}`;
  }
  if(snap.mode==='neighborhood'){
    return `Frete por bairro${snap.zone?` • ${snap.zone}`:''} • ${money(order.deliveryFee)}`;
  }
  return `Frete fixo • ${money(order.deliveryFee)}`;
}

function openOrder(id){
  const o=orders.find(x=>x.id===id);
  if(!o) return;

  const address=orderAddressText(o);
  const changeInfo=o.payment?.needsChange
    ?`<p><strong>Troco para:</strong> ${money(o.payment.changeFor)}</p><p><strong>Levar de troco:</strong> ${money(o.payment.changeAmount)}</p>`
    :'';

  const canAccept=hasPermission('ordersAccept');
  const acceptBanner=o.status==='pending'&&canAccept
    ?`<div class="order-accept-banner"><div><strong>Este pedido aguarda confirmação</strong><div class="muted">Confirme antes de enviar para produção.</div></div><div class="data-actions"><button class="btn btn-primary quick-status" data-status="accepted">Aceitar pedido</button><button class="btn btn-danger quick-status" data-status="cancelled">Recusar</button></div></div>`
    :'';

  const targets=allowedStatusTargets(o);

  $('#orderDetail').innerHTML=`
    <div class="order-detail-head">
      <div><span class="eyebrow">PEDIDO</span><h2>#${String(o.orderNumber||0).padStart(4,'0')}</h2><p class="muted">${formatDate(o.createdAt)}</p></div>
      <span class="status-pill status-${o.status}">${statusLabels[o.status]||o.status}</span>
    </div>

    ${(()=>{
      const pricing=verifyOrderPricing(o);
      return pricing.valid?'':`<div class="alert alert-error"><strong>⚠ Valores divergentes do cardápio.</strong><br>${pricing.issues.map(esc).join('<br>')}</div>`;
    })()}
    ${acceptBanner}

    <div class="order-detail-grid">
      <div class="detail-card">
        <h3>Cliente</h3>
        <p><strong>${esc(o.customer?.name||'')}</strong></p>
        <p>${esc(o.customer?.phone||'')}</p>
        <p>${esc(o.customer?.email||'')}</p>
        <p>${esc(address)}</p>
      </div>

      <div class="detail-card">
        <h3>Pagamento</h3>
        <p><strong>${esc(o.payment?.method||'')}</strong></p>
        ${changeInfo}
        <p>${esc(deliveryPricingText(o))}</p>
        <p>Total: <strong>${money(o.total)}</strong></p>
      </div>
    </div>

    <div class="order-items-detail">
      ${(o.items||[]).map(i=>`<div class="order-line"><div><strong>${i.qty}× ${esc(i.name)}</strong><small class="muted" style="display:block">${[i.size?.name,...(i.extras||[]).map(e=>e.name)].filter(Boolean).map(esc).join(' • ')}${i.note?` • Obs.: ${esc(i.note)}`:''}</small></div><strong>${money(Number(i.unitPrice)*Number(i.qty))}</strong></div>`).join('')}
      <div class="order-line"><span>Subtotal</span><strong>${money(o.subtotal)}</strong></div>
      ${Number(o.discount||0)>0?`<div class="order-line"><span>Desconto${o.coupon?.code?` (${esc(o.coupon.code)})`:''}</span><strong>- ${money(o.discount)}</strong></div>`:''}
      <div class="order-line"><span>Entrega</span><strong>${money(o.deliveryFee)}</strong></div>
      <div class="order-line"><strong>Total</strong><strong>${money(o.total)}</strong></div>
    </div>

    ${o.note?`<div class="detail-card"><h3>Observações</h3><p>${esc(o.note)}</p></div>`:''}

    <h3>Andamento do pedido</h3>
    <div class="status-actions">
      ${targets.map(k=>`<button class="btn ${k===o.status?'btn-primary':'btn-secondary'} status-change" data-status="${k}" ${k===o.status?'disabled':''}>${statusLabels[k]||k}</button>`).join('')}
    </div>

    <div class="section-actions" style="margin-top:16px">
      <button class="btn btn-secondary icon-button-label" id="printOrderBtn" type="button">${iconHtml('printer')}<span>Imprimir comanda</span></button>
    </div>
  `;

  async function changeStatus(status){
    try{
      await updateOrderStatus(o,status);
      $('#orderDialog').close();
    }catch(err){
      console.error(err);
      if(!err?.handled) showToast('Não foi possível atualizar o pedido.','error');
    }
  }

  $$('.quick-status').forEach(b=>b.onclick=()=>changeStatus(b.dataset.status));
  $$('.status-change').forEach(b=>b.onclick=()=>changeStatus(b.dataset.status));
  $('#printOrderBtn').onclick=()=>printOrder(o,false);
  $('#orderDialog').showModal();
}

$('#closeOrderDialog').onclick=()=>$('#orderDialog').close();

function loadPrintSettingsUI(){
  if(!$('#localAutoPrint')) return;
  $('#localAutoPrint').checked=printConfig.autoPrint;
  $('#localPrintPending').checked=printConfig.printPending;
  const model=document.querySelector(`input[name="printModel"][value="${printConfig.model}"]`);
  if(model) model.checked=true;
  if($('#cashierAutoAccept')) $('#cashierAutoAccept').checked=!!settings.autoAcceptOrders;
}

function savePrintSettings(){
  printConfig={
    ...printConfig,
    autoPrint:$('#localAutoPrint')?.checked===true,
    printPending:$('#localPrintPending')?.checked===true,
    model:document.querySelector('input[name="printModel"]:checked')?.value||'thermal80'
  };

  localStorage.removeItem('deliveryPrinter');
  localStorage.setItem('deliveryAutoPrint',printConfig.autoPrint?'1':'0');
  localStorage.setItem('deliveryPrintPending',printConfig.printPending?'1':'0');
  localStorage.setItem('deliveryPrintModel',printConfig.model);
}

function versionAtLeast(current,minimum){
  const a=String(current||'0').split('.').map(x=>Number(x)||0);
  const b=String(minimum||'0').split('.').map(x=>Number(x)||0);
  for(let i=0;i<Math.max(a.length,b.length);i++){
    const left=a[i]||0,right=b[i]||0;
    if(left>right) return true;
    if(left<right) return false;
  }
  return true;
}

function validAgentVersion(value){
  return /^\d+\.\d+\.\d+$/.test(String(value||''));
}

async function loadPrintAgentReleaseInfo(force=false){
  if(printAgentReleaseLoaded&&!force) return printAgentReleaseInfo;
  if(printAgentReleasePromise&&!force) return printAgentReleasePromise;

  printAgentReleasePromise=(async()=>{
    try{
      const response=await fetch(
        PRINT_AGENT_VERSION_MANIFEST+(force?'?t='+Date.now():''),
        {cache:'no-store'}
      );
      if(!response.ok) throw new Error('version-manifest');
      const data=await response.json();

      const latest=validAgentVersion(data.latestVersion)
        ?String(data.latestVersion)
        :FALLBACK_PRINT_AGENT_VERSION;
      const minimum=validAgentVersion(data.minimumVersion)
        ?String(data.minimumVersion)
        :latest;

      printAgentReleaseInfo={
        latestVersion:latest,
        minimumVersion:minimum,
        downloadUrl:String(data.downloadUrl||printAgentReleaseInfo.downloadUrl),
        publishedAt:String(data.publishedAt||''),
        message:String(data.message||'Há uma nova versão do Print Agent disponível.')
      };
      printAgentReleaseLoaded=true;
    }catch(err){
      console.warn('Não foi possível consultar a versão publicada do Print Agent.',err);
    }finally{
      printAgentReleasePromise=null;
    }

    const latestHost=$('#printerAgentLatestVersion');
    if(latestHost) latestHost.textContent=printAgentReleaseInfo.latestVersion;

    const download=$('#downloadPrintAgentBtn');
    if(download&&printAgentReleaseInfo.downloadUrl){
      download.href=printAgentReleaseInfo.downloadUrl;
    }

    return printAgentReleaseInfo;
  })();

  return printAgentReleasePromise;
}

function closePrintAgentUpdateDialog(){
  const dialog=$('#printAgentUpdateDialog');
  if(dialog?.open) dialog.close();
}

function showPrintAgentUpdateDialog(agentVersion,releaseInfo,required){
  const dialog=$('#printAgentUpdateDialog');
  if(!dialog||dialog.open) return;

  $('#printAgentUpdateCurrentVersion').textContent=agentVersion||'Versão antiga';
  $('#printAgentUpdateLatestVersion').textContent=releaseInfo.latestVersion;
  $('#printAgentUpdateMessage').textContent=releaseInfo.message||
    'Existe uma versão mais recente do Print Agent disponível.';
  $('#printAgentUpdateRequiredNote').classList.toggle('hidden',!required);

  dialog.showModal();
}

async function detectPrintAgentUpdate({forceManifest=false,showPrompt=true}={}){
  const releaseInfo=await loadPrintAgentReleaseInfo(forceManifest);

  try{
    const response=await fetch(PRINT_AGENT+'/printers',{cache:'no-store'});
    if(!response.ok) throw new Error('agent');
    const data=await response.json();
    const agentVersion=String(data.version||data.agentVersion||'0.0.0');

    if(!validAgentVersion(agentVersion)) return {connected:true,outdated:true,required:true,agentVersion};

    const outdated=!versionAtLeast(agentVersion,releaseInfo.latestVersion);
    const required=!versionAtLeast(agentVersion,releaseInfo.minimumVersion);

    if(
      outdated &&
      showPrompt &&
      promptedPrintAgentVersion!==releaseInfo.latestVersion
    ){
      promptedPrintAgentVersion=releaseInfo.latestVersion;
      showPrintAgentUpdateDialog(agentVersion,releaseInfo,required);
    }

    return {connected:true,outdated,required,agentVersion};
  }catch{
    return {connected:false,outdated:false,required:false,agentVersion:''};
  }
}

function startPrintAgentUpdateWatch(){
  if(printAgentUpdateTimer) clearInterval(printAgentUpdateTimer);
  printAgentUpdateTimer=setInterval(()=>{
    if(document.visibilityState==='visible'){
      detectPrintAgentUpdate({forceManifest:true,showPrompt:true});
    }
  },PRINT_AGENT_UPDATE_INTERVAL_MS);
}

async function checkPrintAgent(){
  const status=$('#printerAgentStatus');
  if(!status) return false;

  const releaseInfo=await loadPrintAgentReleaseInfo();

  try{
    const response=await fetch(PRINT_AGENT+'/printers',{cache:'no-store'});
    if(!response.ok) throw new Error('agent');

    const data=await response.json();
    const printers=Array.isArray(data.printers)?data.printers:[];
    const supportsAgentPrinter=Object.prototype.hasOwnProperty.call(data,'selectedPrinter');
    const selectedPrinter=String(data.selectedPrinter||'').trim();
    const agentVersion=String(data.version||data.agentVersion||'0.0.0');

    const requiredVersion=releaseInfo.minimumVersion||FALLBACK_PRINT_AGENT_VERSION;
    const latestVersion=releaseInfo.latestVersion||requiredVersion;
    const outdated=!versionAtLeast(agentVersion,latestVersion);
    const required=!versionAtLeast(agentVersion,requiredVersion);

    if(!supportsAgentPrinter||required){
      status.textContent='● Print Agent desatualizado';
      status.classList.add('off');
      status.classList.remove('ok');
      if($('#printerAgentInfoState')) $('#printerAgentInfoState').textContent='Atualização obrigatória • versão '+requiredVersion+' ou superior';
      if($('#printerAgentVersion')) $('#printerAgentVersion').textContent=agentVersion==='0.0.0'?'Versão antiga':agentVersion;
      if($('#printerAgentLatestVersion')) $('#printerAgentLatestVersion').textContent=latestVersion;
      return false;
    }

    status.textContent=outdated?'● Print Agent com atualização disponível':'● Print Agent conectado';
    status.classList.toggle('ok',!outdated);
    status.classList.toggle('off',outdated);
    if($('#printerAgentInfoState')){
      $('#printerAgentInfoState').textContent=outdated
        ?'Atualização recomendada • versão '+latestVersion
        :selectedPrinter
          ?'Pronto • '+selectedPrinter
          :printers.length
            ?'Escolha uma impressora no Print Agent'
            :'Nenhuma impressora instalada';
    }
    if($('#printerAgentVersion')) $('#printerAgentVersion').textContent=data.version||data.agentVersion||'Conectado';
    if($('#printerAgentLatestVersion')) $('#printerAgentLatestVersion').textContent=latestVersion;
    return true;
  }catch(err){
    status.textContent='● Print Agent desconectado';
    status.classList.add('off');
    status.classList.remove('ok');
    if($('#printerAgentInfoState')) $('#printerAgentInfoState').textContent='Sem conexão';
    if($('#printerAgentVersion')) $('#printerAgentVersion').textContent='—';
    if($('#printerAgentLatestVersion')) $('#printerAgentLatestVersion').textContent=releaseInfo.latestVersion||'—';
    return false;
  }
}

function printModelWidth(){
  return {
    thermal80:42,
    thermal58:32,
    a4:64,
    compact:32,
    label:28
  }[printConfig.model]||42;
}

function centerText(text,width=printModelWidth()){
  text=String(text||'');
  if(text.length>=width) return text;
  const left=Math.floor((width-text.length)/2);
  return ' '.repeat(left)+text;
}

function receiptText(o){
  const width=printModelWidth();
  const divider='-'.repeat(width);
  const lines=[];
  const model=printConfig.model||'thermal80';

  if(model==='label'){
    lines.push(centerText(settings.storeName||'PIZZARIA',width));
    lines.push(centerText('PEDIDO #'+String(o.orderNumber||0).padStart(4,'0'),width));
    lines.push(divider);
    lines.push((o.customer?.name||'CLIENTE').slice(0,width));
    for(const item of (o.items||[])){
      lines.push((String(item.qty)+'x '+String(item.name||'')).slice(0,width));
      if(item.size?.name) lines.push(('  '+item.size.name).slice(0,width));
    }
    lines.push(divider);
    lines.push(centerText('TOTAL '+money(o.total),width));
    lines.push('');
    return lines.join('\n');
  }

  if(model!=='compact') lines.push(centerText(settings.storeName||'PIZZARIA',width));
  if(model!=='compact'&&settings.phone) lines.push(centerText(settings.phone,width));
  lines.push(divider);
  lines.push(centerText('PEDIDO #'+String(o.orderNumber||0).padStart(4,'0'),width));
  const pricing=verifyOrderPricing(o);
  if(!pricing.valid) lines.push(centerText('*** REVISAR VALORES ***',width));
  lines.push(formatDate(o.createdAt));
  lines.push('STATUS: '+(statusLabels[o.status]||o.status));
  lines.push(divider);
  lines.push('CLIENTE: '+(o.customer?.name||''));
  lines.push('FONE: '+(o.customer?.phone||''));
  lines.push(o.fulfillment==='pickup'?'RETIRADA NO LOCAL':'ENTREGA: '+orderAddressText(o));

  if(o.fulfillment!=='pickup'&&model!=='compact'){
    const deliverySnap=o.deliveryPricing||{};
    if(deliverySnap.mode==='km'&&Number.isFinite(Number(deliverySnap.distanceKm))){
      lines.push('FRETE: POR KM • '+Number(deliverySnap.distanceKm).toFixed(1).replace('.',',')+' KM');
    }else if(deliverySnap.mode==='neighborhood'){
      lines.push('FRETE: POR BAIRRO'+(deliverySnap.zone?' • '+deliverySnap.zone:''));
    }else{
      lines.push('FRETE: VALOR FIXO');
    }
  }

  lines.push(divider);
  lines.push('ITENS');
  for(const item of (o.items||[])){
    lines.push(String(item.qty)+'x '+String(item.name||''));
    if(item.size?.name) lines.push('  Tamanho: '+item.size.name);
    if(model!=='compact'&&item.extras?.length) lines.push('  Adic.: '+item.extras.map(x=>x.name).join(', '));
    if(item.note) lines.push('  OBS: '+item.note);
    lines.push('  '+money(Number(item.unitPrice||0)*Number(item.qty||0)));
  }

  lines.push(divider);
  lines.push('Subtotal: '+money(o.subtotal));
  if(Number(o.discount||0)>0){
    lines.push('Desconto: -'+money(o.discount));
    if(o.coupon?.code) lines.push('CUPOM: '+o.coupon.code);
  }
  lines.push('Entrega:  '+money(o.deliveryFee));
  lines.push('TOTAL:    '+money(o.total));
  lines.push(divider);
  lines.push('PAGAMENTO: '+(o.payment?.method||''));

  if(o.payment?.needsChange){
    lines.push('TROCO PARA: '+money(o.payment.changeFor));
    lines.push('LEVAR TROCO: '+money(o.payment.changeAmount));
  }

  if(o.note){
    lines.push(divider);
    lines.push('OBSERVACOES:');
    lines.push(o.note);
  }

  lines.push(divider);
  if(model!=='compact') lines.push(centerText('*** FIM DA COMANDA ***',width));
  lines.push('');
  lines.push('');
  return lines.join('\n');
}

function printStoreLogoUrl(){
  const value=String(settings.storeLogo||'').trim();
  if(!value) return '';
  if(/^https:\/\//i.test(value)) return value;
  try{
    return new URL('../'+value.replace(/^\.?\//,'').replace(/^\//,''),location.href).href;
  }catch{
    return '';
  }
}

async function sendToPrintAgent(text){
  const payload={
    text,
    copies:1,
    model:printConfig.model,
    storeLogo:printStoreLogoUrl()
  };

  const response=await fetch(PRINT_AGENT+'/print',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  });

  if(!response.ok){
    const message=await response.text().catch(()=>'');
    throw new Error(message||'print-failed');
  }
}

async function printOrder(order,automatic=false){
  if(automatic&&order?.id&&printedOrderIds.has(order.id)) return true;

  const connected=await checkPrintAgent();

  if(connected){
    try{
      await sendToPrintAgent(receiptText(order));
      if(order?.id){
        printedOrderIds.add(order.id);
        sessionStorage.setItem('deliveryPrintedOrders',JSON.stringify([...printedOrderIds]));
      }
      return true;
    }catch(err){
      console.error('Falha no Print Agent:',err);
    }
  }

  if(automatic){
    showSystemAlert('Pedido recebido, mas a impressão automática não foi realizada. Abra “Impressão” e verifique a conexão e a impressora configurada no Print Agent.');
    return false;
  }

  window.open(`./print.html?id=${encodeURIComponent(order.id)}`,'_blank');
  return false;
}

$('#saveAutoAcceptBtn')?.addEventListener('click',async()=>{
  try{
    const value=$('#cashierAutoAccept').checked;
    await updateDoc(doc(db,'settings','store'),{
      autoAcceptOrders:value,
      updatedAt:serverTimestamp()
    });
    settings.autoAcceptOrders=value;
    showToast('Modo de confirmação atualizado.','success');
  }catch(err){
    console.error(err);
    showToast('Você não tem permissão para alterar o modo de confirmação.','error');
  }
});

$('#printAgentUpdateClose')?.addEventListener('click',closePrintAgentUpdateDialog);
$('#printAgentUpdateLater')?.addEventListener('click',closePrintAgentUpdateDialog);
$('#printAgentUpdateGo')?.addEventListener('click',()=>{
  closePrintAgentUpdateDialog();
  if(hasPermission('printingManage')){
    switchView('printing');
    setTimeout(()=>{
      $('#printerAgentStatus')?.scrollIntoView({behavior:'smooth',block:'center'});
    },80);
  }else{
    showToast('Solicite a um usuário com permissão de impressão para atualizar o Print Agent.','warning');
  }
});

$('#connectPrintAgentBtn')?.addEventListener('click',checkPrintAgent);

$('#savePrintSettingsBtn')?.addEventListener('click',()=>{
  savePrintSettings();
  checkPrintAgent();
  showToast('Configuração deste terminal salva.','success');
});

$$('input[name="printModel"]').forEach(input=>input.addEventListener('change',savePrintSettings));

$('#testPrintBtn')?.addEventListener('click',async()=>{
  savePrintSettings();
  try{
    const sample={
      orderNumber:1,
      status:'accepted',
      createdAt:{toDate:()=>new Date()},
      customer:{name:'Cliente de teste',phone:'(00) 00000-0000'},
      fulfillment:'pickup',
      items:[{qty:1,name:'Produto de teste',unitPrice:25,size:{name:'Grande'},extras:[]}],
      subtotal:25,
      discount:0,
      deliveryFee:0,
      total:25,
      payment:{method:'PIX na entrega'}
    };

    await checkPrintAgent();
    await sendToPrintAgent(receiptText(sample));
    showToast('Teste enviado ao Print Agent usando o modelo selecionado.','success');
  }catch(err){
    console.error(err);
    showToast('Não foi possível imprimir. Verifique se o Print Agent está aberto e se há uma impressora configurada nele.','error');
  }
});


/* ===== Perfis de acesso ===== */
function renderRoles(){
  const table=$('#rolesTable');
  if(!table||!isMaster()) return;
  const list=roles.filter(r=>r.id!=='master');
  table.innerHTML=list.length?list.map(r=>{
    const enabled=Object.values(r.permissions||{}).filter(Boolean).length;
    const usersInRole=users.filter(u=>u.role===r.id).length;
    return `<div class="data-row">
      <div class="data-main"><strong>${esc(r.name||r.id)}</strong><small>${enabled} permissão(ões) • ${usersInRole} usuário(s)${r.system?' • Perfil padrão':''}</small></div>
      <span class="status-pill ${r.active===false?'status-cancelled':'status-completed'}">${r.active===false?'Inativo':'Ativo'}</span>
      <div class="data-actions">
        <button class="btn btn-secondary edit-role" data-id="${r.id}" type="button">Editar</button>
        ${r.system?'':`<button class="btn btn-danger delete-role" data-id="${r.id}" type="button">Excluir</button>`}
      </div>
    </div>`;
  }).join(''):emptyStateHtml({icon:'shield-check',title:'Nenhum perfil personalizado',description:'Crie um perfil para definir exatamente o que cada funcionário pode acessar.'});

  $$('.edit-role').forEach(b=>b.onclick=()=>editRole(b.dataset.id));
  $$('.delete-role').forEach(b=>b.onclick=()=>deleteRole(b.dataset.id));
}

function renderPermissionEditor(selected={}){
  const host=$('#rolePermissionsEditor');
  if(!host) return;
  selected=withPermissionDependencies(selected);
  const groups={};
  for(const [key,group,label] of permissionDefinitions){
    (groups[group]??=[]).push([key,label]);
  }
  host.innerHTML=Object.entries(groups).map(([group,items])=>`
    <section class="permission-group">
      <h3>${esc(group)}</h3>
      ${items.map(([key,label])=>`<label class="permission-item"><input type="checkbox" data-permission="${key}" ${selected[key]?'checked':''}><span>${esc(label)}</span></label>`).join('')}
    </section>
  `).join('');

  $$('[data-permission]').forEach(input=>input.addEventListener('change',()=>{
    const required=permissionDependencies[input.dataset.permission];
    if(input.checked&&required){
      const dependency=$(`[data-permission="${required}"]`);
      if(dependency) dependency.checked=true;
    }
    if(!input.checked){
      for(const [permission,dependency] of Object.entries(permissionDependencies)){
        if(dependency===input.dataset.permission){
          const dependent=$(`[data-permission="${permission}"]`);
          if(dependent) dependent.checked=false;
        }
      }
    }
  }));
}

function editRole(id=null){
  if(!isMaster()) return;
  const role=roles.find(r=>r.id===id);
  $('#roleEditorTitle').textContent=role?'Editar perfil':'Novo perfil';
  $('#roleId').value=role?.id||'';
  $('#roleName').value=role?.name||'';
  renderPermissionEditor(role?.permissions||{});
  $('#roleEditorError').classList.add('hidden');
  $('#roleEditor').showModal();
}

$('#newRoleBtn')?.addEventListener('click',()=>editRole());

$('#roleEditorForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  if(!isMaster()) return;
  const id=$('#roleId').value;
  const name=$('#roleName').value.trim();
  if(!name){
    $('#roleEditorError').textContent='Informe o nome do perfil.';
    $('#roleEditorError').classList.remove('hidden');
    return;
  }
  let permissions={};
  $$('[data-permission]').forEach(input=>permissions[input.dataset.permission]=input.checked);
  permissions=withPermissionDependencies(permissions);
  try{
    const roleId=id||('role-'+crypto.randomUUID().replace(/-/g,'').slice(0,12));
    await staffRoleAdminAction('save',{roleId,name,permissions,active:true});
    $('#roleEditor').close();
    await loadRoles();
    await loadUsers();
  }catch(err){
    console.error(err);
    $('#roleEditorError').textContent='Não foi possível salvar o perfil.';
    $('#roleEditorError').classList.remove('hidden');
  }
});

async function deleteRole(id){
  if(!isMaster()) return;
  if(users.some(u=>u.role===id)) return showToast('Este perfil está sendo usado por um ou mais usuários. Troque o perfil desses usuários antes de excluir.','warning');
  const role=roles.find(r=>r.id===id);
  if(!role||role.system) return;
  if(!await confirmAction(`Excluir o perfil “${role.name}”?`,{title:'Excluir perfil',confirmText:'Excluir',danger:true})) return;
  try{
    await staffRoleAdminAction('delete',{roleId:id});
    await loadRoles();
  }catch(err){
    console.error(err);
    const code=String(err?.code||'');
    if(code.includes('role_in_use')) showToast('Este perfil ainda está associado a um usuário.','warning');
    else if(code.includes('system_role')) showToast('Perfis padrão não podem ser excluídos.','warning');
    else showToast('Não foi possível excluir o perfil.','error');
  }
}

/* ===== Promoções ===== */
async function loadPromotions(){
  try{
    const snap=await getDocs(collection(db,'promotions'));
    promotions=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  }catch(err){
    console.warn('Promoções indisponíveis.',err);
    promotions=[];
  }
  renderPromotions();
  if(products.length) renderProducts();
}

function promotionTargetLabel(p){
  if(p.targetType==='all') return 'Todo o cardápio';
  if(p.targetType==='category') return categories.find(c=>c.id===p.targetId)?.name||'Categoria';
  return products.find(x=>x.id===p.targetId)?.name||'Produto';
}

function renderPromotions(){
  const table=$('#promotionsTable');
  if(!table) return;
  table.innerHTML=promotions.length?promotions.map(p=>`
    <div class="data-row">
      <div class="data-main"><strong>${esc(p.name)}</strong><small>${esc(promotionTargetLabel(p))} • ${p.discountType==='percentage'?Number(p.discountValue||0)+'%':money(p.discountValue)} de desconto</small></div>
      <span class="status-pill ${p.active===false?'status-cancelled':'status-completed'}">${p.active===false?'Inativa':'Ativa'}</span>
      <div class="data-actions"><button class="btn btn-secondary edit-promotion" data-id="${p.id}" type="button">Editar</button><button class="btn btn-danger delete-promotion" data-id="${p.id}" type="button">Excluir</button></div>
    </div>
  `).join(''):emptyStateHtml({icon:'badge-percent',title:'Nenhuma promoção cadastrada',description:'Crie uma promoção para destacar ofertas do cardápio.'});
  $$('.edit-promotion').forEach(b=>b.onclick=()=>editPromotion(b.dataset.id));
  $$('.delete-promotion').forEach(b=>b.onclick=()=>deletePromotion(b.dataset.id));
}

function refreshPromotionTarget(){
  const type=$('#promotionTargetType').value;
  const field=$('#promotionTargetField');
  field.classList.toggle('hidden',type==='all');
  const select=$('#promotionTargetId');
  if(type==='category') select.innerHTML=categories.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
  else if(type==='product') select.innerHTML=products.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  else select.innerHTML='';
}
$('#promotionTargetType')?.addEventListener('change',refreshPromotionTarget);

function editPromotion(id=null,prefill={}){
  if(!hasPermission('promotionsManage')) return;
  const p=promotions.find(x=>x.id===id);
  const source=p||prefill||{};
  $('#promotionEditorTitle').textContent=p?'Editar promoção':'Nova promoção';
  $('#promotionId').value=p?.id||'';
  $('#promotionName').value=source.name||'';
  $('#promotionDescription').value=source.description||'';
  $('#promotionDiscountType').value=source.discountType||'percentage';
  $('#promotionDiscountValue').value=source.discountValue??'';
  $('#promotionTargetType').value=source.targetType||'all';
  refreshPromotionTarget();
  $('#promotionTargetId').value=source.targetId||'';
  $('#promotionStartsAt').value=source.startsAt||'';
  $('#promotionEndsAt').value=source.endsAt||'';
  $('#promotionActive').checked=source.active!==false;
  $('#promotionEditorError').classList.add('hidden');
  $('#promotionEditor').showModal();
}
$('#newPromotionBtn')?.addEventListener('click',()=>editPromotion());

$('#promotionEditorForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const id=$('#promotionId').value;
  const data={
    name:$('#promotionName').value.trim(),
    description:$('#promotionDescription').value.trim(),
    discountType:$('#promotionDiscountType').value,
    discountValue:Number($('#promotionDiscountValue').value||0),
    targetType:$('#promotionTargetType').value,
    targetId:$('#promotionTargetType').value==='all'?'':$('#promotionTargetId').value,
    startsAt:$('#promotionStartsAt').value,
    endsAt:$('#promotionEndsAt').value,
    active:$('#promotionActive').checked,
    updatedAt:serverTimestamp()
  };
  const discount=finiteAdminNumber(data.discountValue,{min:0.01,max:1_000_000});
  const targetRequired=data.targetType!=='all'&&!data.targetId;
  const percentageInvalid=data.discountType==='percentage'&&(discount==null||discount>100);
  const fixedInvalid=data.discountType==='fixed'&&discount==null;
  const invalidWindow=!!(data.startsAt&&data.endsAt&&data.startsAt>data.endsAt);
  if(!data.name||targetRequired||percentageInvalid||fixedInvalid||invalidWindow){
    $('#promotionEditorError').textContent=targetRequired
      ?'Escolha a categoria ou produto da promoção.'
      :invalidWindow
        ?'A data final da promoção não pode ser anterior à data inicial.'
        :'Informe um desconto válido. Porcentagens devem ficar entre 0,01% e 100%.';
    $('#promotionEditorError').classList.remove('hidden');
    return;
  }
  data.discountValue=discount;
  try{
    if(id) await updateDoc(doc(db,'promotions',id),data);
    else await addDoc(collection(db,'promotions'),{...data,createdAt:serverTimestamp()});
    $('#promotionEditor').close();
    await loadPromotions();
  }catch(err){
    console.error(err);
    $('#promotionEditorError').textContent='Não foi possível salvar a promoção.';
    $('#promotionEditorError').classList.remove('hidden');
  }
});

async function deletePromotion(id){
  if(!hasPermission('promotionsManage')) return;
  const p=promotions.find(x=>x.id===id);
  if(!await confirmAction(`Excluir a promoção “${p?.name||''}”?`,{title:'Excluir promoção',confirmText:'Excluir',danger:true})) return;
  await deleteDoc(doc(db,'promotions',id));
  await loadPromotions();
}

/* ===== Cupons ===== */
async function loadCoupons(){
  try{
    const snap=await getDocs(collection(db,'coupons'));
    coupons=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.code||'').localeCompare(b.code||''));
  }catch(err){
    console.warn('Cupons indisponíveis.',err);
    coupons=[];
  }
  renderCoupons();
}

function renderCoupons(){
  const table=$('#couponsTable');
  if(!table) return;
  table.innerHTML=coupons.length?coupons.map(cp=>`
    <div class="data-row">
      <div class="data-main"><strong>${esc(cp.code||cp.id)}</strong><small>${esc(cp.description||'')} • ${cp.type==='percentage'?Number(cp.value||0)+'%':money(cp.value)} de desconto</small></div>
      <span class="status-pill ${cp.active===false?'status-cancelled':'status-completed'}">${cp.active===false?'Inativo':'Ativo'}</span>
      <div class="data-actions"><button class="btn btn-secondary edit-coupon" data-id="${cp.id}" type="button">Editar</button><button class="btn btn-danger delete-coupon" data-id="${cp.id}" type="button">Excluir</button></div>
    </div>
  `).join(''):emptyStateHtml({icon:'ticket-percent',title:'Nenhum cupom cadastrado',description:'Os cupons criados para clientes aparecerão aqui.'});
  $$('.edit-coupon').forEach(b=>b.onclick=()=>editCoupon(b.dataset.id));
  $$('.delete-coupon').forEach(b=>b.onclick=()=>deleteCoupon(b.dataset.id));
}

function normalizeCouponCode(value){
  return String(value||'').trim().toUpperCase().replace(/\s+/g,'').replace(/[^A-Z0-9_-]/g,'');
}

function editCoupon(id=null){
  if(!hasPermission('couponsManage')) return;
  const cp=coupons.find(x=>x.id===id);
  $('#couponEditorTitle').textContent=cp?'Editar cupom':'Novo cupom';
  $('#couponId').value=cp?.id||'';
  $('#couponCode').value=cp?.code||'';
  $('#couponCode').disabled=!!cp;
  $('#couponDescription').value=cp?.description||'';
  $('#couponType').value=cp?.type||'percentage';
  $('#couponValue').value=cp?.value??'';
  $('#couponMinimumOrder').value=cp?.minimumOrder??0;
  $('#couponMaxDiscount').value=cp?.maxDiscount??0;
  $('#couponMinOrders').value=cp?.minOrders??0;
  $('#couponMinSpent').value=cp?.minSpent??0;
  $('#couponStartsAt').value=cp?.startsAt||'';
  $('#couponEndsAt').value=cp?.endsAt||'';
  $('#couponAutoReward').checked=!!cp?.autoReward;
  $('#couponActive').checked=cp?.active!==false;
  $('#couponEditorError').classList.add('hidden');
  $('#couponEditor').showModal();
}
$('#newCouponBtn')?.addEventListener('click',()=>editCoupon());

$('#couponEditorForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const existingId=$('#couponId').value;
  const code=normalizeCouponCode($('#couponCode').value);
  const data={
    code,
    description:$('#couponDescription').value.trim(),
    type:$('#couponType').value,
    value:Number($('#couponValue').value||0),
    minimumOrder:Number($('#couponMinimumOrder').value||0),
    maxDiscount:Number($('#couponMaxDiscount').value||0),
    minOrders:Number($('#couponMinOrders').value||0),
    minSpent:Number($('#couponMinSpent').value||0),
    startsAt:$('#couponStartsAt').value,
    endsAt:$('#couponEndsAt').value,
    autoReward:$('#couponAutoReward').checked,
    active:$('#couponActive').checked,
    updatedAt:serverTimestamp()
  };
  const couponValue=finiteAdminNumber(data.value,{min:0.01,max:1_000_000});
  const minimumOrder=validMoneyValue(data.minimumOrder);
  const maxDiscount=validMoneyValue(data.maxDiscount);
  const minOrders=finiteAdminNumber(data.minOrders,{min:0,max:100_000,integer:true});
  const minSpent=validMoneyValue(data.minSpent,10_000_000);
  const percentageInvalid=data.type==='percentage'&&(couponValue==null||couponValue>100);
  const fixedInvalid=data.type==='fixed'&&couponValue==null;
  const invalidWindow=!!(data.startsAt&&data.endsAt&&data.startsAt>data.endsAt);
  if(
    !code || percentageInvalid || fixedInvalid || invalidWindow ||
    minimumOrder==null || maxDiscount==null || minOrders==null || minSpent==null
  ){
    $('#couponEditorError').textContent=invalidWindow
      ?'A data final do cupom não pode ser anterior à data inicial.'
      :'Revise os valores do cupom. Porcentagens devem ficar entre 0,01% e 100% e os demais valores não podem ser negativos.';
    $('#couponEditorError').classList.remove('hidden');
    return;
  }
  data.value=couponValue;
  data.minimumOrder=minimumOrder;
  data.maxDiscount=maxDiscount;
  data.minOrders=minOrders;
  data.minSpent=minSpent;
  try{
    const ref=doc(db,'coupons',existingId||code);
    if(existingId) await updateDoc(ref,data);
    else await setDoc(ref,{...data,createdAt:serverTimestamp()});
    $('#couponEditor').close();
    await loadCoupons();
  }catch(err){
    console.error(err);
    $('#couponEditorError').textContent='Não foi possível salvar o cupom. Verifique se o código já existe.';
    $('#couponEditorError').classList.remove('hidden');
  }
});

async function deleteCoupon(id){
  if(!hasPermission('couponsManage')) return;
  const cp=coupons.find(x=>x.id===id);
  if(!await confirmAction(`Excluir o cupom “${cp?.code||id}”?`,{title:'Excluir cupom',confirmText:'Excluir',danger:true})) return;
  await deleteDoc(doc(db,'coupons',id));
  await loadCoupons();
}

/* ===== Caixa financeiro ===== */
async function loadCashSessions(){
  try{
    const [snap,stateSnap]=await Promise.all([
      getDocs(query(collection(db,'cashSessions'),orderBy('openedAt','desc'))),
      getDoc(doc(db,'cashState','current'))
    ]);
    cashSessions=snap.docs.map(d=>({id:d.id,...d.data()}));
    const currentId=stateSnap.exists()?String(stateSnap.data()?.sessionId||''):'';
    currentCashSession=currentId
      ?cashSessions.find(s=>s.id===currentId&&s.status==='open')||null
      :null;
    if(currentCashSession) await loadCashMovements(currentCashSession.id);
    else cashMovements=[];
  }catch(err){
    console.warn('Caixas indisponíveis.',err);
    cashSessions=[];
    cashMovements=[];
    currentCashSession=null;
  }
  renderCash();
}

async function loadCashMovements(sessionId){
  cashMovements=[];
  if(!sessionId) return;
  try{
    const snap=await getDocs(collection(db,'cashSessions',sessionId,'movements'));
    cashMovements=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>{
      const at=a.createdAt?.toMillis?.()||0;
      const bt=b.createdAt?.toMillis?.()||0;
      return bt-at;
    });
  }catch(err){
    console.warn('Movimentos do caixa indisponíveis.',err);
  }
}

function stopCashSessionListeners(){
  if(unsubscribeCashSession){
    unsubscribeCashSession();
    unsubscribeCashSession=null;
  }
  if(unsubscribeCashMovements){
    unsubscribeCashMovements();
    unsubscribeCashMovements=null;
  }
  cashLiveSessionId='';
}

function stopCashLedgerListeners(){
  if(unsubscribeCashState){
    unsubscribeCashState();
    unsubscribeCashState=null;
  }
  stopCashSessionListeners();
}

function attachCashSessionListeners(sessionId){
  if(!sessionId){
    const hadSession=!!currentCashSession;
    stopCashSessionListeners();
    currentCashSession=null;
    cashMovements=[];
    cashMovementRequestId='';
    cashMovementFingerprint='';
    if($('#cashMovementDialog')?.open) $('#cashMovementDialog').close();
    if($('#cashCloseDialog')?.open) $('#cashCloseDialog').close();
    renderCash();
    if(hadSession) showToast('O caixa foi fechado. O painel financeiro foi atualizado.','info');
    return;
  }
  if(cashLiveSessionId===sessionId&&unsubscribeCashSession&&unsubscribeCashMovements) return;

  stopCashSessionListeners();
  cashLiveSessionId=sessionId;

  unsubscribeCashSession=onSnapshot(doc(db,'cashSessions',sessionId),snap=>{
    if(!snap.exists()){
      currentCashSession=null;
      cashMovements=[];
      renderCash();
      return;
    }

    const session={id:snap.id,...snap.data()};
    const index=cashSessions.findIndex(x=>x.id===session.id);
    if(index>=0) cashSessions[index]=session;
    else cashSessions.unshift(session);

    if(session.status==='open'){
      currentCashSession=session;
    }else{
      currentCashSession=null;
      cashMovements=[];
    }
    renderCash();
  },err=>{
    console.warn('Falha ao acompanhar o caixa atual.',err);
  });

  unsubscribeCashMovements=onSnapshot(
    query(collection(db,'cashSessions',sessionId,'movements'),orderBy('createdAt','desc')),
    snap=>{
      cashMovements=snap.docs.map(d=>({id:d.id,...d.data()}));
      renderCash();
    },
    err=>console.warn('Falha ao acompanhar movimentos do caixa.',err)
  );
}

function listenCashLedger(){
  stopCashLedgerListeners();
  unsubscribeCashState=onSnapshot(doc(db,'cashState','current'),async snap=>{
    const sessionId=snap.exists()?String(snap.data()?.sessionId||''):'';
    try{
      await loadCashSessions();
    }catch(err){
      console.warn('Falha ao atualizar histórico do caixa.',err);
    }
    attachCashSessionListeners(sessionId);
  },err=>{
    console.warn('Falha ao acompanhar estado do caixa.',err);
  });
}

function businessDateFor(value=new Date()){
  let date=value;
  if(value?.toDate) date=value.toDate();
  else if(typeof value==='number') date=new Date(value);
  return new Intl.DateTimeFormat('en-CA',{timeZone:settings.timezone||'America/Porto_Velho'}).format(date);
}

function cashMoney(value){
  const parsed=Number(value);
  return Number.isFinite(parsed)&&parsed>=0?parsed:0;
}

function orderWithinCash(order,session){
  if(!session||order.status!=='completed') return false;
  const ts=order.completedAt?.toMillis?.()||0;
  const start=session.openedAt?.toMillis?.()||0;
  const end=session.closedAt?.toMillis?.()||Date.now();
  return !!ts&&!!start&&ts>=start&&ts<=end;
}

function cashSummary(session=currentCashSession){
  if(!session){
    return {count:0,gross:0,money:0,pix:0,debit:0,credit:0,other:0,supplies:0,withdrawals:0};
  }

  if(session.status==='closed'&&session.summary){
    return {
      count:Number(session.summary.count||0),
      gross:cashMoney(session.summary.gross),
      money:cashMoney(session.summary.money),
      pix:cashMoney(session.summary.pix),
      debit:cashMoney(session.summary.debit),
      credit:cashMoney(session.summary.credit),
      other:cashMoney(session.summary.other),
      supplies:cashMoney(session.summary.supplies),
      withdrawals:cashMoney(session.summary.withdrawals)
    };
  }

  if(Number(session.summaryVersion||0)>=2&&session.salesSummary){
    const sales=session.salesSummary||{};
    const movements=session.movementSummary||{};
    return {
      count:Number.isInteger(Number(sales.count))&&Number(sales.count)>=0?Number(sales.count):0,
      gross:cashMoney(sales.gross),
      money:cashMoney(sales.money),
      pix:cashMoney(sales.pix),
      debit:cashMoney(sales.debit),
      credit:cashMoney(sales.credit),
      other:cashMoney(sales.other),
      supplies:cashMoney(movements.supplies),
      withdrawals:cashMoney(movements.withdrawals)
    };
  }

  // Compatibilidade somente com sessões antigas criadas antes do livro
  // financeiro server-side. Usa intervalo de abertura/fechamento, nunca o dia
  // inteiro, para não alterar um caixa fechado com pedidos posteriores.
  const list=orders.filter(o=>orderWithinCash(o,session));
  const summary={count:list.length,gross:0,money:0,pix:0,debit:0,credit:0,other:0,supplies:0,withdrawals:0};
  for(const o of list){
    const value=cashMoney(o.total);
    summary.gross+=value;
    const method=String(o.payment?.method||'').toLowerCase();
    if(method.includes('dinheiro')) summary.money+=value;
    else if(method.includes('pix')) summary.pix+=value;
    else if(method.includes('débito')||method.includes('debito')) summary.debit+=value;
    else if(method.includes('crédito')||method.includes('credito')) summary.credit+=value;
    else summary.other+=value;
  }
  if(session.id===currentCashSession?.id){
    for(const movement of cashMovements){
      const value=cashMoney(movement.amount);
      if(movement.type==='supply') summary.supplies+=value;
      if(movement.type==='withdrawal') summary.withdrawals+=value;
    }
  }
  return summary;
}

function renderCash(){
  if(!$('#cashClosedState')) return;
  $('#cashClosedState').classList.toggle('hidden',!!currentCashSession);
  $('#cashOpenState').classList.toggle('hidden',!currentCashSession);
  const summary=cashSummary();

  $('#cashOrderCount').textContent=summary.count;
  $('#cashGrossTotal').textContent=money(summary.gross);
  $('#cashMoneyTotal').textContent=money(summary.money);
  $('#cashPixTotal').textContent=money(summary.pix);
  $('#cashDebitTotal').textContent=money(summary.debit);
  $('#cashCreditTotal').textContent=money(summary.credit);

  if(currentCashSession){
    const expected=cashMoney(currentCashSession.openingAmount)+summary.money+summary.supplies-summary.withdrawals;
    const today=businessDateFor();
    const overdue=currentCashSession.businessDate&&currentCashSession.businessDate!==today;
    $('#cashSessionMeta').innerHTML=`
      ${overdue?'<div class="alert alert-error"><strong>Caixa anterior pendente.</strong> Feche o caixa de '+esc(currentCashSession.businessDate)+' antes de iniciar o caixa de hoje.</div>':''}
      <p><strong>Dia operacional:</strong> ${esc(currentCashSession.businessDate||'Sessão antiga')} ${currentCashSession.sessionNumber?`• Sessão ${Number(currentCashSession.sessionNumber)}`:''}</p>
      <p><strong>Aberto por:</strong> ${esc(currentCashSession.openedByName||'Usuário')}</p>
      <p><strong>Valor inicial:</strong> ${money(currentCashSession.openingAmount)}</p>
      <p><strong>Suprimentos:</strong> ${money(summary.supplies)} • <strong>Sangrias:</strong> ${money(summary.withdrawals)}</p>
      <p><strong>Dinheiro esperado agora:</strong> ${money(expected)}</p>
      <p><strong>Vendas vinculadas:</strong> ${summary.count}</p>
      <p><strong>Abertura:</strong> ${formatDate(currentCashSession.openedAt)}</p>`;
  }

  const movementsHost=$('#cashMovements');
  if(movementsHost){
    movementsHost.innerHTML=currentCashSession
      ?(cashMovements.length?cashMovements.map(m=>`<div class="data-row"><div class="data-main"><strong>${m.type==='supply'?'Suprimento':'Sangria'}</strong><small>${esc(m.note||'Sem observação')} • ${formatDate(m.createdAt)} • ${esc(m.createdByName||'')}</small></div><span class="status-pill ${m.type==='supply'?'status-completed':'status-cancelled'}">${m.type==='supply'?'+':'−'}</span><strong>${money(m.amount)}</strong></div>`).join(''):emptyStateHtml({icon:'wallet-cards',title:'Nenhum movimento neste caixa',description:'Suprimentos e sangrias aparecerão aqui.'}))
      :emptyStateHtml({icon:'wallet-cards',title:'Caixa fechado',description:'Abra o caixa para registrar suprimentos e sangrias.'});
  }

  $('#cashHistory').innerHTML=cashSessions.length?cashSessions.slice(0,20).map(s=>{
    const sum=s.summary||cashSummary(s);
    return `<div class="data-row"><div class="data-main"><strong>${s.status==='open'?'Caixa aberto':'Caixa fechado'}${s.sessionNumber?` • Sessão ${Number(s.sessionNumber)}`:''}</strong><small>${esc(s.businessDate||'')} • ${formatDate(s.openedAt)} • ${esc(s.openedByName||'')}</small></div><span>${Number(sum.count||0)} pedido(s)</span><div><strong>${money(sum.gross||0)}</strong>${s.difference!=null?`<small class="muted" style="display:block">Diferença: ${money(s.difference)}</small>`:''}</div></div>`;
  }).join(''):emptyStateHtml({icon:'wallet-cards',title:'Nenhum caixa registrado',description:'O histórico de aberturas e fechamentos aparecerá aqui.'});
}

$('#openCashBtn')?.addEventListener('click',async()=>{
  if(!hasPermission('cashOperate')) return;
  const openingAmount=Number($('#cashOpeningAmount').value||0);
  if(!Number.isFinite(openingAmount)||openingAmount<0||openingAmount>1_000_000){
    showToast('Informe um valor inicial válido entre R$ 0,00 e R$ 1.000.000,00.','warning');
    $('#cashOpeningAmount').focus();
    return;
  }

  const openingNote=$('#cashOpeningNote').value.trim();
  const fingerprint=JSON.stringify({openingAmount,openingNote});
  if(!cashOpenRequestId||cashOpenFingerprint!==fingerprint){
    cashOpenRequestId=crypto.randomUUID().replace(/-/g,'');
    cashOpenFingerprint=fingerprint;
  }

  const button=$('#openCashBtn');
  button.disabled=true;
  try{
    await cashOperation('open',{
      requestId:cashOpenRequestId,
      openingAmount,
      openingNote
    });
    cashOpenRequestId='';
    cashOpenFingerprint='';
    $('#cashOpeningAmount').value='0';
    $('#cashOpeningNote').value='';
    await loadCashSessions();
    showToast('Caixa aberto com sucesso.','success');
  }catch(err){
    console.error(err);
    if(err?.code==='idempotency_conflict'){
      cashOpenRequestId='';
      cashOpenFingerprint='';
    }
    await loadCashSessions();
    if(currentCashSession){
      cashOpenRequestId='';
      cashOpenFingerprint='';
      showToast('O caixa está aberto e o painel foi sincronizado.','success');
    }else{
      showToast(cashOperationMessage(err),'error',{duration:7000});
    }
  }finally{
    button.disabled=false;
  }
});

function openCashMovement(type){
  if(!hasPermission('cashOperate')||!currentCashSession) return;
  cashMovementRequestId='';
  cashMovementFingerprint='';
  $('#cashMovementType').value=type;
  $('#cashMovementTitle').textContent=type==='supply'?'Adicionar suprimento':'Registrar sangria';
  $('#cashMovementAmount').value='';
  $('#cashMovementNote').value='';
  $('#cashMovementError').classList.add('hidden');
  $('#cashMovementDialog').showModal();
  setTimeout(()=>$('#cashMovementAmount').focus(),50);
}

$('#cashSupplyBtn')?.addEventListener('click',()=>openCashMovement('supply'));
$('#cashWithdrawalBtn')?.addEventListener('click',()=>openCashMovement('withdrawal'));

$('#cashMovementForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  if(!hasPermission('cashOperate')||!currentCashSession) return;
  const sessionId=currentCashSession.id;
  const type=$('#cashMovementType').value==='withdrawal'?'withdrawal':'supply';
  const amount=Number($('#cashMovementAmount').value||0);
  const note=$('#cashMovementNote').value.trim();
  if(!Number.isFinite(amount)||amount<=0||amount>1_000_000){
    $('#cashMovementError').textContent='Informe um valor maior que zero e de até R$ 1.000.000,00.';
    $('#cashMovementError').classList.remove('hidden');
    return;
  }

  const fingerprint=JSON.stringify({sessionId,type,amount,note});
  if(!cashMovementRequestId||cashMovementFingerprint!==fingerprint){
    cashMovementRequestId=crypto.randomUUID().replace(/-/g,'');
    cashMovementFingerprint=fingerprint;
  }

  const submit=$('#cashMovementForm button[type=submit]');
  if(submit) submit.disabled=true;
  try{
    await cashOperation('movement',{
      requestId:cashMovementRequestId,
      sessionId,
      type,
      amount,
      note
    });
    cashMovementRequestId='';
    cashMovementFingerprint='';
    $('#cashMovementDialog').close();
    await loadCashSessions();
  }catch(err){
    console.error(err);
    if(err?.code==='idempotency_conflict'){
      cashMovementRequestId='';
      cashMovementFingerprint='';
    }
    $('#cashMovementError').textContent=cashOperationMessage(err);
    $('#cashMovementError').classList.remove('hidden');
    await loadCashSessions();
  }finally{
    if(submit) submit.disabled=false;
  }
});

function refreshCashClosePreview({resetDeclared=false}={}){
  if(!currentCashSession) return false;
  const summary=cashSummary();
  const expected=cashMoney(currentCashSession.openingAmount)+summary.money+summary.supplies-summary.withdrawals;
  cashCloseRevision=Number(currentCashSession.financialRevision||0);
  if(resetDeclared) $('#cashClosingAmount').value=expected.toFixed(2);
  $('#cashClosePreview').innerHTML=`<p>Dinheiro esperado: <strong>${money(expected)}</strong></p><p>Vendas vinculadas a este caixa: <strong>${summary.count}</strong></p><p>Vendas totais do período: <strong>${money(summary.gross)}</strong></p><p class="muted">Se entrar uma venda, suprimento ou sangria durante a conferência, o fechamento será bloqueado para você revisar os valores.</p>`;
  return true;
}

$('#closeCashBtn')?.addEventListener('click',()=>{
  if(!hasPermission('cashOperate')||!currentCashSession) return;
  refreshCashClosePreview({resetDeclared:true});
  $('#cashClosingNote').value='';
  $('#cashCloseError').classList.add('hidden');
  $('#cashCloseDialog').showModal();
});

$('#cashCloseForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  if(!hasPermission('cashOperate')||!currentCashSession) return;
  const sessionId=currentCashSession.id;
  const declared=Number($('#cashClosingAmount').value||0);
  if(!Number.isFinite(declared)||declared<0||declared>10_000_000){
    $('#cashCloseError').textContent='Informe um valor contado válido, igual ou maior que zero.';
    $('#cashCloseError').classList.remove('hidden');
    $('#cashClosingAmount').focus();
    return;
  }

  const submit=$('#cashCloseForm button[type=submit]');
  if(submit) submit.disabled=true;
  try{
    const result=await cashOperation('close',{
      sessionId,
      closingAmount:declared,
      closingNote:$('#cashClosingNote').value.trim(),
      expectedRevision:cashCloseRevision
    });
    $('#cashCloseDialog').close();
    await loadCashSessions();
    const difference=Number(result.difference||0);
    showToast(
      Math.abs(difference)<0.005
        ?'Caixa fechado sem diferença.'
        :`Caixa fechado. Diferença registrada: ${money(difference)}.`,
      Math.abs(difference)<0.005?'success':'warning',
      {duration:7000}
    );
  }catch(err){
    console.error(err);
    $('#cashCloseError').textContent=cashOperationMessage(err);
    $('#cashCloseError').classList.remove('hidden');
    await loadCashSessions();
    if(err?.code==='cash_changed_recheck'&&currentCashSession){
      refreshCashClosePreview({resetDeclared:false});
    }
  }finally{
    if(submit) submit.disabled=false;
  }
});

function adminPromotionActive(promo){
  if(!promo||promo.active===false) return false;
  return dateTimeWindowActive(
    promo.startsAt,
    promo.endsAt,
    settings.timezone||'America/Porto_Velho'
  );
}

function promotionsForProduct(product){
  return promotions.filter(promo=>{
    if(!adminPromotionActive(promo)) return false;
    if(promo.targetType==='all') return true;
    if(promo.targetType==='category') return promo.targetId===product.categoryId;
    if(promo.targetType==='product') return promo.targetId===product.id;
    return false;
  });
}

function promotionSummaryForProduct(product){
  const list=promotionsForProduct(product);
  if(!list.length) return '';
  return list.map(p=>p.discountType==='percentage'
    ?`${Number(p.discountValue||0)}% OFF`
    :`${money(p.discountValue)} OFF`
  ).join(' • ');
}

function renderProducts(){
  const canEdit=hasPermission('productsEdit');
  const canDelete=hasPermission('productsDelete');
  const canPromote=hasPermission('promotionsManage');
  $('#newProductBtn')?.classList.toggle('hidden',!hasPermission('productsCreate'));
  $('#seedBtn')?.classList.toggle('hidden',!(hasPermission('productsCreate')&&hasPermission('categoriesManage')));

  $('#productsTable').innerHTML=products.length?products.map(p=>{
    const promoSummary=promotionSummaryForProduct(p);
    return `<div class="data-row">
      <div class="data-main">
        <strong>${esc(p.name)}</strong>
        <small>${esc(categories.find(cat=>cat.id===p.categoryId)?.name||'Sem categoria')} • ${p.active===false?'Indisponível':'Disponível'} • ${p.sizes?.length?`${p.sizes.length} tamanhos`:money(p.price)}</small>
        ${promoSummary?`<small class="product-promotion-line">${iconHtml('badge-percent')} <span>Em promoção • ${esc(promoSummary)}</span></small>`:''}
      </div>
      <span>${p.featured?'Destaque':''}</span>
      <div class="data-actions">
        ${canPromote?`<button class="btn btn-secondary promote-product" data-id="${p.id}" type="button">${promoSummary?'Ver promoção':'Criar promoção'}</button>`:''}
        ${canEdit?`<button class="btn btn-secondary edit-product" data-id="${p.id}" type="button">Editar</button>`:''}
        ${canDelete?`<button class="btn btn-danger delete-product" data-id="${p.id}" type="button">Excluir</button>`:''}
      </div>
    </div>`;
  }).join(''):emptyStateHtml({icon:'pizza',title:'Nenhum produto cadastrado',description:'Cadastre o primeiro item para montar o cardápio.'});

  $$('.edit-product').forEach(b=>b.onclick=()=>editProduct(b.dataset.id));
  $$('.delete-product').forEach(b=>b.onclick=()=>deleteProduct(b.dataset.id));
  $$('.promote-product').forEach(b=>b.onclick=()=>{
    const product=products.find(p=>p.id===b.dataset.id);
    if(!product) return;
    const existing=promotions.find(p=>p.targetType==='product'&&p.targetId===product.id&&adminPromotionActive(p));
    if(existing) editPromotion(existing.id);
    else editPromotion(null,{targetType:'product',targetId:product.id,name:'Oferta • '+product.name});
  });
}
$('#newProductBtn').onclick=()=>{if(hasPermission('productsCreate')) editProduct(null);};

function refreshCategorySelect(){
  $('#productCategory').innerHTML=categories.filter(c=>c.active!==false).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

let productImageSource=null;
let productImageUploadKey='';
let productImageZoom=1;
let productImageOffset={x:0,y:0};
let productImageDragging=false;
let productImageDragStart={x:0,y:0};

function renderPriceRows(containerId,emptyId,rows=[]){
  const container=$('#'+containerId);
  container.innerHTML='';
  for(const row of rows) addPriceRow(containerId,emptyId,row);
  updatePriceRowsEmpty(containerId,emptyId);
}

function addPriceRow(containerId,emptyId,row={name:'',price:''}){
  const container=$('#'+containerId);
  const el=document.createElement('div');
  el.className='repeat-row';
  el.innerHTML=`
    <label class="field repeat-field"><span>Nome</span><input class="repeat-name" maxlength="80" placeholder="Ex.: Grande" value="${esc(row.name||'')}"></label>
    <label class="field repeat-price"><span>Preço (R$)</span><input class="repeat-value" type="number" min="0" max="100000" step="0.01" placeholder="0,00" value="${Number.isFinite(Number(row.price))?Number(row.price):''}"></label>
    <button class="repeat-remove" type="button" title="Remover" aria-label="Remover">${iconHtml('trash')}</button>`;
  el.querySelector('.repeat-remove').onclick=()=>{el.remove();updatePriceRowsEmpty(containerId,emptyId);};
  container.appendChild(el);
  updatePriceRowsEmpty(containerId,emptyId);
  el.querySelector('.repeat-name')?.focus();
}

function updatePriceRowsEmpty(containerId,emptyId){
  $('#'+emptyId).classList.toggle('hidden',$('#'+containerId).children.length>0);
}

function collectPriceRows(containerId){
  return [...$('#'+containerId).querySelectorAll('.repeat-row')].map(row=>({
    name:row.querySelector('.repeat-name').value.trim(),
    price:Number(row.querySelector('.repeat-value').value||0)
  })).filter(x=>x.name);
}

$('#addProductSizeBtn')?.addEventListener('click',()=>addPriceRow('productSizesEditor','productSizesEmpty'));
$('#addProductExtraBtn')?.addEventListener('click',()=>addPriceRow('productExtrasEditor','productExtrasEmpty'));

function previewProductImagePath(value){
  const src=String(value||'').trim();
  if(!src) return '';
  if(/^https?:\/\//i.test(src)) return src;
  return '../'+src.replace(/^\.?\//,'').replace(/^\//,'');
}

function resetImageEditor(){
  productImageSource=null;
  productImageZoom=1;
  productImageOffset={x:0,y:0};
  if($('#productImageZoom')) $('#productImageZoom').value='1';
  const canvas=$('#productImageCanvas');
  const ctx=canvas?.getContext('2d');
  if(ctx) ctx.clearRect(0,0,canvas.width,canvas.height);
  $('#productImageEmpty')?.classList.remove('hidden');
}

function loadImageIntoEditor(src){
  if(!src) return resetImageEditor();
  const img=new Image();
  img.crossOrigin='anonymous';
  img.onload=()=>{
    productImageSource=img;
    productImageZoom=1;
    productImageOffset={x:0,y:0};
    $('#productImageZoom').value='1';
    $('#productImageEmpty').classList.add('hidden');
    drawProductImage();
  };
  img.onerror=()=>resetImageEditor();
  img.src=src;
}

function drawProductImage(){
  const canvas=$('#productImageCanvas');
  if(!canvas||!productImageSource) return;
  const ctx=canvas.getContext('2d');
  const iw=productImageSource.naturalWidth||productImageSource.width;
  const ih=productImageSource.naturalHeight||productImageSource.height;
  const base=Math.max(canvas.width/iw,canvas.height/ih);
  const scale=base*productImageZoom;
  const w=iw*scale,h=ih*scale;
  const x=(canvas.width-w)/2+productImageOffset.x;
  const y=(canvas.height-h)/2+productImageOffset.y;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(productImageSource,x,y,w,h);
}

$('#productImageFile')?.addEventListener('change',e=>{
  const file=e.target.files?.[0];
  if(!file) return;
  const reader=new FileReader();
  reader.onload=()=>loadImageIntoEditor(String(reader.result||''));
  reader.readAsDataURL(file);
});

$('#productImageZoom')?.addEventListener('input',e=>{
  productImageZoom=Number(e.target.value||1);
  drawProductImage();
});

const productCanvas=$('#productImageCanvas');
productCanvas?.addEventListener('pointerdown',e=>{
  if(!productImageSource) return;
  productImageDragging=true;
  productCanvas.setPointerCapture(e.pointerId);
  productImageDragStart={x:e.clientX-productImageOffset.x,y:e.clientY-productImageOffset.y};
});
productCanvas?.addEventListener('pointermove',e=>{
  if(!productImageDragging) return;
  productImageOffset={x:e.clientX-productImageDragStart.x,y:e.clientY-productImageDragStart.y};
  drawProductImage();
});
productCanvas?.addEventListener('pointerup',()=>{productImageDragging=false;});
productCanvas?.addEventListener('pointercancel',()=>{productImageDragging=false;});

$('#uploadProductImageBtn')?.addEventListener('click',async()=>{
  if(!productImageSource) return showToast('Selecione uma imagem primeiro.','warning');
  const button=$('#uploadProductImageBtn');
  const status=$('#productImageUploadStatus');
  const canvas=$('#productImageCanvas');
  const slug=(($('#productName').value||'produto').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'produto').slice(0,55);
  if(!productImageUploadKey) productImageUploadKey=crypto.randomUUID().replace(/-/g,'').slice(0,12);
  const name=slug+'-'+productImageUploadKey;

  button.disabled=true;
  status.textContent='Enviando imagem ao GitHub...';
  try{
    const dataUrl=canvas.toDataURL('image/webp',.9);
    const base64=dataUrl.split(',')[1];
    const token=await auth.currentUser?.getIdToken();
    if(!token) throw new Error('auth');

    const response=await fetch(IMAGE_UPLOAD_ENDPOINT,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':'Bearer '+token
      },
      body:JSON.stringify({fileName:name,base64})
    });

    const result=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(result?.message||result?.error||'upload');

    $('#productImage').value=result.path;
    status.innerHTML='Imagem enviada com sucesso para <strong>'+esc(result.path)+'</strong>.';
  }catch(err){
    console.error(err);
    status.textContent='O serviço seguro de imagens ainda não está ativado ou falhou. Você pode baixar a imagem recortada enquanto isso.';
  }finally{
    button.disabled=false;
  }
});

$('#downloadPreparedImageBtn')?.addEventListener('click',()=>{
  if(!productImageSource) return showToast('Selecione uma imagem primeiro.','warning');
  const canvas=$('#productImageCanvas');
  canvas.toBlob(blob=>{
    if(!blob) return;
    const name=($('#productName').value||'produto').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'produto';
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=name+'.webp';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  },'image/webp',.9);
});

function editProduct(id){
  if(id&&!hasPermission('productsEdit')) return;
  if(!id&&!hasPermission('productsCreate')) return;
  const p=products.find(x=>x.id===id);
  productImageUploadKey=p?.id||crypto.randomUUID().replace(/-/g,'').slice(0,12);
  $('#productEditorTitle').textContent=p?'Editar produto':'Novo produto';
  $('#productId').value=p?.id||'';
  $('#productName').value=p?.name||'';
  $('#productCategory').value=p?.categoryId||categories[0]?.id||'';
  $('#productDescription').value=p?.description||'';
  $('#productPrice').value=p?.price??'';
  $('#productOrder').value=p?.order??0;
  $('#productImage').value=p?.image||'assets/products/placeholder.svg';
  renderPriceRows('productSizesEditor','productSizesEmpty',p?.sizes||[]);
  renderPriceRows('productExtrasEditor','productExtrasEmpty',p?.extras||[]);
  const inferredPizza=p?.isPizza??/pizza/i.test(categories.find(cat=>cat.id===(p?.categoryId||$('#productCategory').value))?.name||'');
  $('#productIsPizza').checked=!!inferredPizza;
  $('#productHalfHalf').checked=p?.allowHalfHalf!==false;
  $('#productActive').checked=p?.active!==false;
  $('#productFeatured').checked=!!p?.featured;
  $('#productEditorError').classList.add('hidden');
  const preview=previewProductImagePath(p?.image||'assets/products/placeholder.svg');
  loadImageIntoEditor(preview);
  $('#productEditor').showModal();
}

$('#productEditorForm').onsubmit=async e=>{
  e.preventDefault();
  $('#productEditorError').classList.add('hidden');
  const id=$('#productId').value;
  const data={
    name:$('#productName').value.trim(),
    categoryId:$('#productCategory').value,
    description:$('#productDescription').value.trim(),
    price:Number($('#productPrice').value||0),
    order:Number($('#productOrder').value||0),
    image:$('#productImage').value.trim()||'assets/products/placeholder.svg',
    sizes:collectPriceRows('productSizesEditor'),
    extras:collectPriceRows('productExtrasEditor'),
    isPizza:$('#productIsPizza').checked,
    allowHalfHalf:$('#productIsPizza').checked&&$('#productHalfHalf').checked,
    active:$('#productActive').checked,
    featured:$('#productFeatured').checked,
    updatedAt:serverTimestamp()
  };
  if(!data.name){
    $('#productEditorError').textContent='Informe o nome do produto.';
    $('#productEditorError').classList.remove('hidden');
    return;
  }
  if(!data.categoryId){
    $('#productEditorError').textContent='Escolha uma categoria.';
    $('#productEditorError').classList.remove('hidden');
    return;
  }
  const basePrice=validMoneyValue(data.price,100_000);
  const orderValue=finiteAdminNumber(data.order,{min:-100_000,max:100_000,integer:true});
  const sizeRows=[...$('#productSizesEditor').querySelectorAll('.repeat-row')];
  const extraRows=[...$('#productExtrasEditor').querySelectorAll('.repeat-row')];
  const invalidSize=sizeRows.some(row=>{
    const name=row.querySelector('.repeat-name').value.trim();
    const price=finiteAdminNumber(row.querySelector('.repeat-value').value,{min:0.01,max:100_000});
    return !name||price==null;
  });
  const invalidExtra=extraRows.some(row=>{
    const name=row.querySelector('.repeat-name').value.trim();
    const price=finiteAdminNumber(row.querySelector('.repeat-value').value,{min:0,max:100_000});
    return !name||price==null;
  });

  if(basePrice==null||orderValue==null||invalidSize||invalidExtra){
    $('#productEditorError').textContent='Revise preços, tamanhos, adicionais e ordem. Tamanhos precisam ter preço maior que zero; adicionais não podem ter valor negativo.';
    $('#productEditorError').classList.remove('hidden');
    return;
  }
  data.price=basePrice;
  data.order=orderValue;

  if(!data.sizes.length&&data.price<=0){
    $('#productEditorError').textContent='Informe um preço base maior que zero ou cadastre pelo menos um tamanho válido.';
    $('#productEditorError').classList.remove('hidden');
    return;
  }
  if(id&&!hasPermission('productsEdit')) return;
  if(!id&&!hasPermission('productsCreate')) return;
  try{
    if(id) await updateDoc(doc(db,'products',id),data);
    else await addDoc(collection(db,'products'),{...data,createdAt:serverTimestamp()});
    $('#productEditor').close();
    await loadProducts();
  }catch(err){
    console.error(err);
    $('#productEditorError').textContent='Não foi possível salvar o produto.';
    $('#productEditorError').classList.remove('hidden');
  }
};

async function deleteProduct(id){
  if(!hasPermission('productsDelete')) return;
  const p=products.find(x=>x.id===id);
  if(await confirmAction(`Excluir o produto “${p?.name}”?`,{title:'Excluir produto',confirmText:'Excluir',danger:true})){
    await deleteDoc(doc(db,'products',id));
    await loadProducts();
    showToast('Produto excluído com sucesso.','success');
  }
}

function renderCategories(){
  $('#categoriesTable').innerHTML=categories.length?categories.map(c=>`<div class="data-row"><div class="data-main"><strong>${esc(c.name)}</strong><small>Ordem ${c.order||0} • ${c.active===false?'Inativa':'Ativa'}</small></div><span></span><div class="data-actions"><button class="btn btn-secondary edit-category" data-id="${c.id}">Editar</button><button class="btn btn-danger delete-category" data-id="${c.id}">Excluir</button></div></div>`).join(''):emptyStateHtml({icon:'folders',title:'Nenhuma categoria cadastrada',description:'Crie categorias para organizar o cardápio.'});

  $$('.edit-category').forEach(b=>b.onclick=()=>editCategory(b.dataset.id));
  $$('.delete-category').forEach(b=>b.onclick=()=>deleteCategory(b.dataset.id));
}

$('#newCategoryBtn').onclick=()=>{if(hasPermission('categoriesManage')) editCategory(null);};

function editCategory(id){
  if(!hasPermission('categoriesManage')) return;
  const c=categories.find(x=>x.id===id);
  $('#categoryEditorTitle').textContent=c?'Editar categoria':'Nova categoria';
  $('#categoryId').value=c?.id||'';
  $('#categoryName').value=c?.name||'';
  $('#categoryOrder').value=c?.order??0;
  $('#categoryActive').checked=c?.active!==false;
  $('#categoryEditor').showModal();
}

$('#categoryEditorForm').onsubmit=async e=>{
  e.preventDefault();
  if(!hasPermission('categoriesManage')) return;
  $('#categoryEditorError').classList.add('hidden');
  const id=$('#categoryId').value;
  const data={
    name:$('#categoryName').value.trim(),
    order:Number($('#categoryOrder').value||0),
    active:$('#categoryActive').checked,
    updatedAt:serverTimestamp()
  };
  if(!data.name){
    $('#categoryEditorError').textContent='Informe o nome da categoria.';
    $('#categoryEditorError').classList.remove('hidden');
    return;
  }
  try{
    if(id) await updateDoc(doc(db,'categories',id),data);
    else await addDoc(collection(db,'categories'),{...data,createdAt:serverTimestamp()});
    $('#categoryEditor').close();
    await loadCategories();
  }catch(err){
    console.error(err);
    $('#categoryEditorError').textContent='Não foi possível salvar a categoria.';
    $('#categoryEditorError').classList.remove('hidden');
  }
};

async function deleteCategory(id){
  if(!hasPermission('categoriesManage')) return;
  if(products.some(p=>p.categoryId===id)){
    return showToast('Essa categoria possui produtos. Mova ou exclua os produtos antes.','warning');
  }
  const c=categories.find(x=>x.id===id);
  if(await confirmAction(`Excluir a categoria “${c?.name}”?`,{title:'Excluir categoria',confirmText:'Excluir',danger:true})){
    await deleteDoc(doc(db,'categories',id));
    await loadCategories();
    showToast('Categoria excluída com sucesso.','success');
  }
}

function renderDeliveryZonesEditor(rows=[]){
  const host=$('#deliveryZonesEditor');
  if(!host) return;
  host.innerHTML='';
  for(const row of rows) addDeliveryZoneRow(row);
  updateDeliveryZoneEmpty();
}

function addDeliveryZoneRow(row={neighborhood:'',fee:''}){
  const host=$('#deliveryZonesEditor');
  const el=document.createElement('div');
  el.className='repeat-row';
  el.innerHTML=`
    <label class="field repeat-field"><span>Bairro</span><input class="zone-name" maxlength="80" placeholder="Ex.: Centro" value="${esc(row.neighborhood||'')}"></label>
    <label class="field repeat-price"><span>Taxa (R$)</span><input class="zone-fee" type="number" min="0" max="10000" step="0.01" value="${Number.isFinite(Number(row.fee))?Number(row.fee):''}"></label>
    <button class="repeat-remove" type="button" title="Remover" aria-label="Remover">${iconHtml('trash')}</button>`;
  el.querySelector('.repeat-remove').onclick=()=>{el.remove();updateDeliveryZoneEmpty();};
  host.appendChild(el);
  updateDeliveryZoneEmpty();
}

function updateDeliveryZoneEmpty(){
  $('#deliveryZonesEmpty')?.classList.toggle('hidden',$('#deliveryZonesEditor')?.children.length>0);
}

function collectDeliveryZones(){
  return [...$('#deliveryZonesEditor').querySelectorAll('.repeat-row')].map(row=>({
    neighborhood:row.querySelector('.zone-name').value.trim(),
    fee:Number(row.querySelector('.zone-fee').value||0)
  })).filter(x=>x.neighborhood);
}

$('#addDeliveryZoneBtn')?.addEventListener('click',()=>addDeliveryZoneRow());

function renderDeliveryKmBandsEditor(rows=[]){
  const host=$('#deliveryKmBandsEditor');
  if(!host) return;
  host.innerHTML='';
  for(const row of rows) addDeliveryKmBandRow(row);
  updateDeliveryKmBandsEmpty();
}

function addDeliveryKmBandRow(row={maxKm:'',fee:''}){
  const host=$('#deliveryKmBandsEditor');
  const el=document.createElement('div');
  el.className='repeat-row delivery-km-row';
  el.innerHTML=`
    <label class="field repeat-field"><span>Até quantos km</span><input class="km-max" type="number" min="0.1" max="500" step="0.1" placeholder="Ex.: 3" value="${Number.isFinite(Number(row.maxKm))?Number(row.maxKm):''}"></label>
    <label class="field repeat-price"><span>Valor (R$)</span><input class="km-fee" type="number" min="0" max="10000" step="0.01" placeholder="0,00" value="${Number.isFinite(Number(row.fee))?Number(row.fee):''}"></label>
    <button class="repeat-remove" type="button" title="Remover" aria-label="Remover">${iconHtml('trash')}</button>`;
  el.querySelector('.repeat-remove').onclick=()=>{el.remove();updateDeliveryKmBandsEmpty();};
  host.appendChild(el);
  updateDeliveryKmBandsEmpty();
}

function updateDeliveryKmBandsEmpty(){
  $('#deliveryKmBandsEmpty')?.classList.toggle('hidden',$('#deliveryKmBandsEditor')?.children.length>0);
}

function collectDeliveryKmBands(){
  return [...$('#deliveryKmBandsEditor').querySelectorAll('.repeat-row')].map(row=>({
    maxKm:Number(row.querySelector('.km-max').value||0),
    fee:Number(row.querySelector('.km-fee').value||0)
  })).filter(x=>x.maxKm>0).sort((a,b)=>a.maxKm-b.maxKm);
}

$('#addDeliveryKmBandBtn')?.addEventListener('click',()=>addDeliveryKmBandRow());

function selectedDeliveryPricingMode(){
  return document.querySelector('input[name="deliveryPricingMode"]:checked')?.value||'fixed';
}

function renderDeliveryPricingMode(){
  const mode=selectedDeliveryPricingMode();
  $('#deliveryFixedSettings')?.classList.toggle('hidden',mode!=='fixed');
  $('#deliveryNeighborhoodSettings')?.classList.toggle('hidden',mode!=='neighborhood');
  $('#deliveryKmSettings')?.classList.toggle('hidden',mode!=='km');
}

$$('input[name="deliveryPricingMode"]').forEach(r=>r.addEventListener('change',renderDeliveryPricingMode));

async function lookupZipGeo(zip){
  const digits=String(zip||'').replace(/\D/g,'');
  if(digits.length!==8) return null;

  let primary=null;
  try{
    const response=await fetch(`https://brasilapi.com.br/api/cep/v2/${digits}`,{cache:'no-store'});
    if(response.ok){
      const data=await response.json();
      const lat=Number(data?.location?.coordinates?.latitude);
      const lng=Number(data?.location?.coordinates?.longitude);
      primary={
        zip:digits.replace(/^(\d{5})(\d{3})$/,'$1-$2'),
        street:data.street||'',
        neighborhood:data.neighborhood||'',
        city:data.city||'',
        state:data.state||'',
        location:Number.isFinite(lat)&&Number.isFinite(lng)?{latitude:lat,longitude:lng,source:'brasilapi-cep-v2'}:null
      };
      if(primary.street&&primary.neighborhood&&primary.city&&primary.state) return primary;
    }
  }catch(err){
    console.warn('BrasilAPI indisponível para CEP; tentando ViaCEP.',err);
  }

  try{
    const response=await fetch(`https://viacep.com.br/ws/${digits}/json/`,{cache:'no-store'});
    if(!response.ok) return primary;
    const data=await response.json();
    if(data?.erro) return primary;
    return {
      zip:digits.replace(/^(\d{5})(\d{3})$/,'$1-$2'),
      street:primary?.street||data.logradouro||'',
      neighborhood:primary?.neighborhood||data.bairro||'',
      city:primary?.city||data.localidade||'',
      state:primary?.state||data.uf||'',
      location:primary?.location||null
    };
  }catch(err){
    console.warn('ViaCEP indisponível.',err);
    return primary;
  }
}

async function refreshStoreLocationPreview(){
  const zip=$('#setStoreZip')?.value||'';
  const status=$('#storeLocationStatus');
  if(!status) return null;
  const digits=zip.replace(/\D/g,'');
  if(digits.length!==8){
    status.textContent='Informe um CEP válido para usar frete por km.';
    return null;
  }
  status.textContent='Localizando CEP...';
  const data=await lookupZipGeo(zip);
  if(!data?.location){
    status.textContent='Não foi possível obter coordenadas para este CEP.';
    return null;
  }
  $('#setStoreZip').value=data.zip;
  if(data.street&&!$('#setStoreStreet').value.trim()) $('#setStoreStreet').value=data.street;
  if(data.neighborhood&&!$('#setStoreNeighborhood').value.trim()) $('#setStoreNeighborhood').value=data.neighborhood;
  if(data.city&&!$('#setStoreCity').value.trim()) $('#setStoreCity').value=data.city;
  if(data.state&&!$('#setStoreState').value.trim()) $('#setStoreState').value=data.state;
  status.textContent=`CEP localizado • ${data.city||''}/${data.state||''} • pronto para cálculo por km.`;
  return data.location;
}

$('#setStoreZip')?.addEventListener('blur',refreshStoreLocationPreview);

async function calculateDeliveryDraftForCep(zip){
  const mode=selectedDeliveryPricingMode();
  const customer=await lookupZipGeo(zip);
  if(!customer) return {supported:false,message:'CEP do cliente não encontrado.'};

  if(mode==='fixed'){
    return {
      supported:true,
      fee:Number($('#setDeliveryFee').value||0),
      detail:'Valor fixo'
    };
  }

  if(mode==='neighborhood'){
    const zones=collectDeliveryZones();
    const key=normalizePriceKey(customer.neighborhood);
    const zone=zones.find(z=>normalizePriceKey(z.neighborhood)===key);
    if(zone){
      return {
        supported:true,
        fee:Number(zone.fee||0),
        detail:`Bairro: ${customer.neighborhood||'—'}`
      };
    }
    if($('#setRestrictDeliveryZones').checked){
      return {supported:false,message:`Bairro ${customer.neighborhood||'não identificado'} não está na área de entrega.`};
    }
    return {
      supported:true,
      fee:Number($('#setNeighborhoodFallbackFee').value||0),
      detail:`Bairro não cadastrado • taxa padrão`
    };
  }

  const storeZip=$('#setStoreZip').value;
  const store=await lookupZipGeo(storeZip);
  if(!store?.location){
    return {supported:false,message:'Informe um CEP válido da pizzaria para testar o frete por km.'};
  }
  if(!customer.location){
    return {supported:false,message:'Este CEP de cliente não possui coordenadas disponíveis para cálculo por km.'};
  }

  const km=distanceKmBetween(store.location,customer.location);
  const bands=collectDeliveryKmBands();
  const band=bands.find(b=>km<=Number(b.maxKm||0));
  if(band){
    return {
      supported:true,
      fee:Number(band.fee||0),
      detail:`Linha reta pelo CEP: ${km.toFixed(1).replace('.',',')} km • faixa até ${Number(band.maxKm).toFixed(1).replace('.',',')} km`
    };
  }

  if($('#setRestrictDeliveryKm').checked&&bands.length){
    return {supported:false,message:`Distância aproximada em linha reta pelo CEP de ${km.toFixed(1).replace('.',',')} km, acima da última faixa cadastrada.`};
  }

  const last=bands.at(-1);
  return {
    supported:true,
    fee:last?Number(last.fee||0):Number($('#setDeliveryFee').value||0),
    detail:`Linha reta pelo CEP: ${km.toFixed(1).replace('.',',')} km • usando a última faixa disponível`
  };
}

$('#testDeliveryFeeBtn')?.addEventListener('click',async()=>{
  const result=$('#deliveryTestResult');
  const button=$('#testDeliveryFeeBtn');
  const zip=$('#deliveryTestZip').value.trim();
  if(zip.replace(/\D/g,'').length!==8){
    result.textContent='Digite um CEP válido com 8 números.';
    result.className='delivery-test-result error';
    return;
  }

  button.disabled=true;
  button.textContent='Calculando...';
  result.className='delivery-test-result';
  result.textContent='Consultando CEP...';

  try{
    const quote=await calculateDeliveryDraftForCep(zip);
    if(!quote.supported){
      result.textContent=quote.message||'Entrega não disponível.';
      result.className='delivery-test-result error';
      return;
    }
    result.textContent=`${quote.detail} • Frete: ${money(quote.fee)}`;
    result.className='delivery-test-result success';
  }catch(err){
    console.error(err);
    result.textContent='Não foi possível calcular o frete agora.';
    result.className='delivery-test-result error';
  }finally{
    button.disabled=false;
    button.textContent='Calcular';
  }
});

function renderPaymentMethodsEditor(rows=[]){
  const host=$('#paymentMethodsEditor');
  if(!host) return;
  host.innerHTML='';
  for(const value of rows) addPaymentMethodRow(value);
  updatePaymentMethodsEmpty();
}

function addPaymentMethodRow(value=''){
  const host=$('#paymentMethodsEditor');
  const el=document.createElement('div');
  el.className='simple-repeat-row';
  el.innerHTML=`<input class="payment-method-value" maxlength="60" placeholder="Ex.: Cartão de crédito" value="${esc(value)}"><button class="repeat-remove" type="button" title="Remover" aria-label="Remover">${iconHtml('trash')}</button>`;
  el.querySelector('.repeat-remove').onclick=()=>{el.remove();updatePaymentMethodsEmpty();};
  host.appendChild(el);
  updatePaymentMethodsEmpty();
}

function updatePaymentMethodsEmpty(){
  $('#paymentMethodsEmpty')?.classList.toggle('hidden',$('#paymentMethodsEditor')?.children.length>0);
}

function collectPaymentMethods(){
  return [...$('#paymentMethodsEditor').querySelectorAll('.payment-method-value')].map(x=>x.value.trim()).filter(Boolean);
}

$('#addPaymentMethodBtn')?.addEventListener('click',()=>addPaymentMethodRow());


function renderSchedules(){
  $('#scheduleEditor').innerHTML=dayNames.map((n,i)=>`<div class="schedule-row"><strong>${n}</strong><label class="check-row"><input class="sch-enabled" data-day="${i}" type="checkbox"><span>Aberto</span></label><input class="sch-open" data-day="${i}" type="time"><input class="sch-close" data-day="${i}" type="time"></div>`).join('');
}

function renderSettings(){
  $('#setStoreName').value=settings.storeName||'';
  $('#setSubtitle').value=settings.subtitle||'';
  $('#setPhone').value=formatPhoneInput(settings.phone||'');
  $('#setWhatsapp').value=formatPhoneInput(settings.whatsapp||settings.phone||'');
  $('#setStoreZip').value=formatCepInput(settings.storeZip||'');
  $('#setStoreStreet').value=settings.storeStreet||settings.storeAddress||'';
  $('#setStoreNumber').value=settings.storeNumber||'';
  $('#setStoreNeighborhood').value=settings.storeNeighborhood||'';
  $('#setStoreComplement').value=settings.storeComplement||'';
  $('#setStoreCity').value=settings.storeCity||'';
  $('#setStoreState').value=settings.storeState||'';
  $('#setStoreLogo').value=settings.storeLogo||'';
  const primaryColor=applyBrandTheme(settings.primaryColor||'#b91c1c');
  $('#setPrimaryColor').value=primaryColor;
  $('#primaryColorValue').textContent=primaryColor.toUpperCase();
  $('#setHeroBanner').value=settings.heroBanner||'';
  $('#setGoogleMapsUrl').value=settings.googleMapsUrl||'';
  $('#setCustomerCancelMinutes').value=settings.customerCancelMinutes??2;
  $('#setNotificationSound').value=settings.notificationSound||'bell';
  $('#setNotificationVolume').value=settings.notificationVolume??70;
  renderStoreLogoPreview();
  $('#setOpenMode').value=settings.openMode||'schedule';
  $('#setDeliveryFee').value=settings.deliveryFee??0;
  const mode=settings.deliveryPricingMode||'fixed';
  const modeInput=document.querySelector(`input[name="deliveryPricingMode"][value="${mode}"]`);
  if(modeInput) modeInput.checked=true;
  renderDeliveryZonesEditor(settings.deliveryZones||[]);
  $('#setNeighborhoodFallbackFee').value=settings.deliveryNeighborhoodFallbackFee??settings.deliveryFee??0;
  $('#setRestrictDeliveryZones').checked=!!settings.restrictDeliveryZones;
  renderDeliveryKmBandsEditor(settings.deliveryKmBands||[]);
  $('#setRestrictDeliveryKm').checked=settings.restrictDeliveryKm!==false;
  renderDeliveryPricingMode();
  $('#setMinimumOrder').value=settings.minimumOrder??0;
  $('#setAllowPickup').checked=settings.allowPickup!==false;
  $('#setAutoAccept').checked=!!settings.autoAcceptOrders;
  renderPaymentMethodsEditor(settings.payments||[]);

  if(settings.storeLocation?.latitude!=null&&settings.storeLocation?.longitude!=null){
    $('#storeLocationStatus').textContent='CEP da loja localizado • pronto para cálculo por km.';
  }else{
    $('#storeLocationStatus').textContent='O CEP será usado para calcular frete por km quando essa opção estiver ativa.';
  }

  for(let i=0;i<7;i++){
    const d=settings.schedule?.[i]||settings.schedule?.[String(i)]||defaults.schedule[i];
    $(`.sch-enabled[data-day="${i}"]`).checked=!!d.enabled;
    $(`.sch-open[data-day="${i}"]`).value=d.open||'18:00';
    $(`.sch-close[data-day="${i}"]`).value=d.close||'23:00';
  }
}
$('#settingsForm').onsubmit=async e=>{
  e.preventDefault();
  const schedule={};
  for(let i=0;i<7;i++){
    schedule[i]={
      enabled:$(`.sch-enabled[data-day="${i}"]`).checked,
      open:$(`.sch-open[data-day="${i}"]`).value,
      close:$(`.sch-close[data-day="${i}"]`).value
    };
  }

  const deliveryPricingMode=selectedDeliveryPricingMode();
  const deliveryZones=collectDeliveryZones();
  const deliveryKmBands=collectDeliveryKmBands();
  let storeLocation=settings.storeLocation||null;
  const storeZip=$('#setStoreZip').value.trim();

  const fixedFee=validMoneyValue($('#setDeliveryFee').value,10_000);
  const fallbackFee=validMoneyValue($('#setNeighborhoodFallbackFee').value,10_000);
  const minimumOrder=validMoneyValue($('#setMinimumOrder').value,1_000_000);
  const invalidZoneRows=[...$('#deliveryZonesEditor').querySelectorAll('.repeat-row')].some(row=>{
    const name=row.querySelector('.zone-name').value.trim();
    const fee=finiteAdminNumber(row.querySelector('.zone-fee').value,{min:0,max:10_000});
    return !name||fee==null;
  });
  const normalizedZones=deliveryZones.map(z=>normalizePriceKey(z.neighborhood));
  const duplicateZones=new Set(normalizedZones).size!==normalizedZones.length;
  const invalidKmRows=[...$('#deliveryKmBandsEditor').querySelectorAll('.repeat-row')].some(row=>{
    const maxKm=finiteAdminNumber(row.querySelector('.km-max').value,{min:0.1,max:500});
    const fee=finiteAdminNumber(row.querySelector('.km-fee').value,{min:0,max:10_000});
    return maxKm==null||fee==null;
  });
  const duplicateKmBands=new Set(deliveryKmBands.map(b=>String(b.maxKm))).size!==deliveryKmBands.length;

  if(fixedFee==null||fallbackFee==null||minimumOrder==null||invalidZoneRows||duplicateZones||invalidKmRows||duplicateKmBands){
    showToast('Revise os valores de entrega e pedido mínimo. Não use números negativos, bairros duplicados ou faixas de km repetidas.','warning');
    return;
  }

  if(deliveryPricingMode==='neighborhood'&&$('#setRestrictDeliveryZones').checked&&!deliveryZones.length){
    showToast('Cadastre pelo menos um bairro antes de restringir a entrega por bairro.','warning');
    return;
  }

  if(deliveryPricingMode==='km'){
    if(!deliveryKmBands.length){
      showToast('Cadastre pelo menos uma faixa de km e seu valor.','warning');
      return;
    }
    if(storeZip.replace(/\D/g,'').length!==8){
      showToast('Informe o CEP da pizzaria para calcular o frete por km.','warning');
      $('#setStoreZip').focus();
      return;
    }
    const located=await refreshStoreLocationPreview();
    if(!located){
      showToast('Não foi possível localizar o CEP da pizzaria. Confira o CEP antes de salvar o frete por km.','error');
      return;
    }
    storeLocation=located;
  }else if(storeZip.replace(/\D/g,'').length===8){
    const data=await lookupZipGeo(storeZip);
    if(data?.location) storeLocation=data.location;
  }

  settings={
    ...settings,
    storeName:$('#setStoreName').value.trim(),
    subtitle:$('#setSubtitle').value.trim(),
    phone:$('#setPhone').value.trim(),
    whatsapp:$('#setWhatsapp').value.trim(),
    storeZip,
    storeLocation,
    storeStreet:$('#setStoreStreet').value.trim(),
    storeNumber:$('#setStoreNumber').value.trim(),
    storeNeighborhood:$('#setStoreNeighborhood').value.trim(),
    storeComplement:$('#setStoreComplement').value.trim(),
    storeCity:$('#setStoreCity').value.trim(),
    storeState:$('#setStoreState').value.trim().toUpperCase(),
    storeLogo:$('#setStoreLogo').value.trim(),
    primaryColor:$('#setPrimaryColor').value||'#b91c1c',
    heroBanner:$('#setHeroBanner').value.trim(),
    googleMapsUrl:$('#setGoogleMapsUrl').value.trim(),
    storeAddress:[
      [$('#setStoreStreet').value.trim(),$('#setStoreNumber').value.trim()].filter(Boolean).join(', '),
      $('#setStoreNeighborhood').value.trim(),
      [$('#setStoreCity').value.trim(),$('#setStoreState').value.trim().toUpperCase()].filter(Boolean).join('/')
    ].filter(Boolean).join(' • '),
    customerCancelMinutes:Math.max(0,Math.min(30,Number($('#setCustomerCancelMinutes').value||2))),
    notificationSound:$('#setNotificationSound').value,
    notificationVolume:Math.max(0,Math.min(100,Number($('#setNotificationVolume').value||70))),
    openMode:$('#setOpenMode').value,
    deliveryPricingMode,
    deliveryFee:fixedFee,
    deliveryZones,
    deliveryNeighborhoodFallbackFee:fallbackFee,
    restrictDeliveryZones:$('#setRestrictDeliveryZones').checked,
    deliveryKmBands,
    restrictDeliveryKm:$('#setRestrictDeliveryKm').checked,
    minimumOrder,
    allowPickup:$('#setAllowPickup').checked,
    autoAcceptOrders:$('#setAutoAccept').checked,
    payments:collectPaymentMethods(),
    schedule,
    timezone:'America/Porto_Velho',
    updatedAt:serverTimestamp()
  };

  await setDoc(doc(db,'settings','store'),settings,{merge:true});
  renderAdminBranding();
  $('#settingsSaved').classList.remove('hidden');
  setTimeout(()=>$('#settingsSaved').classList.add('hidden'),2200);
};
$('#seedBtn').onclick=async()=>{
  if(!(hasPermission('productsCreate')&&hasPermission('categoriesManage'))) return;
  const batch=writeBatch(db);

  const existingCategory=(...names)=>categories.find(c=>names.some(n=>normalizePriceKey(c.name)===normalizePriceKey(n)));
  const categoryRef=(existing,...args)=>existing?doc(db,'categories',existing.id):doc(collection(db,'categories'));

  const existingSavory=existingCategory('Pizzas Salgadas','Pizzas');
  const existingSweet=existingCategory('Pizzas Doces');
  const existingDrinks=existingCategory('Bebidas');
  const existingCombos=existingCategory('Combos');

  const catRefs={
    savory:categoryRef(existingSavory),
    sweet:categoryRef(existingSweet),
    drinks:categoryRef(existingDrinks),
    combos:categoryRef(existingCombos)
  };

  if(!existingSavory) batch.set(catRefs.savory,{name:'Pizzas Salgadas',order:1,active:true,createdAt:serverTimestamp()});
  if(!existingSweet) batch.set(catRefs.sweet,{name:'Pizzas Doces',order:2,active:true,createdAt:serverTimestamp()});
  if(!existingDrinks) batch.set(catRefs.drinks,{name:'Bebidas',order:3,active:true,createdAt:serverTimestamp()});
  if(!existingCombos) batch.set(catRefs.combos,{name:'Combos',order:4,active:true,createdAt:serverTimestamp()});

  const sizes=(p,m,g)=>[{name:'Pequena',price:p},{name:'Média',price:m},{name:'Grande',price:g}];
  const savoryExtras=[
    {name:'Borda de catupiry',price:8},
    {name:'Borda de cheddar',price:8},
    {name:'Borda de cream cheese',price:10},
    {name:'Bacon extra',price:6},
    {name:'Queijo extra',price:6}
  ];
  const image='assets/products/placeholder.svg';

  const samples=[
    {name:'Pizza Calabresa',categoryId:catRefs.savory.id,description:'Molho, muçarela, calabresa, cebola e orégano.',sizes:sizes(35,45,55),extras:savoryExtras,order:1,featured:true,isPizza:true,allowHalfHalf:true},
    {name:'Pizza Frango com Catupiry',categoryId:catRefs.savory.id,description:'Frango desfiado, catupiry, muçarela e orégano.',sizes:sizes(38,48,58),extras:savoryExtras,order:2,featured:true,isPizza:true,allowHalfHalf:true},
    {name:'Pizza Portuguesa',categoryId:catRefs.savory.id,description:'Presunto, ovos, cebola, ervilha, muçarela e orégano.',sizes:sizes(39,49,59),extras:savoryExtras,order:3,isPizza:true,allowHalfHalf:true},
    {name:'Pizza Quatro Queijos',categoryId:catRefs.savory.id,description:'Muçarela, provolone, parmesão e catupiry.',sizes:sizes(40,50,62),extras:savoryExtras,order:4,isPizza:true,allowHalfHalf:true},
    {name:'Pizza Bacon',categoryId:catRefs.savory.id,description:'Muçarela, bacon crocante, tomate e orégano.',sizes:sizes(39,49,60),extras:savoryExtras,order:5,isPizza:true,allowHalfHalf:true},
    {name:'Pizza Marguerita',categoryId:catRefs.savory.id,description:'Muçarela, tomate, manjericão e molho de tomate.',sizes:sizes(34,44,54),extras:savoryExtras,order:6,isPizza:true,allowHalfHalf:true},
    {name:'Pizza Carne Seca',categoryId:catRefs.savory.id,description:'Carne seca desfiada, cebola roxa, muçarela e catupiry.',sizes:sizes(44,56,68),extras:savoryExtras,order:7,isPizza:true,allowHalfHalf:true},
    {name:'Pizza Pepperoni',categoryId:catRefs.savory.id,description:'Muçarela, pepperoni e molho especial.',sizes:sizes(42,54,65),extras:savoryExtras,order:8,isPizza:true,allowHalfHalf:true},
    {name:'Pizza Vegetariana',categoryId:catRefs.savory.id,description:'Milho, palmito, tomate, cebola, azeitona e muçarela.',sizes:sizes(37,47,57),extras:savoryExtras,order:9,isPizza:true,allowHalfHalf:true},
    {name:'Pizza Moda da Casa',categoryId:catRefs.savory.id,description:'Calabresa, frango, bacon, muçarela e molho da casa.',sizes:sizes(45,57,69),extras:savoryExtras,order:10,featured:true,isPizza:true,allowHalfHalf:true},

    {name:'Pizza Chocolate',categoryId:catRefs.sweet.id,description:'Chocolate ao leite e granulado.',sizes:sizes(36,46,56),extras:[],order:1,isPizza:true,allowHalfHalf:false},
    {name:'Pizza Chocolate com Morango',categoryId:catRefs.sweet.id,description:'Chocolate ao leite com morangos.',sizes:sizes(40,50,62),extras:[],order:2,featured:true,isPizza:true,allowHalfHalf:false},
    {name:'Pizza Prestígio',categoryId:catRefs.sweet.id,description:'Chocolate, coco ralado e leite condensado.',sizes:sizes(39,49,59),extras:[],order:3,isPizza:true,allowHalfHalf:false},
    {name:'Pizza Romeu e Julieta',categoryId:catRefs.sweet.id,description:'Muçarela com goiabada.',sizes:sizes(37,47,57),extras:[],order:4,isPizza:true,allowHalfHalf:false},

    {name:'Coca-Cola 2L',categoryId:catRefs.drinks.id,description:'Refrigerante Coca-Cola 2 litros.',sizes:[],extras:[],price:14,order:1,featured:true},
    {name:'Coca-Cola 1L',categoryId:catRefs.drinks.id,description:'Refrigerante Coca-Cola 1 litro.',sizes:[],extras:[],price:10,order:2},
    {name:'Coca-Cola 600ml',categoryId:catRefs.drinks.id,description:'Refrigerante Coca-Cola 600 ml.',sizes:[],extras:[],price:8,order:3},
    {name:'Coca-Cola Lata 350ml',categoryId:catRefs.drinks.id,description:'Refrigerante Coca-Cola lata 350 ml.',sizes:[],extras:[],price:6,order:4},
    {name:'Guaraná Antarctica 2L',categoryId:catRefs.drinks.id,description:'Refrigerante Guaraná Antarctica 2 litros.',sizes:[],extras:[],price:12,order:5},
    {name:'Fanta Laranja 2L',categoryId:catRefs.drinks.id,description:'Refrigerante Fanta Laranja 2 litros.',sizes:[],extras:[],price:12,order:6},
    {name:'Sprite 2L',categoryId:catRefs.drinks.id,description:'Refrigerante Sprite 2 litros.',sizes:[],extras:[],price:12,order:7},
    {name:'Água Mineral 500ml',categoryId:catRefs.drinks.id,description:'Água mineral sem gás.',sizes:[],extras:[],price:4,order:8},

    {name:'Combo Família',categoryId:catRefs.combos.id,description:'1 pizza grande salgada + 1 refrigerante 2L.',sizes:[],extras:[],price:64.90,order:1,featured:true},
    {name:'Combo Casal',categoryId:catRefs.combos.id,description:'1 pizza média salgada + 2 refrigerantes lata.',sizes:[],extras:[],price:54.90,order:2},
    {name:'Combo Doce',categoryId:catRefs.combos.id,description:'1 pizza grande salgada + 1 pizza doce pequena + 1 refrigerante 2L.',sizes:[],extras:[],price:89.90,order:3}
  ].map(x=>({image,price:0,active:true,featured:false,isPizza:false,allowHalfHalf:false,...x}));

  const existingNames=new Set(products.map(p=>normalizePriceKey(p.name)));
  const missing=samples.filter(p=>!existingNames.has(normalizePriceKey(p.name)));

  for(const p of missing){
    batch.set(doc(collection(db,'products')),{...p,createdAt:serverTimestamp()});
  }

  await batch.commit();
  await Promise.all([loadCategories(),loadProducts()]);
  showToast(missing.length
    ?`Cardápio demonstrativo atualizado: ${missing.length} item(ns) adicionado(s).`
    :'O cardápio demonstrativo já está completo.','success');
};


function closeAdminDialog(dialog){
  if(dialog?.open) dialog.close();
}

$$('dialog').forEach(dialog=>{
  dialog.querySelectorAll('.dialog-close').forEach(btn=>btn.addEventListener('click',()=>closeAdminDialog(dialog)));
  dialog.addEventListener('cancel',e=>{
    e.preventDefault();
    closeAdminDialog(dialog);
  });
  dialog.addEventListener('click',e=>{
    if(e.target===dialog) closeAdminDialog(dialog);
  });
});

function formatDate(ts){
  try{
    return ts?.toDate?.().toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})||'Agora';
  }catch{
    return '—';
  }
}

function esc(v){
  return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}


async function loadCustomers(){
  customers=[];
  renderCustomers();
}

function customerOperationalRows(){
  const grouped=new Map();
  for(const order of orders){
    const customerId=String(order.customerId||'');
    if(!customerId) continue;
    const current=grouped.get(customerId)||{
      uid:customerId,
      orders:0,
      completed:0,
      spent:0,
      lastAt:null
    };
    current.orders++;
    if(order.status==='completed'){
      current.completed++;
      const total=Number(order.total||0);
      if(Number.isFinite(total)&&total>=0) current.spent+=total;
    }
    const stamp=order.createdAt?.toMillis?.()||0;
    const previous=current.lastAt?.toMillis?.()||0;
    if(stamp>previous) current.lastAt=order.createdAt;
    grouped.set(customerId,current);
  }
  return [...grouped.values()].sort((a,b)=>
    (b.lastAt?.toMillis?.()||0)-(a.lastAt?.toMillis?.()||0)
  );
}

function renderCustomers(){
  if(!$('#customersTable')) return;

  const term=($('#customerSearch')?.value||'').trim().toLowerCase();
  const rows=customerOperationalRows();
  const list=rows.filter(customer=>{
    const reference='cliente '+customer.uid.slice(-6);
    return !term||reference.toLowerCase().includes(term);
  });

  $('#customersTable').innerHTML=list.length?list.map(customer=>{
    const reference='Cliente • '+customer.uid.slice(-6).toUpperCase();
    return `<div class="data-row">
      <div class="data-main">
        <strong>${esc(reference)}</strong>
        <small>Resumo operacional anonimizado • último pedido: ${formatDate(customer.lastAt)}</small>
      </div>
      <span>${customer.orders} pedido(s)</span>
      <div><strong>${money(customer.spent)}</strong><small class="muted" style="display:block">${customer.completed} concluído(s)</small></div>
    </div>`;
  }).join(''):emptyStateHtml({icon:'users',title:'Nenhum cliente encontrado',description:'O resumo aparece a partir dos pedidos, sem expor ficha cadastral, telefone ou e-mail.'});
}

$('#customerSearch')?.addEventListener('input',renderCustomers);


async function loadUsers(){
  if(!isMaster()) return;
  try{
    const s=await getDocs(collection(db,'users'));
    users=s.docs.map(d=>({uid:d.id,...d.data()})).sort((a,b)=>(a.username||'').localeCompare(b.username||''));
  }catch(err){
    console.warn('Coleção de usuários ainda não liberada pelas regras publicadas.',err);
    users=[];
  }
  if(!users.some(u=>u.uid===auth.currentUser?.uid) && currentProfile?.bootstrap){
    users.unshift({...currentProfile});
  }
  renderUsers();
  renderRoles();
}

function renderUsers(){
  if(!isMaster()) return;
  $('#usersTable').innerHTML=users.length?users.map(u=>`
    <div class="data-row">
      <div class="data-main">
        <strong>${esc(u.displayName||u.username||'Usuário')}</strong>
        <small>@${esc(u.username||'')} • ${roleLabel(u.role)} • ${u.active===false?'Desativado':'Ativo'}${u.uid===auth.currentUser?.uid?' • Você':''}</small>
      </div>
      <span class="status-pill ${u.active===false?'status-cancelled':'status-completed'}">${u.active===false?'Desativado':'Ativo'}</span>
      <div class="data-actions">
        <button class="btn btn-secondary edit-user" data-uid="${u.uid}">${u.bootstrap?'Registrar perfil':'Editar'}</button>
        ${!u.bootstrap?`<button class="btn btn-secondary password-user" data-uid="${u.uid}">Trocar senha</button>`:''}
        ${u.uid!==auth.currentUser?.uid&&!u.bootstrap?`<button class="btn ${u.active===false?'btn-secondary':'btn-danger'} toggle-user" data-uid="${u.uid}">${u.active===false?'Ativar':'Desativar'}</button>`:''}
        ${u.uid!==auth.currentUser?.uid&&!u.bootstrap?`<button class="btn btn-danger delete-user" data-uid="${u.uid}">Excluir</button>`:''}
      </div>
    </div>`).join(''):emptyStateHtml({icon:'users',title:'Nenhum usuário cadastrado',description:'Os funcionários autorizados aparecerão aqui.'});

  document.querySelectorAll('.edit-user').forEach(b=>b.onclick=()=>editUser(b.dataset.uid));
  document.querySelectorAll('.password-user').forEach(b=>b.onclick=()=>openUserPasswordDialog(b.dataset.uid));
  document.querySelectorAll('.toggle-user').forEach(b=>b.onclick=()=>toggleUser(b.dataset.uid));
  document.querySelectorAll('.delete-user').forEach(b=>b.onclick=()=>removeUser(b.dataset.uid));
}

$('#newUserBtn').onclick=()=>{
  if(!isMaster()) return;
  editUser(null);
};

function editUser(uid){
  if(!isMaster()) return;
  const u=users.find(x=>x.uid===uid);
  const isExisting=!!u&&!u.bootstrap;
  $('#userEditorTitle').textContent=u?(u.bootstrap?'Registrar Master':'Editar usuário'):'Novo usuário';
  $('#userUid').value=u?.uid||'';
  $('#userDisplayName').value=u?.displayName||'';
  $('#userUsername').value=u?.username||'';
  $('#userUsername').disabled=isExisting||u?.bootstrap;
  $('#userPassword').value='';
  $('#userPassword').required=!u;
  $('#userPasswordField').classList.toggle('hidden',!!u);
  $('#userRole').value=u?.role||'cashier';
  $('#userRole').disabled=u?.uid===auth.currentUser?.uid;
  $('#userActive').checked=true;
  $('#userActive').closest('.check-row')?.classList.add('hidden');
  $('#userEditorHelp').textContent=u
    ?'Use os botões da lista para ativar/desativar, trocar a senha ou excluir o usuário.'
    :'O novo usuário será criado ativo. Depois você pode desativá-lo pela lista.';
  $('#userEditorError').classList.add('hidden');
  $('#userEditor').showModal();
}

$('#userEditorForm').onsubmit=async e=>{
  e.preventDefault();
  if(!isMaster()) return;

  const existingUid=$('#userUid').value;
  const username=normalizeUsername($('#userUsername').value);
  const displayName=$('#userDisplayName').value.trim()||username;
  const requestedRole=$('#userRole').value;
  const existingUser=users.find(x=>x.uid===existingUid);
  $('#userEditorError').classList.add('hidden');

  if(!username||username.length<3){
    return userEditorError('O usuário precisa ter pelo menos 3 caracteres.');
  }

  if(existingUser?.role==='master'&&existingUid!==auth.currentUser?.uid){
    return userEditorError('Outra conta Master não pode ser rebaixada por esta tela.');
  }

  try{
    if(existingUid){
      const role=existingUser?.role==='master'?'master':requestedRole;
      await staffUserAdminAction('update',existingUid,{displayName,role});
      if(existingUid===auth.currentUser?.uid){
        currentProfile={...currentProfile,displayName};
      }
    }else{
      const password=$('#userPassword').value;
      if(password.length<10||!/[A-Za-z]/.test(password)||!/\d/.test(password)){
        return userEditorError('A senha precisa ter pelo menos 10 caracteres, com letra e número.');
      }
      if(requestedRole==='master'){
        return userEditorError('Novos usuários operacionais não podem receber o perfil Master.');
      }
      await staffUserAdminAction('create','',{username,displayName,role:requestedRole,password});
    }

    $('#userEditor').close();
    await loadUsers();
    $('#currentUserDisplay').textContent=(currentProfile.displayName||currentProfile.username)+' • '+roleLabel(currentProfile.role);
  }catch(err){
    console.error(err);
    const code=String(err?.code||err?.message||'');
    if(code.includes('username_in_use')) return userEditorError('Esse nome de usuário já existe.');
    if(code.includes('invalid_role')) return userEditorError('Escolha um perfil operacional ativo.');
    if(code.includes('invalid_password')) return userEditorError('A senha precisa ter pelo menos 10 caracteres, com letra e número.');
    if(code.includes('master_protected')) return userEditorError('A conta Master é protegida.');
    userEditorError('Não foi possível salvar o usuário.');
  }
};

function userEditorError(message){
  $('#userEditorError').textContent=message;
  $('#userEditorError').classList.remove('hidden');
}

async function staffUserAdminAction(action,uid,extra={}){
  const user=auth.currentUser;
  if(!user) throw new Error('auth-required');
  const token=await user.getIdToken();
  const response=await fetch(STAFF_USER_ADMIN_ENDPOINT,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'Authorization':'Bearer '+token
    },
    body:JSON.stringify({action,uid,...extra})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const err=new Error(data?.error||'staff-user-action-failed');
    err.code=data?.error||'staff-user-action-failed';
    throw err;
  }
  return data;
}

function staffUserActionMessage(err){
  const code=String(err?.code||err?.message||'');
  if(code.includes('last_master')) return 'Não é possível desativar ou excluir o último Master ativo do sistema.';
  if(code.includes('master_protected')) return 'Somente um Master pode administrar outra conta Master.';
  if(code.includes('self_status_change')) return 'Você não pode desativar a própria conta.';
  if(code.includes('self_delete')) return 'Você não pode excluir a própria conta.';
  if(code.includes('invalid_password')) return 'A senha precisa ter entre 6 e 128 caracteres.';
  if(code.includes('user_not_found')) return 'Este usuário não existe mais.';
  if(code.includes('permission_denied')) return 'Seu perfil não possui permissão para administrar este usuário.';
  return 'Não foi possível concluir a ação. Verifique as Firebase Functions e tente novamente.';
}

async function toggleUser(uid){
  if(!isMaster()||uid===auth.currentUser?.uid) return;
  const u=users.find(x=>x.uid===uid);
  if(!u) return;

  const next=u.active===false;
  if(!next&&!await confirmAction(`Desativar o usuário “${u.username}”? O login dele será bloqueado no Firebase Authentication.`,{title:'Desativar usuário',confirmText:'Desativar',danger:true})) return;

  try{
    await staffUserAdminAction('setActive',uid,{active:next});
    await loadUsers();
  }catch(err){
    console.error(err);
    showToast(staffUserActionMessage(err),'error');
  }
}

function openUserPasswordDialog(uid){
  if(!isMaster()) return;
  const u=users.find(x=>x.uid===uid);
  if(!u||u.bootstrap) return;

  $('#userPasswordTargetUid').value=uid;
  $('#userPasswordTargetName').textContent=u.displayName||u.username||'Usuário';
  $('#userNewPassword').value='';
  $('#userConfirmPassword').value='';
  $('#userPasswordError').classList.add('hidden');
  $('#userPasswordDialog').showModal();
  setTimeout(()=>$('#userNewPassword').focus(),50);
}

$('#userPasswordForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const uid=$('#userPasswordTargetUid').value;
  const password=$('#userNewPassword').value;
  const confirmPassword=$('#userConfirmPassword').value;
  $('#userPasswordError').classList.add('hidden');

  if(password.length<10||!/[A-Za-z]/.test(password)||!/d/.test(password)){
    $('#userPasswordError').textContent='A senha precisa ter pelo menos 10 caracteres, com letra e número.';
    $('#userPasswordError').classList.remove('hidden');
    return;
  }
  if(password!==confirmPassword){
    $('#userPasswordError').textContent='As senhas não coincidem.';
    $('#userPasswordError').classList.remove('hidden');
    return;
  }

  const submit=$('#saveUserPasswordBtn');
  submit.disabled=true;
  submit.textContent='Alterando...';
  try{
    await staffUserAdminAction('setPassword',uid,{password});
    $('#userPasswordDialog').close();
    showToast('Senha alterada com sucesso.','success');
  }catch(err){
    console.error(err);
    $('#userPasswordError').textContent=staffUserActionMessage(err);
    $('#userPasswordError').classList.remove('hidden');
  }finally{
    submit.disabled=false;
    submit.textContent='Alterar senha';
  }
});

async function removeUser(uid){
  if(!isMaster()||uid===auth.currentUser?.uid) return;
  const u=users.find(x=>x.uid===uid);
  if(!u||u.bootstrap) return;

  const name=u.displayName||u.username||'Usuário';
  if(!await confirmAction(`Excluir o usuário “${name}”?\n\nA conta de login também será excluída do Firebase Authentication. Esta ação não pode ser desfeita.`,{title:'Excluir usuário',confirmText:'Excluir definitivamente',danger:true})) return;

  try{
    await staffUserAdminAction('delete',uid);
    await loadUsers();
  }catch(err){
    console.error(err);
    showToast(staffUserActionMessage(err),'error');
  }
}
