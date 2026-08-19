import type { Metadata } from "next";
import { HomeGateway } from "@/components/marketing/home-gateway";

export const metadata: Metadata = {
  title: "PrepCorex | Warehouse & Fulfillment Operations, Connected",
  description:
    "Run receiving, inventory, prep, picking, packing, shipping, returns, billing, and client visibility from one connected fulfillment platform.",
  keywords: [
    "warehouse management",
    "3PL software",
    "prep center software",
    "inventory management",
    "fulfillment operations",
    "shipping management",
  ],
  openGraph: {
    title: "PrepCorex | Every warehouse movement under control",
    description:
      "The connected operating platform for modern prep centers, warehouses, and fulfillment teams.",
    type: "website",
  },
};

export default function Home() {
  return <HomeGateway />;
}

