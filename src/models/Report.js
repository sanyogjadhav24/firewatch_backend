const mongoose = require("mongoose");

const AiResultSchema = new mongoose.Schema(
  {
    isFire: { type: Boolean, default: false },
    fireConfidence: { type: Number, default: 0 },
    suspectedAIGenerated: { type: Boolean, default: false },
    aiGenConfidence: { type: Number, default: 0 },
    reasons: { type: [String], default: [] },
    model: { type: String, default: "" },
    checkedAt: { type: Date }
  },
  { _id: false }
);

const ReportSchema = new mongoose.Schema(
  {
    uid: { type: String, required: true, index: true },

    title: { type: String, required: true },
    description: { type: String, required: true },
    severity: { type: String, required: true }, // LOW/MED/HIGH

    lat: { type: Number, required: true },
    lng: { type: Number, required: true },

    deviceName: { type: String, required: true },
    deviceTime: { type: String, required: true },

    image: {
      url: { type: String, required: true },
      publicId: { type: String, required: true }
    },

    status: {
      type: String,
      required: true,
      enum: ["PENDING_AI", "REJECTED_AI", "SUBMITTED", "SUBMITTED_OVERRIDE"],
      default: "PENDING_AI"
    },

    aiResult: { type: AiResultSchema, default: () => ({}) },

    override: {
      didOverride: { type: Boolean, default: false },
      consentAt: { type: Date }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Report", ReportSchema);
