"use client";

import { Component, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign } from "lucide-react";
import { UserPricingView } from "@/components/dashboard/user-pricing-view";

class PricingViewErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; message: string }
> {
  state = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message || "Unknown error" };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Pricing view failed to load.</div>
          <div className="mt-1 text-muted-foreground">{this.state.message}</div>
          <button
            type="button"
            className="mt-3 text-sm underline"
            onClick={() => this.setState({ hasError: false, message: "" })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function PricingPage() {
  return (
    <div className="space-y-6">
      <Card className="border-2 shadow-xl overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-purple-500 to-indigo-600 text-white pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                <DollarSign className="h-6 w-6" />
                Pricing
              </CardTitle>
              <CardDescription className="text-purple-100 mt-2">
                View your current service pricing and add-on rates
              </CardDescription>
            </div>
            <div className="h-14 w-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <DollarSign className="h-7 w-7 text-white" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <PricingViewErrorBoundary>
            <UserPricingView />
          </PricingViewErrorBoundary>
        </CardContent>
      </Card>
    </div>
  );
}
