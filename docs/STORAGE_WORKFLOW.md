# PrepCorex Storage Billing — Full Workflow

*Simple overview for leadership and operations*

> **Implementation status:** Receive billing (pallet +1 / carton×10), 7-day free + tier rates from pricing profiles, putaway inventory linking, and auto-close on outbound OOS are implemented in PrepCorex.

---

## What this is

Storage is billed **by pallet only**.  
Clients do not pay per carton or per SKU for storage. Cartons only help decide **when** a pallet is created.

Admin controls prices through **pricing profiles** (same idea as other PrepCorex pricing): default profile or a **custom profile** for a specific client. Clients can see their storage rates in their dashboard.

---

## Part 1 — How a pallet is created (at receiving)

When warehouse receives inventory, the receiver chooses **Pallet** or **Carton**.

### A) Receiver selects **Pallet**

- System assigns **1 pallet** to that client for that receive.
- Example: even if they receive 20 cartons of product on a pallet mode receive → still **1 pallet** of storage.
- That pallet starts the storage clock for billing.

### B) Receiver selects **Carton**

- Cartons are counted **per client**.
- Every time that client reaches **10 cartons**, system adds **1 pallet**.
- Examples:
  - 9 cartons received over time → **0 pallets** (9 pending)
  - 10th carton arrives → **1 pallet** starts
  - 20 cartons → **2 pallets**
- Leftover under 10 stay pending until more cartons are received.

---

## Part 2 — Free period (7 days)

For each new pallet:

- **Day 1–7:** storage is **free**
- No storage invoice for that pallet during this time

---

## Part 3 — When billing starts

- On **Day 8**, that pallet becomes billable.
- System creates a storage invoice for the **first paid month**.
- That invoice covers the **next 30 days** of storage for that pallet.

As long as the pallet is still active (inventory not finished), billing continues in **30-day cycles**.

---

## Part 4 — Storage prices (age-based)

Default rates (admin can change these in the pricing profile):

| How long the pallet has been billed | Default price |
| ----------------------------------- | ------------- |
| Month 1                             | $40 per pallet |
| Months 2–6                          | $50 per pallet |
| 6+ months                           | $70 per pallet |

So older stored pallets cost more than new ones.

---

## Part 5 — When a pallet stops (out of stock)

- Inventory linked to that pallet goes to **zero / out of stock**.
- System **automatically removes 1 pallet**.
- Monthly storage charges for that pallet **stop**.

No manual step needed to close storage when stock is gone.

---

## Part 6 — Pricing profiles (admin control)

This works like the rest of PrepCorex pricing:

1. **Admin sets storage rates** in a pricing profile  
   (Month 1 / Months 2–6 / 6+ months)

2. **Default profile**  
   Applies to clients who don’t have a custom profile

3. **Custom profile**  
   Admin can assign a special profile to a client (lower or higher rates, client-specific deal)

4. **Client visibility**  
   Client can see their storage rates in their pricing / dashboard view

5. **Admin can change prices anytime**  
   Next storage invoices use the updated profile rates

---

## Part 7 — End-to-end examples

### Client A — pallet receive

1. Receiver selects **Pallet**, receives goods
2. System assigns **1 pallet** (Day 1)
3. Days 1–7 → free
4. Day 8 → invoice **$40** (or custom profile rate) for 30 days
5. If still in stock later → next cycle at Month 2–6 rate, etc.
6. Inventory hits 0 → pallet removed → billing stops

### Client B — carton receive

1. Receiver selects **Carton**, receives 4 cartons → pending 4, **0 pallets**
2. Later receives 6 more → total 10 → **1 pallet** starts (Day 1 free period)
3. Same free days → then monthly billing → then auto-remove when out of stock

---

## Simple summary

| Stage | What happens |
| ----- | ------------ |
| Receive as **Pallet** | +1 pallet immediately |
| Receive as **Carton** | +1 pallet every 10 cartons (per client) |
| First 7 days | Free |
| From day 8 | Bill every 30 days by age tier |
| Inventory out of stock | Pallet auto-removed, billing stops |
| Pricing | Admin sets/changes in pricing profile; custom profiles allowed; client can view |

---

## What this means for the business

- Storage charging matches warehouse footprint (**pallets**), not loose product count
- Carton receives are fair: small carton arrivals don’t bill until they fill a pallet (10)
- Free week supports short-turn clients
- Longer storage earns higher rates
- Admin stays in control of pricing; VIP/custom clients get their own profile

---

*PrepCorex / Prep Services FBA LLC*
