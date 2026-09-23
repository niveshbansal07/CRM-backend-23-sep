require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../src/models/User");
const Department = require("../src/models/Department");
const Designation = require("../src/models/Designation");

const HR_DEPARTMENT_NAMES = ["human resource", "human resources"];
const HR_DEPARTMENT_SLUGS = ["human-resource", "human-resources"];
const HR_HEAD_TITLES = ["head of hr", "hr head"];

const normalize = (value = "") =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const main = async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URI is required to run this migration.");
  }

  await mongoose.connect(mongoUri);

  const hrDepartments = await Department.find({
    deletedAt: null,
    $or: [
      { normalizedName: { $in: HR_DEPARTMENT_NAMES } },
      { slug: { $in: HR_DEPARTMENT_SLUGS } },
      { name: /^human resources?$/i },
    ],
  }).select("_id companyId name");

  const hrDepartmentIds = hrDepartments.map((department) => department._id);

  const hrHeadDesignations = await Designation.find({
    deletedAt: null,
    $or: [
      { normalizedTitle: { $in: HR_HEAD_TITLES } },
      { normalizedName: { $in: HR_HEAD_TITLES } },
      { title: /^head of hr$|^hr head$/i },
      { name: /^head of hr$|^hr head$/i },
    ],
  }).select("_id companyId departmentId title name");

  const hrHeadDesignationIds = hrHeadDesignations.map((designation) => designation._id);

  const result = await User.updateMany(
    {
      deletedAt: null,
      role: "hr_manager",
      systemRole: "hr_manager",
      $and: [
        {
          $or: [
            { departmentId: { $in: hrDepartmentIds } },
            { department: /^human resources?$/i },
          ],
        },
        {
          $or: [
            { designationId: { $in: hrHeadDesignationIds } },
            { designation: /^head of hr$|^hr head$/i },
          ],
        },
      ],
    },
    {
      $set: {
        role: "hr_head",
        systemRole: "hr_head",
        updatedAt: new Date(),
      },
    }
  );

  console.log(`HR Head migration complete. Matched: ${result.matchedCount || 0}, updated: ${result.modifiedCount || 0}.`);
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
