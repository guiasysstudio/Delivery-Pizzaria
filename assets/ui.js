const ICON_NAME_RE=/^[a-z0-9-]+$/;

export function iconHtml(name,extraClass=''){
  const safe=ICON_NAME_RE.test(String(name||''))?String(name):'info';
  const extra=String(extraClass||'').replace(/[^a-zA-Z0-9 _-]/g,'');
  return `<span class="ui-icon icon-${safe}${extra?' '+extra:''}" aria-hidden="true"></span>`;
}

function ensureToastRegion(){
  let region=document.getElementById('toastRegion');
  if(region) return region;
  region=document.createElement('div');
  region.id='toastRegion';
  region.className='toast-region';
  region.setAttribute('aria-live','polite');
  region.setAttribute('aria-atomic','false');
  document.body.appendChild(region);
  return region;
}

export function showToast(message,type='info',options={}){
  const region=ensureToastRegion();
  const normalized=['success','error','warning','info'].includes(type)?type:'info';
  const icons={success:'circle-check',error:'circle-x',warning:'info',info:'info'};
  const toast=document.createElement('div');
  toast.className=`toast toast-${normalized}`;
  toast.setAttribute('role',normalized==='error'?'alert':'status');
  toast.innerHTML=`
    ${iconHtml(icons[normalized],'toast-icon')}
    <div class="toast-copy"><strong>${normalized==='success'?'Concluído':normalized==='error'?'Atenção':normalized==='warning'?'Aviso':'Informação'}</strong><span></span></div>
    <button class="toast-close" type="button" aria-label="Fechar notificação">${iconHtml('circle-x')}</button>`;
  toast.querySelector('.toast-copy span').textContent=String(message||'');
  const close=()=>{
    toast.classList.add('toast-leave');
    setTimeout(()=>toast.remove(),180);
  };
  toast.querySelector('.toast-close').addEventListener('click',close);
  region.appendChild(toast);
  requestAnimationFrame(()=>toast.classList.add('toast-visible'));
  const duration=Number(options.duration??(normalized==='error'?6500:4200));
  if(duration>0) setTimeout(close,duration);
  return toast;
}

function ensureConfirmDialog(){
  let dialog=document.getElementById('globalConfirmDialog');
  if(dialog) return dialog;

  dialog=document.createElement('dialog');
  dialog.id='globalConfirmDialog';
  dialog.className='modal confirm-modal';
  dialog.setAttribute('aria-labelledby','globalConfirmTitle');
  dialog.setAttribute('aria-describedby','globalConfirmMessage');
  dialog.innerHTML=`
    <div class="modal-card confirm-card">
      <div class="confirm-icon-wrap">${iconHtml('info','confirm-icon')}</div>
      <h2 id="globalConfirmTitle">Confirmar ação</h2>
      <p id="globalConfirmMessage" class="confirm-message"></p>
      <div class="confirm-actions">
        <button id="globalConfirmCancel" class="btn btn-secondary" type="button">Cancelar</button>
        <button id="globalConfirmOk" class="btn btn-primary" type="button">Confirmar</button>
      </div>
    </div>`;
  document.body.appendChild(dialog);
  return dialog;
}

