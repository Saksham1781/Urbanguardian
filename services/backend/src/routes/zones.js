const express = require("express");
const router = express.Router();
const { classifyZones } = require("../controllers/zoneController");

// POST /api/zones  { locations: string[] }
router.post("/", classifyZones);

module.exports = router;
