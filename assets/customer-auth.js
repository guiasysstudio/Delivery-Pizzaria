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
  sendPasswordResetEmail
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
  const normalizedEmail=email.trim().toLowerCase();
  if(normalizedEmail.endsWith('@delivery-pizzaria.local')){
    const err=new Error('reserved-domain');
    err.code='auth/reserved-domain';
    throw err;
  }
  const result=await createUserWithEmailAndPassword(auth,normalizedEmail,password);
  await updateProfile(result.user,{displayName:name.trim()});
  try{await ensureCustomerProfile(result.user,{name:name.trim(),phone:phone.trim()});}catch(err){console.error(err);}
  return result.user;
}

export async function logoutCustomer(){
  return signOut(auth);
}

export async function resetCustomerPassword(email){
  return sendPasswordResetEmail(auth,email.trim());
}

export async function ensureCustomerProfile(user,extra={}){
  const ref=doc(db,'customers',user.uid);
  const snap=await getDoc(ref);
  if(!snap.exists()){
    await setDoc(ref,{
      name:extra.name||user.displayName||'',
      email:user.email||'',
      phone:extra.phone||'',
      photoURL:user.photoURL||'',
      defaultAddressId:null,
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

export async function lookupBrazilianZip(zip){
  const digits=String(zip||'').replace(/\D/g,'');
  if(digits.length!==8) return null;

  try{
    const response=await fetch(`https://brasilapi.com.br/api/cep/v2/${digits}`,{cache:'no-store'});
    if(response.ok){
      const data=await response.json();
      const lat=Number(data?.location?.coordinates?.latitude);
      const lng=Number(data?.location?.coordinates?.longitude);
      return {
        zip:digits.replace(/^(\d{5})(\d{3})$/,'$1-$2'),
        street:data.street||'',
        neighborhood:data.neighborhood||'',
        city:data.city||'',
        state:data.state||'',
        location:Number.isFinite(lat)&&Number.isFinite(lng)?{latitude:lat,longitude:lng,source:'brasilapi-cep-v2'}:null
      };
    }
  }catch(err){
    console.warn('BrasilAPI CEP v2 indisponível; tentando fallback.',err);
  }

  const response=await fetch(`https://viacep.com.br/ws/${digits}/json/`,{cache:'no-store'});
  if(!response.ok) throw new Error('cep-unavailable');
  const data=await response.json();
  if(data?.erro) return null;
  return {
    zip:digits.replace(/^(\d{5})(\d{3})$/,'$1-$2'),
    street:data.logradouro||'',
    neighborhood:data.bairro||'',
    city:data.localidade||'',
    state:data.uf||'',
    location:null
  };
}

export function friendlyAuthError(err){
  const code=String(err?.code||'');
  if(code.includes('popup-closed')) return 'Login cancelado.';
  if(code.includes('cancelled-popup-request')) return 'Já existe uma tentativa de login em andamento. Aguarde a janela do Google.';
  if(code.includes('popup-blocked')) return 'O navegador bloqueou a janela do Google. Libere pop-ups para este site e tente novamente.';
  if(code.includes('unauthorized-domain')) return 'Este domínio ainda não foi autorizado no Firebase Authentication.';
  if(code.includes('invalid-credential')||code.includes('wrong-password')||code.includes('user-not-found')) return 'E-mail ou senha inválidos.';
  if(code.includes('email-already-in-use')) return 'Já existe uma conta com este e-mail.';
  if(code.includes('weak-password')) return 'Use uma senha com pelo menos 6 caracteres.';
  if(code.includes('invalid-email')) return 'Informe um e-mail válido.';
  if(code.includes('too-many-requests')) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  return 'Não foi possível concluir a operação. Tente novamente.';
}
