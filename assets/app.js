import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getFirestore, collection, doc, getDoc, getDocs, runTransaction, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from '../firebase-config.js';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const $ = s => document.querySelector(s);
const money = v => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0));
const placeholder = './assets/products/placeholder.svg';

let categories=[], products=[], settings=null;
let cart=JSON.parse(localStorage.getItem('deliveryCart')||'[]');
let selectedCategory='all', currentProduct=null, currentQty=1;

const defaultSettings={
  storeName:'Delivery Pizzaria',
  subtitle:'Pizza quentinha, do forno para sua casa.',
  deliveryFee:5,
  minimumOrder:0,
  allowPickup:true,
  openMode:'schedule',
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

function pathImage(v){
  if(!v) return placeholder;
  if(/^https?:\/\//i.test(v)) return v;
  if(v.startsWith('../')) return v.replace(/^\.\.\//,'./');
  if(v.startsWith('./')) return v;
  return './'+v.replace(/^\//,'');
}

async function load(){
  try{
    const [catSnap,prodSnap,setSnap]=await Promise.all([
      getDocs(collection(db,'categories')),
      getDocs(collection(db,'products')),
      getDoc(doc(db,'settings','store'))
    ]);
    categories=catSnap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.active!==false).sort((a,b)=>(a.order||0)-(b.order||0));
    products=prodSnap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.active!==false).sort((a,b)=>(a.order||0)-(b.order||0));
    settings=setSnap.exists()?{...defaultSettings,...setSnap.data()}:defaultSettings;
    renderAll();
  }catch(e){
    console.error(e);
    settings=defaultSettings;
    renderAll();
    $('#catalog').innerHTML='<div class="alert alert-error">Não foi possível carregar o cardápio. Verifique a configuração do Firebase/Firestore.</div>';
  }
}

function isOpen(){
  if(settings.openMode==='open') return true;
  if(settings.openMode==='closed') return false;
  const tz=settings.timezone||'America/Porto_Velho';
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());
  const wd=parts.find(p=>p.type==='weekday').value;
  const map={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
  const hour=parts.find(p=>p.type==='hour').value;
  const minute=parts.find(p=>p.type==='minute').value;
  const now=`${hour}:${minute}`;
  const day=settings.schedule?.[map[wd]]||settings.schedule?.[String(map[wd])];
  if(!day?.enabled) return false;
  if(day.close>=day.open) return now>=day.open&&now<=day.close;
  return now>=day.open||now<=day.close;
}

function renderAll(){
  document.title=`${settings.storeName} • Delivery`;
  $('#storeName').textContent=settings.storeName;
  $('#storeSubtitle').textContent=settings.subtitle||'';
  $('#footerStore').textContent=settings.storeName;
  const open=isOpen();
  $('#storeStatus').textContent=open?'● Aberto agora':'● Fechado agora';
  $('#storeStatus').style.background=open?'rgba(21,128,61,.28)':'rgba(17,24,39,.28)';
  renderCategories(); renderCatalog(); renderCart(); renderPayment();
}

function renderCategories(){
  const items=[{id:'all',name:'Todos'},...categories];
  $('#categoryChips').innerHTML=items.map(c=>`<button class="chip ${selectedCategory===c.id?'active':''}" data-id="${c.id}">${escapeHtml(c.name)}</button>`).join('');
  document.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{selectedCategory=b.dataset.id;renderCategories();renderCatalog();});
}

function renderCatalog(){
  const term=$('#searchInput').value.trim().toLowerCase();
  const list=products.filter(p=>(selectedCategory==='all'||p.categoryId===selectedCategory)&&(!term||`${p.name} ${p.description||''}`.toLowerCase().includes(term)));
  $('#catalogEmpty').classList.toggle('hidden',list.length>0);
  $('#catalog').innerHTML=list.map(p=>{
    const from=p.sizes?.length?Math.min(...p.sizes.map(s=>Number(s.price||0))):Number(p.price||0);
    return `<article class="product-card"><img class="product-image" src="${escapeAttr(pathImage(p.image))}" onerror="this.src='${placeholder}'" alt="${escapeAttr(p.name)}"><div class="product-content"><div>${p.featured?'<span class="eyebrow">DESTAQUE</span>':''}<h3>${escapeHtml(p.name)}</h3></div><p>${escapeHtml(p.description||'')}</p><div class="product-foot"><span class="price">${p.sizes?.length?'A partir de ':''}${money(from)}</span><button class="btn btn-primary add-product" data-id="${p.id}">Adicionar</button></div></div></article>`;
  }).join('');
  document.querySelectorAll('.add-product').forEach(b=>b.onclick=()=>openProduct(b.dataset.id));
}

function openProduct(id){
  currentProduct=products.find(p=>p.id===id);
  if(!currentProduct) return;
  currentQty=1;
  $('#modalName').textContent=currentProduct.name;
  $('#modalDescription').textContent=currentProduct.description||'';
  $('#modalImage').src=pathImage(currentProduct.image);
  $('#itemNote').value='';
  renderOptionGroups(); updateModalPrice(); $('#productDialog').showModal();
}

function renderOptionGroups(){
  const sizes=currentProduct.sizes||[];
  $('#sizeOptions').innerHTML=sizes.length?`<div class="option-group"><h3>Escolha o tamanho</h3><div class="option-list">${sizes.map((s,i)=>`<label class="option-choice"><span><input type="radio" name="size" value="${i}" ${i===0?'checked':''}> ${escapeHtml(s.name)}</span><strong>${money(s.price)}</strong></label>`).join('')}</div></div>`:'';
  const extras=currentProduct.extras||[];
  $('#extraOptions').innerHTML=extras.length?`<div class="option-group"><h3>Adicionais</h3><div class="option-list">${extras.map((x,i)=>`<label class="option-choice"><span><input type="checkbox" name="extra" value="${i}"> ${escapeHtml(x.name)}</span><strong>+ ${money(x.price)}</strong></label>`).join('')}</div></div>`:'';
  document.querySelectorAll('input[name=size],input[name=extra]').forEach(i=>i.onchange=updateModalPrice);
}

function chosenUnitPrice(){
  let price=Number(currentProduct.price||0);
  const sizes=currentProduct.sizes||[];
  if(sizes.length){
    const idx=Number(document.querySelector('input[name=size]:checked')?.value||0);
    price=Number(sizes[idx]?.price||0);
  }
  document.querySelectorAll('input[name=extra]:checked').forEach(el=>price+=Number(currentProduct.extras?.[Number(el.value)]?.price||0));
  return price;
}

function updateModalPrice(){
  $('#qtyValue').textContent=currentQty;
  $('#modalPrice').textContent=money(chosenUnitPrice()*currentQty);
}

$('#qtyMinus').onclick=()=>{currentQty=Math.max(1,currentQty-1);updateModalPrice();};
$('#qtyPlus').onclick=()=>{currentQty++;updateModalPrice();};

$('#productForm').addEventListener('submit',e=>{
  e.preventDefault();
  if(!currentProduct) return;
  const sizes=currentProduct.sizes||[];
  const sizeIdx=sizes.length?Number(document.querySelector('input[name=size]:checked')?.value||0):-1;
  const extras=[...document.querySelectorAll('input[name=extra]:checked')].map(el=>currentProduct.extras[Number(el.value)]);
  cart.push({
    lineId:crypto.randomUUID(),
    productId:currentProduct.id,
    name:currentProduct.name,
    image:currentProduct.image||'',
    size:sizeIdx>=0?sizes[sizeIdx]:null,
    extras,
    unitPrice:chosenUnitPrice(),
    qty:currentQty,
    note:$('#itemNote').value.trim()
  });
  saveCart(); $('#productDialog').close();
});

function saveCart(){
  localStorage.setItem('deliveryCart',JSON.stringify(cart));
  renderCart();
}

function renderCart(){
  const count=cart.reduce((a,x)=>a+x.qty,0);
  $('#cartCount').textContent=count;
  $('#floatingCount').textContent=count;
  const subtotal=cart.reduce((a,x)=>a+x.unitPrice*x.qty,0);
  const fulfillment=document.querySelector('input[name=fulfillment]:checked')?.value||'delivery';
  const fee=subtotal&&fulfillment==='delivery'?Number(settings?.deliveryFee||0):0;
  const total=subtotal+fee;
  $('#subtotal').textContent=money(subtotal);
  $('#deliveryFee').textContent=money(fee);
  $('#total').textContent=money(total);
  $('#checkoutTotal').textContent=money(total);
  $('#checkoutBtn').disabled=!count||!isOpen();
  $('#cartItems').innerHTML=cart.length?cart.map(x=>`<div class="cart-item"><div class="cart-item-top"><div><strong>${x.qty}× ${escapeHtml(x.name)}</strong><br><small>${[x.size?.name,...(x.extras||[]).map(e=>e.name)].filter(Boolean).map(escapeHtml).join(' • ')}</small></div><strong>${money(x.unitPrice*x.qty)}</strong></div><div class="mini-actions"><button data-act="minus" data-id="${x.lineId}">−</button><span>${x.qty}</span><button data-act="plus" data-id="${x.lineId}">+</button><button data-act="remove" data-id="${x.lineId}" title="Remover">×</button></div></div>`).join(''):'<p class="muted">Seu carrinho está vazio.</p>';
  document.querySelectorAll('.mini-actions button').forEach(b=>b.onclick=()=>{
    const x=cart.find(i=>i.lineId===b.dataset.id);
    if(!x) return;
    if(b.dataset.act==='plus') x.qty++;
    if(b.dataset.act==='minus') x.qty=Math.max(1,x.qty-1);
    if(b.dataset.act==='remove') cart=cart.filter(i=>i.lineId!==x.lineId);
    saveCart();
  });
}

function renderPayment(){
  const list=settings?.payments?.length?settings.payments:defaultSettings.payments;
  $('#paymentMethod').innerHTML='<option value="">Selecione...</option>'+list.map(x=>`<option>${escapeHtml(x)}</option>`).join('');
  document.querySelector('#fulfillmentControl label:last-child').classList.toggle('hidden',settings?.allowPickup===false);
}

$('#searchInput').addEventListener('input',renderCatalog);
$('#checkoutBtn').onclick=()=>{
  if(!isOpen()) return alert('A pizzaria está fechada no momento.');
  $('#checkoutDialog').showModal();
};
$('#floatingCart').onclick=()=>$('#cartPanel').classList.toggle('open');

document.querySelectorAll('input[name=fulfillment]').forEach(r=>r.onchange=()=>{
  const delivery=document.querySelector('input[name=fulfillment]:checked').value==='delivery';
  $('#addressFields').classList.toggle('hidden',!delivery);
  renderCart();
});

$('#paymentMethod').onchange=()=>$('#changeField').classList.toggle('hidden',!$('#paymentMethod').value.toLowerCase().includes('dinheiro'));

$('#checkoutForm').addEventListener('submit',async e=>{
  e.preventDefault();
  $('#checkoutError').classList.add('hidden');
  if(!cart.length) return;
  if(!isOpen()) return showCheckoutError('A pizzaria fechou para novos pedidos.');

  const fulfillment=document.querySelector('input[name=fulfillment]:checked').value;
  const required=[['Nome',$('#customerName').value],['Telefone',$('#customerPhone').value],['Forma de pagamento',$('#paymentMethod').value]];
  if(fulfillment==='delivery') required.push(['Endereço',$('#customerAddress').value],['Número',$('#customerNumber').value],['Bairro',$('#customerNeighborhood').value]);
  const missing=required.find(x=>!x[1].trim());
  if(missing) return showCheckoutError(`Preencha: ${missing[0]}.`);

  const subtotal=cart.reduce((a,x)=>a+x.unitPrice*x.qty,0);
  if(subtotal<Number(settings.minimumOrder||0)) return showCheckoutError(`Pedido mínimo: ${money(settings.minimumOrder)}.`);
  const fee=fulfillment==='delivery'?Number(settings.deliveryFee||0):0;
  const btn=$('#sendOrderBtn');
  btn.disabled=true; btn.textContent='Enviando...';

  try{
    let orderNumber=0;
    await runTransaction(db,async tx=>{
      const ref=doc(db,'counters','orders');
      const snap=await tx.get(ref);
      orderNumber=(snap.exists()?Number(snap.data().value||0):0)+1;
      tx.set(ref,{value:orderNumber,updatedAt:serverTimestamp()},{merge:true});
    });

    const payload={
      orderNumber,
      status:'pending',
      createdAt:serverTimestamp(),
      customer:{
        name:$('#customerName').value.trim(),
        phone:$('#customerPhone').value.trim(),
        address:fulfillment==='delivery'?$('#customerAddress').value.trim():'',
        number:fulfillment==='delivery'?$('#customerNumber').value.trim():'',
        neighborhood:fulfillment==='delivery'?$('#customerNeighborhood').value.trim():'',
        complement:fulfillment==='delivery'?$('#customerComplement').value.trim():'',
        reference:fulfillment==='delivery'?$('#customerReference').value.trim():''
      },
      fulfillment,
      payment:{method:$('#paymentMethod').value,changeFor:$('#changeFor').value.trim()},
      note:$('#orderNote').value.trim(),
      items:cart.map(({lineId,image,...x})=>x),
      subtotal,
      deliveryFee:fee,
      total:subtotal+fee
    };

    await addDoc(collection(db,'orders'),payload);
    cart=[]; saveCart();
    $('#checkoutDialog').close();
    $('#successOrderNumber').textContent='#'+String(orderNumber).padStart(4,'0');
    $('#successDialog').showModal();
    $('#checkoutForm').reset();
    document.querySelector('input[name=fulfillment][value=delivery]').checked=true;
    $('#addressFields').classList.remove('hidden');
  }catch(err){
    console.error(err);
    showCheckoutError('Não foi possível enviar o pedido. Tente novamente.');
  }finally{
    btn.disabled=false; btn.textContent='Enviar pedido';
  }
});

function showCheckoutError(t){
  $('#checkoutError').textContent=t;
  $('#checkoutError').classList.remove('hidden');
}
$('#successClose').onclick=()=>$('#successDialog').close();

function escapeHtml(v){
  return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function escapeAttr(v){return escapeHtml(v);}

load();
setInterval(()=>{if(settings){const was=$('#storeStatus').textContent;renderAll();if(was!==$('#storeStatus').textContent)renderCart();}},60000);
