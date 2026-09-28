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
  pending:'Novo',
  preparing:'Em preparo',
  ready:'Pronto',
  out_for_delivery:'Saiu para entrega',
  completed:'Concluído',
  cancelled:'Cancelado'
};
const dayNames=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

let categories=[],products=[],orders=[],settings={},users=[],currentProfile=null;
let unsubscribeOrders=null,soundEnabled=false,knownOrderIds=new Set();

const defaults={
  storeName:'Delivery Pizzaria',
  subtitle:'Pizza quentinha, do forno para sua casa.',
  phone:'',
  storeAddress:'',
  deliveryFee:5,
  minimumOrder:0,
  allowPickup:true,
  openMode:'schedule',
  payments:['Dinheiro','PIX na entrega','Cartão de débito','Cartão de crédito'],
  timezone:'America/Porto_Velho',
  autoPrint:false,
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
function usernameEmail(username){
  return `${normalizeUsername(username)}@delivery-pizzaria.local`;
}
function roleLabel(role){
  return ({master:'Master',manager:'Gerente',operator:'Operador'})[role]||role;
}
function isMaster(){
  return currentProfile?.role==='master';
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
    await signInWithEmailAndPassword(auth,usernameEmail(username),$('#loginPassword').value);
  }catch(err){
    $('#loginError').textContent='Usuário ou senha inválidos.';
    $('#loginError').classList.remove('hidden');
  }
};

$('#logoutBtn').onclick=()=>signOut(auth);

onAuthStateChanged(auth,async user=>{
  if(!user){
    currentProfile=null;
    $('#loginView').classList.remove('hidden');
    $('#adminApp').classList.add('hidden');
    if(unsubscribeOrders) unsubscribeOrders();
    return;
  }
  try{
    const username=(user.email||'').split('@')[0];
    const profileSnap=await getDoc(doc(db,'users',user.uid));
    if(profileSnap.exists()){
      currentProfile={uid:user.uid,...profileSnap.data()};
      if(currentProfile.active===false){
        await signOut(auth);
        throw new Error('disabled');
      }
    }else if((user.email||'').toLowerCase()==='master@delivery-pizzaria.local'){
      currentProfile={uid:user.uid,username:'master',displayName:'Administrador Master',role:'master',active:true,bootstrap:true};
    }else{
      await signOut(auth);
      throw new Error('unauthorized');
    }

    $('#loginView').classList.add('hidden');
    $('#adminApp').classList.remove('hidden');
    $('#currentUserDisplay').textContent=`${currentProfile.displayName||currentProfile.username||username} • ${roleLabel(currentProfile.role)}`;
    $('.master-only').forEach(el=>el.classList.toggle('hidden',!isMaster()));
    await initializeAdmin();
  }catch(err){
    console.error(err);
    $('#loginView').classList.remove('hidden');
    $('#adminApp').classList.add('hidden');
    if(err?.message==='disabled'){
      $('#loginError').textContent='Este usuário está desativado.';
    }else{
      $('#loginError').textContent='Usuário sem permissão para acessar o painel.';
    }
    $('#loginError').classList.remove('hidden');
  }
});

async function initializeAdmin(){
  const tasks=[loadSettings(),loadCategories(),loadProducts()];
  if(isMaster()) tasks.push(loadUsers());
  await Promise.all(tasks);
  listenOrders();
  renderSchedules();
  renderSettings();
}

