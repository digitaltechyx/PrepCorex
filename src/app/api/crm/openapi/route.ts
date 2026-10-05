import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const spec = {
  openapi: "3.1.0",
  info: {
    title: "PrepCorex CRM Automation API",
    version: "1.0.0",
    description:
      "Lead search/update, activity logs, draft storage, and follow-up tasks for ChatGPT automation.",
  },
  servers: [{ url: "https://crm.prepservicesfba.com" }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/api/crm/leads": {
      get: {
        operationId: "listCrmLeads",
        summary: "Search and list CRM leads",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "stage", in: "query", schema: { type: "string" } },
          { name: "followUpBefore", in: "query", schema: { type: "string", format: "date" } },
          { name: "followUpAfter", in: "query", schema: { type: "string", format: "date" } },
          { name: "limit", in: "query", schema: { type: "integer", maximum: 200 } },
        ],
        responses: { "200": { description: "Lead list" } },
      },
      post: {
        operationId: "createCrmLead",
        summary: "Create a CRM lead",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string" },
                  phone: { type: "string" },
                  email: { type: "string" },
                  company: { type: "string" },
                  notes: { type: "string" },
                  stage: { type: "string" },
                  followUpDate: { type: "string", format: "date" },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Created lead" } },
      },
    },
    "/api/crm/leads/{id}": {
      get: {
        operationId: "getCrmLead",
        summary: "Get one lead",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Lead" } },
      },
      patch: {
        operationId: "updateCrmLead",
        summary: "Update lead fields",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  stage: { type: "string" },
                  notes: { type: "string" },
                  company: { type: "string" },
                  followUpDate: { type: "string", format: "date" },
                  nextTaskSummary: { type: "string" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Updated lead" } },
      },
    },
    "/api/crm/leads/{id}/activities": {
      get: {
        operationId: "listCrmActivities",
        summary: "List activity log for a lead",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": { description: "Activities" } },
      },
      post: {
        operationId: "addCrmActivity",
        summary: "Add activity log entry",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["summary"],
                properties: {
                  type: { type: "string" },
                  summary: { type: "string" },
                  body: { type: "string" },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Activity created" } },
      },
    },
    "/api/crm/leads/{id}/draft": {
      get: {
        operationId: "getCrmDraft",
        summary: "Get saved draft message",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Draft" } },
      },
      put: {
        operationId: "saveCrmDraft",
        summary: "Save draft message",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  draftMessage: { type: "string" },
                  draftMailbox: { type: "string" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Draft saved" } },
      },
    },
    "/api/crm/tasks/overdue": {
      get: {
        operationId: "listCrmFollowUpTasks",
        summary: "List overdue or due follow-up tasks",
        parameters: [
          {
            name: "scope",
            in: "query",
            schema: { type: "string", enum: ["overdue", "due", "today"] },
            description: "Use due for today plus overdue",
          },
        ],
        responses: { "200": { description: "Tasks" } },
      },
    },
  },
};

export async function GET() {
  return NextResponse.json(spec);
}
