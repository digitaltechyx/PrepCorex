import jsPDF from "jspdf";

const SERVICE_PROVIDER = {
  name: "Prep Services FBA LLC",
  address: "7000 Atrium Way B05, Mount Laurel, NJ 08054",
  email: "info@prepservicesfba.com",
  phone: "+1 347 661 3010",
  signatureName: "ARSHAD IQBAL",
  signatureTitle: "Founder",
};

export interface PartnershipAgreementData {
  partnerAgencyName: string;
  address: string;
  email: string;
  phone: string;
  partnerAuthorizedName: string;
  partnerTitle?: string;
  completedAt?: string;
}

/**
 * Generates the B2B Partnership Agreement PDF with partner details and full agreement text.
 */
export async function generatePartnershipAgreementPDF(data: PartnershipAgreementData): Promise<Blob> {
  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 18;
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  const addText = (text: string, fontSize: number = 10, isBold = false) => {
    doc.setFontSize(fontSize);
    doc.setFont("helvetica", isBold ? "bold" : "normal");
    const lines = doc.splitTextToSize(text, maxWidth);
    lines.forEach((line: string) => {
      if (y > 270) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += fontSize * 0.45;
    });
    y += 2;
  };

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("Prep Services FBA", margin, y);
  y += 8;
  doc.setFontSize(16);
  doc.text("B2B PARTNERSHIP AGREEMENT", margin, y);
  y += 10;

  const dateStr = data.completedAt || new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  addText(`This B2B Partnership Agreement ("Agreement") is entered into as of ${dateStr}, by and between:`, 10);
  y += 4;

  doc.setFont("helvetica", "bold");
  doc.text("Party 1 (Service Provider)", margin, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  addText(SERVICE_PROVIDER.name, 10);
  addText(SERVICE_PROVIDER.address, 10);
  addText(`${SERVICE_PROVIDER.email} | ${SERVICE_PROVIDER.phone}`, 10);
  y += 4;

  doc.setFont("helvetica", "bold");
  doc.text("Party 2 (Partner)", margin, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  addText(data.partnerAgencyName || "[Partner / Agency Name]", 10);
  addText(data.address || "[Address]", 10);
  addText(`${data.email || "[Email]"} | ${data.phone || "[Phone]"}`, 10);
  y += 4;
  addText("Both parties are collectively referred to as the \"Parties.\"", 9);
  y += 6;

  addText("1. PURPOSE", 10, true);
  addText(
    "This Agreement establishes a business-to-business referral and strategic partnership for the Partner to introduce e-commerce sellers, brands, or agencies to Prep Services FBA. Services offered by Prep Services FBA include: Amazon FBA Prep Services; 3PL Fulfillment; Warehousing & Storage; Inventory Management; Returns Processing; Kitting, Bundling, and Logistics support. All services provided to clients are governed by the Prep Services FBA Master Service Agreement, accepted by the client.",
    9
  );

  addText("2. PARTNER RESPONSIBILITIES", 10, true);
  addText("The Partner agrees to: Introduce potential clients and businesses to Prep Services FBA; Promote Prep Services FBA services ethically and accurately; Avoid misrepresentation of services or pricing. The Partner may not: Sign contracts on behalf of Prep Services FBA; Commit operational pricing without written approval; Represent themselves as an employee or owner of Prep Services FBA.", 9);

  addText("3. REFERRAL COMPENSATION", 10, true);
  addText(
    "Partners may receive commission for qualified client referrals. FBA Prep Services: 5% of net monthly service revenue. 3PL Fulfillment: 10% of net monthly service revenue. Storage Revenue: 5% of net monthly storage revenue. Conditions: Commission applies only to active paying clients; Commission validity period is 12 months from the first invoice; Payments are issued monthly or quarterly. Prep Services FBA reserves the right to adjust commission structures with 30 days' notice.",
    9
  );

  addText("4. CLIENT OWNERSHIP", 10, true);
  addText(
    "All clients introduced through the Partner and onboarded within the PrepCorex system shall become operational clients of Prep Services FBA. Prep Services FBA retains full control over: client onboarding; pricing and billing; operational workflows; service delivery. The Partner retains only the referral rights and commission rights defined in this Agreement.",
    9
  );

  addText("5. NON-CIRCUMVENTION & CLIENT PROTECTION", 10, true);
  addText(
    "The Partner agrees not to solicit, contract with, or provide competing services to any client introduced to Prep Services FBA and onboarded through the PrepCorex system. This restriction applies for a period of two (2) years from the client's onboarding date. Violation may result in: immediate termination of the partnership; forfeiture of commissions; damages of $25,000 per violation or the estimated lost revenue, whichever is greater.",
    9
  );

  addText("6. CONFIDENTIALITY", 10, true);
  addText(
    "Both Parties agree to maintain strict confidentiality regarding: client lists; pricing structures; operational procedures; business strategies; PrepCorex system data. Confidential information shall not be disclosed without written consent.",
    9
  );

  addText("7. INTELLECTUAL PROPERTY", 10, true);
  addText(
    "All intellectual property remains the property of its respective owner. Prep Services FBA retains ownership of: brand identity; operational systems; PrepCorex software; logistics processes. Partners receive limited permission to promote services during the active partnership period.",
    9
  );

  addText("8. LIABILITY LIMITATION", 10, true);
  addText(
    "Prep Services FBA shall not be liable for indirect or consequential damages, including: marketplace losses; supplier issues; client business losses. Liability is strictly limited to the value of services provided.",
    9
  );

  addText("9. TERM & TERMINATION", 10, true);
  addText(
    "This Agreement remains valid for 12 months and renews automatically unless terminated. Either Party may terminate the Agreement with 30 days' written notice, or immediately in cases of fraud, misrepresentation, or breach of terms.",
    9
  );

  addText("10. GOVERNING LAW", 10, true);
  addText(
    "This Agreement shall be governed by the laws of the State of New Jersey, United States. Any disputes shall be resolved in the courts located in New Jersey.",
    9
  );

  addText("11. DIGITAL ACCEPTANCE", 10, true);
  addText(
    "This Agreement may be accepted electronically through the Prep Services FBA portal or PrepCorex system and shall be considered legally binding upon acceptance.",
    9
  );
  y += 4;

  addText("Agreed and Accepted by:", 10, true);
  y += 4;

  const col1 = margin;
  const col2 = margin + pageWidth / 2;
  const sigY = y;

  doc.setFont("helvetica", "bold");
  doc.text("Prep Services FBA LLC", col1, sigY);
  doc.text("(Service Provider)", col1, sigY + 5);
  doc.setFont("helvetica", "normal");
  doc.text("Authorized Signature:", col1, sigY + 12);
  doc.text(SERVICE_PROVIDER.name, col1, sigY + 18);
  doc.text("Name: " + SERVICE_PROVIDER.signatureName, col1, sigY + 24);
  doc.text("Title: " + SERVICE_PROVIDER.signatureTitle, col1, sigY + 30);
  doc.text("Date: " + dateStr, col1, sigY + 36);

  doc.setFont("helvetica", "bold");
  doc.text(data.partnerAgencyName || "[Partner / Agency Name]", col2, sigY);
  doc.text("(Partner)", col2, sigY + 5);
  doc.setFont("helvetica", "normal");
  doc.text("Authorized Signature:", col2, sigY + 12);
  doc.text(data.partnerAuthorizedName || "—", col2, sigY + 18);
  doc.text("Name: " + (data.partnerAuthorizedName || "—"), col2, sigY + 24);
  if (data.partnerTitle) doc.text("Title: " + data.partnerTitle, col2, sigY + 30);
  doc.text("Date: " + dateStr, col2, sigY + (data.partnerTitle ? 36 : 30));

  return doc.output("blob");
}