async function loadSettings(){
  const snap=await getDoc(doc(db,'settings','store'));
  settings=snap.exists()?{...defaults,...snap.data()}:defaults;
  if(!snap.exists()) await setDoc(doc(db,'settings','store'),settings);
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
    if(!first&&incoming.length){
      for(const o of incoming){
        notifyNewOrder(o);
        if(settings.autoPrint) autoPrint(o.id);
      }
    }
    first=false;
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

$$('.nav-item').forEach(b=>b.onclick=()=>switchView(b.dataset.view));

function applyRoleUI(){
  const role=currentProfile?.role||'operator';
  const allowed=role==='master'
    ?['orders','products','categories','users','settings']
    :role==='manager'
      ?['orders','products','categories','settings']
      :['orders'];
  $('.nav-item').forEach(item=>item.classList.toggle('hidden',!allowed.includes(item.dataset.view)));
  if(!allowed.includes(document.querySelector('.admin-view.active')?.id?.replace('view-',''))){
    switchView('orders');
  }
}

function switchView(v){
  const role=currentProfile?.role||'operator';
  const allowed=role==='master'
    ?['orders','products','categories','users','settings']
    :role==='manager'
      ?['orders','products','categories','settings']
      :['orders'];
  if(!allowed.includes(v)) return;
  $('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===v));
  $$('.admin-view').forEach(x=>x.classList.toggle('active',x.id===`view-${v}`));
  const titles={
    orders:['OPERAÇÃO','Pedidos'],
    products:['CARDÁPIO','Produtos'],
    categories:['CARDÁPIO','Categorias'],
    users:['SEGURANÇA','Usuários'],
    settings:['SISTEMA','Configurações']
  };
  $('#viewEyebrow').textContent=titles[v][0];
  $('#viewTitle').textContent=titles[v][1];
}

function renderStats(){
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:settings.timezone||'America/Porto_Velho'}).format(new Date());
  const sameDay=o=>{
    const d=o.createdAt?.toDate?.();
    return d&&new Intl.DateTimeFormat('en-CA',{timeZone:settings.timezone||'America/Porto_Velho'}).format(d)===today;
  };
  $('#statPending').textContent=orders.filter(o=>o.status==='pending').length;
  $('#statPreparing').textContent=orders.filter(o=>o.status==='preparing').length;
  $('#statDelivery').textContent=orders.filter(o=>o.status==='out_for_delivery').length;
  $('#statToday').textContent=orders.filter(sameDay).length;
  const p=orders.filter(o=>o.status==='pending').length;
  $('#pendingBadge').textContent=p;
  $('#pendingBadge').classList.toggle('hidden',p===0);
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

  $('#ordersList').innerHTML=list.length?list.map(o=>`<button class="order-row" data-id="${o.id}" style="border-left:0;border-right:0;border-top:0;background:#fff;text-align:left;width:100%"><span class="order-number">#${String(o.orderNumber||0).padStart(4,'0')}</span><span class="order-meta"><strong>${esc(o.customer?.name||'Cliente')}</strong><small>${esc(o.customer?.phone||'')} • ${formatDate(o.createdAt)}</small></span><span class="status-pill status-${o.status}">${statusLabels[o.status]||o.status}</span><strong>${money(o.total)}</strong></button>`).join(''):'<div class="empty-state">Nenhum pedido encontrado.</div>';

  $$('.order-row').forEach(r=>r.onclick=()=>openOrder(r.dataset.id));
}

$('#orderStatusFilter').onchange=renderOrders;
$('#orderSearch').oninput=renderOrders;

function openOrder(id){
  const o=orders.find(x=>x.id===id);
  if(!o) return;

  const address=o.fulfillment==='pickup'
    ?'Retirada no local'
    :`${o.customer?.address||''}, ${o.customer?.number||''} — ${o.customer?.neighborhood||''}${o.customer?.complement?` • ${o.customer.complement}`:''}${o.customer?.reference?` • Ref.: ${o.customer.reference}`:''}`;

  $('#orderDetail').innerHTML=`
    <div class="order-detail-head">
      <div><span class="eyebrow">PEDIDO</span><h2>#${String(o.orderNumber||0).padStart(4,'0')}</h2><p class="muted">${formatDate(o.createdAt)}</p></div>
      <span class="status-pill status-${o.status}">${statusLabels[o.status]||o.status}</span>
    </div>
    <div class="order-detail-grid">
      <div class="detail-card"><h3>Cliente</h3><p><strong>${esc(o.customer?.name||'')}</strong></p><p>${esc(o.customer?.phone||'')}</p><p>${esc(address)}</p></div>
      <div class="detail-card"><h3>Pagamento</h3><p>${esc(o.payment?.method||'')}</p>${o.payment?.changeFor?`<p>Troco para: ${esc(o.payment.changeFor)}</p>`:''}<p><strong>${money(o.total)}</strong></p></div>
    </div>
    <div class="order-items-detail">
      ${(o.items||[]).map(i=>`<div class="order-line"><div><strong>${i.qty}× ${esc(i.name)}</strong><small class="muted" style="display:block">${[i.size?.name,...(i.extras||[]).map(e=>e.name)].filter(Boolean).map(esc).join(' • ')}${i.note?` • Obs.: ${esc(i.note)}`:''}</small></div><strong>${money(Number(i.unitPrice)*Number(i.qty))}</strong></div>`).join('')}
      <div class="order-line"><span>Subtotal</span><strong>${money(o.subtotal)}</strong></div>
      <div class="order-line"><span>Entrega</span><strong>${money(o.deliveryFee)}</strong></div>
      <div class="order-line"><strong>Total</strong><strong>${money(o.total)}</strong></div>
    </div>
    ${o.note?`<div class="detail-card"><h3>Observações</h3><p>${esc(o.note)}</p></div>`:''}
    <h3>Atualizar status</h3>
    <div class="status-actions">${Object.entries(statusLabels).map(([k,v])=>`<button class="btn ${k===o.status?'btn-primary':'btn-secondary'} status-change" data-status="${k}">${v}</button>`).join('')}</div>
    <div class="section-actions" style="margin-top:16px"><button class="btn btn-secondary" id="printOrderBtn">🖨️ Imprimir comanda</button></div>
  `;

  $$('.status-change').forEach(b=>b.onclick=async()=>{
    await updateDoc(doc(db,'orders',o.id),{status:b.dataset.status,updatedAt:serverTimestamp()});
    $('#orderDialog').close();
  });

  $('#printOrderBtn').onclick=()=>window.open(`./print.html?id=${encodeURIComponent(o.id)}`,'_blank');
  $('#orderDialog').showModal();
}

