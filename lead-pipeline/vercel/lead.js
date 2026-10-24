// api/lead.js
//
// Vercel serverless function for the inbound lead form.
// Receives the form, validates and normalizes it, then forwards it to the
// n8n webhook with a shared secret. Secrets come from Vercel environment
// variables (N8N_WEBHOOK_URL, N8N_WEBHOOK_SECRET), never from this file.
//
// The browser only ever talks to /api/lead. It never sees the n8n URL
// or the secret.

const crypto = require("crypto");

const ALLOWED_ORIGINS = new Set([
  "https://philip-adams-portfolio.vercel.app",
  "http://localhost:3000",
]);

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "fastmail.com",
]);

const LIMITS = {
  name: 100,
  email: 254,
  company: 150,
  role: 120,
  message: 2000,
  utm: 100,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- helpers ----------

// Trim, collapse inner whitespace, cap length.
function cleanLine(value, max) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, max)
    : "";
}

// Like cleanLine, but keeps line breaks (for the message field).
function cleanText(value, max) {
  return typeof value === "string"
    ? value
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+/g, " ")
        .trim()
        .slice(0, max)
    : "";
}

// UTMs end up in CRM fields and reports: keep them lowercase and predictable.
function cleanUtm(value) {
  return cleanLine(value, LIMITS.utm)
    .toLowerCase()
    .replace(/[^a-z0-9_.\-]/g, "");
}

function parseBody(body) {
  if (body && typeof body === "object") return body;
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return {};
}

function normalize(b) {
  const email = cleanLine(b.email, LIMITS.email).toLowerCase();
  const email_domain = email.includes("@") ? email.split("@").pop() : "";

  return {
    submission_id: crypto.randomUUID(),
    submitted_at: new Date().toISOString(),
    name: cleanLine(b.name, LIMITS.name),
    email,
    email_domain,
    is_free_email: FREE_EMAIL_DOMAINS.has(email_domain),
    company: cleanLine(b.company, LIMITS.company),
    role: cleanLine(b.role, LIMITS.role),
    message: cleanText(b.message, LIMITS.message),
    utm_source: cleanUtm(b.utm_source),
    utm_medium: cleanUtm(b.utm_medium),
    utm_campaign: cleanUtm(b.utm_campaign),
  };
}

function validate(lead) {
  const errors = [];
  if (!lead.name)
    errors.push({ field: "name", message: "Please enter your name." });
  if (!EMAIL_RE.test(lead.email))
    errors.push({
      field: "email",
      message: "Please enter a valid work email.",
    });
  if (!lead.company)
    errors.push({ field: "company", message: "Please enter your company." });
  return errors;
}

// Forward to n8n. Retries only failures that can fix themselves
// (network errors, timeouts, 429, 5xx). The same submission_id is reused
// on every attempt, so a retry is recognisably the same lead.
async function forwardToN8n(lead, url, secret) {
  const delaysMs = [0, 400, 1200];
  let lastError;

  for (const delay of delaysMs) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-secret": secret,
          "ngrok-skip-browser-warning": "true",
        },
        body: JSON.stringify(lead),
        signal: AbortSignal.timeout(3000),
      });

      if (response.ok) return;

      lastError = new Error(`n8n responded ${response.status}`);
      // A 4xx (other than 429) means something is wrong with the request
      // itself, e.g. a bad secret. Retrying won't fix it.
      if (response.status < 500 && response.status !== 429) break;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError;
}

// ---------- handler ----------

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // Browsers always send Origin on cross-site POSTs: block other websites
  // from submitting into this form. (Non-browser clients can still call it,
  // which is fine: the n8n side validates everything again.)
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ ok: false, error: "Origin not allowed" });
  }

  const { N8N_WEBHOOK_URL, N8N_WEBHOOK_SECRET } = process.env;
  if (!N8N_WEBHOOK_URL || !N8N_WEBHOOK_SECRET) {
    console.error("lead: missing N8N_WEBHOOK_URL or N8N_WEBHOOK_SECRET");
    return res
      .status(500)
      .json({ ok: false, error: "Server is not configured." });
  }

  const body = parseBody(req.body);

  // Honeypot: a hidden field real people never fill in. Bots usually do.
  // Pretend it worked so the bot learns nothing.
  if (cleanLine(body.website, 200)) {
    return res.status(202).json({ ok: true });
  }

  const lead = normalize(body);
  const errors = validate(lead);
  if (errors.length) {
    return res.status(400).json({ ok: false, errors });
  }

  try {
    await forwardToN8n(lead, N8N_WEBHOOK_URL, N8N_WEBHOOK_SECRET);
    return res
      .status(202)
      .json({ ok: true, submission_id: lead.submission_id });
  } catch (err) {
    // Log the ID and reason, not the person's details.
    console.error(
      `lead: forward failed for ${lead.submission_id}: ${err.message}`,
    );
    return res.status(503).json({
      ok: false,
      error:
        "We couldn't receive your message right now. Please try again in a minute.",
    });
  }
};
