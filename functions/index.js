import { onRequest } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { createHash, randomBytes } from "node:crypto";

initializeApp();

const githubToken = defineSecret("DELIVERY_GITHUB_TOKEN");
const OWNER = "guiasysstudio";
const REPO = "Delivery-Pizzaria";
const BRANCH = "main";

function safeName(value) {
  return String(value || "produto")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "produto";
}

async function staffPermissions(uid) {
  const db = getFirestore();
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) return null;
  const user = userSnap.data() || {};
  if (user.active === false) return null;
  if (user.role === "master") return {master:true};

  const roleSnap = await db.doc(`roles/${user.role}`).get();
  if (!roleSnap.exists) return null;
  const role=roleSnap.data()||{};
  if (role.active === false) return null;
  return role.permissions || {};
}

async function staffCanUpload(uid) {
  const permissions=await staffPermissions(uid);
  return !!permissions && (
    permissions.master===true ||
    permissions.productsCreate===true ||
    permissions.productsEdit===true
  );
}

async function staffCanManageSettings(uid) {
  const permissions=await staffPermissions(uid);
  return !!permissions && (permissions.master===true||permissions.settingsManage===true);
}

async function verifyActiveStaffRequest(req, requiredPermission) {
  const authHeader=req.headers.authorization||"";
  const match=authHeader.match(/^Bearer\s+(.+)$/i);
  if(!match) throw Object.assign(new Error("missing_auth"),{status:401,code:"missing_auth"});

  const decoded=await getAuth().verifyIdToken(match[1]);
  const db=getFirestore();
  const callerSnap=await db.doc(`users/${decoded.uid}`).get();
  if(!callerSnap.exists) {
    throw Object.assign(new Error("permission_denied"),{status:403,code:"permission_denied"});
  }

  const caller=callerSnap.data()||{};
  if(caller.active===false) {
    throw Object.assign(new Error("user_disabled"),{status:403,code:"user_disabled"});
  }

  const permissions=await staffPermissions(decoded.uid);
  const allowed=permissions && (
    permissions.master===true ||
    permissions[requiredPermission]===true
  );
  if(!allowed) {
    throw Object.assign(new Error("permission_denied"),{status:403,code:"permission_denied"});
  }

  return {decoded,caller,permissions,isMaster:caller.role==="master"};
}

async function githubJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken.value()}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });

  if (response.status === 404) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.message || `GitHub HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

export const uploadProductImage = onRequest(
  {
    region: "southamerica-east1",
    secrets: [githubToken],
    cors: [
      "https://guiasysstudio.github.io",
      "https://guiasys.online",
      /https:\/\/.*\.guiasys\.online$/
    ],
    timeoutSeconds: 60,
    memory: "256MiB"
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "method_not_allowed" });
      return;
    }

    try {
      const authHeader = req.headers.authorization || "";
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (!match) {
        res.status(401).json({ error: "missing_auth" });
        return;
      }

      const decoded = await getAuth().verifyIdToken(match[1]);
      if (!(await staffCanUpload(decoded.uid))) {
        res.status(403).json({ error: "permission_denied" });
        return;
      }

      const fileName = safeName(req.body?.fileName);
      const base64 = String(req.body?.base64 || "").replace(/^data:image\/\w+;base64,/, "");

      if (!base64 || base64.length > 4_000_000) {
        res.status(400).json({ error: "invalid_image" });
        return;
      }

      const path = `assets/products/${fileName}.webp`;
      const apiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;

      let existingSha = null;
      try {
        const existing = await githubJson(`${apiUrl}?ref=${encodeURIComponent(BRANCH)}`);
        existingSha = existing?.sha || null;
      } catch (err) {
        if (err.status !== 404) throw err;
      }

      const payload = {
        message: `content: update product image ${fileName}`,
        content: base64,
        branch: BRANCH,
        ...(existingSha ? { sha: existingSha } : {})
      };

      await githubJson(apiUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      res.json({
        ok: true,
        path,
        publicUrl: `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${path}`
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        error: "upload_failed",
        message: err?.message || "Falha ao enviar imagem."
      });
    }
  }
);

function couponIsCurrentlyActive(coupon, timezone = "America/Porto_Velho") {
  if (coupon?.active === false || coupon?.autoReward !== true) return false;
  return dateTimeWindowActive(coupon?.startsAt, coupon?.endsAt, timezone);
}

export const uploadStoreLogo = onRequest(
  {
    region: "southamerica-east1",
    secrets: [githubToken],
    cors: [
      "https://guiasysstudio.github.io",
      "https://guiasys.online",
      /https:\/\/.*\.guiasys\.online$/
    ],
    timeoutSeconds: 60,
    memory: "256MiB"
  },
  async (req,res)=>{
    if(req.method!=="POST"){
      res.status(405).json({error:"method_not_allowed"});
      return;
    }

    try{
      const authHeader=req.headers.authorization||"";
      const match=authHeader.match(/^Bearer\s+(.+)$/i);
      if(!match){
        res.status(401).json({error:"missing_auth"});
        return;
      }

      const decoded=await getAuth().verifyIdToken(match[1]);
      if(!(await staffCanManageSettings(decoded.uid))){
        res.status(403).json({error:"permission_denied"});
        return;
      }

      const base64=String(req.body?.base64||"").replace(/^data:image\/\w+;base64,/,"");
      if(!base64||base64.length>2_000_000){
        res.status(400).json({error:"invalid_image"});
        return;
      }

      // PNG é compatível tanto com navegadores quanto com o decoder nativo
      // usado pelo Print Agent no Windows, além de preservar transparência.
      const path="assets/store/logo.png";
      const apiUrl=`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
      const current=await githubJson(apiUrl+`?ref=${encodeURIComponent(BRANCH)}`);
      const payload={
        message:"assets: update store logo",
        content:base64,
        branch:BRANCH,
        ...(current?.sha?{sha:current.sha}:{})
      };

      const result=await githubJson(apiUrl,{
        method:"PUT",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(payload)
      });

      res.json({ok:true,path,sha:result?.content?.sha||""});
    }catch(err){
      console.error("uploadStoreLogo failed",err);
      res.status(500).json({error:"upload_failed",message:err?.message||"Falha ao enviar logo."});
    }
  }
);

export const grantLoyaltyCoupons = onDocumentUpdated(
  {
    document: "orders/{orderId}",
    region: "southamerica-east1",
    timeoutSeconds: 60,
    memory: "256MiB"
  },
  async event => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    if (!after || after.status !== "completed" || before?.status === "completed") {
      return;
    }

    const customerId = after.customerId;
    if (!customerId) return;

    const db = getFirestore();

    const [ordersSnap, couponsSnap, settingsSnap] = await Promise.all([
      db.collection("orders").where("customerId", "==", customerId).get(),
      db.collection("coupons").get(),
      db.doc("settings/store").get()
    ]);
    const timezone = settingsSnap.data()?.timezone || "America/Porto_Velho";

    const completedOrders = ordersSnap.docs
      .map(docSnap => docSnap.data())
      .filter(order => order.status === "completed");

    const completedCount = completedOrders.length;
    const spent = completedOrders.reduce(
      (sum, order) => sum + Number(order.total || 0),
      0
    );

    const eligible = couponsSnap.docs
      .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
      .filter(coupon => couponIsCurrentlyActive(coupon, timezone))
      .filter(coupon => completedCount >= Number(coupon.minOrders || 0))
      .filter(coupon => spent >= Number(coupon.minSpent || 0));

    for (const coupon of eligible) {
      const rewardRef = db.doc(`customers/${customerId}/coupons/${coupon.id}`);
      const existing = await rewardRef.get();
      if (existing.exists) continue;

      await rewardRef.set({
        sourceCouponId: coupon.id,
        code: coupon.code || coupon.id,
        description: coupon.description || "",
        type: coupon.type || "percentage",
        value: Number(coupon.value || 0),
        minimumOrder: Number(coupon.minimumOrder || 0),
        maxDiscount: Number(coupon.maxDiscount || 0),
        startsAt: coupon.startsAt || "",
        endsAt: coupon.endsAt || "",
        earnedAt: new Date(),
        earnedAfterOrders: completedCount,
        earnedAfterSpent: spent,
        active: true
      });
    }
  }
);



function normalizeText(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

const staffAdminCors=[
  "https://guiasysstudio.github.io",
  "https://guiasys.online",
  /https:\/\/.*\.guiasys\.online$/
];

async function verifyStaffAdminRequest(req) {
  const authHeader=req.headers.authorization||"";
  const match=authHeader.match(/^Bearer\s+(.+)$/i);
  if(!match) throw Object.assign(new Error("missing_auth"),{status:401,code:"missing_auth"});

  const decoded=await getAuth().verifyIdToken(match[1]);
  const db=getFirestore();
  const callerSnap=await db.doc(`users/${decoded.uid}`).get();
  if(!callerSnap.exists) throw Object.assign(new Error("permission_denied"),{status:403,code:"permission_denied"});

  const caller=callerSnap.data()||{};
  if(caller.active===false) throw Object.assign(new Error("user_disabled"),{status:403,code:"user_disabled"});
  if(caller.role!=="master") {
    throw Object.assign(new Error("permission_denied"),{status:403,code:"permission_denied"});
  }

  return {decoded,caller,isMaster:true};
}

function normalizeStaffUsername(value) {
  return String(value||"")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9._-]/g,"")
    .slice(0,32);
}

function validStaffUsername(value) {
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(value);
}

function validStaffPassword(value) {
  const password=String(value||"");
  return password.length>=10 &&
    password.length<=128 &&
    /[A-Za-z]/.test(password) &&
    /\d/.test(password);
}

async function validateNonMasterRole(db,roleId) {
  const role=normalizeText(roleId,120);
  if(!role || role==="master") {
    throw Object.assign(new Error("invalid_role"),{status:400,code:"invalid_role"});
  }
  const snap=await db.doc(`roles/${role}`).get();
  if(!snap.exists || snap.data()?.active===false) {
    throw Object.assign(new Error("invalid_role"),{status:400,code:"invalid_role"});
  }
  return role;
}

async function ensureMasterCanBeChanged(db,targetUid,target) {
  if(target?.role!=="master") return;

  const snap=await db.collection("users").get();
  const otherActiveMasters=snap.docs.filter(docSnap=>{
    if(docSnap.id===targetUid) return false;
    const data=docSnap.data()||{};
    return data.role==="master" && data.active!==false;
  });

  if(!otherActiveMasters.length) {
    throw Object.assign(new Error("last_master"),{status:409,code:"last_master"});
  }
}

export const resolveStaffLogin = onRequest(
  {
    region:"southamerica-east1",
    cors:staffAdminCors,
    timeoutSeconds:15,
    memory:"128MiB"
  },
  async (req,res)=>{
    if(req.method!=="POST"){
      res.status(405).json({error:"method_not_allowed"});
      return;
    }

    const username=normalizeStaffUsername(req.body?.username);
    const decoy=()=>{
      const token=createHash("sha256").update("invalid:"+username).digest("hex").slice(0,24);
      return `invalid.${token}@delivery-pizzaria.local`;
    };

    if(!validStaffUsername(username)){
      res.json({ok:true,email:decoy()});
      return;
    }

    try{
      const snap=await getFirestore().doc(`staffLogins/${username}`).get();
      const email=snap.exists?normalizeText(snap.data()?.email,240):"";
      res.json({ok:true,email:email||decoy()});
    }catch(err){
      console.error("resolveStaffLogin failed",err);
      res.json({ok:true,email:decoy()});
    }
  }
);

