const RWA_ONYC_URL = "https://app.rwa.xyz/assets/ONyc";

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

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const payload = await fetchRwaOnycApy();
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error?.message ?? "Failed to fetch ONyc APY from RWA.xyz",
    });
  }
};
