import { collection, addDoc, query, where, getDocs } from "firebase/firestore";
import { db } from "./firebase";
import type { Commission, Invoice, UserProfile } from "@/types";

/**
 * Generate a unique referral code for a commission agent
 * @param name The agent's name (used for initials)
 * @param excludeUserId Optional user ID to exclude from duplicate check (for updating existing user)
 * @returns A unique referral code
 */
export async function generateUniqueReferralCode(
  name: string,
  excludeUserId?: string
): Promise<string> {
  // Generate base code from initials + random string
  const generateCode = (): string => {
    const initials = name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 3);
    // Ensure we have at least 3 characters (pad with 'A' if needed)
    const paddedInitials = initials.padEnd(3, "A");
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${paddedInitials}${random}`;
  };

  // Try up to 10 times to find a unique code
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateCode();
    
    // Check if code exists in Firestore
    const existingQuery = query(
      collection(db, "users"),
      where("referralCode", "==", code)
    );
    const existingSnapshot = await getDocs(existingQuery);
    
    // Filter out the current user if excludeUserId is provided
    const isDuplicate = existingSnapshot.docs.some(
      (doc) => doc.id !== excludeUserId
    );
    
    if (!isDuplicate) {
      return code;
    }
  }

  // If we couldn't find a unique code after 10 attempts, add more randomness
  const fallbackCode = generateCode() + Math.random().toString(36).substring(2, 4).toUpperCase();
  return fallbackCode;
}

/**
 * Create a commission record when an invoice is paid
 * @param invoice The paid invoice
 * @param user The user who paid the invoice
 * @returns The created commission ID or null if no agent referral
 */
export async function createCommissionForInvoice(
  invoice: Invoice,
  user: UserProfile
): Promise<string | null> {
  // Check if user was referred by a commission agent
  if (!user.referredByAgentId) {
    return null;
  }

  // Check if commission already exists for this invoice
  const existingCommissionsQuery = query(
    collection(db, "commissions"),
    where("invoiceId", "==", invoice.id),
    where("agentId", "==", user.referredByAgentId)
  );
  const existingSnapshot = await getDocs(existingCommissionsQuery);
  
  if (!existingSnapshot.empty) {
    // Commission already exists
    return existingSnapshot.docs[0].id;
  }

  // Get agent info
  const agentDoc = await getDocs(
    query(collection(db, "users"), where("uid", "==", user.referredByAgentId))
  );
  
  if (agentDoc.empty) {
    console.error("Agent not found:", user.referredByAgentId);
    return null;
  }

  const agent = agentDoc.docs[0].data() as UserProfile;

  // Calculate commission (5% of grandTotal)
  const commissionAmount = invoice.grandTotal * 0.05;

  // Create commission record
  const commissionData: Omit<Commission, "id"> = {
    agentId: user.referredByAgentId,
    agentName: agent.name || "Unknown Agent",
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    clientId: user.uid,
    clientName: user.name || "Unknown Client",
    invoiceAmount: invoice.grandTotal,
    commissionAmount: commissionAmount,
    status: "pending",
    createdAt: new Date(),
  };

  const commissionRef = await addDoc(collection(db, "commissions"), commissionData);
  return commissionRef.id;
}