export const manageStaffUser = onRequest(
  {
    region:"southamerica-east1",
    cors:staffAdminCors,
    timeoutSeconds:30,
    memory:"256MiB"
  },
  async (req,res)=>{
    if(req.method!=="POST"){
      res.status(405).json({error:"method_not_allowed"});
      return;
    }

    try{
      const {decoded}=await verifyStaffAdminRequest(req);
      const action=normalizeText(req.body?.action,40);
      const db=getFirestore();

      if(action==="create"){
        const username=normalizeStaffUsername(req.body?.username);
        const displayName=normalizeText(req.body?.displayName,80)||username;
        const password=String(req.body?.password||"");
        if(!validStaffUsername(username)){
          res.status(400).json({error:"invalid_username"});
          return;
        }
        if(!validStaffPassword(password)){
          res.status(400).json({error:"invalid_password"});
          return;
        }
        const role=await validateNonMasterRole(db,req.body?.role);
        const loginRef=db.doc(`staffLogins/${username}`);
        const existing=await loginRef.get();
        if(existing.exists){
          res.status(409).json({error:"username_in_use"});
          return;
        }

        const token=randomBytes(12).toString("hex");
        const internalEmail=`staff.${username}.${token}@delivery-pizzaria.local`;
        let created=null;
        try{
          created=await getAuth().createUser({
            email:internalEmail,
            password,
            displayName,
            disabled:false
          });
          const userRef=db.doc(`users/${created.uid}`);
          await db.runTransaction(async tx=>{
            const again=await tx.get(loginRef);
            if(again.exists){
              throw Object.assign(new Error("username_in_use"),{code:"username_in_use"});
            }
            tx.set(userRef,{
              username,
              displayName,
              role,
              active:true,
              createdBy:decoded.uid,
              createdAt:new Date(),
              updatedAt:new Date()
            });
            tx.set(loginRef,{
              uid:created.uid,
              email:internalEmail,
              createdAt:new Date(),
              updatedAt:new Date()
            });
          });
        }catch(err){
          if(created?.uid){
            try{await getAuth().deleteUser(created.uid);}catch{}
          }
          throw err;
        }

        res.json({ok:true,uid:created.uid,username,displayName,role,active:true});
        return;
      }

      const targetUid=normalizeText(req.body?.uid,160);
      if(!targetUid){
        res.status(400).json({error:"user_required"});
        return;
      }

      const targetRef=db.doc(`users/${targetUid}`);
      const targetSnap=await targetRef.get();
      if(!targetSnap.exists){
        res.status(404).json({error:"user_not_found"});
        return;
      }
      const target=targetSnap.data()||{};

      if(action==="update"){
        const displayName=normalizeText(req.body?.displayName,80)||normalizeText(target.username,32);
        if(target.role==="master"){
          if(targetUid!==decoded.uid || req.body?.role!=="master"){
            res.status(403).json({error:"master_protected"});
            return;
          }
          await targetRef.set({displayName,updatedAt:new Date()},{merge:true});
          await getAuth().updateUser(targetUid,{displayName});
          res.json({ok:true,uid:targetUid,displayName,role:"master"});
          return;
        }

        if(targetUid===decoded.uid){
          res.status(409).json({error:"self_role_change"});
          return;
        }
        const role=await validateNonMasterRole(db,req.body?.role);
        await targetRef.set({displayName,role,updatedAt:new Date()},{merge:true});
        await getAuth().updateUser(targetUid,{displayName});
        await getAuth().revokeRefreshTokens(targetUid);
        res.json({ok:true,uid:targetUid,displayName,role});
        return;
      }

      if(action==="setPassword"){
        const password=String(req.body?.password||"");
        if(!validStaffPassword(password)){
          res.status(400).json({error:"invalid_password"});
          return;
        }
        await getAuth().updateUser(targetUid,{password});
        await getAuth().revokeRefreshTokens(targetUid);
        await targetRef.set({
          passwordChangedAt:new Date(),
          passwordChangedBy:decoded.uid,
          updatedAt:new Date()
        },{merge:true});
        res.json({ok:true});
        return;
      }

      if(action==="setActive"){
        if(targetUid===decoded.uid){
          res.status(409).json({error:"self_status_change"});
          return;
        }
        const active=req.body?.active===true;
        if(!active && target.role==="master"){
          await ensureMasterCanBeChanged(db,targetUid,target);
        }
        await getAuth().updateUser(targetUid,{disabled:!active});
        await getAuth().revokeRefreshTokens(targetUid);
        await targetRef.set({
          active,
          statusChangedAt:new Date(),
          statusChangedBy:decoded.uid,
          updatedAt:new Date()
        },{merge:true});
        res.json({ok:true,active});
        return;
      }

      if(action==="delete"){
        if(targetUid===decoded.uid){
          res.status(409).json({error:"self_delete"});
          return;
        }
        if(target.role==="master"){
          await ensureMasterCanBeChanged(db,targetUid,target);
        }

        const username=normalizeStaffUsername(target.username);
        await getAuth().updateUser(targetUid,{disabled:true}).catch(()=>{});
        await getAuth().revokeRefreshTokens(targetUid).catch(()=>{});
        const batch=db.batch();
        batch.delete(targetRef);
        if(username) batch.delete(db.doc(`staffLogins/${username}`));
        await batch.commit();
        await getAuth().deleteUser(targetUid);

        res.json({ok:true,deleted:true});
        return;
      }

      res.status(400).json({error:"invalid_action"});
    }catch(err){
      console.error("manageStaffUser failed",err);
      const code=err?.code||err?.message||"staff_user_action_failed";
      const status=Number(err?.status)||(code==="username_in_use"?409:500);
      res.status(status).json({error:code});
    }
  }
);

const assignableRolePermissions=[
  "ordersView","ordersAccept","ordersPrepare","ordersDispatch","ordersComplete","ordersCancel",
  "productsView","productsCreate","productsEdit","productsDelete","categoriesManage",
  "promotionsManage","couponsManage","customersView","printingManage","cashView","cashOperate",
  "settingsManage"
];

export const manageStaffRole = onRequest(
  {
    region:"southamerica-east1",
    cors:staffAdminCors,
    timeoutSeconds:30,
    memory:"256MiB"
  },
  async (req,res)=>{
    if(req.method!=="POST"){
      res.status(405).json({error:"method_not_allowed"});
      return;
    }

    try{
      await verifyStaffAdminRequest(req);
      const db=getFirestore();
      const action=normalizeText(req.body?.action,40);

      if(action==="seedDefaults"){
        const defaults={
          manager:{name:"Gerente",permissions:{
            ordersView:true,ordersAccept:true,ordersPrepare:true,ordersDispatch:true,ordersComplete:true,ordersCancel:true,
            productsView:true,productsCreate:true,productsEdit:true,productsDelete:true,categoriesManage:true,
            promotionsManage:true,couponsManage:true,customersView:true,printingManage:true,cashView:true,cashOperate:true,settingsManage:true
          }},
          cashier:{name:"Caixa",permissions:{
            ordersView:true,ordersAccept:true,ordersCancel:true,customersView:true,printingManage:true,cashView:true,cashOperate:true
          }},
          kitchen:{name:"Cozinha",permissions:{ordersView:true,ordersPrepare:true}},
          delivery:{name:"Entrega",permissions:{ordersView:true,ordersDispatch:true,ordersComplete:true}},
          operator:{name:"Operador",permissions:{
            ordersView:true,ordersAccept:true,ordersPrepare:true,ordersDispatch:true,ordersComplete:true,ordersCancel:true
          }}
        };
        const batch=db.batch();
        for(const [id,role] of Object.entries(defaults)){
          batch.set(db.doc(`roles/${id}`),{
            name:role.name,
            permissions:role.permissions,
            system:true,
            active:true,
            updatedAt:new Date()
          },{merge:true});
        }
        await batch.commit();
        res.json({ok:true});
        return;
      }

      const roleId=normalizeText(req.body?.roleId,120);
      if(!roleId || roleId==="master"){
        res.status(400).json({error:"invalid_role"});
        return;
      }
      const roleRef=db.doc(`roles/${roleId}`);

      if(action==="save"){
        const name=normalizeText(req.body?.name,80);
        if(!name){
          res.status(400).json({error:"role_name_required"});
          return;
        }
        const input=req.body?.permissions||{};
        const permissions={};
        for(const key of assignableRolePermissions){
          permissions[key]=input[key]===true;
        }
        if(permissions.ordersAccept||permissions.ordersPrepare||permissions.ordersDispatch||permissions.ordersComplete||permissions.ordersCancel){
          permissions.ordersView=true;
        }
        if(permissions.productsCreate||permissions.productsEdit||permissions.productsDelete||permissions.categoriesManage||permissions.promotionsManage){
          permissions.productsView=true;
        }
        if(permissions.cashOperate) permissions.cashView=true;

        const existing=await roleRef.get();
        await roleRef.set({
          name,
          permissions,
          active:req.body?.active!==false,
          system:existing.exists?existing.data()?.system===true:false,
          updatedAt:new Date(),
          ...(existing.exists?{}:{createdAt:new Date()})
        },{merge:true});
        res.json({ok:true,roleId});
        return;
      }

      if(action==="delete"){
        const existing=await roleRef.get();
        if(!existing.exists){
          res.status(404).json({error:"role_not_found"});
          return;
        }
        if(existing.data()?.system===true){
          res.status(409).json({error:"system_role"});
          return;
        }
        const users=await db.collection("users").where("role","==",roleId).limit(1).get();
        if(!users.empty){
          res.status(409).json({error:"role_in_use"});
          return;
        }
        await roleRef.delete();
        res.json({ok:true,deleted:true});
        return;
      }

      res.status(400).json({error:"invalid_action"});
    }catch(err){
      console.error("manageStaffRole failed",err);
      res.status(Number(err?.status)||500).json({
        error:err?.code||err?.message||"staff_role_action_failed"
      });
    }
  }
);


async function verifyStaffOrderPrivateRequest(req) {
  const authHeader=req.headers.authorization||"";
  const match=authHeader.match(/^Bearer\s+(.+)$/i);
  if(!match) throw Object.assign(new Error("missing_auth"),{status:401,code:"missing_auth"});
  const decoded=await getAuth().verifyIdToken(match[1]);
  const permissions=await staffPermissions(decoded.uid);
  if(!permissions) throw Object.assign(new Error("permission_denied"),{status:403,code:"permission_denied"});
  const allowed=permissions.master===true ||
    permissions.ordersAccept===true ||
    permissions.ordersDispatch===true ||
    permissions.ordersComplete===true ||
    permissions.ordersCancel===true ||
    permissions.printingManage===true ||
    permissions.cashOperate===true;
  if(!allowed) throw Object.assign(new Error("permission_denied"),{status:403,code:"permission_denied"});
  return decoded;
}

