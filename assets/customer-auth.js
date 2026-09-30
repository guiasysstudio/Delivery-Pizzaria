import { lookupBrazilianZip } from './cep.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from '../firebase-config.js';

export const app=initializeApp(firebaseConfig);
export const auth=getAuth(app);
export const db=getFirestore(app);
export const authPersistenceReady=setPersistence(auth,browserLocalPersistence).catch(err=>{
  console.error('Não foi possível ativar a persistência local da sessão.',err);
});
export const googleProvider=new GoogleAuthProvider();
googleProvider.setCustomParameters({prompt:'select_account'});

const CUSTOMER_IDENTITY_ENDPOINT='https://southamerica-east1-delivery-pizzaria-f5b08.cloudfunctions.net/customerIdentity';
const CUSTOMER_CANCEL_ENDPOINT='https://southamerica-east1-delivery-pizzaria-f5b08.cloudfunctions.net/cancelCustomerOrder';
const CUSTOMER_DELETE_ENDPOINT='https://southamerica-east1-delivery-pizzaria-f5b08.cloudfunctions.net/deleteCustomerAccount';
const DEMO_IDENTITY_PREFIX='deliveryDemoIdentity:';

function demoIdentityKey(uid){
  return DEMO_IDENTITY_PREFIX+String(uid||'');
}

function maskCpfForFallback(value){
  const digits=normalizeCpf(value);
  if(digits.length!==11) return '';
  return '***.***.***-'+digits.slice(-2);
}

function readDemoIdentity(uid){
  if(!uid) return null;
  try{
    const raw=localStorage.getItem(demoIdentityKey(uid));
    if(!raw) return null;
    const parsed=JSON.parse(raw);
    return parsed?.identityComplete===true?parsed:null;
  }catch(err){
    console.warn('Identidade local de demonstração inválida; limpando cache.',err);
    localStorage.removeItem(demoIdentityKey(uid));
    return null;
  }
}

function saveDemoIdentity(uid,{cpf}){
  const data={
    ok:true,
    identityComplete:true,
    cpfMasked:maskCpfForFallback(cpf),
    demoFallback:true,
    savedAt:new Date().toISOString()
  };
  localStorage.setItem(demoIdentityKey(uid),JSON.stringify(data));
  return data;
}

function clearDemoIdentity(uid){
  if(uid) localStorage.removeItem(demoIdentityKey(uid));
}

function identityBackendUnavailable(err){
  const code=String(err?.code||'');
  if(['http/404','http/500','http/502','http/503','http/504'].includes(code)) return true;
  const message=String(err?.message||'');
  return err instanceof TypeError || /failed to fetch|networkerror|network error|load failed/i.test(message);
}

export function normalizeCpf(value){
  return String(value||'').replace(/\D/g,'').slice(0,11);
}

