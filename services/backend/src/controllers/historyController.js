const { isDBConnected } = require("../utils/db");
const SearchHistory = require("../models/SearchHistory");
const RouteAnalysis = require("../models/RouteAnalysis");

/**
 * GET /api/history
 * Returns recent search history (last 20)
 */
async function getSearchHistory(req, res) {
  if (!isDBConnected()) {
    return res.status(503).json({ error: "Database not connected" });
  }

  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const history = await SearchHistory.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({ history, total: history.length });
  } catch (error) {
    console.error("Error fetching history:", error.message);
    res.status(500).json({ error: "Failed to fetch history" });
  }
}

/**
 * GET /api/history/:id
 * Returns a full cached analysis by RouteAnalysis ID
 */
async function getAnalysisById(req, res) {
  if (!isDBConnected()) {
    return res.status(503).json({ error: "Database not connected" });
  }

  try {
    const analysis = await RouteAnalysis.findById(req.params.id).lean();

    if (!analysis) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    res.json(analysis);
  } catch (error) {
    console.error("Error fetching analysis:", error.message);
    res.status(500).json({ error: "Failed to fetch analysis" });
  }
}

module.exports = { getSearchHistory, getAnalysisById };
