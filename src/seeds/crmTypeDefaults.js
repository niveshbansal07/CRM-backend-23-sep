const DEFAULT_LEAD_TYPES = [
    {
        name: "Dealer Lead",
        code: "dealer_lead",
        requiresDealerLink: true,
        requiresProductInterest: true,
    },
    {
        name: "Distributor Lead",
        code: "distributor_lead",
        requiresDistributorLink: true,
    },
    {
        name: "Customer Lead",
        code: "customer_lead",
        requiresLocationCapture: true,
    },
    {
        name: "Retail Lead",
        code: "retail_lead",
        requiresProductInterest: true,
    },
    {
        name: "Corporate Lead",
        code: "corporate_lead",
        requiresCompanyName: true,
        requiresGSTNumber: true,
    },
];

const DEFAULT_VISIT_TYPES = [
    {
        name: "New Lead Visit",
        code: "new_lead_visit",
        allowedEntityTypes: ["Lead"],
        expectedDurationMinutes: 20,
        requiresOutcome: true,
        requiresNextFollowUp: true,
    },
    {
        name: "Follow-Up Visit",
        code: "follow_up_visit",
        allowedEntityTypes: ["Lead", "Customer"],
        expectedDurationMinutes: 15,
        requiresOutcome: true,
    },
    {
        name: "Dealer Visit",
        code: "dealer_visit",
        allowedEntityTypes: ["Dealer", "Account"],
        expectedDurationMinutes: 15,
        requiresOutcome: true,
        requiresProductDiscussion: true,
    },
    {
        name: "Distributor Visit",
        code: "distributor_visit",
        allowedEntityTypes: ["Distributor", "Account"],
        expectedDurationMinutes: 20,
        requiresOutcome: true,
    },
    {
        name: "Order Collection",
        code: "order_collection",
        allowedEntityTypes: ["Dealer", "Customer", "Account"],
        expectedDurationMinutes: 10,
        allowsOrderCreation: true,
    },
    {
        name: "Payment Collection",
        code: "payment_collection",
        allowedEntityTypes: ["Customer", "Account"],
        expectedDurationMinutes: 10,
    },
    {
        name: "Product Demo Visit",
        code: "product_demo",
        allowedEntityTypes: ["Lead", "Customer"],
        expectedDurationMinutes: 30,
        requiresPhoto: true,
        requiresProductDiscussion: true,
    },
    {
        name: "Complaint Visit",
        code: "complaint_visit",
        allowedEntityTypes: ["Customer", "Account"],
        expectedDurationMinutes: 20,
        requiresOutcome: true,
    },
];

module.exports = {
    DEFAULT_LEAD_TYPES,
    DEFAULT_VISIT_TYPES,
};
