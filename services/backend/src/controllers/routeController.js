const axios = require("axios");
const { isDBConnected } = require("../utils/db");
const RouteAnalysis = require("../models/RouteAnalysis");
const SearchHistory = require("../models/SearchHistory");

const MAPBOX_TOKEN = process.env.MAPS_BOX;
const AI_SERVICE_URL = `http://localhost:${process.env.PYTHON_PORT || 8003}`;

/**
 * Geocode a place name to [lng, lat] using Mapbox Geocoding API
 */
async function geocode(query) {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`;
  const response = await axios.get(url, {
    params: { access_token: MAPBOX_TOKEN, limit: 1 },
  });
  const feature = response.data.features[0];
  if (!feature) throw new Error(`Could not geocode: ${query}`);
  return feature.center; // [lng, lat]
}

/**
 * Fetch all available routes between origin and destination
 * using Mapbox Directions API
 */
async function getRoutes(req, res) {
  try {
    const { origin, destination } = req.query;

    if (!origin || !destination) {
      return res.status(400).json({ error: "origin and destination are required" });
    }

    // Check cache first (if DB is connected)
    if (isDBConnected()) {
      const cached = await RouteAnalysis.findOne({
        origin: origin.toLowerCase().trim(),
        destination: destination.toLowerCase().trim(),
        expiresAt: { $gt: new Date() },
      });

      if (cached) {
        console.log(`Cache hit for ${origin} → ${destination}`);
        return res.json({
          routes: cached.routes,
          totalRoutes: cached.totalRoutes,
          cached: true,
        });
      }
    }

    // Geocode origin and destination
    const [originCoords, destCoords] = await Promise.all([
      geocode(origin),
      geocode(destination),
    ]);

    const coordsParam = `${originCoords[0]},${originCoords[1]};${destCoords[0]},${destCoords[1]}`;

    const response = await axios.get(
      `https://api.mapbox.com/directions/v5/mapbox/driving/${coordsParam}`,
      {
        params: {
          access_token: MAPBOX_TOKEN,
          alternatives: true,
          geometries: "geojson",
          steps: true,
          overview: "full",
        },
      }
    );

    if (!response.data.routes || response.data.routes.length === 0) {
      return res.status(400).json({ error: "No routes found" });
    }

    const baseRoutes = response.data.routes.map((route, index) => {
      const distanceKm = (route.distance / 1000).toFixed(1);
      const durationMin = Math.round(route.duration / 60);
      const steps = route.legs[0]?.steps || [];
      const keyLocations = extractKeyLocations(route, steps);

      return {
        routeIndex: index,
        summary: route.legs[0]?.summary || `Route ${index + 1}`,
        distance: `${distanceKm} km`,
        duration: `${durationMin} min`,
        startAddress: origin,
        endAddress: destination,
        originCoords,
        destCoords,
        geometry: route.geometry,
        keyLocations,
        steps: steps.map((step) => ({
          instruction: step.maneuver?.instruction || "",
          distance: `${(step.distance / 1000).toFixed(2)} km`,
          duration: `${Math.round(step.duration / 60)} min`,
          startLocation: { lng: step.geometry?.coordinates[0]?.[0], lat: step.geometry?.coordinates[0]?.[1] },
        })),
      };
    });

    // Reverse-geocode waypoints for each route in parallel to get real area names
    const routes = await Promise.all(
      baseRoutes.map(async (route) => {
        const routeAreas = await getRouteAreaNames(route.geometry, origin, destination);
        return { ...route, routeAreas };
      })
    );

    res.json({ routes, totalRoutes: routes.length, cached: false });
  } catch (error) {
    console.error("Error fetching routes:", error.message);
    res.status(500).json({ error: "Failed to fetch routes", details: error.message });
  }
}

/**
 * Reverse-geocode a single coordinate to a neighborhood/locality name.
 * Returns "{neighborhood}, {city}" or just "{place}" on failure.
 */
async function reverseGeocodePoint(lng, lat) {
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json`;
    const response = await axios.get(url, {
      params: {
        access_token: MAPBOX_TOKEN,
        types: "neighborhood,locality,place",
        limit: 1,
      },
    });
    const feature = response.data.features[0];
    if (!feature) return null;
    const neighborhood = feature.text;
    const city = feature.context?.find((c) => c.id.startsWith("place"))?.text;
    return city ? `${neighborhood}, ${city}` : neighborhood;
  } catch {
    return null;
  }
}

/**
 * Sample ~8 evenly-spaced coordinates from the route geometry,
 * reverse-geocode them in parallel, and return unique area names.
 */
async function getRouteAreaNames(geometry, startAddress, endAddress) {
  const coords = geometry.coordinates;
  const step = Math.max(1, Math.floor(coords.length / 8));
  const samples = [];
  for (let i = 0; i < coords.length; i += step) {
    samples.push(coords[i]);
  }
  // Always include the last point
  samples.push(coords[coords.length - 1]);

  const names = await Promise.all(
    samples.slice(0, 8).map(([lng, lat]) => reverseGeocodePoint(lng, lat))
  );

  // Combine with start/end address for full coverage, deduplicate
  const allNames = [startAddress, endAddress, ...names].filter(Boolean);
  return [...new Set(allNames)];
}

/**
 * Extract key location names from a Mapbox route (kept for waypoints data)
 */
function extractKeyLocations(route, steps) {
  const sampleInterval = Math.max(1, Math.floor(steps.length / 5));
  const waypoints = [];
  for (let i = 0; i < steps.length; i += sampleInterval) {
    const coords = steps[i].geometry?.coordinates[0];
    if (coords) waypoints.push({ lng: coords[0], lat: coords[1] });
  }
  return { names: [], waypoints };
}

/**
 * Send routes to the Python AI service for safety analysis,
 * then save results to MongoDB
 */
async function analyzeSafety(req, res) {
  try {
    const { routes, origin, destination } = req.body;

    if (!routes || !Array.isArray(routes)) {
      return res.status(400).json({ error: "routes array is required" });
    }

    // Use reverse-geocoded area names; fall back to keyLocations.names for old cached routes
    const allLocations = routes.flatMap(
      (route) => route.routeAreas?.length ? route.routeAreas : route.keyLocations.names
    );

    const aiResponse = await axios.post(`${AI_SERVICE_URL}/analyze`, {
      routes,
      locations: [...new Set(allLocations)],
    });

    const analysisData = aiResponse.data;

    if (isDBConnected() && origin && destination) {
      try {
        await RouteAnalysis.findOneAndUpdate(
          {
            origin: origin.toLowerCase().trim(),
            destination: destination.toLowerCase().trim(),
          },
          {
            origin: origin.toLowerCase().trim(),
            destination: destination.toLowerCase().trim(),
            totalRoutes: routes.length,
            totalAnalyzed: analysisData.totalAnalyzed,
            newsArticlesFound: analysisData.newsArticlesFound,
            routes,
            rankedRoutes: analysisData.rankedRoutes,
            expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
          },
          { upsert: true, new: true }
        );

        const safest = analysisData.rankedRoutes?.[0];
        await SearchHistory.create({
          origin,
          destination,
          safestRouteIndex: safest?.routeIndex,
          safestScore: safest?.safetyScore,
          totalRoutes: routes.length,
        });

        console.log(`Saved analysis: ${origin} → ${destination}`);
      } catch (dbErr) {
        console.error("DB save error (non-fatal):", dbErr.message);
      }
    }

    res.json(analysisData);
  } catch (error) {
    console.error("Error analyzing safety:", error.message);
    res.status(500).json({ error: "Failed to analyze route safety" });
  }
}

module.exports = { getRoutes, analyzeSafety };
