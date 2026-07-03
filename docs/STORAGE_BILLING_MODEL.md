# Storage Billing Model

## Goal

Storage billing must follow the real warehouse footprint, not only inventory type. A client can have:

- Actual pallet inventory.
- Product SKUs stored on pallets.
- Product SKUs stored without pallets.
- A mix of pallet-base and product-base storage at the same time.

The system should support all of these without guessing from SKU count alone.

## Billing Policy

Current agreed policy:

- First 7 days are free.
- Invoice is generated on the 8th day.
- The invoice generated on the 8th day covers the next 30 days.
- Pallet storage has age-based monthly pricing:

| Storage Age | Price |
| --- | ---: |
| Month 1 | $40 per pallet |
| Month 2-6 | $50 per pallet |
| 6+ months | $70 per pallet |

Interpretation:

- Days 1-7: free.
- Day 8: first paid storage cycle begins, billed at Month 1 rate.
- The first paid invoice covers Day 8 through Day 37.
- The next paid cycle starts after that 30-day period.
- Month 2-6 pricing applies to paid cycles 2 through 6.
- 6+ months pricing applies from paid cycle 7 onward.

## Storage Methods

Each received inventory unit should belong to one storage method.

### 1. Pallet-Base Storage

Used when inventory occupies one or more pallet positions.

Applies to:

- Client sends actual pallet inventory.
- Receiver places product SKUs on pallets.
- Receiver later consolidates products onto fewer pallets.

Billing unit:

- Active pallet storage position.

Free period:

- First 7 days from pallet position start date.

Invoice trigger:

- On day 8, generate invoice for next 30 days.

### 2. Product-Base Storage

Used when the receiver chooses not to store/charge the products as pallet positions.

Applies to:

- Loose products.
- Shelf/bin storage.
- Product inventory where pallet footprint is not the billing basis.

Billing unit:

- Product-base pricing should be configured separately.
- Recommended default: remaining quantity by receipt age after 7 free days.

Free period:

- First 7 days from product receipt date.

Invoice trigger:

- On day 8, generate invoice for next 30 days for remaining billable product quantity.

Note: product-base pricing is separate from the pallet rates above. The $40/$50/$70 rates are pallet-base rates.

## Receiving Flow

During receiving/putaway, the receiver must choose how storage will be billed.

### If Client Sends Actual Pallets

If inbound inventory type is `pallet`, the system should automatically treat it as pallet-base storage.

For each pallet quantity received:

- Create a pallet storage position.
- Create a storage cycle.
- Set `freeUntil = receivedAt + 7 days`.
- Set `nextInvoiceDate = receivedAt + 7 days`.
- Billing starts on day 8.

### If Client Sends Products

Receiver chooses one of:

1. Place SKUs on pallets.
2. Store as product-base.

#### Place SKUs On Pallets

Receiver records how many pallet positions are occupied and what each pallet contains.

Example:

| Pallet | Contents |
| --- | --- |
| P1 | SKU-A 50, SKU-B 20 |
| P2 | SKU-C 100 |
| P3 | SKU-D 40, SKU-E 10 |

System creates:

- 3 pallet storage positions.
- 3 pallet storage cycles.
- Each cycle has first 7 days free.
- Each cycle bills independently by age tier.

#### Store As Product-Base

Receiver records product receipt quantities under product-base storage.

System creates:

- Product storage lots, linked to SKU and received quantity.
- Free period per lot.
- Invoice after 7 days for remaining quantity according to product-base pricing.

## Outbound Shipping Behavior

Storage reduction depends on storage method.

### Pallet-Base Product Storage

If shipped SKUs are assigned to pallet positions, the system deducts from the pallet contents.

A pallet remains billable while it still contains any quantity.

Example before shipment:

| Pallet | Contents |
| --- | --- |
| P1 | SKU-A 50, SKU-B 20 |
| P2 | SKU-C 100 |
| P3 | SKU-D 40, SKU-E 10 |

If SKU-A ships 50 units:

| Pallet | Contents | Billable? |
| --- | --- | --- |
| P1 | SKU-B 20 | Yes |
| P2 | SKU-C 100 | Yes |
| P3 | SKU-D 40, SKU-E 10 | Yes |

P1 is still billable because it still occupies a pallet position.

If SKU-B ships 20 units afterward:

| Pallet | Contents | Billable? |
| --- | --- | --- |
| P1 | Empty | No |
| P2 | SKU-C 100 | Yes |
| P3 | SKU-D 40, SKU-E 10 | Yes |

P1 closes because it is empty.

### Product-Base Storage

If shipped SKUs are product-base, the system deducts from product storage lots.

Only remaining quantity is billable after the free period.

Example:

| SKU | Received Qty | Shipped Qty | Remaining Qty | Billable Basis |
| --- | ---: | ---: | ---: | --- |
| SKU-A | 50 | 50 | 0 | No charge |
| SKU-B | 20 | 5 | 15 | Charge remaining quantity |

## Consolidation

Warehouse staff must have a consolidation action.

Purpose:

- Move remaining products from multiple pallet positions into fewer pallet positions.
- Close freed pallet positions.
- Keep billing fair and accurate.

Example:

Before consolidation:

| Pallet | Contents |
| --- | --- |
| P1 | SKU-A 5 |
| P2 | SKU-B 10 |
| P3 | SKU-C 3 |

After consolidation:

| Pallet | Contents | Billing Result |
| --- | --- | --- |
| P1 | SKU-A 5, SKU-B 10, SKU-C 3 | Still active |
| P2 | Empty | Close cycle |
| P3 | Empty | Close cycle |

