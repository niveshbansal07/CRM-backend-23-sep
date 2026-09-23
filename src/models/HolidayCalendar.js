const mongoose = require("mongoose");

const holidayItemSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ["NATIONAL", "FESTIVAL", "COMPANY", "OPTIONAL"], default: "COMPANY" },
    isPaid: { type: Boolean, default: true },
  },
  { _id: true }
);

const holidayCalendarSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name: { type: String, required: true, trim: true },
    year: { type: Number, required: true, index: true },
    locationId: { type: mongoose.Schema.Types.ObjectId, default: null },
    holidays: { type: [holidayItemSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

holidayCalendarSchema.index(
  { companyId: 1, year: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);

module.exports = mongoose.model("HolidayCalendar", holidayCalendarSchema);
