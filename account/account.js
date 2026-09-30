import {
  db, watchCustomer, logoutCustomer, getCustomerProfile, saveCustomerProfile,
  getAddresses, saveAddress, deleteAddress, setDefaultAddress, getFavorites, setFavorite, lookupBrazilianZip,
  getCustomerIdentity, saveCustomerIdentity, cancelCustomerOrder, deleteCustomerAccount, formatCpf, validCpf, formatPhone, validPhone, validFullName,
  resendCustomerEmailVerification
} from '../assets/customer-auth.js';
import {
  collection, doc, getDoc, getDocs, query, where, onSnapshot
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { showToast, confirmAction, emptyStateHtml, iconHtml, applyBrandTheme } from '../assets/ui.js';

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0));
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const placeholder='../assets/products/placeholder.svg';

let user=null,profile=null,identity=null,addresses=[],orders=[],favorites=new Set(),products=[],couponRewards=[],settings={},pendingCustomPhotoURL=undefined;
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
    renderCoupons();
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
    getDocs(query(collection(db,'orders'),where('customerId','==',user.uid))),
    getDocs(collection(db,'customers',user.uid,'coupons')).catch(err=>{console.warn('Cupons ainda não disponíveis.',err);return null;}),
    getCustomerIdentity().catch(err=>{
      console.warn('Identidade privada ainda não disponível.',err);
      return {identityComplete:!!profile?.identityComplete,cpfMasked:''};
    })
  ]);

  profile=results[0];
  addresses=results[1];
  favorites=results[2];
  products=results[3].docs.map(d=>({id:d.id,...d.data()}));
  settings=results[4].exists()?results[4].data():{};
  applyBrandTheme(settings.primaryColor||'#b91c1c');
  orders=results[5].docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>{
    const ad=a.createdAt?.toMillis?.()||0;
    const bd=b.createdAt?.toMillis?.()||0;
    return bd-ad;
  });
  couponRewards=results[6]?.docs?.map(d=>({id:d.id,...d.data()}))||[];
  identity=results[7]||{identityComplete:!!profile?.identityComplete,cpfMasked:''};
}

function effectiveProfilePhoto(){
  return profile?.customPhotoURL||profile?.photoURL||user?.photoURL||'';
}

function setProfileAvatar(element,url,fallback=''){
  if(!element) return;
  const renderFallback=()=>{
    element.replaceChildren();
    if(fallback) element.textContent=fallback;
    else element.innerHTML=iconHtml('user-round');
    element.classList.remove('has-photo');
  };
  element.replaceChildren();
  if(url){
    const img=document.createElement('img');
    img.src=url;
    img.alt='Foto do perfil';
    img.referrerPolicy='no-referrer';
    img.onerror=renderFallback;
    element.appendChild(img);
    element.classList.add('has-photo');
  }else{
    renderFallback();
  }
}

function renderProfilePhoto(){
  const name=profile?.name||user?.displayName||'Cliente';
  const preview=$('#profilePhotoPreview');
  const url=pendingCustomPhotoURL!==undefined
    ?(pendingCustomPhotoURL||profile?.photoURL||user?.photoURL||'')
    :effectiveProfilePhoto();
  setProfileAvatar(preview,url,(name[0]||'C').toUpperCase());
  $('#useGooglePhotoBtn')?.classList.toggle('hidden',!(user?.photoURL||profile?.photoURL));
}

async function prepareProfilePhoto(file){
  if(!file) return null;
  if(file.size>8*1024*1024) throw new Error('A imagem deve ter no máximo 8 MB.');

  const dataUrl=await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||''));
    reader.onerror=()=>reject(new Error('Não foi possível ler a imagem.'));
    reader.readAsDataURL(file);
  });

  const image=await new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=()=>reject(new Error('Formato de imagem inválido.'));
    img.src=dataUrl;
  });

  const size=256;
  const canvas=document.createElement('canvas');
  canvas.width=size;
  canvas.height=size;
  const ctx=canvas.getContext('2d');

  const sourceSize=Math.min(image.naturalWidth,image.naturalHeight);
  const sx=(image.naturalWidth-sourceSize)/2;
  const sy=(image.naturalHeight-sourceSize)/2;
  ctx.drawImage(image,sx,sy,sourceSize,sourceSize,0,0,size,size);

  return canvas.toDataURL('image/jpeg',0.84);
}

