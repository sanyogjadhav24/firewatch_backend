const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const { connectDb } = require("./src/db");
const reportsRouter = require("./src/routes/reports");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" })); // JSON only; image comes via multer

app.get("/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use("/", reportsRouter);

const port = process.env.PORT || 8080;

// Connect to DB
connectDb()
  .then(() => {
    console.log("✅ Database connected");
  })
  .catch((err) => {
    console.error("❌ DB connection failed:", err);
  });

// Start server only if not in Vercel serverless environment
if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`✅ FireWatch backend running on http://0.0.0.0:${port}`);
  });
}

// Export for Vercel serverless
module.exports = app;
