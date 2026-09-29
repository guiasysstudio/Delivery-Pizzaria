import {
  auth, authPersistenceReady, db, watchCustomer, loginWithGoogle, loginWithEmail, registerWithEmail,
  resetCustomerPassword, friendlyAuthError, lookupBrazilianZip, getCustomerProfile, saveCustomerProfile, getAddresses,
  saveAddress, setDefaultAddress, getFavorites, setFavorite, saveCustomerIdentity,
  formatCpf, validCpf, formatPhone, validPhone, validFullName
} from './customer-auth.js';
import {
  collection, doc, getDoc, getDocs, query, where
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0));
const placeholder='./assets/products/placeholder.svg';
const SECURE_ORDER_ENDPOINT='https://southamerica-east1-delivery-pizzaria-f5b08.cloudfunctions.net/createOrder';

let categories=[],products=[],promotions=[],settings=null;
let cart=JSON.parse(localStorage.getItem('deliveryCart')||'[]');
let selectedCategory='all';
let currentProduct=null,currentQty=1,currentSecondFlavorId='';
let customer=null,customerProfile=null,addresses=[],selectedAddressId=localStorage.getItem('deliverySelectedAddress')||'';
let favorites=new Set(),afterAuthAction=null,selectedPayment='',activeCoupon=null,customerOrderStats={count:0,spent:0};
let deferredInstallPrompt=null;
let pendingCouponCode=normalizeCouponCode(new URLSearchParams(location.search).get('coupon')||'');

