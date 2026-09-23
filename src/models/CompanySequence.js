const mongoose = require("mongoose");

const companySequenceSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    key: { type: String, required: true, trim: true, uppercase: true },
    value: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true }
);

companySequenceSchema.index({ companyId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("CompanySequence", companySequenceSchema);
