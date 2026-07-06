"use client";

import { useState, useMemo } from "react";
import type { ProductReturn } from "@/types";
import { useCollection } from "@/hooks/use-collection";
import { useAuth } from "@/hooks/use-auth";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Eye, Clock, CheckCircle, XCircle, Package, Truck, Plus } from "lucide-react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddReturnTrackingDialog } from "@/components/inventory/add-return-tracking-dialog";
import { getProductReturnImageUrls } from "@/lib/product-return-images";

function formatDate(date: ProductReturn["createdAt"]) {
  if (!date) return "N/A";
  if (typeof date === 'string') {
    return format(new Date(date), "PPP");
  }
  if (date && typeof date === 'object' && 'seconds' in date) {
    return format(new Date(date.seconds * 1000), "PPP");
  }
  return "N/A";
}

function getStatusBadge(status: ProductReturn["status"]) {
  const base = "flex items-center gap-1.5 w-fit rounded-md text-xs font-medium";
  switch (status) {
    case "pending":
      return <Badge variant="outline" className={`${base} border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 dark:text-amber-300`}><Clock className="h-3 w-3" />Pending</Badge>;
    case "approved":
      return <Badge variant="default" className={`${base} bg-blue-500 hover:bg-blue-600`}><CheckCircle className="h-3 w-3" />Approved</Badge>;
    case "in_progress":
      return <Badge variant="default" className={`${base} bg-blue-500 hover:bg-blue-600`}><Package className="h-3 w-3" />In Progress</Badge>;
    case "closed":
      return <Badge variant="default" className={`${base} bg-green-600 hover:bg-green-700`}><CheckCircle className="h-3 w-3" />Closed</Badge>;
    case "cancelled":
      return <Badge variant="destructive" className={base}><XCircle className="h-3 w-3" />Cancelled</Badge>;
    default:
      return <Badge variant="outline" className={base}>{status}</Badge>;
  }
}

export interface ProductReturnTableProps {
  /** When provided, filter is controlled by parent (e.g. from stat card on page). */
  statusFilter?: string;
  onStatusFilterChange?: (value: string) => void;
}