const defaultSettings={
  storeName:'Delivery Pizzaria',
  subtitle:'Pizza quentinha, do forno para sua casa.',
  phone:'',
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
  googleMapsUrl:'',
  whatsapp:'',
  customerCancelMinutes:2,
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
  autoAcceptOrders:false,
  payments:['Dinheiro','PIX na entrega','Cartão de débito','Cartão de crédito'],
  timezone:'America/Porto_Velho',
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

function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function attr(v){return esc(v);}
function pathImage(v){
  if(!v) return placeholder;
  if(/^https?:\/\//i.test(v)) return v;
  if(v.startsWith('./')) return v;
  return './'+v.replace(/^\/?/,'');
}
function parseCurrency(v){
  const clean=String(v||'').trim().replace(/\./g,'').replace(',','.');
  return Number(clean||0);
}

async function loadStore(){
  try{
    const [catSnap,prodSnap,promoSnap,setSnap]=await Promise.all([
      getDocs(collection(db,'categories')),
      getDocs(collection(db,'products')),
      getDocs(collection(db,'promotions')).catch(err=>{console.warn('Promoções ainda não liberadas pelas regras.',err);return null;}),
      getDoc(doc(db,'settings','store'))
    ]);
    categories=catSnap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.active!==false).sort((a,b)=>(a.order||0)-(b.order||0));
    const activeCategoryIds=new Set(categories.map(x=>x.id));
    products=prodSnap.docs.map(d=>({id:d.id,...d.data()}))
      .filter(x=>x.active!==false&&activeCategoryIds.has(x.categoryId))
      .sort((a,b)=>(a.order||0)-(b.order||0));
    promotions=promoSnap?.docs?.map(d=>({id:d.id,...d.data()}))||[];
    settings=setSnap.exists()?{...defaultSettings,...setSnap.data()}:defaultSettings;
    renderStore();
    const productId=new URLSearchParams(location.search).get('product');
    if(productId&&products.some(p=>p.id===productId)) setTimeout(()=>openProduct(productId),50);
  }catch(err){
    console.error(err);
    settings=defaultSettings;
    renderStore();
    $('#catalog').innerHTML='<div class="alert alert-error">Não foi possível carregar o cardápio agora. Tente atualizar a página.</div>';
  }
}

watchCustomer(async user=>{
  customer=user;
  if(user){
    try{
      [customerProfile,addresses,favorites]=await Promise.all([
        getCustomerProfile(user.uid),
        getAddresses(user.uid),
        getFavorites(user.uid)
      ]);
      customerOrderStats=await loadCustomerOrderStats(user.uid);
      chooseInitialAddress();
    }catch(err){
      console.error('Falha ao carregar conta:',err);
    }
  }else{
    customerProfile=null;
    addresses=[];
    favorites=new Set();
    activeCoupon=null;
    customerOrderStats={count:0,spent:0};
    selectedAddressId='';
    localStorage.removeItem('deliverySelectedAddress');
  }
  renderCustomerHeader();
  renderAddressSelector();
  renderCatalog();
  renderFeatured();

  if(user){
    const authDialog=$('#authDialog');
    if(authDialog?.open) authDialog.close();
    clearLoginQuery();
  }

  if(afterAuthAction&&user){
    const action=afterAuthAction;
    afterAuthAction=null;
    if(action==='checkout') openCheckout();
    if(action==='address') openAddressSelector();
    if(action.startsWith('favorite:')){
      const productId=action.split(':')[1];
      if(productId) toggleFavorite(productId);
    }
  }
});

function chooseInitialAddress(){
  if(!addresses.length){
    selectedAddressId='';
    return;
  }
  const exists=addresses.some(a=>a.id===selectedAddressId);
  if(!exists){
    selectedAddressId=customerProfile?.defaultAddressId&&addresses.some(a=>a.id===customerProfile.defaultAddressId)
      ?customerProfile.defaultAddressId
      :addresses[0].id;
  }
  localStorage.setItem('deliverySelectedAddress',selectedAddressId);
}

function activeAddress(){
  return addresses.find(a=>a.id===selectedAddressId)||null;
}

function isOpen(){
  if(settings?.openMode==='open') return true;
  if(settings?.openMode==='closed') return false;
  const tz=settings?.timezone||'America/Porto_Velho';
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());
  const wd=parts.find(p=>p.type==='weekday')?.value;
  const map={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
  const now=(parts.find(p=>p.type==='hour')?.value||'00')+':'+(parts.find(p=>p.type==='minute')?.value||'00');
  const day=settings?.schedule?.[map[wd]]||settings?.schedule?.[String(map[wd])];
  if(!day?.enabled) return false;
  if(day.close>=day.open) return now>=day.open&&now<=day.close;
  return now>=day.open||now<=day.close;
}

function storeAddressText(){
  const structured=[
    [settings?.storeStreet,settings?.storeNumber].filter(Boolean).join(', '),
    settings?.storeNeighborhood,
    [settings?.storeCity,settings?.storeState].filter(Boolean).join('/')
  ].filter(Boolean).join(' • ');
  return structured||settings?.storeAddress||'';
}

function normalizedWhatsapp(){
  const digits=String(settings?.whatsapp||settings?.phone||'').replace(/\D/g,'');
  if(!digits) return '';
  return digits.startsWith('55')?digits:'55'+digits;
}

function storeMapsUrl(){
  if(settings?.googleMapsUrl) return settings.googleMapsUrl;
  const address=storeAddressText();
  return address?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(address):'';
}

function renderStoreIdentity(){
  const logo=settings?.storeLogo||'';
  const headerLogo=$('#headerStoreLogo');
  const headerFallback=$('#headerStoreLogoFallback');
  if(headerLogo&&headerFallback){
    headerLogo.classList.toggle('hidden',!logo);
    headerFallback.classList.toggle('hidden',!!logo);
    if(logo){
      headerLogo.src=pathImage(logo);
      headerLogo.onerror=()=>{headerLogo.classList.add('hidden');headerFallback.classList.remove('hidden');};
    }
  }

  const aboutLogo=$('#aboutStoreLogo');
  const aboutFallback=$('#aboutStoreLogoFallback');
  if(aboutLogo&&aboutFallback){
    aboutLogo.classList.toggle('hidden',!logo);
    aboutFallback.classList.toggle('hidden',!!logo);
    if(logo){
      aboutLogo.src=pathImage(logo);
      aboutLogo.onerror=()=>{aboutLogo.classList.add('hidden');aboutFallback.classList.remove('hidden');};
    }
  }

  const address=storeAddressText();
  const maps=storeMapsUrl();
  const whatsapp=normalizedWhatsapp();

  $('#aboutStoreName').textContent=settings?.storeName||'Pizzaria';
  $('#aboutStoreSubtitle').textContent=settings?.subtitle||'';
  $('#aboutStoreAddress').textContent=address||'Não informado';
  $('#aboutStorePhone').textContent=settings?.whatsapp||settings?.phone||'Não informado';

  const mapsLink=$('#aboutMapsLink');
  mapsLink.classList.toggle('hidden',!maps);
  if(maps) mapsLink.href=maps;

  const footerLink=$('#footerAddressLink');
  $('#footerAddress').textContent=address;
  footerLink.classList.toggle('is-disabled',!maps);
  if(maps) footerLink.href=maps; else footerLink.removeAttribute('href');

  const waMessage='Olá! Vim pelo site da '+(settings?.storeName||'pizzaria')+'.';
  const waUrl=whatsapp?'https://wa.me/'+whatsapp+'?text='+encodeURIComponent(waMessage):'';
  const aboutWa=$('#aboutWhatsappLink');
  const floatingWa=$('#floatingWhatsapp');
  aboutWa.classList.toggle('hidden',!waUrl);
  floatingWa.classList.toggle('hidden',!waUrl);
  if(waUrl){aboutWa.href=waUrl;floatingWa.href=waUrl;}
}

function renderStore(){
  document.title=`${settings.storeName} • Delivery`;
  $('#storeName').textContent=settings.storeName;
  $('#headerStoreName').textContent=settings.storeName;
  $('#storeSubtitle').textContent=settings.subtitle||'';
  $('#footerStore').textContent=settings.storeName;
  renderStoreIdentity();
  $('#minimumOrderText').textContent=Number(settings.minimumOrder||0)>0?`Pedido mínimo ${money(settings.minimumOrder)}`:'';
  const open=isOpen();
  $('#storeStatus').textContent=open?'● Aberto agora':'● Fechado agora';
  $('#storeStatus').classList.toggle('closed',!open);
  $('#headerStoreStatus').textContent=open?'Aberto agora':'Fechado agora';
  $('#headerStoreStatus').classList.toggle('closed-text',!open);
  renderCategories();
  renderFeatured();
  renderCatalog();
  renderCart();
  renderCustomerHeader();
  renderPaymentOptions();
  renderPromotionBanner();
}

function clearLoginQuery(){
  const url=new URL(location.href);
  if(url.searchParams.has('login')){
    url.searchParams.delete('login');
    history.replaceState(null,'',url.pathname+(url.search?url.search:'')+url.hash);
  }
}

function customerPhoto(){
  return customerProfile?.customPhotoURL||customerProfile?.photoURL||customer?.photoURL||'';
}

function setAvatarElement(element,url,fallback='👤'){
  if(!element) return;
  element.replaceChildren();
  if(url){
    const img=document.createElement('img');
    img.src=url;
    img.alt='Foto do perfil';
    img.referrerPolicy='no-referrer';
    img.onerror=()=>{
      element.replaceChildren(document.createTextNode(fallback));
      element.classList.remove('has-photo');
    };
    element.appendChild(img);
    element.classList.add('has-photo');
  }else{
    element.textContent=fallback;
    element.classList.remove('has-photo');
  }
}

function renderCustomerHeader(){
  const address=activeAddress();
  $('#activeAddressText').textContent=address
    ?`${address.label||'Endereço'} • ${address.street}, ${address.number}`
    :(customer?'Cadastre um endereço':'Informe seu endereço');
  if(customer){
    const name=customerProfile?.name||customer.displayName||'Cliente';
    $('#accountHello').textContent='Olá, '+name.split(' ')[0];
    $('#accountLabel').textContent='Minha conta';
    setAvatarElement($('#accountAvatar'),customerPhoto(),(name[0]||'👤').toUpperCase());
  }else{
    $('#accountHello').textContent='Olá!';
    $('#accountLabel').textContent='Entrar ou cadastrar';
    setAvatarElement($('#accountAvatar'),'','👤');
  }
}

async function loadCustomerOrderStats(uid){
  try{
    const snap=await getDocs(query(collection(db,'orders'),where('customerId','==',uid)));
    const completed=snap.docs.map(d=>d.data()).filter(o=>o.status==='completed');
    return {
      count:completed.length,
      spent:completed.reduce((sum,o)=>sum+Number(o.total||0),0)
    };
  }catch(err){
    console.warn('Não foi possível carregar o histórico para regras de cupom.',err);
    return {count:0,spent:0};
  }
}

function promotionIsActive(p){
  if(p?.active===false) return false;
  const now=Date.now();
  const start=p?.startsAt?new Date(p.startsAt).getTime():0;
  const end=p?.endsAt?new Date(p.endsAt).getTime():0;
  if(start&&Number.isFinite(start)&&now<start) return false;
  if(end&&Number.isFinite(end)&&now>end) return false;
  return true;
}

function promotionMatchesProduct(p,product){
  if(!promotionIsActive(p)) return false;
  if(p.targetType==='all') return true;
  if(p.targetType==='category') return p.targetId===product.categoryId;
  if(p.targetType==='product') return p.targetId===product.id;
  return false;
}

function applyPromotionValue(base,promo){
  const value=Number(base||0);
  if(!promo) return value;
  if(promo.discountType==='percentage'){
    return Math.max(0,value-(value*Number(promo.discountValue||0)/100));
  }
  return Math.max(0,value-Number(promo.discountValue||0));
}

function bestPromotionForProduct(product,basePrice){
  const matches=promotions.filter(p=>promotionMatchesProduct(p,product));
  if(!matches.length) return null;
  return matches.map(p=>({promo:p,price:applyPromotionValue(basePrice,p)}))
    .sort((a,b)=>a.price-b.price)[0];
}

function productDisplayPrice(product,basePrice){
  const best=bestPromotionForProduct(product,basePrice);
  return best?best.price:Number(basePrice||0);
}

function renderPromotionBanner(){
  const active=promotions.filter(p=>promotionIsActive(p));
  const banner=$('#promotionBanner');
  if(!banner) return;
  banner.classList.toggle('hidden',!active.length);
  if(!active.length) return;
  const p=active[0];
  $('#promotionBannerTitle').textContent=p.name||'Promoção';
  $('#promotionBannerText').textContent=p.description||(
    p.discountType==='percentage'
      ?`${Number(p.discountValue||0)}% de desconto`
      :`${money(p.discountValue)} de desconto`
  );
}

function normalizeCouponCode(value){
  return String(value||'').trim().toUpperCase().replace(/\s+/g,'').replace(/[^A-Z0-9_-]/g,'');
}

function couponValidation(coupon,subtotal){
  if(!coupon||coupon.active===false) return {valid:false,message:'Cupom inválido ou inativo.'};
  const now=Date.now();
  const start=coupon.startsAt?new Date(coupon.startsAt).getTime():0;
  const end=coupon.endsAt?new Date(coupon.endsAt).getTime():0;
  if(start&&Number.isFinite(start)&&now<start) return {valid:false,message:'Este cupom ainda não começou.'};
  if(end&&Number.isFinite(end)&&now>end) return {valid:false,message:'Este cupom expirou.'};
  if(subtotal<Number(coupon.minimumOrder||0)) return {valid:false,message:`Pedido mínimo para este cupom: ${money(coupon.minimumOrder)}.`};
  if(customerOrderStats.count<Number(coupon.minOrders||0)) return {valid:false,message:`Este cupom exige pelo menos ${coupon.minOrders} pedido(s) concluído(s).`};
  if(customerOrderStats.spent<Number(coupon.minSpent||0)) return {valid:false,message:`Este cupom exige ${money(coupon.minSpent)} em compras anteriores.`};
  return {valid:true,message:'Cupom aplicado com sucesso.'};
}

function couponDiscount(subtotal){
  if(!activeCoupon) return 0;
  const validation=couponValidation(activeCoupon,subtotal);
  if(!validation.valid) return 0;
  let discount=activeCoupon.type==='percentage'
    ?subtotal*Number(activeCoupon.value||0)/100
    :Number(activeCoupon.value||0);
  const max=Number(activeCoupon.maxDiscount||0);
  if(max>0) discount=Math.min(discount,max);
  return Math.max(0,Math.min(subtotal,discount));
}

function renderCouponState(message=''){
  const feedback=$('#couponFeedback');
  if(!feedback) return;
  $('#couponAppliedBadge').classList.toggle('hidden',!activeCoupon);
  $('#removeCouponBtn').classList.toggle('hidden',!activeCoupon);
  $('#applyCouponBtn').classList.toggle('hidden',!!activeCoupon);
  if(activeCoupon) $('#couponCodeInput').value=activeCoupon.code||activeCoupon.id||'';
  feedback.classList.toggle('hidden',!message&&!activeCoupon);
  feedback.classList.toggle('invalid',!!message&&!activeCoupon);
  feedback.textContent=message||(activeCoupon?couponValidation(activeCoupon,cart.reduce((a,x)=>a+Number(x.unitPrice)*Number(x.qty),0)).message:'');
}

async function applyCoupon(){
  if(!customer){
    afterAuthAction='checkout';
    openAuth();
    return;
  }
  const code=normalizeCouponCode($('#couponCodeInput').value);
  if(!code) return renderCouponState('Digite o código do cupom.');
  try{
    const snap=await getDoc(doc(db,'coupons',code));
    if(!snap.exists()){
      activeCoupon=null;
      renderCouponState('Cupom não encontrado.');
      renderCart();
      return;
    }
    const coupon={id:snap.id,...snap.data()};
    const subtotal=cart.reduce((a,x)=>a+Number(x.unitPrice)*Number(x.qty),0);
    const validation=couponValidation(coupon,subtotal);
    if(!validation.valid){
      activeCoupon=null;
      renderCouponState(validation.message);
      renderCart();
      return;
    }
    activeCoupon=coupon;
    renderCouponState(validation.message);
    renderCart();
  }catch(err){
    console.error(err);
    activeCoupon=null;
    renderCouponState('Não foi possível validar o cupom agora.');
  }
}

$('#applyCouponBtn')?.addEventListener('click',applyCoupon);
$('#couponCodeInput')?.addEventListener('keydown',e=>{
  if(e.key==='Enter'){e.preventDefault();applyCoupon();}
});
$('#removeCouponBtn')?.addEventListener('click',()=>{
  activeCoupon=null;
  $('#couponCodeInput').value='';
  renderCouponState('');
  renderCart();
});

function categoryRank(category){
  const name=String(category?.name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(name.includes('combo')) return 0;
  if(name.includes('pizza')&&!name.includes('doce')) return 1;
  if(name.includes('pizza')&&name.includes('doce')) return 2;
  if(name.includes('bebida')||name.includes('refrigerante')) return 3;
  return 20+Number(category?.order||0);
}

function orderedCategories(){
  return [...categories].sort((a,b)=>{
    const rank=categoryRank(a)-categoryRank(b);
    if(rank) return rank;
    const order=Number(a.order||0)-Number(b.order||0);
    return order||String(a.name||'').localeCompare(String(b.name||''),'pt-BR');
  });
}

function renderCategories(){
  const items=[{id:'all',name:'Todos'},...orderedCategories()];
  $('#categoryChips').innerHTML=items.map(cat=>`<button class="chip ${selectedCategory===cat.id?'active':''}" data-id="${cat.id}">${esc(cat.name)}</button>`).join('');
  $$('.chip').forEach(b=>b.onclick=()=>{
    const id=b.dataset.id;
    selectedCategory=id;
    renderCategories();

    const term=$('#searchInput').value.trim();
    if(term){
      renderCatalog();
      return;
    }

    if(id==='all'){
      $('#catalogRoot').scrollIntoView({behavior:'smooth',block:'start'});
      return;
    }

    document.getElementById('category-section-'+id)?.scrollIntoView({behavior:'smooth',block:'start'});
  });

  const active=$('#categoryChips .chip.active');
  active?.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});
}