export const staffOrderPrivate = onRequest(
  {
    region:"southamerica-east1",
    cors:staffAdminCors,
    timeoutSeconds:20,
    memory:"256MiB"
  },
  async (req,res)=>{
    if(req.method!=="POST"){
      res.status(405).json({error:"method_not_allowed"});
      return;
    }
    try{
      await verifyStaffOrderPrivateRequest(req);
      const orderId=normalizeText(req.body?.orderId,120);
      if(!orderId){
        res.status(400).json({error:"order_required"});
        return;
      }
      const db=getFirestore();
      const privateRef=db.doc(`orderPrivate/${orderId}`);
      let privateSnap=await privateRef.get();

      if(!privateSnap.exists){
        const orderRef=db.doc(`orders/${orderId}`);
        const orderSnap=await orderRef.get();
        if(!orderSnap.exists){
          res.status(404).json({error:"order_not_found"});
          return;
        }
        const order=orderSnap.data()||{};
        if(order.customer||order.address){
          const migrated={
            orderId,
            customerId:order.customerId||"",
            customer:order.customer||null,
            address:order.address||null,
            createdAt:order.createdAt||new Date(),
            updatedAt:new Date()
          };
          await privateRef.set(migrated,{merge:true});
          await orderRef.update({
            customer:FieldValue.delete(),
            address:FieldValue.delete(),
            "deliveryPricing.verifiedNeighborhood":FieldValue.delete()
          });
          privateSnap=await privateRef.get();
        }
      }

      if(!privateSnap.exists){
        res.json({ok:true,orderId,customer:null,address:null});
        return;
      }

      const data=privateSnap.data()||{};
      res.json({
        ok:true,
        orderId,
        customer:data.customer||null,
        address:data.address||null
      });
    }catch(err){
      console.error("staffOrderPrivate failed",err);
      res.status(Number(err?.status)||500).json({
        error:err?.code||err?.message||"order_private_failed"
      });
    }
  }
);

export const migrateOrderPrivacy = onRequest(
  {
    region:"southamerica-east1",
    cors:staffAdminCors,
    timeoutSeconds:120,
    memory:"512MiB"
  },
  async (req,res)=>{
    if(req.method!=="POST"){
      res.status(405).json({error:"method_not_allowed"});
      return;
    }
    try{
      await verifyStaffAdminRequest(req);
      const db=getFirestore();
      const migrationRef=db.doc("systemMigrations/orderPrivacyV1");
      const migrationSnap=await migrationRef.get();
      if(migrationSnap.exists&&migrationSnap.data()?.completed===true){
        res.json({ok:true,alreadyCompleted:true,migrated:Number(migrationSnap.data()?.migrated||0)});
        return;
      }

      const ordersSnap=await db.collection("orders").get();
      let migrated=0;
      let batch=db.batch();
      let writes=0;
      const flush=async()=>{
        if(!writes) return;
        await batch.commit();
        batch=db.batch();
        writes=0;
      };

      for(const orderDoc of ordersSnap.docs){
        const order=orderDoc.data()||{};
        if(!order.customer&&!order.address) continue;
        const privateRef=db.doc(`orderPrivate/${orderDoc.id}`);
        batch.set(privateRef,{
          orderId:orderDoc.id,
          customerId:order.customerId||"",
          customer:order.customer||null,
          address:order.address||null,
          createdAt:order.createdAt||new Date(),
          updatedAt:new Date()
        },{merge:true});
        batch.update(orderDoc.ref,{
          customer:FieldValue.delete(),
          address:FieldValue.delete(),
          "deliveryPricing.verifiedNeighborhood":FieldValue.delete()
        });
        writes+=2;
        migrated++;
        if(writes>=400) await flush();
      }
      await flush();

      await migrationRef.set({
        completed:true,
        migrated,
        completedAt:new Date()
      },{merge:true});
      res.json({ok:true,migrated});
    }catch(err){
      console.error("migrateOrderPrivacy failed",err);
      res.status(Number(err?.status)||500).json({
        error:err?.code||err?.message||"privacy_migration_failed"
      });
    }
  }
);


const cashCors=[
  "https://guiasysstudio.github.io",
  "https://guiasys.online",
  /https:\/\/.*\.guiasys\.online$/
];

function cashBusinessDate(timezone="America/Porto_Velho",date=new Date()) {
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone:timezone,
    year:"numeric",
    month:"2-digit",
    day:"2-digit"
  }).formatToParts(date);
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function roundCashMoney(value) {
  const parsed=Number(value);
  if(!Number.isFinite(parsed)) return null;
  return Math.round((parsed+Number.EPSILON)*100)/100;
}

function cleanCashMoney(value,{min=0,max=10_000_000}={}) {
  const parsed=finiteNumber(value,{min,max});
  return parsed==null?null:roundCashMoney(parsed);
}

function emptyCashSalesSummary() {
  return {count:0,gross:0,money:0,pix:0,debit:0,credit:0,other:0};
}

function emptyCashMovementSummary() {
  return {supplies:0,withdrawals:0};
}

function safeCashSalesSummary(value={}) {
  const count=finiteNumber(value.count??0,{min:0,max:10_000_000,integer:true});
  const gross=cleanCashMoney(value.gross??0);
  const money=cleanCashMoney(value.money??0);
  const pix=cleanCashMoney(value.pix??0);
  const debit=cleanCashMoney(value.debit??0);
  const credit=cleanCashMoney(value.credit??0);
  const other=cleanCashMoney(value.other??0);
  if([count,gross,money,pix,debit,credit,other].some(v=>v==null)) return null;
  const components=roundCashMoney(money+pix+debit+credit+other);
  if(components==null||Math.abs(components-gross)>0.01) return null;
  return {count,gross,money,pix,debit,credit,other};
}

function safeCashMovementSummary(value={}) {
  const supplies=cleanCashMoney(value.supplies??0);
  const withdrawals=cleanCashMoney(value.withdrawals??0);
  if([supplies,withdrawals].some(v=>v==null)) return null;
  return {supplies,withdrawals};
}

function cashPaymentBucket(method) {
  const value=String(method||"").toLowerCase();
  if(value.includes("dinheiro")) return "money";
  if(value.includes("pix")) return "pix";
  if(value.includes("débito")||value.includes("debito")) return "debit";
  if(value.includes("crédito")||value.includes("credito")) return "credit";
  return "other";
}

function cashSummarySnapshot(sales,movements) {
  return {
    count:sales.count,
    gross:sales.gross,
    money:sales.money,
    pix:sales.pix,
    debit:sales.debit,
    credit:sales.credit,
    other:sales.other,
    supplies:movements.supplies,
    withdrawals:movements.withdrawals
  };
}

async function buildLegacyCashLedger(db,sessionId,session) {
  const openedMs=session.openedAt?.toMillis?.() ||
    new Date(session.openedAt||0).getTime();
  const closedMs=session.closedAt?.toMillis?.() ||
    new Date(session.closedAt||0).getTime() ||
    Date.now();
  if(!Number.isFinite(openedMs)||openedMs<=0){
    throw Object.assign(new Error("invalid_cash_ledger"),{code:"invalid_cash_ledger"});
  }

  const [ordersSnap,movementsSnap]=await Promise.all([
    db.collection("orders").where("status","==","completed").get(),
    db.collection("cashSessions").doc(sessionId).collection("movements").get()
  ]);

  const sales=emptyCashSalesSummary();
  for(const orderDoc of ordersSnap.docs){
    const order=orderDoc.data()||{};
    const completedMs=order.completedAt?.toMillis?.() ||
      new Date(order.completedAt||0).getTime();
    if(!Number.isFinite(completedMs)||completedMs<openedMs||completedMs>closedMs) continue;

    const total=cleanCashMoney(order.total,{min:0,max:5_000_000});
    if(total==null){
      throw Object.assign(new Error("invalid_cash_ledger"),{code:"invalid_cash_ledger"});
    }
    const bucket=cashPaymentBucket(order.payment?.method);
    sales.count+=1;
    sales.gross=roundCashMoney(sales.gross+total);
    sales[bucket]=roundCashMoney(sales[bucket]+total);
  }

  const movements=emptyCashMovementSummary();
  for(const movementDoc of movementsSnap.docs){
    const movement=movementDoc.data()||{};
    const amount=cleanCashMoney(movement.amount,{min:0.01,max:1_000_000});
    if(amount==null||!["supply","withdrawal"].includes(movement.type)){
      throw Object.assign(new Error("invalid_cash_ledger"),{code:"invalid_cash_ledger"});
    }
    if(movement.type==="supply"){
      movements.supplies=roundCashMoney(movements.supplies+amount);
    }else{
      movements.withdrawals=roundCashMoney(movements.withdrawals+amount);
    }
  }

  if(!safeCashSalesSummary(sales)||!safeCashMovementSummary(movements)){
    throw Object.assign(new Error("invalid_cash_ledger"),{code:"invalid_cash_ledger"});
  }
  return {sales,movements};
}

async function ensureCashLedgerV2(db,sessionId) {
  if(!sessionId) return;
  const sessionRef=db.doc(`cashSessions/${sessionId}`);
  const initialSnap=await sessionRef.get();
  if(!initialSnap.exists) {
    throw Object.assign(new Error("cash_session_not_found"),{code:"cash_session_not_found"});
  }

  const initial=initialSnap.data()||{};
  if(Number(initial.summaryVersion||0)>=2&&initial.salesSummary&&initial.movementSummary) return;

  const legacy=await buildLegacyCashLedger(db,sessionId,initial);
  await db.runTransaction(async tx=>{
    const currentSnap=await tx.get(sessionRef);
    if(!currentSnap.exists){
      throw Object.assign(new Error("cash_session_not_found"),{code:"cash_session_not_found"});
    }
    const current=currentSnap.data()||{};
    if(Number(current.summaryVersion||0)>=2&&current.salesSummary&&current.movementSummary) return;
    if(current.status!=="open"){
      throw Object.assign(new Error("cash_not_open"),{code:"cash_not_open"});
    }

    tx.update(sessionRef,{
      summaryVersion:2,
      locked:false,
      salesSummary:legacy.sales,
      movementSummary:legacy.movements,
      financialRevision:0,
      migratedAt:new Date(),
      updatedAt:new Date()
    });
  });
}

