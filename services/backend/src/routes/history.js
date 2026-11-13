const express = require("express");
const router = express.Router();
const {
  getSearchHistory,
  getAnalysisById,
} = require("../controllers/historyController");

// GET /api/history — recent search history
router.get("/", getSearchHistory);

// GET /api/history/:id — full analysis details
router.get("/:id", getAnalysisById);

module.exports = router;
