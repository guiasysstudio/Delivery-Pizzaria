import {
  db, watchCustomer, logoutCustomer, getCustomerProfile, saveCustomerProfile,
  getAddresses, saveAddress, deleteAddress, setDefaultAddress, getFavorites, setFavorite, lookupBrazilianZip
} from '../assets/customer-auth.js';
import {
  collection, doc, getDoc, getDocs, query, where, onSnapshot
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0));
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const placeholder='../assets/products/placeholder.svg';

let user=null,profile=null,addresses=[],orders=[],favorites=new Set(),products=[],settings={};
let unsubscribeOrders=null;

const statusLabels={
  pending:'Aguardando confirmação',
  accepted:'Confirmado',
  preparing:'Em preparo',
  ready:'Pronto',
  out_for_delivery:'Saiu para entrega',
  completed:'Concluído',
  cancelled:'Cancelado'
};

watchCustomer(async current=>{
  user=current;
  $('#accountLoading').classList.add('hidden');
  if(!current){
    if(unsubscribeOrders){unsubscribeOrders();unsubscribeOrders=null;}
    $('#accountGuest').classList.remove('hidden');
    $$('.account-section').forEach(s=>s.classList.add('hidden'));
    return;
  }

  $('#accountGuest').classList.add('hidden');

  try{
    await loadAll();
    renderHeader();
    renderProfile();
    renderAddresses();
    renderOrders();
    renderFavorites();
    listenCustomerOrders();
    openSection(location.hash.replace('#','')||'profile');
  }catch(err){
    console.error(err);
    $('#accountGuest').classList.remove('hidden');
    $('#accountGuest').querySelector('h2').textContent='Não foi possível carregar sua conta';
  }
});

async function loadAll(){
  const results=await Promise.all([
    getCustomerProfile(user.uid),
    getAddresses(user.uid),
    getFavorites(user.uid),
    getDocs(collection(db,'products')),
    getDoc(doc(db,'settings','store')),
    getDocs(query(collection(db,'orders'),where('customerId','==',user.uid)))
  ]);

  profile=results[0];
  addresses=results[1];
  favorites=results[2];
  products=results[3].docs.map(d=>({id:d.id,...d.data()}));
  settings=results[4].exists()?results[4].data():{};
  orders=results[5].docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>{
    const ad=a.createdAt?.toMillis?.()||0;
    const bd=b.createdAt?.toMillis?.()||0;
    return bd-ad;
  });
}

function renderHeader(){
  $('#accountStoreName').textContent=settings.storeName||'Delivery Pizzaria';
  const name=profile?.name||user.displayName||'Cliente';
  $('#accountProfileName').textContent=name;
  $('#accountProfileEmail').textContent=user.email||'';
  $('#accountBigAvatar').textContent=(name[0]||'C').toUpperCase();
}

$$('.account-nav-item').forEach(b=>b.onclick=()=>openSection(b.dataset.section));

function openSection(section){
  const valid=['profile','addresses','orders','favorites'];
  if(!valid.includes(section)) section='profile';
  $$('.account-nav-item').forEach(b=>b.classList.toggle('active',b.dataset.section===section));
  $$('.account-section').forEach(s=>s.classList.toggle('hidden',s.id!=='account-section-'+section));
  history.replaceState(null,'','#'+section);
}

function renderProfile(){
  $('#profileName').value=profile?.name||user.displayName||'';
  $('#profilePhone').value=profile?.phone||'';
  $('#profileEmail').value=user.email||'';
}

$('#profileForm').onsubmit=async e=>{
  e.preventDefault();
  await saveCustomerProfile(user.uid,{
    name:$('#profileName').value,
    phone:$('#profilePhone').value
  });
  profile=await getCustomerProfile(user.uid);
  renderHeader();
  $('#profileSaved').classList.remove('hidden');
  setTimeout(()=>$('#profileSaved').classList.add('hidden'),1800);
};

function addressText(a){
  let out=(a.street||'')+', '+(a.number||'')+' • '+(a.neighborhood||'');
  if(a.city) out+=' • '+a.city+'/'+(a.state||'');
  return out;
}

