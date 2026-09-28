import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, deleteUser } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp, writeBatch } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from '../firebase-config.js';

const app=initializeApp(firebaseConfig);
const auth=getAuth(app);
const db=getFirestore(app);
const userCreatorApp=initializeApp(firebaseConfig,'delivery-user-creator');
const userCreatorAuth=getAuth(userCreatorApp);
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0));

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
  ['customersView','Clientes','Visualizar clientes'],
  ['printingManage','Operação','Configurar impressão'],
  ['cashView','Financeiro','Visualizar caixa e financeiro'],
  ['cashOperate','Financeiro','Abrir e fechar caixa'],
  ['settingsManage','Sistema','Alterar configurações da pizzaria'],
  ['usersManage','Sistema','Criar e editar usuários'],
  ['rolesManage','Sistema','Criar e editar perfis de acesso']
];

const defaultRoleTemplates={
  manager:{name:'Gerente',permissions:{
    ordersView:true,ordersAccept:true,ordersPrepare:true,ordersDispatch:true,ordersComplete:true,ordersCancel:true,
    productsView:true,productsCreate:true,productsEdit:true,productsDelete:true,categoriesManage:true,
    promotionsManage:true,couponsManage:true,customersView:true,printingManage:true,cashView:true,cashOperate:true,
    settingsManage:true,usersManage:false,rolesManage:false
  }},
  cashier:{name:'Caixa',permissions:{
    ordersView:true,ordersAccept:true,ordersPrepare:false,ordersDispatch:false,ordersComplete:false,ordersCancel:true,
    productsView:false,productsCreate:false,productsEdit:false,productsDelete:false,categoriesManage:false,
    promotionsManage:false,couponsManage:false,customersView:true,printingManage:true,cashView:true,cashOperate:true,
    settingsManage:false,usersManage:false,rolesManage:false
  }},
  kitchen:{name:'Cozinha',permissions:{
    ordersView:true,ordersAccept:false,ordersPrepare:true,ordersDispatch:false,ordersComplete:false,ordersCancel:false,
    productsView:false,productsCreate:false,productsEdit:false,productsDelete:false,categoriesManage:false,
    promotionsManage:false,couponsManage:false,customersView:false,printingManage:false,cashView:false,cashOperate:false,
    settingsManage:false,usersManage:false,rolesManage:false
  }},
  delivery:{name:'Entrega',permissions:{
    ordersView:true,ordersAccept:false,ordersPrepare:false,ordersDispatch:true,ordersComplete:true,ordersCancel:false,
    productsView:false,productsCreate:false,productsEdit:false,productsDelete:false,categoriesManage:false,
    promotionsManage:false,couponsManage:false,customersView:false,printingManage:false,cashView:false,cashOperate:false,
    settingsManage:false,usersManage:false,rolesManage:false
  }},
  operator:{name:'Operador',permissions:{
    ordersView:true,ordersAccept:true,ordersPrepare:true,ordersDispatch:true,ordersComplete:true,ordersCancel:true,
    productsView:false,productsCreate:false,productsEdit:false,productsDelete:false,categoriesManage:false,
    promotionsManage:false,couponsManage:false,customersView:false,printingManage:false,cashView:false,cashOperate:false,
    settingsManage:false,usersManage:false,rolesManage:false
  }}
};

let categories=[],products=[],orders=[],settings={},users=[],customers=[],roles=[],promotions=[],coupons=[],cashSessions=[],currentCashSession=null,currentProfile=null;
let unsubscribeOrders=null,soundEnabled=false,knownOrderIds=new Set();
let printConfig={
  printer:localStorage.getItem('deliveryPrinter')||'',
  autoPrint:localStorage.getItem('deliveryAutoPrint')==='1',
  printPending:localStorage.getItem('deliveryPrintPending')==='1'
};
const PRINT_AGENT='http://127.0.0.1:17329';
const printedOrderIds=new Set(JSON.parse(sessionStorage.getItem('deliveryPrintedOrders')||'[]'));

