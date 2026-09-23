const mongoose = require("mongoose");

const visitLocationPointSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    visitId: { type: mongoose.Schema.Types.ObjectId, ref: "Visit", required: true, index: true },
    executiveId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    accuracy: { type: Number, default: null },
    speed: { type: Number, default: null },
    heading: { type: Number, default: null },
    recordedAt: { type: Date, required: true, default: Date.now, index: true },
    source: {
      type: String,
      enum: ["check_in", "check_out", "background", "manual"],
      default: "background",
    },
    batteryLevel: { type: Number, default: null, min: 0, max: 100 },
    isMockLocationSuspected: { type: Boolean, default: false },
  },
  { timestamps: true }
);

visitLocationPointSchema.index({ visitId: 1, recordedAt: 1 });
visitLocationPointSchema.index({ companyId: 1, executiveId: 1, recordedAt: -1 });

module.exports = mongoose.model("VisitLocationPoint", visitLocationPointSchema);
