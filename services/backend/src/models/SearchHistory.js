const mongoose = require("mongoose");

const searchHistorySchema = new mongoose.Schema(
  {
    origin: { type: String, required: true },
    destination: { type: String, required: true },
    safestRouteIndex: Number,
    safestScore: Number,
    totalRoutes: Number,
  },
  { timestamps: true }
);

// Index for querying recent searches
searchHistorySchema.index({ createdAt: -1 });

module.exports = mongoose.model("SearchHistory", searchHistorySchema);