Billable pallets reduce from 3 to 1.

## Recommended Data Model

### `palletStoragePositions`

One document per billable pallet position.

Recommended fields:

- `id`
- `userId`
- `status`: `active` | `closed`
- `source`: `pallet_inventory` | `product_putaway` | `admin_manual`
- `sourceRequestId`
- `sourceBatchId`
- `sourceInventoryIds`
- `palletCode`
- `assignedAt`
- `freeUntil`
- `nextInvoiceDate`
- `paidCycleCount`
- `lastInvoicedAt`
- `lastInvoiceId`
- `lastInvoiceNumber`
- `closedAt`
- `closeReason`
- `createdAt`
- `updatedAt`

### `palletStoragePositions/{positionId}/contents`

One document per SKU on that pallet.

Recommended fields:

- `sku`
- `productName`
- `inventoryId`
- `quantity`
- `receivedAt`
- `updatedAt`

### Product-Base Storage Lots

If product-base storage is used, create product storage lots.

Recommended fields:

- `id`
- `userId`
- `sku`
- `productName`
- `inventoryId`
- `sourceRequestId`
- `sourceBatchId`
- `receivedQuantity`
- `remainingQuantity`
- `receivedAt`
- `freeUntil`
- `nextInvoiceDate`
- `paidCycleCount`
- `lastInvoicedAt`
- `lastInvoiceId`
- `status`: `active` | `closed`

## Existing System Mapping

Current system already has:

- `palletStorageCycles`
- `nextInvoiceDate`
- `lastInvoicedAt`
- monthly storage invoice generation
- admin manual pallet assignment

Recommended implementation path:

1. Reuse `palletStorageCycles` for billing cycles.
2. Add pallet contents tracking for product SKUs placed on pallets.
3. Add storage method selection during receiving/putaway.
4. Add product-base storage lots for non-pallet product storage.
5. Update invoice generation to bill:
   - due pallet cycles by pallet age tier
   - due product-base lots by product-base pricing
6. Add consolidation action to close freed pallet cycles.

## Pallet Rate Tier Logic

Each pallet storage cycle tracks `paidCycleCount`.

When invoice is generated:

| Paid Cycle Number | Rate |
| ---: | ---: |
| 1 | $40 |
| 2-6 | $50 |
| 7+ | $70 |

After invoice creation:

- Increment `paidCycleCount`.
- Set `lastInvoicedAt`.
- Set `lastInvoiceId`.
- Set `lastInvoiceNumber`.
- Set next invoice date 30 days later.

Pseudo logic:

```text
if paidCycleCount == 0:
  rate = 40
elif paidCycleCount >= 1 and paidCycleCount <= 5:
  rate = 50
else:
  rate = 70
```

Because `paidCycleCount = 0` means this is the first paid invoice.

## Invoice Example

Client has 3 active pallet positions.

All are past the 7-day free period.

| Pallet | Paid Cycle | Rate |
| --- | ---: | ---: |
| P1 | 1st paid cycle | $40 |
| P2 | 1st paid cycle | $40 |
| P3 | 1st paid cycle | $40 |

Invoice total:

```text
3 pallets × $40 = $120
```

Next month, if all 3 pallets remain active:

```text
3 pallets × $50 = $150
```

After 6 paid cycles, if they remain active:

```text
3 pallets × $70 = $210
```

## Operational Rules

1. Storage billing starts only after receiving/putaway confirms storage method.
2. First 7 days are free for every new storage position or product-base lot.
3. Day 8 invoice covers the next 30 days.
4. Pallet-base storage bills by active pallet position, not by SKU count.
5. Product-base storage bills by remaining product quantity or configured product-base unit.
6. A pallet stops billing only when empty or manually closed through consolidation.
7. Product-base storage stops billing when the product lot remaining quantity reaches zero.
8. Users can have both pallet-base and product-base storage at the same time.
9. Actual pallet inventory is automatically pallet-base.
10. Admin should be able to override, consolidate, close, or manually assign storage positions.

## UI Requirements

### Receiving / Putaway

For product inbound:

- Choose storage method:
  - Pallet-base
  - Product-base
- If pallet-base:
  - Create pallet positions.
  - Assign SKUs and quantities to each pallet.
- If product-base:
  - Confirm quantities stored as product-base.

For pallet inbound:

- Automatically create pallet-base storage positions from received pallet quantity.

### Outbound

When shipping products:

- If product is pallet-base:
  - Select/deduct from pallet position contents.
  - Auto-close pallet if empty.
- If product is product-base:
  - Deduct from product-base lots.
  - Auto-close lot if remaining quantity is zero.

### Admin Storage Management

Admin needs:

- Active pallet positions list.
- Pallet contents view.
- Product-base storage lots view.
- Consolidate pallets action.
- Close pallet action.
- Assign manual pallet action.
- Storage invoice preview/test run.

## Final Recommendation

Use a hybrid storage model:

- Pallet-base when products physically occupy pallet positions.
- Product-base when products are not stored as pallets.
- Let one client use both at the same time.
- Track actual pallet contents so outbound shipments can reduce pallet storage only when a pallet is empty.
- Keep the 7-day free period and generate the first invoice on day 8 for the next 30 days.
- Apply tiered pallet pricing by paid cycle age:
  - Month 1: $40 per pallet
  - Month 2-6: $50 per pallet
  - 6+ months: $70 per pallet
