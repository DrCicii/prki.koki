const STORAGE_KEY = "defi_apy_tracker_v1";

const YEAR_MS = 365.2425 * 24 * 60 * 60 * 1000;

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function clampInt(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function parseDecimal(input) {
  if (typeof input !== "string") return NaN;
  const s = input.trim().replace(",", ".");
  if (!s) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function toDatetimeLocalValue(ms) {
  const d = new Date(ms);
  const pad = (x) => String(x).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function fromDatetimeLocalValue(value) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

function formatMoney(amount, { currency, decimals }) {
  const fixed = amount.toFixed(decimals);
  const parts = fixed.split(".");
  const intPart = parts[0];
  const frac = parts[1] ?? "";
  const sign = intPart.startsWith("-") ? "-" : "";
  const absInt = sign ? intPart.slice(1) : intPart;
  const grouped = absInt.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const symbol = currency === "EUR" ? "€" : currency === "GBP" ? "£" : currency === "RSD" ? "RSD " : "$";
  return `${sign}${symbol}${grouped}.${frac.padEnd(decimals, "0")}`;
}

function computeValueNow({ deposit, apyPct, model, startMs }, nowMs) {
  const t = Math.max(0, nowMs - startMs);
  const apy = apyPct / 100;

  if (!Number.isFinite(deposit) || !Number.isFinite(apy) || deposit < 0) return 0;
  if (!Number.isFinite(startMs)) return deposit;

  if (model === "simple") {
    const years = t / YEAR_MS;
    return deposit * (1 + apy * years);
  }

  // "effective" APY: deposit grows by (1+apy) over 1 year
  // value(t) = deposit * (1+apy)^(t / 1year)
  return deposit * Math.pow(1 + apy, t / YEAR_MS);
}

function defaultState() {
  return {
    settings: {
      intervalMs: 3000,
      currency: "USD",
      decimals: 4,
      solanaRpcUrl: "https://api.mainnet-beta.solana.com",
      stableApyInUse: null,
    },
    platforms: [],
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaultState();
    const s = parsed.settings ?? {};
    const p = Array.isArray(parsed.platforms) ? parsed.platforms : [];
    return {
      settings: {
        intervalMs: clampInt(Number(s.intervalMs), 200, 60000),
        currency: typeof s.currency === "string" ? s.currency : "USD",
        decimals: clampInt(Number(s.decimals), 0, 8),
        solanaRpcUrl:
          typeof s.solanaRpcUrl === "string" && s.solanaRpcUrl
            ? s.solanaRpcUrl
            : "https://api.mainnet-beta.solana.com",
        stableApyInUse:
          s.stableApyInUse && typeof s.stableApyInUse === "object"
            ? {
                key: String(s.stableApyInUse.key ?? ""),
                label: String(s.stableApyInUse.label ?? ""),
                apyPct: Number(s.stableApyInUse.apyPct ?? NaN),
              }
            : null,
      },
      platforms: p
        .filter((x) => x && typeof x === "object")
        .map((x) => ({
          id: typeof x.id === "string" ? x.id : uid(),
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
          liveApy:
            x.liveApy && typeof x.liveApy === "object"
              ? {
                  key: String(x.liveApy.key ?? ""),
                  label: String(x.liveApy.label ?? ""),
                  apyPct: Number(x.liveApy.apyPct ?? NaN),
                }
              : null,
        })),
    };
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  scheduleMonitorStateSync();
}

const $ = (id) => document.getElementById(id);

const els = {
  rows: $("rows"),
  totalDeposit: $("totalDeposit"),
  totalEarned: $("totalEarned"),
  totalEarnedPerSecond: $("totalEarnedPerSecond"),
  totalEarned1d: $("totalEarned1d"),
  totalEarned7d: $("totalEarned7d"),
  totalEarned30d: $("totalEarned30d"),
  timeToDollar: $("timeToDollar"),
  chipDayBaseline: $("chipDayBaseline"),
  chipWeekBaseline: $("chipWeekBaseline"),
  totalValue: $("totalValue"),
  earningsChart: $("earningsChart"),
  earningsChartEmpty: $("earningsChartEmpty"),
  earningsChartScrub: $("earningsChartScrub"),
  earningsChartScrubDate: $("earningsChartScrubDate"),
  earningsChartScrubValue: $("earningsChartScrubValue"),
  btnRange7d: $("btnRange7d"),
  btnRange30d: $("btnRange30d"),
  btnRangeAll: $("btnRangeAll"),
  hintInterval: $("hintInterval"),
  clockSkew: $("clockSkew"),

  formAdd: $("formAdd"),
  inName: $("inName"),
  inSymbol: $("inSymbol"),
  inDeposit: $("inDeposit"),
  inApy: $("inApy"),
  inStart: $("inStart"),
  inModel: $("inModel"),
  btnAddExample: $("btnAddExample"),

  tabDashboard: $("tabDashboard"),
  tabApyBoard: $("tabApyBoard"),
  viewDashboard: $("viewDashboard"),
  viewApyBoard: $("viewApyBoard"),

  btnTestTelegram: $("btnTestTelegram"),
  btnStopLiveApy: $("btnStopLiveApy"),
  btnRefreshStableApy: $("btnRefreshStableApy"),
  stableApyRows: $("stableApyRows"),
  stableApyLastUpdated: $("stableApyLastUpdated"),

  inIntervalMs: $("inIntervalMs"),
  inCurrency: $("inCurrency"),
  inDecimals: $("inDecimals"),

  btnReset: $("btnReset"),
  btnExport: $("btnExport"),
  fileImport: $("fileImport"),

  dlgEdit: $("dlgEdit"),
  editName: $("editName"),
  editSymbol: $("editSymbol"),
  editDeposit: $("editDeposit"),
  editApy: $("editApy"),
  editStart: $("editStart"),
  editModel: $("editModel"),
  btnSaveEdit: $("btnSaveEdit"),
};

let state = loadState();
let timer = null;
let editingId = null;
let syncing = false;
let stableApyRefreshTimer = null;
let monitorSyncTimer = null;
let earnedAnimationFrame = null;
let chartSeriesCache = [];
let chartScrubIndex = null;
let chartRange = "all"; // "7d" | "30d" | "all"
const pendingManualApyResetIds = new Set();
let selectedLiveApyForAdd = null;
let selectedLiveApyForEdit = null;

const KAMINO_API = "https://api.kamino.finance";
const JUP_LEND_API = "https://api.jup.ag/lend/v1";
const JUP_TOKEN_API = "https://api.jup.ag/tokens/v2";
const TELEGRAM_NOTIFY_API = "/api/telegram/notify";
const RWA_ONYC_APY_API = "/api/rwa/onyc-apy";
const MONITOR_STATE_API = "/api/monitor/state";
const STABLE_REFRESH_MS = 7 * 60 * 1000;
const APY_DROP_ALERT_PCT_POINTS = 1;
const ENABLE_BROWSER_NOTIFICATIONS = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const ENABLE_SERVER_MONITOR_SYNC = !ENABLE_BROWSER_NOTIFICATIONS;
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

let solanaWeb3Promise = null;
let jupLendReadPromise = null;
let jupClientCache = null; // { rpcUrl, client }
const tokenPriceCache = new Map(); // mint -> { usdPrice, fetchedMs }
const apyRefreshInFlight = new Set(); // external keys currently refreshing
const notificationState = {
  initialized: false,
  lastEarnedWholeDollar: 0,
  lastApyByPlatform: new Map(), // platform id -> effective APY %
  inFlight: false,
};
const earnedCounterState = {
  displayedValue: null,
  lastFormatted: "",
  lastRateText: "",
  rollingFramePending: false,
};

function computeTotalsSnapshot(nowMs) {
  const totalDeposit = state.platforms.reduce((acc, p) => acc + (Number.isFinite(p.deposit) ? p.deposit : 0), 0);
  const totalValue = state.platforms.reduce(
    (acc, p) => acc + computeValueNow({ ...p, apyPct: getEffectiveApyPct(p) }, nowMs),
    0
  );
  return {
    totalDeposit,
    totalValue,
    totalEarned: totalValue - totalDeposit,
  };
}

function computeTotalEarnRatePerSecond(nowMs) {
  const totalPerYear = state.platforms.reduce((acc, p) => acc + computeEarnRatePerYear(p, nowMs), 0);
  return totalPerYear / (365.2425 * 24 * 60 * 60);
}

function normalizeLiveApySelection(liveApy) {
  if (!liveApy || typeof liveApy !== "object") return null;
  const key = String(liveApy.key ?? "").trim();
  const label = String(liveApy.label ?? "").trim();
  const apyPct = Number(liveApy.apyPct ?? NaN);
  if (!key || !Number.isFinite(apyPct)) return null;
  return { key, label, apyPct };
}

function getPlatformLiveApy(platform) {
  return normalizeLiveApySelection(platform?.liveApy);
}

function getCurrentLiveApySelection() {
  return editingId ? selectedLiveApyForEdit : selectedLiveApyForAdd;
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

async function sendTelegramNotification(text) {
  if (!text) return;
  try {
    await fetchJson(TELEGRAM_NOTIFY_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    // Notifications are optional; never break the UI loop on alert errors.
  }
}

function normalizeStateSnapshot(input) {
  const parsed = input && typeof input === "object" ? input : {};
  const s = parsed.settings ?? {};
  const p = Array.isArray(parsed.platforms) ? parsed.platforms : [];
  return {
    settings: {
      intervalMs: clampInt(Number(s.intervalMs), 200, 60000),
      currency: typeof s.currency === "string" ? s.currency : "USD",
      decimals: clampInt(Number(s.decimals), 0, 8),
      solanaRpcUrl:
        typeof s.solanaRpcUrl === "string" && s.solanaRpcUrl
          ? s.solanaRpcUrl
          : "https://api.mainnet-beta.solana.com",
      stableApyInUse:
        s.stableApyInUse && typeof s.stableApyInUse === "object"
          ? {
              key: String(s.stableApyInUse.key ?? ""),
              label: String(s.stableApyInUse.label ?? ""),
              apyPct: Number(s.stableApyInUse.apyPct ?? NaN),
            }
          : null,
    },
    platforms: p
      .filter((x) => x && typeof x === "object")
      .map((x) => ({
        id: typeof x.id === "string" ? x.id : uid(),
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

async function sendTestTelegramNotification() {
  const stamp = new Date().toLocaleString();
  const message =
    `Test notification from DeFi APY Tracker\n` +
    `Status: Telegram integration is working.\n` +
    `Sent: ${stamp}`;

  await fetchJson(TELEGRAM_NOTIFY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });
}

async function processNotificationTriggers(nowMs) {
  if (notificationState.inFlight) return;
  notificationState.inFlight = true;
  try {
    const { currency, decimals } = state.settings;
    const { totalEarned } = computeTotalsSnapshot(nowMs);
    const currentWhole = Math.floor(totalEarned);
    const currentPlatformIds = new Set(state.platforms.map((p) => p.id));

    if (!notificationState.initialized) {
      notificationState.initialized = true;
      notificationState.lastEarnedWholeDollar = currentWhole;
      notificationState.lastApyByPlatform = new Map(
        state.platforms.map((p) => [p.id, Number(getEffectiveApyPct(p))])
      );
      return;
    }

    if (currentWhole > notificationState.lastEarnedWholeDollar) {
      const safeTotal = formatMoney(totalEarned, { currency, decimals });
      for (let earnedInt = notificationState.lastEarnedWholeDollar + 1; earnedInt <= currentWhole; earnedInt += 1) {
        await sendTelegramNotification(
          `💸 Earned milestone reached: +$${earnedInt}\nTotal earned now: ${safeTotal}\nTime: ${formatUtcStamp(nowMs)}`
        );
      }
      notificationState.lastEarnedWholeDollar = currentWhole;
    } else if (currentWhole < notificationState.lastEarnedWholeDollar) {
      notificationState.lastEarnedWholeDollar = currentWhole;
    }

    for (const [platformId] of notificationState.lastApyByPlatform) {
      if (!currentPlatformIds.has(platformId)) notificationState.lastApyByPlatform.delete(platformId);
    }
    for (const p of state.platforms) {
      const currentApy = Number(getEffectiveApyPct(p));
      const prevApy = notificationState.lastApyByPlatform.get(p.id);
      if (Number.isFinite(prevApy) && Number.isFinite(currentApy)) {
        const drop = prevApy - currentApy;
        if (drop >= APY_DROP_ALERT_PCT_POINTS) {
          await sendTelegramNotification(
            `⚠️ APY drop alert (${platformLabel(p)})\nFrom ${prevApy.toFixed(2)}% to ${currentApy.toFixed(2)}% (-${drop.toFixed(2)} pp)\nTime: ${formatUtcStamp(nowMs)}`
          );
        }
      }
      notificationState.lastApyByPlatform.set(p.id, currentApy);
    }
  } finally {
    notificationState.inFlight = false;
  }
}

function setIntervalMs(ms) {
  const next = clampInt(ms, 200, 60000);
  state.settings.intervalMs = next;
  saveState(state);
  els.inIntervalMs.value = String(next);
  els.hintInterval.textContent = String(Math.max(0.2, next / 1000).toFixed(next < 1000 ? 1 : 0));
  if (timer) clearInterval(timer);
  timer = setInterval(tick, next);
  tick();
}

function setCurrency(currency) {
  state.settings.currency = currency;
  saveState(state);
  tick();
}

function setDecimals(decimals) {
  state.settings.decimals = clampInt(decimals, 0, 8);
  saveState(state);
  earnedCounterState.lastFormatted = "";
  earnedCounterState.lastRateText = "";
  tick();
}

function renderAnimatedEarnedCounter(displayedValue, ratePerSecond, { force = false } = {}) {
  if (!els.totalEarned) return;
  const { currency, decimals } = state.settings;
  const formatted = formatMoney(displayedValue, { currency, decimals });
  const previous = earnedCounterState.lastFormatted || formatted;
  const shouldRender = force || formatted !== earnedCounterState.lastFormatted;

  if (shouldRender) {
    const nextChars = [...formatted];
    const prevChars = [...previous];
    const html = nextChars
      .map((char, index) => {
        const prevChar = prevChars[index] ?? "";
        const changed = prevChar !== char;
        const isDigitish = /[0-9]/.test(char) || /[0-9]/.test(prevChar);
        const tight = /[.,]/.test(char) || char === " ";
        const classes = [
          "moneyChar",
          tight ? "moneyChar--tight" : "",
          changed ? "moneyChar--changed" : "",
          changed && isDigitish ? "moneyChar--roll" : "",
        ]
          .filter(Boolean)
          .join(" ");

        if (!changed || !isDigitish) {
          return `<span class="${classes}"><span class="moneyChar__plain">${escapeHtml(char)}</span></span>`;
        }

        return `
          <span class="${classes}" data-next-char="${escapeHtml(char)}">
            <span class="moneyChar__stack">
              <span class="moneyChar__face">${escapeHtml(prevChar || char)}</span>
              <span class="moneyChar__face">${escapeHtml(char)}</span>
            </span>
          </span>
        `;
      })
      .join("");

    els.totalEarned.innerHTML = `<span class="moneyCounter" aria-label="${escapeHtml(formatted)}">${html}</span>`;
    earnedCounterState.lastFormatted = formatted;

    if (!earnedCounterState.rollingFramePending) {
      earnedCounterState.rollingFramePending = true;
      requestAnimationFrame(() => {
        earnedCounterState.rollingFramePending = false;
        els.totalEarned
          ?.querySelectorAll?.(".moneyChar--roll")
          ?.forEach?.((node) => {
            node.classList.add("moneyChar--rolled");
            const stack = node.querySelector(".moneyChar__stack");
            if (!stack) return;
            let finished = false;
            const finalize = () => {
              if (finished) return;
              finished = true;
              const nextChar = node.getAttribute("data-next-char") ?? "";
              node.classList.remove("moneyChar--roll", "moneyChar--rolled");
              node.removeAttribute("data-next-char");
              node.innerHTML = `<span class="moneyChar__plain">${escapeHtml(nextChar)}</span>`;
            };
            stack.addEventListener("transitionend", finalize, { once: true });
            setTimeout(finalize, 560);
          });
      });
    }
  }

  if (els.totalEarnedPerSecond) {
    const rateText = `${ratePerSecond >= 0 ? "+" : "-"}${formatMoney(Math.abs(ratePerSecond), {
      currency,
      decimals: Math.max(decimals, 4),
    })} / sec`;
    if (force || rateText !== earnedCounterState.lastRateText) {
      els.totalEarnedPerSecond.textContent = rateText;
      earnedCounterState.lastRateText = rateText;
    }
  }
}

function animateEarnedCounter() {
  const nowMs = Date.now();
  const { totalEarned } = computeTotalsSnapshot(nowMs);
  const ratePerSecond = computeTotalEarnRatePerSecond(nowMs);

  if (!Number.isFinite(earnedCounterState.displayedValue)) {
    earnedCounterState.displayedValue = totalEarned;
  } else {
    const delta = totalEarned - earnedCounterState.displayedValue;
    const smoothing = Math.min(0.28, Math.max(0.1, state.settings.intervalMs / 16000));
    earnedCounterState.displayedValue += delta * smoothing;
    if (Math.abs(delta) < 1e-7) earnedCounterState.displayedValue = totalEarned;
  }

  renderAnimatedEarnedCounter(earnedCounterState.displayedValue, ratePerSecond);
  earnedAnimationFrame = requestAnimationFrame(animateEarnedCounter);
}

function renderTable(nowMs) {
  const { currency, decimals } = state.settings;

  const rows = state.platforms
    .map((p) => {
      const effectiveApyPct = getEffectiveApyPct(p);
      const valueNow = computeValueNow({ ...p, apyPct: effectiveApyPct }, nowMs);
      const earned = valueNow - p.deposit;
      const label = p.symbol ? `${p.name} · ${p.symbol}` : p.name;
      const apyStr = `${effectiveApyPct.toFixed(2)}%`;
      const startStr = new Date(p.startMs).toLocaleString();
      const modelBadge = p.model === "simple" ? "Simple" : "APY";
      const platformLiveApy = getPlatformLiveApy(p);
        const liveBadge = platformLiveApy ? `<span class="pill" style="margin-left:8px">LIVE ${escapeHtml(platformLiveApy.label || "APY")}</span>` : "";
      const sourceBadge =
        p.source && p.source !== "manual"
          ? `<span class="pill" style="margin-left:8px">${escapeHtml(p.source)}</span>`
          : "";

      return `
        <tr data-id="${p.id}">
          <td>
            <span class="pill"><span class="pill__dot"></span>${escapeHtml(label)}</span>
          </td>
          <td>${escapeHtml(formatMoney(p.deposit, { currency, decimals }))}</td>
          <td>${escapeHtml(apyStr)} <span class="pill" style="margin-left:8px">${escapeHtml(modelBadge)}</span>${liveBadge}${sourceBadge}</td>
          <td><strong>${escapeHtml(formatMoney(earned, { currency, decimals }))}</strong></td>
          <td>${escapeHtml(formatMoney(valueNow, { currency, decimals }))}</td>
          <td>${escapeHtml(startStr)}</td>
          <td>
            <div class="rowActions">
              <button class="linkBtn" data-action="edit" type="button">Edit</button>
              <button class="linkBtn linkBtn--danger" data-action="delete" type="button">Delete</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  els.rows.innerHTML = rows || `<tr><td colspan="7" style="color:rgba(233,236,255,.55);padding:18px">No platforms yet. Add one above.</td></tr>`;
}

function renderTotals(nowMs) {
  const { currency, decimals } = state.settings;
  const totalDeposit = state.platforms.reduce((acc, p) => acc + (Number.isFinite(p.deposit) ? p.deposit : 0), 0);
  const totalValue = state.platforms.reduce(
    (acc, p) => acc + computeValueNow({ ...p, apyPct: getEffectiveApyPct(p) }, nowMs),
    0
  );
  const totalEarned = totalValue - totalDeposit;

  els.totalDeposit.textContent = formatMoney(totalDeposit, { currency, decimals });
  els.totalValue.textContent = formatMoney(totalValue, { currency, decimals });
  renderAnimatedEarnedCounter(
    Number.isFinite(earnedCounterState.displayedValue) ? earnedCounterState.displayedValue : totalEarned,
    computeTotalEarnRatePerSecond(nowMs),
    { force: !earnedCounterState.lastFormatted }
  );
  const daily = totalEarned - computeTotalEarnedAt(nowMs - 24 * 60 * 60 * 1000);
  const weekly = totalEarned - computeTotalEarnedAt(nowMs - 7 * 24 * 60 * 60 * 1000);
  const monthly = totalEarned - computeTotalEarnedAt(nowMs - 30 * 24 * 60 * 60 * 1000);
  if (els.totalEarned1d) els.totalEarned1d.textContent = formatMoney(daily, { currency, decimals });
  if (els.totalEarned7d) els.totalEarned7d.textContent = formatMoney(weekly, { currency, decimals });
  if (els.totalEarned30d) els.totalEarned30d.textContent = formatMoney(monthly, { currency, decimals });
  renderTimeToDollar(nowMs, totalEarned);
  renderBaselineChips(nowMs);
}

function computeEarnRatePerYear(platform, nowMs) {
  const deposit = Number(platform.deposit);
  const apy = Number(getEffectiveApyPct(platform)) / 100;
  if (!Number.isFinite(deposit) || deposit < 0 || !Number.isFinite(apy)) return 0;
  if (platform.model === "simple") {
    return deposit * apy;
  }
  const valueNow = computeValueNow({ ...platform, apyPct: apy * 100 }, nowMs);
  return valueNow * Math.log(1 + apy);
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "--:--:--";
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function renderTimeToDollar(nowMs, totalEarned) {
  if (!els.timeToDollar) return;
  const totalPerYear = state.platforms.reduce((acc, p) => acc + computeEarnRatePerYear(p, nowMs), 0);
  const perMs = totalPerYear / YEAR_MS;
  if (!Number.isFinite(perMs) || perMs <= 0) {
    els.timeToDollar.textContent = "--:--:--";
    return;
  }
  const nextWhole = Math.floor(totalEarned) + 1;
  const remaining = Math.max(0, nextWhole - totalEarned);
  const msLeft = remaining / perMs;
  els.timeToDollar.textContent = formatDuration(msLeft);
}

function formatDeltaPct(deltaPct) {
  if (!Number.isFinite(deltaPct)) return "n/a";
  return `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%`;
}

function setBaselineChip(el, label, current, previous, currency, decimals) {
  if (!el) return;
  el.classList.remove("baselineChip--up", "baselineChip--down");
  const deltaAbs = current - previous;
  const deltaPct = Math.abs(previous) < 1e-9 ? (current === 0 ? 0 : 100) : (deltaAbs / Math.abs(previous)) * 100;
  const arrow = deltaAbs >= 0 ? "▲" : "▼";
  const trendCls = deltaAbs >= 0 ? "baselineChip--up" : "baselineChip--down";
  el.classList.add(trendCls);
  const absFormatted = formatMoney(Math.abs(deltaAbs), { currency, decimals });
  const absPart = `${deltaAbs >= 0 ? "+" : "-"}${absFormatted}`;
  el.textContent = `${label}: ${arrow} ${formatDeltaPct(deltaPct)} (${absPart})`;
}

function renderBaselineChips(nowMs) {
  const { currency, decimals } = state.settings;
  const currentDay = computeTotalEarnedAt(nowMs) - computeTotalEarnedAt(nowMs - 24 * 60 * 60 * 1000);
  const prevDay =
    computeTotalEarnedAt(nowMs - 24 * 60 * 60 * 1000) -
    computeTotalEarnedAt(nowMs - 2 * 24 * 60 * 60 * 1000);
  const currentWeek = computeTotalEarnedAt(nowMs) - computeTotalEarnedAt(nowMs - 7 * 24 * 60 * 60 * 1000);
  const prevWeek =
    computeTotalEarnedAt(nowMs - 7 * 24 * 60 * 60 * 1000) -
    computeTotalEarnedAt(nowMs - 14 * 24 * 60 * 60 * 1000);
  setBaselineChip(els.chipDayBaseline, "Today vs yesterday", currentDay, prevDay, currency, decimals);
  setBaselineChip(els.chipWeekBaseline, "This week vs last week", currentWeek, prevWeek, currency, decimals);
}

function computeTotalEarnedAt(atMs) {
  const totalDeposit = state.platforms.reduce((acc, p) => acc + (Number.isFinite(p.deposit) ? p.deposit : 0), 0);
  const totalValue = state.platforms.reduce(
    (acc, p) => acc + computeValueNow({ ...p, apyPct: getEffectiveApyPct(p) }, atMs),
    0
  );
  return totalValue - totalDeposit;
}

function buildEarningsSeries(nowMs) {
  if (!state.platforms.length) return [];
  const validStarts = state.platforms
    .map((p) => Number(p.startMs))
    .filter((x) => Number.isFinite(x) && x > 0);
  const earliest = validStarts.length ? Math.min(...validStarts) : nowMs;
  let rangeStartMs = earliest;
  if (chartRange === "7d") rangeStartMs = nowMs - 7 * 24 * 60 * 60 * 1000;
  if (chartRange === "30d") rangeStartMs = nowMs - 30 * 24 * 60 * 60 * 1000;
  const startMs = Math.min(nowMs, Math.max(earliest, rangeStartMs));
  const span = Math.max(1, nowMs - startMs);
  const pointCount = 80;
  const step = span / (pointCount - 1);
  const points = [];
  for (let i = 0; i < pointCount; i += 1) {
    const t = i === pointCount - 1 ? nowMs : startMs + step * i;
    points.push({ t, v: computeTotalEarnedAt(t) });
  }
  return points;
}

function renderEarningsChart(nowMs) {
  const canvas = els.earningsChart;
  if (!canvas) return;
  if (typeof canvas.getContext !== "function") return;
  const points = buildEarningsSeries(nowMs);
  chartSeriesCache = points;
  const hasData = points.length > 1;
  if (els.earningsChartEmpty) {
    els.earningsChartEmpty.style.display = hasData ? "none" : "";
  }

  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.round(rect.width || canvas.clientWidth || 320));
  const height = Math.max(220, Math.round(rect.height || canvas.clientHeight || 220));
  const dpr = window.devicePixelRatio || 1;
  const pWidth = Math.round(width * dpr);
  const pHeight = Math.round(height * dpr);
  if (canvas.width !== pWidth || canvas.height !== pHeight) {
    canvas.width = pWidth;
    canvas.height = pHeight;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  if (typeof ctx.setTransform !== "function") return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const gradientBg = ctx.createLinearGradient(0, 0, 0, height);
  gradientBg.addColorStop(0, "rgba(59,130,246,0.08)");
  gradientBg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradientBg;
  ctx.fillRect(0, 0, width, height);

  if (!hasData) return;

  const pad = { top: 20, right: 16, bottom: 24, left: 16 };
  const chartW = Math.max(1, width - pad.left - pad.right);
  const chartH = Math.max(1, height - pad.top - pad.bottom);
  const minV = Math.min(...points.map((p) => p.v), 0);
  const maxV = Math.max(...points.map((p) => p.v), 0);
  const rangeV = Math.max(1e-9, maxV - minV);

  const toX = (i) => pad.left + (i / (points.length - 1)) * chartW;
  const toY = (v) => pad.top + ((maxV - v) / rangeV) * chartH;

  ctx.strokeStyle = "rgba(120,200,255,0.18)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i += 1) {
    const y = pad.top + (chartH / 3) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  const yZero = toY(0);
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.moveTo(pad.left, yZero);
  ctx.lineTo(width - pad.right, yZero);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(toX(0), toY(points[0].v));
  for (let i = 1; i < points.length; i += 1) {
    const prevX = toX(i - 1);
    const prevY = toY(points[i - 1].v);
    const x = toX(i);
    const y = toY(points[i].v);
    const cpX = (prevX + x) / 2;
    ctx.quadraticCurveTo(cpX, prevY, x, y);
  }

  ctx.save();
  const areaGradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
  areaGradient.addColorStop(0, "rgba(59,130,246,0.26)");
  areaGradient.addColorStop(1, "rgba(34,211,238,0.03)");
  ctx.lineTo(width - pad.right, height - pad.bottom);
  ctx.lineTo(pad.left, height - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = areaGradient;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(toX(0), toY(points[0].v));
  for (let i = 1; i < points.length; i += 1) {
    const prevX = toX(i - 1);
    const prevY = toY(points[i - 1].v);
    const x = toX(i);
    const y = toY(points[i].v);
    const cpX = (prevX + x) / 2;
    ctx.quadraticCurveTo(cpX, prevY, x, y);
  }
  const stroke = ctx.createLinearGradient(pad.left, 0, width - pad.right, 0);
  stroke.addColorStop(0, "#3b82f6");
  stroke.addColorStop(1, "#22d3ee");
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2.25;
  ctx.shadowColor = "rgba(59,130,246,0.38)";
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.shadowBlur = 0;

  if (Number.isInteger(chartScrubIndex)) {
    const i = Math.max(0, Math.min(points.length - 1, chartScrubIndex));
    const px = toX(i);
    const py = toY(points[i].v);

    // Vertical guide line
    ctx.strokeStyle = "rgba(233,236,255,0.35)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(px, pad.top);
    ctx.lineTo(px, height - pad.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    // Outer glow ring
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(34,211,238,0.25)";
    ctx.fill();

    // Anchor dot
    ctx.beginPath();
    ctx.arc(px, py, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = "#22d3ee";
    ctx.fill();
    ctx.strokeStyle = "rgba(5,7,15,0.95)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Faint x-axis date label aligned with scrub line.
    const dateLabel = new Date(points[i].t).toLocaleDateString();
    ctx.font = "11px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
    const textW = ctx.measureText(dateLabel).width;
    const tx = Math.max(
      pad.left,
      Math.min(width - pad.right - textW, px - textW / 2)
    );
    const ty = height - 7;
    ctx.fillStyle = "rgba(233,236,255,0.52)";
    ctx.fillText(dateLabel, tx, ty);
  }
}

function hideChartScrub() {
  if (!els.earningsChartScrub) return;
  els.earningsChartScrub.style.display = "none";
  if (chartScrubIndex !== null) {
    chartScrubIndex = null;
    renderEarningsChart(Date.now());
  }
}

function showChartScrub(clientX) {
  const canvas = els.earningsChart;
  const scrub = els.earningsChartScrub;
  if (!canvas || !scrub || chartSeriesCache.length < 2) return;

  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.round(rect.width || canvas.clientWidth || 320));
  const padLeft = 16;
  const padRight = 16;
  const chartW = Math.max(1, width - padLeft - padRight);
  const relX = Math.max(0, Math.min(chartW, clientX - rect.left - padLeft));
  const idx = Math.round((relX / chartW) * (chartSeriesCache.length - 1));
  const point = chartSeriesCache[Math.max(0, Math.min(chartSeriesCache.length - 1, idx))];
  if (!point) return;
  chartScrubIndex = Math.max(0, Math.min(chartSeriesCache.length - 1, idx));

  const { currency, decimals } = state.settings;
  if (els.earningsChartScrubDate) els.earningsChartScrubDate.textContent = new Date(point.t).toLocaleString();
  if (els.earningsChartScrubValue) {
    els.earningsChartScrubValue.textContent = `Earned: ${formatMoney(point.v, { currency, decimals })}`;
  }

  const x = clientX - rect.left;
  const left = Math.max(8, Math.min(width - 168, x + 12));
  scrub.style.left = `${left}px`;
  scrub.style.top = "10px";
  scrub.style.display = "";
  renderEarningsChart(Date.now());
}

function setChartRange(nextRange) {
  chartRange = nextRange === "7d" || nextRange === "30d" ? nextRange : "all";
  chartScrubIndex = null;
  if (els.btnRange7d) els.btnRange7d.classList.toggle("chartRangeBtn--active", chartRange === "7d");
  if (els.btnRange30d) els.btnRange30d.classList.toggle("chartRangeBtn--active", chartRange === "30d");
  if (els.btnRangeAll) els.btnRangeAll.classList.toggle("chartRangeBtn--active", chartRange === "all");
  renderEarningsChart(Date.now());
}

function renderClockSkew(nowMs) {
  const maxFuture = state.platforms.reduce((m, p) => Math.max(m, p.startMs ?? 0), 0);
  const skew = maxFuture - nowMs;
  if (skew > 60_000) {
    els.clockSkew.textContent = "Some start times are in the future";
  } else {
    els.clockSkew.textContent = "";
  }
}

function getEffectiveApyPct(platform) {
  const live = getPlatformLiveApy(platform) || normalizeLiveApySelection(state.settings.stableApyInUse);
  if (live && Number.isFinite(Number(live.apyPct))) return Number(live.apyPct);
  return Number(platform.apyPct ?? 0);
}

function buildMonitorStatePayload() {
  return {
    settings: {
      intervalMs: state.settings.intervalMs,
      currency: state.settings.currency,
      decimals: state.settings.decimals,
      solanaRpcUrl: state.settings.solanaRpcUrl,
      stableApyInUse: state.settings.stableApyInUse
        ? {
            key: String(state.settings.stableApyInUse.key ?? ""),
            label: String(state.settings.stableApyInUse.label ?? ""),
            apyPct: Number(state.settings.stableApyInUse.apyPct ?? NaN),
          }
        : null,
    },
    platforms: state.platforms.map((platform) => ({
      id: platform.id,
      name: platform.name,
      symbol: platform.symbol,
      deposit: platform.deposit,
      apyPct: platform.apyPct,
      model: platform.model,
      startMs: platform.startMs,
      source: platform.source,
      wallet: platform.wallet,
      externalId: platform.externalId,
      apyLastFetchedMs: platform.apyLastFetchedMs,
      apyTtlMs: platform.apyTtlMs,
      liveApy: platform.liveApy
        ? {
            key: String(platform.liveApy.key ?? ""),
            label: String(platform.liveApy.label ?? ""),
            apyPct: Number(platform.liveApy.apyPct ?? NaN),
          }
        : null,
    })),
    syncMeta: {
      manualApyResetIds: Array.from(pendingManualApyResetIds),
    },
  };
}

async function syncMonitorStateNow() {
  if (!ENABLE_SERVER_MONITOR_SYNC) return;
  try {
    const payload = buildMonitorStatePayload();
    await fetchJson(MONITOR_STATE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    pendingManualApyResetIds.clear();
  } catch {
    // Server-side monitoring is optional in local/dev contexts.
  }
}

async function loadSharedStateFromServer() {
  if (!ENABLE_SERVER_MONITOR_SYNC) return false;
  try {
    const payload = await fetchJson(MONITOR_STATE_API);
    if (!payload?.configured) return false;
    state = normalizeStateSnapshot({
      settings: payload.settings,
      platforms: payload.platforms,
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function scheduleMonitorStateSync(delayMs = 1200) {
  if (!ENABLE_SERVER_MONITOR_SYNC) return;
  if (monitorSyncTimer) clearTimeout(monitorSyncTimer);
  monitorSyncTimer = setTimeout(() => {
    monitorSyncTimer = null;
    void syncMonitorStateNow();
  }, delayMs);
}

function tick() {
  const nowMs = Date.now();
  try {
    renderTotals(nowMs);
  } catch {
    // Keep core UI interactive even if totals rendering fails.
  }
  try {
    renderEarningsChart(nowMs);
  } catch {
    // Chart failures should never block tabs/forms/event bindings.
  }
  try {
    renderTable(nowMs);
  } catch {
    // Avoid breaking app interaction loop on table rendering errors.
  }
  try {
    renderClockSkew(nowMs);
  } catch {
    // Non-critical visual hint.
  }
  if (ENABLE_BROWSER_NOTIFICATIONS) {
    void processNotificationTriggers(nowMs);
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function addPlatform({ name, symbol, deposit, apyPct, startMs, model, liveApy = null }) {
  const p = {
    id: uid(),
    name,
    symbol,
    deposit,
    apyPct,
    startMs,
    model,
    source: "manual",
    wallet: "",
    externalId: "",
    apyLastFetchedMs: 0,
    apyTtlMs: 60_000,
    liveApy: normalizeLiveApySelection(liveApy),
  };
  state.platforms = [p, ...state.platforms];
  saveState(state);
  tick();
}

function upsertPlatformByExternalKey(externalKey, next) {
  const idx = state.platforms.findIndex((p) => `${p.source}:${p.wallet}:${p.externalId}` === externalKey);
  if (idx === -1) {
    state.platforms = [{ ...next, id: uid() }, ...state.platforms];
    return;
  }
  const prev = state.platforms[idx];
  state.platforms = state.platforms.map((p, i) => (i === idx ? { ...prev, ...next, id: prev.id } : p));
}

function isSolanaAddress(s) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(s ?? "").trim());
}

function setWalletStatus(text, kind = "neutral") {
  if (!els.walletStatus) return;
  els.walletStatus.classList.remove("status--ok", "status--warn");
  if (kind === "ok") els.walletStatus.classList.add("status--ok");
  if (kind === "warn") els.walletStatus.classList.add("status--warn");
  els.walletStatus.textContent = text;
}

function attachGlobalErrorHandlers() {
  window.addEventListener("error", (e) => {
    const msg = e?.error?.message || e?.message || "Unknown error";
    setWalletStatus(`Error: ${msg}`, "warn");
  });
  window.addEventListener("unhandledrejection", (e) => {
    const msg = e?.reason?.message || String(e?.reason ?? "Unknown rejection");
    setWalletStatus(`Error: ${msg}`, "warn");
  });
}

function parseMaybeNumber(x) {
  const n = Number(String(x ?? "").trim());
  return Number.isFinite(n) ? n : NaN;
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

async function ensureSolanaWeb3() {
  if (!solanaWeb3Promise) {
    solanaWeb3Promise = (async () => {
      const urls = [
        "https://esm.sh/@solana/web3.js@1.98.4?bundle",
        "https://cdn.jsdelivr.net/npm/@solana/web3.js@1.98.4/+esm",
        "https://unpkg.com/@solana/web3.js@1.98.4/lib/index.esm.js",
      ];
      let lastErr = null;
      for (const url of urls) {
        try {
          return await import(url);
        } catch (e) {
          lastErr = e;
        }
      }
      throw new Error(
        `Failed to load Solana web3.js from CDNs. Last error: ${lastErr?.message ?? String(lastErr)}`
      );
    })();
  }
  return await solanaWeb3Promise;
}

async function ensureJupLendRead() {
  if (!jupLendReadPromise) {
    jupLendReadPromise = (async () => {
      const urls = [
        "https://esm.sh/@jup-ag/lend-read@0.0.10?bundle",
        "https://cdn.jsdelivr.net/npm/@jup-ag/lend-read@0.0.10/+esm",
        "https://unpkg.com/@jup-ag/lend-read@0.0.10/dist/index.mjs",
      ];
      let lastErr = null;
      for (const url of urls) {
        try {
          return await import(url);
        } catch (e) {
          lastErr = e;
        }
      }
      throw new Error(
        `Failed to load Jupiter lend-read SDK from CDNs. Last error: ${lastErr?.message ?? String(lastErr)}`
      );
    })();
  }
  return await jupLendReadPromise;
}

async function getJupClient(rpcUrl) {
  const url = rpcUrl || state.settings.solanaRpcUrl || "https://api.mainnet-beta.solana.com";
  if (jupClientCache && jupClientCache.rpcUrl === url) return jupClientCache.client;

  const web3 = await ensureSolanaWeb3();
  const { Client } = await ensureJupLendRead();
  const connection = new web3.Connection(url, { commitment: "confirmed" });
  const client = new Client(connection);
  jupClientCache = { rpcUrl: url, client };
  return client;
}

function aprPctToApyPct(aprPct) {
  if (!Number.isFinite(aprPct)) return 0;
  const r = aprPct / 100;
  const apy = Math.pow(1 + r / 365, 365) - 1;
  return apy * 100;
}

async function fetchJupTokenPriceUsd(mint) {
  const cached = tokenPriceCache.get(mint);
  if (cached && Date.now() - cached.fetchedMs < 5 * 60_000) return cached.usdPrice;
  const url = `${JUP_TOKEN_API}/search?query=${encodeURIComponent(mint)}`;
  const arr = await fetchJson(url);
  if (!Array.isArray(arr) || arr.length === 0) return NaN;
  const usdPrice = parseMaybeNumber(arr[0]?.usdPrice);
  tokenPriceCache.set(mint, { usdPrice, fetchedMs: Date.now() });
  return usdPrice;
}

async function syncKaminoEarn(wallet) {
  const positionsUrl = `${KAMINO_API}/kvaults/users/${encodeURIComponent(wallet)}/positions`;
  const positions = await fetchJson(positionsUrl);
  if (!Array.isArray(positions)) return { count: 0 };

  let txs = [];
  try {
    txs = await fetchJson(`${KAMINO_API}/kvaults/users/${encodeURIComponent(wallet)}/transactions`);
  } catch {
    txs = [];
  }

  const earliestByVault = new Map();
  if (Array.isArray(txs)) {
    for (const t of txs) {
      const vault = t?.kvault ?? t?.vaultAddress ?? t?.vault ?? "";
      if (!vault) continue;
      const timeMs =
        Number.isFinite(Number(t?.timestampMs))
          ? Number(t.timestampMs)
          : Number.isFinite(Number(t?.timestamp))
            ? Number(t.timestamp) * (String(t.timestamp).length <= 10 ? 1000 : 1)
            : Number.isFinite(Number(t?.blockTime))
              ? Number(t.blockTime) * 1000
              : NaN;
      if (!Number.isFinite(timeMs)) continue;
      const prev = earliestByVault.get(vault);
      if (!prev || timeMs < prev) earliestByVault.set(vault, timeMs);
    }
  }

  const metricsCache = new Map();
  const getMetrics = async (vaultAddress) => {
    if (metricsCache.has(vaultAddress)) return metricsCache.get(vaultAddress);
    const m = await fetchJson(`${KAMINO_API}/kvaults/vaults/${encodeURIComponent(vaultAddress)}/metrics`);
    metricsCache.set(vaultAddress, m);
    return m;
  };

  const vaultCache = new Map();
  const getVault = async (vaultAddress) => {
    if (vaultCache.has(vaultAddress)) return vaultCache.get(vaultAddress);
    const v = await fetchJson(`${KAMINO_API}/kvaults/vaults/${encodeURIComponent(vaultAddress)}`);
    vaultCache.set(vaultAddress, v);
    return v;
  };

  let count = 0;
  for (const pos of positions) {
    const vaultAddress = String(pos?.vaultAddress ?? "");
    if (!vaultAddress) continue;

    const totalShares = parseMaybeNumber(pos?.totalShares);
    const stakedShares = parseMaybeNumber(pos?.stakedShares);
    const unstakedShares = parseMaybeNumber(pos?.unstakedShares);
    const shares = Number.isFinite(totalShares)
      ? totalShares
      : Number.isFinite(stakedShares) || Number.isFinite(unstakedShares)
        ? Number(stakedShares || 0) + Number(unstakedShares || 0)
        : NaN;

    const m = await getMetrics(vaultAddress);
    const apyDec = parseMaybeNumber(m?.apy);
    const apyPct = Number.isFinite(apyDec) ? apyDec * 100 : 0;

    const tokenPrice = parseMaybeNumber(m?.tokenPrice);
    const tokensPerShare = parseMaybeNumber(m?.tokensPerShare);
    const sharePrice = parseMaybeNumber(m?.sharePrice);

    let depositUsd = NaN;
    if (Number.isFinite(shares) && Number.isFinite(tokensPerShare) && Number.isFinite(tokenPrice)) {
      depositUsd = shares * tokensPerShare * tokenPrice;
    } else if (Number.isFinite(shares) && Number.isFinite(sharePrice) && Number.isFinite(tokenPrice)) {
      depositUsd = shares * sharePrice * tokenPrice;
    } else if (Number.isFinite(shares) && Number.isFinite(sharePrice)) {
      depositUsd = shares * sharePrice;
    }
    if (!Number.isFinite(depositUsd)) depositUsd = 0;

    const startMs = earliestByVault.get(vaultAddress) ?? Date.now();

    let tokenMint = "";
    try {
      const vault = await getVault(vaultAddress);
      tokenMint =
        String(
          vault?.state?.tokenMint ??
            vault?.state?.token_mint ??
            vault?.state?.token ??
            vault?.state?.tokenAddress ??
            ""
        ) || "";
    } catch {
      tokenMint = "";
    }

    let symbol = "KVault";
    if (tokenMint) {
      try {
        const arr = await fetchJson(`${JUP_TOKEN_API}/search?query=${encodeURIComponent(tokenMint)}`);
        const s = String(arr?.[0]?.symbol ?? "").trim();
        if (s) symbol = s;
      } catch {
        symbol = "KVault";
      }
    }

    const name = `Kamino Earn (${symbol})`;
    const externalKey = `kamino:${wallet}:${vaultAddress}`;
    upsertPlatformByExternalKey(externalKey, {
      name,
      symbol,
      deposit: depositUsd,
      apyPct,
      model: "effective",
      startMs,
      source: "kamino",
      wallet,
      externalId: vaultAddress,
      apyLastFetchedMs: Date.now(),
      apyTtlMs: 60_000,
    });
    count += 1;
  }

  return { count };
}

async function syncKaminoLend(wallet) {
  // This covers classic Lend as well as Multiply (which is built on KLend obligations).
  // We intentionally keep parsing defensive because the obligations endpoint schema is not published.
  const markets = await fetchJson(`${KAMINO_API}/v2/kamino-market`);
  const marketList = Array.isArray(markets) ? markets : [];

  // Map reservePubkey -> { symbol, supplyApy }
  const reserveApyByReserve = new Map();
  for (const m of marketList) {
    const marketPubkey = String(m?.lendingMarket ?? m?.lending_market ?? m?.market ?? "");
    if (!marketPubkey) continue;
    try {
      const metrics = await fetchJson(`${KAMINO_API}/kamino-market/${encodeURIComponent(marketPubkey)}/reserves/metrics`);
      if (!Array.isArray(metrics)) continue;
      for (const r of metrics) {
        const reserve = String(r?.reserve ?? r?.address ?? r?.reserveAddress ?? "");
        if (!reserve) continue;
        const sym = String(r?.symbol ?? r?.mintSymbol ?? "").trim();
        const supplyApy = parseMaybeNumber(r?.supplyApy);
        reserveApyByReserve.set(reserve, {
          symbol: sym || "Reserve",
          supplyApy: Number.isFinite(supplyApy) ? supplyApy : NaN, // decimal, e.g. 0.02
        });
      }
    } catch {
      // ignore market metrics failure
    }
  }

  let count = 0;
  for (const m of marketList) {
    const marketPubkey = String(m?.lendingMarket ?? m?.lending_market ?? m?.market ?? "");
    if (!marketPubkey) continue;

    let obligations = null;
    try {
      obligations = await fetchJson(
        `${KAMINO_API}/kamino-market/${encodeURIComponent(marketPubkey)}/users/${encodeURIComponent(wallet)}/obligations?env=mainnet-beta`
      );
    } catch {
      obligations = null;
    }

    const obs = Array.isArray(obligations) ? obligations : obligations?.obligations;
    if (!Array.isArray(obs)) continue;

    for (const ob of obs) {
      // Try to find deposits array in common shapes
      const deposits =
        ob?.deposits ??
        ob?.loanInfo?.collateral ??
        ob?.loanInfo?.collaterals ??
        ob?.collateral ??
        [];
      if (!Array.isArray(deposits) || deposits.length === 0) continue;

      for (const d of deposits) {
        const reserve =
          String(d?.depositReserve ?? d?.reserve ?? d?.reserveAddress ?? d?.reservePubkey ?? "").trim();
        if (!reserve) continue;

        const apyDec = reserveApyByReserve.get(reserve)?.supplyApy;
        const apyPct = Number.isFinite(apyDec) ? apyDec * 100 : 0;
        const symbol = reserveApyByReserve.get(reserve)?.symbol || "KLend";

        // Amount / USD value are not guaranteed to be present. Best-effort.
        const usd =
          parseMaybeNumber(d?.usdValue) ??
          parseMaybeNumber(d?.usd_value) ??
          parseMaybeNumber(d?.valueUsd) ??
          parseMaybeNumber(d?.value_usd) ??
          NaN;

        const depositUsd = Number.isFinite(usd) ? usd : 0;
        const name = `Kamino Lend/Multiply (${symbol})`;

        const externalId = `${marketPubkey}:${reserve}`;
        const externalKey = `kamino:${wallet}:${externalId}`;
        upsertPlatformByExternalKey(externalKey, {
          name,
          symbol,
          deposit: depositUsd,
          apyPct,
          model: "effective",
          startMs: Date.now(),
          source: "kamino",
          wallet,
          externalId,
          apyLastFetchedMs: Date.now(),
          apyTtlMs: 60_000,
        });
        count += 1;
      }
    }
  }

  return { count };
}

async function syncJupiterLendEarn(wallet, rpcUrl) {
  const positionsUrl = `${JUP_LEND_API}/earn/positions?users=${encodeURIComponent(wallet)}`;
  const positions = await fetchJson(positionsUrl);
  if (!Array.isArray(positions)) return { count: 0 };

  const client = await getJupClient(rpcUrl);
  const web3 = await ensureSolanaWeb3();

  const mints = Array.from(
    new Set(
      positions
        .map((p) => String(p?.token?.address ?? ""))
        .filter(Boolean)
    )
  );

  const overallByMint = new Map();
  if (mints.length) {
    try {
      const mintKeys = mints.map((m) => new web3.PublicKey(m));
      const datas = await client.liquidity.getOverallTokensData(mintKeys);
      if (Array.isArray(datas)) {
        for (let i = 0; i < mintKeys.length; i += 1) {
          overallByMint.set(mintKeys[i].toBase58(), datas[i]);
        }
      }
    } catch {
      // fallback to per-mint
    }
  }

  let count = 0;
  for (const pos of positions) {
    const mint = String(pos?.token?.address ?? "");
    if (!mint) continue;
    const symbol = String(pos?.token?.symbol ?? "").trim() || "Token";
    const decimals = Number(pos?.token?.decimals ?? 0);
    const ua = parseMaybeNumber(pos?.underlyingAssets);
    const depositedTokens = Number.isFinite(ua) ? ua / Math.pow(10, decimals) : 0;

    const usdPrice = await fetchJupTokenPriceUsd(mint);
    const depositUsd = Number.isFinite(usdPrice) ? depositedTokens * usdPrice : 0;

    let apyPct = 0;
    try {
      const data = overallByMint.get(mint) ?? (await client.liquidity.getOverallTokenData(new web3.PublicKey(mint)));
      const supplyAprPct = Number(data.supplyRate) / 100;
      apyPct = aprPctToApyPct(supplyAprPct);
    } catch {
      apyPct = 0;
    }

    const name = "Jupiter Lend Earn";
    const externalId = mint;
    const externalKey = `jupiter:${wallet}:${externalId}`;
    upsertPlatformByExternalKey(externalKey, {
      name,
      symbol,
      deposit: depositUsd,
      apyPct,
      model: "effective",
      startMs: Date.now(),
      source: "jupiter",
      wallet,
      externalId,
      apyLastFetchedMs: Date.now(),
      apyTtlMs: 60_000,
    });
    count += 1;
  }

  return { count };
}

async function syncWalletNow() {
  if (syncing) return;
  syncing = true;
  try {
    const wallet = String(els.inWallet?.value ?? "").trim();
    const rpcUrl = String(els.inRpcUrl?.value ?? "").trim() || state.settings.solanaRpcUrl;
    if (!isSolanaAddress(wallet)) {
      setWalletStatus("Invalid Solana address. Paste a base58 public key (32–44 chars).", "warn");
      return;
    }

    if (rpcUrl) {
      state.settings.solanaRpcUrl = rpcUrl;
      saveState(state);
    }

    setWalletStatus("Syncing…");
    const [kaminoEarn, kaminoLend, jup] = await Promise.allSettled([
      syncKaminoEarn(wallet),
      syncKaminoLend(wallet),
      syncJupiterLendEarn(wallet, rpcUrl),
    ]);

    let kaminoCount = 0;
    let jupCount = 0;
    const warnings = [];
    if (kaminoEarn.status === "fulfilled") kaminoCount += kaminoEarn.value.count;
    else warnings.push(`Kamino Earn: ${kaminoEarn.reason?.message ?? String(kaminoEarn.reason)}`);
    if (kaminoLend.status === "fulfilled") kaminoCount += kaminoLend.value.count;
    else warnings.push(`Kamino Lend/Multiply: ${kaminoLend.reason?.message ?? String(kaminoLend.reason)}`);
    if (jup.status === "fulfilled") jupCount = jup.value.count;
    else warnings.push(`Jupiter: ${jup.reason?.message ?? String(jup.reason)}`);

    saveState(state);
    tick();

    if (warnings.length) {
      setWalletStatus(`Synced with warnings. Kamino: ${kaminoCount}, Jupiter: ${jupCount}. ${warnings.join(" | ")}`, "warn");
    } else {
      setWalletStatus(`Sync complete. Kamino: ${kaminoCount}, Jupiter: ${jupCount}.`, "ok");
    }
  } catch (err) {
    setWalletStatus(`Sync failed: ${err?.message ?? String(err)}`, "warn");
  } finally {
    syncing = false;
  }
}

function clearWalletRows() {
  const wallet = String(els.inWallet?.value ?? "").trim();
  const before = state.platforms.length;
  state.platforms = state.platforms.filter((p) => p.source === "manual" || (wallet && p.wallet !== wallet));
  saveState(state);
  tick();
  const removed = before - state.platforms.length;
  setWalletStatus(`Cleared ${removed} synced rows${wallet ? ` for ${wallet}` : ""}.`, "ok");
}

function formatPctFromDecimalRate(decimalRate) {
  const n = Number(decimalRate);
  if (!Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(2)}%`;
}

function stableSymbolOf(text) {
  const s = String(text ?? "").trim().toUpperCase();
  return STABLE_SYMBOLS.has(s) ? s : "";
}

function renderStableApyRows(rows) {
  if (!els.stableApyRows) return;
  if (!Array.isArray(rows) || rows.length === 0) {
    els.stableApyRows.innerHTML =
      `<tr><td colspan="6" style="color:rgba(233,236,255,.55);padding:18px">No APY Board data available.</td></tr>`;
    return;
  }
  const sorted = [...rows].sort((a, b) => {
    const aPinned = String(a.key ?? "") === "rwa:onyc" ? 1 : 0;
    const bPinned = String(b.key ?? "") === "rwa:onyc" ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    const aMain = String(a.pool ?? "").toLowerCase().includes("main market") ? 1 : 0;
    const bMain = String(b.pool ?? "").toLowerCase().includes("main market") ? 1 : 0;
    if (aMain !== bMain) return bMain - aMain;
    return Number(b.apy ?? 0) - Number(a.apy ?? 0);
  });
  els.stableApyRows.innerHTML = sorted
    .map(
      (r) => `
        <tr>
          <td>${escapeHtml(r.protocol)}</td>
          <td>${escapeHtml(r.chain || "Solana")}</td>
          <td>${escapeHtml(r.symbol)}</td>
          <td>${escapeHtml(r.pool)}</td>
          <td><strong>${escapeHtml(formatPctFromDecimalRate(r.apy))}</strong></td>
          <td>
            ${
              Number.isFinite(Number(r.apy))
                ? `
            <button
              class="linkBtn"
              type="button"
              data-action="useStableApy"
              data-key="${escapeHtml(r.key)}"
              data-label="${escapeHtml(r.pool)}"
              data-apy-pct="${escapeHtml(String((Number(r.apy) * 100).toFixed(6)))}"
            >
              USE
            </button>`
                : `<span style="color:rgba(233,236,255,.55)">N/A</span>`
            }
          </td>
        </tr>
      `
    )
    .join("");
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

async function fetchRwaOnycApyRow() {
  try {
    const payload = await fetchJson(RWA_ONYC_APY_API);
    const apyPct = Number(payload?.apyPct);
    if (!Number.isFinite(apyPct)) {
      throw new Error("Missing ONyc APY in RWA.xyz response");
    }

    const apyWindow = String(payload?.apyWindow ?? "APY").trim() || "APY";
    return {
      protocol: "RWA.xyz",
      chain: String(payload?.chain ?? "Solana"),
      symbol: String(payload?.symbol ?? "ONyc"),
      pool: `${String(payload?.pool ?? "OnRe Tokenized Reinsurance")} / ${apyWindow} APY`,
      apy: apyPct / 100,
      key: "rwa:onyc",
    };
  } catch (error) {
    return {
      protocol: "RWA.xyz",
      chain: "Solana",
      symbol: "ONyc",
      pool: `OnRe Tokenized Reinsurance / unavailable (${error?.message ?? "fetch failed"})`,
      apy: NaN,
      key: "rwa:onyc",
    };
  }
}

async function refreshStableApyTable() {
  if (els.stableApyLastUpdated) els.stableApyLastUpdated.textContent = " Refreshing...";
  const [kaminoRes, onycRes] = await Promise.allSettled([fetchKaminoStableApys(), fetchRwaOnycApyRow()]);
  const rows = [];
  const warnings = [];
  if (kaminoRes.status === "fulfilled") rows.push(...kaminoRes.value);
  else warnings.push(`Kamino: ${kaminoRes.reason?.message ?? String(kaminoRes.reason)}`);
  if (onycRes.status === "fulfilled") {
    rows.push(onycRes.value);
    if (!Number.isFinite(Number(onycRes.value?.apy))) {
      warnings.push(`RWA.xyz ONyc: ${String(onycRes.value?.pool ?? "unavailable")}`);
    }
  } else {
    warnings.push(`RWA.xyz ONyc: ${onycRes.reason?.message ?? String(onycRes.reason)}`);
  }
  renderStableApyRows(rows);
  const rowsByKey = new Map(rows.map((row) => [row.key, row]));
  let changedAny = false;
  state.platforms = state.platforms.map((platform) => {
    const liveApy = getPlatformLiveApy(platform);
    if (!liveApy?.key) return platform;
    const match = rowsByKey.get(liveApy.key);
    if (!match || !Number.isFinite(Number(match.apy))) return platform;
    changedAny = true;
    return {
      ...platform,
      liveApy: {
        key: liveApy.key,
        label: match.pool,
        apyPct: Number(match.apy) * 100,
      },
    };
  });

  const activeSelection = getCurrentLiveApySelection();
  if (activeSelection?.key) {
    const match = rowsByKey.get(activeSelection.key);
    if (match && Number.isFinite(Number(match.apy))) {
      const nextSelection = {
        key: activeSelection.key,
        label: match.pool,
        apyPct: Number(match.apy) * 100,
      };
      if (editingId) {
        selectedLiveApyForEdit = nextSelection;
        if (els.editApy) els.editApy.value = nextSelection.apyPct.toFixed(4);
      } else {
        selectedLiveApyForAdd = nextSelection;
        if (els.inApy) els.inApy.value = nextSelection.apyPct.toFixed(4);
      }
    }
  }

  if (changedAny) {
    saveState(state);
    tick();
  }
  if (els.stableApyLastUpdated) {
    const stamp = new Date().toLocaleString();
    els.stableApyLastUpdated.textContent = warnings.length
      ? ` Last update ${stamp}. Warnings: ${warnings.join(" | ")}`
      : ` Last update ${stamp}.`;
  }
}

function startStableApyAutoRefresh() {
  if (stableApyRefreshTimer) clearInterval(stableApyRefreshTimer);
  stableApyRefreshTimer = setInterval(() => {
    // eslint-disable-next-line no-void
    void refreshStableApyTable();
  }, STABLE_REFRESH_MS);
}

async function refreshApyIfNeeded(nowMs) {
  // Fire-and-forget; keep UI responsive.
  const candidates = state.platforms.filter((p) => p.source !== "manual");
  if (candidates.length === 0) return;

  for (const p of candidates) {
    const ttl = Number.isFinite(p.apyTtlMs) ? p.apyTtlMs : 60_000;
    const last = Number.isFinite(p.apyLastFetchedMs) ? p.apyLastFetchedMs : 0;
    if (nowMs - last < ttl) continue;

    const key = `${p.source}:${p.wallet}:${p.externalId}`;
    if (apyRefreshInFlight.has(key)) continue;
    apyRefreshInFlight.add(key);

    // eslint-disable-next-line no-void
    void (async () => {
      try {
        if (p.source === "kamino") {
          const m = await fetchJson(`${KAMINO_API}/kvaults/vaults/${encodeURIComponent(p.externalId)}/metrics`);
          const apyDec = parseMaybeNumber(m?.apy);
          const apyPct = Number.isFinite(apyDec) ? apyDec * 100 : p.apyPct;
          updatePlatform(p.id, { apyPct, apyLastFetchedMs: Date.now() });
          return;
        }

        if (p.source === "jupiter") {
          const client = await getJupClient(state.settings.solanaRpcUrl);
          const web3 = await ensureSolanaWeb3();
          const data = await client.liquidity.getOverallTokenData(new web3.PublicKey(p.externalId));
          const supplyAprPct = Number(data.supplyRate) / 100;
          const apyPct = aprPctToApyPct(supplyAprPct);
          updatePlatform(p.id, { apyPct, apyLastFetchedMs: Date.now() });
        }
      } catch {
        // keep last known APY; we’ll retry next tick after TTL
      } finally {
        apyRefreshInFlight.delete(key);
      }
    })();
  }
}

function deletePlatform(id) {
  state.platforms = state.platforms.filter((p) => p.id !== id);
  pendingManualApyResetIds.delete(id);
  saveState(state);
  tick();
}

function updatePlatform(id, patch, options = {}) {
  state.platforms = state.platforms.map((p) => (p.id === id ? { ...p, ...patch } : p));
  if (options.resetApyComparison) {
    pendingManualApyResetIds.add(id);
  }
  saveState(state);
  tick();
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "defi-apy-tracker.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importJsonFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid JSON");

  // Merge gently: keep current settings unless the import has settings too.
  const next = defaultState();
  next.settings.intervalMs = clampInt(Number(parsed.settings?.intervalMs ?? state.settings.intervalMs), 200, 60000);
  next.settings.currency = String(parsed.settings?.currency ?? state.settings.currency);
  next.settings.decimals = clampInt(Number(parsed.settings?.decimals ?? state.settings.decimals), 0, 8);
  next.platforms = Array.isArray(parsed.platforms) ? parsed.platforms : [];

  state = {
    settings: next.settings,
    platforms: next.platforms
      .filter((x) => x && typeof x === "object")
      .map((x) => ({
        id: typeof x.id === "string" ? x.id : uid(),
        name: String(x.name ?? "Unknown"),
        symbol: String(x.symbol ?? ""),
        deposit: Number(x.deposit ?? 0),
        apyPct: Number(x.apyPct ?? 0),
        model: x.model === "simple" ? "simple" : "effective",
        startMs: Number(x.startMs ?? Date.now()),
        liveApy:
          x.liveApy && typeof x.liveApy === "object"
            ? {
                key: String(x.liveApy.key ?? ""),
                label: String(x.liveApy.label ?? ""),
                apyPct: Number(x.liveApy.apyPct ?? NaN),
              }
            : null,
      })),
  };

  saveState(state);
  bindSettingsToUi();
  setIntervalMs(state.settings.intervalMs);
  tick();
}

function bindSettingsToUi() {
  els.inIntervalMs.value = String(state.settings.intervalMs);
  els.inCurrency.value = state.settings.currency;
  els.inDecimals.value = String(state.settings.decimals);
  els.hintInterval.textContent = String(Math.max(0.2, state.settings.intervalMs / 1000).toFixed(state.settings.intervalMs < 1000 ? 1 : 0));
  if (els.inRpcUrl) els.inRpcUrl.value = state.settings.solanaRpcUrl || "https://api.mainnet-beta.solana.com";
}

function switchTopView(view) {
  const showDashboard = view !== "apy";
  if (els.viewDashboard) els.viewDashboard.style.display = showDashboard ? "" : "none";
  if (els.viewApyBoard) els.viewApyBoard.style.display = showDashboard ? "none" : "";
  if (els.tabDashboard) els.tabDashboard.classList.toggle("tab--active", showDashboard);
  if (els.tabApyBoard) els.tabApyBoard.classList.toggle("tab--active", !showDashboard);
}

async function init() {
  attachGlobalErrorHandlers();

  const loadedSharedState = await loadSharedStateFromServer();
  if (!loadedSharedState && ENABLE_SERVER_MONITOR_SYNC) {
    scheduleMonitorStateSync(0);
  }

  if (els.formAdd) {
    els.formAdd.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = els.inName.value.trim();
    const symbol = els.inSymbol.value.trim();
    const deposit = parseDecimal(els.inDeposit.value);
    const apyPct = parseDecimal(els.inApy.value);
    const model = els.inModel.value === "simple" ? "simple" : "effective";
    const startMs = els.inStart.value ? fromDatetimeLocalValue(els.inStart.value) : Date.now();

    if (!name) return;
    if (!Number.isFinite(deposit) || deposit < 0) return;
    if (!Number.isFinite(apyPct)) return;

    addPlatform({ name, symbol, deposit, apyPct, startMs, model, liveApy: selectedLiveApyForAdd });
    els.inName.value = "";
    els.inSymbol.value = "";
    els.inDeposit.value = "";
    els.inApy.value = "";
    els.inStart.value = "";
    els.inModel.value = "effective";
  });
  }

  if (els.btnAddExample) {
    els.btnAddExample.addEventListener("click", () => {
    addPlatform({
      name: "Aave v3",
      symbol: "USDC",
      deposit: 1000,
      apyPct: 6.75,
      startMs: Date.now() - 6.5 * 24 * 60 * 60 * 1000,
      model: "effective",
    });
    addPlatform({
      name: "Lido",
      symbol: "stETH",
      deposit: 2_500,
      apyPct: 3.5,
      startMs: Date.now() - 21 * 24 * 60 * 60 * 1000,
      model: "effective",
    });
  });
  }

  if (els.btnRefreshStableApy) {
    els.btnRefreshStableApy.addEventListener("click", () => void refreshStableApyTable());
  }
  if (els.btnTestTelegram) {
    els.btnTestTelegram.addEventListener("click", async () => {
      const prevText = els.btnTestTelegram.textContent;
      els.btnTestTelegram.disabled = true;
      els.btnTestTelegram.textContent = "Sending...";
      try {
        await sendTestTelegramNotification();
        if (els.stableApyLastUpdated) {
          els.stableApyLastUpdated.textContent = ` Test Telegram notification sent at ${new Date().toLocaleString()}.`;
        }
      } catch (error) {
        const message = error?.message ?? String(error);
        if (els.stableApyLastUpdated) {
          els.stableApyLastUpdated.textContent = ` Test Telegram failed: ${message}`;
        }
        alert(`Telegram test failed: ${message}`);
      } finally {
        els.btnTestTelegram.disabled = false;
        els.btnTestTelegram.textContent = prevText;
      }
    });
  }
  if (els.btnStopLiveApy) {
    els.btnStopLiveApy.addEventListener("click", () => {
      if (editingId) {
        selectedLiveApyForEdit = null;
      } else {
        selectedLiveApyForAdd = null;
      }
      if (els.stableApyLastUpdated) {
        els.stableApyLastUpdated.textContent = editingId
          ? " Live APY cleared for the edit form."
          : " Live APY cleared for new positions.";
      }
    });
  }
  if (els.tabDashboard) els.tabDashboard.addEventListener("click", () => switchTopView("dashboard"));
  if (els.tabApyBoard) els.tabApyBoard.addEventListener("click", () => switchTopView("apy"));
  if (els.stableApyRows) {
    els.stableApyRows.addEventListener("click", (e) => {
      const btn = e.target?.closest?.("button[data-action='useStableApy']");
      if (!btn) return;
      const key = String(btn.getAttribute("data-key") ?? "");
      const label = String(btn.getAttribute("data-label") ?? "");
      const apyPct = Number(btn.getAttribute("data-apy-pct"));
      if (!key || !Number.isFinite(apyPct)) return;
      const nextLiveApy = { key, label, apyPct };
      if (editingId) {
        selectedLiveApyForEdit = nextLiveApy;
        if (els.editApy) els.editApy.value = apyPct.toFixed(4);
      } else {
        selectedLiveApyForAdd = nextLiveApy;
        if (els.inApy) els.inApy.value = apyPct.toFixed(4);
      }
      if (els.stableApyLastUpdated) {
        els.stableApyLastUpdated.textContent = editingId
          ? ` Selected for edited position: ${label} (${apyPct.toFixed(2)}%).`
          : ` Selected for new position: ${label} (${apyPct.toFixed(2)}%).`;
      }
    });
  }
  if (els.earningsChart) {
    els.earningsChart.addEventListener("mousemove", (e) => showChartScrub(e.clientX));
    els.earningsChart.addEventListener("mouseenter", (e) => showChartScrub(e.clientX));
    els.earningsChart.addEventListener("mouseleave", hideChartScrub);
    els.earningsChart.addEventListener("touchstart", (e) => {
      const t = e.touches?.[0];
      if (!t) return;
      showChartScrub(t.clientX);
    }, { passive: true });
    els.earningsChart.addEventListener("touchmove", (e) => {
      const t = e.touches?.[0];
      if (!t) return;
      showChartScrub(t.clientX);
    }, { passive: true });
    els.earningsChart.addEventListener("touchend", hideChartScrub, { passive: true });
  }
  if (els.btnRange7d) els.btnRange7d.addEventListener("click", () => setChartRange("7d"));
  if (els.btnRange30d) els.btnRange30d.addEventListener("click", () => setChartRange("30d"));
  if (els.btnRangeAll) els.btnRangeAll.addEventListener("click", () => setChartRange("all"));

  if (els.inIntervalMs) els.inIntervalMs.addEventListener("change", () => setIntervalMs(Number(els.inIntervalMs.value)));
  if (els.inCurrency) els.inCurrency.addEventListener("change", () => setCurrency(els.inCurrency.value));
  if (els.inDecimals) els.inDecimals.addEventListener("change", () => setDecimals(Number(els.inDecimals.value)));

  if (els.btnReset) {
    els.btnReset.addEventListener("click", () => {
    const ok = confirm("Reset everything? This clears platforms and settings on this browser.");
    if (!ok) return;
    state = defaultState();
    saveState(state);
    bindSettingsToUi();
    setIntervalMs(state.settings.intervalMs);
    tick();
  });
  }

  if (els.btnExport) els.btnExport.addEventListener("click", exportJson);
  if (els.fileImport) {
    els.fileImport.addEventListener("change", async () => {
    const file = els.fileImport.files?.[0];
    els.fileImport.value = "";
    if (!file) return;
    try {
      await importJsonFile(file);
    } catch (err) {
      alert(`Import failed: ${err?.message ?? String(err)}`);
    }
  });
  }

  if (els.rows) {
    els.rows.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("button[data-action]");
    const tr = e.target?.closest?.("tr[data-id]");
    if (!btn || !tr) return;
    const id = tr.getAttribute("data-id");
    const action = btn.getAttribute("data-action");
    if (!id || !action) return;

    if (action === "delete") {
      const p = state.platforms.find((x) => x.id === id);
      const ok = confirm(`Delete "${p?.name ?? "platform"}"?`);
      if (!ok) return;
      deletePlatform(id);
      return;
    }

    if (action === "edit") {
      const p = state.platforms.find((x) => x.id === id);
      if (!p) return;
      editingId = id;
      els.editName.value = p.name;
      els.editSymbol.value = p.symbol ?? "";
      els.editDeposit.value = String(p.deposit);
      els.editApy.value = String(p.apyPct);
      selectedLiveApyForEdit = getPlatformLiveApy(p);
      if (selectedLiveApyForEdit) {
        els.editApy.value = selectedLiveApyForEdit.apyPct.toFixed(4);
      }
      els.editStart.value = toDatetimeLocalValue(p.startMs);
      els.editModel.value = p.model === "simple" ? "simple" : "effective";
      els.dlgEdit.showModal();
      return;
    }
  });
  }

  if (els.dlgEdit) {
    els.dlgEdit.addEventListener("close", () => {
    if (els.dlgEdit.returnValue !== "save") {
      editingId = null;
      selectedLiveApyForEdit = null;
      return;
    }
    const id = editingId;
    editingId = null;
    if (!id) return;

    const name = els.editName.value.trim();
    const symbol = els.editSymbol.value.trim();
    const deposit = parseDecimal(els.editDeposit.value);
    const apyPct = parseDecimal(els.editApy.value);
    const startMs = fromDatetimeLocalValue(els.editStart.value);
    const model = els.editModel.value === "simple" ? "simple" : "effective";

    if (!name) return;
    if (!Number.isFinite(deposit) || deposit < 0) return;
    if (!Number.isFinite(apyPct)) return;
    if (!Number.isFinite(startMs)) return;

    updatePlatform(
      id,
      { name, symbol, deposit, apyPct, startMs, model, liveApy: normalizeLiveApySelection(selectedLiveApyForEdit) },
      { resetApyComparison: true }
    );
    selectedLiveApyForEdit = null;
  });
  }

  try {
    bindSettingsToUi();
  } catch {
    // Keep interactive controls alive even if initial UI binding fails.
  }
  try {
    setIntervalMs(state.settings?.intervalMs ?? 3000);
  } catch {
    // Fallback render attempt.
    tick();
  }

  void refreshStableApyTable();
  startStableApyAutoRefresh();
  setChartRange("all");
  switchTopView("dashboard");
  if (loadedSharedState) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } else {
    scheduleMonitorStateSync(0);
  }
  if (!earnedAnimationFrame) {
    earnedAnimationFrame = requestAnimationFrame(animateEarnedCounter);
  }
  tick();
}

void init();