function productCard(p){
  const base=p.sizes?.length?Math.min(...p.sizes.map(s=>Number(s.price||0))):Number(p.price||0);
  const best=bestPromotionForProduct(p,base);
  const from=best?best.price:base;
  const fav=customer&&favorites.has(p.id);
  return `<article class="product-card">
    <div class="product-image-wrap">
      <img class="product-image" src="${attr(pathImage(p.image))}" onerror="this.src='${placeholder}'" alt="${attr(p.name)}">
      <button class="favorite-card-button ${fav?'active':''}" data-fav="${p.id}" type="button" aria-label="Favoritar">${fav?'♥':'♡'}</button>
      ${best?`<span class="featured-tag promo-tag">${best.promo.discountType==='percentage'?Number(best.promo.discountValue)+'% OFF':'OFERTA'}</span>`:(p.featured?'<span class="featured-tag">Destaque</span>':'')}
    </div>
    <div class="product-content">
      <div><h3>${esc(p.name)}</h3><p>${esc(p.description||'')}</p></div>
      <div class="product-foot">
        <span><small>${p.sizes?.length?'A partir de':''}</small>${best?`<del class="old-price">${money(base)}</del>`:''}<strong class="price">${money(from)}</strong></span>
        <button class="add-round add-product" data-id="${p.id}" type="button">+</button>
      </div>
    </div>
  </article>`;
}
function bindProductCards(scope=document){
  scope.querySelectorAll('.add-product').forEach(b=>b.onclick=()=>openProduct(b.dataset.id));
  scope.querySelectorAll('.favorite-card-button').forEach(b=>b.onclick=async e=>{
    e.stopPropagation();
    await toggleFavorite(b.dataset.fav);
  });
}

let categoryObserver=null;

function renderFeatured(){
  const term=$('#searchInput').value.trim();
  const list=products.filter(p=>p.featured).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'pt-BR')).slice(0,6);
  $('#featuredSection').classList.toggle('hidden',!list.length||!!term);
  $('#featuredCatalog').innerHTML=list.map(productCard).join('');
  bindProductCards($('#featuredCatalog'));
}

function bindCategoryScrollSpy(){
  categoryObserver?.disconnect();
  const sections=[...document.querySelectorAll('[data-catalog-category]')];
  if(!sections.length) return;

  categoryObserver=new IntersectionObserver(entries=>{
    const visible=entries
      .filter(entry=>entry.isIntersecting)
      .sort((a,b)=>Math.abs(a.boundingClientRect.top)-Math.abs(b.boundingClientRect.top))[0];
    if(!visible) return;
    const id=visible.target.dataset.catalogCategory;
    if(id&&id!==selectedCategory){
      selectedCategory=id;
      renderCategories();
    }
  },{rootMargin:'-150px 0px -55% 0px',threshold:[0,.05,.2]});

  sections.forEach(section=>categoryObserver.observe(section));
}

function renderCatalog(){
  const term=$('#searchInput').value.trim().toLowerCase();
  const flat=$('#catalog');
  const sections=$('#catalogSections');

  if(term){
    categoryObserver?.disconnect();
    sections.innerHTML='';
    sections.classList.add('hidden');
    flat.classList.remove('hidden');
    const list=products
      .filter(p=>(selectedCategory==='all'||p.categoryId===selectedCategory)&&`${p.name} ${p.description||''}`.toLowerCase().includes(term))
      .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'pt-BR'));
    $('#catalogTitle').textContent=selectedCategory==='all'?'Resultados da busca':categories.find(x=>x.id===selectedCategory)?.name||'Resultados';
    $('#catalogEmpty').classList.toggle('hidden',list.length>0);
    flat.innerHTML=list.map(productCard).join('');
    bindProductCards(flat);
  }else{
    flat.classList.add('hidden');
    flat.innerHTML='';
    sections.classList.remove('hidden');
    $('#catalogTitle').textContent='Cardápio';

    const groups=orderedCategories().map(category=>({
      category,
      items:products.filter(p=>p.categoryId===category.id)
        .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'pt-BR'))
    })).filter(group=>group.items.length);

    $('#catalogEmpty').classList.toggle('hidden',groups.length>0);
    sections.innerHTML=groups.map(({category,items})=>`
      <section id="category-section-${category.id}" class="catalog-category-section" data-catalog-category="${category.id}">
        <div class="section-heading category-section-heading">
          <div><span class="eyebrow">CARDÁPIO</span><h2>${esc(category.name)}</h2></div>
          <span class="category-count">${items.length} item(ns)</span>
        </div>
        <div class="catalog-grid">${items.map(productCard).join('')}</div>
      </section>`).join('');
    bindProductCards(sections);
    requestAnimationFrame(bindCategoryScrollSpy);
  }

  renderFeatured();
}

function categoryIsPizza(product){
  const category=categories.find(c=>c.id===product.categoryId);
  return product.isPizza===true||/pizza/i.test(category?.name||'');
}
function allowsHalf(product){
  return categoryIsPizza(product)&&(product.allowHalfHalf!==false)&&Array.isArray(product.sizes)&&product.sizes.length>0;
}

