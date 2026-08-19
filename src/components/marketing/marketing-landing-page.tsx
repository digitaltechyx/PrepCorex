"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Bell,
  Box,
  Boxes,
  Camera,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Cloud,
  FileText,
  Fingerprint,
  Globe2,
  Layers3,
  LockKeyhole,
  Menu,
  PackageCheck,
  PackageOpen,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Truck,
  Users,
  Warehouse,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { brandLogoSrc } from "@/components/logo";
import { PlatformBrandLogo } from "@/components/integrations/platform-brand-logo";
import styles from "./marketing-landing.module.css";
import { cn } from "@/lib/utils";

type PortalKey = "client" | "warehouse" | "admin";

const workflow: Array<{
  number: string;
  title: string;
  copy: string;
  icon: LucideIcon;
}> = [
  {
    number: "01",
    title: "Receive",
    copy: "Expected inbound, dock inspection, photos, live video, quantities, and damage capture.",
    icon: PackageOpen,
  },
  {
    number: "02",
    title: "Putaway",
    copy: "Print labels, scan cartons and pallets, and place every unit into a traceable location.",
    icon: Warehouse,
  },
  {
    number: "03",
    title: "Control",
    copy: "See sellable, damaged, quarantined, returned, and allocated stock in real time.",
    icon: Layers3,
  },
  {
    number: "04",
    title: "Pick",
    copy: "Guide operators through accurate FIFO or FEFO picking with scan confirmation.",
    icon: ShoppingCart,
  },
  {
    number: "05",
    title: "Pack",
    copy: "Verify units, prep requirements, master cases, shipping labels, and client approvals.",
    icon: Box,
  },
  {
    number: "06",
    title: "Dispatch",
    copy: "Release completed orders, capture tracking, and keep clients informed automatically.",
    icon: Truck,
  },
];

const portals: Record<
  PortalKey,
  {
    label: string;
    eyebrow: string;
    title: string;
    copy: string;
    bullets: string[];
    icon: LucideIcon;
  }
> = {
  client: {
    label: "Client portal",
    eyebrow: "Visibility without the inbox",
    title: "Give every client a clear view of their operation.",
    copy: "Clients can request inbound and outbound work, monitor inventory, buy labels, review invoices, watch receiving video, and understand savings from one branded portal.",
    bullets: [
      "Live inventory, shipment, return, and quarantine status",
      "Invoices, pricing, reports, prep savings, and shipping savings",
      "Shopify, eBay, TikTok, WooCommerce, Amazon, and ShipStation connections",
    ],
    icon: Users,
  },
  warehouse: {
    label: "Warehouse Ops",
    eyebrow: "Built for the warehouse floor",
    title: "Turn complex warehouse work into simple scan-first tasks.",
    copy: "A dedicated operator experience keeps receiving, putaway, picking, packing, dispatch, cycle counts, returns, and internal moves moving in the correct order.",
    bullets: [
      "Mobile-first work queues with direct barcode and QR scanning",
      "Role-based workflows for receivers, putaway, pickers, packers, and supervisors",
      "Carton, pallet, bin, area, condition, and movement traceability",
    ],
    icon: ScanLine,
  },
  admin: {
    label: "Admin control",
    eyebrow: "One command center",
    title: "Control clients, warehouses, pricing, billing, and performance.",
    copy: "Administrators get one operating view across warehouses and client accounts, with the controls needed to run accurate, accountable fulfillment.",
    bullets: [
      "Multi-warehouse inventory, allocation, moves, and cycle counts",
      "Invoices, tariffs, discounts, documents, users, and permission profiles",
      "Operational reports, notifications, audit trails, and integration management",
    ],
    icon: BarChart3,
  },
};

const integrations = [
  { id: "shopify", label: "Shopify" },
  { id: "amazon", label: "Amazon" },
  { id: "ebay", label: "eBay" },
  { id: "tiktok", label: "TikTok Shop" },
  { id: "woocommerce", label: "WooCommerce" },
  { id: "shipstation", label: "ShipStation" },
];

const featureCards: Array<{
  title: string;
  copy: string;
  icon: LucideIcon;
  tone: string;
  className?: string;
}> = [
  {
    title: "A live inventory truth",
    copy: "Track quantities by client, SKU, carton, pallet, warehouse, bin, area, condition, and workflow stage—without rebuilding the story in spreadsheets.",
    icon: Boxes,
    tone: "bg-blue-50 text-blue-700",
    className: "lg:col-span-2",
  },
  {
    title: "Receiving clients can see",
    copy: "Record inspection evidence, photos, and private receiving video while the client follows progress from their own account.",
    icon: Camera,
    tone: "bg-orange-50 text-orange-700",
  },
  {
    title: "Returns and quality control",
    copy: "Receive returns, quarantine damaged units, document decisions, put stock away, ship it out, or dispose with a complete trail.",
    icon: RotateCcw,
    tone: "bg-rose-50 text-rose-700",
  },
  {
    title: "Savings clients understand",
    copy: "Show estimated shipping and prep savings beside what the client actually paid, with downloadable reports and clear comparisons.",
    icon: CircleDollarSign,
    tone: "bg-emerald-50 text-emerald-700",
  },
  {
    title: "Billing connected to the work",
    copy: "Turn completed operational activity into transparent invoices, discounts, pricing profiles, and client-visible billing history.",
    icon: FileText,
    tone: "bg-violet-50 text-violet-700",
    className: "lg:col-span-2",
  },
];

