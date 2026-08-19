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
  Eye,
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
  Smartphone,
  Sparkles,
  Truck,
  TrendingDown,
  UploadCloud,
  Users,
  Video,
  Warehouse,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { brandLogoSrc } from "@/components/logo";
import { PlatformBrandLogo } from "@/components/integrations/platform-brand-logo";
import styles from "./marketing-landing.module.css";
import { cn } from "@/lib/utils";

type PortalKey = "client" | "warehouse" | "admin" | "affiliate";

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
  affiliate: {
    label: "Affiliate dashboard",
    eyebrow: "Referrals and commission clarity",
    title: "Give affiliates a transparent view of every referral and earning.",
    copy: "Commission agents can share their referral code, follow referred clients from approval through paid invoices, and understand pending and paid commission from one dedicated dashboard.",
    bullets: [
      "Live referral code, pending clients, approved clients, and rejected-client visibility",
      "Qualified paid-invoice revenue and commission performance by month",
      "Commission tier, rate, payout status, and client eligibility windows",
    ],
    icon: CircleDollarSign,
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
    ["Product", "#capabilities"],
    ["Warehouse Ops", "#workflow"],
    ["Client Portal", "#platform"],
    ["Savings", "#label-savings"],
    ["Integrations", "#integrations"],
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
  return (
    <div className="relative mx-auto aspect-[1.54/1] w-full max-w-[760px] lg:mx-0">
      <div
        className={cn(
          styles.dashboard,
          "absolute bottom-[7%] left-[9%] right-[15%] top-[3%] overflow-hidden rounded-[18px] border border-slate-200 bg-white shadow-2xl"
        )}
      >
        <aside className="absolute inset-y-0 left-0 w-[21%] bg-[#071a3d] p-[3%] text-white">
          <div className="flex items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-orange-600">
              <Box className="h-3 w-3" />
            </span>
            <span className="text-[clamp(5px,1vw,9px)] font-bold">PrepCorex</span>
          </div>
          <nav className="mt-[22%] space-y-[5%]">
            {[
              ["Dashboard", BarChart3],
              ["Receive", PackageOpen],
              ["Inventory", Boxes],
              ["Orders", ShoppingCart],
              ["Returns", RotateCcw],
              ["Reports", FileText],
              ["Billing", CircleDollarSign],
            ].map(([label, ItemIcon], index) => {
              const Icon = ItemIcon as LucideIcon;
              return (
                <div
                  key={String(label)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[clamp(4px,.72vw,7px)] font-medium",
                    index === 0 ? "bg-orange-600 text-white" : "text-slate-300"
                  )}
                >
                  <Icon className="h-2.5 w-2.5 shrink-0" />
                  <span>{String(label)}</span>
                </div>
              );
            })}
          </nav>
        </aside>

        <div className="ml-[21%] h-full p-[3%]">
          <div className="flex items-center justify-between">
            <h3 className="text-[clamp(7px,1.2vw,12px)] font-bold text-slate-900">Dashboard</h3>
            <div className="flex items-center gap-1.5 text-[clamp(4px,.65vw,7px)] text-slate-500">
              <span>PrepCorex Warehouse</span>
              <Bell className="h-2.5 w-2.5" />
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-950 text-[6px] font-bold text-white">
                JS
              </span>
            </div>
          </div>

          <div className="mt-[4%] grid grid-cols-4 gap-[2%]">
            {[
              ["Orders Shipped", "1,238", "+8%"],
              ["Units Shipped", "2,567", "+21%"],
              ["On-Time Ship", "98.6%", "+2.1%"],
              ["Open Returns", "32", "-6%"],
            ].map(([label, value, change]) => (
              <div key={label} className="rounded-lg border border-slate-100 bg-white p-[8%] shadow-sm">
                <p className="truncate text-[clamp(4px,.6vw,6px)] text-slate-500">{label}</p>
                <p className="mt-1 text-[clamp(8px,1.4vw,14px)] font-bold text-slate-900">{value}</p>
                <p className="mt-0.5 text-[clamp(3px,.5vw,5px)] font-medium text-emerald-500">
                  ↑ {change} vs yesterday
                </p>
              </div>
            ))}
          </div>

          <div className="mt-[3%] grid h-[40%] grid-cols-[1.45fr_.9fr] gap-[2%]">
            <div className="rounded-lg border border-slate-100 p-[4%] shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-[clamp(5px,.72vw,7px)] font-bold text-slate-800">Orders Over Time</p>
                <span className="rounded border px-1.5 py-0.5 text-[clamp(3px,.5vw,5px)] text-slate-500">7 Days⌄</span>
              </div>
              <div className="relative mt-[4%] h-[72%]">
                <div className="absolute inset-0 flex flex-col justify-between">
                  {[0, 1, 2, 3].map((line) => (
                    <span key={line} className="block border-t border-dashed border-slate-100" />
                  ))}
                </div>
                <svg viewBox="0 0 260 90" preserveAspectRatio="none" className="relative h-full w-full overflow-visible">
                  <defs>
                    <linearGradient id="hero-chart-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2563eb" stopOpacity=".18" />
                      <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d="M0 75 L25 66 L50 70 L76 42 L101 50 L127 38 L153 43 L178 31 L204 34 L230 18 L260 10 L260 90 L0 90 Z" fill="url(#hero-chart-fill)" />
                  <polyline points="0,75 25,66 50,70 76,42 101,50 127,38 153,43 178,31 204,34 230,18 260,10" fill="none" stroke="#2563eb" strokeWidth="2.3" vectorEffect="non-scaling-stroke" />
                </svg>
              </div>
            </div>

            <div className="rounded-lg border border-slate-100 p-[5%] shadow-sm">
              <p className="text-[clamp(5px,.72vw,7px)] font-bold text-slate-800">Top SKUs by Units Shipped</p>
              <div className="mt-[7%] space-y-[6%]">
                {[["PCX-TEE-001", "1,234"], ["PCX-HOOD-002", "928"], ["PCX-MUG-001", "764"], ["PCX-TOTE-004", "642"], ["PCX-HAT-002", "517"]].map(([sku, units]) => (
                  <div key={sku} className="flex justify-between text-[clamp(3px,.55vw,5px)] text-slate-600">
                    <span>{sku}</span><span className="font-semibold">{units}</span>
                  </div>
                ))}
              </div>
              <p className="mt-[7%] text-[clamp(3px,.55vw,5px)] font-semibold text-blue-600">View full report →</p>
            </div>
          </div>

          <div className="mt-[3%] rounded-lg border border-slate-100 p-[2.5%] shadow-sm">
            <p className="text-[clamp(5px,.72vw,7px)] font-bold text-slate-800">Warehouse Activity</p>
            <div className="mt-[2%] grid grid-cols-4 gap-[2%]">
              {[
                ["Receiving", "12", "bg-emerald-50 text-emerald-700"],
                ["In Progress", "28", "bg-blue-50 text-blue-700"],
                ["Ready to Ship", "64", "bg-orange-50 text-orange-700"],
                ["Shipped Today", "1,238", "bg-emerald-50 text-emerald-700"],
              ].map(([label, value, color]) => (
                <div key={label} className={cn("rounded-md p-[7%]", color)}>
                  <p className="text-[clamp(3px,.5vw,5px)]">{label}</p>
                  <p className="mt-0.5 text-[clamp(7px,1vw,10px)] font-bold">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div
        className={cn(
          styles.floatCardA,
          "absolute bottom-0 left-0 w-[23%] -rotate-[7deg] rounded-[22px] border-[5px] border-[#071a3d] bg-white p-[1.3%] shadow-2xl"
        )}
      >
        <div className="rounded-[14px] bg-[#fffaf5] p-[9%]">
          <div className="flex items-center justify-between">
            <span className="text-[clamp(4px,.65vw,7px)] font-bold text-slate-800">‹ Scan Item</span>
            <ScanLine className="h-2.5 w-2.5 text-slate-600" />
          </div>
          <div className="relative mt-[12%] flex aspect-[1.7/1] items-center justify-center overflow-hidden rounded-md border bg-white">
            <div className="flex h-[55%] w-[78%] items-center justify-center bg-[repeating-linear-gradient(90deg,#0f172a_0_1px,transparent_1px_3px)]">
              <span className={cn(styles.videoScan, "!top-1/2 !bg-red-500")} />
            </div>
          </div>
          <div className="mt-[8%]">
            <p className="text-[clamp(5px,.8vw,8px)] font-bold text-slate-900">PCX-TEE-001</p>
            <p className="text-[clamp(3px,.5vw,5px)] text-slate-500">T-Shirt · Black / L</p>
            <div className="mt-[8%] space-y-[5%] text-[clamp(3px,.48vw,5px)] text-slate-500">
              <div className="flex justify-between border-b pb-1"><span>SKU</span><b className="text-slate-700">PCX-TEE-001</b></div>
              <div className="flex justify-between border-b pb-1"><span>Location</span><b className="text-slate-700">A12-03</b></div>
              <div className="flex justify-between"><span>Quantity</span><b className="text-slate-700">− &nbsp; 1 &nbsp; +</b></div>
            </div>
            <div className="mt-[8%] rounded-md bg-orange-600 py-[6%] text-center text-[clamp(4px,.65vw,7px)] font-bold text-white">
              Confirm
            </div>
          </div>
        </div>
      </div>

      <div
        className={cn(
          styles.floatCardB,
          "absolute right-0 top-[8%] w-[24%] rotate-[2deg] rounded-xl border bg-white p-[2.5%] shadow-2xl"
        )}
      >
        <div className="flex items-center justify-between">
          <p className="text-[clamp(5px,.8vw,8px)] font-bold text-slate-900">Live Orders</p>
          <span className="flex items-center gap-1 text-[clamp(3px,.5vw,5px)] font-semibold text-emerald-600">
            <span className="h-1 w-1 rounded-full bg-emerald-500" /> Live
          </span>
        </div>
        <div className="mt-[8%] space-y-[6%]">
          {[
            ["#10293", "Ready to Ship", "8m"],
            ["#10294", "Picking", "1h"],
            ["#10295", "Packing", "1h"],
            ["#10296", "Shipped", "2h"],
          ].map(([order, status, time], index) => (
            <div key={order} className="flex items-center justify-between text-[clamp(3px,.48vw,5px)]">
              <span className="font-semibold text-slate-700">{order}</span>
              <span
                className={cn(
                  "rounded px-1 py-0.5 font-medium",
                  index === 3
                    ? "bg-emerald-50 text-emerald-600"
                    : index === 1
                      ? "bg-orange-50 text-orange-600"
                      : "bg-blue-50 text-blue-600"
                )}
              >
                {status}
              </span>
              <span className="text-slate-400">{time}</span>
            </div>
          ))}
        </div>
        <p className="mt-[9%] text-[clamp(3px,.5vw,5px)] font-semibold text-blue-600">View all orders →</p>
      </div>

      <div
        className={cn(
          styles.floatCardC,
          "absolute bottom-[2%] right-[1%] w-[25%] rotate-[3deg] rounded-xl bg-[#071a3d] p-[3%] text-white shadow-2xl"
        )}
      >
        <div className="flex items-center justify-between">
          <p className="text-[clamp(5px,.78vw,8px)] font-semibold">Savings Report</p>
          <span className="rounded bg-white/10 px-1 py-0.5 text-[clamp(3px,.45vw,5px)]">This Month⌄</span>
        </div>
        <p className="mt-[10%] text-[clamp(3px,.5vw,5px)] text-slate-300">Total Savings</p>
        <p className="text-[clamp(12px,2.1vw,21px)] font-bold text-emerald-400">$43,680</p>
        <p className="text-[clamp(3px,.45vw,5px)] text-emerald-300">↑ 28% vs last month</p>
        <div className="mt-[8%] flex h-[50px] items-end gap-[4%]">
          {[30, 45, 38, 57, 63, 52, 74, 88].map((height, index) => (
            <span
              key={index}
              className="flex-1 rounded-t-sm bg-gradient-to-t from-orange-600 to-orange-400"
              style={{ height: `${height}%` }}
            />
          ))}
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
          ) : portal === "admin" ? (
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
          ) : (
            <>
              {[
                ["Referred clients", "18", Users],
                ["Pending commission", "$2,840", CircleDollarSign],
                ["Paid commission", "$12,460", BadgeCheck],
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
              <div className="col-span-full grid gap-2 sm:grid-cols-[1.25fr_.75fr]">
                <div className="rounded-xl border p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold">Commission performance</p>
                    <span className="rounded-full bg-emerald-50 px-2 py-1 text-[8px] font-semibold text-emerald-700">
                      Tier 2 · 7%
                    </span>
                  </div>
                  <div className="mt-5 flex h-20 items-end gap-2">
                    {[36, 48, 42, 58, 67, 61, 78, 89].map((height, index) => (
                      <span
                        key={index}
                        className="flex-1 rounded-t bg-gradient-to-t from-orange-600 to-orange-300"
                        style={{ height: `${height}%` }}
                      />
                    ))}
                  </div>
                  <div className="mt-2 flex justify-between text-[7px] text-slate-400">
                    <span>Jan</span><span>Aug</span>
                  </div>
                </div>
                <div className="rounded-xl bg-slate-950 p-4 text-white">
                  <p className="text-[9px] text-slate-400">Referral code</p>
                  <p className="mt-2 text-base font-bold tracking-wider">PCX-ALEX24</p>
                  <div className="mt-4 rounded-lg bg-orange-600 px-3 py-2 text-center text-[8px] font-semibold">
                    Copy referral link
                  </div>
                  <p className="mt-3 text-[7px] leading-4 text-slate-400">
                    Track every qualified referral from signup to commission.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function LiveReceivingSection() {
  const moments = [
    {
      icon: Video,
      title: "Receiver starts the session",
      copy: "The same phone used for receiving records the inspection and publishes the live view.",
    },
    {
      icon: Eye,
      title: "The right client watches live",
      copy: "Access is matched to the client and inbound request, including the product and SKU context.",
    },
    {
      icon: UploadCloud,
      title: "The clip is saved privately",
      copy: "After receiving ends, the completed clip uploads to private admin storage without routing video through Firebase.",
    },
    {
      icon: LockKeyhole,
      title: "Playback stays in PrepCorex",
      copy: "Authorized clients return to their inventory record to watch—without receiving a raw storage link.",
    },
  ];

  return (
    <section id="live-video" className="relative overflow-hidden bg-[#071a3d] py-24 text-white sm:py-32">
      <div className={styles.noise} />
      <div className="absolute -left-40 top-10 h-96 w-96 rounded-full bg-orange-600/20 blur-3xl" />
      <div className="absolute -right-40 bottom-0 h-96 w-96 rounded-full bg-blue-500/10 blur-3xl" />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-7 lg:px-10">
        <div className="grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div data-reveal className={cn(styles.reveal, "max-w-xl")}>
            <div className="inline-flex items-center gap-2 rounded-full border border-red-400/25 bg-red-500/10 px-3 py-1.5 text-xs font-bold text-red-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
              </span>
              LIVE RECEIVING VIDEO
            </div>
            <h2 className="mt-6 font-headline text-4xl font-bold tracking-tight sm:text-6xl">
              Don&apos;t just tell clients.{" "}
              <span className="text-orange-400">Let them see.</span>
            </h2>
            <p className="mt-6 text-base leading-8 text-slate-300">
              Turn receiving into a transparent client experience. Operators can record from a
              phone while authorized clients watch the product inspection live—then return to the
              inventory record for private playback.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {[
                ["Product + SKU context", PackageCheck],
                ["Front or back camera", Smartphone],
                ["Live client access", Wifi],
                ["Multiple clips per inbound", Video],
              ].map(([label, ItemIcon]) => {
                const Icon = ItemIcon as LucideIcon;
                return (
                  <div
                    key={String(label)}
                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-xs font-semibold text-slate-200"
                  >
                    <Icon className="h-4 w-4 text-orange-400" />
                    {String(label)}
                  </div>
                );
              })}
            </div>
          </div>

          <div data-reveal className={cn(styles.reveal, "relative mx-auto w-full max-w-[680px]")}>
            <div className="grid items-center gap-5 sm:grid-cols-[0.72fr_auto_1.28fr]">
              <div className={cn(styles.floatCardB, "relative mx-auto w-[210px] rounded-[34px] border-[7px] border-slate-800 bg-slate-950 p-2 shadow-2xl")}>
                <div className="relative aspect-[9/16] overflow-hidden rounded-[23px] bg-slate-900">
                  <div
                    className="absolute inset-0 bg-cover bg-center opacity-70"
                    style={{
                      backgroundImage:
                        "linear-gradient(to top, rgba(2,10,25,.86), transparent 60%), url('https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=500&h=900&fit=crop')",
                    }}
                  />
                  <div className={styles.videoScan} />
                  <div className="absolute inset-x-3 top-3 flex items-center justify-between">
                    <span className="rounded-full bg-red-600 px-2 py-1 text-[8px] font-bold">
                      ● REC 02:18
                    </span>
                    <span className="rounded-full bg-black/45 p-1.5">
                      <Wifi className="h-3 w-3" />
                    </span>
                  </div>
                  <div className="absolute inset-x-3 bottom-3">
                    <p className="text-[9px] font-bold">Inbound INB-2451</p>
                    <p className="mt-0.5 text-[8px] text-slate-300">Wireless Headphones · PCX-2334</p>
                    <div className="mt-3 flex items-center justify-center">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-white bg-red-600">
                        <span className="h-3 w-3 rounded-sm bg-white" />
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative hidden w-12 sm:block">
                <span className={cn(styles.liveSignal, "block h-px w-full bg-gradient-to-r from-orange-500 to-red-400")} />
                <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500 shadow-[0_0_16px_rgba(239,68,68,.9)]" />
              </div>

              <div className="overflow-hidden rounded-[24px] border border-white/15 bg-white/[0.07] p-3 shadow-2xl backdrop-blur">
                <div className="flex items-center justify-between border-b border-white/10 px-1 pb-3">
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-slate-400">Client inventory</p>
                    <p className="text-xs font-bold">Live receiving inspection</p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-1 text-[8px] font-bold text-red-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" /> LIVE
                  </span>
                </div>
                <div className="relative mt-3 aspect-video overflow-hidden rounded-xl bg-slate-900">
                  <div
                    className="absolute inset-0 bg-cover bg-center opacity-75"
                    style={{
                      backgroundImage:
                        "linear-gradient(to top, rgba(2,10,25,.75), transparent 60%), url('https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=800&h=450&fit=crop')",
                    }}
                  />
                  <div className={styles.videoScan} />
                  <span className="absolute left-3 top-3 rounded-full bg-black/50 px-2 py-1 text-[8px] font-semibold">
                    New Jersey Warehouse
                  </span>
                  <div className="absolute bottom-3 left-3">
                    <p className="text-[10px] font-bold">Wireless Headphones</p>
                    <p className="text-[8px] text-slate-300">SKU PCX-2334 · Inbound INB-2451</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between rounded-xl bg-white/[0.05] p-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/15 text-orange-400">
                      <Eye className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-[9px] font-bold">Watching securely</p>
                      <p className="text-[8px] text-slate-400">Available only to the matched client</p>
                    </div>
                  </div>
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-16 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {moments.map((moment, index) => {
            const Icon = moment.icon;
            return (
              <article
                key={moment.title}
                data-reveal
                style={{ transitionDelay: `${index * 70}ms` }}
                className={cn(styles.reveal, "rounded-2xl border border-white/10 bg-white/[0.05] p-5 backdrop-blur")}
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/15 text-orange-400">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="text-[10px] font-bold text-slate-500">0{index + 1}</span>
                </div>
                <h3 className="mt-5 text-sm font-bold">{moment.title}</h3>
                <p className="mt-2 text-xs leading-5 text-slate-400">{moment.copy}</p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function LabelSavingsSection() {
  const [monthlyLabels, setMonthlyLabels] = useState(1000);
  const [carrier, setCarrier] = useState<"usps" | "ups" | "fedex">("usps");
  const prepCorexRate = 3.45;
  const comparisons = {
    usps: { label: "USPS", rate: 6.45 },
    ups: { label: "UPS", rate: 8.9 },
    fedex: { label: "FedEx", rate: 9.2 },
  };
  const comparison = comparisons[carrier];
  const annualLabels = monthlyLabels * 12;
  const marketAnnual = annualLabels * comparison.rate;
  const prepCorexAnnual = annualLabels * prepCorexRate;
  const annualSavings = Math.max(0, marketAnnual - prepCorexAnnual);
  const savingsPercent =
    marketAnnual > 0 ? Math.round((annualSavings / marketAnnual) * 100) : 0;
  const money = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);

  return (
    <section id="label-savings" className="relative overflow-hidden bg-[#fffaf5] py-24 sm:py-32">
      <div className="absolute left-1/2 top-0 h-72 w-[48rem] -translate-x-1/2 rounded-full bg-orange-200/30 blur-3xl" />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-7 lg:px-10">
        <div className="grid gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
          <div data-reveal className={cn(styles.reveal, "max-w-xl")}>
            <div className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-white px-3 py-1.5 text-xs font-bold text-orange-700 shadow-sm">
              <TrendingDown className="h-3.5 w-3.5" />
              LOWER-COST SHIPPING LABELS
            </div>
            <h2 className="mt-6 font-headline text-4xl font-bold tracking-tight text-[#071a3d] sm:text-6xl">
              Small savings per label.{" "}
              <span className="text-orange-600">A big year-end number.</span>
            </h2>
            <p className="mt-6 text-base leading-8 text-slate-600">
              Buy PrepCorex label rates inside the same workflow used to manage orders and
              fulfillment. Clients can see what they paid, compare estimated market cost, and track
              savings in their reports.
            </p>
            <div className="mt-8 space-y-3">
              {[
                "Buy and print labels without leaving the client portal",
                "Compare actual paid cost with USPS, UPS, and FedEx benchmarks",
                "See savings by label, period, carrier, and annual volume",
                "Keep labels, orders, tracking, invoices, and reports connected",
              ].map((item) => (
                <div key={item} className="flex items-start gap-3 text-sm text-slate-700">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <Check className="h-3 w-3" />
                  </span>
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div data-reveal className={cn(styles.reveal, "rounded-[30px] border border-orange-200 bg-white p-5 shadow-[0_35px_90px_rgba(255,90,10,.14)] sm:p-8")}>
            <div className="flex flex-col gap-4 border-b border-slate-100 pb-6 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-600">
                  Annual savings calculator
                </p>
                <h3 className="mt-2 text-2xl font-bold tracking-tight text-[#071a3d]">
                  What could lower-cost labels mean for you?
                </h3>
              </div>
              <span className="inline-flex w-fit items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
                Up to 1 lb example
              </span>
            </div>

            <div className="mt-7">
              <div className="flex items-end justify-between gap-4">
                <label htmlFor="monthly-label-volume" className="text-sm font-bold text-slate-800">
                  Labels per month
                </label>
                <div className="text-right">
                  <span className="text-3xl font-bold tabular-nums text-[#071a3d]">
                    {monthlyLabels.toLocaleString()}
                  </span>
                  <span className="ml-1 text-xs text-slate-500">labels</span>
                </div>
              </div>
              <input
                id="monthly-label-volume"
                type="range"
                min={100}
                max={10000}
                step={100}
                value={monthlyLabels}
                onChange={(event) => setMonthlyLabels(Number(event.target.value))}
                className={cn(styles.savingsRange, "mt-5 w-full")}
              />
              <div className="mt-2 flex justify-between text-[10px] font-medium text-slate-400">
                <span>100</span>
                <span>10,000 / month</span>
              </div>
            </div>

            <div className="mt-6">
              <p className="text-xs font-semibold text-slate-500">Compare the illustrative rate with</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {(Object.keys(comparisons) as Array<keyof typeof comparisons>).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setCarrier(key)}
                    className={cn(
                      "rounded-xl border px-3 py-3 text-left transition",
                      carrier === key
                        ? "border-orange-400 bg-orange-50 shadow-sm"
                        : "border-slate-200 hover:border-orange-200"
                    )}
                  >
                    <span className="block text-xs font-bold text-slate-800">{comparisons[key].label}</span>
                    <span className="mt-1 block text-[10px] text-slate-500">
                      ${comparisons[key].rate.toFixed(2)} / label
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs font-semibold text-slate-500">
                  Est. annual {comparison.label} cost
                </p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-slate-700">
                  {money(marketAnnual)}
                </p>
                <p className="mt-1 text-[10px] text-slate-400">
                  {annualLabels.toLocaleString()} labels × ${comparison.rate.toFixed(2)}
                </p>
              </div>
              <div className="rounded-2xl border border-orange-200 bg-orange-50 p-5">
                <p className="text-xs font-semibold text-orange-700">
                  Est. annual PrepCorex cost
                </p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-orange-700">
                  {money(prepCorexAnnual)}
                </p>
                <p className="mt-1 text-[10px] text-orange-600/70">
                  {annualLabels.toLocaleString()} labels × ${prepCorexRate.toFixed(2)}
                </p>
              </div>
            </div>

            <div className="mt-3 overflow-hidden rounded-2xl bg-[#071a3d] p-5 text-white sm:p-6">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-300">Illustrative yearly savings</p>
                  <p className="mt-1 font-headline text-4xl font-bold tabular-nums text-white sm:text-5xl">
                    {money(annualSavings)}
                  </p>
                  <p className="mt-2 text-xs text-emerald-300">
                    About {savingsPercent}% below the selected benchmark
                  </p>
                </div>
                <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-[7px] border-orange-500 bg-white/5 text-center shadow-[0_0_35px_rgba(249,115,22,.25)]">
                  <span>
                    <span className="block text-xl font-bold">{savingsPercent}%</span>
                    <span className="block text-[8px] uppercase text-slate-300">potential</span>
                  </span>
                </div>
              </div>
            </div>

            <p className="mt-4 text-[10px] leading-4 text-slate-400">
              Illustration only: compares a $3.45 PrepCorex example with the selected default
              light-package benchmark. Actual label prices and savings vary by weight, dimensions,
              zone, destination, service, surcharges, and available rates.
            </p>
          </div>
        </div>
      </div>
    </section>
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
          <div className="mx-auto grid max-w-7xl items-center gap-16 px-5 pb-28 pt-32 sm:px-7 sm:pt-36 lg:grid-cols-[0.92fr_1.08fr] lg:px-10 lg:pb-40 lg:pt-44">
            <div className="relative z-10">
              <div className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 shadow-sm">
                <Sparkles className="h-3.5 w-3.5" />
                Built to Scale. Backed by Prep.
              </div>
              <h1 className="mt-7 max-w-[520px] font-headline text-[clamp(2.35rem,4.1vw,3.85rem)] font-bold leading-[0.98] tracking-[-0.052em] text-[#071a3d] sm:max-w-[560px] lg:max-w-[580px]">
                From inbound to
                <br />
                dispatched. Every
                <br />
                unit{" "}
                <span className="bg-gradient-to-r from-orange-600 to-orange-400 bg-clip-text text-transparent">
                  under control.
                </span>
              </h1>
              <p className="mt-7 max-w-xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
                One connected platform for receiving, inventory, prep, shipping, returns, live
                receiving video, lower-cost labels, and real-time client reporting.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href="#platform"
                  className={cn(
                    styles.shine,
                    "inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-orange-600 px-6 text-sm font-bold text-white shadow-xl shadow-orange-600/20 transition hover:-translate-y-1 hover:bg-orange-700"
                  )}
                >
                  <Play className="h-4 w-4 fill-current" />
                  See PrepCorex in action
                  <ArrowRight className="h-4 w-4" />
                </a>
                <a
                  href="https://wa.link/771ry0"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-slate-300 bg-white/80 px-6 text-sm font-bold text-slate-800 shadow-sm backdrop-blur transition hover:-translate-y-1 hover:border-orange-300"
                >
                  Talk to us
                </a>
              </div>

              <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-xs font-medium text-slate-600">
                {["No fragmented handoffs", "Real-time visibility", "Client-ready reporting"].map((item) => (
                  <span key={item} className="inline-flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="relative z-10 pb-14 pt-7 lg:pt-0">
              <div className="absolute inset-x-8 bottom-2 top-12 -rotate-3 rounded-[34px] border border-orange-200 bg-orange-100/60" />
              <div className="absolute inset-x-5 bottom-5 top-8 rotate-2 rounded-[32px] border border-blue-100 bg-blue-50/80 shadow-xl" />
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
                      id={key === "affiliate" ? "affiliate-dashboard" : undefined}
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

        <LiveReceivingSection />

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

        <LabelSavingsSection />

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
                <a href="#live-video" className="hover:text-orange-600">Live receiving video</a>
                <a href="#label-savings" className="hover:text-orange-600">Label savings</a>
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
