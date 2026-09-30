import { db, watchCustomer } from '../assets/customer-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0));

function fmt(ts){
  try{return ts?.toDate?.().toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})||'—';}
  catch{return '—';}
}

function imagePath(value){
  if(!value) return '../assets/app-icon.svg';
  if(/^https?:\/\//i.test(value)) return value;
  return '../'+String(value).replace(/^\.?\//,'').replace(/^\//,'');
}

function addressText(a={}){
  return [
    [a.street,a.number].filter(Boolean).join(', '),
    a.complement,
    a.neighborhood,
    [a.city,a.state].filter(Boolean).join('/')
  ].filter(Boolean).join(' • ');
}

function render(order,settings){
  const store=settings.storeName||'Pizzaria';
  document.title='Comprovante #'+String(order.orderNumber||0).padStart(4,'0')+' • '+store;
  const items=(order.items||[]).map(item=>`
    <div class="receipt-item">
      <div><strong>${Number(item.qty||1)}× ${esc(item.name||'Item')}</strong>
      ${item.size?.name?'<small>Tamanho: '+esc(item.size.name)+'</small>':''}
      ${item.extras?.length?'<small>Adicionais: '+item.extras.map(x=>esc(x.name)).join(', ')+'</small>':''}
      ${item.note?'<small>Observação: '+esc(item.note)+'</small>':''}</div>
      <strong>${money(Number(item.unitPrice||0)*Number(item.qty||1))}</strong>
    </div>`).join('');

  $('#customerReceipt').innerHTML=`
    <header class="receipt-header">
      <img class="receipt-logo" src="${esc(imagePath(settings.storeLogo))}" alt="">
      <div><span class="eyebrow">COMPROVANTE DO PEDIDO</span><h1>${esc(store)}</h1>
      <p class="muted">${esc(settings.phone||'')}</p></div>
    </header>
    <div class="receipt-order-number">Pedido #${String(order.orderNumber||0).padStart(4,'0')}</div>
    <div class="receipt-meta-grid">
      <div><small>Pedido realizado</small><strong>${fmt(order.createdAt)}</strong></div>
      <div><small>Concluído / entregue</small><strong>${fmt(order.completedAt)}</strong></div>
      <div><small>Modalidade</small><strong>${order.fulfillment==='pickup'?'Retirada no local':'Entrega'}</strong></div>
      <div><small>Status</small><strong>${esc(order.status||'')}</strong></div>
    </div>
    ${order.fulfillment==='delivery'?'<section class="receipt-section"><h2>Endereço de entrega</h2><p>'+esc(addressText(order.address))+'</p></section>':''}
    <section class="receipt-section"><h2>Itens</h2>${items}</section>
    <section class="receipt-totals">
      <div><span>Subtotal</span><strong>${money(order.subtotal)}</strong></div>
      ${Number(order.discount||0)>0?'<div><span>Desconto'+(order.coupon?.code?' • '+esc(order.coupon.code):'')+'</span><strong>- '+money(order.discount)+'</strong></div>':''}
      <div><span>Entrega</span><strong>${money(order.deliveryFee)}</strong></div>
      <div class="receipt-total"><span>Total</span><strong>${money(order.total)}</strong></div>
    </section>
    <section class="receipt-section"><h2>Pagamento</h2><p>${esc(order.payment?.method||'Não informado')}</p></section>
    ${order.note?'<section class="receipt-section"><h2>Observações</h2><p>'+esc(order.note)+'</p></section>':''}
    <footer class="receipt-footer"><small>Comprovante referente ao pedido registrado no sistema da pizzaria. Não é documento fiscal.</small></footer>
  `;
}

$('#printReceiptBtn').onclick=()=>window.print();

watchCustomer(async user=>{
  if(!user){
    location.href='../?login=1';
    return;
  }
  const id=new URLSearchParams(location.search).get('id');
  if(!id){
    $('#customerReceipt').innerHTML='<div class="alert alert-error">Pedido não informado.</div>';
    return;
  }
  try{
    const [orderSnap,privateSnap,settingsSnap]=await Promise.all([
      getDoc(doc(db,'orders',id)),
      getDoc(doc(db,'orderPrivate',id)),
      getDoc(doc(db,'settings','store'))
    ]);
    if(!orderSnap.exists()){
      $('#customerReceipt').innerHTML='<div class="alert alert-error">Pedido não encontrado.</div>';
      return;
    }
    const privateData=privateSnap.exists()?privateSnap.data():{};
    render({
      id:orderSnap.id,
      ...orderSnap.data(),
      customer:privateData.customer||null,
      address:privateData.address||null
    },settingsSnap.exists()?settingsSnap.data():{});
  }catch(err){
    console.error(err);
    $('#customerReceipt').innerHTML='<div class="alert alert-error">Não foi possível carregar este comprovante.</div>';
  }
});