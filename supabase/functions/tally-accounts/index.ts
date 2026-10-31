// dist/account.js
function canonicalUsername(value) {
  if (typeof value !== "string") throw new Error("\u8BF7\u8F93\u5165\u7528\u6237\u540D\u3002");
  const name = value.trim().normalize("NFKC").toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(name)) throw new Error("\u7528\u6237\u540D\u7528 3\u201324 \u4F4D\u5B57\u6BCD\u3001\u6570\u5B57\u6216\u4E0B\u5212\u7EBF\u3002");
  return name;
}
function checkPassword(value) {
  if (typeof value !== "string" || value.length < 10 || value.length > 128 || !/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) throw new Error("\u5BC6\u7801\u9700 10\u2013128 \u4F4D\uFF0C\u5E76\u540C\u65F6\u5305\u542B\u5B57\u6BCD\u548C\u6570\u5B57\u3002");
  return value;
}
async function sha256(value) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function accountAddress(name) {
  return "u" + await sha256(canonicalUsername(name)) + "@users.little-tally.invalid";
}

// src/registration.js
function makeRegistrationHandler({ env, fetcher = fetch }) {
  return async function handle(req) {
    const allowed = new Set((env("TALLY_ALLOWED_ORIGINS") || "https://little-tally-pocket-455b.sharp-wave-4678.chatgpt.site").split(",").map((x) => x.trim()).filter(Boolean));
    const origin = req.headers.get("Origin") || "";
    const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
    if (allowed.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (!origin || !allowed.has(origin)) return reply({ error: "ORIGIN_NOT_ALLOWED" }, 403);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") return reply({ error: "METHOD_NOT_ALLOWED" }, 405);
    if (!req.headers.get("Content-Type")?.startsWith("application/json")) return reply({ error: "INVALID_REQUEST" }, 415);
    const url = env("SUPABASE_URL"), key = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key || allowed.size === 0) return reply({ error: "NOT_CONFIGURED" }, 503);
    try {
      if (Number(req.headers.get("Content-Length") || 0) > 2048) return reply({ error: "INVALID_REQUEST" }, 400);
      const reader = req.body?.getReader();
      if (!reader) return reply({ error: "INVALID_REQUEST" }, 400);
      let size = 0, chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2048) {
          await reader.cancel();
          return reply({ error: "INVALID_REQUEST" }, 400);
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const raw = new TextDecoder().decode(bytes);
      let input;
      try {
        input = JSON.parse(raw);
      } catch {
        return reply({ error: "INVALID_REQUEST" }, 400);
      }
      if (!input || typeof input !== "object" || Array.isArray(input)) return reply({ error: "INVALID_REQUEST" }, 400);
      let username, password;
      try {
        username = canonicalUsername(input.username);
        password = checkPassword(input.password);
      } catch {
        return reply({ error: "INVALID_ACCOUNT" }, 400);
      }
      const adminHeaders = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
      const call = async (path, body) => {
        const c = new AbortController(), timer = setTimeout(() => c.abort(), 12e3);
        try {
          return await fetcher(url + path, { method: "POST", headers: adminHeaders, body: JSON.stringify(body), signal: c.signal });
        } finally {
          clearTimeout(timer);
        }
      };
      const forwarded = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown";
      const quota = await call("/rest/v1/rpc/tally_registration_allow", { p_username_hash: await sha256(username), p_ip_hash: await sha256(forwarded.slice(0, 500)) });
      if (!quota.ok) return reply({ error: "TEMPORARILY_UNAVAILABLE" }, 503);
      if (await quota.json() !== true) return reply({ error: "TOO_MANY_ATTEMPTS" }, 429);
      const result = await call("/auth/v1/admin/users", { email: await accountAddress(username), password, email_confirm: true, app_metadata: { tally_username: username } });
      const data = await result.json().catch(() => ({}));
      if (!result.ok) {
        if (["email_exists", "user_already_exists"].includes(data.code) || data.msg?.includes("already been registered") || data.message?.includes("already been registered")) return reply({ error: "USERNAME_TAKEN" }, 409);
        return reply({ error: "REGISTRATION_FAILED" }, 400);
      }
      return reply({ created: true });
    } catch {
      return reply({ error: "TEMPORARILY_UNAVAILABLE" }, 503);
    }
  };
}

// accounts-entry.js
Deno.serve(makeRegistrationHandler({ env: (name) => Deno.env.get(name) }));