function openProduct(id){
  currentProduct=products.find(p=>p.id===id);
  if(!currentProduct) return;
  currentQty=1;
  currentSecondFlavorId='';
  $('#modalName').textContent=currentProduct.name;
  $('#modalDescription').textContent=currentProduct.description||'';
  $('#modalImage').src=pathImage(currentProduct.image);
  $('#modalFeatured').classList.toggle('hidden',!currentProduct.featured);
  $('#itemNote').value='';
  $('#favoriteBtn').textContent=customer&&favorites.has(currentProduct.id)?'♥':'♡';
  $('#favoriteBtn').classList.toggle('active',customer&&favorites.has(currentProduct.id));
  renderFlavorOptions();
  renderOptionGroups();
  updateModalPrice();
  $('#productDialog').showModal();
}

function renderFlavorOptions(){
  if(!allowsHalf(currentProduct)){
    $('#flavorOptions').innerHTML='';
    return;
  }
  const others=products.filter(p=>p.id!==currentProduct.id&&p.categoryId===currentProduct.categoryId&&categoryIsPizza(p)&&p.active!==false);
  $('#flavorOptions').innerHTML=`<div class="option-group">
    <h3>Sabores</h3>
    <div class="segmented flavor-mode">
      <label><input type="radio" name="flavorMode" value="whole" checked><span>1 sabor</span></label>
      <label><input type="radio" name="flavorMode" value="half"><span>Meio a meio</span></label>
    </div>
    <label class="field hidden" id="secondFlavorField">
      <span>Segundo sabor</span>
      <select id="secondFlavorSelect"><option value="">Escolha o segundo sabor</option>${others.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
    </label>
  </div>`;
  $$('input[name=flavorMode]').forEach(r=>r.onchange=()=>{
    const half=document.querySelector('input[name=flavorMode]:checked')?.value==='half';
    $('#secondFlavorField').classList.toggle('hidden',!half);
    if(!half){currentSecondFlavorId='';$('#secondFlavorSelect').value='';}
    updateModalPrice();
  });
  $('#secondFlavorSelect').onchange=()=>{currentSecondFlavorId=$('#secondFlavorSelect').value;updateModalPrice();};
}

function renderOptionGroups(){
  const sizes=currentProduct.sizes||[];
  $('#sizeOptions').innerHTML=sizes.length?`<div class="option-group"><h3>Escolha o tamanho</h3><div class="option-list">${sizes.map((s,i)=>{
    const raw=Number(s.price||0);
    const promo=productDisplayPrice(currentProduct,raw);
    return `<label class="option-choice"><span><input type="radio" name="size" value="${i}" ${i===0?'checked':''}> ${esc(s.name)}</span><strong>${promo<raw?`<del class="old-price">${money(raw)}</del> `:''}${money(promo)}</strong></label>`;
  }).join('')}</div></div>`:'';
  const extras=currentProduct.extras||[];
  $('#extraOptions').innerHTML=extras.length?`<div class="option-group"><h3>Adicionais</h3><div class="option-list">${extras.map((x,i)=>`<label class="option-choice"><span><input type="checkbox" name="extra" value="${i}"> ${esc(x.name)}</span><strong>+ ${money(x.price)}</strong></label>`).join('')}</div></div>`:'';
  $$('input[name=size],input[name=extra]').forEach(i=>i.onchange=updateModalPrice);
}

function selectedSize(){
  const sizes=currentProduct?.sizes||[];
  if(!sizes.length) return null;
  const idx=Number(document.querySelector('input[name=size]:checked')?.value||0);
  return sizes[idx]||sizes[0];
}

function flavorBasePrice(){
  let raw=Number(currentProduct?.price||0);
  const size=selectedSize();
  if(size) raw=Number(size.price||0);
  const half=document.querySelector('input[name=flavorMode]:checked')?.value==='half';
  if(half&&currentSecondFlavorId&&size){
    const second=products.find(p=>p.id===currentSecondFlavorId);
    const matching=second?.sizes?.find(s=>String(s.name).toLowerCase()===String(size.name).toLowerCase());
    if(matching) raw=Math.max(raw,Number(matching.price||0));
  }
  return productDisplayPrice(currentProduct,raw);
}

function currentPromotionSnapshot(){
  if(!currentProduct) return null;
  let raw=Number(currentProduct.price||0);
  const size=selectedSize();
  if(size) raw=Number(size.price||0);
  const best=bestPromotionForProduct(currentProduct,raw);
  if(!best) return null;
  return {
    id:best.promo.id,
    name:best.promo.name||'Promoção',
    discountType:best.promo.discountType,
    discountValue:Number(best.promo.discountValue||0),
    originalBasePrice:raw,
    promotedBasePrice:best.price
  };
}
function chosenUnitPrice(){
  let price=flavorBasePrice();
  $$('input[name=extra]:checked').forEach(el=>price+=Number(currentProduct.extras?.[Number(el.value)]?.price||0));
  return price;
}

function updateModalPrice(){
  $('#qtyValue').textContent=currentQty;
  $('#modalPrice').textContent=money(chosenUnitPrice()*currentQty);
}

$('#qtyMinus').onclick=()=>{currentQty=Math.max(1,currentQty-1);updateModalPrice();};
$('#qtyPlus').onclick=()=>{currentQty++;updateModalPrice();};
$('#favoriteBtn').onclick=()=>currentProduct&&toggleFavorite(currentProduct.id);

async function toggleFavorite(productId){
  if(!customer){
    afterAuthAction='favorite:'+productId;
    openAuth();
    return;
  }
  const next=!favorites.has(productId);
  try{
    await setFavorite(customer.uid,productId,next);
    if(next) favorites.add(productId); else favorites.delete(productId);
    renderCatalog();
    renderFeatured();
    if(currentProduct?.id===productId){
      $('#favoriteBtn').textContent=next?'♥':'♡';
      $('#favoriteBtn').classList.toggle('active',next);
    }
  }catch(err){console.error(err);}
}

$('#productForm').addEventListener('submit',e=>{
  e.preventDefault();
  if(!currentProduct) return;
  const half=document.querySelector('input[name=flavorMode]:checked')?.value==='half';
  if(half&&!currentSecondFlavorId){
    alert('Escolha o segundo sabor.');
    return;
  }
  const second=half?products.find(p=>p.id===currentSecondFlavorId):null;
  const extras=$$('input[name=extra]:checked').map(el=>currentProduct.extras[Number(el.value)]);
  const size=selectedSize();
  cart.push({
    lineId:crypto.randomUUID(),
    productId:currentProduct.id,
    flavorProductIds:half&&second?[currentProduct.id,second.id]:[currentProduct.id],
    name:half&&second?`${currentProduct.name} / ${second.name}`:currentProduct.name,
    flavors:half&&second?[currentProduct.name,second.name]:[currentProduct.name],
    size,
    extras,
    unitPrice:chosenUnitPrice(),
    promotion:currentPromotionSnapshot(),
    qty:currentQty,
    note:$('#itemNote').value.trim()
  });
  saveCart();
  $('#productDialog').close();
});

function saveCart(){
  localStorage.setItem('deliveryCart',JSON.stringify(cart));
  renderCart();
}

