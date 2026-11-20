/** Client-side helper to trigger invoice-created email (fallback to Functions onCreate). */
export async function requestClientInvoiceCreatedEmail(input: {
  getIdToken: () => Promise<string>;
  userId: string;
  invoiceId: string;
}): Promise<void> {
  const token = await input.getIdToken();
  const res = await fetch("/api/invoices/notify-created", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId: input.userId,
      invoiceId: input.invoiceId,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      (data && typeof data.error === "string" && data.error) ||
        "Failed to send invoice created email"
    );
  }
}
