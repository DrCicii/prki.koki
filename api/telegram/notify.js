const { sendTelegramMessage } = require("../_lib/telegram");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const text = String(req.body?.text ?? "").trim();
  if (!text) {
    return res.status(400).json({ ok: false, error: "Missing text" });
  }

  try {
    await sendTelegramMessage(text);
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error?.message ?? "Telegram API rejected the request",
    });
  }

  return res.status(200).json({ ok: true });
};