export const manageCash = onRequest(
  {
    region:"southamerica-east1",
    cors:cashCors,
    timeoutSeconds:30,
    memory:"256MiB"
  },
  async (req,res)=>{
    if(req.method!=="POST"){
      res.status(405).json({error:"method_not_allowed"});
      return;
    }

    try{
      const action=normalizeText(req.body?.action,40);
      if(!["open","movement","close","completeOrder"].includes(action)){
        res.status(400).json({error:"invalid_action"});
        return;
      }

      const requiredPermission=action==="completeOrder"?"ordersComplete":"cashOperate";
      const {decoded,caller}=await verifyActiveStaffRequest(req,requiredPermission);
      const db=getFirestore();
      const now=new Date();
      const operatorName=normalizeText(
        caller.displayName||caller.username||decoded.name||"Usuário",
        100
      )||"Usuário";

      if(action==="open"){
        const openingAmount=cleanCashMoney(req.body?.openingAmount,{min:0,max:1_000_000});
        const openingNote=normalizeText(req.body?.openingNote,300);
        const requestId=normalizeText(req.body?.requestId,80);
        if(openingAmount==null||!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)){
          res.status(400).json({error:"invalid_opening_amount"});
          return;
        }

        const requestFingerprint=createHash("sha256").update(JSON.stringify({
          openingAmount,openingNote
        })).digest("hex");
        const requestKey=createHash("sha256")
          .update(decoded.uid+":cash-open:"+requestId)
          .digest("hex");
        const requestRef=db.doc(`cashOperationRequests/${requestKey}`);

        const settingsSnap=await db.doc("settings/store").get();
        const timezone=settingsSnap.data()?.timezone||"America/Porto_Velho";
        const businessDate=cashBusinessDate(timezone,now);
        const stateRef=db.doc("cashState/current");
        const dayRef=db.doc(`cashDays/${businessDate}`);
        const sessionRef=db.collection("cashSessions").doc();
        let sessionNumber=1;
        let duplicateResult=null;

        await db.runTransaction(async tx=>{
          const [requestSnap,stateSnap,daySnap]=await Promise.all([
            tx.get(requestRef),
            tx.get(stateRef),
            tx.get(dayRef)
          ]);

          if(requestSnap.exists){
            const stored=requestSnap.data()||{};
            if(stored.requestFingerprint!==requestFingerprint){
              throw Object.assign(new Error("idempotency_conflict"),{code:"idempotency_conflict"});
            }
            duplicateResult=stored;
            return;
          }

          if(stateSnap.exists&&stateSnap.data()?.sessionId){
            const existingSessionId=normalizeText(stateSnap.data().sessionId,120);
            const existingSessionSnap=existingSessionId
              ?await tx.get(db.doc(`cashSessions/${existingSessionId}`))
              :null;
            if(existingSessionSnap?.exists&&existingSessionSnap.data()?.status==="open"){
              throw Object.assign(new Error("cash_already_open"),{code:"cash_already_open"});
            }
            // Recupera automaticamente um ponteiro órfão/obsoleto.
            tx.delete(stateRef);
          }

          const day=daySnap.exists?daySnap.data()||{}:{};
          const previousIds=Array.isArray(day.sessionIds)
            ?day.sessionIds.filter(id=>typeof id==="string"&&id)
            :[];
          sessionNumber=previousIds.length+1;
          const salesSummary=emptyCashSalesSummary();
          const movementSummary=emptyCashMovementSummary();
          tx.set(sessionRef,{
            status:"open",
            locked:false,
            summaryVersion:2,
            businessDate,
            sessionNumber,
            timezone,
            openingAmount,
            openingNote,
            openedBy:decoded.uid,
            openedByName:operatorName,
            openedAt:now,
            updatedAt:now,
            financialRevision:0,
            salesSummary,
            movementSummary
          });
          tx.set(stateRef,{
            sessionId:sessionRef.id,
            businessDate,
            status:"open",
            openedBy:decoded.uid,
            openedAt:now,
            updatedAt:now
          });
          tx.set(dayRef,{
            businessDate,
            status:"open",
            activeSessionId:sessionRef.id,
            lastSessionId:sessionRef.id,
            sessionIds:[...previousIds,sessionRef.id],
            sessionCount:sessionNumber,
            openedAt:day.openedAt||now,
            lastOpenedAt:now,
            updatedAt:now
          },{merge:true});
          tx.set(requestRef,{
            action,
            requestId,
            requestFingerprint,
            operatorId:decoded.uid,
            sessionId:sessionRef.id,
            businessDate,
            sessionNumber,
            openingAmount,
            createdAt:now
          });
        });

        if(duplicateResult){
          res.json({ok:true,idempotent:true,...duplicateResult});
          return;
        }
        res.json({
          ok:true,
          action,
          sessionId:sessionRef.id,
          businessDate,
          sessionNumber,
          openingAmount
        });
        return;
      }

      if(action==="movement"){
        const sessionId=normalizeText(req.body?.sessionId,120);
        const type=req.body?.type==="withdrawal"?"withdrawal":
          req.body?.type==="supply"?"supply":"";
        const amount=cleanCashMoney(req.body?.amount,{min:0.01,max:1_000_000});
        const note=normalizeText(req.body?.note,300);
        const requestId=normalizeText(req.body?.requestId,80);
        if(!sessionId||!type||amount==null||!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)){
          res.status(400).json({error:"invalid_cash_movement"});
          return;
        }

        const requestFingerprint=createHash("sha256").update(JSON.stringify({
          sessionId,type,amount,note
        })).digest("hex");
        const requestKey=createHash("sha256")
          .update(decoded.uid+":cash-movement:"+requestId)
          .digest("hex");
        const requestRef=db.doc(`cashOperationRequests/${requestKey}`);
        const stateRef=db.doc("cashState/current");
        const sessionRef=db.doc(`cashSessions/${sessionId}`);
        const movementRef=sessionRef.collection("movements").doc();
        let duplicateResult=null;

        await ensureCashLedgerV2(db,sessionId);

        await db.runTransaction(async tx=>{
          const [requestSnap,stateSnap,sessionSnap]=await Promise.all([
            tx.get(requestRef),
            tx.get(stateRef),
            tx.get(sessionRef)
          ]);

          if(requestSnap.exists){
            const stored=requestSnap.data()||{};
            if(stored.requestFingerprint!==requestFingerprint){
              throw Object.assign(new Error("idempotency_conflict"),{code:"idempotency_conflict"});
            }
            duplicateResult=stored;
            return;
          }
          if(!stateSnap.exists||stateSnap.data()?.sessionId!==sessionId){
            throw Object.assign(new Error("cash_session_changed"),{code:"cash_session_changed"});
          }
          if(!sessionSnap.exists||sessionSnap.data()?.status!=="open"){
            throw Object.assign(new Error("cash_not_open"),{code:"cash_not_open"});
          }

          const session=sessionSnap.data()||{};
          const movementSummary=safeCashMovementSummary(session.movementSummary);
          const salesSummary=safeCashSalesSummary(session.salesSummary);
          const openingAmount=cleanCashMoney(session.openingAmount,{min:0,max:1_000_000});
          if(!movementSummary||!salesSummary||openingAmount==null){
            throw Object.assign(new Error("invalid_cash_ledger"),{code:"invalid_cash_ledger"});
          }

          if(type==="withdrawal"){
            const availableCash=roundCashMoney(
              openingAmount+salesSummary.money+movementSummary.supplies-movementSummary.withdrawals
            );
            if(availableCash==null||amount>availableCash){
              throw Object.assign(new Error("insufficient_cash"),{code:"insufficient_cash"});
            }
            movementSummary.withdrawals=roundCashMoney(movementSummary.withdrawals+amount);
          }else{
            movementSummary.supplies=roundCashMoney(movementSummary.supplies+amount);
          }

          if(
            movementSummary.supplies==null || movementSummary.withdrawals==null ||
            movementSummary.supplies>10_000_000 || movementSummary.withdrawals>10_000_000
          ){
            throw Object.assign(new Error("invalid_cash_ledger"),{code:"invalid_cash_ledger"});
          }

          tx.set(movementRef,{
            type,
            amount,
            note,
            createdBy:decoded.uid,
            createdByName:operatorName,
            createdAt:now
          });
          const revision=finiteNumber(
            session.financialRevision??0,
            {min:0,max:1_000_000_000,integer:true}
          );
          if(revision==null){
            throw Object.assign(new Error("invalid_cash_ledger"),{code:"invalid_cash_ledger"});
          }

          tx.update(sessionRef,{
            movementSummary,
            financialRevision:revision+1,
            updatedAt:now
          });
          tx.set(requestRef,{
            action,
            requestId,
            requestFingerprint,
            operatorId:decoded.uid,
            movementId:movementRef.id,
            sessionId,
            type,
            amount,
            createdAt:now
          });
        });

        if(duplicateResult){
          res.json({ok:true,idempotent:true,...duplicateResult});
          return;
        }
        res.json({ok:true,action,movementId:movementRef.id,sessionId,type,amount});
        return;
      }

      if(action==="completeOrder"){
        const orderId=normalizeText(req.body?.orderId,120);
        if(!orderId){
          res.status(400).json({error:"order_required"});
          return;
        }

        const orderRef=db.doc(`orders/${orderId}`);
        const stateRef=db.doc("cashState/current");
        let responseData=null;

        const preState=await stateRef.get();
        if(preState.exists&&preState.data()?.sessionId){
          await ensureCashLedgerV2(db,preState.data().sessionId);
        }

        await db.runTransaction(async tx=>{
          const [orderSnap,stateSnap]=await Promise.all([
            tx.get(orderRef),
            tx.get(stateRef)
          ]);
          if(!orderSnap.exists){
            throw Object.assign(new Error("order_not_found"),{code:"order_not_found"});
          }

          const order=orderSnap.data()||{};
          if(order.status==="completed"&&order.cashSessionId){
            responseData={
              ok:true,
              action,
              orderId,
              sessionId:order.cashSessionId,
              status:"completed",
              idempotent:true
            };
            return;
          }

          const validTransition=
            order.status==="out_for_delivery" ||
            (order.status==="ready"&&order.fulfillment==="pickup");
          if(!validTransition){
            throw Object.assign(new Error("invalid_order_transition"),{code:"invalid_order_transition"});
          }

          if(!stateSnap.exists||!stateSnap.data()?.sessionId){
            throw Object.assign(new Error("cash_not_open"),{code:"cash_not_open"});
          }

          const sessionId=stateSnap.data().sessionId;
          const sessionRef=db.doc(`cashSessions/${sessionId}`);
          const sessionSnap=await tx.get(sessionRef);
          if(!sessionSnap.exists||sessionSnap.data()?.status!=="open"){
            throw Object.assign(new Error("cash_not_open"),{code:"cash_not_open"});
          }

          const session=sessionSnap.data()||{};
          const total=cleanCashMoney(order.total,{min:0,max:5_000_000});
          const salesSummary=safeCashSalesSummary(session.salesSummary);
          if(total==null||!salesSummary){
            throw Object.assign(new Error("invalid_cash_ledger"),{code:"invalid_cash_ledger"});
          }

          const bucket=cashPaymentBucket(order.payment?.method);
          salesSummary.count+=1;
          salesSummary.gross=roundCashMoney(salesSummary.gross+total);
          salesSummary[bucket]=roundCashMoney(salesSummary[bucket]+total);
          if(
            salesSummary.gross==null || salesSummary[bucket]==null ||
            salesSummary.gross>100_000_000 || salesSummary[bucket]>100_000_000
          ){
            throw Object.assign(new Error("invalid_cash_ledger"),{code:"invalid_cash_ledger"});
          }
          const revision=finiteNumber(
            session.financialRevision??0,
            {min:0,max:1_000_000_000,integer:true}
          );
          if(revision==null){
            throw Object.assign(new Error("invalid_cash_ledger"),{code:"invalid_cash_ledger"});
          }

          tx.update(orderRef,{
            status:"completed",
            completedAt:now,
            updatedAt:now,
            cashSessionId:sessionId,
            cashBusinessDate:session.businessDate||stateSnap.data()?.businessDate||null
          });
          tx.update(sessionRef,{
            salesSummary,
            financialRevision:revision+1,
            updatedAt:now
          });

          responseData={
            ok:true,
            action,
            orderId,
            sessionId,
            status:"completed"
          };
        });

        res.json(responseData||{ok:true,action,orderId,status:"completed"});
        return;
      }

      // close
      const sessionId=normalizeText(req.body?.sessionId,120);
      const closingAmount=cleanCashMoney(req.body?.closingAmount,{min:0,max:10_000_000});
      const closingNote=normalizeText(req.body?.closingNote,300);
      const expectedRevision=finiteNumber(
        req.body?.expectedRevision,
        {min:0,max:1_000_000_000,integer:true}
      );
      if(!sessionId||closingAmount==null||expectedRevision==null){
        res.status(400).json({error:"invalid_closing_amount"});
        return;
      }

      const stateRef=db.doc("cashState/current");
      const sessionRef=db.doc(`cashSessions/${sessionId}`);
      let closeResult=null;

      await ensureCashLedgerV2(db,sessionId);

      await db.runTransaction(async tx=>{
        const [stateSnap,sessionSnap]=await Promise.all([
          tx.get(stateRef),
          tx.get(sessionRef)
        ]);
        if(!sessionSnap.exists){
          throw Object.assign(new Error("cash_session_not_found"),{code:"cash_session_not_found"});
        }

        const session=sessionSnap.data()||{};
        if(session.status==="closed"){
          closeResult={
            ok:true,
            action,
            sessionId,
            status:"closed",
            idempotent:true,
            expectedCash:session.expectedCash??0,
            difference:session.difference??0,
            summary:session.summary||{}
          };
          return;
        }

        if(!stateSnap.exists||stateSnap.data()?.sessionId!==sessionId){
          throw Object.assign(new Error("cash_session_changed"),{code:"cash_session_changed"});
        }
        if(session.status!=="open"||session.locked===true){
          throw Object.assign(new Error("cash_not_open"),{code:"cash_not_open"});
        }

        const openingAmount=cleanCashMoney(session.openingAmount,{min:0,max:1_000_000});
        const sales=safeCashSalesSummary(session.salesSummary);
        const movements=safeCashMovementSummary(session.movementSummary);
        const revision=finiteNumber(
          session.financialRevision??0,
          {min:0,max:1_000_000_000,integer:true}
        );
        if(openingAmount==null||!sales||!movements||revision==null){
          throw Object.assign(new Error("invalid_cash_ledger"),{code:"invalid_cash_ledger"});
        }
        if(revision!==expectedRevision){
          throw Object.assign(new Error("cash_changed_recheck"),{code:"cash_changed_recheck"});
        }

        const summary=cashSummarySnapshot(sales,movements);
        const expectedCash=roundCashMoney(
          openingAmount+sales.money+movements.supplies-movements.withdrawals
        );
        if(expectedCash==null||expectedCash<0){
          throw Object.assign(new Error("invalid_cash_ledger"),{code:"invalid_cash_ledger"});
        }
        const difference=roundCashMoney(closingAmount-expectedCash);
        const dayRef=db.doc(`cashDays/${session.businessDate}`);

        tx.update(sessionRef,{
          status:"closed",
          locked:true,
          closingAmount,
          expectedCash,
          difference,
          closingNote,
          closedBy:decoded.uid,
          closedByName:operatorName,
          closedAt:now,
          summary,
          financialRevision:revision+1,
          updatedAt:now
        });
        tx.set(dayRef,{
          businessDate:session.businessDate,
          status:"closed",
          activeSessionId:null,
          lastSessionId:sessionId,
          lastClosedAt:now,
          updatedAt:now
        },{merge:true});
        tx.delete(stateRef);

        closeResult={
          ok:true,
          action,
          sessionId,
          status:"closed",
          expectedCash,
          difference,
          summary
        };
      });

      res.json(closeResult||{ok:true,action,sessionId,status:"closed"});
    }catch(err){
      console.error("manageCash failed",err);
      const code=err?.code||err?.message||"cash_operation_failed";
      const status=
        ["missing_auth"].includes(code)?401:
        ["permission_denied","user_disabled"].includes(code)?403:
        ["order_not_found","cash_session_not_found"].includes(code)?404:
        [
          "cash_already_open",
          "cash_session_changed",
          "cash_not_open",
          "cash_changed_recheck",
          "insufficient_cash",
          "idempotency_conflict",
          "invalid_order_transition"
        ].includes(code)?409:
        [
          "invalid_action",
          "invalid_opening_amount",
          "invalid_cash_movement",
          "invalid_closing_amount",
          "order_required"
        ].includes(code)?400:500;
      res.status(status).json({error:code});
    }
  }
);

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function normalizeCouponCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 30);
}