function fulfillment(){
  return document.querySelector('input[name=fulfillment]:checked')?.value||'delivery';
}
function normalizeZoneName(value){
  return String(value||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ');
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

function deliveryQuote(address=activeAddress()){
  if(fulfillment()!=='delivery') return {supported:true,fee:0,mode:'pickup'};

  const mode=settings?.deliveryPricingMode||'fixed';
  const fallback=Number(settings?.deliveryFee||0);

  if(mode==='fixed'){
    return {supported:true,fee:fallback,mode};
  }

  if(mode==='neighborhood'){
    const zones=Array.isArray(settings?.deliveryZones)?settings.deliveryZones:[];
    const neighborhood=normalizeZoneName(address?.neighborhood);
    const zone=zones.find(z=>normalizeZoneName(z.neighborhood)===neighborhood);

    if(zone) return {supported:true,fee:Number(zone.fee||0),mode,zone};

    if(address&&settings?.restrictDeliveryZones===true&&zones.length){
      return {supported:false,fee:0,mode,reason:'neighborhood_not_served'};
    }

    return {supported:true,fee:Number(settings?.deliveryNeighborhoodFallbackFee??fallback),mode,zone:null};
  }

  if(mode==='km'){
    if(!address) return {supported:false,fee:0,mode,pending:true,reason:'address_required'};
    const distance=distanceKmBetween(settings?.storeLocation,address?.location);
    if(distance==null){
      return {supported:false,fee:0,mode,pending:true,reason:'location_required'};
    }

    const bands=(Array.isArray(settings?.deliveryKmBands)?settings.deliveryKmBands:[])
      .slice().sort((a,b)=>Number(a.maxKm||0)-Number(b.maxKm||0));
    const band=bands.find(b=>distance<=Number(b.maxKm||0));

    if(band){
      return {
        supported:true,
        fee:Number(band.fee||0),
        mode,
        distanceKm:distance,
        maxKm:Number(band.maxKm||0)
      };
    }

    if(settings?.restrictDeliveryKm===true&&bands.length){
      return {supported:false,fee:0,mode,distanceKm:distance,reason:'distance_not_served'};
    }

    const last=bands.at(-1);
    return {
      supported:true,
      fee:last?Number(last.fee||0):fallback,
      mode,
      distanceKm:distance,
      maxKm:last?Number(last.maxKm||0):null
    };
  }

  return {supported:true,fee:fallback,mode:'fixed'};
}

async function ensureDeliveryAddressCoordinates(address){
  if(!address||(settings?.deliveryPricingMode||'fixed')!=='km') return address;
  if(address.location?.latitude!=null&&address.location?.longitude!=null) return address;
  if(!address.zip) return address;

  try{
    const data=await lookupBrazilianZip(address.zip);
    if(!data?.location) return address;
    const updated={...address,location:data.location};
    if(customer&&address.id){
      await saveAddress(customer.uid,updated,address.id);
      addresses=addresses.map(a=>a.id===address.id?updated:a);
    }
    return updated;
  }catch(err){
    console.warn('Não foi possível localizar o CEP do endereço para cálculo por km.',err);
    return address;
  }
}

function deliveryQuoteText(quote){
  if(quote.pending) return 'Taxa de entrega: calculada após localizar o CEP';
  if(!quote.supported) return 'Este endereço está fora da área de entrega';
  if(quote.mode==='km'&&Number.isFinite(quote.distanceKm)){
    return `Distância aproximada: ${quote.distanceKm.toFixed(1).replace('.',',')} km • Taxa: ${money(quote.fee)}`;
  }
  if(quote.mode==='neighborhood'&&quote.zone){
    return `Taxa para ${quote.zone.neighborhood}: ${money(quote.fee)}`;
  }
  return `Taxa de entrega: ${money(quote.fee)}`;
}

function cartTotals(){
  const subtotal=cart.reduce((a,x)=>a+Number(x.unitPrice)*Number(x.qty),0);
  const discount=couponDiscount(subtotal);
  const quote=deliveryQuote();
  const fee=subtotal&&fulfillment()==='delivery'&&quote.supported?quote.fee:0;
  return {subtotal,discount,fee,total:Math.max(0,subtotal-discount+fee),deliverySupported:quote.supported,deliveryPending:!!quote.pending,deliveryQuote:quote};
}
function renderCart(){
  const count=cart.reduce((a,x)=>a+Number(x.qty||0),0);
  const {subtotal,discount,fee,total,deliveryPending}=cartTotals();
  $('#cartCount').textContent=count;
  $('#floatingCount').textContent=count;
  $('#headerCartCount').textContent=count;
  $('#mobileCartCount').textContent=count;
  $('#subtotal').textContent=money(subtotal);
  $('#discountRow').classList.toggle('hidden',discount<=0);
  $('#discountTotal').textContent='- '+money(discount);
  $('#deliveryFee').textContent=deliveryPending?'A calcular':money(fee);
  $('#total').textContent=money(total);
  $('#checkoutTotal').textContent=money(total);
  const storeOpen=isOpen();
  $('#checkoutBtn').disabled=!count;
  $('#checkoutBtn').textContent=!count?'Carrinho vazio':(storeOpen?'Continuar':'Loja fechada • ver detalhes');
  $('#checkoutBtn').title=storeOpen?'Finalizar pedido':'A pizzaria está fechada para novos pedidos no momento.';
  $('#cartItems').innerHTML=cart.length?cart.map(x=>`<div class="cart-item">
    <div class="cart-item-top"><div><strong>${x.qty}× ${esc(x.name)}</strong><br><small>${[x.size?.name,...(x.extras||[]).map(e=>e.name)].filter(Boolean).map(esc).join(' • ')}</small>${x.note?`<br><small>Obs.: ${esc(x.note)}</small>`:''}</div><strong>${money(x.unitPrice*x.qty)}</strong></div>
    <div class="mini-actions"><button data-act="minus" data-id="${x.lineId}" type="button">−</button><span>${x.qty}</span><button data-act="plus" data-id="${x.lineId}" type="button">+</button><button data-act="remove" data-id="${x.lineId}" type="button" title="Remover">×</button></div>
  </div>`).join(''):'<div class="cart-empty"><span>🛒</span><strong>Seu carrinho está vazio</strong><small>Adicione seus favoritos do cardápio.</small></div>';
  $$('.mini-actions button').forEach(b=>b.onclick=()=>{
    const x=cart.find(i=>i.lineId===b.dataset.id);
    if(!x) return;
    if(b.dataset.act==='plus') x.qty++;
    if(b.dataset.act==='minus') x.qty=Math.max(1,x.qty-1);
    if(b.dataset.act==='remove') cart=cart.filter(i=>i.lineId!==x.lineId);
    saveCart();
  });
  updateChangePreview();
}

function openAuth(mode='login'){
  setAuthMode(mode);
  $('#authDialog').showModal();
}
function setAuthMode(mode){
  const login=mode==='login';
  $('#loginCustomerForm').classList.toggle('hidden',!login);
  $('#registerCustomerForm').classList.toggle('hidden',login);
  $('#authTitle').textContent=login?'Entrar':'Criar conta';
  $('#authSubtitle').textContent=login?'Entre para usar seus endereços e acompanhar pedidos.':'Crie sua conta para salvar endereços e acompanhar pedidos.';
  $('#customerAuthError').classList.add('hidden');
  $('#registerAuthError').classList.add('hidden');
}
$('#authCloseBtn').onclick=()=>{$('#authDialog').close();afterAuthAction=null;};
$('#showRegisterBtn').onclick=()=>setAuthMode('register');
$('#showLoginBtn').onclick=()=>setAuthMode('login');
async function redirectIncompleteCustomerProfile(user){
  if(!user) return false;
  try{
    const profile=await getCustomerProfile(user.uid);
    if(profile?.identityComplete===true&&validFullName(profile?.name||user.displayName||'')) return false;
  }catch(err){
    console.warn('Não foi possível conferir se o cadastro está completo.',err);
  }
  localStorage.setItem('deliveryReturnAfterProfile','../');
  location.href='./account/#profile';
  return true;
}

let googleLoginBusy=false;

$('#googleLoginBtn').onclick=async()=>{
  if(googleLoginBusy) return;
  googleLoginBusy=true;
  const button=$('#googleLoginBtn');
  const original=button.innerHTML;
  button.disabled=true;
  button.textContent='Abrindo Google...';
  $('#customerAuthError').classList.add('hidden');

  try{
    const user=await loginWithGoogle();
    if($('#authDialog').open) $('#authDialog').close();
    clearLoginQuery();
    if(await redirectIncompleteCustomerProfile(user)) return;
  }catch(err){
    console.error('Falha no login Google:',err);
    showAuthError(friendlyAuthError(err));
  }finally{
    googleLoginBusy=false;
    button.disabled=false;
    button.innerHTML=original;
  }
};

$('#loginCustomerForm').onsubmit=async e=>{
  e.preventDefault();
  try{
    const user=await loginWithEmail($('#customerLoginEmail').value,$('#customerLoginPassword').value);
    if($('#authDialog').open) $('#authDialog').close();
    clearLoginQuery();
    if(await redirectIncompleteCustomerProfile(user)) return;
  }catch(err){
    showAuthError(friendlyAuthError(err));
  }
};

$('#registerCustomerForm').onsubmit=async e=>{
  e.preventDefault();
  const name=$('#registerName').value.trim();
  const phone=$('#registerPhone').value.trim();
  const cpf=$('#registerCpf').value.trim();

  if(!validFullName(name)){
    $('#registerAuthError').textContent='Informe seu nome completo, com pelo menos nome e sobrenome.';
    $('#registerAuthError').classList.remove('hidden');
    return;
  }
  if(!validPhone(phone)){
    $('#registerAuthError').textContent='Informe um telefone válido com DDD.';
    $('#registerAuthError').classList.remove('hidden');
    $('#registerPhone').focus();
    return;
  }
  if(!validCpf(cpf)){
    $('#registerAuthError').textContent='Informe um CPF válido.';
    $('#registerAuthError').classList.remove('hidden');
    return;
  }

  try{
    const user=await registerWithEmail({
      name,
      phone,
      email:$('#registerEmail').value,
      password:$('#registerPassword').value
    });
    await saveCustomerIdentity({name,phone,cpf});
    customerProfile=await getCustomerProfile(user.uid);
    if($('#authDialog').open) $('#authDialog').close();
    clearLoginQuery();
  }catch(err){
    console.error('Falha no cadastro:',err);
    const code=String(err?.code||'');
    const message=code.includes('cpf_already_registered')
      ?'Este CPF já está vinculado a outra conta.'
      :code.includes('invalid_cpf')
        ?'Informe um CPF válido.'
        :friendlyAuthError(err);

    if(auth.currentUser&&!code.startsWith('auth/')){
      alert(message+' Sua conta foi criada, mas o cadastro precisa ser concluído em Minha Conta.');
      location.href='./account/#profile';
      return;
    }

    $('#registerAuthError').textContent=message;
    $('#registerAuthError').classList.remove('hidden');
  }
};
function showAuthError(message){
  $('#customerAuthError').textContent=message;
  $('#customerAuthError').classList.remove('hidden');
}
$('#forgotPasswordBtn').onclick=async()=>{
  const email=$('#customerLoginEmail').value.trim();
  if(!email) return showAuthError('Digite seu e-mail primeiro.');
  try{
    await resetCustomerPassword(email);
    showAuthError('Enviamos o link de redefinição para seu e-mail.');
    $('#customerAuthError').classList.remove('alert-error');
  }catch(err){showAuthError(friendlyAuthError(err));}
};

$('#aboutBtn')?.addEventListener('click',()=>$('#aboutDialog').showModal());
$('#footerAboutBtn')?.addEventListener('click',()=>$('#aboutDialog').showModal());
$('#accountBtn').onclick=()=>customer?location.href='./account/':openAuth();
$('#addressSelectorBtn').onclick=openAddressSelector;
$('#addressSelectorClose').onclick=()=>$('#addressSelectorDialog').close();
$('#addressLoginBtn').onclick=()=>{
  $('#addressSelectorDialog').close();
  afterAuthAction='address';
  openAuth();
};
$('#newAddressFromSelector').onclick=()=>openAddressEditor();

function openAddressSelector(){
  renderAddressSelector();
  $('#addressSelectorDialog').showModal();
}
function renderAddressSelector(){
  $('#addressSelectorGuest').classList.toggle('hidden',!!customer);
  $('#addressSelectorUser').classList.toggle('hidden',!customer);
  if(!customer) return;
  $('#addressSelectorList').innerHTML=addresses.length?addresses.map(a=>`<button class="address-select-card ${a.id===selectedAddressId?'active':''}" data-id="${a.id}" type="button">
    <span class="address-radio">${a.id===selectedAddressId?'●':'○'}</span>
    <span><strong>${esc(a.label||'Endereço')}</strong><small>${esc(a.street)}, ${esc(a.number)} • ${esc(a.neighborhood)}${a.city?` • ${esc(a.city)}/${esc(a.state)}`:''}</small></span>
  </button>`).join(''):'<div class="empty-state">Você ainda não cadastrou endereços.</div>';
  $$('.address-select-card').forEach(b=>b.onclick=async()=>{
    selectedAddressId=b.dataset.id;
    localStorage.setItem('deliverySelectedAddress',selectedAddressId);
    await setDefaultAddress(customer.uid,selectedAddressId).catch(console.error);
    customerProfile={...customerProfile,defaultAddressId:selectedAddressId};
    const selected=addresses.find(a=>a.id===selectedAddressId);
    if(selected) await ensureDeliveryAddressCoordinates(selected);
    renderAddressSelector();
    renderCustomerHeader();
    renderCheckoutAddress();
    renderCart();
    $('#addressSelectorDialog').close();
  });
}

function openAddressEditor(address=null){
  if(!customer){
    afterAuthAction='address';
    openAuth();
    return;
  }
  $('#addressSelectorDialog').close();
  $('#addressEditorTitle').textContent=address?'Editar endereço':'Novo endereço';
  $('#addressId').value=address?.id||'';
  $('#addressLabel').value=address?.label||'Casa';
  $('#addressZip').value=address?.zip||'';
  $('#addressStreet').value=address?.street||'';
  $('#addressNumber').value=address?.number||'';
  $('#addressNeighborhood').value=address?.neighborhood||'';
  $('#addressComplement').value=address?.complement||'';
  $('#addressCity').value=address?.city||'Ji-Paraná';
  $('#addressState').value=address?.state||'RO';
  $('#addressReference').value=address?.reference||'';
  $('#addressRecipient').value=address?.recipient||customerProfile?.name||customer.displayName||'';
  $('#addressPhone').value=address?.phone||customerProfile?.phone||'';
  $('#addressDefault').checked=!addresses.length||address?.id===customerProfile?.defaultAddressId;
  $('#addressEditorError').classList.add('hidden');
  $('#addressEditorDialog').showModal();
}

async function fillAddressFromCep(inputId,prefix){
  const input=$(inputId);
  if(!input) return;
  const cep=String(input.value||'').replace(/\D/g,'');
  if(cep.length!==8) return;

  try{
    const response=await fetch('https://viacep.com.br/ws/'+cep+'/json/');
    if(!response.ok) return;
    const data=await response.json();
    if(data.erro) return;

    const map={
      street:data.logradouro||'',
      neighborhood:data.bairro||'',
      city:data.localidade||'',
      state:data.uf||''
    };

    if(prefix==='public'){
      if(map.street) $('#addressStreet').value=map.street;
      if(map.neighborhood) $('#addressNeighborhood').value=map.neighborhood;
      if(map.city) $('#addressCity').value=map.city;
      if(map.state) $('#addressState').value=map.state;
      $('#addressNumber').focus();
    }
  }catch(err){
    console.warn('CEP não encontrado.',err);
  }
}

$('#addressZip').addEventListener('blur',()=>fillAddressFromCep('#addressZip','public'));

$('#addressZip')?.addEventListener('blur',async()=>{
  const input=$('#addressZip');
  const digits=input.value.replace(/\D/g,'');
  if(digits.length!==8) return;
  try{
    const data=await lookupBrazilianZip(digits);
    if(!data) return;
    input.value=data.zip;
    if(data.street) $('#addressStreet').value=data.street;
    if(data.neighborhood) $('#addressNeighborhood').value=data.neighborhood;
    if(data.city) $('#addressCity').value=data.city;
    if(data.state) $('#addressState').value=data.state;
    $('#addressNumber').focus();
  }catch(err){
    console.warn('Consulta de CEP indisponível.',err);
  }
});

$('#addressEditorForm').onsubmit=async e=>{
  e.preventDefault();
  if(!customer) return;

  const phone=$('#addressPhone').value.trim();
  const cep=$('#addressZip').value.replace(/\D/g,'');
  if(!validPhone(phone)){
    $('#addressEditorError').textContent='Informe um telefone válido com DDD.';
    $('#addressEditorError').classList.remove('hidden');
    $('#addressPhone').focus();
    return;
  }
  if(cep&&cep.length!==8){
    $('#addressEditorError').textContent='Informe um CEP válido no formato 00000-000.';
    $('#addressEditorError').classList.remove('hidden');
    $('#addressZip').focus();
    return;
  }

  try{
    const id=await saveAddress(customer.uid,{
      label:$('#addressLabel').value,zip:$('#addressZip').value,street:$('#addressStreet').value,
      number:$('#addressNumber').value,neighborhood:$('#addressNeighborhood').value,
      complement:$('#addressComplement').value,city:$('#addressCity').value,state:$('#addressState').value,
      reference:$('#addressReference').value,recipient:$('#addressRecipient').value,phone:$('#addressPhone').value
    },$('#addressId').value||null);
    if($('#addressDefault').checked||!selectedAddressId){
      await setDefaultAddress(customer.uid,id);
      selectedAddressId=id;
      localStorage.setItem('deliverySelectedAddress',id);
    }
    addresses=await getAddresses(customer.uid);
    customerProfile=await getCustomerProfile(customer.uid);
    chooseInitialAddress();
    renderCustomerHeader();
    renderAddressSelector();
    renderCheckoutAddress();
    $('#addressEditorDialog').close();
    if(afterAuthAction==='checkout'){afterAuthAction=null;openCheckout();}
  }catch(err){
    console.error(err);
    $('#addressEditorError').textContent='Não foi possível salvar o endereço.';
    $('#addressEditorError').classList.remove('hidden');
  }
};

$('#searchInput').addEventListener('input',()=>{
  if(!$('#searchInput').value.trim()) selectedCategory='all';
  renderCategories();
  renderCatalog();
});
$('#desktopCartBtn').onclick=()=>$('#cartPanel').scrollIntoView({behavior:'smooth',block:'start'});
$('#mobileHomeBtn')?.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
$('#mobileSearchBtn')?.addEventListener('click',()=>{
  $('#searchInput').scrollIntoView({behavior:'smooth',block:'center'});
  setTimeout(()=>$('#searchInput').focus(),350);
});
$('#mobileOrdersBtn')?.addEventListener('click',()=>{
  if(customer) location.href='./account/#orders';
  else openAuth();
});
$('#mobileAccountBtn')?.addEventListener('click',()=>{
  if(customer) location.href='./account/';
  else openAuth();
});
$('#mobileCartBtn')?.addEventListener('click',()=>{
  $('#cartPanel').classList.add('open');
  $('#cartPanel').scrollIntoView({behavior:'smooth',block:'start'});
});
$('#floatingCart').onclick=()=>$('#cartPanel').classList.toggle('open');
$('#checkoutBtn').onclick=async()=>{
  if(!cart.length) return;
  if(!isOpen()){
    alert('A pizzaria está fechada para novos pedidos neste momento. No painel administrativo, use Dados da Pizzaria → Modo de funcionamento → Forçar aberto para realizar testes fora do horário.');
    return;
  }
  if(!customer){
    afterAuthAction='checkout';
    openAuth();
    return;
  }
  await openCheckout();
};

async function openCheckout(){
  if(!customer){
    afterAuthAction='checkout';
    openAuth();
    return;
  }
  if(!cart.length) return;

  if(!customerProfile?.identityComplete||!validFullName(customerProfile?.name||customer.displayName||'')){
    localStorage.setItem('deliveryReturnToCheckout','1');
    alert('Antes de fazer o primeiro pedido, complete seu nome, telefone e CPF em Minha Conta.');
    location.href='./account/#profile';
    return;
  }

  try{
    if(fulfillment()==='delivery'){
      const address=activeAddress();
      if(address){
        await ensureDeliveryAddressCoordinates(address);
      }
    }
    renderCheckoutAddress();
    $('#checkoutPhone').value=customerProfile?.phone||activeAddress()?.phone||'';
    renderPaymentOptions();
    renderCouponState();
    renderCart();
    $('#checkoutError').classList.add('hidden');
    $('#checkoutDialog').showModal();
    if(pendingCouponCode&&!activeCoupon){
      $('#couponCodeInput').value=pendingCouponCode;
      pendingCouponCode='';
      applyCoupon();
    }
  }catch(err){
    console.error('Falha ao abrir checkout:',err);
    alert('Não foi possível abrir a finalização do pedido. Atualize a página e tente novamente.');
  }
}

function renderCheckoutAddress(){
  const delivery=fulfillment()==='delivery';
  $('#checkoutAddressCard').classList.toggle('hidden',!delivery);
  $('#changeCheckoutAddressBtn').classList.toggle('hidden',!delivery);
  if(delivery){
    const a=activeAddress();
    if(a){
      const quote=deliveryQuote(a);
      const detail=[a.complement,a.reference].filter(Boolean).join(' • ');
      const feeText=deliveryQuoteText(quote);
      $('#checkoutAddressCard').innerHTML=`<strong>${esc(a.label||'Endereço')}</strong><span>${esc(a.street)}, ${esc(a.number)} • ${esc(a.neighborhood)}</span><small>${esc(detail)}</small><small class="${quote.supported||quote.pending?'':'danger-text'}">${esc(feeText)}</small>`;
    }else{
      $('#checkoutAddressCard').innerHTML='<span>Nenhum endereço selecionado.</span>';
    }
  }
  $('#pickupOption').classList.toggle('hidden',settings?.allowPickup===false);
}
$('#changeCheckoutAddressBtn').onclick=()=>openAddressSelector();
$$('input[name=fulfillment]').forEach(r=>r.onchange=()=>{renderCheckoutAddress();renderCart();});

function paymentIcon(label){
  const l=label.toLowerCase();
  if(l.includes('dinheiro')) return '💵';
  if(l.includes('pix')) return '◆';
  if(l.includes('crédito')||l.includes('credito')) return '💳';
  if(l.includes('débito')||l.includes('debito')) return '💳';
  return '💰';
}
function renderPaymentOptions(){
  const list=settings?.payments?.length?settings.payments:defaultSettings.payments;
  if(selectedPayment&&!list.includes(selectedPayment)) selectedPayment='';
  $('#paymentOptions').innerHTML=list.map(x=>`<label class="payment-choice ${selectedPayment===x?'active':''}"><input type="radio" name="payment" value="${attr(x)}" ${selectedPayment===x?'checked':''}><span class="payment-icon">${paymentIcon(x)}</span><span><strong>${esc(x)}</strong><small>Pagar no recebimento</small></span></label>`).join('');
  $$('input[name=payment]').forEach(r=>r.onchange=()=>{
    selectedPayment=r.value;
    renderPaymentOptions();
    const cash=selectedPayment.toLowerCase().includes('dinheiro');
    $('#cashChangeBlock').classList.toggle('hidden',!cash);
    if(!cash){$('#needsChange').checked=false;$('#changeFor').value='';}
    updateChangePreview();
  });
  const cash=selectedPayment.toLowerCase().includes('dinheiro');
  $('#cashChangeBlock').classList.toggle('hidden',!cash);
}
$('#needsChange').onchange=()=>{
  $('#changeField').classList.toggle('hidden',!$('#needsChange').checked);
  if(!$('#needsChange').checked) $('#changeFor').value='';
  updateChangePreview();
};
$('#changeFor').oninput=updateChangePreview;
function updateChangePreview(){
  if(!$('#needsChange')?.checked) return $('#changePreview')?.classList.add('hidden');
  const value=parseCurrency($('#changeFor').value);
  const total=cartTotals().total;
  if(!value){
    $('#changePreview').classList.add('hidden');
    return;
  }
  const diff=value-total;
  $('#changePreview').classList.remove('hidden');
  $('#changePreview').textContent=diff>=0?`Troco estimado: ${money(diff)}`:'O valor para troco é menor que o total do pedido.';
  $('#changePreview').classList.toggle('invalid',diff<0);
}

function secureOrderErrorMessage(code,data={}){
  const map={
    store_closed:'A pizzaria está fechada para novos pedidos.',
    invalid_items:'Revise os itens do carrinho.',
    product_unavailable:'Um dos produtos não está mais disponível.',
    invalid_size:'Um dos tamanhos escolhidos não está mais disponível.',
    half_half_not_allowed:'A combinação meio a meio escolhida não está mais disponível.',
    invalid_second_flavor:'O segundo sabor escolhido não está mais disponível.',
    second_flavor_size_unavailable:'O segundo sabor não está disponível nesse tamanho.',
    invalid_extra:'Um adicional escolhido não está mais disponível.',
    minimum_order:'O pedido não atingiu o valor mínimo.',
    coupon_not_found:'Cupom não encontrado.',
    coupon_inactive:'Esse cupom não está ativo.',
    coupon_minimum_order:'O pedido não atingiu o mínimo exigido pelo cupom.',
    coupon_not_eligible:'Sua conta ainda não atende às regras desse cupom.',
    address_required:'Selecione um endereço de entrega.',
    address_not_found:'O endereço selecionado não foi encontrado.',
    delivery_not_supported:'Esse endereço está fora da área de entrega.',
    invalid_payment:'Escolha uma forma de pagamento válida.',
    invalid_change:'O valor informado para troco é menor que o total.',
    phone_required:'Informe um telefone de contato.',
    invalid_phone:'Informe um telefone válido com DDD.',
    profile_incomplete:'Complete seu cadastro com nome, telefone e CPF antes de pedir.',
    full_name_required:'Informe seu nome completo, com nome e sobrenome.'
  };
  return map[code]||data?.message||'Não foi possível validar o pedido no servidor.';
}

async function createOrderSecurely({type,address,profilePhone,changeFor}){
  const token=await customer.getIdToken();
  const payload={
    fulfillment:type,
    addressId:type==='delivery'?address?.id||'':null,
    phone:profilePhone,
    note:$('#orderNote').value.trim(),
    couponCode:activeCoupon?.code||activeCoupon?.id||'',
    payment:{
      method:selectedPayment,
      needsChange:selectedPayment.toLowerCase().includes('dinheiro')&&$('#needsChange').checked,
      changeFor
    },
    items:cart.map(item=>({
      productId:item.productId,
      flavorProductIds:item.flavorProductIds||[item.productId],
      sizeName:item.size?.name||'',
      extras:(item.extras||[]).map(x=>x.name),
      qty:Number(item.qty||1),
      note:item.note||''
    }))
  };

  let response;
  try{
    response=await fetch(SECURE_ORDER_ENDPOINT,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':'Bearer '+token
      },
      body:JSON.stringify(payload)
    });
  }catch(err){
    console.error('Não foi possível acessar a validação segura do pedido.',err);
    const secureError=new Error('O servidor seguro de pedidos está indisponível. Tente novamente em instantes.');
    secureError.code='secure-order-unavailable';
    throw secureError;
  }

  if(response.status===404){
    const secureError=new Error('O serviço seguro de pedidos ainda não está disponível. O pedido não foi enviado.');
    secureError.code='secure-order-not-deployed';
    throw secureError;
  }

  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const err=new Error(secureOrderErrorMessage(data.error,data));
    err.code=data.error||'secure-order-failed';
    throw err;
  }
  return data;
}

