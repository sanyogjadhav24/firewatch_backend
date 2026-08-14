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

app.use(async (req, res, next) => {
  try {
    await connectDb();
    return next();
  } catch (err) {
    console.error("❌ DB unavailable:", err);
    return res.status(503).json({
      error: "Database unavailable",
      detail: err.message
    });
  }
});

app.use("/", reportsRouter);

const port = process.env.PORT || 8080;

// Start server only if not in Vercel serverless environment
if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  connectDb()
    .then(() => {
      app.listen(port, "0.0.0.0", () => {
        console.log(`✅ FireWatch backend running on http://0.0.0.0:${port}`);
      });
    })
    .catch((err) => {
      console.error("❌ DB connection failed:", err);
      process.exitCode = 1;
    });
}

// Export for Vercel serverless
module.exports = app;
