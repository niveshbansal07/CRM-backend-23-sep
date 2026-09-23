const mongoose = require("mongoose");

const shiftSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name: { type: String, required: true, trim: true },
    startTime: { type: String, required: true, trim: true },
    endTime: { type: String, required: true, trim: true },
    graceMinutes: { type: Number, default: 0, min: 0 },
    breakMinutes: { type: Number, default: 0, min: 0 },
    fullDayMinutes: { type: Number, default: 480, min: 1 },
    halfDayMinutes: { type: Number, default: 240, min: 1 },
    isNightShift: { type: Boolean, default: false },
    isFlexible: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

shiftSchema.index({ companyId: 1, name: 1, deletedAt: 1 });

module.exports = mongoose.model("Shift", shiftSchema);