$('#closeOrderDialog').onclick=()=>$('#orderDialog').close();

function autoPrint(id){
  const frame=document.createElement('iframe');
  frame.style='position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
  frame.src=`./print.html?id=${encodeURIComponent(id)}&autoprint=1`;
  document.body.appendChild(frame);
  setTimeout(()=>frame.remove(),20000);
}

function renderProducts(){
  $('#productsTable').innerHTML=products.length?products.map(p=>`<div class="data-row"><div class="data-main"><strong>${esc(p.name)}</strong><small>${esc(categories.find(c=>c.id===p.categoryId)?.name||'Sem categoria')} • ${p.active===false?'Indisponível':'Disponível'} • ${p.sizes?.length?`${p.sizes.length} tamanhos`:money(p.price)}</small></div><span>${p.featured?'Destaque':''}</span><div class="data-actions"><button class="btn btn-secondary edit-product" data-id="${p.id}">Editar</button><button class="btn btn-danger delete-product" data-id="${p.id}">Excluir</button></div></div>`).join(''):'<div class="empty-state">Nenhum produto cadastrado.</div>';

  $$('.edit-product').forEach(b=>b.onclick=()=>editProduct(b.dataset.id));
  $$('.delete-product').forEach(b=>b.onclick=()=>deleteProduct(b.dataset.id));
}

$('#newProductBtn').onclick=()=>editProduct(null);

function refreshCategorySelect(){
  $('#productCategory').innerHTML=categories.filter(c=>c.active!==false).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

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
  $('#productSizes').value=(p?.sizes||[]).map(x=>`${x.name}|${x.price}`).join('\n');
  $('#productExtras').value=(p?.extras||[]).map(x=>`${x.name}|${x.price}`).join('\n');
  $('#productActive').checked=p?.active!==false;
  $('#productFeatured').checked=!!p?.featured;
  $('#productEditor').showModal();
}