function renderHeader(){
  $('#accountStoreName').textContent=settings.storeName||'Delivery Pizzaria';

  const storeLogo=String(settings.storeLogo||'').trim();
  const logo=$('#accountHeaderStoreLogo');
  const fallback=$('#accountHeaderStoreLogoFallback');
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
    }
  }

  const name=profile?.name||user.displayName||'Cliente';
  $('#accountProfileName').textContent=name;
  $('#accountProfileEmail').textContent=user.email||'';
  setProfileAvatar($('#accountBigAvatar'),effectiveProfilePhoto(),(name[0]||'C').toUpperCase());
  renderProfilePhoto();
}

function formatAccountCep(value){
  const d=String(value||'').replace(/\D/g,'').slice(0,8);
  return d.length>5?d.slice(0,5)+'-'+d.slice(5):d;
}

function bindAccountMask(selector,formatter){
  const input=$(selector);
  if(!input) return;
  input.addEventListener('input',()=>{input.value=formatter(input.value);});
}

bindAccountMask('#profilePhone',formatPhone);
bindAccountMask('#profileCpf',formatCpf);
bindAccountMask('#accAddressPhone',formatPhone);
bindAccountMask('#accAddressZip',formatAccountCep);

$$('.account-nav-item').forEach(b=>b.onclick=()=>openSection(b.dataset.section));

function openSection(section){
  const valid=['profile','addresses','orders','coupons','favorites','privacy'];
  if(!valid.includes(section)) section='profile';
  $$('.account-nav-item').forEach(b=>b.classList.toggle('active',b.dataset.section===section));
  $$('.account-section').forEach(s=>s.classList.toggle('hidden',s.id!=='account-section-'+section));
  history.replaceState(null,'','#'+section);
}

function renderProfile(){
  $('#profileName').value=profile?.name||user.displayName||'';
  $('#profilePhone').value=formatPhone(profile?.phone||'');
  $('#profileEmail').value=user.email||'';
  $('#profileEmailStatus').textContent=user.emailVerified?'✓ E-mail verificado':'E-mail ainda não verificado';
  $('#resendEmailVerificationBtn').classList.toggle('hidden',user.emailVerified);
  $('#profileCpf').value='';
  $('#profileCpf').placeholder=identity?.cpfMasked||'000.000.000-00';
  $('#profileCpf').disabled=identity?.identityComplete===true;
  $('#profileCpfHint').textContent=identity?.identityComplete
    ?'CPF confirmado. Por segurança, ele não pode ser trocado pelo site e não fica visível para a pizzaria.'
    :'Obrigatório para realizar pedidos. A pizzaria não visualiza este dado.';
  $('#identityStatus').innerHTML=identity?.identityComplete
    ?'<span class="status-pill status-completed">✓ Cadastro pronto para pedidos</span>'
    :'<span class="status-pill status-pending">Complete nome, telefone e CPF para poder pedir.</span>';
  pendingCustomPhotoURL=undefined;
  renderProfilePhoto();
}

$('#resendEmailVerificationBtn')?.addEventListener('click',async()=>{
  const button=$('#resendEmailVerificationBtn');
  button.disabled=true;
  try{
    await resendCustomerEmailVerification();
    button.textContent='E-mail enviado ✓';
    setTimeout(()=>{button.textContent='Reenviar verificação';button.disabled=false;},2500);
  }catch(err){
    console.error(err);
    showToast('Não foi possível enviar a verificação agora.','error');
    button.disabled=false;
  }
});

$('#chooseProfilePhotoBtn')?.addEventListener('click',()=>$('#profilePhotoFile').click());

$('#profilePhotoFile')?.addEventListener('change',async e=>{
  const file=e.target.files?.[0];
  if(!file) return;

  const button=$('#chooseProfilePhotoBtn');
  const original=button.textContent;
  button.disabled=true;
  button.textContent='Preparando...';

  try{
    pendingCustomPhotoURL=await prepareProfilePhoto(file);
    renderProfilePhoto();
  }catch(err){
    console.error(err);
    showToast(err.message||'Não foi possível preparar a foto.','error');
  }finally{
    button.disabled=false;
    button.textContent=original;
    e.target.value='';
  }
});

$('#useGooglePhotoBtn')?.addEventListener('click',()=>{
  pendingCustomPhotoURL='';
  renderProfilePhoto();
});

