const axios = require("axios");
const { isDBConnected } = require("../utils/db");
const ZoneCache = require("../models/ZoneCache");

const AI_SERVICE_URL = `http://localhost:${process.env.PYTHON_PORT || 8003}`;

async function classifyZones(req, res) {
  try {
    const { locations } = req.body;

    if (!locations || !Array.isArray(locations) || locations.length === 0) {
      return res.status(400).json({ error: "locations array is required" });
    }

    // Normalise: lowercase + trim + deduplicate
    const normalised = [...new Set(locations.map((l) => l.toLowerCase().trim()))].filter(Boolean);

    // Split into cached and uncached
    let cachedZones = [];
    let uncachedLocations = normalised;

    if (isDBConnected()) {
      const cached = await ZoneCache.find({
        location: { $in: normalised },
        expiresAt: { $gt: new Date() },
      });

      cachedZones = cached.map((doc) => ({
        location: doc.location,
        zone: doc.zone,
        score: doc.score,
        riskLevel: doc.riskLevel,
        topIncidents: doc.topIncidents,
        summary: doc.summary,
        articlesAnalyzed: doc.articlesAnalyzed,
      }));

      const cachedLocationSet = new Set(cached.map((c) => c.location));
      uncachedLocations = normalised.filter((l) => !cachedLocationSet.has(l));
    }

    // Fetch uncached locations from AI service
    let freshZones = [];
    if (uncachedLocations.length > 0) {
      const aiResponse = await axios.post(`${AI_SERVICE_URL}/zones`, {
        locations: uncachedLocations,
      });
      freshZones = aiResponse.data.zones || [];

      // Save fresh results to ZoneCache
      if (isDBConnected()) {
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        await Promise.all(
          freshZones.map((z) =>
            ZoneCache.findOneAndUpdate(
              { location: z.location.toLowerCase().trim() },
              { ...z, location: z.location.toLowerCase().trim(), cachedAt: new Date(), expiresAt },
              { upsert: true, new: true }
            )
          )
        );
      }
    }

    // Merge cached + fresh, preserve original order
    const zoneMap = {};
    [...cachedZones, ...freshZones].forEach((z) => {
      zoneMap[z.location.toLowerCase().trim()] = z;
    });

    const zones = normalised.map((loc) => zoneMap[loc]).filter(Boolean);

    res.json({ zones, totalLocations: zones.length });
  } catch (error) {
    console.error("Zone classification error:", error.message);
    res.status(500).json({ error: "Failed to classify zones", details: error.message });
  }
}

module.exports = { classifyZones };
