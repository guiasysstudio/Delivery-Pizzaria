import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
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
export const googleProvider=new GoogleAuthProvider();
googleProvider.setCustomParameters({prompt:'select_account'});

export function watchCustomer(callback){
  return onAuthStateChanged(auth,async user=>{
    if(user) await ensureCustomerProfile(user);
    callback(user);
  });
}

export async function loginWithGoogle(){
  const result=await signInWithPopup(auth,googleProvider);
  await ensureCustomerProfile(result.user);
  return result.user;
}

export async function loginWithEmail(email,password){
  const result=await signInWithEmailAndPassword(auth,email.trim(),password);
  await ensureCustomerProfile(result.user);
  return result.user;
}

export async function registerWithEmail({name,email,password,phone='' }){
  const result=await createUserWithEmailAndPassword(auth,email.trim(),password);
  await updateProfile(result.user,{displayName:name.trim()});
  await ensureCustomerProfile(result.user,{name:name.trim(),phone:phone.trim()});
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
  await setDoc(doc(db,'customers',uid),{
    name:(data.name||'').trim(),
    phone:(data.phone||'').trim(),
    updatedAt:serverTimestamp()
  },{merge:true});
}

export async function getAddresses(uid){
  const snap=await getDocs(query(collection(db,'customers',uid,'addresses'),orderBy('createdAt','asc')));
  return snap.docs.map(d=>({id:d.id,...d.data()}));
}

export async function saveAddress(uid,address,id=null){
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

export function friendlyAuthError(err){
  const code=String(err?.code||'');
  if(code.includes('popup-closed')) return 'Login cancelado.';
  if(code.includes('unauthorized-domain')) return 'Este domínio ainda não foi autorizado no Firebase Authentication.';
  if(code.includes('invalid-credential')||code.includes('wrong-password')||code.includes('user-not-found')) return 'E-mail ou senha inválidos.';
  if(code.includes('email-already-in-use')) return 'Já existe uma conta com este e-mail.';
  if(code.includes('weak-password')) return 'Use uma senha com pelo menos 6 caracteres.';
  if(code.includes('invalid-email')) return 'Informe um e-mail válido.';
  if(code.includes('too-many-requests')) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  return 'Não foi possível concluir a operação. Tente novamente.';
}