$('#profileForm').onsubmit=async e=>{
  e.preventDefault();
  const name=$('#profileName').value.trim();
  const phone=$('#profilePhone').value.trim();
  const cpf=$('#profileCpf').value.trim();

  if(!validFullName(name)){
    showToast('Informe seu nome completo, com pelo menos nome e sobrenome.','warning');
    $('#profileName').focus();
    return;
  }
  if(!validPhone(phone)){
    showToast('Informe um telefone válido com DDD.','warning');
    $('#profilePhone').focus();
    return;
  }
  if(identity?.identityComplete!==true&&!validCpf(cpf)){
    showToast('Informe um CPF válido.','warning');
    $('#profileCpf').focus();
    return;
  }

  try{
    identity=await saveCustomerIdentity({name,phone,cpf});

    const payload={name,phone};
    if(pendingCustomPhotoURL!==undefined) payload.customPhotoURL=pendingCustomPhotoURL;
    await saveCustomerProfile(user.uid,payload);

    profile=await getCustomerProfile(user.uid);
    pendingCustomPhotoURL=undefined;
    renderHeader();
    renderProfile();
    $('#profileSaved').classList.remove('hidden');
    setTimeout(()=>$('#profileSaved').classList.add('hidden'),1800);

    if(localStorage.getItem('deliveryReturnToCheckout')==='1'){
      localStorage.removeItem('deliveryReturnToCheckout');
      localStorage.removeItem('deliveryReturnAfterProfile');
      setTimeout(()=>location.href='../?checkout=1',450);
      return;
    }

    const returnAfterProfile=localStorage.getItem('deliveryReturnAfterProfile');
    if(returnAfterProfile){
      localStorage.removeItem('deliveryReturnAfterProfile');
      setTimeout(()=>location.href=returnAfterProfile,450);
    }
  }catch(err){
    console.error(err);
    const code=String(err?.code||'');
    if(code.includes('cpf_already_registered')) showToast('Este CPF já está vinculado a outra conta.','error');
    else if(code.includes('cpf_change_not_allowed')) showToast('O CPF confirmado desta conta não pode ser alterado pelo site.','warning');
    else if(code.includes('invalid_phone')) showToast('Informe um telefone válido com DDD.','warning');
    else showToast('Não foi possível salvar seus dados. Tente novamente.','error');
  }
};

function downloadJsonFile(filename,data){
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download=filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),500);
}

$('#exportMyDataBtn')?.addEventListener('click',async()=>{
  if(!user) return;
  const button=$('#exportMyDataBtn');
  button.disabled=true;
  try{
    const privateOrders=await Promise.all(orders.map(async order=>{
      try{
        const snap=await getDoc(doc(db,'orderPrivate',order.id));
        const privateData=snap.exists()?snap.data():{};
        return {
          ...order,
          customer:privateData.customer||order.customer||null,
          address:privateData.address||order.address||null
        };
      }catch(err){
        console.warn('Dados privados de um pedido não puderam ser incluídos na exportação.',err);
        return {...order};
      }
    }));

    const exportData={
      exportedAt:new Date().toISOString(),
      account:{
        uid:user.uid,
        email:user.email||'',
        emailVerified:user.emailVerified===true,
        profile:{
          name:profile?.name||'',
          phone:profile?.phone||'',
          defaultAddressId:profile?.defaultAddressId||null,
          identityComplete:profile?.identityComplete===true
        },
        identity:{
          cpfMasked:identity?.cpfMasked||'',
          identityComplete:identity?.identityComplete===true
        }
      },
      addresses:addresses.map(a=>({...a})),
      orders:privateOrders,
      favorites:[...favorites],
      coupons:couponRewards.map(coupon=>({...coupon}))
    };
    downloadJsonFile('meus-dados-delivery-pizzaria.json',exportData);
    showToast('Arquivo com seus dados preparado.','success');
  }catch(err){
    console.error(err);
    showToast('Não foi possível preparar a cópia dos seus dados.','error');
  }finally{
    button.disabled=false;
  }
});

