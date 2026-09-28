import { onRequest } from "firebase-functions/v2/https";
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