function useLandingMotion() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add(styles.revealed);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px" }
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  return rootRef;
}

function MarketingHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links = [
    ["Platform", "#platform"],
    ["Workflow", "#workflow"],
    ["Capabilities", "#capabilities"],
    ["Integrations", "#integrations"],
    ["Security", "#security"],
  ];

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-[70] border-b transition-all duration-300",
        scrolled
          ? "border-slate-200/80 bg-white/90 shadow-[0_8px_35px_rgba(10,23,51,0.06)] backdrop-blur-xl"
          : "border-transparent bg-white/55 backdrop-blur-md"
      )}
    >
      <div className="mx-auto flex h-[72px] max-w-7xl items-center px-5 sm:px-7 lg:px-10">
        <Link href="/" aria-label="PrepCorex home" className="shrink-0">
          <img src={brandLogoSrc} alt="PrepCorex" className="h-auto w-[142px] sm:w-[165px]" />
        </Link>

        <nav className="mx-auto hidden items-center gap-7 text-sm font-medium text-slate-600 lg:flex">
          {links.map(([label, href]) => (
            <a key={href} href={href} className="transition hover:text-orange-600">
              {label}
            </a>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-3 sm:flex">
          <Link
            href="/login"
            className="rounded-full px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className={cn(
              styles.shine,
              "rounded-full bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-orange-600/20 transition hover:-translate-y-0.5 hover:bg-orange-700"
            )}
          >
            Get started
          </Link>
        </div>

        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          className="ml-auto rounded-xl border bg-white p-2 text-slate-800 sm:hidden"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open ? (
        <div className="border-t bg-white px-5 pb-5 pt-3 shadow-xl sm:hidden">
          <nav className="grid gap-1">
            {links.map(([label, href]) => (
              <a
                key={href}
                href={href}
                className="rounded-xl px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-orange-50 hover:text-orange-700"
                onClick={() => setOpen(false)}
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link href="/login" className="rounded-xl border px-4 py-3 text-center text-sm font-semibold">
              Sign in
            </Link>
            <Link
              href="/register"
              className="rounded-xl bg-orange-600 px-4 py-3 text-center text-sm font-semibold text-white"
            >
              Get started
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function HeroDashboard() {
  const queues = [
    { label: "Receiving", count: 12, icon: PackageOpen, color: "text-orange-600 bg-orange-50" },
    { label: "Putaway", count: 18, icon: Warehouse, color: "text-blue-700 bg-blue-50" },
    { label: "Picking", count: 27, icon: ShoppingCart, color: "text-violet-700 bg-violet-50" },
    { label: "Packing", count: 14, icon: Box, color: "text-orange-600 bg-orange-50" },
    { label: "Dispatch", count: 9, icon: Truck, color: "text-emerald-700 bg-emerald-50" },
    { label: "Inventory", count: "18.8K", icon: ClipboardCheck, color: "text-slate-700 bg-slate-50" },
  ];

  return (
    <div className="relative mx-auto w-full max-w-[690px] lg:mx-0">
      <div
        className={cn(
          styles.dashboard,
          "relative overflow-hidden rounded-[26px] border border-white/80 bg-white/95 p-3 shadow-2xl sm:p-4"
        )}
      >
        <div className="flex items-center justify-between border-b px-1 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-600 text-white">
              <Box className="h-4 w-4" />
            </span>
            <span className="text-xs font-bold text-slate-900">PrepCorex Operations</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full border bg-slate-50 px-2.5 py-1 text-[9px] font-medium text-slate-600 sm:inline">
              New Jersey Warehouse
            </span>
            <span className="h-7 w-7 rounded-full bg-gradient-to-br from-orange-400 to-orange-600" />
          </div>
        </div>

        <div className="grid gap-3 pt-3 md:grid-cols-[1.4fr_0.9fr]">
          <div>
            <div className="mb-3 flex items-end justify-between">
              <div>
                <p className="text-[9px] font-medium uppercase tracking-[0.16em] text-slate-400">
                  Live floor
                </p>
                <p className="text-base font-bold text-slate-900">Good morning, Alex</p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[8px] font-semibold text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> On shift
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {queues.map((queue) => {
                const Icon = queue.icon;
                return (
                  <div key={queue.label} className="rounded-xl border bg-white p-2.5 shadow-sm">
                    <span className={cn("inline-flex rounded-lg p-1.5", queue.color)}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <p className="mt-2 text-[10px] font-semibold text-slate-800">{queue.label}</p>
                    <p className="text-sm font-bold tabular-nums text-slate-950">{queue.count}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl bg-[#071a3d] p-3 text-white">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold">Priority tasks</p>
              <Bell className="h-3.5 w-3.5 text-orange-400" />
            </div>
            <div className="mt-3 space-y-2">
              {[
                ["ORD-10234", "Pick 24 units", "High"],
                ["PUT-8891", "Putaway 48 units", "High"],
                ["INB-5567", "Receive 12 units", "Next"],
              ].map(([id, task, priority]) => (
                <div key={id} className="rounded-xl border border-white/10 bg-white/5 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9px] font-semibold">{id}</span>
                    <span className="text-[7px] font-semibold uppercase text-orange-400">
                      {priority}
                    </span>
                  </div>
                  <p className="mt-1 text-[8px] text-slate-300">{task}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 rounded-2xl border bg-slate-50 p-2.5">
          {[
            ["Live", "Inventory"],
            ["Scan-first", "Accuracy"],
            ["End-to-end", "Traceability"],
          ].map(([value, label]) => (
            <div key={label} className="text-center">
              <p className="text-[10px] font-bold text-slate-900 sm:text-xs">{value}</p>
              <p className="text-[7px] text-slate-500 sm:text-[8px]">{label}</p>
            </div>
          ))}
        </div>
      </div>

      <div
        className={cn(
          styles.floatCardA,
          "absolute -bottom-9 -left-3 rounded-2xl border bg-white/95 p-3 shadow-xl backdrop-blur sm:-left-9"
        )}
      >
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-orange-50 p-2 text-orange-600">
            <ScanLine className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[9px] font-bold text-slate-900">SKU: PCX-2334</p>
            <p className="text-[8px] text-emerald-600">Scanned · Bin A12-03</p>
          </div>
        </div>
      </div>

      <div
        className={cn(
          styles.floatCardB,
          "absolute -right-2 -top-8 rounded-2xl border bg-white/95 p-3 shadow-xl backdrop-blur sm:-right-8"
        )}
      >
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-emerald-50 p-2 text-emerald-600">
            <Activity className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[9px] font-bold text-slate-900">Real-time visibility</p>
            <p className="text-[8px] text-slate-500">Every movement, one timeline</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlatformPreview({ portal }: { portal: PortalKey }) {
  const data = portals[portal];
  const Icon = data.icon;

  return (
    <div className="relative min-h-[430px] overflow-hidden rounded-[30px] border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 shadow-[0_30px_80px_rgba(7,26,61,0.12)] sm:p-6">
      <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-orange-200/35 blur-3xl" />
      <div className="relative rounded-2xl border bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-orange-600 p-1.5 text-white">
              <Icon className="h-4 w-4" />
            </span>
            <p className="text-xs font-bold">PrepCorex · {data.label}</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[8px] font-semibold text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live
          </span>
        </div>

        <div className="grid gap-3 p-3 sm:grid-cols-3">
          {portal === "client" ? (
            <>
              {[
                ["Units on hand", "18,842", Boxes],
                ["Orders shipped", "2,341", Truck],
                ["Est. savings", "$4,368", CircleDollarSign],
              ].map(([label, value, CardIcon]) => {
                const CIcon = CardIcon as LucideIcon;
                return (
                  <div key={String(label)} className="rounded-xl border p-3">
                    <CIcon className="h-4 w-4 text-orange-600" />
                    <p className="mt-3 text-[9px] text-slate-500">{String(label)}</p>
                    <p className="text-lg font-bold">{String(value)}</p>
                  </div>
                );
              })}
              <div className="col-span-full rounded-xl bg-[#071a3d] p-4 text-white">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">Inventory &amp; savings</span>
                  <span className="text-[8px] text-slate-300">This month</span>
                </div>
                <div className="mt-5 flex h-24 items-end gap-2">
                  {[34, 46, 41, 62, 55, 73, 82, 76, 94].map((height, index) => (
                    <span
                      key={index}
                      className="flex-1 rounded-t bg-gradient-to-t from-orange-600 to-orange-300"
                      style={{ height: `${height}%` }}
                    />
                  ))}
                </div>
              </div>
            </>
          ) : portal === "warehouse" ? (
            <>
              {workflow.slice(0, 6).map((step, index) => {
                const StepIcon = step.icon;
                return (
                  <div key={step.title} className="rounded-xl border p-3">
                    <div className="flex items-start justify-between">
                      <StepIcon className="h-4 w-4 text-orange-600" />
                      <span className="text-[8px] text-emerald-600">LIVE</span>
                    </div>
                    <p className="mt-4 text-[10px] font-semibold">{step.title}</p>
                    <p className="text-lg font-bold">{[12, 18, 1842, 27, 14, 9][index]}</p>
                  </div>
                );
              })}
              <div className="col-span-full flex items-center gap-3 rounded-xl bg-orange-600 p-3 text-white">
                <ScanLine className="h-6 w-6" />
                <div>
                  <p className="text-xs font-bold">Scan to move work forward</p>
                  <p className="text-[9px] text-orange-100">Carton, pallet, SKU, package, or bin</p>
                </div>
              </div>
            </>
          ) : (
            <>
              {[
                ["Active clients", "24", Users],
                ["Open tasks", "312", ClipboardCheck],
                ["Warehouses", "3", Warehouse],
              ].map(([label, value, CardIcon]) => {
                const CIcon = CardIcon as LucideIcon;
                return (
                  <div key={String(label)} className="rounded-xl border p-3">
                    <CIcon className="h-4 w-4 text-orange-600" />
                    <p className="mt-3 text-[9px] text-slate-500">{String(label)}</p>
                    <p className="text-lg font-bold">{String(value)}</p>
                  </div>
                );
              })}
              <div className="col-span-full grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border p-4">
                  <p className="text-[10px] font-semibold">Operations health</p>
                  <div className="mt-4 space-y-3">
                    {[["Inbound", 72], ["Outbound", 86], ["Returns", 34]].map(
                      ([label, width]) => (
                        <div key={String(label)}>
                          <div className="mb-1 flex justify-between text-[8px]">
                            <span>{label}</span><span>{width}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-orange-500"
                              style={{ width: `${width}%` }}
                            />
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-950 p-4 text-white">
                  <p className="text-[10px] font-semibold">Control center</p>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-[8px]">
                    {["Pricing", "Invoices", "Roles", "Reports"].map((label) => (
                      <span key={label} className="rounded-lg border border-white/10 p-2">
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function MarketingLandingPage() {
  const rootRef = useLandingMotion();
  const heroRef = useRef<HTMLElement>(null);
  const [portal, setPortal] = useState<PortalKey>("client");

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    const onMove = (event: PointerEvent) => {
      const rect = hero.getBoundingClientRect();
      const mx = (event.clientX - rect.left) / rect.width - 0.5;
      const my = (event.clientY - rect.top) / rect.height - 0.5;
      hero.style.setProperty("--mx", String(mx));
      hero.style.setProperty("--my", String(my));
    };
    const reset = () => {
      hero.style.setProperty("--mx", "0");
      hero.style.setProperty("--my", "0");
    };
    hero.addEventListener("pointermove", onMove);
    hero.addEventListener("pointerleave", reset);
    return () => {
      hero.removeEventListener("pointermove", onMove);
      hero.removeEventListener("pointerleave", reset);
    };
  }, []);

  return (
    <div ref={rootRef} className={cn(styles.page, "font-body")}>
      <MarketingHeader />

      <main>
        <section ref={heroRef} className={styles.hero}>
          <div className={styles.heroGrid} />
          <div className={styles.warehouseGlow} />
          <div className="mx-auto grid max-w-7xl items-center gap-16 px-5 pb-24 pt-32 sm:px-7 sm:pt-36 lg:grid-cols-[0.86fr_1.14fr] lg:px-10 lg:pb-32 lg:pt-44">
            <div className="relative z-10">
              <div className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50/80 px-3 py-1.5 text-xs font-semibold text-orange-700">
                <Sparkles className="h-3.5 w-3.5" />
                The connected operating platform for modern fulfillment
              </div>
              <h1 className="mt-7 max-w-[720px] font-headline text-[clamp(3rem,6.7vw,6.6rem)] font-bold leading-[0.92] tracking-[-0.055em] text-[#071a3d]">
                Every warehouse movement.{" "}
                <span className="bg-gradient-to-r from-orange-600 to-orange-400 bg-clip-text text-transparent">
                  Under control.
                </span>
              </h1>
              <p className="mt-7 max-w-xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
                PrepCorex connects receiving, inventory, prep, picking, packing, shipping, returns,
                billing, and client visibility—so your team can move faster without losing the
                details.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/register"
                  className={cn(
                    styles.shine,
                    "inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-orange-600 px-6 text-sm font-bold text-white shadow-xl shadow-orange-600/20 transition hover:-translate-y-1 hover:bg-orange-700"
                  )}
                >
                  Start with PrepCorex
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <a
                  href="#platform"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-slate-300 bg-white/80 px-6 text-sm font-bold text-slate-800 shadow-sm backdrop-blur transition hover:-translate-y-1 hover:border-orange-300"
                >
                  <Play className="h-4 w-4 fill-current" />
                  Explore the platform
                </a>
              </div>

              <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-xs font-medium text-slate-600">
                {["Real-time visibility", "Scan-first accuracy", "Role-based control"].map((item) => (
                  <span key={item} className="inline-flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="relative z-10 pt-7 lg:pt-0">
              <div className="absolute -left-12 -top-8 h-36 w-36 rounded-full border border-orange-300/50">
                <div className={cn(styles.orbit, "absolute inset-4 rounded-full border border-dashed border-orange-300")}>
                  <span className="absolute -top-2 left-1/2 h-4 w-4 rounded-md bg-orange-500 shadow-lg shadow-orange-500/40" />
                </div>
              </div>
              <HeroDashboard />
            </div>
          </div>

          <div className="absolute inset-x-0 bottom-0 border-y border-slate-200/70 bg-white/75 py-4 backdrop-blur">
            <div className="overflow-hidden">
              <div className={cn(styles.ticker, "flex items-center gap-14 px-8 text-xs font-semibold text-slate-500")}>
                {[...Array(2)].flatMap((_, copy) =>
                  [
                    "INBOUND VISIBILITY",
                    "LIVE INVENTORY",
                    "SCAN-FIRST OPERATIONS",
                    "MULTI-CHANNEL ORDERS",
                    "CLIENT REPORTING",
                    "RETURNS & QUALITY",
                  ].map((label) => (
                    <span key={`${copy}-${label}`} className="inline-flex items-center gap-3 whitespace-nowrap">
                      <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                      {label}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

        <section id="workflow" className="bg-[#fffaf5] py-24 sm:py-32">
          <div className="mx-auto max-w-7xl px-5 sm:px-7 lg:px-10">
            <div
              data-reveal
              className={cn(styles.reveal, "mx-auto max-w-3xl text-center")}
            >
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600">
                One connected workflow
              </p>
              <h2 className="mt-4 font-headline text-4xl font-bold tracking-tight text-[#071a3d] sm:text-5xl">
                From expected inbound to final dispatch.
              </h2>
              <p className="mx-auto mt-5 max-w-2xl leading-7 text-slate-600">
                Every handoff updates the same operational record, giving floor teams, managers, and
                clients the context they need without duplicate entry.
              </p>
            </div>

            <div className="relative mt-16">
              <div
                className={cn(
                  styles.routeLine,
                  "absolute left-[8%] right-[8%] top-8 hidden h-0.5 bg-gradient-to-r from-orange-200 via-orange-600 to-orange-200 lg:block"
                )}
              />
              <div className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
                {workflow.map((step, index) => {
                  const Icon = step.icon;
                  return (
                    <div
                      key={step.title}
                      data-reveal
                      style={{ transitionDelay: `${index * 70}ms` }}
                      className={cn(
                        styles.reveal,
                        "group rounded-2xl border border-orange-100 bg-white p-5 shadow-sm transition hover:-translate-y-2 hover:border-orange-300 hover:shadow-xl"
                      )}
                    >
                      <div className="flex items-start justify-between">
                        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#071a3d] text-white shadow-lg transition group-hover:bg-orange-600">
                          <Icon className="h-6 w-6" />
                        </span>
                        <span className="text-[10px] font-bold text-orange-500">{step.number}</span>
                      </div>
                      <h3 className="mt-6 text-base font-bold text-slate-900">{step.title}</h3>
                      <p className="mt-2 text-xs leading-5 text-slate-600">{step.copy}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section id="platform" className="py-24 sm:py-32">
          <div className="mx-auto max-w-7xl px-5 sm:px-7 lg:px-10">
            <div data-reveal className={cn(styles.reveal, "max-w-3xl")}>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600">
                One platform, focused experiences
              </p>
              <h2 className="mt-4 font-headline text-4xl font-bold tracking-tight text-[#071a3d] sm:text-5xl">
                The right view for every person in the operation.
              </h2>
            </div>

            <div className="mt-12 grid gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
              <div data-reveal className={cn(styles.reveal, "space-y-3")}>
                {(Object.keys(portals) as PortalKey[]).map((key) => {
                  const item = portals[key];
                  const Icon = item.icon;
                  const active = portal === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setPortal(key)}
                      className={cn(
                        "w-full rounded-2xl border p-5 text-left transition",
                        active
                          ? "border-orange-300 bg-orange-50 shadow-lg shadow-orange-100"
                          : "border-slate-200 bg-white hover:border-orange-200"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            "rounded-xl p-2.5",
                            active ? "bg-orange-600 text-white" : "bg-slate-100 text-slate-700"
                          )}
                        >
                          <Icon className="h-5 w-5" />
                        </span>
                        <span>
                          <span className="block text-sm font-bold">{item.label}</span>
                          <span className="text-xs text-slate-500">{item.eyebrow}</span>
                        </span>
                        <ArrowRight
                          className={cn(
                            "ml-auto h-4 w-4 transition",
                            active ? "translate-x-0 text-orange-600" : "-translate-x-1 text-slate-300"
                          )}
                        />
                      </div>
                    </button>
                  );
                })}

                <div className="pt-5">
                  <p className="text-2xl font-bold tracking-tight text-[#071a3d]">
                    {portals[portal].title}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{portals[portal].copy}</p>
                  <ul className="mt-5 space-y-3">
                    {portals[portal].bullets.map((bullet) => (
                      <li key={bullet} className="flex gap-2.5 text-sm text-slate-700">
                        <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        {bullet}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div data-reveal className={cn(styles.reveal, "lg:pl-6")}>
                <PlatformPreview portal={portal} />
              </div>
            </div>
          </div>
        </section>

        <section id="capabilities" className="bg-slate-50 py-24 sm:py-32">
          <div className="mx-auto max-w-7xl px-5 sm:px-7 lg:px-10">
            <div
              data-reveal
              className={cn(styles.reveal, "flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between")}
            >
              <div className="max-w-3xl">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600">
                  Operational depth, without the clutter
                </p>
                <h2 className="mt-4 font-headline text-4xl font-bold tracking-tight text-[#071a3d] sm:text-5xl">
                  The details are connected. The experience stays clear.
                </h2>
              </div>
              <p className="max-w-md text-sm leading-6 text-slate-600">
                PrepCorex is designed around the real work of prep centers and fulfillment
                warehouses—not a generic order screen with warehouse terminology added later.
              </p>
            </div>

            <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {featureCards.map((feature, index) => {
                const Icon = feature.icon;
                return (
                  <article
                    key={feature.title}
                    data-reveal
                    style={{ transitionDelay: `${(index % 3) * 80}ms` }}
                    className={cn(
                      styles.reveal,
                      feature.className,
                      "group min-h-[250px] rounded-[26px] border bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-xl sm:p-8"
                    )}
                  >
                    <span className={cn("inline-flex rounded-2xl p-3", feature.tone)}>
                      <Icon className="h-6 w-6" />
                    </span>
                    <h3 className="mt-8 text-xl font-bold tracking-tight text-[#071a3d]">
                      {feature.title}
                    </h3>
                    <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">{feature.copy}</p>
                    <span className="mt-7 inline-flex items-center gap-1 text-xs font-bold text-orange-600 opacity-0 transition group-hover:opacity-100">
                      Built into the workflow <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className={cn(styles.parallaxBand, "relative overflow-hidden py-24 text-white sm:py-32")}>
          <div className={styles.noise} />
          <div className={cn(styles.beam, styles.beamOne)} />
          <div className={cn(styles.beam, styles.beamTwo)} />
          <div className="relative mx-auto max-w-7xl px-5 sm:px-7 lg:px-10">
            <div className="grid gap-16 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
              <div data-reveal className={cn(styles.reveal, "max-w-xl")}>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-orange-300 backdrop-blur">
                  <Radio className="h-3.5 w-3.5" />
                  Live from the warehouse floor
                </div>
                <h2 className="mt-6 font-headline text-4xl font-bold tracking-tight sm:text-6xl">
                  See the operation while it happens.
                </h2>
                <p className="mt-6 text-base leading-8 text-slate-300">
                  Status changes, scans, photos, video, quantities, locations, approvals, and
                  tracking all move through the same record—creating visibility that is useful now
                  and accountable later.
                </p>
                <Link
                  href="/register"
                  className="mt-8 inline-flex items-center gap-2 rounded-full bg-orange-600 px-6 py-3 text-sm font-bold text-white shadow-xl shadow-orange-900/30 transition hover:-translate-y-1 hover:bg-orange-500"
                >
                  Build a connected operation <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              <div data-reveal className={cn(styles.reveal, "grid grid-cols-2 gap-3 sm:grid-cols-3")}>
                {[
                  ["Live", "Inventory state", Boxes],
                  ["Private", "Receiving video", Camera],
                  ["Role-based", "Team access", Fingerprint],
                  ["Tracked", "Warehouse moves", RefreshCw],
                  ["Visible", "Client reporting", BarChart3],
                  ["Connected", "Sales channels", Cloud],
                ].map(([value, label, ItemIcon], index) => {
                  const Icon = ItemIcon as LucideIcon;
                  return (
                    <div
                      key={String(label)}
                      className={cn(
                        index % 2 ? styles.floatCardA : styles.floatCardB,
                        "rounded-2xl border border-white/10 bg-white/[0.07] p-5 backdrop-blur-md"
                      )}
                    >
                      <Icon className="h-5 w-5 text-orange-400" />
                      <p className="mt-7 text-xl font-bold">{String(value)}</p>
                      <p className="mt-1 text-xs text-slate-400">{String(label)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section id="integrations" className="py-24 sm:py-32">
          <div className="mx-auto max-w-7xl px-5 sm:px-7 lg:px-10">
            <div data-reveal className={cn(styles.reveal, "mx-auto max-w-3xl text-center")}>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600">
                Connected commerce
              </p>
              <h2 className="mt-4 font-headline text-4xl font-bold tracking-tight text-[#071a3d] sm:text-5xl">
                Bring orders and inventory into one operational flow.
              </h2>
              <p className="mx-auto mt-5 max-w-2xl leading-7 text-slate-600">
                Connect the channels your clients sell through, then manage fulfillment from one
                consistent warehouse process.
              </p>
            </div>

            <div data-reveal className={cn(styles.reveal, "mt-12 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6")}>
              {integrations.map((integration) => (
                <div
                  key={integration.id}
                  className="flex min-h-[108px] flex-col items-center justify-center gap-3 rounded-2xl border bg-white p-4 shadow-sm transition hover:-translate-y-1 hover:border-orange-300 hover:shadow-lg"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50">
                    <PlatformBrandLogo platformId={integration.id} className="h-7 w-7" />
                  </span>
                  <span className="text-xs font-bold text-slate-700">{integration.label}</span>
                </div>
              ))}
            </div>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs text-slate-500">
              {["Order sync", "Inventory updates", "Fulfillment status", "Tracking visibility"].map(
                (item) => (
                  <span key={item} className="inline-flex items-center gap-2">
                    <Zap className="h-3.5 w-3.5 text-orange-500" />
                    {item}
                  </span>
                )
              )}
            </div>
          </div>
        </section>

        <section id="security" className="bg-[#fffaf5] py-24 sm:py-32">
          <div className="mx-auto max-w-7xl px-5 sm:px-7 lg:px-10">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              <div data-reveal className={cn(styles.reveal, "relative")}>
                <div className="relative mx-auto flex aspect-square max-w-[480px] items-center justify-center rounded-full border border-orange-200 bg-white shadow-[0_35px_100px_rgba(255,90,10,0.12)]">
                  <div className="absolute inset-[12%] rounded-full border border-dashed border-orange-300" />
                  <div className="absolute inset-[25%] rounded-full border border-slate-200" />
                  <span className="relative flex h-28 w-28 items-center justify-center rounded-[30px] bg-[#071a3d] text-white shadow-2xl">
                    <ShieldCheck className="h-12 w-12 text-orange-400" />
                  </span>
                  {[
                    ["Role access", "left-[5%] top-[22%]", Users],
                    ["Audit trail", "right-[2%] top-[35%]", ClipboardCheck],
                    ["Private media", "bottom-[13%] left-[15%]", LockKeyhole],
                  ].map(([label, position, ItemIcon]) => {
                    const Icon = ItemIcon as LucideIcon;
                    return (
                      <span
                        key={String(label)}
                        className={cn(
                          styles.floatCardC,
                          position,
                          "absolute inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-xs font-semibold shadow-lg"
                        )}
                      >
                        <Icon className="h-4 w-4 text-orange-600" />
                        {String(label)}
                      </span>
                    );
                  })}
                </div>
              </div>

              <div data-reveal className={cn(styles.reveal, "max-w-xl")}>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600">
                  Control and accountability
                </p>
                <h2 className="mt-4 font-headline text-4xl font-bold tracking-tight text-[#071a3d] sm:text-5xl">
                  Access is intentional. Activity is traceable.
                </h2>
                <p className="mt-5 leading-7 text-slate-600">
                  PrepCorex separates client, warehouse, administrator, and affiliate experiences
                  while preserving a complete operational record for the people authorized to see it.
                </p>

                <div className="mt-8 space-y-4">
                  {[
                    ["Role and feature permissions", "Give each person only the workflows and warehouses they need.", Fingerprint],
                    ["Operational audit trails", "Keep edits, movements, approvals, and history connected to the responsible user.", ClipboardCheck],
                    ["Private receiving media", "Client-matched live access and private playback—without exposing raw Drive links.", LockKeyhole],
                    ["Terms and account controls", "Email verification, account approval, service documents, and client activation gates.", FileText],
                  ].map(([title, copy, ItemIcon]) => {
                    const Icon = ItemIcon as LucideIcon;
                    return (
                      <div key={String(title)} className="flex gap-4 rounded-2xl border border-orange-100 bg-white p-4">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
                          <Icon className="h-5 w-5" />
                        </span>
                        <div>
                          <h3 className="text-sm font-bold">{String(title)}</h3>
                          <p className="mt-1 text-xs leading-5 text-slate-600">{String(copy)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-24 sm:py-32">
          <div className="mx-auto max-w-5xl px-5 sm:px-7">
            <div data-reveal className={cn(styles.reveal, "text-center")}>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600">
                Clear answers
              </p>
              <h2 className="mt-4 font-headline text-4xl font-bold tracking-tight text-[#071a3d] sm:text-5xl">
                What PrepCorex replaces and connects.
              </h2>
            </div>

            <div className="mt-12 grid gap-3">
              {[
                [
                  "Who is PrepCorex for?",
                  "Prep centers, 3PLs, fulfillment warehouses, operators, managers, and the clients they serve. Each role gets a focused portal instead of sharing one overloaded interface.",
                ],
                [
                  "Does it cover the full warehouse workflow?",
                  "Yes. Expected inbound, receiving, inspection, putaway, storage, internal moves, inventory, picking, packing, dispatch, returns, quarantine, cycle counts, billing, and reporting are connected.",
                ],
                [
                  "Can clients see their own operation?",
                  "Yes. Clients can view and request work, monitor inventory and shipments, connect channels, buy labels, review invoices, watch receiving video, and download reports without seeing another client's data.",
                ],
                [
                  "Does it work on the warehouse floor?",
                  "Warehouse Ops is scan-first and mobile-friendly, with dedicated queues and permissions for receiving, putaway, picking, packing, dispatch, quality, and supervisor work.",
                ],
              ].map(([question, answer]) => (
                <details
                  key={question}
                  data-reveal
                  className={cn(styles.reveal, "group rounded-2xl border bg-white p-5 shadow-sm open:border-orange-200 open:bg-orange-50/30")}
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-bold text-slate-900">
                    {question}
                    <ChevronDown className="h-4 w-4 shrink-0 text-orange-600 transition group-open:rotate-180" />
                  </summary>
                  <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-600">{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 pb-8 sm:px-7 sm:pb-12">
          <div
            data-reveal
            className={cn(
              styles.reveal,
              "relative mx-auto max-w-7xl overflow-hidden rounded-[34px] bg-[#071a3d] px-6 py-16 text-center text-white shadow-2xl sm:px-12 sm:py-24"
            )}
          >
            <div className={styles.noise} />
            <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-orange-600/25 blur-3xl" />
            <div className="absolute -bottom-32 -right-12 h-72 w-72 rounded-full bg-blue-500/15 blur-3xl" />
            <div className="relative">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-orange-300">
                <Globe2 className="h-3.5 w-3.5" />
                Your operation deserves one clear system
              </span>
              <h2 className="mx-auto mt-6 max-w-4xl font-headline text-4xl font-bold tracking-tight sm:text-6xl">
                Move faster. Make fewer mistakes. Give every client confidence.
              </h2>
              <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-slate-300">
                Bring your warehouse team, client experience, integrations, and operational records
                into one connected PrepCorex workflow.
              </p>
              <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
                <Link
                  href="/register"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-orange-600 px-7 text-sm font-bold text-white shadow-xl shadow-orange-950/40 transition hover:-translate-y-1 hover:bg-orange-500"
                >
                  Create your account <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/login"
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/20 bg-white/5 px-7 text-sm font-bold text-white backdrop-blur transition hover:bg-white/10"
                >
                  Sign in to PrepCorex
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t bg-white">
        <div className="mx-auto max-w-7xl px-5 py-12 sm:px-7 lg:px-10">
          <div className="grid gap-10 md:grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr]">
            <div>
              <img src={brandLogoSrc} alt="PrepCorex" className="h-auto w-[170px]" />
              <p className="mt-4 max-w-sm text-sm leading-6 text-slate-600">
                Connected warehouse and fulfillment operations for modern prep centers, teams, and
                their clients.
              </p>
              <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Built for real warehouse work
              </div>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-900">Platform</p>
              <div className="mt-4 grid gap-3 text-sm text-slate-600">
                <a href="#workflow" className="hover:text-orange-600">Workflow</a>
                <a href="#platform" className="hover:text-orange-600">Portals</a>
                <a href="#capabilities" className="hover:text-orange-600">Capabilities</a>
                <a href="#integrations" className="hover:text-orange-600">Integrations</a>
              </div>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-900">Access</p>
              <div className="mt-4 grid gap-3 text-sm text-slate-600">
                <Link href="/login" className="hover:text-orange-600">Sign in</Link>
                <Link href="/register" className="hover:text-orange-600">Client registration</Link>
                <Link href="/register-agent" className="hover:text-orange-600">Affiliate application</Link>
              </div>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-900">Legal</p>
              <div className="mt-4 grid gap-3 text-sm text-slate-600">
                <a href="/api/platform-documents/terms/pdf" target="_blank" rel="noreferrer" className="hover:text-orange-600">Terms</a>
                <a href="/api/platform-documents/privacy/pdf" target="_blank" rel="noreferrer" className="hover:text-orange-600">Privacy</a>
                <a href="/api/platform-documents/msa/pdf" target="_blank" rel="noreferrer" className="hover:text-orange-600">Service agreement</a>
              </div>
            </div>
          </div>
          <div className="mt-10 flex flex-col gap-3 border-t pt-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} PrepCorex. All rights reserved.</p>
            <p>Prep Services FBA LLC · Warehouse operations, connected.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
