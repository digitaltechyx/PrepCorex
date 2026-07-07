/** @deprecated Firebase `onClientInvoiceCreated` sends creation emails automatically. */
export async function requestClientInvoiceCreatedEmail(input: {
  getIdToken: () => Promise<string>;
  userId: string;
  invoiceId: string;
}): Promise<void> {
  try {
    const token = await input.getIdToken();
    await fetch("/api/invoices/notify-created", {
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
  } catch (error) {
    console.error("Failed to request invoice created email:", error);
  }
}