function businessDateTimeKey(date = new Date(), timezone = "America/Porto_Velho") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function dateTimeWindowActive(startsAt, endsAt, timezone = "America/Porto_Velho") {
  const nowMs = Date.now();
  const nowKey = businessDateTimeKey(new Date(nowMs), timezone);
  const boundary = (value, isStart) => {
    if (!value) return true;
    const raw = String(value).trim();
    const localMatch = raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2})?$/);
    if (localMatch) return isStart ? nowKey >= localMatch[1] : nowKey <= localMatch[1];
    const epoch = Date.parse(raw);
    if (!Number.isFinite(epoch)) return false;
    return isStart ? nowMs >= epoch : nowMs <= epoch;
  };
  return boundary(startsAt, true) && boundary(endsAt, false);
}

function currentScheduleState(settings) {
  if (settings.openMode === "open") return true;
  if (settings.openMode === "closed") return false;

  const timezone = settings.timezone || "America/Porto_Velho";
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);

  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const dayIndex = ({ Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 })[values.weekday];
  const minute = Number(values.hour) * 60 + Number(values.minute);

  const toMinutes = value => {
    const [h,m] = String(value || "00:00").split(":").map(Number);
    return h * 60 + m;
  };

  const schedule = settings.schedule || {};
  const today = schedule[dayIndex] || schedule[String(dayIndex)];
  if (today?.enabled) {
    const open = toMinutes(today.open);
    const close = toMinutes(today.close);
    if (close > open && minute >= open && minute <= close) return true;
    if (close <= open && minute >= open) return true;
  }

  const previousIndex = (dayIndex + 6) % 7;
  const previous = schedule[previousIndex] || schedule[String(previousIndex)];
  if (previous?.enabled) {
    const open = toMinutes(previous.open);
    const close = toMinutes(previous.close);
    if (close <= open && minute <= close) return true;
  }

  return false;
}

function promoActive(promo, timezone) {
  if (!promo || promo.active === false) return false;
  return dateTimeWindowActive(
    promo.startsAt,
    promo.endsAt,
    timezone || "America/Porto_Velho"
  );
}

function promoMatches(promo, product, timezone) {
  if (!promoActive(promo, timezone)) return false;
  if (promo.targetType === "all") return true;
  if (promo.targetType === "category") return promo.targetId === product.categoryId;
  if (promo.targetType === "product") return promo.targetId === product.id;
  return false;
}

function finiteNumber(value, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  if (integer && !Number.isInteger(parsed)) return null;
  return parsed;
}

function finiteMoney(value, { min = 0, max = 1_000_000 } = {}) {
  return finiteNumber(value, { min, max });
}

function applyPromotion(base, promo) {
  const baseValue = finiteMoney(base);
  if (baseValue == null || !promo) return baseValue;

  const discount = finiteMoney(promo.discountValue, { min: 0, max: 1_000_000 });
  if (discount == null || discount <= 0) return null;

  if (promo.discountType === "percentage") {
    if (discount > 100) return null;
    return Math.max(0, baseValue * (1 - discount / 100));
  }

  if (promo.discountType !== "fixed") return null;
  return Math.max(0, baseValue - discount);
}

function bestPromotion(promotions, product, base, timezone) {
  const candidates = promotions
    .filter(p => promoMatches(p, product, timezone))
    .map(p => ({ promo:p, price:applyPromotion(base,p) }))
    .filter(entry => entry.price != null && Number.isFinite(entry.price))
    .sort((a,b) => a.price - b.price);
  return candidates[0] || null;
}

function bestPromotionForSelection(promotions, products, base, timezone) {
  const selection = (Array.isArray(products) ? products : [products]).filter(Boolean);
  if (!selection.length) return null;

  const candidates = promotions
    .filter(promo => selection.every(product => promoMatches(promo, product, timezone)))
    .map(promo => ({ promo, price:applyPromotion(base, promo) }))
    .filter(entry => entry.price != null && Number.isFinite(entry.price))
    .sort((a,b) => a.price - b.price);

  return candidates[0] || null;
}

function distanceKm(a,b) {
  const lat1=Number(a?.latitude),lng1=Number(a?.longitude);
  const lat2=Number(b?.latitude),lng2=Number(b?.longitude);
  if (![lat1,lng1,lat2,lng2].every(Number.isFinite)) return null;
  const toRad = v => v * Math.PI / 180;
  const R = 6371;
  const dLat = toRad(lat2-lat1);
  const dLng = toRad(lng2-lng1);
  const q = Math.sin(dLat/2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(q),Math.sqrt(1-q));
}

async function lookupCepData(zip) {
  const digits=String(zip||"").replace(/\D/g,"");
  if (digits.length !== 8) return null;

  let primary=null;

  try {
    const response = await fetch(`https://brasilapi.com.br/api/cep/v2/${digits}`, {
      signal: AbortSignal.timeout(6000)
    });
    if (response.ok) {
      const data = await response.json();
      const latitude = Number(data?.location?.coordinates?.latitude);
      const longitude = Number(data?.location?.coordinates?.longitude);
      primary={
        zip:digits,
        street:normalizeText(data?.street,160),
        neighborhood:normalizeText(data?.neighborhood,80),
        city:normalizeText(data?.city,80),
        state:normalizeText(data?.state,2).toUpperCase(),
        location:Number.isFinite(latitude)&&Number.isFinite(longitude)
          ? {latitude,longitude,source:"brasilapi-cep-v2"}
          : null
      };

      // Se os dados textuais vieram completos, não precisamos de outra API.
      if (primary.neighborhood&&primary.city&&primary.state) return primary;
    }
  } catch {
    // O ViaCEP abaixo funciona como fallback e complemento.
  }

  try {
    const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) return primary;
    const data = await response.json();
    if (data?.erro) return primary;
    return {
      zip:digits,
      street:primary?.street||normalizeText(data?.logradouro,160),
      neighborhood:primary?.neighborhood||normalizeText(data?.bairro,80),
      city:primary?.city||normalizeText(data?.localidade,80),
      state:primary?.state||normalizeText(data?.uf,2).toUpperCase(),
      location:primary?.location||null
    };
  } catch {
    return primary;
  }
}

function validLocation(value) {
  const latitude=finiteNumber(value?.latitude,{min:-90,max:90});
  const longitude=finiteNumber(value?.longitude,{min:-180,max:180});
  return latitude == null || longitude == null ? null : {latitude,longitude};
}

function validatedDeliveryFee(value) {
  return finiteMoney(value,{min:0,max:10_000});
}

