"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

interface AffiliatePageBannerProps {
  title: string;
  description: string;
  icon: LucideIcon;
  gradient: string;
}

export function AffiliatePageBanner({ title, description, icon: Icon, gradient }: AffiliatePageBannerProps) {
  return (
    <Card className={`overflow-hidden border-0 ${gradient} text-white shadow-md`}>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-lg font-semibold sm:text-xl">{title}</h2>
          <p className="text-xs opacity-90 sm:text-sm">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}