export function confirmAction(message,options={}){
  const dialog=ensureConfirmDialog();
  const title=dialog.querySelector('#globalConfirmTitle');
  const body=dialog.querySelector('#globalConfirmMessage');
  const ok=dialog.querySelector('#globalConfirmOk');
  const cancel=dialog.querySelector('#globalConfirmCancel');
  const icon=dialog.querySelector('.confirm-icon-wrap .ui-icon');

  title.textContent=options.title||'Confirmar ação';
  body.textContent=String(message||'');
  ok.textContent=options.confirmText||'Confirmar';
  cancel.textContent=options.cancelText||'Cancelar';
  ok.className=`btn ${options.danger?'btn-danger':'btn-primary'}`;
  icon.className=`ui-icon icon-${options.danger?'circle-x':'info'} confirm-icon`;

  return new Promise(resolve=>{
    let settled=false;
    const finish=value=>{
      if(settled) return;
      settled=true;
      cleanup();
      if(dialog.open) dialog.close();
      resolve(value);
    };
    const onCancel=()=>finish(false);
    const onOk=()=>finish(true);
    const onNativeCancel=e=>{e.preventDefault();finish(false);};
    const onBackdrop=e=>{if(e.target===dialog) finish(false);};
    const cleanup=()=>{
      cancel.removeEventListener('click',onCancel);
      ok.removeEventListener('click',onOk);
      dialog.removeEventListener('cancel',onNativeCancel);
      dialog.removeEventListener('click',onBackdrop);
    };
    cancel.addEventListener('click',onCancel);
    ok.addEventListener('click',onOk);
    dialog.addEventListener('cancel',onNativeCancel);
    dialog.addEventListener('click',onBackdrop);
    dialog.showModal();
    setTimeout(()=>cancel.focus(),30);
  });
}

export function emptyStateHtml({
  icon='package-open',
  title='Nada por aqui',
  description='',
  actionHtml=''
}={}){
  return `<div class="empty-state professional-empty">
    <div class="empty-icon">${iconHtml(icon)}</div>
    <strong>${String(title||'')}</strong>
    ${description?`<p>${String(description)}</p>`:''}
    ${actionHtml?`<div class="empty-action">${actionHtml}</div>`:''}
  </div>`;
}

export function skeletonListHtml(count=4){
  return Array.from({length:Math.max(1,Number(count)||1)},()=>`
    <div class="skeleton-row" aria-hidden="true">
      <span class="skeleton skeleton-square"></span>
      <span class="skeleton-stack"><span class="skeleton skeleton-line skeleton-line-lg"></span><span class="skeleton skeleton-line"></span></span>
      <span class="skeleton skeleton-pill"></span>
    </div>`).join('');
}

export function applyBrandTheme(value){
  const color=/^#[0-9a-f]{6}$/i.test(String(value||''))?String(value):'#b91c1c';
  const rgb=[
    parseInt(color.slice(1,3),16),
    parseInt(color.slice(3,5),16),
    parseInt(color.slice(5,7),16)
  ];
  const luminance=(0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2])/255;
  const adjust=amount=>'#'+rgb.map(channel=>Math.max(0,Math.min(255,channel+amount)).toString(16).padStart(2,'0')).join('');
  const secondary=adjust(luminance>.55?-26:28);
  const contrast=luminance>.58?'#111827':'#ffffff';
  const root=document.documentElement;
  root.style.setProperty('--primary',color);
  root.style.setProperty('--primary2',secondary);
  root.style.setProperty('--primary-soft',`rgba(${rgb[0]},${rgb[1]},${rgb[2]},.12)`);
  root.style.setProperty('--primary-contrast',contrast);
  root.style.setProperty('--brand-rgb',rgb.join(','));
  const themeMeta=document.querySelector('meta[name="theme-color"]');
  if(themeMeta&&!document.body?.classList.contains('admin-body')) themeMeta.setAttribute('content',color);
  return color;
}

export function enhanceAccessibility(root=document){
  root.querySelectorAll('dialog').forEach((dialog,index)=>{
    if(!dialog.hasAttribute('aria-labelledby')&&!dialog.hasAttribute('aria-label')){
      const heading=dialog.querySelector('h1,h2,h3,[data-dialog-title]');
      if(heading){
        if(!heading.id) heading.id=`dialog-title-${index+1}`;
        dialog.setAttribute('aria-labelledby',heading.id);
      }else{
        dialog.setAttribute('aria-label','Janela de diálogo');
      }
    }
    dialog.setAttribute('aria-modal','true');
  });

  root.querySelectorAll('.alert,.saved-note,[data-live-status]').forEach(element=>{
    if(!element.hasAttribute('aria-live')) element.setAttribute('aria-live','polite');
    if(!element.hasAttribute('role')) element.setAttribute('role','status');
  });
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',()=>enhanceAccessibility());
}else{
  enhanceAccessibility();
}
