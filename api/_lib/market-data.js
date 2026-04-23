const KAMINO_API = "https://api.kamino.finance";
const RWA_ONYC_URL = "https://app.rwa.xyz/assets/ONyc";
const STABLE_SYMBOLS = new Set([
  "USDC",
  "USDT",
  "DAI",
  "USDS",
  "FDUSD",
  "PYUSD",
  "USDE",
  "USDP",
  "TUSD",
  "LUSD",
  "GHO",
  "CRVUSD",
  "SUSD",
  "UXD",
  "USDD",
]);

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

function parseMaybeNumber(x) {
  const n = Number(String(x ?? "").trim());
  return Number.isFinite(n) ? n : NaN;
}

function stableSymbolOf(text) {
  const s = String(text ?? "").trim().toUpperCase();
  return STABLE_SYMBOLS.has(s) ? s : "";
}

function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPercentAfterLabel(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`${escaped}\\s*([0-9]+(?:\\.[0-9]+)?)%`, "i"));
  return match ? Number(match[1]) : NaN;
}

function extractPercentFromHtml(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`${escaped}[\\s\\S]{0,120}?([0-9]+(?:\\.[0-9]+)?)%`, "i"),
    new RegExp(`>${escaped}<[^%]{0,200}?([0-9]+(?:\\.[0-9]+)?)%`, "i"),
  ];
  for (const pattern of patterns) {
    const match = String(html).match(pattern);
    if (match) return Number(match[1]);
  }
  return NaN;
}

async function fetchRwaOnycApy() {
  const rwaRes = await fetch(RWA_ONYC_URL, {
    headers: {
      "User-Agent": "DeFi APY Tracker/1.0",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!rwaRes.ok) {
    throw new Error(`RWA.xyz request failed with HTTP ${rwaRes.status}`);
  }

  const html = await rwaRes.text();
  const text = stripHtml(html);
  const apy7dPct =
    extractPercentAfterLabel(text, "7D APY") ||
    extractPercentFromHtml(html, "7D APY");
  const apy30dPct =
    extractPercentAfterLabel(text, "30D APY") ||
    extractPercentFromHtml(html, "30D APY");

  if (!Number.isFinite(apy7dPct) && !Number.isFinite(apy30dPct)) {
    throw new Error("Could not parse ONyc APY from RWA.xyz");
  }

  return {
    ok: true,
    symbol: "ONyc",
    protocol: "RWA.xyz",
    chain: "Solana",
    pool: "OnRe Tokenized Reinsurance",
    apyPct: Number.isFinite(apy7dPct) ? apy7dPct : apy30dPct,
    apyWindow: Number.isFinite(apy7dPct) ? "7D" : "30D",
    apy7dPct: Number.isFinite(apy7dPct) ? apy7dPct : null,
    apy30dPct: Number.isFinite(apy30dPct) ? apy30dPct : null,
    sourceUrl: RWA_ONYC_URL,
  };
}

async function fetchKaminoStableApys() {
  const out = [];
  const markets = await fetchJson(`${KAMINO_API}/v2/kamino-market`);
  const marketList = Array.isArray(markets) ? markets : [];
  for (const m of marketList) {
    const marketPubkey = String(m?.lendingMarket ?? m?.lending_market ?? m?.market ?? "").trim();
    if (!marketPubkey) continue;
    let metrics = null;
    try {
      metrics = await fetchJson(`${KAMINO_API}/kamino-market/${encodeURIComponent(marketPubkey)}/reserves/metrics`);
    } catch {
      metrics = null;
    }
    if (!Array.isArray(metrics)) continue;
    for (const r of metrics) {
      const symbol =
        stableSymbolOf(r?.liquidityToken) ||
        stableSymbolOf(r?.symbol) ||
        stableSymbolOf(r?.mintSymbol);
      if (!symbol) continue;
      const apy = parseMaybeNumber(r?.supplyApy);
      if (!Number.isFinite(apy)) continue;
      out.push({
        protocol: "Kamino",
        chain: "Solana",
        symbol,
        pool: `${String(m?.name ?? "Market")} / ${symbol}`,
        apy,
        key: `kamino:${marketPubkey}:${symbol}`,
      });
    }
  }
  return out;
}

async function resolveStableApyOverride(liveSetting) {
  if (!liveSetting || typeof liveSetting !== "object") return null;
  const key = String(liveSetting.key ?? "").trim();
  if (!key) return null;

  if (key === "rwa:onyc") {
    const row = await fetchRwaOnycApy();
    return {
      key,
      label: row.pool,
      apyPct: Number(row.apyPct),
    };
  }

  if (key.startsWith("kamino:")) {
    const rows = await fetchKaminoStableApys();
    const match = rows.find((row) => row.key === key);
    if (match) {
      return {
        key,
        label: match.pool,
        apyPct: Number(match.apy) * 100,
      };
    }
  }

  const apyPct = Number(liveSetting.apyPct);
  if (!Number.isFinite(apyPct)) return null;
  return {
    key,
    label: String(liveSetting.label ?? ""),
    apyPct,
  };
}

module.exports = {
  fetchKaminoStableApys,
  fetchRwaOnycApy,
  resolveStableApyOverride,
};