$('#productEditorForm').onsubmit=async e=>{
  e.preventDefault();
  const id=$('#productId').value;
  const data={
    name:$('#productName').value.trim(),
    categoryId:$('#productCategory').value,
    description:$('#productDescription').value.trim(),
    price:Number($('#productPrice').value||0),
    order:Number($('#productOrder').value||0),
    image:$('#productImage').value.trim(),
    sizes:parsePriceLines($('#productSizes').value),
    extras:parsePriceLines($('#productExtras').value),
    active:$('#productActive').checked,
    featured:$('#productFeatured').checked,
    updatedAt:serverTimestamp()
  };
  if(!data.name||!data.categoryId) return;
  if(id) await updateDoc(doc(db,'products',id),data);
  else await addDoc(collection(db,'products'),{...data,createdAt:serverTimestamp()});
  $('#productEditor').close();
  await loadProducts();
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
  const id=$('#categoryId').value;
  const data={
    name:$('#categoryName').value.trim(),
    order:Number($('#categoryOrder').value||0),
    active:$('#categoryActive').checked,
    updatedAt:serverTimestamp()
  };
  if(!data.name) return;
  if(id) await updateDoc(doc(db,'categories',id),data);
  else await addDoc(collection(db,'categories'),{...data,createdAt:serverTimestamp()});
  $('#categoryEditor').close();
  await loadCategories();
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

function parsePriceLines(v){
  return v.split('\n').map(x=>x.trim()).filter(Boolean).map(line=>{
    const [name,price]=line.split('|');
    return {name:(name||'').trim(),price:Number(String(price||0).replace(',','.'))};
  }).filter(x=>x.name);
}

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
  $('#setMinimumOrder').value=settings.minimumOrder??0;
  $('#setAllowPickup').checked=settings.allowPickup!==false;
  $('#setPayments').value=(settings.payments||[]).join('\n');
  $('#setAutoPrint').checked=!!settings.autoPrint;

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
    minimumOrder:Number($('#setMinimumOrder').value||0),
    allowPickup:$('#setAllowPickup').checked,
    payments:$('#setPayments').value.split('\n').map(x=>x.trim()).filter(Boolean),
    autoPrint:$('#setAutoPrint').checked,
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
    if(!confirm('Já existem itens no cardápio. Continuar e adicionar exemplos?')) return;
  }

  const batch=writeBatch(db);
  const catRefs={
    pizzas:doc(collection(db,'categories')),
    bebidas:doc(collection(db,'categories'))
  };

  batch.set(catRefs.pizzas,{name:'Pizzas',order:1,active:true,createdAt:serverTimestamp()});
  batch.set(catRefs.bebidas,{name:'Bebidas',order:2,active:true,createdAt:serverTimestamp()});

  const samples=[
    {
      name:'Pizza Calabresa',
      categoryId:catRefs.pizzas.id,
      description:'Molho de tomate, muçarela, calabresa fatiada, cebola e orégano.',
      image:'assets/products/placeholder.svg',
      sizes:[{name:'Pequena',price:35},{name:'Média',price:45},{name:'Grande',price:55}],
      extras:[{name:'Borda de catupiry',price:8},{name:'Bacon extra',price:6}],
      price:0,order:1,active:true,featured:true
    },
    {
      name:'Pizza Frango com Catupiry',
      categoryId:catRefs.pizzas.id,
      description:'Frango desfiado, catupiry, muçarela e orégano.',
      image:'assets/products/placeholder.svg',
      sizes:[{name:'Pequena',price:38},{name:'Média',price:48},{name:'Grande',price:58}],
      extras:[{name:'Borda de catupiry',price:8}],
      price:0,order:2,active:true
    },
    {
      name:'Coca-Cola 2L',
      categoryId:catRefs.bebidas.id,
      description:'Refrigerante Coca-Cola 2 litros.',
      image:'assets/products/placeholder.svg',
      sizes:[],extras:[],price:14,order:1,active:true
    },
    {
      name:'Guaraná 2L',
      categoryId:catRefs.bebidas.id,
      description:'Refrigerante Guaraná 2 litros.',
      image:'assets/products/placeholder.svg',
      sizes:[],extras:[],price:12,order:2,active:true
    }
  ];

  for(const p of samples){
    batch.set(doc(collection(db,'products')),{...p,createdAt:serverTimestamp()});
  }

  await batch.commit();
  await Promise.all([loadCategories(),loadProducts()]);
  alert('Cardápio de exemplo criado.');
};

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


async function loadUsers(){
  if(!isMaster()) return;
  const s=await getDocs(collection(db,'users'));
  users=s.docs.map(d=>({uid:d.id,...d.data()})).sort((a,b)=>(a.username||'').localeCompare(b.username||''));
  if(!users.some(u=>u.uid===auth.currentUser?.uid) && currentProfile?.bootstrap){
    users.unshift({...currentProfile});
  }
  renderUsers();
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
        ${u.uid!==auth.currentUser?.uid&&!u.bootstrap?`<button class="btn ${u.active===false?'btn-secondary':'btn-danger'} toggle-user" data-uid="${u.uid}">${u.active===false?'Ativar':'Desativar'}</button>`:''}
      </div>
    </div>`).join(''):'<div class="empty-state">Nenhum usuário cadastrado.</div>';

  $$('.edit-user').forEach(b=>b.onclick=()=>editUser(b.dataset.uid));
  $$('.toggle-user').forEach(b=>b.onclick=()=>toggleUser(b.dataset.uid));
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
  $('#userRole').value=u?.role||'operator';
  $('#userRole').disabled=u?.uid===auth.currentUser?.uid;
  $('#userActive').checked=u?.active!==false;
  $('#userActive').disabled=u?.uid===auth.currentUser?.uid;
  $('#userEditorError').classList.add('hidden');
  $('#userEditor').showModal();
}

$('#userEditorForm').onsubmit=async e=>{
  e.preventDefault();
  if(!isMaster()) return;
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
        credential=await createUserWithEmailAndPassword(userCreatorAuth,usernameEmail(username),password);
        await setDoc(doc(db,'users',credential.user.uid),{
          username,
          displayName,
          role,
          active,
          createdBy:auth.currentUser.uid,
          createdAt:serverTimestamp(),
          updatedAt:serverTimestamp()
        });
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
  if(!isMaster()||uid===auth.currentUser?.uid) return;
  const u=users.find(x=>x.uid===uid);
  if(!u) return;
  const next=u.active===false;
  if(!next&&!confirm(`Desativar o usuário “${u.username}”? Ele não conseguirá acessar o sistema.`)) return;
  await updateDoc(doc(db,'users',uid),{active:next,updatedAt:serverTimestamp()});
  await loadUsers();
}