$('#deleteMyAccountBtn')?.addEventListener('click',async()=>{
  if(!user) return;
  const first=await confirmAction(
    'Excluir sua conta remove seus dados pessoais e não pode ser desfeito. Registros financeiros já concluídos serão mantidos sem seus dados de contato quando necessário.',
    {title:'Excluir minha conta',confirmText:'Continuar',danger:true}
  );
  if(!first) return;

  const second=await confirmAction(
    'Confirma a exclusão definitiva da sua conta, endereços, favoritos, cupons pessoais e identificação?',
    {title:'Confirmação final',confirmText:'Excluir definitivamente',danger:true}
  );
  if(!second) return;

  const button=$('#deleteMyAccountBtn');
  button.disabled=true;
  try{
    await deleteCustomerAccount();
    localStorage.removeItem('deliverySelectedAddress');
    localStorage.removeItem('deliveryReturnAfterProfile');
    localStorage.removeItem('deliveryReturnToCheckout');
    sessionStorage.clear();
    location.href='../?accountDeleted=1';
  }catch(err){
    console.error(err);
    const code=String(err?.code||'');
    if(code.includes('active_orders')){
      showToast('Existe pedido em andamento. Aguarde a conclusão ou o cancelamento antes de excluir a conta.','warning',{duration:8000});
    }else if(code.includes('recent_login_required')){
      showToast('Por segurança, saia da conta, entre novamente e repita a exclusão em até 15 minutos.','warning',{duration:9000});
    }else{
      showToast('Não foi possível excluir sua conta agora. Tente novamente ou entre em contato com a pizzaria.','error',{duration:7000});
    }
    button.disabled=false;
  }
});

function addressText(a){
  let out=(a.street||'')+', '+(a.number||'')+' • '+(a.neighborhood||'');
  if(a.city) out+=' • '+a.city+'/'+(a.state||'');
  return out;
}

