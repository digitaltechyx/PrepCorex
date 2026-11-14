# Lexi Phase 1 — Gap matrix

PrepCorex admin Lexi · Updated 2026-11-15

All writes use `propose_*` → admin **Confirm** → execute (server and/or browser) with managed-client permission checks + audit where applicable.

| Area | Capability | Status | Notes |
|------|------------|--------|-------|
| Access | Admin / sub-admin managed clients | Done | `assertLexiCanManageClient` |
| Access | Confirm before write | Done | Floating chat Confirm |
| Access | Audit log | Done | `writeLexiAuditLog` on server executes |
| Lookups | find clients / products | Done | |
| Lookups | pending (one / all) + queue | Done | |
| Lookups | warehouses, reports/CSV | Done | |
| Lookups | invoices / shipped / profile | Done | `lookup_client_records` |
| Lookups | outbound billing status | Done | `lookup_outbound_billing` |
| Inbound | create / approve / reject / complete / fulfill-all | Done | |
| Inbound | cancel pending | Done | `propose_inbound_cancel` |
| Inbound | batches / line corrections | Partial / guide | Use Admin UI; Lexi guides |
| Outbound | create / approve / reject / pick-pack / ship / dispatch / fulfill-all | Done | |
| Outbound | cancel pending | Done | `propose_outbound_cancel` + inventory restore |
| Outbound | On: Create Invoice from chat | Done | `propose_outbound_invoice` |
| Outbound | Off: Add services → CRM draft from chat | Done | same tool, billing-aware |
| Inventory | restock | Done | |
| Inventory | transfer / allocate / cycle count | Out of scope P1 | Guide to Warehouse Ops / Admin UI |
| Users & pricing | create/update users, tariffs | Out of scope P1 writes | Guide; reads via lookup |
| Returns & labels | return/dispose/delete/quarantine review | Done | |
| Returns & labels | label refund / top-up / API fee | Done | |
| Integrations | connect stores | Out of scope P1 | Guide |
| Client Lexi | client dashboard chat mode | Deferred | Reuses same engine; allow-list next |
| QA | Confirm + permission regression | Manual | Use Confirm on each propose_* |

## Workflow rule (every write)

1. Read live data (`find_*` / `list_*` / `get_*` / `lookup_*`)  
2. `propose_*` with clear summary  
3. Admin Confirm  
4. Execute under admin auth + managed-client gate  
5. Acknowledge result; suggest next step  
