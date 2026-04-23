const { get, put } = require("@vercel/blob");

const MONITOR_STATE_PATH = "monitor/state.json";

async function readMonitorState() {
  const result = await get(MONITOR_STATE_PATH, { access: "private" });
  if (!result || result.statusCode === 404 || !result.stream) return null;
  const text = await new Response(result.stream).text();
  if (!text.trim()) return null;
  return JSON.parse(text);
}

async function writeMonitorState(value) {
  await put(MONITOR_STATE_PATH, JSON.stringify(value, null, 2), {
    access: "private",
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

module.exports = {
  readMonitorState,
  writeMonitorState,
};
