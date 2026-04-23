const { readMonitorState, writeMonitorState } = require("../_lib/monitor-store");

function clampInt(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function normalizeState(input) {
  const next = input && typeof input === "object" ? input : {};
  const settings = next.settings && typeof next.settings === "object" ? next.settings : {};
  const platforms = Array.isArray(next.platforms) ? next.platforms : [];

  return {
    settings: {
      intervalMs: clampInt(Number(settings.intervalMs), 200, 60000),
      currency: typeof settings.currency === "string" ? settings.currency : "USD",
      decimals: clampInt(Number(settings.decimals), 0, 8),
      solanaRpcUrl:
        typeof settings.solanaRpcUrl === "string" && settings.solanaRpcUrl
          ? settings.solanaRpcUrl
          : "https://api.mainnet-beta.solana.com",
      stableApyInUse:
        settings.stableApyInUse && typeof settings.stableApyInUse === "object"
          ? {
              key: String(settings.stableApyInUse.key ?? ""),
              label: String(settings.stableApyInUse.label ?? ""),
              apyPct: Number(settings.stableApyInUse.apyPct ?? NaN),
            }
          : null,
    },
    platforms: platforms
      .filter((x) => x && typeof x === "object")
      .map((x) => ({
        id: typeof x.id === "string" ? x.id : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: String(x.name ?? "Unknown"),
        symbol: String(x.symbol ?? ""),
        deposit: Number(x.deposit ?? 0),
        apyPct: Number(x.apyPct ?? 0),
        model: x.model === "simple" ? "simple" : "effective",
        startMs: Number(x.startMs ?? Date.now()),
        source: x.source === "kamino" || x.source === "jupiter" ? x.source : "manual",
        wallet: typeof x.wallet === "string" ? x.wallet : "",
        externalId: typeof x.externalId === "string" ? x.externalId : "",
        apyLastFetchedMs: Number(x.apyLastFetchedMs ?? 0),
        apyTtlMs: Number(x.apyTtlMs ?? 60_000),
      })),
  };
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const state = await readMonitorState();
      return res.status(200).json({
        ok: true,
        configured: Boolean(state && Array.isArray(state.platforms) && state.platforms.length),
        updatedAtMs: Number(state?.updatedAtMs ?? 0),
        platformCount: Array.isArray(state?.platforms) ? state.platforms.length : 0,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error?.message ?? "Failed to read monitor state",
      });
    }
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const normalized = normalizeState(req.body);
    const next = {
      version: 1,
      updatedAtMs: Date.now(),
      settings: normalized.settings,
      platforms: normalized.platforms,
      notification: {
        initialized: false,
        lastEarnedWholeDollar: 0,
        lastApyByPlatform: {},
        lastRunAtMs: 0,
        lastResult: "reset",
      },
    };
    await writeMonitorState(next);
    return res.status(200).json({
      ok: true,
      updatedAtMs: next.updatedAtMs,
      platformCount: next.platforms.length,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message ?? "Failed to write monitor state",
    });
  }
};
