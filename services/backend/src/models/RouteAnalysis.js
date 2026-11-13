const mongoose = require("mongoose");

const incidentSchema = new mongoose.Schema({
  title: String,
  description: String,
  source: String,
  publishedAt: String,
  hoursAgo: Number,
  severity: { type: String, enum: ["low", "medium", "high", "critical"] },
  location: String,
});

const scoredRouteSchema = new mongoose.Schema({
  routeIndex: Number,
  summary: String,
  safetyScore: Number,
  rank: Number,
  riskLevel: { type: String, enum: ["low", "moderate", "high", "critical"] },
  incidents: [incidentSchema],
  reasoning: String,
});

const routeAnalysisSchema = new mongoose.Schema(
  {
    origin: { type: String, required: true },
    destination: { type: String, required: true },
    totalRoutes: Number,
    totalAnalyzed: Number,
    newsArticlesFound: Number,
    routes: [mongoose.Schema.Types.Mixed],
    rankedRoutes: [scoredRouteSchema],
    // Cache validity — after 2h the backend re-fetches fresh route/news data
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours
    },
    // MongoDB TTL — keep documents for 30 days so historical incidents can be used
    // as a safety baseline when no fresh crime news exists for a route
    deletesAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      index: { expires: 0 },
    },
  },
  { timestamps: true }
);

// Compound index for fast lookups by origin+destination
routeAnalysisSchema.index(
  { origin: 1, destination: 1 },
  { collation: { locale: "en", strength: 2 } }
);

module.exports = mongoose.model("RouteAnalysis", routeAnalysisSchema);
