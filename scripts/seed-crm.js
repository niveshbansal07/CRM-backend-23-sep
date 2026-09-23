require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../src/models/User");
const Lead = require("../src/models/Lead");
const Deal = require("../src/models/Deal");
const Pipeline = require("../src/models/Pipeline");
const crm = require("../src/services/crm.service");

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const user = await User.findOne({
    companyId: { $ne: null },
    role: { $in: ["company_admin", "sub_admin"] },
    status: "active",
    deletedAt: null,
  });
  if (!user) throw new Error("Create an active company admin before seeding CRM data");

  const config = await crm.getOrCreateConfig({ user });
  let pipeline = await Pipeline.findOne({
    companyId: user.companyId,
    name: "Standard Sales Pipeline",
    deletedAt: null,
  });
  if (!pipeline) {
    pipeline = await crm.createPipeline({
      user,
      payload: {
        name: "Standard Sales Pipeline",
        isDefault: true,
        stages: [
          { name: "Qualification", key: "qualification", probability: 15, type: "open" },
          { name: "Requirement Analysis", key: "requirement_analysis", probability: 30, type: "open" },
          { name: "Demo Meeting", key: "demo_meeting", probability: 45, type: "open" },
          { name: "Proposal Sent", key: "proposal_sent", probability: 60, type: "open" },
          { name: "Negotiation", key: "negotiation", probability: 75, type: "open" },
          { name: "On Hold", key: "on_hold", probability: 30, type: "open" },
          { name: "Won", key: "won", probability: 100, type: "won" },
          { name: "Lost", key: "lost", probability: 0, type: "lost" },
        ],
      },
    });
  }

  const qualifiedStage = config.leadStages.find(
    (stage) => stage.key === "qualified" || /\bqualified\b/i.test(stage.name)
  );
  const demoEmail = `demo.crm.${user.companyId}@example.com`;
  let lead = await Lead.findOne({ companyId: user.companyId, normalizedEmail: demoEmail, deletedAt: null });
  if (!lead) {
    lead = await crm.createLead({
      user,
      payload: {
        name: "Demo Builder Enquiry",
        companyName: "Demo Builder Enquiry",
        contact: "Demo Buyer",
        email: demoEmail,
        phone: "9000000001",
        source: "Website",
        priority: "hot",
        productInterested: "Premium Apartment",
        requirements: "3 BHK apartment with parking",
        budgetMax: 10000000,
        value: 10000000,
        status: qualifiedStage?.key || "qualified",
      },
    });
  }

  const pipelineId = pipeline.id || pipeline._id;
  const existingDeal = await Deal.findOne({
    companyId: user.companyId,
    name: "Demo Enterprise Opportunity",
    deletedAt: null,
  });
  if (!existingDeal) {
    await crm.createDeal({
      user,
      payload: {
        name: "Demo Enterprise Opportunity",
        pipelineId,
        stage: "qualification",
        value: 500000,
        assignedTo: user._id,
        expectedClose: new Date(Date.now() + 30 * 86400000),
      },
    });
  }

  console.log("CRM demo masters, pipeline, lead, and deal seeded");
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
