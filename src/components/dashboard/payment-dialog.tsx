"use client";

import { useState, useEffect, useCallback } from "react";
import { useStripe, useElements, CardElement } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, CreditCard, CheckCircle2, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export type SavedCardOption = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

export type CreatePaymentIntentOpts = {
  saveCard: boolean;
  paymentMethodId?: string | null;
};

interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  amount: number;
  currency: string;
  getIdToken: () => Promise<string>;
  /** Called when user confirms pay — create PaymentIntent with save/use-card options */
  createPaymentIntent: (
    opts: CreatePaymentIntentOpts
  ) => Promise<{ clientSecret: string; labelPurchaseId?: string }>;
  onSuccess: (labelPurchaseId?: string | null) => void;
}

const cardElementOptions = {
  style: {
    base: {
      fontSize: "16px",
      color: "#424770",
      "::placeholder": {
        color: "#aab7c4",
      },
    },
    invalid: {
      color: "#9e2146",
    },
  },
};

function brandLabel(brand: string) {
  const b = String(brand || "card");
  return b.charAt(0).toUpperCase() + b.slice(1);
}

export function PaymentDialog({
  open,
  onOpenChange,
  amount,
  currency,
  getIdToken,
  createPaymentIntent,
  onSuccess,
}: PaymentDialogProps) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [processing, setProcessing] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [cards, setCards] = useState<SavedCardOption[]>([]);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<"new" | string>("new");
  const [saveCard, setSaveCard] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadCards = useCallback(async () => {
    setCardsLoading(true);
    try {
      const token = await getIdToken();
      const res = await fetch("/api/stripe/payment-methods", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load cards");
      const list = Array.isArray(data.cards) ? (data.cards as SavedCardOption[]) : [];
      setCards(list);
      if (list.length > 0) {
        setSelectedMethod(list[0].id);
      } else {
        setSelectedMethod("new");
      }
    } catch (error: unknown) {
      console.warn("load saved cards", error);
      setCards([]);
      setSelectedMethod("new");
    } finally {
      setCardsLoading(false);
    }
  }, [getIdToken]);

  useEffect(() => {
    if (!open) {
      setSucceeded(false);
      setProcessing(false);
      setSaveCard(false);
      setRemovingId(null);
      return;
    }
    void loadCards();
  }, [open, loadCards]);

  const handleRemoveCard = async (paymentMethodId: string) => {
    setRemovingId(paymentMethodId);
    try {
      const token = await getIdToken();
      const res = await fetch(
        `/api/stripe/payment-methods?paymentMethodId=${encodeURIComponent(paymentMethodId)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove card");
      toast({ title: "Card removed", description: "Saved card was deleted." });
      await loadCards();
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Could not remove card",
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setRemovingId(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setProcessing(true);

    try {
      const usingSaved = selectedMethod !== "new";
      const { clientSecret, labelPurchaseId } = await createPaymentIntent({
        saveCard: usingSaved ? false : saveCard,
        paymentMethodId: usingSaved ? selectedMethod : null,
      });

      if (!clientSecret) {
        throw new Error("Missing payment client secret");
      }

      let result;
      if (usingSaved) {
        result = await stripe.confirmCardPayment(clientSecret, {
          payment_method: selectedMethod,
        });
      } else {
        const cardElement = elements.getElement(CardElement);
        if (!cardElement) {
          throw new Error("Card element not found");
        }
        result = await stripe.confirmCardPayment(clientSecret, {
          payment_method: {
            card: cardElement,
          },
        });
      }

      if (result.error) {
        toast({
          variant: "destructive",
          title: "Payment Failed",
          description: result.error.message || "Your payment could not be processed",
        });
        setProcessing(false);
        return;
      }

      if (result.paymentIntent && result.paymentIntent.status === "succeeded") {
        setSucceeded(true);
        toast({
          title: "Payment Successful!",
          description: saveCard && !usingSaved
            ? "Payment processed. Your card was saved for next time."
            : "Your payment has been processed. The label will be available shortly.",
        });
        setTimeout(() => {
          onSuccess(labelPurchaseId || null);
          onOpenChange(false);
        }, 2000);
      } else {
        setProcessing(false);
      }
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Payment Failed",
        description: error instanceof Error ? error.message : "Could not start payment",
      });
      setProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Complete Payment
          </DialogTitle>
          <DialogDescription>
            Pay with a saved card or enter a new one. You can save or remove cards anytime.
          </DialogDescription>
        </DialogHeader>

        {succeeded ? (
          <div className="flex flex-col items-center justify-center py-8 space-y-4">
            <CheckCircle2 className="h-16 w-16 text-green-500" />
            <p className="text-lg font-semibold">Payment Successful!</p>
            <p className="text-sm text-muted-foreground">
              Your label will be purchased automatically and available shortly.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm font-medium">Payment method</p>
              {cardsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading saved cards…
                </div>
              ) : (
                <div className="space-y-2">
                  {cards.map((card) => (
                    <div
                      key={card.id}
                      className={cn(
                        "flex items-center gap-2 rounded-md border p-3",
                        selectedMethod === card.id && "border-primary bg-primary/5"
                      )}
                    >
                      <button
                        type="button"
                        className="flex flex-1 items-center gap-3 text-left"
                        onClick={() => setSelectedMethod(card.id)}
                      >
                        <span
                          className={cn(
                            "h-4 w-4 rounded-full border-2 shrink-0",
                            selectedMethod === card.id
                              ? "border-primary bg-primary"
                              : "border-muted-foreground/40"
                          )}
                        />
                        <div>
                          <p className="text-sm font-medium">
                            {brandLabel(card.brand)} ···· {card.last4}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Exp {String(card.expMonth).padStart(2, "0")}/{card.expYear}
                          </p>
                        </div>
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        disabled={removingId === card.id || processing}
                        onClick={() => void handleRemoveCard(card.id)}
                        title="Remove card"
                      >
                        {removingId === card.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  ))}

                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md border p-3 text-left",
                      selectedMethod === "new" && "border-primary bg-primary/5"
                    )}
                    onClick={() => setSelectedMethod("new")}
                  >
                    <span
                      className={cn(
                        "h-4 w-4 rounded-full border-2 shrink-0",
                        selectedMethod === "new"
                          ? "border-primary bg-primary"
                          : "border-muted-foreground/40"
                      )}
                    />
                    <span className="text-sm font-medium">Use a new card</span>
                  </button>
                </div>
              )}
            </div>

            {selectedMethod === "new" ? (
              <div className="space-y-3">
                <label className="text-sm font-medium">Card details</label>
                <div className="p-4 border rounded-md bg-background">
                  <CardElement options={cardElementOptions} />
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="save-card"
                    checked={saveCard}
                    onCheckedChange={(v) => setSaveCard(v === true)}
                    disabled={processing}
                  />
                  <Label htmlFor="save-card" className="text-sm font-normal leading-snug cursor-pointer">
                    Save this card for future Buy Labels purchases
                  </Label>
                </div>
              </div>
            ) : null}

            <div className="flex items-center justify-between p-4 bg-muted rounded-md">
              <span className="font-medium">Total Amount:</span>
              <span className="text-lg font-bold">
                {currency.toUpperCase()} ${(amount / 100).toFixed(2)}
              </span>
            </div>

            <Button
              type="submit"
              disabled={!stripe || processing || cardsLoading}
              className="w-full"
              size="lg"
            >
              {processing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CreditCard className="mr-2 h-4 w-4" />
                  Pay ${(amount / 100).toFixed(2)}
                </>
              )}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
