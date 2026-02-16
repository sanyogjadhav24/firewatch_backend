const express = require("express");
const multer = require("multer");
const Report = require("../models/Report");
const { requireAuth } = require("../middleware/auth");
const { uploadBufferToCloudinary } = require("../services/cloudinary");
const { analyzeImageWithGroq } = require("../services/groq");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Root endpoint
router.get("/", (req, res) => {
  res.json({ 
    service: "FireWatch Backend API",
    version: "1.0.0",
    status: "running",
    endpoints: [
      "GET /health",
      "GET /reports",
      "POST /reports (auth required)",
      "GET /reports/mine (auth required)",
      "GET /reports/:id",
      "POST /reports/:id/override (auth required)"
    ]
  });
});

// GET /reports (list all reports)
router.get("/reports", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    // Optional filters
    const filter = {};
    if (req.query.status) {
      filter.status = req.query.status.toUpperCase();
    }
    if (req.query.severity) {
      filter.severity = req.query.severity.toUpperCase();
    }

    const [reports, total] = await Promise.all([
      Report.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Report.countDocuments(filter)
    ]);

    const formattedReports = reports.map((report) => ({
      reportId: String(report._id),
      title: report.title || "",
      severity: report.severity || "LOW",
      status: report.status || "",
      createdAt: report.createdAt ? report.createdAt.toISOString() : "",
      imageUrl: report.image && report.image.url ? report.image.url : "",
      lat: report.lat || 0.0,
      lng: report.lng || 0.0
    }));

    return res.json({ 
      reports: formattedReports,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (e) {
    console.error("GET /reports error:", e);
    return res.status(500).json({ error: "Server error", detail: e.message });
  }
});

// GET /reports/mine (must come BEFORE /reports/:id to avoid conflict)
router.get("/reports/mine", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const limit = Math.min(parseInt(req.query.limit) || 50, 50);

    const reports = await Report.find({ uid }).sort({ createdAt: -1 }).limit(limit).lean();

    const formattedReports = reports.map((report) => {
      const obj = {
        reportId: String(report._id),
        title: report.title || "",
        severity: report.severity || "LOW",
        status: report.status || "",
        createdAt: report.createdAt ? report.createdAt.toISOString() : "",
        imageUrl: report.image && report.image.url ? report.image.url : "",
        lat: report.lat || 0.0,
        lng: report.lng || 0.0
      };

      if (report.aiResult) {
        obj.aiResult = report.aiResult;
      }

      return obj;
    });

    return res.json({ reports: formattedReports });
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: e.message });
  }
});

