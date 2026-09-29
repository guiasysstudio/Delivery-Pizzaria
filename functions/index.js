import { onRequest } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

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

async function staffCanUpload(uid) {
  const db = getFirestore();
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) return false;
  const user = userSnap.data() || {};
  if (user.active === false) return false;
  if (user.role === "master") return true;

  const roleSnap = await db.doc(`roles/${user.role}`).get();
  if (!roleSnap.exists) return false;
  const permissions = roleSnap.data()?.permissions || {};
  return permissions.productsCreate === true || permissions.productsEdit === true;
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

function couponIsCurrentlyActive(coupon) {
  if (coupon?.active === false || coupon?.autoReward !== true) return false;
  const now = Date.now();
  const start = coupon?.startsAt ? new Date(coupon.startsAt).getTime() : 0;
  const end = coupon?.endsAt ? new Date(coupon.endsAt).getTime() : 0;
  if (start && Number.isFinite(start) && now < start) return false;
  if (end && Number.isFinite(end) && now > end) return false;
  return true;
}

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

    const [ordersSnap, couponsSnap] = await Promise.all([
      db.collection("orders").where("customerId", "==", customerId).get(),
      db.collection("coupons").get()
    ]);

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
      .filter(coupon => couponIsCurrentlyActive(coupon))
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