$('#checkoutForm').addEventListener('submit',async e=>{
  e.preventDefault();
  $('#checkoutError').classList.add('hidden');
  if(!customer) return;
  if(!cart.length) return;
  if(!isOpen()) return showCheckoutError('A pizzaria fechou para novos pedidos.');

  const type=fulfillment();
  let address=activeAddress();
  if(type==='delivery'&&!address) return showCheckoutError('Selecione um endereço de entrega.');
  let quote=deliveryQuote(address);
  if(type==='delivery'&&quote.pending&&address){
    address=await ensureDeliveryAddressCoordinates(address);
    quote=deliveryQuote(address);
  }
  if(type==='delivery'&&quote.pending) return showCheckoutError('Não foi possível calcular a distância pelo CEP deste endereço. Confira o CEP ou escolha outro endereço.');
  if(type==='delivery'&&!quote.supported) return showCheckoutError('Este endereço está fora da área de entrega da pizzaria.');
  if(!selectedPayment) return showCheckoutError('Escolha a forma de pagamento.');

  const {subtotal,discount,fee,total}=cartTotals();
  if(activeCoupon){
    const couponCheck=couponValidation(activeCoupon,subtotal);
    if(!couponCheck.valid) return showCheckoutError(couponCheck.message);
  }
  if(subtotal<Number(settings.minimumOrder||0)) return showCheckoutError(`Pedido mínimo: ${money(settings.minimumOrder)}.`);

  let changeFor=0,changeAmount=0;
  if(selectedPayment.toLowerCase().includes('dinheiro')&&$('#needsChange').checked){
    changeFor=parseCurrency($('#changeFor').value);
    if(changeFor<total) return showCheckoutError('O valor informado para troco precisa ser igual ou maior que o total.');
    changeAmount=changeFor-total;
  }

  const btn=$('#sendOrderBtn');
  btn.disabled=true;btn.textContent='Enviando pedido...';
  try{
    let autoAccepted=settings.autoAcceptOrders===true;
    const profileName=customerProfile?.name||customer.displayName||'Cliente';
    const profilePhone=$('#checkoutPhone').value.trim();

    if(!profilePhone){
      return showCheckoutError('Informe um telefone de contato.');
    }

    if(profilePhone!==customerProfile?.phone){
      await saveCustomerProfile(customer.uid,{name:profileName,phone:profilePhone});
      customerProfile={...customerProfile,name:profileName,phone:profilePhone};
    }

    let orderNumber=0;
    let serverResult=null;

    try{
      serverResult=await createOrderSecurely({type,address,profilePhone,changeFor});
    }catch(serverError){
      console.error('Pedido rejeitado ou serviço seguro indisponível:',serverError);
      return showCheckoutError(serverError.message||'Não foi possível validar o pedido.');
    }

    orderNumber=Number(serverResult?.orderNumber||0);
    autoAccepted=serverResult?.status==='accepted';

    if(!orderNumber){
      throw new Error('Resposta inválida do servidor seguro de pedidos.');
    }

    cart=[];saveCart();
    $('#checkoutDialog').close();
    $('#successOrderNumber').textContent='#'+String(orderNumber).padStart(4,'0');
    $('#successStatusText').textContent=autoAccepted?'Pedido confirmado automaticamente e enviado para a pizzaria.':'Pedido recebido. Aguarde a confirmação da pizzaria.';
    $('#successDialog').showModal();
    selectedPayment='';
    activeCoupon=null;
    $('#couponCodeInput').value='';
    renderCouponState('');
    $('#orderNote').value='';
    $('#needsChange').checked=false;
    $('#changeFor').value='';
  }catch(err){
    console.error(err);
    showCheckoutError('Não foi possível enviar o pedido. Atualize a página e tente novamente.');
  }finally{
    btn.disabled=false;btn.textContent='Enviar pedido';
  }
});
function showCheckoutError(message){
  $('#checkoutError').textContent=message;
  $('#checkoutError').classList.remove('hidden');
}
$('#successClose').onclick=()=>$('#successDialog').close();

