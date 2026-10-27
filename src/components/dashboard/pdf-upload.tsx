"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Upload, Loader2, X, FileText, CheckCircle2, Clock, AlertCircle, Plus, ChevronsUpDown, Check } from "lucide-react";
import { uploadPDF, type UploadProgress } from "@/lib/pdf-upload";
import { compressPDF } from "@/lib/pdf-compression";
import { collection, addDoc, serverTimestamp, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getFolderInfo } from "@/lib/pdf-upload";
import type { UploadedPDF, InventoryItem } from "@/types";
import { isIntegrationInventorySource } from "@/lib/integration-inventory-sources";
import { 
  isUploadTimeAllowed, 
  getNewJerseyTimeString, 
  getTimeUntilUploadWindowCloses,
  getTimeUntilUploadWindowOpens,
  formatTimeRemaining
} from "@/lib/time-utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogTrigger, DialogTitle } from "@/components/ui/dialog";

interface PDFUploadProps {
  userId: string;
  userName: string;
  inventory?: InventoryItem[];
  onUploadSuccess?: () => void;
}

interface LabelProductInput {
  id: string;
  productId?: string;
  name?: string;
  shippedUnits: string;
  packOf: string;
}

interface FileUploadState {
  file: File;
  originalFile: File;
  status: "pending" | "compressing" | "uploading" | "success" | "error";
  progress: number;
  error?: string;
  products: LabelProductInput[];
}

const generateProductId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
};

const createEmptyProduct = (): LabelProductInput => ({
  id: generateProductId(),
  productId: undefined,
  name: "",
  shippedUnits: "1",
  packOf: "1",
});

interface InventorySelectButtonProps {
  inventory: InventoryItem[];
  selectedProductId?: string;
  disabled: boolean;
  onSelect: (item: InventoryItem) => void;
}

