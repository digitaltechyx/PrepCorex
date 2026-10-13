"use client";

import { useCallback, useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle } from "lucide-react";
import type { GofoCreateOrderPayload } from "@/lib/gofo-api";

type StatusInfo = {
  configured?: boolean;
  baseUrl?: string;
  username?: string;
  productCode?: string;
  entryPort?: string;
  environment?: string;
  error?: string;
};

const defaultShipper = {
  shipperName: "Prep Services FBA",
  shipperPhone: "13476613010",
  shipperCountry: "US",
  shipperState: "New Jersey",
  shipperCity: "Mount Laurel",
  shipperArea: "Mount Laurel",
  shipperStreet: "1700 Liberty Place",
  shipperCode: "08054",
  shipperEmail: "info@prepservicesfba.com",
};

const defaultConsignee = {
  consigneeName: "Test Receiver",
  consigneePhone: "2125550100",
  consigneeCountry: "US",
  consigneeState: "California",
  consigneeCity: "Los Angeles",
  consigneeArea: "Beverly Hills",
  address1: "350 5th Ave",
  address2: "",
  consigneeCode: "90210",
  consigneeEmail: "test@example.com",
  remarks: "Admin GOFO sandbox test — not a live shipment",
};

export function GofoSandboxTester() {
  const { toast } = useToast();
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string>("");
  const [orderNo, setOrderNo] = useState("");
  const [productCode, setProductCode] = useState("GOFO Parcel Pickup");
  const [entryPort, setEntryPort] = useState("PHX");
  const [weight, setWeight] = useState("1");
  const [length, setLength] = useState("20");
  const [width, setWidth] = useState("15");
  const [height, setHeight] = useState("10");
  const [declaredValue, setDeclaredValue] = useState("10");
  const [toZip, setToZip] = useState(defaultConsignee.consigneeCode);
  const [toName, setToName] = useState(defaultConsignee.consigneeName);
  const [toPhone, setToPhone] = useState(defaultConsignee.consigneePhone);
  const [toState, setToState] = useState(defaultConsignee.consigneeState);
  const [toCity, setToCity] = useState(defaultConsignee.consigneeCity);
  const [toAddress1, setToAddress1] = useState(defaultConsignee.address1);
  const [labelUrl, setLabelUrl] = useState<string | null>(null);

  const appendLog = (title: string, data: unknown) => {
    setLog((prev) => `${prev}\n\n=== ${title} @ ${new Date().toLocaleTimeString()} ===\n${JSON.stringify(data, null, 2)}`);
  };

  const callApi = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not signed in as admin.");
      const res = await fetch("/api/admin/gofo/sandbox", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action, ...extra }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      return json;
    },
    []
  );

  useEffect(() => {
    (async () => {
      try {
        const json = await callApi("status");
        setStatus(json);
        if (json.productCode) setProductCode(json.productCode);
        if (json.entryPort) setEntryPort(json.entryPort);
      } catch (e) {
        setStatus({
          configured: false,
          error: e instanceof Error ? e.message : "Failed to load status",
        });
      }
    })();
  }, [callApi]);

  function buildPayload(): GofoCreateOrderPayload {
    const cOrderNo = `ADMIN-${Date.now().toString().slice(-10)}`;
    return {
      cOrderNo,
      referenceNo: cOrderNo,
      shippingType: "HDN",
      productCode,
      declaredValue: Number(declaredValue) || 10,
      entryPort,
      orderShipper: defaultShipper,
      orderConsignee: {
        ...defaultConsignee,
        consigneeName: toName,
        consigneePhone: toPhone,
        consigneeState: toState,
        consigneeCity: toCity,
        address1: toAddress1,
        consigneeCode: toZip,
      },
      orderGoods: {
        weight: Number(weight) || 1,
        length: Number(length) || 20,
        width: Number(width) || 15,
        height: Number(height) || 10,
      },
      orderItemList: [{ itemNameEn: "Sandbox test item", itemNameZh: "Test", itemQty: 1 }],
    };
  }

  async function run(action: string) {
    setBusy(action);
    try {
      let extra: Record<string, unknown> = {};
      if (action === "verify") {
        extra = {
          consignee: {
            consigneeCountry: "US",
            consigneeState: toState,
            consigneeCity: toCity,
            consigneeCode: toZip,
            consigneeStreet: toAddress1,
          },
        };
      } else if (action === "rate" || action === "create") {
        extra = { payload: buildPayload() };
      } else if (action === "label" || action === "track" || action === "cancel") {
        if (!orderNo.trim()) throw new Error("Enter waybill / order number first.");
        extra = { orderNo: orderNo.trim(), remarks: "Admin sandbox cancel" };
      }

      const json = await callApi(action, extra);
      appendLog(action, json);

      if (action === "create" && json?.result?.data?.waybillNo) {
        setOrderNo(String(json.result.data.waybillNo));
      }
      if (action === "label") {
        const b64 = json?.result?.data?.base64code;
        if (b64) {
          if (labelUrl) URL.revokeObjectURL(labelUrl);
          const blob = new Blob(
            [Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))],
            { type: "application/pdf" }
          );
          setLabelUrl(URL.createObjectURL(blob));
        }
      }

      toast({
        title: json.ok ? `${action} OK` : `${action} returned error`,
        description: json.result?.msgEn || json.result?.msg || json.error || "",
        variant: json.ok ? "default" : "destructive",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      appendLog(action, { error: msg });
      toast({ variant: "destructive", title: "GOFO sandbox error", description: msg });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-amber-300 bg-amber-50/60">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-700" />
            Admin-only sandbox — not shown to clients
          </CardTitle>
          <CardDescription>
            Uses GOFO UAT credentials from server env. Do not share this page URL. When production
            credentials arrive, we can add GOFO to Buy Labels separately.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 text-sm">
          {status?.configured ? (
            <>
              <Badge variant="secondary">{status.environment || "configured"}</Badge>
              <span className="text-muted-foreground break-all">{status.baseUrl}</span>
              <span>· user {status.username}</span>
              <span>· default {status.productCode} / {status.entryPort}</span>
            </>
          ) : (
            <span className="text-destructive">
              {status?.error || "GOFO env not configured on this server."}
            </span>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Shipment test form</CardTitle>
            <CardDescription>Ship-from is fixed to PSF NJ for sandbox tests.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Product code</Label>
                <Input value={productCode} onChange={(e) => setProductCode(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Entry port</Label>
                <Input value={entryPort} onChange={(e) => setEntryPort(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>To name</Label>
                <Input value={toName} onChange={(e) => setToName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>To phone</Label>
                <Input value={toPhone} onChange={(e) => setToPhone(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>To state</Label>
                <Input value={toState} onChange={(e) => setToState(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>To city</Label>
                <Input value={toCity} onChange={(e) => setToCity(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>To address</Label>
              <Input value={toAddress1} onChange={(e) => setToAddress1(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>To ZIP</Label>
                <Input value={toZip} onChange={(e) => setToZip(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Declared value (USD)</Label>
                <Input value={declaredValue} onChange={(e) => setDeclaredValue(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div className="space-y-1">
                <Label>Weight kg</Label>
                <Input value={weight} onChange={(e) => setWeight(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>L cm</Label>
                <Input value={length} onChange={(e) => setLength(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>W cm</Label>
                <Input value={width} onChange={(e) => setWidth(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>H cm</Label>
                <Input value={height} onChange={(e) => setHeight(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Waybill / order no (after create)</Label>
              <Input
                value={orderNo}
                onChange={(e) => setOrderNo(e.target.value)}
                placeholder="Filled after Create succeeds"
              />
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              {(
                [
                  ["verify", "1. Verify ZIP"],
                  ["rate", "2. Get rate"],
                  ["create", "3. Create label order"],
                  ["label", "4. Download label"],
                  ["track", "5. Track"],
                  ["cancel", "6. Cancel"],
                ] as const
              ).map(([action, label]) => (
                <Button
                  key={action}
                  type="button"
                  variant={action === "create" ? "default" : "outline"}
                  disabled={!!busy || status?.configured === false}
                  onClick={() => run(action)}
                >
                  {busy === action && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {label}
                </Button>
              ))}
            </div>

            {labelUrl && (
              <a
                className="text-sm font-medium text-primary underline"
                href={labelUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open last label PDF
              </a>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">API log</CardTitle>
              <CardDescription>Raw sandbox responses for debugging.</CardDescription>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setLog("")}>
              Clear
            </Button>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[560px] overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100 whitespace-pre-wrap">
              {log.trim() || "Run a step to see responses here."}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
