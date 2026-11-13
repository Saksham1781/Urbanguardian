const path = require("path");
const dotenv = require("dotenv");

// Load .env FIRST — before any module that reads process.env at load time
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const express = require("express");
const cors = require("cors");
const routeRoutes = require("./routes/routes");
const historyRoutes = require("./routes/history");
const zoneRoutes = require("./routes/zones");
const sosRoutes = require("./routes/sos");
const { connectDB } = require("./utils/db");

const app = express();
const PORT = process.env.NODE_PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Connect to MongoDB
connectDB();

// Routes
app.use("/api/routes", routeRoutes);
app.use("/api/history", historyRoutes);
app.use("/api/zones", zoneRoutes);
app.use("/api/sos", sosRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "urban-guardians-backend" });
});

const server = app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Kill the other process or change NODE_PORT in .env`);
  } else {
    console.error("Server error:", err);
  }
  process.exit(1);
});