export function ProductReturnTable({ statusFilter: statusFilterProp, onStatusFilterChange }: ProductReturnTableProps = {}) {
  const { userProfile } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [internalStatusFilter, setInternalStatusFilter] = useState("all");
  const statusFilter = statusFilterProp ?? internalStatusFilter;
  const setStatusFilter = onStatusFilterChange ?? setInternalStatusFilter;
  const [selectedReturn, setSelectedReturn] = useState<ProductReturn | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [trackingDialogOpen, setTrackingDialogOpen] = useState(false);
  const [trackingTargetId, setTrackingTargetId] = useState<string | null>(null);

  const canAddTracking = (status: ProductReturn["status"]) =>
    status === "pending" || status === "approved" || status === "in_progress";

  const { data: returns, loading } = useCollection<ProductReturn>(
    userProfile ? `users/${userProfile.uid}/productReturns` : ""
  );

  const filteredReturns = useMemo(() => {
    let filtered = returns;

    // Filter by status
    if (statusFilter !== "all") {
      filtered = filtered.filter((r) => r.status === statusFilter);
    }

    // Filter by search term
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.productName?.toLowerCase().includes(term) ||
          r.newProductName?.toLowerCase().includes(term) ||
          (r.sku && r.sku.toLowerCase().includes(term)) ||
          (r.newProductSku && r.newProductSku.toLowerCase().includes(term))
      );
    }

    // Sort by created date (newest first)
    return filtered.sort((a, b) => {
      const aDate = typeof a.createdAt === 'string' 
        ? new Date(a.createdAt).getTime()
        : (a.createdAt as any)?.seconds 
          ? (a.createdAt as any).seconds * 1000 
          : 0;
      const bDate = typeof b.createdAt === 'string'
        ? new Date(b.createdAt).getTime()
        : (b.createdAt as any)?.seconds
          ? (b.createdAt as any).seconds * 1000
          : 0;
      return bDate - aDate;
    });
  }, [returns, statusFilter, searchTerm]);

  const handleViewDetails = (returnItem: ProductReturn) => {
    setSelectedReturn(returnItem);
    setIsDetailsOpen(true);
  };

  const openTrackingDialog = (returnItem: ProductReturn) => {
    setSelectedReturn(returnItem);
    setTrackingTargetId(returnItem.id ?? null);
    setTrackingDialogOpen(true);
  };

  const trackingDialogReturn = useMemo(() => {
    if (!trackingTargetId) return selectedReturn;
    return returns.find((r) => r.id === trackingTargetId) ?? selectedReturn;
  }, [returns, trackingTargetId, selectedReturn]);

  if (loading) {
    return (
      <div className="rounded-xl border-2 border-border/50 bg-muted/20 p-8 text-center">
        <p className="text-muted-foreground font-medium">Loading returns...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by product name or SKU..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 rounded-lg h-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px] rounded-lg h-10 border-border/80">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-xl border-2 border-border/50 overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b bg-muted/40">
              <TableHead className="font-semibold">Product</TableHead>
              <TableHead className="font-semibold">Type</TableHead>
              <TableHead className="font-semibold">Quantity</TableHead>
              <TableHead className="font-semibold">Progress</TableHead>
              <TableHead className="font-semibold">Status</TableHead>
              <TableHead className="font-semibold">Created</TableHead>
              <TableHead className="font-semibold text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredReturns.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12">
                  <Package className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-muted-foreground font-medium">No return requests found</p>
                  <p className="text-sm text-muted-foreground/80 mt-1">
                    {statusFilter !== "all" ? "Try changing the status filter." : "Create a new request to get started."}
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              filteredReturns.map((returnItem) => {
                const progress = returnItem.requestedQuantity > 0
                  ? Math.round((returnItem.receivedQuantity / returnItem.requestedQuantity) * 100)
                  : 0;
                const productName = returnItem.productName || returnItem.newProductName || "N/A";
                const hasShipping = returnItem.additionalServices?.shipToAddress;
                const trackingCount = returnItem.returnTrackings?.length ?? 0;

                return (
                  <TableRow key={returnItem.id} className="transition-colors hover:bg-muted/50">
                    <TableCell className="font-medium">{productName}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="rounded-md text-xs font-medium">
                        {returnItem.type === "existing" ? "Existing" : "New"}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {returnItem.receivedQuantity} / {returnItem.requestedQuantity}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-[90px]">
                        <div className="flex-1 bg-muted rounded-full h-2.5 overflow-hidden">
                          <div
                            className="bg-orange-500 h-2.5 rounded-full transition-all duration-300"
                            style={{ width: `${Math.min(progress, 100)}%` }}
                          />
                        </div>
                        <span className="text-sm text-muted-foreground w-10 text-right tabular-nums">
                          {progress}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(returnItem.status)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{formatDate(returnItem.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {trackingCount > 0 ? (
                          <Badge variant="outline" className="text-[10px] mr-1">
                            <Truck className="h-3 w-3 mr-1" />
                            {trackingCount}
                          </Badge>
                        ) : null}
                        {canAddTracking(returnItem.status) && returnItem.id ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 rounded-md text-xs"
                            onClick={() => openTrackingDialog(returnItem)}
                          >
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            Tracking
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 rounded-md"
                          onClick={() => handleViewDetails(returnItem)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {hasShipping && returnItem.status === "closed" && (
                          <Badge variant="outline" className="flex items-center gap-1 rounded-md text-xs">
                            <Truck className="h-3 w-3" />
                            Shipped
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Details Dialog */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-3xl h-[90vh] flex flex-col overflow-hidden p-0">
          <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-4">
            <DialogTitle>Return Request Details</DialogTitle>
            <DialogDescription>
              View detailed information and activity log
            </DialogDescription>
          </DialogHeader>
          {selectedReturn && (
            <Tabs defaultValue="details" className="flex-1 flex flex-col min-h-0 px-6 pb-6">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="logs">Logs</TabsTrigger>
              </TabsList>
              
              <TabsContent value="details" className="flex-1 overflow-y-auto min-h-0 pr-4 custom-scrollbar mt-0">
                <div className="space-y-6">
                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Product Name</div>
                    <div className="font-medium">
                      {selectedReturn.productName || selectedReturn.newProductName || "N/A"}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">SKU</div>
                    <div className="font-medium">
                      {selectedReturn.sku || selectedReturn.newProductSku || "N/A"}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Type</div>
                    <div className="font-medium">
                      {selectedReturn.type === "existing" ? "Existing Product" : "New Inventory"}
                      {selectedReturn.type === "existing" && selectedReturn.returnType && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({selectedReturn.returnType === "combine" ? "Combine" : "Partial"})
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Status</div>
                    <div>{getStatusBadge(selectedReturn.status)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Requested Quantity</div>
                    <div className="font-medium">{selectedReturn.requestedQuantity}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Received Quantity</div>
                    <div className="font-medium">{selectedReturn.receivedQuantity}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Created</div>
                    <div className="font-medium">{formatDate(selectedReturn.createdAt)}</div>
                  </div>
                  {selectedReturn.closedAt && (
                    <div>
                      <div className="text-sm text-muted-foreground">Closed</div>
                      <div className="font-medium">
                        {formatDate(selectedReturn.closedAt)}
                      </div>
                    </div>
                  )}
                </div>

                {/* Progress */}
                <div>
                  <div className="text-sm text-muted-foreground mb-2">Progress</div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-muted rounded-full h-3">
                      <div
                        className="bg-primary h-3 rounded-full transition-all"
                        style={{
                          width: `${Math.min(
                            (selectedReturn.receivedQuantity / selectedReturn.requestedQuantity) * 100,
                            100
                          )}%`,
                        }}
                      />
                    </div>
                    <span className="text-sm font-medium">
                      {selectedReturn.receivedQuantity} / {selectedReturn.requestedQuantity}
                    </span>
                  </div>
                </div>

                {/* Return tracking for dock match */}
                {canAddTracking(selectedReturn.status) && (
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="text-sm font-medium">Return shipment tracking</div>
                      {userProfile && selectedReturn.id ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openTrackingDialog(selectedReturn)}
                        >
                          <Plus className="h-3.5 w-3.5 mr-1" />
                          Add tracking
                        </Button>
                      ) : null}
                    </div>
                    {(selectedReturn.returnTrackings ?? []).length > 0 ? (
                      <div className="space-y-2">
                        {selectedReturn.returnTrackings!.map((t) => (
                          <div
                            key={t.id}
                            className="flex items-center justify-between rounded-md border px-3 py-2 text-sm font-mono"
                          >
                            <span>{t.trackingNumber}</span>
                            {t.carrier ? (
                              <span className="text-xs text-muted-foreground uppercase">
                                {t.carrier}
                              </span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Add carrier tracking so warehouse can match your parcel at the dock.
                      </p>
                    )}
                  </div>
                )}

                {/* User Remarks */}
                {selectedReturn.userRemarks && (
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Your Remarks</div>
                    <div className="p-3 bg-muted rounded-md">{selectedReturn.userRemarks}</div>
                  </div>
                )}

                {getProductReturnImageUrls(selectedReturn).length > 0 && (
                  <div>
                    <div className="text-sm text-muted-foreground mb-2">Product image</div>
                    <div className="flex flex-wrap gap-3">
                      {getProductReturnImageUrls(selectedReturn).map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block"
                        >
                          <img
                            src={url}
                            alt="Product return"
                            className="h-24 w-24 rounded-lg border object-cover hover:opacity-90"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Admin Remarks */}
                {selectedReturn.adminRemarks && (
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Admin Remarks</div>
                    <div className="p-3 bg-muted rounded-md">{selectedReturn.adminRemarks}</div>
                  </div>
                )}

                {/* Additional Services */}
                {selectedReturn.additionalServices && (
                  <div>
                    <div className="text-sm font-medium mb-2">Additional Services</div>
                    <div className="space-y-2">
                      {selectedReturn.additionalServices.packIntoBoxes && (
                        <div className="flex items-center gap-2">
                          <Package className="h-4 w-4 text-muted-foreground" />
                          <span>Pack into Boxes</span>
                          {selectedReturn.additionalServices.boxesCount && (
                            <Badge variant="outline">
                              {selectedReturn.additionalServices.boxesCount} boxes
                            </Badge>
                          )}
                        </div>
                      )}
                      {selectedReturn.additionalServices.placeOnPallet && (
                        <div className="flex items-center gap-2">
                          <Package className="h-4 w-4 text-muted-foreground" />
                          <span>Place on Pallet</span>
                          {selectedReturn.additionalServices.palletsCount && (
                            <Badge variant="outline">
                              {selectedReturn.additionalServices.palletsCount} pallets
                            </Badge>
                          )}
                        </div>
                      )}
                      {selectedReturn.additionalServices.shipToAddress && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Truck className="h-4 w-4 text-muted-foreground" />
                            <span>Ship to Address</span>
                          </div>
                          {selectedReturn.additionalServices.shippingAddress && (
                            <div className="pl-6 text-sm text-muted-foreground">
                              {selectedReturn.additionalServices.shippingAddress.name && (
                                <div>{selectedReturn.additionalServices.shippingAddress.name}</div>
                              )}
                              <div>{selectedReturn.additionalServices.shippingAddress.address}</div>
                              {selectedReturn.additionalServices.shippingAddress.city && (
                                <div>
                                  {selectedReturn.additionalServices.shippingAddress.city}
                                  {selectedReturn.additionalServices.shippingAddress.state && `, ${selectedReturn.additionalServices.shippingAddress.state}`}
                                  {selectedReturn.additionalServices.shippingAddress.zipCode && ` ${selectedReturn.additionalServices.shippingAddress.zipCode}`}
                                </div>
                              )}
                              {selectedReturn.additionalServices.shippingAddress.country && (
                                <div>{selectedReturn.additionalServices.shippingAddress.country}</div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Pricing */}
                {selectedReturn.pricing && (
                  <div>
                    <div className="text-sm font-medium mb-2">Pricing</div>
                    <div className="space-y-1 text-sm">
                      {selectedReturn.pricing.returnFee !== undefined && (
                        <div className="flex justify-between">
                          <span>Return Handling:</span>
                          <span>${selectedReturn.pricing.returnFee.toFixed(2)} per unit</span>
                        </div>
                      )}
                      {selectedReturn.pricing.packingFee !== undefined && (
                        <div className="flex justify-between">
                          <span>Packing Fee:</span>
                          <span>${selectedReturn.pricing.packingFee.toFixed(2)}</span>
                        </div>
                      )}
                      {selectedReturn.pricing.palletFee !== undefined && (
                        <div className="flex justify-between">
                          <span>Pallet Fee:</span>
                          <span>${selectedReturn.pricing.palletFee.toFixed(2)}</span>
                        </div>
                      )}
                      {selectedReturn.pricing.shippingFee !== undefined && (
                        <div className="flex justify-between">
                          <span>Shipping Fee:</span>
                          <span>${selectedReturn.pricing.shippingFee.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-bold border-t pt-2 mt-2">
                        <span>Total:</span>
                        <span>${selectedReturn.pricing.total.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Invoice Link */}
                {selectedReturn.invoiceNumber && (
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Invoice</div>
                    <Badge variant="outline">{selectedReturn.invoiceNumber}</Badge>
                  </div>
                )}

                  </div>
              </TabsContent>

              <TabsContent value="logs" className="flex-1 overflow-y-auto min-h-0 pr-4 custom-scrollbar mt-0">
                <div className="space-y-6">
                    {/* Receiving Log */}
                    {selectedReturn.receivingLog && selectedReturn.receivingLog.length > 0 ? (
                      <div>
                        <div className="text-sm font-medium mb-3">Receiving History</div>
                        <div className="space-y-2">
                          {selectedReturn.receivingLog.map((log, index) => (
                            <div key={index} className="p-3 bg-muted rounded-md">
                              <div className="flex justify-between items-start">
                                <div>
                                  <div className="font-medium">+{log.quantity} units received</div>
                                  {log.notes && (
                                    <div className="text-sm text-muted-foreground mt-1">{log.notes}</div>
                                  )}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {formatDate(log.receivedAt)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        No receiving history yet
                      </div>
                    )}

                    {/* Shipping Log */}
                    {selectedReturn.shippingLog && selectedReturn.shippingLog.length > 0 ? (
                      <div>
                        <div className="text-sm font-medium mb-3">Shipping History</div>
                        <div className="space-y-2">
                          {selectedReturn.shippingLog.map((log, index) => (
                            <div key={index} className="p-3 bg-muted rounded-md">
                              <div className="flex justify-between items-start">
                                <div>
                                  <div className="font-medium">-{log.quantity} units shipped</div>
                                  {log.notes && (
                                    <div className="text-sm text-muted-foreground mt-1">{log.notes}</div>
                                  )}
                                  {log.invoiceNumber && (
                                    <Badge variant="outline" className="mt-2">
                                      Invoice: {log.invoiceNumber}
                                    </Badge>
                                  )}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {formatDate(log.shippedAt)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        No shipping history yet
                      </div>
                    )}

                    {/* Summary */}
                    {(selectedReturn.receivingLog && selectedReturn.receivingLog.length > 0) || 
                     (selectedReturn.shippingLog && selectedReturn.shippingLog.length > 0) ? (
                      <div className="p-4 bg-muted rounded-lg">
                        <div className="text-sm font-medium mb-2">Summary</div>
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between">
                            <span>Total Received:</span>
                            <span className="font-medium">{selectedReturn.receivedQuantity} units</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Total Shipped:</span>
                            <span className="font-medium">{selectedReturn.shippedQuantity || 0} units</span>
                          </div>
                          <div className="flex justify-between border-t pt-2 mt-2">
                            <span className="font-medium">Remaining:</span>
                            <span className="font-medium">
                              {selectedReturn.receivedQuantity - (selectedReturn.shippedQuantity || 0)} units
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      {trackingDialogReturn && userProfile && trackingDialogReturn.id ? (
        <AddReturnTrackingDialog
          open={trackingDialogOpen}
          onOpenChange={(open) => {
            setTrackingDialogOpen(open);
            if (!open) setTrackingTargetId(null);
          }}
          userId={userProfile.uid}
          returnId={trackingDialogReturn.id}
          productName={
            trackingDialogReturn.productName || trackingDialogReturn.newProductName || "Product return"
          }
          onAdded={() => {
            const fresh = returns.find((r) => r.id === trackingDialogReturn.id);
            if (fresh) setSelectedReturn(fresh);
          }}
        />
      ) : null}
    </div>
  );
}