const defaults={
  storeName:'Delivery Pizzaria',
  subtitle:'Pizza quentinha, do forno para sua casa.',
  phone:'',
  storeAddress:'',
  deliveryFee:5,
  deliveryZones:[],
  restrictDeliveryZones:false,
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
  try{
    const snap=await getDoc(doc(db,'staffLogins',normalized));
    if(snap.exists()&&snap.data()?.email) return String(snap.data().email);
  }catch(err){
    console.warn('Não foi possível consultar o mapa de login administrativo.',err);
  }
  return legacyUsernameEmail(normalized);
}
function roleLabel(role){
  if(role==='master') return 'Master';
  return roles.find(r=>r.id===role)?.name||defaultRoleTemplates[role]?.name||role||'Sem perfil';
}
function isMaster(){
  return currentProfile?.role==='master';
}
function rolePermissions(role=currentProfile?.role){
  if(role==='master'){
    return Object.fromEntries(permissionDefinitions.map(([key])=>[key,true]));
  }
  return roles.find(r=>r.id===role)?.permissions||defaultRoleTemplates[role]?.permissions||{};
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

$('#logoutBtn').onclick=()=>signOut(auth);

onAuthStateChanged(auth,async user=>{
  $('#loginError').classList.add('hidden');

  if(!user){
    currentProfile=null;
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

    // Garante que logins antigos (inclusive o Master inicial) ganhem o novo
    // mapeamento username -> e-mail sem expor isso na interface.
    const normalized=currentProfile.username||username;
    try{
      await setDoc(doc(db,'staffLogins',normalizeUsername(normalized)),{
        uid:user.uid,
        email:user.email||'',
        updatedAt:serverTimestamp()
      },{merge:true});
    }catch(mappingError){
      console.warn('Não foi possível atualizar o mapa de login.',mappingError);
    }

    // A autenticação terminou com sucesso. O painel não volta para a tela
    // de login por causa de uma falha posterior do Firestore.
    $('#loginView').classList.add('hidden');
    $('#adminApp').classList.remove('hidden');
    $('#currentUserDisplay').textContent=`${currentProfile.displayName||currentProfile.username||username} • ${roleLabel(currentProfile.role)}`;
    $$$('.master-only').forEach(el=>el.classList.toggle('hidden',!isMaster()));
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

  const tasks=[];

  // Produtos também são carregados para quem trabalha com pedidos, pois o
  // painel confere os preços antes de aceitar/imprimir.
  if(hasPermission('ordersView')||hasPermission('productsView')||hasPermission('productsCreate')||hasPermission('productsEdit')||hasPermission('promotionsManage')){
    tasks.push(loadCategories(),loadProducts());
  }

  if(hasPermission('customersView')) tasks.push(loadCustomers());
  if(hasPermission('usersManage')) tasks.push(loadUsers());
  if(hasPermission('ordersView')||hasPermission('promotionsManage')) tasks.push(loadPromotions());
  if(hasPermission('ordersView')||hasPermission('couponsManage')) tasks.push(loadCoupons());
  if(hasPermission('cashView')) tasks.push(loadCashSessions());

  await Promise.all(tasks);

  if(hasPermission('ordersView')||hasPermission('cashView')) listenOrders();

  if(hasPermission('settingsManage')){
    renderSchedules();
    renderSettings();
  }

  if(hasPermission('printingManage')){
    loadPrintSettingsUI();
    checkPrintAgent();
  }

  if(hasPermission('cashView')) renderCash();
}
async function loadRoles(){
  try{
    const snap=await getDocs(collection(db,'roles'));
    roles=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.name||'').localeCompare(b.name||''));

    if(!roles.length&&isMaster()){
      const batch=writeBatch(db);
      for(const [id,template] of Object.entries(defaultRoleTemplates)){
        batch.set(doc(db,'roles',id),{
          name:template.name,
          permissions:template.permissions,
          system:true,
          active:true,
          createdAt:serverTimestamp(),
          updatedAt:serverTimestamp()
        });
      }
      await batch.commit();
      const seeded=await getDocs(collection(db,'roles'));
      roles=seeded.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
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
  select.innerHTML=opts+`<option value="master">Master</option>`;
  if([...select.options].some(o=>o.value===current)) select.value=current;
}

async function loadSettings(){
  const snap=await getDoc(doc(db,'settings','store'));
  settings=snap.exists()?{...defaults,...snap.data()}:defaults;
  if(!snap.exists()&&['master','manager'].includes(currentProfile?.role)){
    await setDoc(doc(db,'settings','store'),settings);
  }
  $('#adminStoreName').textContent=settings.storeName||'Pizzaria';
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
    if(customers.length) renderCustomers();
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

function beep(){
  const c=new AudioContext(),osc=c.createOscillator(),gain=c.createGain();
  osc.connect(gain); gain.connect(c.destination);
  osc.frequency.value=880; gain.gain.value=.08; osc.start();
  setTimeout(()=>{osc.stop();c.close();},400);
}

$('#soundBtn').onclick=async()=>{
  soundEnabled=!soundEnabled;
  if(soundEnabled&&'Notification' in window&&Notification.permission==='default'){
    await Notification.requestPermission();
  }
  $('#soundBtn').textContent=soundEnabled?'🔔 Som ativado':'🔕 Ativar som';
  if(soundEnabled) beep();
};

$$$('.nav-item').forEach(b=>b.onclick=()=>switchView(b.dataset.view));

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
  if(hasPermission('usersManage')) views.push('users');
  if(hasPermission('rolesManage')) views.push('roles');
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

  $$$('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===v));
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
    settings:['SISTEMA','Configurações']
  };

  $('#viewEyebrow').textContent=titles[v][0];
  $('#viewTitle').textContent=titles[v][1];

  if(v==='printing') checkPrintAgent();
  if(v==='cash') renderCash();
  if(v==='roles') renderRoles();
}

function normalizePriceKey(value){
  return String(value||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ');
}

function expectedDeliveryFee(order){
  if(order.fulfillment==='pickup') return 0;
  const fallback=Number(settings.deliveryFee||0);
  const zones=Array.isArray(settings.deliveryZones)?settings.deliveryZones:[];
  const neighborhood=normalizePriceKey(order.address?.neighborhood);
  const zone=zones.find(z=>normalizePriceKey(z.neighborhood)===neighborhood);
  return zone?Number(zone.fee||0):fallback;
}

function applyOrderPromotion(base,item){
  if(!item?.promotion) return {ok:true,value:base};
  const promo=promotions.find(p=>p.id===item.promotion.id);
  if(!promo) return {ok:false,reason:`Promoção inválida em ${item.name}.`,value:base};
  const sameType=promo.discountType===item.promotion.discountType;
  const sameValue=Math.abs(Number(promo.discountValue||0)-Number(item.promotion.discountValue||0))<0.009;
  if(!sameType||!sameValue) return {ok:false,reason:`Dados da promoção divergentes em ${item.name}.`,value:base};
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
    const coupon=coupons.find(cp=>cp.id===order.coupon.id||cp.code===order.coupon.code);
    if(!coupon){
      issues.push('Cupom do pedido não existe no cadastro atual.');
    }else{
      const sameType=coupon.type===order.coupon.type;
      const sameValue=Math.abs(Number(coupon.value||0)-Number(order.coupon.value||0))<0.009;
      if(!sameType||!sameValue){
        issues.push('Dados do cupom divergem do cadastro.');
      }
      expectedDiscount=coupon.type==='percentage'
        ?expectedSubtotal*Number(coupon.value||0)/100
        :Number(coupon.value||0);
      if(Number(coupon.maxDiscount||0)>0) expectedDiscount=Math.min(expectedDiscount,Number(coupon.maxDiscount));
      expectedDiscount=Math.max(0,Math.min(expectedSubtotal,expectedDiscount));
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
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:settings.timezone||'America/Porto_Velho'}).format(new Date());
  const sameDay=o=>{
    const d=o.createdAt?.toDate?.();
    return d&&new Intl.DateTimeFormat('en-CA',{timeZone:settings.timezone||'America/Porto_Velho'}).format(d)===today;
  };
  $('#statPending').textContent=orders.filter(o=>o.status==='pending').length;
  $('#statAccepted').textContent=orders.filter(o=>o.status==='accepted').length;
  $('#statPreparing').textContent=orders.filter(o=>o.status==='preparing').length;
  $('#statToday').textContent=orders.filter(sameDay).length;
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
      const proceed=confirm('Os valores deste pedido divergem do cardápio atual. Deseja aceitar mesmo assim?\n\n'+pricing.issues.join('\n'));
      if(!proceed) return;
    }
  }
  const patch={status,updatedAt:serverTimestamp()};
  if(status==='accepted') patch.acceptedAt=serverTimestamp();
  if(status==='completed') patch.completedAt=serverTimestamp();
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
    const text=`${o.orderNumber} ${o.customer?.name||''} ${o.customer?.phone||''}`.toLowerCase();
    return !term||text.includes(term);
  });

  $('#ordersList').innerHTML=list.length?list.map(o=>{
    const pricing=verifyOrderPricing(o);
    const quick=quickTransition(o);
    return `<article class="order-row order-row-modern" data-id="${o.id}">
      <button class="order-main-hit" data-open-order="${o.id}" type="button" aria-label="Abrir pedido #${o.orderNumber}">
        <span class="order-number">#${String(o.orderNumber||0).padStart(4,'0')}</span>
        <span class="order-meta"><strong>${esc(o.customer?.name||'Cliente')}</strong><small>${esc(o.customer?.phone||'')} • ${formatDate(o.createdAt)}${pricing.valid?'':' • ⚠ valores divergentes'}</small></span>
        <span class="status-pill status-${o.status}">${statusLabels[o.status]||o.status}</span>
        <strong class="order-total">${money(o.total)}</strong>
      </button>
      <div class="order-row-actions">
        ${quick?`<button class="btn btn-primary quick-order-action" data-id="${o.id}" data-status="${quick.status}" type="button">${quick.label}</button>`:''}
        <button class="btn btn-secondary order-details-action" data-id="${o.id}" type="button">Detalhes</button>
      </div>
    </article>`;
  }).join(''):'<div class="empty-state">Nenhum pedido encontrado.</div>';

  $$('[data-open-order]').forEach(b=>b.onclick=()=>openOrder(b.dataset.openOrder));
  $$('.order-details-action').forEach(b=>b.onclick=()=>openOrder(b.dataset.id));
  $$('.quick-order-action').forEach(b=>b.onclick=async()=>{
    b.disabled=true;
    try{
      const order=orders.find(o=>o.id===b.dataset.id);
      await updateOrderStatus(order,b.dataset.status);
    }catch(err){
      console.error(err);
      alert('Não foi possível atualizar o pedido.');
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
      <button class="btn btn-secondary" id="printOrderBtn">🖨️ Imprimir comanda</button>
    </div>
  `;

  async function changeStatus(status){
    await updateOrderStatus(o,status);
    $('#orderDialog').close();
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
  if($('#cashierAutoAccept')) $('#cashierAutoAccept').checked=!!settings.autoAcceptOrders;
}

function savePrintSettings(){
  if(!$('#localPrinterSelect')) return;
  printConfig={
    printer:$('#localPrinterSelect').value,
    autoPrint:$('#localAutoPrint').checked,
    printPending:$('#localPrintPending').checked
  };

  localStorage.setItem('deliveryPrinter',printConfig.printer);
  localStorage.setItem('deliveryAutoPrint',printConfig.autoPrint?'1':'0');
  localStorage.setItem('deliveryPrintPending',printConfig.printPending?'1':'0');
}

async function checkPrintAgent(){
  const status=$('#printerAgentStatus');
  const select=$('#localPrinterSelect');
  if(!status||!select) return false;

  try{
    const response=await fetch(PRINT_AGENT+'/printers',{cache:'no-store'});
    if(!response.ok) throw new Error('agent');

    const data=await response.json();
    const printers=Array.isArray(data.printers)?data.printers:[];

    select.innerHTML='<option value="">Selecione...</option>'+
      printers.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('');

    if(printConfig.printer&&printers.includes(printConfig.printer)){
      select.value=printConfig.printer;
    }

    status.textContent='● Print Agent conectado • '+printers.length+' impressora(s)';
    status.classList.add('ok');
    status.classList.remove('off');
    return true;
  }catch(err){
    status.textContent='● Print Agent desconectado';
    status.classList.add('off');
    status.classList.remove('ok');
    select.innerHTML='<option value="">Print Agent não encontrado</option>';
    return false;
  }
}

function centerText(text,width=42){
  text=String(text||'');
  if(text.length>=width) return text;
  const left=Math.floor((width-text.length)/2);
  return ' '.repeat(left)+text;
}

function receiptText(o){
  const width=42;
  const divider='-'.repeat(width);
  const lines=[];

  lines.push(centerText(settings.storeName||'PIZZARIA',width));
  if(settings.phone) lines.push(centerText(settings.phone,width));
  lines.push(divider);
  lines.push(centerText('PEDIDO #'+String(o.orderNumber||0).padStart(4,'0'),width));
  const pricing=verifyOrderPricing(o);
  if(!pricing.valid){
    lines.push(centerText('*** ATENCAO: VALORES DIVERGENTES ***',width));
  }
  lines.push(formatDate(o.createdAt));
  lines.push('STATUS: '+(statusLabels[o.status]||o.status));
  lines.push(divider);
  lines.push('CLIENTE: '+(o.customer?.name||''));
  lines.push('FONE: '+(o.customer?.phone||''));
  lines.push(o.fulfillment==='pickup'?'RETIRADA NO LOCAL':'ENTREGA: '+orderAddressText(o));
  lines.push(divider);
  lines.push('ITENS');

  for(const item of (o.items||[])){
    lines.push(String(item.qty)+'x '+String(item.name||''));
    if(item.size?.name) lines.push('  Tamanho: '+item.size.name);
    if(item.extras?.length) lines.push('  Adic.: '+item.extras.map(x=>x.name).join(', '));
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
  lines.push(centerText('*** FIM DA COMANDA ***',width));
  lines.push('');
  lines.push('');
  return lines.join('\n');
}

async function sendToPrintAgent(text){
  if(!printConfig.printer) throw new Error('printer-not-selected');

  const response=await fetch(PRINT_AGENT+'/print',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      printer:printConfig.printer,
      text,
      copies:1
    })
  });

  if(!response.ok){
    const message=await response.text().catch(()=>'');
    throw new Error(message||'print-failed');
  }
}

async function printOrder(order,automatic=false){
  if(automatic&&order?.id&&printedOrderIds.has(order.id)) return true;

  const connected=await checkPrintAgent();

  if(connected&&printConfig.printer){
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
    showSystemAlert('Pedido recebido, mas a impressão automática não foi realizada. Abra “Impressão” e verifique o Print Agent e a impressora selecionada.');
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
    alert('Modo de confirmação atualizado.');
  }catch(err){
    console.error(err);
    alert('Você não tem permissão para alterar o modo de confirmação.');
  }
});

$('#refreshPrintersBtn')?.addEventListener('click',checkPrintAgent);

$('#savePrintSettingsBtn')?.addEventListener('click',()=>{
  savePrintSettings();
  checkPrintAgent();
  alert('Configuração desta estação salva.');
});

$('#testPrintBtn')?.addEventListener('click',async()=>{
  savePrintSettings();
  try{
    const text=[
      centerText(settings.storeName||'DELIVERY PIZZARIA'),
      '------------------------------------------',
      centerText('TESTE DE IMPRESSAO'),
      '',
      'Impressora: '+(printConfig.printer||''),
      'Data: '+new Date().toLocaleString('pt-BR'),
      '',
      centerText('Print Agent funcionando'),
      '',
      ''
    ].join('\n');

    await sendToPrintAgent(text);
    alert('Teste enviado para a impressora.');
  }catch(err){
    console.error(err);
    alert('Não foi possível imprimir. Verifique se o Print Agent está aberto e se uma impressora foi selecionada.');
  }
});



/* ===== Perfis de acesso ===== */
function renderRoles(){
  const table=$('#rolesTable');
  if(!table) return;
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
  }).join(''):'<div class="empty-state">Nenhum perfil personalizado.</div>';

  $$('.edit-role').forEach(b=>b.onclick=()=>editRole(b.dataset.id));
  $$('.delete-role').forEach(b=>b.onclick=()=>deleteRole(b.dataset.id));
}

function renderPermissionEditor(selected={}){
  const host=$('#rolePermissionsEditor');
  if(!host) return;
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
}

function editRole(id=null){
  if(!hasPermission('rolesManage')) return;
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
  if(!hasPermission('rolesManage')) return;
  const id=$('#roleId').value;
  const name=$('#roleName').value.trim();
  if(!name){
    $('#roleEditorError').textContent='Informe o nome do perfil.';
    $('#roleEditorError').classList.remove('hidden');
    return;
  }
  const permissions={};
  $$('[data-permission]').forEach(input=>permissions[input.dataset.permission]=input.checked);
  try{
    if(id){
      await updateDoc(doc(db,'roles',id),{name,permissions,active:true,updatedAt:serverTimestamp()});
    }else{
      await addDoc(collection(db,'roles'),{name,permissions,active:true,system:false,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    }
    $('#roleEditor').close();
    await loadRoles();
    if(hasPermission('usersManage')) await loadUsers();
  }catch(err){
    console.error(err);
    $('#roleEditorError').textContent='Não foi possível salvar o perfil.';
    $('#roleEditorError').classList.remove('hidden');
  }
});

async function deleteRole(id){
  if(!hasPermission('rolesManage')) return;
  if(users.some(u=>u.role===id)) return alert('Este perfil está sendo usado por um ou mais usuários. Troque o perfil desses usuários antes de excluir.');
  const role=roles.find(r=>r.id===id);
  if(!role||role.system) return;
  if(!confirm(`Excluir o perfil “${role.name}”?`)) return;
  await deleteDoc(doc(db,'roles',id));
  await loadRoles();
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
  `).join(''):'<div class="empty-state">Nenhuma promoção cadastrada.</div>';
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

function editPromotion(id=null){
  if(!hasPermission('promotionsManage')) return;
  const p=promotions.find(x=>x.id===id);
  $('#promotionEditorTitle').textContent=p?'Editar promoção':'Nova promoção';
  $('#promotionId').value=p?.id||'';
  $('#promotionName').value=p?.name||'';
  $('#promotionDescription').value=p?.description||'';
  $('#promotionDiscountType').value=p?.discountType||'percentage';
  $('#promotionDiscountValue').value=p?.discountValue??'';
  $('#promotionTargetType').value=p?.targetType||'all';
  refreshPromotionTarget();
  $('#promotionTargetId').value=p?.targetId||'';
  $('#promotionStartsAt').value=p?.startsAt||'';
  $('#promotionEndsAt').value=p?.endsAt||'';
  $('#promotionActive').checked=p?.active!==false;
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
  if(!data.name||data.discountValue<=0){
    $('#promotionEditorError').textContent='Informe nome e desconto válido.';
    $('#promotionEditorError').classList.remove('hidden');
    return;
  }
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
  if(!confirm(`Excluir a promoção “${p?.name||''}”?`)) return;
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
  `).join(''):'<div class="empty-state">Nenhum cupom cadastrado.</div>';
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
    active:$('#couponActive').checked,
    updatedAt:serverTimestamp()
  };
  if(!code||data.value<=0){
    $('#couponEditorError').textContent='Informe um código e um desconto válido.';
    $('#couponEditorError').classList.remove('hidden');
    return;
  }
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
  if(!confirm(`Excluir o cupom “${cp?.code||id}”?`)) return;
  await deleteDoc(doc(db,'coupons',id));
  await loadCoupons();
}

/* ===== Caixa financeiro ===== */
async function loadCashSessions(){
  try{
    const snap=await getDocs(query(collection(db,'cashSessions'),orderBy('openedAt','desc')));
    cashSessions=snap.docs.map(d=>({id:d.id,...d.data()}));
    currentCashSession=cashSessions.find(s=>s.status==='open')||null;
  }catch(err){
    console.warn('Caixas indisponíveis.',err);
    cashSessions=[];
    currentCashSession=null;
  }
  renderCash();
}

function orderWithinCash(order,session){
  if(!session||order.status!=='completed') return false;
  const ts=order.completedAt?.toMillis?.()||order.createdAt?.toMillis?.()||0;
  const start=session.openedAt?.toMillis?.()||0;
  const end=session.closedAt?.toMillis?.()||Date.now();
  return ts>=start&&ts<=end;
}

function cashSummary(session=currentCashSession){
  const list=session?orders.filter(o=>orderWithinCash(o,session)):[];
  const summary={count:list.length,gross:0,money:0,pix:0,debit:0,credit:0,other:0};
  for(const o of list){
    const value=Number(o.total||0);
    summary.gross+=value;
    const method=String(o.payment?.method||'').toLowerCase();
    if(method.includes('dinheiro')) summary.money+=value;
    else if(method.includes('pix')) summary.pix+=value;
    else if(method.includes('débito')||method.includes('debito')) summary.debit+=value;
    else if(method.includes('crédito')||method.includes('credito')) summary.credit+=value;
    else summary.other+=value;
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
    $('#cashSessionMeta').innerHTML=`<p><strong>Aberto por:</strong> ${esc(currentCashSession.openedByName||'Usuário')}</p><p><strong>Valor inicial:</strong> ${money(currentCashSession.openingAmount)}</p><p><strong>Abertura:</strong> ${formatDate(currentCashSession.openedAt)}</p>`;
  }

  $('#cashHistory').innerHTML=cashSessions.length?cashSessions.slice(0,20).map(s=>{
    const sum=s.summary||cashSummary(s);
    return `<div class="data-row"><div class="data-main"><strong>${s.status==='open'?'Caixa aberto':'Caixa fechado'}</strong><small>${formatDate(s.openedAt)} • ${esc(s.openedByName||'')}</small></div><span>${Number(sum.count||0)} pedido(s)</span><div><strong>${money(sum.gross||0)}</strong>${s.difference!=null?`<small class="muted" style="display:block">Diferença: ${money(s.difference)}</small>`:''}</div></div>`;
  }).join(''):'<div class="empty-state">Nenhum caixa registrado.</div>';
}

$('#openCashBtn')?.addEventListener('click',async()=>{
  if(!hasPermission('cashOperate')||currentCashSession) return;
  const openingAmount=Number($('#cashOpeningAmount').value||0);
  const openingNote=$('#cashOpeningNote').value.trim();
  try{
    const ref=await addDoc(collection(db,'cashSessions'),{
      status:'open',
      openingAmount,
      openingNote,
      openedBy:auth.currentUser.uid,
      openedByName:currentProfile.displayName||currentProfile.username||'Usuário',
      openedAt:serverTimestamp(),
      updatedAt:serverTimestamp()
    });
    await loadCashSessions();
    currentCashSession=cashSessions.find(s=>s.id===ref.id)||currentCashSession;
    renderCash();
  }catch(err){
    console.error(err);
    alert('Não foi possível abrir o caixa.');
  }
});

$('#closeCashBtn')?.addEventListener('click',()=>{
  if(!hasPermission('cashOperate')||!currentCashSession) return;
  const summary=cashSummary();
  const expected=Number(currentCashSession.openingAmount||0)+summary.money;
  $('#cashClosingAmount').value=expected.toFixed(2);
  $('#cashClosingNote').value='';
  $('#cashClosePreview').innerHTML=`<p>Dinheiro esperado: <strong>${money(expected)}</strong></p><p>Vendas totais do período: <strong>${money(summary.gross)}</strong></p>`;
  $('#cashCloseError').classList.add('hidden');
  $('#cashCloseDialog').showModal();
});

$('#cashCloseForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  if(!currentCashSession) return;
  const declared=Number($('#cashClosingAmount').value||0);
  const summary=cashSummary();
  const expected=Number(currentCashSession.openingAmount||0)+summary.money;
  try{
    await updateDoc(doc(db,'cashSessions',currentCashSession.id),{
      status:'closed',
      closingAmount:declared,
      expectedCash:expected,
      difference:declared-expected,
      closingNote:$('#cashClosingNote').value.trim(),
      closedBy:auth.currentUser.uid,
      closedByName:currentProfile.displayName||currentProfile.username||'Usuário',
      closedAt:serverTimestamp(),
      summary,
      updatedAt:serverTimestamp()
    });
    $('#cashCloseDialog').close();
    await loadCashSessions();
  }catch(err){
    console.error(err);
    $('#cashCloseError').textContent='Não foi possível fechar o caixa.';
    $('#cashCloseError').classList.remove('hidden');
  }
});


function renderProducts(){
  $('#productsTable').innerHTML=products.length?products.map(p=>`<div class="data-row"><div class="data-main"><strong>${esc(p.name)}</strong><small>${esc(categories.find(c=>c.id===p.categoryId)?.name||'Sem categoria')} • ${p.active===false?'Indisponível':'Disponível'} • ${p.sizes?.length?`${p.sizes.length} tamanhos`:money(p.price)}</small></div><span>${p.featured?'Destaque':''}</span><div class="data-actions"><button class="btn btn-secondary edit-product" data-id="${p.id}">Editar</button><button class="btn btn-danger delete-product" data-id="${p.id}">Excluir</button></div></div>`).join(''):'<div class="empty-state">Nenhum produto cadastrado.</div>';

  $$('.edit-product').forEach(b=>b.onclick=()=>editProduct(b.dataset.id));
  $$('.delete-product').forEach(b=>b.onclick=()=>deleteProduct(b.dataset.id));
}

$('#newProductBtn').onclick=()=>editProduct(null);

function refreshCategorySelect(){
  $('#productCategory').innerHTML=categories.filter(c=>c.active!==false).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

let productImageSource=null;
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
    <label class="field repeat-price"><span>Preço (R$)</span><input class="repeat-value" type="number" min="0" step="0.01" placeholder="0,00" value="${Number.isFinite(Number(row.price))?Number(row.price):''}"></label>
    <button class="repeat-remove" type="button" title="Remover" aria-label="Remover">×</button>`;
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

$('#downloadPreparedImageBtn')?.addEventListener('click',()=>{
  if(!productImageSource) return alert('Selecione uma imagem primeiro.');
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
  const p=products.find(x=>x.id===id);
  $('#productEditorTitle').textContent=p?'Editar produto':'Novo produto';
  $('#productId').value=p?.id||'';
  $('#productName').value=p?.name||'';
  $('#productCategory').value=p?.categoryId||categories[0]?.id||'';
  $('#productDescription').value=p?.description||'';
  $('#productPrice').value=p?.price??'';
  $('#productOrder').value=p?.order??0;
  $('#productImage').value=p?.image||'';
  renderPriceRows('productSizesEditor','productSizesEmpty',p?.sizes||[]);
  renderPriceRows('productExtrasEditor','productExtrasEmpty',p?.extras||[]);
  const inferredPizza=p?.isPizza??/pizza/i.test(categories.find(cat=>cat.id===(p?.categoryId||$('#productCategory').value))?.name||'');
  $('#productIsPizza').checked=!!inferredPizza;
  $('#productHalfHalf').checked=p?.allowHalfHalf!==false;
  $('#productActive').checked=p?.active!==false;
  $('#productFeatured').checked=!!p?.featured;
  $('#productEditorError').classList.add('hidden');
  const preview=previewProductImagePath(p?.image);
  if(preview) loadImageIntoEditor(preview); else resetImageEditor();
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
  if(!data.sizes.length&&data.price<=0){
    $('#productEditorError').textContent='Informe um preço base ou cadastre pelo menos um tamanho com preço.';
    $('#productEditorError').classList.remove('hidden');
    return;
  }
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
  const p=products.find(x=>x.id===id);
  if(confirm(`Excluir o produto “${p?.name}”?`)){
    await deleteDoc(doc(db,'products',id));
    await loadProducts();
  }
}

function renderCategories(){
  $('#categoriesTable').innerHTML=categories.length?categories.map(c=>`<div class="data-row"><div class="data-main"><strong>${esc(c.name)}</strong><small>Ordem ${c.order||0} • ${c.active===false?'Inativa':'Ativa'}</small></div><span></span><div class="data-actions"><button class="btn btn-secondary edit-category" data-id="${c.id}">Editar</button><button class="btn btn-danger delete-category" data-id="${c.id}">Excluir</button></div></div>`).join(''):'<div class="empty-state">Nenhuma categoria cadastrada.</div>';

  $$('.edit-category').forEach(b=>b.onclick=()=>editCategory(b.dataset.id));
  $$('.delete-category').forEach(b=>b.onclick=()=>deleteCategory(b.dataset.id));
}

$('#newCategoryBtn').onclick=()=>editCategory(null);

function editCategory(id){
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
  if(products.some(p=>p.categoryId===id)){
    return alert('Essa categoria possui produtos. Mova ou exclua os produtos antes.');
  }
  const c=categories.find(x=>x.id===id);
  if(confirm(`Excluir a categoria “${c?.name}”?`)){
    await deleteDoc(doc(db,'categories',id));
    await loadCategories();
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
    <label class="field repeat-price"><span>Taxa (R$)</span><input class="zone-fee" type="number" min="0" step="0.01" value="${Number.isFinite(Number(row.fee))?Number(row.fee):''}"></label>
    <button class="repeat-remove" type="button" title="Remover">×</button>`;
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
  el.innerHTML=`<input class="payment-method-value" maxlength="60" placeholder="Ex.: Cartão de crédito" value="${esc(value)}"><button class="repeat-remove" type="button" title="Remover">×</button>`;
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
  $('#setPhone').value=settings.phone||'';
  $('#setStoreAddress').value=settings.storeAddress||'';
  $('#setOpenMode').value=settings.openMode||'schedule';
  $('#setDeliveryFee').value=settings.deliveryFee??0;
  renderDeliveryZonesEditor(settings.deliveryZones||[]);
  $('#setRestrictDeliveryZones').checked=!!settings.restrictDeliveryZones;
  $('#setMinimumOrder').value=settings.minimumOrder??0;
  $('#setAllowPickup').checked=settings.allowPickup!==false;
  $('#setAutoAccept').checked=!!settings.autoAcceptOrders;
  renderPaymentMethodsEditor(settings.payments||[]);

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

  settings={
    ...settings,
    storeName:$('#setStoreName').value.trim(),
    subtitle:$('#setSubtitle').value.trim(),
    phone:$('#setPhone').value.trim(),
    storeAddress:$('#setStoreAddress').value.trim(),
    openMode:$('#setOpenMode').value,
    deliveryFee:Number($('#setDeliveryFee').value||0),
    deliveryZones:collectDeliveryZones(),
    restrictDeliveryZones:$('#setRestrictDeliveryZones').checked,
    minimumOrder:Number($('#setMinimumOrder').value||0),
    allowPickup:$('#setAllowPickup').checked,
    autoAcceptOrders:$('#setAutoAccept').checked,
    payments:collectPaymentMethods(),
    schedule,
    timezone:'America/Porto_Velho',
    updatedAt:serverTimestamp()
  };

  await setDoc(doc(db,'settings','store'),settings,{merge:true});
  $('#adminStoreName').textContent=settings.storeName;
  $('#settingsSaved').classList.remove('hidden');
  setTimeout(()=>$('#settingsSaved').classList.add('hidden'),2200);
};

$('#seedBtn').onclick=async()=>{
  if(categories.length||products.length){
    if(!confirm('Já existem itens no cardápio. Continuar e adicionar o cardápio demonstrativo completo?')) return;
  }

  const batch=writeBatch(db);
  const catRefs={
    savory:doc(collection(db,'categories')),
    sweet:doc(collection(db,'categories')),
    drinks:doc(collection(db,'categories')),
    combos:doc(collection(db,'categories'))
  };

  batch.set(catRefs.savory,{name:'Pizzas Salgadas',order:1,active:true,createdAt:serverTimestamp()});
  batch.set(catRefs.sweet,{name:'Pizzas Doces',order:2,active:true,createdAt:serverTimestamp()});
  batch.set(catRefs.drinks,{name:'Bebidas',order:3,active:true,createdAt:serverTimestamp()});
  batch.set(catRefs.combos,{name:'Combos',order:4,active:true,createdAt:serverTimestamp()});

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

  for(const p of samples){
    batch.set(doc(collection(db,'products')),{...p,createdAt:serverTimestamp()});
  }

  await batch.commit();
  await Promise.all([loadCategories(),loadProducts()]);
  alert(`Cardápio demonstrativo criado com ${samples.length} produtos.`);
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
  try{
    const s=await getDocs(collection(db,'customers'));
    customers=s.docs.map(d=>({uid:d.id,...d.data()})).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
    renderCustomers();
  }catch(err){
    console.warn('Não foi possível carregar clientes.',err);
    customers=[];
    renderCustomers();
  }
}

function renderCustomers(){
  if(!$('#customersTable')) return;

  const term=($('#customerSearch')?.value||'').trim().toLowerCase();
  const list=customers.filter(customer=>{
    const text=`${customer.name||''} ${customer.email||''} ${customer.phone||''}`.toLowerCase();
    return !term||text.includes(term);
  });

  $('#customersTable').innerHTML=list.length?list.map(customer=>{
    const customerOrders=orders.filter(o=>o.customerId===customer.uid);
    const completed=customerOrders.filter(o=>o.status==='completed');
    const spent=completed.reduce((sum,o)=>sum+Number(o.total||0),0);

    return `<div class="data-row">
      <div class="data-main">
        <strong>${esc(customer.name||'Cliente')}</strong>
        <small>${esc(customer.phone||'Sem telefone')} • ${esc(customer.email||'Sem e-mail')}</small>
      </div>
      <span>${customerOrders.length} pedido(s)</span>
      <div><strong>${money(spent)}</strong><small class="muted" style="display:block">concluídos</small></div>
    </div>`;
  }).join(''):'<div class="empty-state">Nenhum cliente encontrado.</div>';
}

$('#customerSearch')?.addEventListener('input',renderCustomers);


async function loadUsers(){
  if(!hasPermission('usersManage')) return;
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
}

function renderUsers(){
  if(!hasPermission('usersManage')) return;
  $('#usersTable').innerHTML=users.length?users.map(u=>`
    <div class="data-row">
      <div class="data-main">
        <strong>${esc(u.displayName||u.username||'Usuário')}</strong>
        <small>@${esc(u.username||'')} • ${roleLabel(u.role)} • ${u.active===false?'Desativado':'Ativo'}${u.uid===auth.currentUser?.uid?' • Você':''}</small>
      </div>
      <span class="status-pill ${u.active===false?'status-cancelled':'status-completed'}">${u.active===false?'Desativado':'Ativo'}</span>
      <div class="data-actions">
        <button class="btn btn-secondary edit-user" data-uid="${u.uid}">${u.bootstrap?'Registrar perfil':'Editar'}</button>
        ${u.uid!==auth.currentUser?.uid&&!u.bootstrap?`<button class="btn ${u.active===false?'btn-secondary':'btn-danger'} toggle-user" data-uid="${u.uid}">${u.active===false?'Ativar':'Desativar'}</button>`:''}
      </div>
    </div>`).join(''):'<div class="empty-state">Nenhum usuário cadastrado.</div>';

  $$('.edit-user').forEach(b=>b.onclick=()=>editUser(b.dataset.uid));
  $$('.toggle-user').forEach(b=>b.onclick=()=>toggleUser(b.dataset.uid));
}

$('#newUserBtn').onclick=()=>{
  if(!hasPermission('usersManage')) return;
  editUser(null);
};

function editUser(uid){
  if(!hasPermission('usersManage')) return;
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
  $('#userActive').checked=u?.active!==false;
  $('#userActive').disabled=u?.uid===auth.currentUser?.uid;
  $('#userEditorError').classList.add('hidden');
  $('#userEditor').showModal();
}

$('#userEditorForm').onsubmit=async e=>{
  e.preventDefault();
  if(!hasPermission('usersManage')) return;
  const existingUid=$('#userUid').value;
  const username=normalizeUsername($('#userUsername').value);
  const displayName=$('#userDisplayName').value.trim()||username;
  const role=existingUid===auth.currentUser?.uid?'master':$('#userRole').value;
  const active=existingUid===auth.currentUser?.uid?true:$('#userActive').checked;
  $('#userEditorError').classList.add('hidden');

  if(!username||username.length<3){
    return userEditorError('O usuário precisa ter pelo menos 3 caracteres.');
  }

  try{
    if(existingUid){
      await setDoc(doc(db,'users',existingUid),{
        username,
        displayName,
        role,
        active,
        updatedAt:serverTimestamp()
      },{merge:true});
      if(existingUid===auth.currentUser?.uid){
        currentProfile={...currentProfile,username,displayName,role,active,bootstrap:false};
      }
    }else{
      const password=$('#userPassword').value;
      if(password.length<6) return userEditorError('A senha precisa ter pelo menos 6 caracteres.');
      let credential=null;
      try{
        const internalEmail=randomStaffEmail(username);
        credential=await createUserWithEmailAndPassword(userCreatorAuth,internalEmail,password);
        const batch=writeBatch(db);
        batch.set(doc(db,'users',credential.user.uid),{
          username,
          displayName,
          role,
          active,
          createdBy:auth.currentUser.uid,
          createdAt:serverTimestamp(),
          updatedAt:serverTimestamp()
        });
        batch.set(doc(db,'staffLogins',username),{
          uid:credential.user.uid,
          email:internalEmail,
          createdAt:serverTimestamp(),
          updatedAt:serverTimestamp()
        });
        await batch.commit();
      }catch(err){
        if(credential?.user){
          try{await deleteUser(credential.user);}catch{}
        }
        throw err;
      }finally{
        try{await signOut(userCreatorAuth);}catch{}
      }
    }
    $('#userEditor').close();
    await loadUsers();
    $('#currentUserDisplay').textContent=`${currentProfile.displayName||currentProfile.username} • ${roleLabel(currentProfile.role)}`;
  }catch(err){
    console.error(err);
    if(err?.code==='auth/email-already-in-use') return userEditorError('Esse nome de usuário já existe.');
    if(err?.code==='auth/operation-not-allowed') return userEditorError('Ative E-mail/Senha no Firebase Authentication antes de criar usuários.');
    userEditorError('Não foi possível salvar o usuário.');
  }
};

function userEditorError(message){
  $('#userEditorError').textContent=message;
  $('#userEditorError').classList.remove('hidden');
}

async function toggleUser(uid){
  if(!hasPermission('usersManage')||uid===auth.currentUser?.uid) return;
  const u=users.find(x=>x.uid===uid);
  if(!u) return;
  const next=u.active===false;
  if(!next&&!confirm(`Desativar o usuário “${u.username}”? Ele não conseguirá acessar o sistema.`)) return;
  await updateDoc(doc(db,'users',uid),{active:next,updatedAt:serverTimestamp()});
  await loadUsers();
}