async function calculateServerDelivery(db, settings, address) {
  const mode = settings.deliveryPricingMode || "fixed";

  if (mode === "fixed") {
    const fee=validatedDeliveryFee(settings.deliveryFee);
    return fee == null
      ? { supported:false, fee:0, mode, reason:"invalid_delivery_config" }
      : { supported:true, fee, mode };
  }

  const zip=String(address?.zip||"").replace(/\D/g,"");
  if (zip.length!==8) {
    return { supported:false, fee:0, mode, reason:"address_zip_required" };
  }

  // Bairro e coordenadas usados para cobrar frete nunca vêm do cliente.
  // O servidor reconstrói estes dados a partir do CEP a cada pedido.
  const verifiedAddress=await lookupCepData(zip);
  if (!verifiedAddress) {
    return { supported:false, fee:0, mode, reason:"cep_validation_unavailable" };
  }

  if (mode === "neighborhood") {
    const zones = Array.isArray(settings.deliveryZones) ? settings.deliveryZones : [];
    const neighborhood=normalizeText(verifiedAddress.neighborhood,80);
    if (!neighborhood) {
      return { supported:false, fee:0, mode, reason:"neighborhood_unavailable" };
    }

    for (const zone of zones) {
      if (!normalizeText(zone?.neighborhood,80)) {
        return { supported:false, fee:0, mode, reason:"invalid_delivery_config" };
      }
      if (validatedDeliveryFee(zone?.fee)==null) {
        return { supported:false, fee:0, mode, reason:"invalid_delivery_config" };
      }
    }

    const key = normalizeKey(neighborhood);
    const zone = zones.find(z => normalizeKey(z.neighborhood) === key);
    if (zone) {
      return {
        supported:true,
        fee:validatedDeliveryFee(zone.fee),
        mode,
        zone:zone.neighborhood||neighborhood,
        verifiedNeighborhood:neighborhood,
        addressLocation:verifiedAddress.location
      };
    }

    if (settings.restrictDeliveryZones === true && zones.length) {
      return {
        supported:false,
        fee:0,
        mode,
        reason:"neighborhood_not_served",
        verifiedNeighborhood:neighborhood
      };
    }

    const fallback=validatedDeliveryFee(
      settings.deliveryNeighborhoodFallbackFee ?? settings.deliveryFee ?? 0
    );
    return fallback == null
      ? { supported:false, fee:0, mode, reason:"invalid_delivery_config" }
      : {
          supported:true,
          fee:fallback,
          mode,
          zone:null,
          verifiedNeighborhood:neighborhood,
          addressLocation:verifiedAddress.location
        };
  }

  if (mode === "km") {
    let storeLocation=validLocation(settings.storeLocation);
    if (!storeLocation && settings.storeZip) {
      const storeCep=await lookupCepData(settings.storeZip);
      storeLocation=validLocation(storeCep?.location);
    }

    const addressLocation=validLocation(verifiedAddress.location);
    const km = distanceKm(storeLocation,addressLocation);
    if (km == null) {
      return {
        supported:false,
        fee:0,
        mode,
        reason:"location_unavailable",
        verifiedNeighborhood:verifiedAddress.neighborhood||""
      };
    }

    const rawBands=Array.isArray(settings.deliveryKmBands) ? settings.deliveryKmBands : [];
    const bands=[];
    for (const raw of rawBands) {
      const maxKm=finiteNumber(raw?.maxKm,{min:0.1,max:500});
      const fee=validatedDeliveryFee(raw?.fee);
      if (maxKm==null || fee==null) {
        return { supported:false, fee:0, mode, reason:"invalid_delivery_config" };
      }
      bands.push({maxKm,fee});
    }
    bands.sort((a,b) => a.maxKm-b.maxKm);

    if (!bands.length) {
      return { supported:false, fee:0, mode, reason:"invalid_delivery_config" };
    }

    const band = bands.find(b => km <= b.maxKm);
    if (band) {
      return {
        supported:true,
        fee:band.fee,
        mode,
        distanceKm:km,
        maxKm:band.maxKm,
        addressLocation,
        verifiedNeighborhood:verifiedAddress.neighborhood||"",
        distanceMethod:"straight_line_cep"
      };
    }

    if (settings.restrictDeliveryKm === true) {
      return {
        supported:false,
        fee:0,
        mode,
        distanceKm:km,
        reason:"distance_not_served",
        addressLocation,
        verifiedNeighborhood:verifiedAddress.neighborhood||"",
        distanceMethod:"straight_line_cep"
      };
    }

    const last=bands.at(-1);
    return {
      supported:true,
      fee:last.fee,
      mode,
      distanceKm:km,
      maxKm:last.maxKm,
      addressLocation,
      verifiedNeighborhood:verifiedAddress.neighborhood||"",
      distanceMethod:"straight_line_cep"
    };
  }

  return { supported:false, fee:0, mode, reason:"invalid_delivery_config" };
}

async function verifyCustomerToken(req) {
  const authHeader=req.headers.authorization||"";
  const match=authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return getAuth().verifyIdToken(match[1]);
}

function normalizeCpf(value) {
  return String(value||"").replace(/\D/g,"").slice(0,11);
}

