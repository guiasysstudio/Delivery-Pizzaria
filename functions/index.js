import { onRequest } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createHash } from "node:crypto";

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
  return roleSnap.data()?.permissions || {};
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

      const path="assets/store/logo.webp";
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

  const permissions=await staffPermissions(decoded.uid);
  if(!permissions || !(permissions.master===true || permissions.usersManage===true)) {
    throw Object.assign(new Error("permission_denied"),{status:403,code:"permission_denied"});
  }

  return {decoded,caller,isMaster:caller.role==="master"};
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
      const {decoded,isMaster}=await verifyStaffAdminRequest(req);
      const action=normalizeText(req.body?.action,40);
      const targetUid=normalizeText(req.body?.uid,160);

      if(!targetUid){
        res.status(400).json({error:"user_required"});
        return;
      }

      const db=getFirestore();
      const targetRef=db.doc(`users/${targetUid}`);
      const targetSnap=await targetRef.get();
      if(!targetSnap.exists){
        res.status(404).json({error:"user_not_found"});
        return;
      }

      const target=targetSnap.data()||{};
      if(target.role==="master" && !isMaster){
        res.status(403).json({error:"master_protected"});
        return;
      }

      if(action==="setPassword"){
        const password=String(req.body?.password||"");
        if(password.length<6 || password.length>128){
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
        if(!active) await getAuth().revokeRefreshTokens(targetUid);
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

        const username=normalizeText(target.username,32);
        const batch=db.batch();
        batch.delete(targetRef);
        if(username) batch.delete(db.doc(`staffLogins/${username}`));
        await batch.commit();

        try{
          await getAuth().deleteUser(targetUid);
        }catch(err){
          console.error("Authentication user deletion failed after profile removal",err);
          throw Object.assign(new Error("auth_delete_failed"),{status:500,code:"auth_delete_failed"});
        }

        res.json({ok:true,deleted:true});
        return;
      }

      res.status(400).json({error:"invalid_action"});
    }catch(err){
      console.error("manageStaffUser failed",err);
      res.status(Number(err?.status)||500).json({
        error:err?.code||err?.message||"staff_user_action_failed"
      });
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
    if (!Number.isFinite(epoch)) return true;
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

function applyPromotion(base, promo) {
  if (!promo) return Number(base || 0);
  if (promo.discountType === "percentage") {
    return Math.max(0, Number(base || 0) * (1 - Number(promo.discountValue || 0) / 100));
  }
  return Math.max(0, Number(base || 0) - Number(promo.discountValue || 0));
}

function bestPromotion(promotions, product, base, timezone) {
  const candidates = promotions
    .filter(p => promoMatches(p, product, timezone))
    .map(p => ({ promo:p, price:applyPromotion(base,p) }))
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

async function lookupCepLocation(zip) {
  const digits=String(zip||"").replace(/\D/g,"");
  if (digits.length !== 8) return null;
  try {
    const response = await fetch(`https://brasilapi.com.br/api/cep/v2/${digits}`);
    if (!response.ok) return null;
    const data = await response.json();
    const latitude = Number(data?.location?.coordinates?.latitude);
    const longitude = Number(data?.location?.coordinates?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude, source:"brasilapi-cep-v2" };
  } catch {
    return null;
  }
}

async function calculateServerDelivery(db, settings, address) {
  const mode = settings.deliveryPricingMode || "fixed";
  if (mode === "fixed") {
    return { supported:true, fee:Number(settings.deliveryFee||0), mode };
  }

  if (mode === "neighborhood") {
    const zones = Array.isArray(settings.deliveryZones) ? settings.deliveryZones : [];
    const key = normalizeKey(address?.neighborhood);
    const zone = zones.find(z => normalizeKey(z.neighborhood) === key);
    if (zone) {
      return { supported:true, fee:Number(zone.fee||0), mode, zone:zone.neighborhood||"" };
    }
    if (settings.restrictDeliveryZones === true && zones.length) {
      return { supported:false, fee:0, mode, reason:"neighborhood_not_served" };
    }
    return {
      supported:true,
      fee:Number(settings.deliveryNeighborhoodFallbackFee ?? settings.deliveryFee ?? 0),
      mode,
      zone:null
    };
  }

  if (mode === "km") {
    let storeLocation = settings.storeLocation || null;
    if (!storeLocation && settings.storeZip) {
      storeLocation = await lookupCepLocation(settings.storeZip);
    }

    let addressLocation = address?.location || null;
    if (!addressLocation && address?.zip) {
      addressLocation = await lookupCepLocation(address.zip);
    }

    const km = distanceKm(storeLocation,addressLocation);
    if (km == null) {
      return { supported:false, fee:0, mode, reason:"location_unavailable" };
    }

    const bands = (Array.isArray(settings.deliveryKmBands) ? settings.deliveryKmBands : [])
      .slice()
      .sort((a,b) => Number(a.maxKm||0)-Number(b.maxKm||0));

    const band = bands.find(b => km <= Number(b.maxKm||0));
    if (band) {
      return { supported:true, fee:Number(band.fee||0), mode, distanceKm:km, maxKm:Number(band.maxKm||0), addressLocation };
    }

    if (settings.restrictDeliveryKm === true && bands.length) {
      return { supported:false, fee:0, mode, distanceKm:km, reason:"distance_not_served", addressLocation };
    }

    const last=bands.at(-1);
    return {
      supported:true,
      fee:last?Number(last.fee||0):Number(settings.deliveryFee||0),
      mode,
      distanceKm:km,
      maxKm:last?Number(last.maxKm||0):null,
      addressLocation
    };
  }

  return { supported:true, fee:Number(settings.deliveryFee||0), mode:"fixed" };
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

      const db=getFirestore();
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
      const body=req.body||{};
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
      }

      const productCache=new Map();
      const getProduct=async id=>{
        if (productCache.has(id)) return productCache.get(id);
        const snap=await db.doc(`products/${id}`).get();
        const value=snap.exists?{id:snap.id,...snap.data()}:null;
        productCache.set(id,value);
        return value;
      };

      const promotions=promotionsSnap.docs.map(d=>({id:d.id,...d.data()}));
      const items=[];
      let subtotal=0;

      for (const raw of rawItems) {
        const productId=normalizeText(raw.productId,120);
        const first=await getProduct(productId);
        if (!first || first.active===false) {
          res.status(400).json({error:"product_unavailable",productId});
          return;
        }

        const qty=Math.max(1,Math.min(99,Number(raw.qty||1)));
        const sizeName=normalizeText(raw.sizeName||raw.size?.name,80);
        let base=Number(first.price||0);
        let size=null;

        if (Array.isArray(first.sizes) && first.sizes.length) {
          size=first.sizes.find(s=>normalizeKey(s.name)===normalizeKey(sizeName));
          if (!size) {
            res.status(400).json({error:"invalid_size",productId});
            return;
          }
          base=Number(size.price||0);
        }

        const flavorIds=(Array.isArray(raw.flavorProductIds)?raw.flavorProductIds:[productId])
          .map(x=>normalizeText(x,120))
          .filter(Boolean);
        const flavorNames=[first.name||""];
        const validFlavorIds=[productId];

        if (flavorIds.length>1) {
          if (first.allowHalfHalf===false || first.isPizza!==true) {
            res.status(400).json({error:"half_half_not_allowed",productId});
            return;
          }
          for (const id of [...new Set(flavorIds.slice(1))].slice(0,1)) {
            const flavor=await getProduct(id);
            if (!flavor || flavor.active===false || flavor.categoryId!==first.categoryId || flavor.isPizza!==true) {
              res.status(400).json({error:"invalid_second_flavor",productId:id});
              return;
            }
            if (sizeName) {
              const matching=flavor.sizes?.find(s=>normalizeKey(s.name)===normalizeKey(sizeName));
              if (!matching) {
                res.status(400).json({error:"second_flavor_size_unavailable",productId:id});
                return;
              }
              base=Math.max(base,Number(matching.price||0));
            }
            flavorNames.push(flavor.name||"");
            validFlavorIds.push(flavor.id);
          }
        }

        const best=bestPromotion(
          promotions,
          first,
          base,
          settings.timezone || "America/Porto_Velho"
        );
        let promotedBase=best?best.price:base;

        const requestedExtras=(Array.isArray(raw.extras)?raw.extras:[])
          .map(x=>normalizeText(typeof x==="string"?x:x?.name,80))
          .filter(Boolean);
        const extras=[];
        let extrasValue=0;

        for (const name of requestedExtras.slice(0,20)) {
          const catalogExtra=first.extras?.find(x=>normalizeKey(x.name)===normalizeKey(name));
          if (!catalogExtra) {
            res.status(400).json({error:"invalid_extra",productId,extra:name});
            return;
          }
          extras.push({name:catalogExtra.name,price:Number(catalogExtra.price||0)});
          extrasValue+=Number(catalogExtra.price||0);
        }

        const unitPrice=promotedBase+extrasValue;
        subtotal+=unitPrice*qty;
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

      if (subtotal < Number(settings.minimumOrder||0)) {
        res.status(400).json({error:"minimum_order",minimumOrder:Number(settings.minimumOrder||0)});
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
        if (subtotal<Number(cp.minimumOrder||0)) {
          res.status(400).json({error:"coupon_minimum_order",minimumOrder:Number(cp.minimumOrder||0)});
          return;
        }

        if (Number(cp.minOrders||0)>0 || Number(cp.minSpent||0)>0) {
          const ordersSnap=await db.collection("orders").where("customerId","==",decoded.uid).get();
          const completed=ordersSnap.docs.map(d=>d.data()).filter(o=>o.status==="completed");
          const spent=completed.reduce((sum,o)=>sum+Number(o.total||0),0);
          if (completed.length<Number(cp.minOrders||0) || spent<Number(cp.minSpent||0)) {
            res.status(400).json({error:"coupon_not_eligible"});
            return;
          }
        }

        discount=cp.type==="percentage"
          ?subtotal*Number(cp.value||0)/100
          :Number(cp.value||0);
        if (Number(cp.maxDiscount||0)>0) discount=Math.min(discount,Number(cp.maxDiscount||0));
        discount=Math.max(0,Math.min(subtotal,discount));
        coupon={
          id:cp.id,
          code:cp.code||cp.id,
          type:cp.type||"percentage",
          value:Number(cp.value||0),
          amount:discount
        };
      }

      let delivery={supported:true,fee:0,mode:"pickup"};
      if (fulfillment==="delivery") {
        delivery=await calculateServerDelivery(db,settings,address);
        if (!delivery.supported) {
          res.status(400).json({error:"delivery_not_supported",reason:delivery.reason||""});
          return;
        }
        if (delivery.addressLocation && !address.location) {
          address.location=delivery.addressLocation;
          await db.doc(`customers/${decoded.uid}/addresses/${address.id}`).set(
            {location:delivery.addressLocation,updatedAt:new Date()},
            {merge:true}
          );
        }
      }

      const deliveryFee=Number(delivery.fee||0);
      const total=Math.max(0,subtotal-discount+deliveryFee);
      const paymentMethod=normalizeText(body.payment?.method,80);
      const allowedPayments=Array.isArray(settings.payments)?settings.payments:[];
      if (!paymentMethod || (allowedPayments.length&&!allowedPayments.includes(paymentMethod))) {
        res.status(400).json({error:"invalid_payment"});
        return;
      }

      const needsChange=paymentMethod.toLowerCase().includes("dinheiro")&&body.payment?.needsChange===true;
      const changeFor=needsChange?Number(body.payment?.changeFor||0):0;
      if (needsChange&&changeFor<total) {
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
      const orderRef=db.collection("orders").doc();
      let orderNumber=0;
      const now=new Date();
      const autoAccepted=settings.autoAcceptOrders===true;

      await db.runTransaction(async tx=>{
        const counter=await tx.get(counterRef);
        orderNumber=(counter.exists?Number(counter.data().value||0):0)+1;
        tx.set(counterRef,{value:orderNumber,updatedAt:now},{merge:true});
        tx.set(orderRef,{
          orderNumber,
          customerId:decoded.uid,
          status:autoAccepted?"accepted":"pending",
          autoAccepted,
          createdAt:now,
          acceptedAt:autoAccepted?now:null,
          customer:{
            name,
            email:decoded.email||"",
            phone
          },
          fulfillment,
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
            location:address.location||delivery.addressLocation||null
          }:null,
          deliveryPricing:fulfillment==="delivery"?{
            mode:delivery.mode||settings.deliveryPricingMode||"fixed",
            fee:deliveryFee,
            distanceKm:Number.isFinite(delivery.distanceKm)?Number(delivery.distanceKm.toFixed(3)):null,
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
      });

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
      res.status(500).json({error:"order_failed",message:err?.message||"Falha ao criar pedido."});
    }
  }
);