function bindFormattedInput(selector,formatter){
  const input=$(selector);
  if(!input) return;
  const apply=()=>{input.value=formatter(input.value);};
  input.addEventListener('input',apply);
  input.addEventListener('blur',apply);
}

function formatCepInput(value){
  const d=String(value||'').replace(/\D/g,'').slice(0,8);
  return d.length>5?d.slice(0,5)+'-'+d.slice(5):d;
}

bindFormattedInput('#registerPhone',formatPhone);
bindFormattedInput('#registerCpf',formatCpf);
bindFormattedInput('#addressPhone',formatPhone);
bindFormattedInput('#checkoutPhone',formatPhone);
bindFormattedInput('#addressZip',formatCepInput);

function isStandalonePwa(){
  return window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
}

function isIosDevice(){
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
}

function updateInstallButton(){
  const button=$('#installAppBtn');
  if(!button) return;
  const canOffer=!isStandalonePwa()&&(!!deferredInstallPrompt||isIosDevice());
  button.classList.toggle('hidden',!canOffer);
  button.textContent=isIosDevice()&&!deferredInstallPrompt?'▣ Adicionar à Tela de Início':'▣ Instalar aplicativo';
}

window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();
  deferredInstallPrompt=event;
  updateInstallButton();
});

window.addEventListener('appinstalled',()=>{
  deferredInstallPrompt=null;
  updateInstallButton();
});

