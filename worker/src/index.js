/**
 * ΩPair auth backend — Cloudflare Worker
 *
 * Endpoints:
 *   POST /api/challenge   { publicKey }                -> { nonce }
 *   POST /api/verify      { publicKey, nonce, signature } -> { token, coord }
 *   GET  /api/me           (Authorization: Bearer <token>) -> { publicKey, coord }
 *
 * Storage: D1 (see ../schema.sql)
 * Secrets required (set via `wrangler secret put`):
 *   SESSION_SECRET   — random string used to HMAC-sign session tokens
 *
 * CORS: allows the configured FRONTEND_ORIGIN (set in wrangler.toml [vars])
 */

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const SPKI_ED25519_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

async function importEd25519PublicKey(publicKeyHex) {
  const raw = hexToBytes(publicKeyHex);
  if (raw.length !== 32) throw new Error("Public key must be 32 bytes.");
  const spki = new Uint8Array(SPKI_ED25519_PREFIX.length + raw.length);
  spki.set(SPKI_ED25519_PREFIX, 0);
  spki.set(raw, SPKI_ED25519_PREFIX.length);
  return crypto.subtle.importKey("spki", spki.buffer, { name: "Ed25519" }, false, ["verify"]);
}

// Deterministic Jing-space coordinate from a public key (display layer only).
async function jingCoordFromPublicKeyHex(publicKeyHex) {
  const raw = hexToBytes(publicKeyHex);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
  const x = ((digest[0] * 256 + digest[1]) % 970) / 10;
  const y = ((digest[2] * 256 + digest[3]) % 970) / 10;
  const z = ((digest[4] * 256 + digest[5]) % 970) / 10;
  return { x: x.toFixed(1), y: y.toFixed(1), z: z.toFixed(1) };
}

// ---- session tokens: HMAC-SHA256-signed, not a full JWT library ----
async function signToken(payloadObj, secret) {
  const payload = btoa(JSON.stringify(payloadObj));
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  return `${payload}.${sig}`;
}
async function verifyToken(token, secret) {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
  );
  const sigBytes = Uint8Array.from(atob(sig), (c) => c.charCodeAt(0));
  const ok = await crypto.subtle.verify(
    "HMAC", key, sigBytes, new TextEncoder().encode(payload)
  );
  if (!ok) return null;
  const data = JSON.parse(atob(payload));
  if (data.exp && Date.now() > data.exp) return null;
  return data;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = env.FRONTEND_ORIGIN || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    try {
      if (url.pathname === "/api/challenge" && request.method === "POST") {
        return await handleChallenge(request, env, origin);
      }
      if (url.pathname === "/api/verify" && request.method === "POST") {
        return await handleVerify(request, env, origin);
      }
      if (url.pathname === "/api/me" && request.method === "GET") {
        return await handleMe(request, env, origin);
      }
      return json({ error: "Not found" }, 404, origin);
    } catch (err) {
      return json({ error: err.message || "Internal error" }, 500, origin);
    }
  },
};

async function handleChallenge(request, env, origin) {
  const { publicKey } = await request.json();
  if (!publicKey || !/^[0-9a-fA-F]{64}$/.test(publicKey)) {
    return json({ error: "publicKey must be a 64-char hex string." }, 400, origin);
  }
  const nonceBytes = crypto.getRandomValues(new Uint8Array(24));
  const nonce = bytesToHex(nonceBytes);
  const expiresAt = Date.now() + NONCE_TTL_MS;

  await env.DB.prepare(
    "INSERT INTO nonces (public_key, nonce, expires_at) VALUES (?, ?, ?)"
  ).bind(publicKey, nonce, expiresAt).run();

  return json({ nonce }, 200, origin);
}

async function handleVerify(request, env, origin) {
  const { publicKey, nonce, signature } = await request.json();
  if (!publicKey || !nonce || !signature) {
    return json({ error: "publicKey, nonce, and signature are required." }, 400, origin);
  }

  const row = await env.DB.prepare(
    "SELECT * FROM nonces WHERE public_key = ? AND nonce = ? ORDER BY expires_at DESC LIMIT 1"
  ).bind(publicKey, nonce).first();

  if (!row) return json({ error: "Unknown or already-used nonce." }, 400, origin);
  if (Date.now() > row.expires_at) return json({ error: "Nonce expired." }, 400, origin);

  // one-time use
  await env.DB.prepare("DELETE FROM nonces WHERE id = ?").bind(row.id).run();

  const pubKey = await importEd25519PublicKey(publicKey);
  const sigBytes = base64ToBytes(signature);
  const valid = await crypto.subtle.verify(
    { name: "Ed25519" }, pubKey, sigBytes, new TextEncoder().encode(nonce)
  );
  if (!valid) return json({ error: "Signature verification failed." }, 401, origin);

  const coord = await jingCoordFromPublicKeyHex(publicKey);

  // upsert user
  await env.DB.prepare(
    `INSERT INTO users (public_key, jing_x, jing_y, jing_z, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(public_key) DO UPDATE SET last_login_at = excluded.last_login_at`
  ).bind(publicKey, coord.x, coord.y, coord.z, Date.now(), Date.now()).run();

  const token = await signToken(
    { sub: publicKey, exp: Date.now() + SESSION_TTL_MS },
    env.SESSION_SECRET
  );

  return json({ token, coord }, 200, origin);
}

async function handleMe(request, env, origin) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return json({ error: "Missing bearer token." }, 401, origin);

  const data = await verifyToken(token, env.SESSION_SECRET);
  if (!data) return json({ error: "Invalid or expired session." }, 401, origin);

  const user = await env.DB.prepare(
    "SELECT public_key, jing_x, jing_y, jing_z FROM users WHERE public_key = ?"
  ).bind(data.sub).first();

  if (!user) return json({ error: "User not found." }, 404, origin);

  return json({
    publicKey: user.public_key,
    coord: { x: user.jing_x, y: user.jing_y, z: user.jing_z },
  }, 200, origin);
}
