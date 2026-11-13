const mongoose = require("mongoose");

let isConnected = false;

async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.log("No MONGODB_URI set — running without database");
    return false;
  }

  if (isConnected) return true;

  try {
    await mongoose.connect(uri);
    isConnected = true;
    console.log("Connected to MongoDB");

    mongoose.connection.on("error", (err) => {
      console.error("MongoDB connection error:", err);
      isConnected = false;
    });

    mongoose.connection.on("disconnected", () => {
      console.log("MongoDB disconnected");
      isConnected = false;
    });

    return true;
  } catch (err) {
    console.error("Failed to connect to MongoDB:", err.message);
    return false;
  }
}

function isDBConnected() {
  return isConnected;
}

module.exports = { connectDB, isDBConnected };
