import jsPDF from 'jspdf';
import type { ShippedItem } from '@/types';

interface User {
  name: string;
  email: string;
  phone?: string;
  address?: string;
}

interface InvoiceData {
  invoiceNumber: string;
  date: string;
  orderNumber: string;
  soldTo: User;
  fbm: string;
  additionalServices?: {
    bubbleWrapFeet?: number;
    stickerRemovalItems?: number;
    warningLabels?: number;
    pricePerFoot?: number;
    pricePerItem?: number;
    pricePerLabel?: number;
    total?: number;
  };
  items: Array<{
    quantity: number;
    productName: string;
    shipDate?: string;
    packaging: string;
    shipTo: string;
    unitPrice: number;
    amount: number;
  }>;
  userId?: string;
  status?: 'pending' | 'paid';
  subtotal?: number;
  grandTotal?: number;
  grossTotal?: number;
  discountType?: "amount" | "percent";
  discountValue?: number;
  discountAmount?: number;
  lateFeeAmount?: number;
  lateFeeReason?: string;
  adminAdditionalCharges?: Array<{ id: string; name: string; amount: number }>;
  type?: string;
  isContainerHandling?: boolean;
  storageType?: string;
}

async function buildInvoiceDoc(data: InvoiceData): Promise<jsPDF> {
  try {
    // Validate required data
    if (!data.invoiceNumber || !data.date || !data.items || data.items.length === 0) {
      throw new Error('Missing required invoice data: invoiceNumber, date, or items');
    }

    // Create PDF with A4 size
    const doc = new jsPDF('p', 'mm', 'a4');
    
    // Set up page dimensions for A4
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const rightGutter = 10; // extra space on the right edge
    let yPos = margin;
    let headerLogoHeightUsed = 0;
  
  // Add watermark logo (centered, large, semi-transparent)
  try {
    const logoImg = new Image();
    logoImg.crossOrigin = 'anonymous';
    logoImg.src = '/Prep.png';
    
    await new Promise((resolve) => {
      logoImg.onload = () => {
        try {
          // Add watermark logo in the center of the page
          // Position: center of page, slightly transparent
          const watermarkWidth = 120;
          const watermarkHeight = 80;
          const xPos = (pageWidth - watermarkWidth) / 2;
          const yPosWatermark = (pageHeight - watermarkHeight) / 2;
          
          // Save the current graphics state
          doc.saveGraphicsState();
          
          // Set global alpha for transparency (watermark effect)
          doc.setGState(doc.GState({opacity: 0.12}));
          
          // Add the watermark logo
          doc.addImage(logoImg, 'PNG', xPos, yPosWatermark, watermarkWidth, watermarkHeight);
          
          // Restore graphics state
          doc.restoreGraphicsState();

          // No header logo; only watermark as requested
          headerLogoHeightUsed = 0;
          
          resolve(null);
        } catch (error) {
          console.error('Error adding watermark logo to PDF:', error);
          resolve(null);
        }
      };
      logoImg.onerror = () => {
        console.warn('Could not load logo for watermark');
        resolve(null);
      };
      // Set a timeout to prevent hanging
      setTimeout(() => resolve(null), 1000);
    });
  } catch (error) {
    console.error('Error loading watermark logo:', error);
  }
  
  // Company name
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  // Push company name below header logo if rendered
  yPos += headerLogoHeightUsed;
  // Set brand color for company name (#ff9100)
  doc.setTextColor(255, 145, 0);
  doc.text('PREP SERVICES FBA', margin, yPos);
  // Reset to black for the rest of the document
  doc.setTextColor(0, 0, 0);
  
  yPos += 8;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('7000 Atrium Way B05', margin, yPos);
  
  yPos += 5;
  doc.text('Mount Laurel NJ, 08054', margin, yPos);
  
  yPos += 5;
  doc.text('TEL: (347) 661-3010', margin, yPos);
  
  yPos += 5;
  doc.text('Email: INFO@PREPSERVICESFBA.COM', margin, yPos);
  const companyBlockBottomY = yPos;
  
  // Invoice details (top right)
  const invoiceDetailsStart = pageWidth - margin - rightGutter - 60; // leave gutter on the right
  yPos = margin;
  
  doc.setFont('helvetica', 'bold');
  doc.text('INVOICE #:', invoiceDetailsStart, yPos);
  doc.text(data.invoiceNumber, invoiceDetailsStart + 30, yPos);
  
  yPos += 7;
  doc.text('DATE:', invoiceDetailsStart, yPos);
  // Normalize incoming date into DD/MM/YYYY
  let formattedDate = data.date;
  try {
    const d = new Date(data.date);
    if (!isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      formattedDate = `${dd}/${mm}/${yyyy}`;
    }
  } catch {}
  doc.text(formattedDate, invoiceDetailsStart + 30, yPos);
  
  // Horizontal line placed below the company block to avoid overlap
  yPos = Math.max(companyBlockBottomY + 8, 50);
  doc.line(margin, yPos, pageWidth - margin - rightGutter, yPos);
  
  // Sold To section (left column)
  yPos += 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('SOLD TO:', margin, yPos);
  
  yPos += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const soldToTopY = yPos - 7;
  const soldToLines = data.soldTo.name.split('\n');
  soldToLines.forEach((line, index) => {
    doc.text(line, margin, yPos + (index * 5));
  });
  
  // Track the bottom of the left column content
  let leftColumnBottomY = yPos + (soldToLines.length - 1) * 5;
  
  if (data.soldTo.address) {
    leftColumnBottomY += 7; // Add spacing between name and address
    doc.text(data.soldTo.address, margin, leftColumnBottomY);
  }
  
  if (data.soldTo.phone) {
    leftColumnBottomY += 5;
    doc.text(`TEL: ${data.soldTo.phone}`, margin, leftColumnBottomY);
  }
  
  // Add email to Sold To section
  if (data.soldTo.email) {
    leftColumnBottomY += 5;
    doc.text(`EMAIL: ${data.soldTo.email}`, margin, leftColumnBottomY);
  }
  
  // Notes section
  // Start notes below the Sold To column and the horizontal line
  yPos = Math.max(yPos, leftColumnBottomY) + 15;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('NOTE: Please make all payments to Prep Services FBA LLC. All prices are F.O.B.', margin, yPos);
  
  yPos += 8;
  doc.setFontSize(8);
  
  // Create a small table for notes
  doc.text('FOB POINT:', margin, yPos);
  doc.text('NEW JERSEY', margin + 30, yPos);
  
  yPos += 5;
  doc.text('TERMS:', margin, yPos);
  doc.text('NET', margin + 30, yPos);
  
  yPos += 5;
  doc.text('SHIPPED VIA:', margin, yPos);
  doc.text('Standard', margin + 30, yPos);
  
  // Itemized table
  yPos += 12;
  const tableStartY = yPos;

  // Check if this is a storage invoice
  const isStorageInvoice = data.type === 'storage';
  const isProductBaseStorage = data.storageType === 'product_base';
  const isPalletBaseStorage = data.storageType === 'pallet_base';

  // Table headers
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  const tableRight = pageWidth - margin - rightGutter; // ~185mm
  const colQty = margin;                  // 15
  const colProduct = margin + 25;         // 40
  
  // Declare currentY outside the if/else blocks so it's accessible after
  let currentY = tableStartY + 10;
  
  if (isStorageInvoice) {
    // Storage invoice: 5 columns (Qty, Product, Date, Price per Pallet/Item, Amount)
    // Calculate positions from left to right for proper order
    const colDate = colProduct + 50;           // ~90mm (after Product)
    const colPricePerPallet = colDate + 40;    // ~130mm (after Date, with more spacing)
    const colAmount = tableRight;              // 185mm (right-aligned)
    
    // Use "Price per Item" for Product Base, "Price per Pallet" for Pallet Base
    const priceColumnHeader = isProductBaseStorage ? 'PRICE PER ITEM' : 'PRICE PER PALLET';
    
    doc.text('QUANTITY', colQty, tableStartY);
    doc.text('PRODUCT', colProduct, tableStartY);
    doc.text('DATE', colDate, tableStartY);
    doc.text(priceColumnHeader, colPricePerPallet, tableStartY, { align: 'right' });
    doc.text('AMOUNT', colAmount, tableStartY, { align: 'right' });
    
    // Horizontal line under headers
    doc.line(margin, tableStartY + 3, pageWidth - margin - rightGutter, tableStartY + 3);
    
    // Table rows
    currentY = tableStartY + 10;
    data.items.forEach((item, index) => {
      if (currentY > 250) {
        // New page if needed
        doc.addPage();
        currentY = 20;
      }
      
      const safeItem: any = item as any;
      const qty = Number(safeItem?.quantity || 0);
      const productName = String(safeItem?.productName || safeItem?.description || '');
      // For storage invoices, use shipDate or date field, format it properly
      let dateValue = String(safeItem?.shipDate || safeItem?.date || '');
      // If date is in format "YYYY-MM" (like "2025-12"), format it nicely
      if (dateValue.match(/^\d{4}-\d{2}$/)) {
        const [year, month] = dateValue.split('-');
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthIndex = parseInt(month, 10) - 1;
        dateValue = `${monthNames[monthIndex] || month} ${year}`;
      }
      const unitPrice = Number(safeItem?.unitPrice || 0);
      const amount = Number(safeItem?.amount || 0);

      doc.setFont('helvetica', 'normal');
      doc.text(String(qty), colQty, currentY);
      doc.text(productName.substring(0, 35), colProduct, currentY);
      doc.text(dateValue.substring(0, 15), colDate, currentY);
      doc.text(`$${unitPrice.toFixed(2)}`, colPricePerPallet, currentY, { align: 'right' });
      doc.text(`$${amount.toFixed(2)}`, colAmount, currentY, { align: 'right' });
      
      currentY += 7;
    });
  } else {
    // Regular invoice: 7 columns (Qty, Product, Date, SKU, Pack, Unit Price, Amount)
    const colAmount = tableRight;           // 185 (right-aligned)
    const colUnitPrice = colAmount - 22;    // right-aligned
    const colPackaging = colUnitPrice - 35; // extra spacing from Unit Price
    const colSku = colPackaging - 26;       // 111 (left-aligned)
    const colShipDate = colSku - 26;        // 85 (left-aligned)

    doc.text('QUANTITY', colQty, tableStartY);
    doc.text('PRODUCT', colProduct, tableStartY);
    doc.text('DATE', colShipDate, tableStartY);
    doc.text('SKU', colSku, tableStartY);
    doc.text('PACK', colPackaging, tableStartY);
    doc.text('UNIT PRICE', colUnitPrice, tableStartY, { align: 'right' });
    doc.text('AMOUNT', colAmount, tableStartY, { align: 'right' });
    
    // Horizontal line under headers
    doc.line(margin, tableStartY + 3, pageWidth - margin - rightGutter, tableStartY + 3);
    
    // Table rows
    currentY = tableStartY + 10;
    data.items.forEach((item, index) => {
      if (currentY > 250) {
        // New page if needed
        doc.addPage();
        currentY = 20;
      }
      
      const safeItem: any = item as any;
      const qty = Number(safeItem?.quantity || 0);
      const productName = String(safeItem?.productName || safeItem?.description || '');
      const shipDate = String(safeItem?.shipDate || '');
      const sku = String(safeItem?.sku || '');
      const packaging = String(safeItem?.packaging || '');
      const unitPrice = Number(safeItem?.unitPrice || 0);
      const amount = Number(safeItem?.amount || 0);

      doc.setFont('helvetica', 'normal');
      doc.text(String(qty), colQty, currentY);
      doc.text(productName.substring(0, 30), colProduct, currentY);
      doc.text(shipDate.substring(0, 10), colShipDate, currentY);
      doc.text(sku.substring(0, 14), colSku, currentY);
      doc.text(packaging.substring(0, 12), colPackaging, currentY);
      doc.text(`$${unitPrice.toFixed(2)}`, colUnitPrice, currentY, { align: 'right' });
      doc.text(`$${amount.toFixed(2)}`, colAmount, currentY, { align: 'right' });
      
      currentY += 7;
    });
  }
  
  // Calculate totals
  const itemsSubtotal = data.items.reduce((sum, item: any) => sum + Number((item as any)?.amount || 0), 0);
  const additionalTotal = Number(data.additionalServices?.total || 0);
  const adminChargesTotal = (data.adminAdditionalCharges ?? []).reduce(
    (sum, c) => sum + (Number(c.amount) || 0),
    0
  );
  const computedGrossTotal =
    itemsSubtotal +
    (Number.isFinite(additionalTotal) ? additionalTotal : 0) +
    adminChargesTotal;

  const storedDiscountAmount = typeof data.discountAmount === "number" ? data.discountAmount : undefined;
  const discountType = data.discountType;
  const discountValue = typeof data.discountValue === "number" ? data.discountValue : undefined;

  let discountAmount = 0;
  if (typeof storedDiscountAmount === "number") {
    discountAmount = storedDiscountAmount;
  } else if (discountType === "percent" && typeof discountValue === "number") {
    discountAmount = computedGrossTotal * (discountValue / 100);
  } else if (discountType === "amount" && typeof discountValue === "number") {
    discountAmount = discountValue;
  }
  discountAmount = Math.max(0, Math.min(computedGrossTotal, discountAmount || 0));
  const lateFeeAmount = Math.max(0, Number(data.lateFeeAmount || 0));

  const finalTotal =
    typeof data.grandTotal === "number"
      ? data.grandTotal
      : Math.max(0, computedGrossTotal - discountAmount + lateFeeAmount);
  
  // Summary section
  const summaryStartY = currentY + 10;
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('NJ Sales Tax 6.625% - Excluded', margin, summaryStartY);
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  // Breakdown
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  
  // For storage invoices, show Gross Total directly; for others, show Items Subtotal
  if (isStorageInvoice) {
    doc.text(`Gross Total: $${computedGrossTotal.toFixed(2)}`, margin, summaryStartY + 7);
  } else {
    doc.text(`Items Subtotal: $${itemsSubtotal.toFixed(2)}`, margin, summaryStartY + 7);
  }
  let summaryLineY = summaryStartY + 12;
  
  // Additional Services Breakdown
  if (data.additionalServices && additionalTotal > 0.0001) {
    const add = data.additionalServices;
    const services: string[] = [];
    
    if ((add.bubbleWrapFeet || 0) > 0 && (add.pricePerFoot || 0) > 0) {
      const qty = add.bubbleWrapFeet || 0;
      const price = add.pricePerFoot || 0;
      const amt = qty * price;
      services.push(`Bubble Wrap: ${qty} ft × $${price.toFixed(2)} = $${amt.toFixed(2)}`);
    }
    
    if ((add.stickerRemovalItems || 0) > 0 && (add.pricePerItem || 0) > 0) {
      const qty = add.stickerRemovalItems || 0;
      const price = add.pricePerItem || 0;
      const amt = qty * price;
      services.push(`Sticker Removal: ${qty} items × $${price.toFixed(2)} = $${amt.toFixed(2)}`);
    }
    
    if ((add.warningLabels || 0) > 0 && (add.pricePerLabel || 0) > 0) {
      const qty = add.warningLabels || 0;
      const price = add.pricePerLabel || 0;
      const amt = qty * price;
      services.push(`Warning Labels: ${qty} labels × $${price.toFixed(2)} = $${amt.toFixed(2)}`);
    }
    
    if (services.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text('Additional Services:', margin, summaryLineY);
      summaryLineY += 5;
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      services.forEach((service) => {
        doc.text(service, margin + 5, summaryLineY);
        summaryLineY += 4;
      });
      
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(`Total Additional Services: $${additionalTotal.toFixed(2)}`, margin, summaryLineY);
      summaryLineY += 5;
    } else {
      // Fallback: just show total if breakdown not available
      doc.text(`Additional Services: $${additionalTotal.toFixed(2)}`, margin, summaryLineY);
      summaryLineY += 5;
    }
  }

  if (adminChargesTotal > 0.0001) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Additional Charges:", margin, summaryLineY);
    summaryLineY += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    (data.adminAdditionalCharges ?? []).forEach((charge) => {
      const name = String(charge.name || "Charge").substring(0, 40);
      const amt = Number(charge.amount) || 0;
      doc.text(`${name}: $${amt.toFixed(2)}`, margin + 5, summaryLineY);
      summaryLineY += 4;
    });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`Total Additional Charges: $${adminChargesTotal.toFixed(2)}`, margin, summaryLineY);
    summaryLineY += 5;
  }

  if (discountAmount > 0.009) {
    doc.text(`Discount: -$${discountAmount.toFixed(2)}`, margin, summaryLineY);
    summaryLineY += 5;
  }
  if (lateFeeAmount > 0.009) {
    const reason = data.lateFeeReason ? ` (${data.lateFeeReason})` : "";
    doc.text(`Late Fee${reason}: +$${lateFeeAmount.toFixed(2)}`, margin, summaryLineY);
    summaryLineY += 5;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('GRAND TOTAL', margin, summaryLineY + 6);
  doc.text(`TOTAL: $${finalTotal.toFixed(2)}`, pageWidth - rightGutter - 50, summaryLineY + 6);
  
    // Footer
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.text('WE APPRECIATE YOUR BUSINESS', (pageWidth - rightGutter) / 2, 280, { align: 'center' });
    
    return doc;
  } catch (error) {
    console.error('Error generating invoice PDF:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Full error details:', {
      error,
      invoiceNumber: data.invoiceNumber,
      itemCount: data.items?.length || 0,
      type: data.type,
    });
    throw new Error(`Failed to generate PDF: ${errorMessage}`);
  }
}

export async function generateInvoicePDF(data: InvoiceData): Promise<void> {
  const doc = await buildInvoiceDoc(data);
  try {
    const fileName = `Invoice-${data.invoiceNumber}.pdf`;
    doc.save(fileName);
    console.log('PDF generated and saved successfully:', fileName);
  } catch (saveError) {
    console.error('Error saving PDF:', saveError);
    throw new Error(`Failed to save PDF: ${saveError instanceof Error ? saveError.message : 'Unknown error'}`);
  }
}

export async function generateInvoicePDFBlob(data: InvoiceData): Promise<Blob> {
  const doc = await buildInvoiceDoc(data);
  return doc.output("blob");
}

export { generateInvoiceNumber } from "./invoice-utils";