$('#installAppBtn')?.addEventListener('click',async()=>{
  if(isStandalonePwa()) return;
  if(deferredInstallPrompt){
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(()=>null);
    deferredInstallPrompt=null;
    updateInstallButton();
    return;
  }
  if(isIosDevice()) $('#iosInstallDialog').showModal();
});

updateInstallButton();

function installDialogDismissal(){
  $$('dialog').forEach(dialog=>{
    dialog.querySelectorAll('.dialog-close').forEach(btn=>{
      btn.addEventListener('click',()=>{if(dialog.open) dialog.close();});
    });
    dialog.addEventListener('cancel',e=>{
      e.preventDefault();
      if(dialog.open) dialog.close();
    });
    dialog.addEventListener('click',e=>{
      if(e.target===dialog&&dialog.open) dialog.close();
    });
  });
}
installDialogDismissal();

loadStore().then(async()=>{
  await authPersistenceReady;
  const params=new URLSearchParams(location.search);
  if(params.get('login')==='1'){
    if(auth.currentUser) clearLoginQuery();
    else openAuth();
  }
  if(params.get('checkout')==='1'&&auth.currentUser){
    const url=new URL(location.href);
    url.searchParams.delete('checkout');
    history.replaceState(null,'',url.pathname+(url.search?url.search:'')+url.hash);
    let tries=0;
    const resume=()=>{
      if(customer&&customerProfile?.identityComplete){
        openCheckout();
        return;
      }
      if(++tries<12) setTimeout(resume,150);
    };
    resume();
  }
});
setInterval(()=>{
  if(settings){
    const before=$('#storeStatus').textContent;
    renderStore();
    if(before!==$('#storeStatus').textContent) renderCart();
  }
},60000);
