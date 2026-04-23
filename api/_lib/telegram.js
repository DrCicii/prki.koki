async function sendTelegramMessage(text) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID environment variables");
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
    throw new Error("Telegram API rejected the request");
  }

  return tgJson;
}

module.exports = {
  sendTelegramMessage,
};