function InventorySelectButton({ inventory, selectedProductId, disabled, onSelect }: InventorySelectButtonProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filteredInventory = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return inventory
      .filter((item) => item.quantity > 0)
      .filter((item) => !isIntegrationInventorySource((item as { source?: string }).source))
      .filter((item) => item.productName.toLowerCase().includes(normalized));
  }, [inventory, query]);

  const selectedProduct = selectedProductId
    ? inventory.find((item) => item.id === selectedProductId)
    : undefined;

  const handleSelect = (item: InventoryItem) => {
    onSelect(item);
    setOpen(false);
    setQuery("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (disabled || inventory.length === 0) {
          setOpen(false);
          return;
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || inventory.length === 0}
          className="w-full sm:w-56 justify-between"
        >
          <span className="truncate text-left">
            {selectedProduct
              ? `${selectedProduct.productName} (In Stock: ${selectedProduct.quantity})`
              : inventory.length === 0
              ? "No inventory available"
              : "Select from inventory"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </DialogTrigger>
      {inventory.length > 0 && (
        <DialogContent className="p-0">
          <DialogTitle className="sr-only">Select product</DialogTitle>
          <div className="p-3 border-b">
            <Input
              autoFocus
              placeholder="Search products..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {filteredInventory.map((item) => (
              <button
                key={item.id}
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => handleSelect(item)}
              >
                <Check className={`h-4 w-4 ${selectedProductId === item.id ? "opacity-100" : "opacity-0"}`} />
                <div className="flex-1">
                  <div className="font-medium">{item.productName}</div>
                  <div className="text-xs text-muted-foreground">
                    SKU: {item.sku || "N/A"} | In Stock: {item.quantity}
                  </div>
                </div>
              </button>
            ))}
            {filteredInventory.length === 0 && (
              <div className="px-3 py-4 text-sm text-muted-foreground">
                No products match your search.
              </div>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

export function PDFUpload({ userId, userName, inventory = [], onUploadSuccess }: PDFUploadProps) {
  const { toast } = useToast();
  const [fileUploads, setFileUploads] = useState<FileUploadState[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [currentTime, setCurrentTime] = useState<string>(getNewJerseyTimeString());
  const [uploadAllowed, setUploadAllowed] = useState<boolean>(isUploadTimeAllowed());
  const [timeRemaining, setTimeRemaining] = useState<{ hours: number; minutes: number; seconds: number }>(
    uploadAllowed ? getTimeUntilUploadWindowCloses() : getTimeUntilUploadWindowOpens()
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Update time every second
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(getNewJerseyTimeString());
      const allowed = isUploadTimeAllowed();
      setUploadAllowed(allowed);
      setTimeRemaining(allowed ? getTimeUntilUploadWindowCloses() : getTimeUntilUploadWindowOpens());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newFiles: FileUploadState[] = Array.from(files).map((file) => ({
      file,
      originalFile: file,
      status: "pending",
      progress: 0,
      products: [createEmptyProduct()],
    }));

    setFileUploads((prev) => [...prev, ...newFiles]);
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const prepareProductsForUpload = (fileState: FileUploadState) => {
    const normalized = fileState.products.reduce<
      { name: string; quantity: number; productId: string; shippedUnits: number; packOf: number }[]
    >(
      (acc, product) => {
        if (!product.productId) {
          throw new Error(`Select a product from your inventory for ${fileState.originalFile.name}.`);
        }

        const inventoryMatch = inventory.find((item) => item.id === product.productId);
        if (!inventoryMatch) {
          throw new Error(`Product no longer exists in inventory for ${fileState.originalFile.name}. Refresh and try again.`);
        }

        const shippedUnits = Number(product.shippedUnits.trim());
        if (!Number.isFinite(shippedUnits) || shippedUnits <= 0) {
          throw new Error(`Enter shipped units for "${inventoryMatch.productName}" in ${fileState.originalFile.name}.`);
        }

        const packOf = Number(product.packOf.trim());
        if (!Number.isFinite(packOf) || packOf <= 0) {
          throw new Error(`Enter pack size for "${inventoryMatch.productName}" in ${fileState.originalFile.name}.`);
        }

        const totalUnits = shippedUnits * packOf;

        acc.push({
          name: inventoryMatch.productName,
          quantity: totalUnits,
          shippedUnits,
          packOf,
          productId: inventoryMatch.id,
        });
        return acc;
      },
      []
    );

    if (normalized.length === 0) {
      throw new Error(`Add at least one product for ${fileState.originalFile.name}.`);
    }

    return normalized;
  };

  const handleUpload = async () => {
    // Check if uploads are allowed at this time
    if (!isUploadTimeAllowed()) {
      toast({
        variant: "destructive",
        title: "Upload Not Allowed",
        description: `Uploads are currently disabled. Available in ${formatTimeRemaining(
          getTimeUntilUploadWindowOpens()
        )}`,
      });
      return;
    }

    if (fileUploads.length === 0) {
      toast({
        variant: "destructive",
        title: "No Files Selected",
        description: "Please select at least one PDF file to upload.",
      });
      return;
    }

    try {
      fileUploads.forEach(prepareProductsForUpload);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Missing Product Details",
        description: error.message || "Add product name and quantity for every label.",
      });
      return;
    }

    setIsUploading(true);
    const currentDate = new Date();
    const folderInfo = getFolderInfo(currentDate);

    // Upload all files
    const uploadPromises = fileUploads.map(async (fileState, index) => {
      try {
        const labelProducts = prepareProductsForUpload(fileState);

        // Step 1: Compress PDF
        setFileUploads((prev) => {
          const updated = [...prev];
          updated[index] = { ...updated[index], status: "compressing", progress: 0 };
          return updated;
        });

        const compressionResult = await compressPDF(fileState.originalFile);

        // Always proceed with upload, even if compression didn't reduce size significantly
        // Compression is attempted but upload is allowed regardless of final size
        if (!compressionResult.file) {
          // If compression completely failed, use original file
          compressionResult.file = fileState.originalFile;
          compressionResult.compressedSize = fileState.originalFile.size;
          compressionResult.compressionRatio = 0;
        }

        // Step 2: Upload to Firebase Storage
        setFileUploads((prev) => {
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            file: compressionResult.file!,
            status: "uploading",
            progress: 0,
          };
          return updated;
        });

        const result = await uploadPDF(
          compressionResult.file,
          userName,
          (progress: UploadProgress) => {
            setFileUploads((prev) => {
              const updated = [...prev];
              updated[index] = { ...updated[index], progress: progress.progress };
              return updated;
            });
          }
        );

        if (!result.success || !result.storagePath || !result.downloadURL) {
          throw new Error(result.error || "Failed to upload PDF");
        }

        // Step 3: Save metadata to Firestore
        const pdfMetadata: Omit<UploadedPDF, "id"> = {
          fileName: fileState.originalFile.name,
          storagePath: result.storagePath,
          downloadURL: result.downloadURL,
          size: compressionResult.file.size,
          uploadedAt: serverTimestamp(),
          uploadedBy: userId,
          uploadedByName: userName,
          year: folderInfo.year,
          month: folderInfo.month,
          date: folderInfo.date,
          labelProducts: labelProducts,
          status: "pending", // Default status for new labels
        };

        await addDoc(collection(db, "uploadedPDFs"), pdfMetadata);

        // Step 4: Mark as success
        setFileUploads((prev) => {
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            status: "success",
            progress: 100,
          };
          return updated;
        });

        toast({
          title: "PDF Uploaded Successfully",
          description: `${fileState.originalFile.name} has been uploaded.`,
        });
      } catch (error: any) {
        console.error(`Error uploading ${fileState.originalFile.name}:`, error);
        setFileUploads((prev) => {
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            status: "error",
            error: error.message || "Failed to upload PDF",
          };
          return updated;
        });
        toast({
          variant: "destructive",
          title: "Upload Failed",
          description: `Failed to upload ${fileState.originalFile.name}: ${error.message || "Unknown error"}`,
        });
      }
    });

    // Wait for all uploads to complete
    await Promise.all(uploadPromises);

    // Check if all files are done
    const allDone = fileUploads.every(
      (f) => f.status === "success" || f.status === "error"
    );

    if (allDone) {
      // Call success callback
      if (onUploadSuccess) {
        onUploadSuccess();
      }
    }

    setIsUploading(false);
  };

  const addProductEntry = (fileIndex: number) => {
    setFileUploads((prev) =>
      prev.map((file, idx) =>
        idx === fileIndex
          ? { ...file, products: [...file.products, createEmptyProduct()] }
          : file
      )
    );
  };

  const updateProductEntry = (
    fileIndex: number,
    productId: string,
    updates: Partial<LabelProductInput>
  ) => {
    setFileUploads((prev) =>
      prev.map((file, idx) =>
        idx === fileIndex
          ? {
              ...file,
              products: file.products.map((product) =>
                product.id === productId ? { ...product, ...updates } : product
              ),
            }
          : file
      )
    );
  };

  const removeProductEntry = (fileIndex: number, productId: string) => {
    setFileUploads((prev) =>
      prev.map((file, idx) => {
        if (idx !== fileIndex) return file;
        const filtered = file.products.filter((product) => product.id !== productId);
        return {
          ...file,
          products: filtered.length > 0 ? filtered : [createEmptyProduct()],
        };
      })
    );
  };

  const handleRemoveFile = (index: number) => {
    setFileUploads((prev) => prev.filter((_, i) => i !== index));
  };

  const handleClearAll = () => {
    setFileUploads([]);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const pendingFiles = fileUploads.filter((f) => f.status === "pending");
  const uploadingFiles = fileUploads.filter(
    (f) => f.status === "compressing" || f.status === "uploading"
  );
  const successFiles = fileUploads.filter((f) => f.status === "success");
  const errorFiles = fileUploads.filter((f) => f.status === "error");

  return (
    <div className="space-y-4 w-full min-w-0">
      {/* Time Display and Upload Window Info */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>New Jersey Time: <span className="font-mono font-semibold">{currentTime}</span></span>
          </div>
          <div className={`flex items-center gap-2 ${uploadAllowed ? 'text-green-600' : 'text-red-600'}`}>
            {uploadAllowed ? (
              <>
                <CheckCircle2 className="h-4 w-4" />
                <span className="font-medium">Uploads Allowed</span>
                <span className="text-xs font-mono">
                  ({formatTimeRemaining(timeRemaining)} remaining)
                </span>
              </>
            ) : (
              <>
                <AlertCircle className="h-4 w-4" />
                <span className="font-medium">Uploads Disabled</span>
                <span className="text-xs font-mono">
                  ({formatTimeRemaining(timeRemaining)} until available)
                </span>
              </>
            )}
          </div>
        </div>
        
        {!uploadAllowed && (
          <Alert variant="destructive" className="py-2 flex items-center gap-3 [&>svg]:relative [&>svg]:left-0 [&>svg]:top-0 [&>svg]:translate-y-0 [&>svg~*]:pl-0">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <AlertDescription className="text-xs sm:text-sm text-left flex-1">
              Uploads are currently disabled. Available in{" "}
              <span className="font-mono font-semibold">{formatTimeRemaining(timeRemaining)}</span>
            </AlertDescription>
          </Alert>
        )}
        
        {uploadAllowed && (
          <Alert className="py-2 flex items-center gap-3 bg-green-50 border-green-200 [&>svg]:relative [&>svg]:left-0 [&>svg]:top-0 [&>svg]:translate-y-0 [&>svg~*]:pl-0">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-600" />
            <AlertDescription className="text-xs sm:text-sm text-left flex-1 text-green-800">
              Uploads are currently allowed. Window closes in{" "}
              <span className="font-mono font-semibold">{formatTimeRemaining(timeRemaining)}</span>
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 w-full">
        <label className="w-full flex justify-center">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            onChange={handleFileSelect}
            disabled={isUploading}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            className="w-auto min-w-[180px] justify-center"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading || !uploadAllowed}
          >
            <FileText className="h-4 w-4 mr-2 flex-shrink-0" />
            <span className="truncate">
              {fileUploads.length === 0 ? "Select Labels" : `Add More (${fileUploads.length})`}
            </span>
          </Button>
        </label>

        {fileUploads.length > 0 && (
          <div className="flex items-center gap-2 sm:gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearAll}
              disabled={isUploading}
              className="flex-1 sm:flex-initial"
            >
              Clear All
            </Button>
            <Button
              type="button"
              onClick={handleUpload}
              disabled={isUploading || pendingFiles.length === 0 || !uploadAllowed}
              className="flex items-center gap-2 flex-1 sm:flex-initial"
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                  <span className="hidden sm:inline">Uploading...</span>
                  <span className="sm:hidden">Upload...</span>
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 flex-shrink-0" />
                  <span className="hidden sm:inline">
                    Upload {pendingFiles.length > 0 ? `${pendingFiles.length} ` : ""}Label{pendingFiles.length !== 1 ? "s" : ""}
                  </span>
                  <span className="sm:hidden">
                    Upload {pendingFiles.length > 0 ? pendingFiles.length : ""}
                  </span>
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {fileUploads.length > 0 && (
        <div className="space-y-3 max-h-[400px] overflow-y-auto">
          {fileUploads.map((fileState, index) => {
            const productInputsDisabled = fileState.status !== "pending" || isUploading;
            return (
            <div
              key={index}
              className={`p-3 border rounded-lg ${
                fileState.status === "success"
                  ? "bg-green-50 border-green-200"
                  : fileState.status === "error"
                  ? "bg-red-50 border-red-200"
                  : "bg-muted/50"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {fileState.status === "success" ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                  ) : fileState.status === "error" ? (
                    <X className="h-4 w-4 text-red-600 flex-shrink-0" />
                  ) : (
                    <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium truncate block">
                      {fileState.originalFile.name}
                    </span>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <span>Original: {formatFileSize(fileState.originalFile.size)}</span>
                      {fileState.file !== fileState.originalFile && (
                        <span className="text-green-600">
                          → Compressed: {formatFileSize(fileState.file.size)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {fileState.status !== "success" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveFile(index)}
                    disabled={isUploading}
                    className="h-6 w-6 p-0"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>

              {(fileState.status === "compressing" || fileState.status === "uploading") && (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                    <span>
                      {fileState.status === "compressing" ? "Compressing..." : "Uploading..."}
                    </span>
                    <span>{fileState.progress}%</span>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-300 ${
                        fileState.status === "compressing" ? "bg-yellow-500" : "bg-primary"
                      }`}
                      style={{ width: `${fileState.progress}%` }}
                    />
                  </div>
                </div>
              )}

              {fileState.status === "error" && fileState.error && (
                <div className="mt-2 text-xs text-red-600">{fileState.error}</div>
              )}

              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Products in this label
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => addProductEntry(index)}
                    disabled={productInputsDisabled}
                  >
                    <Plus className="h-3 w-3" />
                    Add product
                  </Button>
                </div>
                <div className="space-y-2">
                  {fileState.products.map((product) => (
                    <div
                      key={product.id}
                      className="flex flex-col sm:flex-row gap-2 rounded-md bg-white/70 p-2 border border-border/60"
                    >
                      <div className="flex flex-col sm:flex-row gap-2 flex-1">
                        <InventorySelectButton
                          inventory={inventory}
                          selectedProductId={product.productId}
                          disabled={productInputsDisabled}
                          onSelect={(item) =>
                            updateProductEntry(index, product.id, {
                              productId: item.id,
                              name: item.productName,
                            })
                          }
                        />
                        <div className="flex flex-col sm:flex-row gap-2 flex-1">
                          <Input
                            type="number"
                            min="1"
                            placeholder="Shipped units"
                            value={product.shippedUnits}
                            onChange={(e) =>
                              updateProductEntry(index, product.id, { shippedUnits: e.target.value })
                            }
                            disabled={productInputsDisabled}
                            className="w-full sm:w-28 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <Input
                            type="number"
                            min="1"
                            placeholder="Pack of"
                            value={product.packOf}
                            onChange={(e) =>
                              updateProductEntry(index, product.id, { packOf: e.target.value })
                            }
                            disabled={productInputsDisabled}
                            className="w-full sm:w-24 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground"
                        onClick={() => removeProductEntry(index, product.id)}
                        disabled={productInputsDisabled}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Select every SKU from your inventory and record the packed quantity.
                </p>
              </div>

              {fileState.status === "success" && (
                <div className="mt-2 text-xs text-green-600">Uploaded successfully!</div>
              )}
            </div>
          );
          })}
        </div>
      )}

      {fileUploads.length > 0 && (
        <div className="text-xs text-muted-foreground">
          {successFiles.length > 0 && (
            <span className="text-green-600">
              {successFiles.length} uploaded successfully
            </span>
          )}
          {successFiles.length > 0 && errorFiles.length > 0 && " • "}
          {errorFiles.length > 0 && (
            <span className="text-red-600">{errorFiles.length} failed</span>
          )}
          {uploadingFiles.length > 0 && (
            <>
              {successFiles.length > 0 || errorFiles.length > 0 ? " • " : ""}
              <span className="text-blue-600">{uploadingFiles.length} uploading...</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}







