const express = require("express");
const router = express.Router();
const { getRoutes, analyzeSafety } = require("../controllers/routeController");

// GET /api/routes?origin=...&destination=...
// Returns all available routes from Google Maps
router.get("/", getRoutes);

// POST /api/routes/analyze
// Takes routes and returns safety-scored rankings
router.post("/analyze", analyzeSafety);

module.exports = router;