function renderAddresses(){
  if(!addresses.length){
    $('#accountAddressList').innerHTML='<div class="panel empty-state">Nenhum endereço cadastrado.</div>';
    return;
  }

  $('#accountAddressList').innerHTML=addresses.map(a=>{
    const principal=a.id===profile?.defaultAddressId?'<span class="default-tag">Principal</span>':'';
    const setMain=a.id!==profile?.defaultAddressId
      ?'<button class="btn btn-secondary set-default-address" data-id="'+a.id+'" type="button">Usar como principal</button>'
      :'';

    return '<article class="account-address-card panel">'+
      '<div class="account-address-head"><span class="address-symbol">📍</span><div><strong>'+esc(a.label||'Endereço')+'</strong>'+principal+'</div></div>'+
      '<p>'+esc(addressText(a))+'</p>'+
      (a.complement?'<small class="muted">'+esc(a.complement)+'</small>':'')+
      '<div class="data-actions">'+setMain+
      '<button class="btn btn-secondary edit-account-address" data-id="'+a.id+'" type="button">Editar</button>'+
      '<button class="btn btn-danger delete-account-address" data-id="'+a.id+'" type="button">Excluir</button>'+
      '</div></article>';
  }).join('');

  $$('.set-default-address').forEach(b=>b.onclick=async()=>{
    await setDefaultAddress(user.uid,b.dataset.id);
    profile=await getCustomerProfile(user.uid);
    localStorage.setItem('deliverySelectedAddress',b.dataset.id);
    renderAddresses();
  });

  $$('.edit-account-address').forEach(b=>b.onclick=()=>openAddress(addresses.find(a=>a.id===b.dataset.id)));

  $$('.delete-account-address').forEach(b=>b.onclick=async()=>{
    const a=addresses.find(x=>x.id===b.dataset.id);
    if(!confirm('Excluir o endereço “'+(a?.label||'Endereço')+'”?')) return;
    await deleteAddress(user.uid,b.dataset.id);
    addresses=await getAddresses(user.uid);
    profile=await getCustomerProfile(user.uid);
    renderAddresses();
  });
}

$('#accountNewAddressBtn').onclick=()=>openAddress(null);

function openAddress(a){
  $('#accountAddressTitle').textContent=a?'Editar endereço':'Novo endereço';
  $('#accountAddressId').value=a?.id||'';
  $('#accAddressLabel').value=a?.label||'Casa';
  $('#accAddressZip').value=a?.zip||'';
  $('#accAddressStreet').value=a?.street||'';
  $('#accAddressNumber').value=a?.number||'';
  $('#accAddressNeighborhood').value=a?.neighborhood||'';
  $('#accAddressComplement').value=a?.complement||'';
  $('#accAddressCity').value=a?.city||'Ji-Paraná';
  $('#accAddressState').value=a?.state||'RO';
  $('#accAddressReference').value=a?.reference||'';
  $('#accAddressRecipient').value=a?.recipient||profile?.name||'';
  $('#accAddressPhone').value=a?.phone||profile?.phone||'';
  $('#accAddressDefault').checked=!addresses.length||a?.id===profile?.defaultAddressId;
  $('#accountAddressError').classList.add('hidden');
  $('#accountAddressEditor').showModal();
}

async function fillAccountAddressFromCep(){
  const cep=String($('#accAddressZip').value||'').replace(/\D/g,'');
  if(cep.length!==8) return;

  try{
    const response=await fetch('https://viacep.com.br/ws/'+cep+'/json/');
    if(!response.ok) return;
    const data=await response.json();
    if(data.erro) return;

    if(data.logradouro) $('#accAddressStreet').value=data.logradouro;
    if(data.bairro) $('#accAddressNeighborhood').value=data.bairro;
    if(data.localidade) $('#accAddressCity').value=data.localidade;
    if(data.uf) $('#accAddressState').value=data.uf;
    $('#accAddressNumber').focus();
  }catch(err){
    console.warn('CEP não encontrado.',err);
  }
}

$('#accAddressZip').addEventListener('blur',fillAccountAddressFromCep);

$('#accAddressZip')?.addEventListener('blur',async()=>{
  const input=$('#accAddressZip');
  const digits=input.value.replace(/\D/g,'');
  if(digits.length!==8) return;
  try{
    const data=await lookupBrazilianZip(digits);
    if(!data) return;
    input.value=data.zip;
    if(data.street) $('#accAddressStreet').value=data.street;
    if(data.neighborhood) $('#accAddressNeighborhood').value=data.neighborhood;
    if(data.city) $('#accAddressCity').value=data.city;
    if(data.state) $('#accAddressState').value=data.state;
    $('#accAddressNumber').focus();
  }catch(err){
    console.warn('Consulta de CEP indisponível.',err);
  }
});