// POST /reports  (requires auth)
router.post("/reports", requireAuth, upload.single("image"), async (req, res) => {
  try {
    const uid = req.user.uid;

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "image is required (multipart field name: image)" });
    }

    if (!req.file || !req.file.buffer || req.file.size === 0 || req.file.buffer.length === 0) {
      return res.status(400).json({ error: "Empty image file" });
    }

    const {
      title,
      description,
      severity,
      lat,
      lng,
      deviceName,
      deviceTime
    } = req.body;

    if (!title || !description || !severity || !lat || !lng || !deviceName || !deviceTime) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const sev = String(severity).toUpperCase();
    if (!["LOW", "MED", "HIGH"].includes(sev)) {
      return res.status(400).json({ error: "severity must be LOW/MED/HIGH" });
    }

    console.log("Upload file size bytes:", req.file.size);

    // Upload to Cloudinary
    const publicId = `report_${Date.now()}`;
    const folder = `firewatch/reports/${uid}`;

    console.log("Starting Cloudinary upload...");
    const cloudStartTime = Date.now();
    
    let cloud;
    try {
      cloud = await uploadBufferToCloudinary({
        buffer: req.file.buffer,
        folder,
        publicId
      });
      console.log(`✅ Cloudinary upload completed in ${Date.now() - cloudStartTime}ms`);
    } catch (cloudErr) {
      console.error("❌ Cloudinary upload failed:", cloudErr.message);
      return res.status(500).json({ 
        error: "Image upload failed", 
        detail: cloudErr.message.includes("timeout") ? "Upload timeout - image too large or slow connection" : cloudErr.message 
      });
    }

    const report = await Report.create({
      uid,
      title: String(title),
      description: String(description),
      severity: sev,
      lat: Number(lat),
      lng: Number(lng),
      deviceName: String(deviceName),
      deviceTime: String(deviceTime),
      image: {
        url: cloud.secure_url,
        publicId: cloud.public_id
      },
      status: "PENDING_AI"
    });

    // Respond immediately so app can poll
    res.json({ reportId: String(report._id), status: "PENDING_AI" });

    // Analyze in "background" (no queue, but async after response)
    setImmediate(async () => {
      try {
        console.log(`Starting AI analysis for report ${report._id}...`);
        const aiStartTime = Date.now();
        
        const ai = await analyzeImageWithGroq(report.image.url);
        
        console.log(`✅ AI analysis completed in ${Date.now() - aiStartTime}ms for report ${report._id}`);

        // Decision rules (same as our plan)
        let status = "REJECTED_AI";
        if (ai.isFire && ai.fireConfidence >= 0.7 && !ai.suspectedAIGenerated) {
          status = "SUBMITTED";
        } else {
          status = "REJECTED_AI";
          if (ai.reasons.length === 0) {
            ai.reasons = ["Image did not meet submission requirements"];
          }
        }

        await Report.findByIdAndUpdate(
          report._id,
          {
            status,
            aiResult: {
              isFire: ai.isFire,
              fireConfidence: ai.fireConfidence,
              suspectedAIGenerated: ai.suspectedAIGenerated,
              aiGenConfidence: ai.aiGenConfidence,
              reasons: ai.reasons,
              model: ai.model,
              checkedAt: new Date()
            }
          },
          { new: true }
        );
      } catch (e) {
        console.error(`❌ AI analysis failed for report ${report._id}:`, e.message);
        if (e.response) {
          console.error("API response status:", e.response.status);
          console.error("API response data:", JSON.stringify(e.response.data).slice(0, 500));
        }
        
        await Report.findByIdAndUpdate(
          report._id,
          {
            status: "REJECTED_AI",
            aiResult: {
              isFire: false,
              fireConfidence: 0,
              suspectedAIGenerated: false,
              aiGenConfidence: 0,
              reasons: ["AI verification failed: " + e.message],
              model: process.env.GROQ_VISION_MODEL || "",
              checkedAt: new Date()
            }
          },
          { new: true }
        );
      }
    });
  } catch (e) {
    console.error("POST /reports error:", e);
    return res.status(500).json({ error: "Server error", detail: e && e.message ? e.message : "unknown" });
  }
});

// GET /reports/:id  (allow without auth for hackathon)
router.get("/reports/:id", async (req, res) => {
  try {
    const report = await Report.findById(req.params.id).lean();
    if (!report) return res.status(404).json({ error: "Not found" });

    return res.json({
      reportId: String(report._id),
      status: report.status,
      title: report.title || "",
      description: report.description || "",
      severity: report.severity || "LOW",
      lat: report.lat || 0.0,
      lng: report.lng || 0.0,
      deviceName: report.deviceName || "",
      deviceTime: report.deviceTime || "",
      imageUrl: report.image && report.image.url ? report.image.url : "",
      createdAt: report.createdAt ? report.createdAt.toISOString() : "",
      aiResult: report.aiResult || null
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: e.message });
  }
});

// POST /reports/:id/override  (requires auth)
router.post("/reports/:id/override", requireAuth, async (req, res) => {
  try {
    const { consent } = req.body || {};
    if (consent !== true) return res.status(400).json({ error: "consent=true is required" });

    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: "Not found" });

    // only owner can override
    if (report.uid !== req.user.uid) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (report.status !== "REJECTED_AI") {
      return res.status(400).json({ error: "Override allowed only when status is REJECTED_AI" });
    }

    report.status = "SUBMITTED_OVERRIDE";
    report.override = { didOverride: true, consentAt: new Date() };
    await report.save();

    return res.json({
      reportId: String(report._id),
      status: report.status,
      aiResult: report.aiResult || null
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: e.message });
  }
});

module.exports = router;
