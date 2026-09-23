const mongoose = require("mongoose");

const attachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    caption: { type: String, default: "", trim: true },
    name: { type: String, default: "", trim: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const visitSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    visitTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "VisitType", required: true, index: true },
    entityType: {
      type: String,
      enum: ["Lead", "Account", "Dealer", "Distributor", "Customer"],
      required: true,
      index: true,
    },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    executiveId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    reportingManagerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    salesHeadId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    attendanceSessionId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    visitNumber: { type: String, trim: true, index: true },
    startedAt: { type: Date, default: null, index: true },
    endedAt: { type: Date, default: null },
    durationSeconds: { type: Number, default: 0 },
    expectedDurationMinutes: { type: Number, default: 15 },
    durationStatus: {
      type: String,
      enum: ["within_limit", "exceeded", "short_visit", "ongoing", "cancelled"],
      default: "ongoing",
      index: true,
    },
    checkInLatitude: { type: Number, default: null },
    checkInLongitude: { type: Number, default: null },
    checkInAccuracy: { type: Number, default: null },
    checkOutLatitude: { type: Number, default: null },
    checkOutLongitude: { type: Number, default: null },
    checkOutAccuracy: { type: Number, default: null },
    distanceFromEntityMetres: { type: Number, default: null },
    visitPurposeId: { type: mongoose.Schema.Types.ObjectId, ref: "CrmMaster", default: null, index: true },
    visitOutcomeId: { type: mongoose.Schema.Types.ObjectId, ref: "CrmMaster", default: null, index: true },
    notes: { type: String, default: "", trim: true },
    nextFollowUpAt: { type: Date, default: null },
    productsDiscussed: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
    orderCreatedId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    dealCreatedId: { type: mongoose.Schema.Types.ObjectId, ref: "Deal", default: null },
    leadCreatedId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null },
    photos: { type: [attachmentSchema], default: [] },
    documents: { type: [attachmentSchema], default: [] },
    managerApprovalRequired: { type: Boolean, default: false, index: true },
    managerApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    managerApprovedAt: { type: Date, default: null },
    isMockLocationSuspected: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["started", "completed", "cancelled", "auto_closed", "pending_review"],
      default: "started",
      index: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

const getDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
};

visitSchema.pre("save", async function (next) {
  try {
    if (this.isNew && !this.visitNumber) {
      const now = this.startedAt || new Date();
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      const sequence = await this.constructor.countDocuments({
        companyId: this.companyId,
        createdAt: { $gte: start, $lte: end },
      });
      this.visitNumber = `VIS-${getDateKey(now)}-${String(sequence + 1).padStart(4, "0")}`;
    }

    if (this.status === "cancelled") {
      this.durationStatus = "cancelled";
    } else if (this.endedAt && this.startedAt) {
      this.durationSeconds = Math.max(0, Math.round((this.endedAt - this.startedAt) / 1000));
      const actualMinutes = this.durationSeconds / 60;
      if (actualMinutes <= this.expectedDurationMinutes) {
        this.durationStatus = "within_limit";
      } else if (actualMinutes < 5 && this.expectedDurationMinutes >= 5) {
        this.durationStatus = "short_visit";
      } else {
        this.durationStatus = "exceeded";
      }
    } else if (this.status === "started") {
      this.durationStatus = "ongoing";
    }

    next();
  } catch (error) {
    next(error);
  }
});

visitSchema.index({ companyId: 1, executiveId: 1, startedAt: -1 });
visitSchema.index({ companyId: 1, reportingManagerId: 1, startedAt: -1 });
visitSchema.index({ companyId: 1, entityId: 1, entityType: 1 });
visitSchema.index({ companyId: 1, status: 1, startedAt: -1 });
visitSchema.index({ companyId: 1, visitNumber: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Visit", visitSchema);