function renderAddresses(){
  if(!addresses.length){
    $('#accountAddressList').innerHTML=emptyStateHtml({icon:'map-pin',title:'Nenhum endereço cadastrado',description:'Adicione um endereço para agilizar seus próximos pedidos.',actionHtml:'<button id="emptyNewAddressBtn" class="btn btn-primary" type="button">Adicionar endereço</button>'});
    $('#emptyNewAddressBtn')?.addEventListener('click',()=>openAddress(null));
    return;
  }

  $('#accountAddressList').innerHTML=addresses.map(a=>{
    const principal=a.id===profile?.defaultAddressId?'<span class="default-tag">Principal</span>':'';
    const setMain=a.id!==profile?.defaultAddressId
      ?'<button class="btn btn-secondary set-default-address" data-id="'+a.id+'" type="button">Usar como principal</button>'
      :'';

    return '<article class="account-address-card panel">'+
      '<div class="account-address-head"><span class="address-symbol">'+iconHtml('map-pin')+'</span><div><strong>'+esc(a.label||'Endereço')+'</strong>'+principal+'</div></div>'+
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
    if(!await confirmAction('Excluir o endereço “'+(a?.label||'Endereço')+'”?',{title:'Excluir endereço',confirmText:'Excluir',danger:true})) return;
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

  const phone=$('#accAddressPhone').value.trim();
  const cep=$('#accAddressZip').value.replace(/\D/g,'');
  if(!validPhone(phone)){
    $('#accountAddressError').textContent='Informe um telefone válido com DDD.';
    $('#accountAddressError').classList.remove('hidden');
    $('#accAddressPhone').focus();
    return;
  }
  if(cep&&cep.length!==8){
    $('#accountAddressError').textContent='Informe um CEP válido no formato 00000-000.';
    $('#accountAddressError').classList.remove('hidden');
    $('#accAddressZip').focus();
    return;
  }

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

function whatsappDigits(){
  const digits=String(settings?.whatsapp||settings?.phone||'').replace(/\D/g,'');
  if(!digits) return '';
  return digits.startsWith('55')?digits:'55'+digits;
}

function orderWhatsappUrl(order){
  const number=whatsappDigits();
  if(!number) return '';
  const itemSummary=(order.items||[]).slice(0,8).map(item=>Number(item.qty||1)+'x '+String(item.name||'Item')).join(', ');
  const message=[
    'Olá! Gostaria de falar sobre o pedido #'+String(order.orderNumber||0).padStart(4,'0')+'.',
    itemSummary?'Itens: '+itemSummary:'',
    'Status: '+(statusLabels[order.status]||order.status),
    'Total: '+money(order.total)
  ].filter(Boolean).join('\n');
  return 'https://wa.me/'+number+'?text='+encodeURIComponent(message);
}

function canCustomerCancel(order){
  if(!['pending','accepted'].includes(order.status)) return false;
  const minutes=Math.max(0,Number(settings?.customerCancelMinutes??2));
  const created=order.createdAt?.toMillis?.()||0;
  return created>0&&(Date.now()-created)<=minutes*60*1000;
}

function renderOrders(){
  if(!orders.length){
    $('#accountOrdersList').innerHTML=emptyStateHtml({icon:'receipt-text',title:'Você ainda não fez nenhum pedido',description:'Quando você fizer um pedido, o acompanhamento e o histórico aparecerão aqui.',actionHtml:'<a class="btn btn-primary" href="../">Ver cardápio</a>'});
    return;
  }

  $('#accountOrdersList').innerHTML=orders.map(o=>{
    const items=(o.items||[]).map(i=>'<span>'+i.qty+'× '+esc(i.name)+'</span>').join('');
    const reorderButton=o.status!=='cancelled'
      ?'<button class="btn btn-secondary reorder-btn" data-id="'+o.id+'" type="button">Pedir novamente</button>'
      :'';
    const receipt='<a class="btn btn-secondary" href="./receipt.html?id='+encodeURIComponent(o.id)+'" target="_blank" rel="noopener">Comprovante</a>';
    const wa=orderWhatsappUrl(o);
    const whatsapp=wa?'<a class="btn btn-whatsapp" href="'+esc(wa)+'" target="_blank" rel="noopener">WhatsApp</a>':'';
    const cancel=canCustomerCancel(o)
      ?'<button class="btn btn-danger cancel-order-btn" data-id="'+o.id+'" type="button">Cancelar pedido</button>'
      :'';

    return '<article class="account-order-card panel">'+
      '<div class="account-order-top"><div><span class="eyebrow">PEDIDO #'+String(o.orderNumber||0).padStart(4,'0')+'</span>'+
      '<h3>'+esc(statusLabels[o.status]||o.status)+'</h3><small class="muted">'+formatDate(o.createdAt)+'</small></div>'+
      '<strong class="account-order-total">'+money(o.total)+'</strong></div>'+
      '<div class="account-order-items">'+items+'</div>'+
      '<div class="account-order-footer"><span class="status-pill status-'+esc(o.status)+'">'+esc(statusLabels[o.status]||o.status)+'</span>'+
      '<div class="order-customer-actions">'+receipt+whatsapp+cancel+reorderButton+'</div></div>'+
      '</article>';
  }).join('');

  $$('.reorder-btn').forEach(b=>b.onclick=()=>reorder(b.dataset.id));
  $$('.cancel-order-btn').forEach(b=>b.onclick=async()=>{
    const order=orders.find(x=>x.id===b.dataset.id);
    if(!order||!await confirmAction('Cancelar o pedido #'+String(order.orderNumber||0).padStart(4,'0')+'?',{title:'Cancelar pedido',confirmText:'Cancelar pedido',danger:true})) return;
    b.disabled=true;
    b.textContent='Cancelando...';
    try{
      await cancelCustomerOrder(order.id);
    }catch(err){
      console.error(err);
      const code=String(err?.code||'');
      showToast(code.includes('cancel_window_expired')
        ?'O prazo para cancelamento deste pedido terminou.'
        :code.includes('cancel_not_allowed')
          ?'Este pedido já avançou e não pode mais ser cancelado pelo site.'
          :'Não foi possível cancelar o pedido.',
        code.includes('cancel_window_expired')||code.includes('cancel_not_allowed')?'warning':'error');
      b.disabled=false;
      b.textContent='Cancelar pedido';
    }
  });
}
function reorder(id){
  const o=orders.find(x=>x.id===id);
  if(!o) return;
  const newCart=(o.items||[]).map(i=>({...i,lineId:crypto.randomUUID()}));
  localStorage.setItem('deliveryCart',JSON.stringify(newCart));
  location.href='../';
}


function formatRewardDate(value){
  if(!value) return '';
  const parsed=new Date(value);
  return Number.isNaN(parsed.getTime())?'':parsed.toLocaleDateString('pt-BR');
}

function renderCoupons(){
  const host=$('#accountCouponsList');
  if(!host) return;

  if(!couponRewards.length){
    host.innerHTML=emptyStateHtml({icon:'ticket-percent',title:'Nenhum cupom conquistado ainda',description:'Continue pedindo para desbloquear vantagens e benefícios da pizzaria.'});
    return;
  }

  host.innerHTML=couponRewards.map(cp=>{
    const label=cp.type==='percentage'
      ?Number(cp.value||0)+'% OFF'
      :money(cp.value||0)+' OFF';
    const validity=cp.endsAt?'Válido até '+formatRewardDate(cp.endsAt):'Sem data de expiração';
    const code=cp.code||cp.id;
    return '<article class="coupon-wallet-card panel">'+
      '<div class="coupon-wallet-value">'+esc(label)+'</div>'+
      '<div class="coupon-wallet-content">'+
        '<span class="eyebrow">CUPOM</span>'+
        '<h3>'+esc(code)+'</h3>'+
        '<p>'+esc(cp.description||'Benefício conquistado na pizzaria.')+'</p>'+
        '<small class="muted">'+esc(validity)+'</small>'+
      '</div>'+
      '<div class="coupon-wallet-actions">'+
        '<button class="btn btn-secondary copy-coupon icon-button-label" data-code="'+esc(code)+'" type="button">'+iconHtml('copy')+'<span>Copiar código</span></button>'+
        '<a class="btn btn-primary" href="../?coupon='+encodeURIComponent(code)+'">Usar cupom</a>'+
      '</div>'+
    '</article>';
  }).join('');

  $$('.copy-coupon').forEach(b=>b.onclick=async()=>{
    const code=b.dataset.code||'';
    try{
      await navigator.clipboard.writeText(code);
      const original=b.innerHTML;
      b.innerHTML=iconHtml('circle-check')+'<span>Copiado</span>';
      setTimeout(()=>b.innerHTML=original,1400);
    }catch{
      showToast('Código do cupom: '+code,'info',{duration:7000});
    }
  });
}

function productImage(v){
  if(!v) return placeholder;
  if(/^https?:\/\//i.test(v)) return v;
  return '../'+String(v).replace(/^\.?\//,'').replace(/^\//,'');
}

function renderFavorites(){
  const list=products.filter(p=>favorites.has(p.id)&&p.active!==false);

  if(!list.length){
    $('#accountFavoritesList').innerHTML=emptyStateHtml({icon:'heart',title:'Nenhum favorito ainda',description:'Marque seus produtos preferidos para encontrá-los rapidamente depois.',actionHtml:'<a class="btn btn-primary" href="../">Explorar cardápio</a>'});
    return;
  }

  $('#accountFavoritesList').innerHTML=list.map(p=>{
    const price=p.sizes?.length?Math.min(...p.sizes.map(s=>Number(s.price||0))):Number(p.price||0);
    return '<article class="product-card">'+
      '<div class="product-image-wrap"><img class="product-image" src="'+esc(productImage(p.image))+'" alt="">'+
      '<button class="favorite-card-button active remove-fav" data-id="'+p.id+'" type="button" aria-label="Remover dos favoritos" aria-pressed="true">'+iconHtml('heart')+'</button></div>'+
      '<div class="product-content"><div><h3>'+esc(p.name)+'</h3><p>'+esc(p.description||'')+'</p></div>'+
      '<div class="product-foot"><strong class="price">'+money(price)+'</strong>'+
      '<a class="add-round" href="../?product='+encodeURIComponent(p.id)+'" aria-label="Abrir '+esc(p.name)+'">'+iconHtml('plus')+'</a></div></div></article>';
  }).join('');

  $$('.remove-fav').forEach(b=>b.onclick=async()=>{
    await setFavorite(user.uid,b.dataset.id,false);
    favorites.delete(b.dataset.id);
    renderFavorites();
  });
}

$$('dialog').forEach(dialog=>{
  dialog.querySelectorAll('.dialog-close').forEach(btn=>btn.addEventListener('click',()=>{if(dialog.open) dialog.close();}));
  dialog.addEventListener('cancel',e=>{e.preventDefault();if(dialog.open) dialog.close();});
  dialog.addEventListener('click',e=>{if(e.target===dialog&&dialog.open) dialog.close();});
});

$('#switchAccountBtn').onclick=async()=>{
  await logoutCustomer();
  location.href='../?login=1';
};

$('#accountLogoutBtn').onclick=async()=>{
  await logoutCustomer();
  location.href='../';
};

setInterval(()=>{if(user&&orders.length) renderOrders();},30000);
