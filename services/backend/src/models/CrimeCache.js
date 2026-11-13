const mongoose = require("mongoose");

const articleSchema = new mongoose.Schema({
  title: String,
  description: String,
  source: String,
  publishedAt: String,
  hoursAgo: Number,
  url: String,
});

const crimeCacheSchema = new mongoose.Schema(
  {
    location: { type: String, required: true, index: true },
    articles: [articleSchema],
    // Cache expires after 1 hour — crime news changes fast
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 60 * 60 * 1000),
      index: { expires: 0 },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CrimeCache", crimeCacheSchema);