$('#accountAddressForm').onsubmit=async e=>{
  e.preventDefault();

  try{
    const id=await saveAddress(user.uid,{
      label:$('#accAddressLabel').value,
      zip:$('#accAddressZip').value,
      street:$('#accAddressStreet').value,
      number:$('#accAddressNumber').value,
      neighborhood:$('#accAddressNeighborhood').value,
      complement:$('#accAddressComplement').value,
      city:$('#accAddressCity').value,
      state:$('#accAddressState').value,
      reference:$('#accAddressReference').value,
      recipient:$('#accAddressRecipient').value,
      phone:$('#accAddressPhone').value
    },$('#accountAddressId').value||null);

    if($('#accAddressDefault').checked||!profile?.defaultAddressId){
      await setDefaultAddress(user.uid,id);
      localStorage.setItem('deliverySelectedAddress',id);
    }

    addresses=await getAddresses(user.uid);
    profile=await getCustomerProfile(user.uid);
    renderAddresses();
    $('#accountAddressEditor').close();
  }catch(err){
    console.error(err);
    $('#accountAddressError').textContent='Não foi possível salvar o endereço.';
    $('#accountAddressError').classList.remove('hidden');
  }
};

function listenCustomerOrders(){
  if(unsubscribeOrders) unsubscribeOrders();

  const q=query(collection(db,'orders'),where('customerId','==',user.uid));
  unsubscribeOrders=onSnapshot(q,snap=>{
    orders=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>{
      const ad=a.createdAt?.toMillis?.()||0;
      const bd=b.createdAt?.toMillis?.()||0;
      return bd-ad;
    });
    renderOrders();
  },err=>console.error('Falha ao acompanhar pedidos:',err));
}

function formatDate(ts){
  try{
    return ts?.toDate?.().toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})||'—';
  }catch{
    return '—';
  }
}

function renderOrders(){
  if(!orders.length){
    $('#accountOrdersList').innerHTML='<div class="panel empty-state">Você ainda não fez nenhum pedido.</div>';
    return;
  }

  $('#accountOrdersList').innerHTML=orders.map(o=>{
    const items=(o.items||[]).map(i=>'<span>'+i.qty+'× '+esc(i.name)+'</span>').join('');
    const reorder=o.status!=='cancelled'
      ?'<button class="btn btn-secondary reorder-btn" data-id="'+o.id+'" type="button">Pedir novamente</button>'
      :'';

    return '<article class="account-order-card panel">'+
      '<div class="account-order-top"><div><span class="eyebrow">PEDIDO #'+String(o.orderNumber||0).padStart(4,'0')+'</span>'+
      '<h3>'+esc(statusLabels[o.status]||o.status)+'</h3><small class="muted">'+formatDate(o.createdAt)+'</small></div>'+
      '<strong class="account-order-total">'+money(o.total)+'</strong></div>'+
      '<div class="account-order-items">'+items+'</div>'+
      '<div class="account-order-footer"><span class="status-pill status-'+esc(o.status)+'">'+esc(statusLabels[o.status]||o.status)+'</span>'+reorder+'</div>'+
      '</article>';
  }).join('');

  $$('.reorder-btn').forEach(b=>b.onclick=()=>reorder(b.dataset.id));
}

function reorder(id){
  const o=orders.find(x=>x.id===id);
  if(!o) return;
  const newCart=(o.items||[]).map(i=>({...i,lineId:crypto.randomUUID()}));
  localStorage.setItem('deliveryCart',JSON.stringify(newCart));
  location.href='../';
}

function productImage(v){
  if(!v) return placeholder;
  if(/^https?:\/\//i.test(v)) return v;
  return '../'+String(v).replace(/^\.?\//,'').replace(/^\//,'');
}

function renderFavorites(){
  const list=products.filter(p=>favorites.has(p.id)&&p.active!==false);

  if(!list.length){
    $('#accountFavoritesList').innerHTML='<div class="panel empty-state">Você ainda não favoritou produtos.</div>';
    return;
  }

  $('#accountFavoritesList').innerHTML=list.map(p=>{
    const price=p.sizes?.length?Math.min(...p.sizes.map(s=>Number(s.price||0))):Number(p.price||0);
    return '<article class="product-card">'+
      '<div class="product-image-wrap"><img class="product-image" src="'+esc(productImage(p.image))+'" alt="">'+
      '<button class="favorite-card-button active remove-fav" data-id="'+p.id+'" type="button">♥</button></div>'+
      '<div class="product-content"><div><h3>'+esc(p.name)+'</h3><p>'+esc(p.description||'')+'</p></div>'+
      '<div class="product-foot"><strong class="price">'+money(price)+'</strong>'+
      '<a class="add-round" href="../?product='+encodeURIComponent(p.id)+'">+</a></div></div></article>';
  }).join('');

  $$('.remove-fav').forEach(b=>b.onclick=async()=>{
    await setFavorite(user.uid,b.dataset.id,false);
    favorites.delete(b.dataset.id);
    renderFavorites();
  });
}

$('#switchAccountBtn').onclick=async()=>{
  await logoutCustomer();
  location.href='../?login=1';
};

$('#accountLogoutBtn').onclick=async()=>{
  await logoutCustomer();
  location.href='../';
};
