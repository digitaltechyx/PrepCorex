/** Disabled — PrepCorex client invoice created emails are paused. */
export async function requestClientInvoiceCreatedEmail(_input: {
  getIdToken: () => Promise<string>;
  userId: string;
  invoiceId: string;
}): Promise<void> {
  return;
}