export function formatCpf(value){
  const digits=normalizeCpf(value);
  return digits
    .replace(/^(\d{3})(\d)/,'$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/,'$1.$2.$3')
    .replace(/\.(\d{3})(\d{1,2})$/,'.$1-$2');
}

export function validCpf(value){
  const cpf=normalizeCpf(value);
  if(cpf.length!==11||/^(\d)\1{10}$/.test(cpf)) return false;
  const digit=(base,factor)=>{
    let total=0;
    for(const ch of base) total+=Number(ch)*factor--;
    const mod=(total*10)%11;
    return mod===10?0:mod;
  };
  return digit(cpf.slice(0,9),10)===Number(cpf[9])&&
    digit(cpf.slice(0,10),11)===Number(cpf[10]);
}

export function normalizePhone(value){
  return String(value||'').replace(/\D/g,'').slice(0,11);
}

export function validPhone(value){
  const digits=normalizePhone(value);
  return digits.length===10||digits.length===11;
}

export function formatPhone(value){
  const d=normalizePhone(value);
  if(d.length<=2) return d?('('+d):'';
  if(d.length<=6) return '('+d.slice(0,2)+') '+d.slice(2);
  if(d.length<=10) return '('+d.slice(0,2)+') '+d.slice(2,6)+'-'+d.slice(6);
  return '('+d.slice(0,2)+') '+d.slice(2,7)+'-'+d.slice(7);
}

export function validFullName(value){
  return String(value||'').trim().split(/\s+/).filter(Boolean).length>=2;
}

export function validCustomerPassword(value){
  const password=String(value||'');
  return password.length>=8 &&
    password.length<=128 &&
    /[A-Za-z]/.test(password) &&
    /\d/.test(password);
}

async function authenticatedJson(endpoint,options={}){
  await authPersistenceReady;
  const user=auth.currentUser;
  if(!user) throw Object.assign(new Error('auth-required'),{code:'auth/required'});
  const token=await user.getIdToken();
  const response=await fetch(endpoint,{
    ...options,
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,...(options.headers||{})}
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const err=new Error(data?.message||data?.error||'request-failed');
    err.code=data?.error||('http/'+response.status);
    err.data=data;
    throw err;
  }
  return data;
}

export async function getCustomerIdentity(){
  try{
    const result=await authenticatedJson(CUSTOMER_IDENTITY_ENDPOINT,{method:'GET',cache:'no-store'});
    clearDemoIdentity(auth.currentUser?.uid);
    return result;
  }catch(err){
    if(identityBackendUnavailable(err)&&auth.currentUser){
      const local=readDemoIdentity(auth.currentUser.uid);
      if(local){
        return {
          ...local,
          email:auth.currentUser.email||'',
          emailVerified:auth.currentUser.emailVerified===true
        };
      }
    }
    throw err;
  }
}

export async function saveCustomerIdentity({name,phone,cpf}){
  const cleanName=String(name||'').trim();
  const cleanPhone=String(phone||'').trim();
  const cleanCpf=normalizeCpf(cpf);

  try{
    const result=await authenticatedJson(CUSTOMER_IDENTITY_ENDPOINT,{
      method:'POST',
      body:JSON.stringify({name:cleanName,phone:cleanPhone,cpf:cleanCpf})
    });
    clearDemoIdentity(auth.currentUser?.uid);
    return result;
  }catch(err){
    if(!identityBackendUnavailable(err)||!auth.currentUser) throw err;

    if(!validFullName(cleanName)){
      throw Object.assign(new Error('full_name_required'),{code:'full_name_required'});
    }
    if(!validPhone(cleanPhone)){
      throw Object.assign(new Error('invalid_phone'),{code:'invalid_phone'});
    }
    if(!validCpf(cleanCpf)){
      throw Object.assign(new Error('invalid_cpf'),{code:'invalid_cpf'});
    }

    const local=saveDemoIdentity(auth.currentUser.uid,{cpf:cleanCpf});

    console.warn(
      'Firebase Function customerIdentity indisponível; usando fallback local de demonstração. '+
      'O CPF bruto não foi armazenado no navegador.'
    );

    return {
      ...local,
      email:auth.currentUser.email||'',
      emailVerified:auth.currentUser.emailVerified===true
    };
  }
}

export async function cancelCustomerOrder(orderId){
  return authenticatedJson(CUSTOMER_CANCEL_ENDPOINT,{
    method:'POST',
    body:JSON.stringify({orderId:String(orderId||'')})
  });
}

export async function deleteCustomerAccount(){
  return authenticatedJson(CUSTOMER_DELETE_ENDPOINT,{
    method:'POST',
    body:JSON.stringify({confirmation:'EXCLUIR'})
  });
}

export function watchCustomer(callback){
  let disposed=false;
  let unsubscribe=()=>{};

  Promise.resolve(authPersistenceReady).finally(()=>{
    if(disposed) return;
    unsubscribe=onAuthStateChanged(auth,async user=>{
      if(user){
        try{
          await ensureCustomerProfile(user);
        }catch(err){
          console.error('Não foi possível sincronizar o perfil do cliente.',err);
        }
      }
      callback(user);
    });
  });

  return ()=>{
    disposed=true;
    unsubscribe();
  };
}

export async function loginWithGoogle(){
  await authPersistenceReady;
  const result=await signInWithPopup(auth,googleProvider);
  try{await ensureCustomerProfile(result.user);}catch(err){console.error(err);}
  return result.user;
}

export async function loginWithEmail(email,password){
  await authPersistenceReady;
  const result=await signInWithEmailAndPassword(auth,email.trim(),password);
  try{await ensureCustomerProfile(result.user);}catch(err){console.error(err);}
  return result.user;
}

export async function registerWithEmail({name,email,password,phone='' }){
  await authPersistenceReady;
  if(!validCustomerPassword(password)){
    const err=new Error('weak-password');
    err.code='auth/weak-password';
    throw err;
  }
  const normalizedEmail=email.trim().toLowerCase();
  if(normalizedEmail.endsWith('@delivery-pizzaria.local')){
    const err=new Error('reserved-domain');
    err.code='auth/reserved-domain';
    throw err;
  }
  const result=await createUserWithEmailAndPassword(auth,normalizedEmail,password);
  await updateProfile(result.user,{displayName:name.trim()});
  try{await ensureCustomerProfile(result.user,{name:name.trim(),phone:phone.trim()});}catch(err){console.error(err);}
  if(!result.user.emailVerified){
    try{await sendEmailVerification(result.user);}catch(err){console.warn('Não foi possível enviar a verificação de e-mail.',err);}
  }
  return result.user;
}

export async function logoutCustomer(){
  return signOut(auth);
}

export async function resetCustomerPassword(email){
  return sendPasswordResetEmail(auth,email.trim());
}

export async function resendCustomerEmailVerification(){
  await authPersistenceReady;
  if(!auth.currentUser) throw new Error('auth-required');
  if(auth.currentUser.emailVerified) return;
  return sendEmailVerification(auth.currentUser);
}

export async function ensureCustomerProfile(user,extra={}){
  const ref=doc(db,'customers',user.uid);
  const snap=await getDoc(ref);
  if(!snap.exists()){
    await setDoc(ref,{
      name:extra.name||user.displayName||'',
      phone:extra.phone||'',
      photoURL:user.photoURL||'',
      defaultAddressId:null,
      identityComplete:false,
      createdAt:serverTimestamp(),
      updatedAt:serverTimestamp()
    });
  }else{
    const patch={updatedAt:serverTimestamp()};
    if(user.displayName&&!snap.data().name) patch.name=user.displayName;
    if(user.photoURL!==undefined&&user.photoURL!==snap.data().photoURL) patch.photoURL=user.photoURL||'';
    await setDoc(ref,patch,{merge:true});
  }
}

export async function getCustomerProfile(uid){
  const snap=await getDoc(doc(db,'customers',uid));
  return snap.exists()?{id:snap.id,...snap.data()}:null;
}

export async function saveCustomerProfile(uid,data){
  const patch={
    name:(data.name||'').trim(),
    phone:(data.phone||'').trim(),
    updatedAt:serverTimestamp()
  };
  if(Object.prototype.hasOwnProperty.call(data,'customPhotoURL')){
    patch.customPhotoURL=String(data.customPhotoURL||'');
  }
  await setDoc(doc(db,'customers',uid),patch,{merge:true});
}

export async function getAddresses(uid){
  const snap=await getDocs(query(collection(db,'customers',uid,'addresses'),orderBy('createdAt','asc')));
  return snap.docs.map(d=>({id:d.id,...d.data()}));
}

export async function saveAddress(uid,address,id=null){
  let location=address.location||null;
  if(!location&&address.zip){
    try{
      const zipInfo=await lookupBrazilianZip(address.zip);
      if(zipInfo?.location?.latitude!=null&&zipInfo?.location?.longitude!=null){
        location={
          latitude:Number(zipInfo.location.latitude),
          longitude:Number(zipInfo.location.longitude),
          source:'cep'
        };
      }
    }catch(err){
      console.warn('Coordenadas do CEP não disponíveis.',err);
    }
  }

  const clean={
    label:(address.label||'Casa').trim(),
    recipient:(address.recipient||'').trim(),
    phone:(address.phone||'').trim(),
    zip:(address.zip||'').trim(),
    street:(address.street||'').trim(),
    number:(address.number||'').trim(),
    complement:(address.complement||'').trim(),
    neighborhood:(address.neighborhood||'').trim(),
    city:(address.city||'').trim(),
    state:(address.state||'').trim().toUpperCase(),
    reference:(address.reference||'').trim(),
    location:location&&Number.isFinite(Number(location.latitude))&&Number.isFinite(Number(location.longitude))
      ?{latitude:Number(location.latitude),longitude:Number(location.longitude),source:location.source||'cep'}
      :null,
    updatedAt:serverTimestamp()
  };
  if(id){
    await updateDoc(doc(db,'customers',uid,'addresses',id),clean);
    return id;
  }
  const created=await addDoc(collection(db,'customers',uid,'addresses'),{
    ...clean,
    createdAt:serverTimestamp()
  });
  return created.id;
}

export async function deleteAddress(uid,addressId){
  await deleteDoc(doc(db,'customers',uid,'addresses',addressId));
  const profile=await getCustomerProfile(uid);
  if(profile?.defaultAddressId===addressId){
    await setDoc(doc(db,'customers',uid),{defaultAddressId:null,updatedAt:serverTimestamp()},{merge:true});
  }
}

export async function setDefaultAddress(uid,addressId){
  await setDoc(doc(db,'customers',uid),{defaultAddressId:addressId||null,updatedAt:serverTimestamp()},{merge:true});
}

export async function getFavorites(uid){
  const snap=await getDocs(collection(db,'customers',uid,'favorites'));
  return new Set(snap.docs.map(d=>d.id));
}

export async function setFavorite(uid,productId,active){
  const ref=doc(db,'customers',uid,'favorites',productId);
  if(active){
    await setDoc(ref,{productId,createdAt:serverTimestamp()});
  }else{
    await deleteDoc(ref);
  }
}

export { lookupBrazilianZip };

export function friendlyAuthError(err){
  const code=String(err?.code||'');
  if(code.includes('popup-closed')) return 'Login cancelado.';
  if(code.includes('cancelled-popup-request')) return 'Já existe uma tentativa de login em andamento. Aguarde a janela do Google.';
  if(code.includes('popup-blocked')) return 'O navegador bloqueou a janela do Google. Libere pop-ups para este site e tente novamente.';
  if(code.includes('unauthorized-domain')) return 'Este domínio ainda não foi autorizado no Firebase Authentication.';
  if(code.includes('invalid-credential')||code.includes('wrong-password')||code.includes('user-not-found')) return 'E-mail ou senha inválidos.';
  if(code.includes('email-already-in-use')) return 'Já existe uma conta com este e-mail.';
  if(code.includes('weak-password')) return 'Use uma senha com pelo menos 8 caracteres, incluindo letra e número.';
  if(code.includes('invalid-email')) return 'Informe um e-mail válido.';
  if(code.includes('too-many-requests')) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  return 'Não foi possível concluir a operação. Tente novamente.';
}
