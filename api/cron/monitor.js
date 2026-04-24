const { readMonitorState, writeMonitorState } = require("../_lib/monitor-store");
const { resolveStableApyOverride } = require("../_lib/market-data");
const { sendTelegramMessage } = require("../_lib/telegram");

const YEAR_MS = 365.2425 * 24 * 60 * 60 * 1000;
const APY_DROP_ALERT_PCT_POINTS = 1;

function formatMoney(amount, { currency, decimals }) {
  const fixed = amount.toFixed(decimals);
  const parts = fixed.split(".");
  const intPart = parts[0];
  const frac = parts[1] ?? "";
  const sign = intPart.startsWith("-") ? "-" : "";
  const absInt = sign ? intPart.slice(1) : intPart;
  const grouped = absInt.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const symbol = currency === "EUR" ? "EUR " : currency === "GBP" ? "GBP " : currency === "RSD" ? "RSD " : "$";
  return `${sign}${symbol}${grouped}.${frac.padEnd(decimals, "0")}`;
}

function computeValueNow(platform, nowMs, liveApyPct) {
  const deposit = Number(platform.deposit ?? 0);
  const apyPct = Number.isFinite(liveApyPct) ? liveApyPct : Number(platform.apyPct ?? 0);
  const startMs = Number(platform.startMs ?? nowMs);
  const t = Math.max(0, nowMs - startMs);
  const apy = apyPct / 100;

  if (!Number.isFinite(deposit) || deposit < 0 || !Number.isFinite(apy)) return 0;
  if (!Number.isFinite(startMs)) return deposit;

  if (platform.model === "simple") {
    const years = t / YEAR_MS;
    return deposit * (1 + apy * years);
  }

  return deposit * Math.pow(1 + apy, t / YEAR_MS);
}

function formatUtcStamp(ms) {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss} UTC`;
}

function platformLabel(platform) {
  return platform.symbol ? `${platform.name} (${platform.symbol})` : platform.name;
}

function getEffectiveApyPct(platform, liveApyPct) {
  return Number.isFinite(liveApyPct) ? liveApyPct : Number(platform.apyPct ?? 0);
}

function normalizeLiveApySelection(liveApy) {
  if (!liveApy || typeof liveApy !== "object") return null;
  const key = String(liveApy.key ?? "").trim();
  const label = String(liveApy.label ?? "").trim();
  const apyPct = Number(liveApy.apyPct ?? NaN);
  if (!key || !Number.isFinite(apyPct)) return null;
  return { key, label, apyPct };
}

function buildInitialNotificationState(platforms, liveApyPct, totalEarned) {
  const lastApyByPlatform = {};
  for (const platform of platforms) {
    lastApyByPlatform[platform.id] = Number(getEffectiveApyPct(platform, liveApyPct));
  }
  return {
    initialized: true,
    lastTotalEarned: Number(totalEarned),
    lastApyByPlatform,
    lastRunAtMs: Date.now(),
    lastResult: "initialized",
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const cronSecret = process.env.CRON_SECRET ?? "";
  if (cronSecret) {
    const authHeader = req.headers.authorization ?? "";
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
  }

  try {
    const saved = await readMonitorState();
    if (!saved || !Array.isArray(saved.platforms) || saved.platforms.length === 0) {
      return res.status(200).json({ ok: true, skipped: "no platforms configured for monitoring" });
    }

    const liveApyCache = new Map();
    const resolvePlatformLiveApyPct = async (platform) => {
      const liveSetting = normalizeLiveApySelection(platform.liveApy) || normalizeLiveApySelection(saved.settings?.stableApyInUse);
      if (!liveSetting?.key) return NaN;
      if (liveApyCache.has(liveSetting.key)) return liveApyCache.get(liveSetting.key);
      try {
        const resolved = await resolveStableApyOverride(liveSetting);
        const apyPct = Number(resolved?.apyPct);
        liveApyCache.set(liveSetting.key, apyPct);
        return apyPct;
      } catch {
        const fallbackApyPct = Number(liveSetting.apyPct ?? NaN);
        liveApyCache.set(liveSetting.key, fallbackApyPct);
        return fallbackApyPct;
      }
    };

    const nowMs = Date.now();
    const currency = String(saved.settings?.currency ?? "USD");
    const decimals = Number.isFinite(Number(saved.settings?.decimals))
      ? Number(saved.settings.decimals)
      : 4;

    const effectiveApyByPlatformId = {};
    for (const platform of saved.platforms) {
      effectiveApyByPlatformId[platform.id] = await resolvePlatformLiveApyPct(platform);
    }

    const totalDeposit = saved.platforms.reduce((acc, p) => acc + (Number.isFinite(p.deposit) ? p.deposit : 0), 0);
    const totalValue = saved.platforms.reduce(
      (acc, p) => acc + computeValueNow(p, nowMs, effectiveApyByPlatformId[p.id]),
      0
    );
    const totalEarned = totalValue - totalDeposit;

    const previous = saved.notification && typeof saved.notification === "object"
      ? saved.notification
      : null;
    if (!previous || !previous.initialized) {
      saved.notification = buildInitialNotificationState(
        saved.platforms,
        null,
        totalEarned
      );
      for (const platform of saved.platforms) {
        saved.notification.lastApyByPlatform[platform.id] = Number(getEffectiveApyPct(platform, effectiveApyByPlatformId[platform.id]));
      }
      await writeMonitorState(saved);
      return res.status(200).json({
        ok: true,
        initialized: true,
        totalEarned,
      });
    }

    const messages = [];
    const safeTotal = formatMoney(totalEarned, { currency, decimals });
    const lastApyByPlatform = previous.lastApyByPlatform && typeof previous.lastApyByPlatform === "object"
      ? { ...previous.lastApyByPlatform }
      : {};
    const prevTotalEarned = Number(previous.lastTotalEarned);

    if (Number.isFinite(prevTotalEarned)) {
      const earnedLast24h = totalEarned - prevTotalEarned;
      const earnedText = formatMoney(earnedLast24h, { currency, decimals });
      messages.push(
        `💸 Money update: ${earnedText} earned in the last 24 hours. Still printing.\n` +
        `Total earned now: ${safeTotal}\n` +
        `Time: ${formatUtcStamp(nowMs)}`
      );
    }

    for (const platform of saved.platforms) {
      const currentApy = Number(getEffectiveApyPct(platform, effectiveApyByPlatformId[platform.id]));
      const prevApy = Number(lastApyByPlatform[platform.id]);
      if (Number.isFinite(prevApy) && Number.isFinite(currentApy)) {
        const drop = prevApy - currentApy;
        if (drop >= APY_DROP_ALERT_PCT_POINTS) {
          messages.push(
            `APY drop alert (${platformLabel(platform)})\nFrom ${prevApy.toFixed(2)}% to ${currentApy.toFixed(2)}% (-${drop.toFixed(2)} pp)\nTime: ${formatUtcStamp(nowMs)}`
          );
        }
      }
      lastApyByPlatform[platform.id] = currentApy;
    }

    for (const message of messages) {
      await sendTelegramMessage(message);
    }

    saved.notification = {
      initialized: true,
      lastTotalEarned: totalEarned,
      lastApyByPlatform,
      lastRunAtMs: nowMs,
      lastResult: messages.length ? `sent:${messages.length}` : "no-changes",
    };
    await writeMonitorState(saved);

    return res.status(200).json({
      ok: true,
      totalEarned,
      messagesSent: messages.length,
      liveApyPct: null,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message ?? "Cron monitor failed",
    });
  }
};
