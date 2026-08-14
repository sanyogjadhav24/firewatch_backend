const mongoose = require("mongoose");

let connectPromise = null;

async function connectDb() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (connectPromise) {
    return connectPromise;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI missing in env");

  connectPromise = mongoose
    .connect(uri, {
      autoIndex: true,
      serverSelectionTimeoutMS: 10000
    })
    .then((conn) => {
      console.log("✅ MongoDB connected");
      return conn;
    })
    .catch((err) => {
      connectPromise = null;
      throw err;
    });

  return connectPromise;
}

module.exports = { connectDb };
