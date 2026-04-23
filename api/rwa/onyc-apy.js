const { fetchRwaOnycApy } = require("../_lib/market-data");

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