function validCpf(value) {
  const cpf=normalizeCpf(value);
  if (cpf.length!==11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit=(base,factor)=>{
    let total=0;
    for (const ch of base) total+=Number(ch)*factor--;
    const mod=(total*10)%11;
    return mod===10?0:mod;
  };
  return digit(cpf.slice(0,9),10)===Number(cpf[9]) &&
    digit(cpf.slice(0,10),11)===Number(cpf[10]);
}

function cpfHash(value) {
  return createHash("sha256").update(normalizeCpf(value)).digest("hex");
}

function maskCpf(value) {
  const cpf=normalizeCpf(value);
  if (cpf.length!==11) return "";
  return "***."+cpf.slice(3,6)+"."+cpf.slice(6,9)+"-**";
}

function validFullName(value) {
  return normalizeText(value,100).split(/\s+/).filter(Boolean).length>=2;
}

function phoneDigits(value) {
  return String(value||"").replace(/\D/g,"").slice(0,11);
}

const customerCors=[
  "https://guiasysstudio.github.io",
  "https://guiasys.online",
  /https:\/\/.*\.guiasys\.online$/
];

export const customerIdentity = onRequest(
  {
    region:"southamerica-east1",
    cors:customerCors,
    timeoutSeconds:30,
    memory:"256MiB"
  },
  async (req,res)=>{
    try {
      const decoded=await verifyCustomerToken(req);
      if (!decoded?.uid) {
        res.status(401).json({error:"unauthorized"});
        return;
      }

      const db=getFirestore();
      const privateRef=db.doc(`customerPrivate/${decoded.uid}`);
      const customerRef=db.doc(`customers/${decoded.uid}`);

      if (req.method==="GET") {
        const snap=await privateRef.get();
        const data=snap.exists?snap.data():{};
        res.json({
          ok:true,
          identityComplete:snap.exists&&validCpf(data?.cpf),
          cpf:snap.exists?normalizeCpf(data?.cpf):"",
          cpfMasked:snap.exists?maskCpf(data?.cpf):"",
          email:decoded.email||"",
          emailVerified:decoded.email_verified===true
        });
        return;
      }

      if (req.method!=="POST") {
        res.status(405).json({error:"method_not_allowed"});
        return;
      }

      const body=req.body||{};
      const name=normalizeText(body.name,100);
      const phone=phoneDigits(body.phone);
      const cpf=normalizeCpf(body.cpf);

      if (!validFullName(name)) {
        res.status(400).json({error:"full_name_required"});
        return;
      }
      if (!(phone.length===10||phone.length===11)) {
        res.status(400).json({error:"invalid_phone"});
        return;
      }
      if (!validCpf(cpf)) {
        res.status(400).json({error:"invalid_cpf"});
        return;
      }

      const hash=cpfHash(cpf);
      const indexRef=db.doc(`cpfIndex/${hash}`);

      await db.runTransaction(async tx=>{
        const [indexSnap,privateSnap]=await Promise.all([
          tx.get(indexRef),
          tx.get(privateRef)
        ]);

        if (indexSnap.exists&&indexSnap.data()?.uid!==decoded.uid) {
          throw Object.assign(new Error("cpf_already_registered"),{code:"cpf_already_registered"});
        }

        const previousHash=privateSnap.exists?privateSnap.data()?.cpfHash:"";
        if (previousHash&&previousHash!==hash) {
          throw Object.assign(new Error("cpf_change_not_allowed"),{code:"cpf_change_not_allowed"});
        }

        tx.set(indexRef,{
          uid:decoded.uid,
          updatedAt:new Date()
        },{merge:true});

        tx.set(privateRef,{
          cpf,
          cpfHash:hash,
          email:decoded.email||"",
          updatedAt:new Date(),
          ...(privateSnap.exists?{}:{createdAt:new Date()})
        },{merge:true});

        tx.set(customerRef,{
          name,
          phone,
          email:decoded.email||"",
          identityComplete:true,
          updatedAt:new Date()
        },{merge:true});
      });

      res.json({
        ok:true,
        identityComplete:true,
        cpf,
        cpfMasked:maskCpf(cpf),
        email:decoded.email||"",
        emailVerified:decoded.email_verified===true
      });
    } catch (err) {
      console.error("customerIdentity failed",err);
      if (err?.code==="cpf_already_registered"||err?.message==="cpf_already_registered") {
        res.status(409).json({error:"cpf_already_registered"});
        return;
      }
      if (err?.code==="cpf_change_not_allowed"||err?.message==="cpf_change_not_allowed") {
        res.status(409).json({error:"cpf_change_not_allowed"});
        return;
      }
      res.status(500).json({error:"identity_failed",message:err?.message||"Falha ao salvar os dados."});
    }
  }
);

export const cancelCustomerOrder = onRequest(
  {
    region:"southamerica-east1",
    cors:customerCors,
    timeoutSeconds:30,
    memory:"256MiB"
  },
  async (req,res)=>{
    if (req.method!=="POST") {
      res.status(405).json({error:"method_not_allowed"});
      return;
    }

    try {
      const decoded=await verifyCustomerToken(req);
      if (!decoded?.uid) {
        res.status(401).json({error:"unauthorized"});
        return;
      }

      const orderId=normalizeText(req.body?.orderId,120);
      if (!orderId) {
        res.status(400).json({error:"order_required"});
        return;
      }

      const db=getFirestore();
      const orderRef=db.doc(`orders/${orderId}`);
      const settingsRef=db.doc("settings/store");

      await db.runTransaction(async tx=>{
        const [orderSnap,settingsSnap]=await Promise.all([
          tx.get(orderRef),
          tx.get(settingsRef)
        ]);
        if (!orderSnap.exists) throw Object.assign(new Error("order_not_found"),{code:"order_not_found"});

        const order=orderSnap.data()||{};
        if (order.customerId!==decoded.uid) throw Object.assign(new Error("permission_denied"),{code:"permission_denied"});
        if (!["pending","accepted"].includes(order.status)) throw Object.assign(new Error("cancel_not_allowed"),{code:"cancel_not_allowed"});

        const minutes=Math.max(0,Number(settingsSnap.data()?.customerCancelMinutes??2));
        const createdMs=order.createdAt?.toMillis?.()??new Date(order.createdAt||0).getTime();
        const elapsed=Date.now()-createdMs;
        if (!Number.isFinite(createdMs)||elapsed>minutes*60*1000) {
          throw Object.assign(new Error("cancel_window_expired"),{code:"cancel_window_expired"});
        }

        tx.update(orderRef,{
          status:"cancelled",
          cancelledAt:new Date(),
          cancelledByCustomer:true,
          updatedAt:new Date()
        });
      });

      res.json({ok:true,status:"cancelled"});
    } catch (err) {
      console.error("cancelCustomerOrder failed",err);
      const code=err?.code||err?.message||"cancel_failed";
      const status=code==="permission_denied"?403:
        code==="order_not_found"?404:
        ["cancel_not_allowed","cancel_window_expired"].includes(code)?409:500;
      res.status(status).json({error:code});
    }
  }
);

export const createOrder = onRequest(
  {
    region:"southamerica-east1",
    cors:[
      "https://guiasysstudio.github.io",
      "https://guiasys.online",
      /https:\/\/.*\.guiasys\.online$/
    ],
    timeoutSeconds:60,
    memory:"256MiB"
  },
  async (req,res) => {
    if (req.method !== "POST") {
      res.status(405).json({error:"method_not_allowed"});
      return;
    }

    try {
      const decoded=await verifyCustomerToken(req);
      if (!decoded?.uid) {
        res.status(401).json({error:"unauthorized"});
        return;
      }

      const provider=String(decoded.firebase?.sign_in_provider||"");
      if (provider==="password" && decoded.email_verified!==true) {
        res.status(409).json({error:"email_not_verified"});
        return;
      }

      const body=req.body||{};
      const requestId=normalizeText(body.requestId,80);
      if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) {
        res.status(400).json({error:"invalid_request_id"});
        return;
      }

      const requestFingerprint=createHash("sha256").update(JSON.stringify({
        fulfillment:body.fulfillment||"",
        addressId:body.addressId||"",
        phone:body.phone||"",
        note:body.note||"",
        couponCode:body.couponCode||"",
        payment:body.payment||{},
        pricing:body.pricing||{},
        items:Array.isArray(body.items)?body.items:[]
      })).digest("hex");

      const db=getFirestore();
      const requestKey=createHash("sha256")
        .update(decoded.uid+":"+requestId)
        .digest("hex");
      const requestRef=db.doc(`orderRequests/${requestKey}`);
      const existingRequest=await requestRef.get();
      if (existingRequest.exists) {
        const stored=existingRequest.data()||{};
        if (stored.requestFingerprint&&stored.requestFingerprint!==requestFingerprint) {
          res.status(409).json({
            error:"idempotency_conflict",
            orderId:stored.orderId||"",
            orderNumber:stored.orderNumber||0
          });
          return;
        }
        res.json({ok:true,idempotent:true,...stored});
        return;
      }

      const [settingsSnap,customerSnap,privateCustomerSnap,promotionsSnap]=await Promise.all([
        db.doc("settings/store").get(),
        db.doc(`customers/${decoded.uid}`).get(),
        db.doc(`customerPrivate/${decoded.uid}`).get(),
        db.collection("promotions").get()
      ]);

      const settings=settingsSnap.exists?settingsSnap.data():{};
      if (!currentScheduleState(settings)) {
        res.status(409).json({error:"store_closed"});
        return;
      }

      const customer=customerSnap.exists?customerSnap.data():{};
      const privateCustomer=privateCustomerSnap.exists?privateCustomerSnap.data():{};
      if (!customer.identityComplete || !validCpf(privateCustomer.cpf)) {
        res.status(409).json({error:"profile_incomplete"});
        return;
      }
      if (!validFullName(customer.name||decoded.name||"")) {
        res.status(409).json({error:"full_name_required"});
        return;
      }
      const rawItems=Array.isArray(body.items)?body.items:[];
      if (!rawItems.length || rawItems.length>80) {
        res.status(400).json({error:"invalid_items"});
        return;
      }

      const fulfillment=body.fulfillment==="pickup"?"pickup":"delivery";
      if (fulfillment==="pickup" && settings.allowPickup===false) {
        res.status(400).json({error:"pickup_disabled"});
        return;
      }

      let address=null;
      if (fulfillment==="delivery") {
        const addressId=normalizeText(body.addressId,120);
        if (!addressId) {
          res.status(400).json({error:"address_required"});
          return;
        }
        const addressSnap=await db.doc(`customers/${decoded.uid}/addresses/${addressId}`).get();
        if (!addressSnap.exists) {
          res.status(400).json({error:"address_not_found"});
          return;
        }
        address={id:addressSnap.id,...addressSnap.data()};
        const addressRequired=[
          normalizeText(address.street,160),
          normalizeText(address.number,20),
          normalizeText(address.city,80),
          normalizeText(address.state,2)
        ];
        if (addressRequired.some(value=>!value)) {
          res.status(400).json({error:"invalid_address"});
          return;
        }
      }

      const productCache=new Map();
      const categoryCache=new Map();
      const getProduct=async id=>{
        if (productCache.has(id)) return productCache.get(id);
        const snap=await db.doc(`products/${id}`).get();
        const value=snap.exists?{id:snap.id,...snap.data()}:null;
        productCache.set(id,value);
        return value;
      };
      const categoryAvailable=async categoryId=>{
        if(!categoryId) return false;
        if(categoryCache.has(categoryId)) return categoryCache.get(categoryId);
        const snap=await db.doc(`categories/${categoryId}`).get();
        const available=snap.exists&&snap.data()?.active!==false;
        categoryCache.set(categoryId,available);
        return available;
      };

      const promotions=promotionsSnap.docs.map(d=>({id:d.id,...d.data()}));
      const items=[];
      let subtotal=0;

      for (const raw of rawItems) {
        const productId=normalizeText(raw.productId,120);
        const first=await getProduct(productId);
        if (!first || first.active===false || !(await categoryAvailable(first.categoryId))) {
          res.status(400).json({error:"product_unavailable",productId});
          return;
        }

        const qty=finiteNumber(raw.qty,{min:1,max:99,integer:true});
        if (qty==null) {
          res.status(400).json({error:"invalid_quantity",productId});
          return;
        }

        const sizeName=normalizeText(raw.sizeName||raw.size?.name,80);
        let base=finiteMoney(first.price,{min:0,max:100_000});
        if (base==null) {
          res.status(500).json({error:"product_config_invalid",productId});
          return;
        }
        let size=null;

        if ((!Array.isArray(first.sizes)||!first.sizes.length) && base<=0) {
          res.status(500).json({error:"product_config_invalid",productId});
          return;
        }

        if (Array.isArray(first.sizes) && first.sizes.length) {
          size=first.sizes.find(s=>normalizeKey(s.name)===normalizeKey(sizeName));
          if (!size) {
            res.status(400).json({error:"invalid_size",productId});
            return;
          }
          const sizePrice=finiteMoney(size.price,{min:0.01,max:100_000});
          if (sizePrice==null) {
            res.status(500).json({error:"product_config_invalid",productId});
            return;
          }
          base=sizePrice;
        }

        const flavorIds=(Array.isArray(raw.flavorProductIds)?raw.flavorProductIds:[productId])
          .map(x=>normalizeText(x,120))
          .filter(Boolean);
        const flavorNames=[first.name||""];
        const validFlavorIds=[productId];
        const flavorProducts=[first];

        if (flavorIds.length>1) {
          if (first.allowHalfHalf===false || first.isPizza!==true) {
            res.status(400).json({error:"half_half_not_allowed",productId});
            return;
          }
          for (const id of [...new Set(flavorIds.slice(1))].slice(0,1)) {
            const flavor=await getProduct(id);
            if (
              !flavor ||
              flavor.active===false ||
              flavor.categoryId!==first.categoryId ||
              flavor.isPizza!==true ||
              flavor.allowHalfHalf===false
            ) {
              res.status(400).json({error:"invalid_second_flavor",productId:id});
              return;
            }
            if (sizeName) {
              const matching=flavor.sizes?.find(s=>normalizeKey(s.name)===normalizeKey(sizeName));
              if (!matching) {
                res.status(400).json({error:"second_flavor_size_unavailable",productId:id});
                return;
              }
              const matchingPrice=finiteMoney(matching.price,{min:0.01,max:100_000});
              if (matchingPrice==null) {
                res.status(500).json({error:"product_config_invalid",productId:id});
                return;
              }
              base=Math.max(base,matchingPrice);
            }
            flavorNames.push(flavor.name||"");
            validFlavorIds.push(flavor.id);
            flavorProducts.push(flavor);
          }
        }

        const best=bestPromotionForSelection(
          promotions,
          flavorProducts,
          base,
          settings.timezone || "America/Porto_Velho"
        );
        const promotedBase=best?best.price:base;
        if (!Number.isFinite(promotedBase) || promotedBase<0) {
          res.status(500).json({error:"promotion_config_invalid"});
          return;
        }

        const requestedExtras=[...new Set(
          (Array.isArray(raw.extras)?raw.extras:[])
            .map(x=>normalizeText(typeof x==="string"?x:x?.name,80))
            .filter(Boolean)
        )];
        const extras=[];
        let extrasValue=0;

        for (const name of requestedExtras.slice(0,20)) {
          const catalogExtra=first.extras?.find(x=>normalizeKey(x.name)===normalizeKey(name));
          if (!catalogExtra) {
            res.status(400).json({error:"invalid_extra",productId,extra:name});
            return;
          }
          const extraPrice=finiteMoney(catalogExtra.price,{min:0,max:100_000});
          if (extraPrice==null) {
            res.status(500).json({error:"product_config_invalid",productId});
            return;
          }
          extras.push({name:catalogExtra.name,price:extraPrice});
          extrasValue+=extraPrice;
        }

        const unitPrice=promotedBase+extrasValue;
        if (!Number.isFinite(unitPrice) || unitPrice<0) {
          res.status(500).json({error:"product_config_invalid",productId});
          return;
        }
        subtotal+=unitPrice*qty;
        if (!Number.isFinite(subtotal) || subtotal<0 || subtotal>5_000_000) {
          res.status(400).json({error:"invalid_order_total"});
          return;
        }
        items.push({
          productId:first.id,
          flavorProductIds:validFlavorIds,
          name:flavorNames.join(" / "),
          flavors:flavorNames,
          size:size?{name:size.name,price:Number(size.price||0)}:null,
          extras,
          unitPrice,
          qty,
          note:normalizeText(raw.note,300),
          promotion:best?{
            id:best.promo.id,
            name:best.promo.name||"Promoção",
            discountType:best.promo.discountType,
            discountValue:Number(best.promo.discountValue||0),
            originalBasePrice:base,
            promotedBasePrice:promotedBase
          }:null
        });
      }

      const minimumOrder=finiteMoney(settings.minimumOrder||0,{min:0,max:1_000_000});
      if (minimumOrder==null) {
        res.status(500).json({error:"invalid_store_config"});
        return;
      }
      if (subtotal < minimumOrder) {
        res.status(400).json({error:"minimum_order",minimumOrder});
        return;
      }

      let coupon=null;
      let discount=0;
      const couponCode=normalizeCouponCode(body.couponCode);
      if (couponCode) {
        const couponSnap=await db.doc(`coupons/${couponCode}`).get();
        if (!couponSnap.exists) {
          res.status(400).json({error:"coupon_not_found"});
          return;
        }
        const cp={id:couponSnap.id,...couponSnap.data()};
        if (
          cp.active===false ||
          !dateTimeWindowActive(
            cp.startsAt,
            cp.endsAt,
            settings.timezone || "America/Porto_Velho"
          )
        ) {
          res.status(400).json({error:"coupon_inactive"});
          return;
        }
        const couponMinimum=finiteMoney(cp.minimumOrder||0,{min:0,max:1_000_000});
        const couponValue=finiteMoney(cp.value,{min:0.01,max:1_000_000});
        const couponMax=finiteMoney(cp.maxDiscount||0,{min:0,max:1_000_000});
        const minOrders=finiteNumber(cp.minOrders||0,{min:0,max:100_000,integer:true});
        const minSpent=finiteMoney(cp.minSpent||0,{min:0,max:10_000_000});
        if (
          couponMinimum==null || couponValue==null || couponMax==null ||
          minOrders==null || minSpent==null ||
          !["percentage","fixed"].includes(cp.type||"percentage") ||
          ((cp.type||"percentage")==="percentage" && couponValue>100)
        ) {
          res.status(500).json({error:"coupon_config_invalid"});
          return;
        }

        if (subtotal<couponMinimum) {
          res.status(400).json({error:"coupon_minimum_order",minimumOrder:couponMinimum});
          return;
        }

        if (minOrders>0 || minSpent>0) {
          const ordersSnap=await db.collection("orders").where("customerId","==",decoded.uid).get();
          const completed=ordersSnap.docs.map(d=>d.data()).filter(o=>o.status==="completed");
          const spent=completed.reduce((sum,o)=>{
            const value=finiteMoney(o.total||0,{min:0,max:1_000_000});
            return sum+(value??0);
          },0);
          if (completed.length<minOrders || spent<minSpent) {
            res.status(400).json({error:"coupon_not_eligible"});
            return;
          }
        }

        discount=(cp.type||"percentage")==="percentage"
          ?subtotal*couponValue/100
          :couponValue;
        if (couponMax>0) discount=Math.min(discount,couponMax);
        discount=Math.max(0,Math.min(subtotal,discount));
        if (!Number.isFinite(discount)) {
          res.status(500).json({error:"coupon_config_invalid"});
          return;
        }
        coupon={
          id:cp.id,
          code:cp.code||cp.id,
          type:cp.type||"percentage",
          value:couponValue,
          amount:discount
        };
      }

      let delivery={supported:true,fee:0,mode:"pickup"};
      if (fulfillment==="delivery") {
        delivery=await calculateServerDelivery(db,settings,address);
        if (!delivery.supported) {
          const reason=delivery.reason||"delivery_not_supported";
          const serverConfigError=reason==="invalid_delivery_config";
          res.status(serverConfigError?500:400).json({
            error:serverConfigError?"invalid_delivery_config":reason,
            reason
          });
          return;
        }
        if (delivery.addressLocation) {
          // Mantém apenas uma cópia de conveniência no perfil. O cálculo do
          // pedido nunca confia nesta coordenada persistida.
          address.location=delivery.addressLocation;
          await db.doc(`customers/${decoded.uid}/addresses/${address.id}`).set(
            {location:delivery.addressLocation,updatedAt:new Date()},
            {merge:true}
          );
        }
      }

      const deliveryFee=finiteMoney(delivery.fee,{min:0,max:10_000});
      if (deliveryFee==null) {
        res.status(500).json({error:"invalid_delivery_config"});
        return;
      }

      const total=Math.max(0,subtotal-discount+deliveryFee);
      if (![subtotal,discount,deliveryFee,total].every(Number.isFinite)) {
        res.status(400).json({error:"invalid_order_total"});
        return;
      }

      const pricing=body.pricing||{};
      const expectedSubtotal=finiteMoney(pricing.subtotal,{min:0,max:5_000_000});
      const expectedDiscount=finiteMoney(pricing.discount,{min:0,max:5_000_000});
      const expectedDeliveryFee=finiteMoney(pricing.deliveryFee,{min:0,max:10_000});
      const expectedTotal=finiteMoney(pricing.total,{min:0,max:5_000_000});
      if ([expectedSubtotal,expectedDiscount,expectedDeliveryFee,expectedTotal].some(v=>v==null)) {
        res.status(400).json({error:"invalid_pricing_confirmation"});
        return;
      }

      const differs=(a,b)=>Math.abs(Number(a)-Number(b))>0.009;
      if (
        differs(expectedSubtotal,subtotal) ||
        differs(expectedDiscount,discount) ||
        differs(expectedDeliveryFee,deliveryFee) ||
        differs(expectedTotal,total)
      ) {
        res.status(409).json({
          error:"pricing_changed",
          subtotal,
          discount,
          deliveryFee,
          total
        });
        return;
      }

      const paymentMethod=normalizeText(body.payment?.method,80);
      const allowedPayments=Array.isArray(settings.payments)?settings.payments:[];
      if (!paymentMethod || (allowedPayments.length&&!allowedPayments.includes(paymentMethod))) {
        res.status(400).json({error:"invalid_payment"});
        return;
      }

      const needsChange=paymentMethod.toLowerCase().includes("dinheiro")&&body.payment?.needsChange===true;
      const changeFor=needsChange
        ?finiteMoney(body.payment?.changeFor,{min:0,max:1_000_000})
        :0;
      if (changeFor==null || (needsChange&&changeFor<total)) {
        res.status(400).json({error:"invalid_change"});
        return;
      }

      const phone=normalizeText(body.phone||customer.phone,40);
      const name=normalizeText(customer.name||decoded.name||"Cliente",100);
      if (![10,11].includes(phoneDigits(phone).length)) {
        res.status(400).json({error:"invalid_phone"});
        return;
      }

      const counterRef=db.doc("counters/orders");
      const rateRef=db.doc(`orderRateLimits/${decoded.uid}`);
      const orderRef=db.collection("orders").doc();
      const orderPrivateRef=db.doc(`orderPrivate/${orderRef.id}`);
      let orderNumber=0;
      let duplicateResult=null;
      const now=new Date();
      const nowMs=now.getTime();
      const autoAccepted=settings.autoAcceptOrders===true;

      await db.runTransaction(async tx=>{
        const [requestSnap,rateSnap,counter]=await Promise.all([
          tx.get(requestRef),
          tx.get(rateRef),
          tx.get(counterRef)
        ]);

        if (requestSnap.exists) {
          const stored=requestSnap.data()||{};
          if (stored.requestFingerprint&&stored.requestFingerprint!==requestFingerprint) {
            throw Object.assign(new Error("idempotency_conflict"),{code:"idempotency_conflict"});
          }
          duplicateResult=stored;
          return;
        }

        const rate=rateSnap.exists?rateSnap.data():{};
        const lastCreatedMs=rate.lastCreatedAt?.toMillis?.() ||
          new Date(rate.lastCreatedAt||0).getTime() || 0;
        if (lastCreatedMs && nowMs-lastCreatedMs<5000) {
          throw Object.assign(new Error("rate_limited"),{code:"rate_limited"});
        }

        let windowStartMs=rate.windowStart?.toMillis?.() ||
          new Date(rate.windowStart||0).getTime() || 0;
        let windowCount=finiteNumber(rate.windowCount||0,{min:0,max:100_000,integer:true})??0;
        if (!windowStartMs || nowMs-windowStartMs>10*60*1000) {
          windowStartMs=nowMs;
          windowCount=0;
        }
        if (windowCount>=12) {
          throw Object.assign(new Error("rate_limited"),{code:"rate_limited"});
        }

        const counterValue=counter.exists
          ?finiteNumber(counter.data().value,{min:0,max:999_999_999,integer:true})
          :0;
        if (counterValue==null) {
          throw Object.assign(new Error("invalid_order_counter"),{code:"invalid_order_counter"});
        }
        orderNumber=counterValue+1;
        tx.set(counterRef,{value:orderNumber,updatedAt:now},{merge:true});
        tx.set(orderRef,{
          orderNumber,
          customerId:decoded.uid,
          status:autoAccepted?"accepted":"pending",
          autoAccepted,
          requestId,
          createdAt:now,
          acceptedAt:autoAccepted?now:null,
          fulfillment,
          deliveryPricing:fulfillment==="delivery"?{
            mode:delivery.mode||settings.deliveryPricingMode||"fixed",
            fee:deliveryFee,
            distanceKm:Number.isFinite(delivery.distanceKm)?Number(delivery.distanceKm.toFixed(3)):null,
            distanceMethod:delivery.distanceMethod||null,
            zone:delivery.zone||null,
            maxKm:delivery.maxKm??null
          }:{mode:"pickup",fee:0},
          payment:{
            method:paymentMethod,
            needsChange,
            changeFor,
            changeAmount:needsChange?changeFor-total:0
          },
          note:normalizeText(body.note,500),
          items,
          subtotal,
          discount,
          coupon,
          deliveryFee,
          total,
          createdBy:"secure-function"
        });

        tx.set(orderPrivateRef,{
          orderId:orderRef.id,
          customerId:decoded.uid,
          customer:{
            name,
            email:decoded.email||"",
            phone
          },
          address:fulfillment==="delivery"?{
            id:address.id,
            label:address.label||"",
            recipient:address.recipient||name,
            phone:address.phone||phone,
            zip:address.zip||"",
            street:address.street||"",
            number:address.number||"",
            complement:address.complement||"",
            neighborhood:address.neighborhood||"",
            city:address.city||"",
            state:address.state||"",
            reference:address.reference||"",
            location:delivery.addressLocation||null
          }:null,
          deliveryPrivate:fulfillment==="delivery"?{
            verifiedNeighborhood:delivery.verifiedNeighborhood||null,
            addressLocation:delivery.addressLocation||null
          }:null,
          createdAt:now,
          updatedAt:now
        });

        const resultData={
          orderId:orderRef.id,
          orderNumber,
          status:autoAccepted?"accepted":"pending",
          subtotal,
          discount,
          deliveryFee,
          total,
          createdAt:now
        };
        tx.set(requestRef,{
          ...resultData,
          customerId:decoded.uid,
          requestId,
          requestFingerprint
        });
        tx.set(rateRef,{
          lastCreatedAt:now,
          windowStart:new Date(windowStartMs),
          windowCount:windowCount+1,
          updatedAt:now
        },{merge:true});
      });

      if (duplicateResult) {
        res.json({ok:true,idempotent:true,...duplicateResult});
        return;
      }

      res.json({
        ok:true,
        orderId:orderRef.id,
        orderNumber,
        status:autoAccepted?"accepted":"pending",
        subtotal,
        discount,
        deliveryFee,
        total
      });
    } catch (err) {
      console.error("createOrder failed",err);
      const code=err?.code||err?.message||"order_failed";
      if (code==="rate_limited") {
        res.status(429).json({error:"rate_limited"});
        return;
      }
      if (code==="idempotency_conflict") {
        res.status(409).json({error:"idempotency_conflict"});
        return;
      }
      if (code==="invalid_order_counter") {
        res.status(500).json({error:"invalid_order_counter"});
        return;
      }
      res.status(500).json({error:"order_failed",message:err?.message||"Falha ao criar pedido."});
    }
  }
);
