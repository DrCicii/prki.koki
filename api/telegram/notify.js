module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return res.status(500).json({
      ok: false,
      error: "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID environment variables",
    });
  }

  const text = String(req.body?.text ?? "").trim();
  if (!text) {
    return res.status(400).json({ ok: false, error: "Missing text" });
  }

  const tgRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
    }),
  });
  const tgJson = await tgRes.json().catch(() => ({}));
  if (!tgRes.ok || tgJson?.ok === false) {
    return res.status(502).json({
      ok: false,
      error: "Telegram API rejected the request",
      details: tgJson,
    });
  }

  return res.status(200).json({ ok: true });
};
