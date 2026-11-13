const mongoose = require("mongoose");

const incidentSchema = new mongoose.Schema({
  title:       { type: String, default: "" },
  description: { type: String, default: "" },
  source:      { type: String, default: "Unknown" },
  publishedAt: { type: String, default: "" },
  hoursAgo:    { type: Number, default: 9999 },
  severity:    { type: String, default: "low" },
  location:    { type: String, default: "" },
}, { _id: false });

const zoneCacheSchema = new mongoose.Schema({
  location:         { type: String, required: true, unique: true, lowercase: true, trim: true },
  zone:             { type: String, enum: ["red", "yellow", "green"], required: true },
  score:            { type: Number, required: true },
  riskLevel:        { type: String, required: true },
  topIncidents:     { type: [incidentSchema], default: [] },
  summary:          { type: String, default: "" },
  articlesAnalyzed: { type: Number, default: 0 },
  cachedAt:         { type: Date, default: Date.now },
  expiresAt:        { type: Date, required: true, index: { expires: 0 } },
});

module.exports = mongoose.model("ZoneCache", zoneCacheSchema);
