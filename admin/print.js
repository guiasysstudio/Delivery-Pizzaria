import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { firebaseConfig } from '../firebase-config.js';

const app=initializeApp(firebaseConfig);
const auth=getAuth(app);
const db=getFirestore(app);
const params=new URLSearchParams(location.search);
const id=params.get('id');
const auto=params.get('autoprint')==='1';
const root=document.querySelector('#printRoot');
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0));
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const statusLabels={
  pending:'Aguardando confirmação',
  accepted:'Confirmado',
  preparing:'Em preparo',
  ready:'Pronto',
  out_for_delivery:'Saiu para entrega',
  completed:'Concluído',
  cancelled:'Cancelado'
};

function addressText(o){
  if(o.fulfillment==='pickup') return 'RETIRADA NO LOCAL';
  const a=o.address||{};
  if(a.street){
    return (a.street||'')+', '+(a.number||'')+' - '+(a.neighborhood||'')+
      (a.complement?' / '+a.complement:'')+
      (a.reference?' / Ref.: '+a.reference:'')+
      (a.city?' / '+a.city+'/'+(a.state||''):'');
  }
  return (o.customer?.address||'')+', '+(o.customer?.number||'')+' - '+(o.customer?.neighborhood||'');
}

onAuthStateChanged(auth,async user=>{
  if(!user){
    root.innerHTML='<p>Faça login no painel administrativo para imprimir.</p>';
    return;
  }
  if(!id){
    root.innerHTML='<p>Pedido inválido.</p>';
    return;
  }

  try{
    const results=await Promise.all([
      getDoc(doc(db,'orders',id)),
      getDoc(doc(db,'settings','store'))
    ]);
    const oSnap=results[0],sSnap=results[1];

    if(!oSnap.exists()){
      root.innerHTML='<p>Pedido não encontrado.</p>';
      return;
    }

    const o=oSnap.data();
    const s=sSnap.exists()?sSnap.data():{};
    const change=o.payment?.needsChange
      ?'<p><strong>TROCO PARA:</strong> '+money(o.payment.changeFor)+'</p><p><strong>LEVAR DE TROCO:</strong> '+money(o.payment.changeAmount)+'</p>'
      :'';

    root.innerHTML=
      '<div class="center">'+
      '<h1>'+esc(s.storeName||'Pizzaria')+'</h1>'+
      '<p>'+esc(s.phone||'')+'</p>'+
      '<p class="big">PEDIDO #'+String(o.orderNumber||0).padStart(4,'0')+'</p>'+
      '<p>'+esc(statusLabels[o.status]||o.status)+'</p>'+
      '<p>'+(o.createdAt?.toDate?.().toLocaleString('pt-BR')||'')+'</p>'+
      '</div><hr>'+
      '<p><strong>CLIENTE:</strong> '+esc(o.customer?.name||'')+'</p>'+
      '<p><strong>FONE:</strong> '+esc(o.customer?.phone||'')+'</p>'+
      '<p><strong>'+(o.fulfillment==='pickup'?'TIPO':'ENDEREÇO')+':</strong> '+esc(addressText(o))+'</p>'+
      '<hr><h2>ITENS</h2>'+
      (o.items||[]).map(i=>
        '<div><div class="row"><strong>'+i.qty+'x '+esc(i.name)+'</strong><strong>'+money(Number(i.unitPrice)*Number(i.qty))+'</strong></div>'+
        (i.size?.name?'<p>Tamanho: '+esc(i.size.name)+'</p>':'')+
        ((i.extras||[]).length?'<p>Adicionais: '+(i.extras||[]).map(x=>esc(x.name)).join(', ')+'</p>':'')+
        (i.note?'<p>OBS ITEM: '+esc(i.note)+'</p>':'')+
        '</div><hr>'
      ).join('')+
      '<div class="row"><span>Subtotal</span><strong>'+money(o.subtotal)+'</strong></div>'+
      '<div class="row"><span>Entrega</span><strong>'+money(o.deliveryFee)+'</strong></div>'+
      '<div class="row big"><span>TOTAL</span><strong>'+money(o.total)+'</strong></div>'+
      '<hr><p><strong>PAGAMENTO:</strong> '+esc(o.payment?.method||'')+'</p>'+
      change+
      (o.note?'<hr><p><strong>OBSERVAÇÕES:</strong> '+esc(o.note)+'</p>':'')+
      '<hr><p class="center">*** FIM DA COMANDA ***</p>';

    if(auto) setTimeout(()=>window.print(),700);
  }catch(err){
    console.error(err);
    root.innerHTML='<p>Erro ao carregar comanda. Faça login no painel e tente novamente.</p>';
  }
});
