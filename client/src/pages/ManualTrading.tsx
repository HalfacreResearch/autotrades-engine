import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { AlertTriangle, TrendingUp, TrendingDown, Zap, DollarSign, Shield } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type TradeAction =
  | { type: "entry"; pair: string; sizePercent: 2 | 4 | 6 }
  | { type: "exit"; pair: string; exitType: "full" | "capital" | "emergency" }
  | { type: "trailing_stop"; pair: string; stopPercent: number }
  | { type: "liquidation"; userId: number; clientName: string };

// ─── SFOX-supported rotation pairs ───────────────────────────────────────────

const ROTATION_PAIRS = [
  "ETH/BTC", "SOL/BTC", "BNB/BTC", "XRP/BTC", "ADA/BTC",
  "AVAX/BTC", "MATIC/BTC", "LINK/BTC", "DOT/BTC", "LTC/BTC",
  "BCH/BTC", "ATOM/BTC", "UNI/BTC", "AAVE/BTC", "XLM/BTC",
];

// ─── Confirmation dialog ──────────────────────────────────────────────────────

function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  action,
  isLoading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  action: TradeAction | null;
  isLoading: boolean;
}) {
  const [liquidationText, setLiquidationText] = useState("");

  if (!action) return null;

  const isEmergency = action.type === "exit" && action.exitType === "emergency";
  const isLiquidation = action.type === "liquidation";
  const expectedConfirmation = isLiquidation
    ? `LIQUIDATE ${action.clientName.toUpperCase()}`
    : null;
  const canConfirm = isLiquidation
    ? liquidationText === expectedConfirmation
    : true;

  const getTitle = () => {
    if (action.type === "entry") return `Confirm Rotation Entry — ${action.pair}`;
    if (action.type === "exit") {
      if (action.exitType === "full") return `Confirm Full Exit — ${action.pair}`;
      if (action.exitType === "capital") return `Confirm Capital Exit — ${action.pair}`;
      if (action.exitType === "emergency") return `⚠ EMERGENCY EXIT — ${action.pair}`;
    }
    if (action.type === "trailing_stop") return `Set Trailing Stop — ${action.pair}`;
    if (action.type === "liquidation") return `⚠ EMERGENCY LIQUIDATION`;
    return "Confirm Trade";
  };

  const getDescription = () => {
    if (action.type === "entry") {
      return `This will buy ${action.pair} using ${action.sizePercent}% of each client's BTC balance via Smart Routing. Executes across ALL active clients simultaneously.`;
    }
    if (action.type === "exit") {
      if (action.exitType === "full") return `Sells 100% of ${action.pair} holdings for all clients via Smart Routing. Closes all open positions for this pair.`;
      if (action.exitType === "capital") return `Sells only the original BTC risked on ${action.pair}, leaving any profits in the position. Fires across all clients.`;
      if (action.exitType === "emergency") return `MARKET ORDER — sells immediately at whatever price is available. No price guarantee. Use only in emergencies.`;
    }
    if (action.type === "trailing_stop") return `Places a ${(action.stopPercent * 100).toFixed(0)}% trailing stop on ${action.pair} for all clients holding this position.`;
    if (action.type === "liquidation") return `Sells ALL assets (BTC and all altcoins) to USD for ${action.clientName}. This is a full account liquidation for client offboarding.`;
    return "";
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className={isEmergency || isLiquidation ? "text-destructive" : ""}>
            {getTitle()}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed pt-1">
            {getDescription()}
          </DialogDescription>
        </DialogHeader>

        {(isEmergency || isLiquidation) && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {isEmergency
                ? "This is a market order. You may receive a significantly worse price than the current market rate due to slippage."
                : "This will liquidate the entire account. This action cannot be undone."}
            </AlertDescription>
          </Alert>
        )}

        {isLiquidation && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              Type <span className="font-mono text-destructive">{expectedConfirmation}</span> to confirm:
            </Label>
            <Input
              value={liquidationText}
              onChange={(e) => setLiquidationText(e.target.value)}
              placeholder={expectedConfirmation ?? ""}
              className="font-mono"
            />
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant={isEmergency || isLiquidation ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={isLoading || !canConfirm}
          >
            {isLoading ? "Executing…" : isEmergency ? "Execute Emergency Exit" : isLiquidation ? "Liquidate Account" : "Confirm Trade"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ManualTrading() {
  const [pendingAction, setPendingAction] = useState<TradeAction | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  // Entry form state
  const [entryPair, setEntryPair] = useState("ETH/BTC");
  const [entrySizePercent, setEntrySizePercent] = useState<"2" | "4" | "6">("2");

  // Exit form state
  const [exitPair, setExitPair] = useState("ETH/BTC");
  const [exitType, setExitType] = useState<"full" | "capital" | "emergency">("full");
  const [capitalExitBtcCost, setCapitalExitBtcCost] = useState("");
  const [capitalExitCurrentPrice, setCapitalExitCurrentPrice] = useState("");

  // Trailing stop state
  const [trailPair, setTrailPair] = useState("ETH/BTC");
  const [trailStopPercent, setTrailStopPercent] = useState("10");

  // Liquidation state
  const [liquidationClientId, setLiquidationClientId] = useState<string>("");

  // Clients
  const { data: clients } = trpc.clients.getAll.useQuery();

  // Mutations
  const manualEntry = trpc.trading.executeManualEntry.useMutation();
  const manualExit = trpc.trading.executeManualExit.useMutation();
  const capitalExit = trpc.trading.executeCapitalExit.useMutation();
  const emergencyExit = trpc.trading.executeEmergencyExit.useMutation();
  const emergencyLiquidation = trpc.trading.executeEmergencyLiquidation.useMutation();
  const setTrailingStop = trpc.trading.setTrailingStop.useMutation();

  const handleConfirm = async () => {
    if (!pendingAction) return;
    setIsExecuting(true);

    try {
      let result: { clientResults?: Array<{ userId?: number; name?: string | null; success: boolean; error?: string }> } | null = null;

      if (pendingAction.type === "entry") {
        result = await manualEntry.mutateAsync({
          pair: pendingAction.pair,
          positionSizePercent: String(pendingAction.sizePercent) as "2" | "4" | "6",
        });
      } else if (pendingAction.type === "exit") {
        if (pendingAction.exitType === "full") {
          result = await manualExit.mutateAsync({ pair: pendingAction.pair });
        } else if (pendingAction.exitType === "capital") {
          result = await capitalExit.mutateAsync({
            pair: pendingAction.pair,
            entryBtcCost: parseFloat(capitalExitBtcCost),
            currentPrice: parseFloat(capitalExitCurrentPrice),
          });
        } else if (pendingAction.exitType === "emergency") {
          result = await emergencyExit.mutateAsync({ pair: pendingAction.pair });
        }
      } else if (pendingAction.type === "trailing_stop") {
        result = await setTrailingStop.mutateAsync({
          pair: pendingAction.pair,
          stopPercent: pendingAction.stopPercent,
        });
      } else if (pendingAction.type === "liquidation") {
        const liqResult = await emergencyLiquidation.mutateAsync({
          userId: (pendingAction as { type: "liquidation"; userId: number; clientName: string }).userId,
          confirmationString: `LIQUIDATE ${(pendingAction as { type: "liquidation"; userId: number; clientName: string }).clientName.toUpperCase()}`,
        });
        if (liqResult.success) {
          toast.success(`Liquidation complete — ${liqResult.orders} orders placed for ${pendingAction.clientName}`);
        } else {
          toast.error(`Liquidation failed: ${liqResult.errors.join("; ")}`);
        }
        setPendingAction(null);
        setIsExecuting(false);
        return;
      }

      if (result?.clientResults) {
        const succeeded = result.clientResults.filter((r) => r.success).length;
        const failed = result.clientResults.filter((r) => !r.success).length;
        const msg = `${succeeded} client${succeeded !== 1 ? "s" : ""} succeeded${failed > 0 ? `, ${failed} failed` : ""}`;
        if (failed > 0 && succeeded === 0) {
          toast.error(`Execution failed: ${msg}`);
        } else if (failed > 0) {
          toast.warning(`Partial execution: ${msg}`);
        } else {
          toast.success(`Trade executed: ${msg}`);
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setPendingAction(null);
      setIsExecuting(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Manual Trading</h1>
        <p className="text-sm text-muted-foreground mt-1">
          All trades execute across <strong>all active clients simultaneously</strong> via Smart Routing unless otherwise noted.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* ── Rotation Entry ─────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-green-500" />
              Rotation Entry
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Pair (ALT/BTC)</Label>
              <Select value={entryPair} onValueChange={setEntryPair}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROTATION_PAIRS.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Position Size (% of each client's BTC balance)</Label>
              <div className="flex gap-2">
                {(["2", "4", "6"] as const).map((pct) => (
                  <Button
                    key={pct}
                    variant={entrySizePercent === pct ? "default" : "outline"}
                    size="sm"
                    className="flex-1"
                    onClick={() => setEntrySizePercent(pct)}
                  >
                    {pct}%
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                2% = initial entry · 4% = DCA add-in · 6% = final DCA (max 12% per alt)
              </p>
            </div>
            <Button
              className="w-full"
              onClick={() =>
                setPendingAction({
                  type: "entry",
                  pair: entryPair,
                  sizePercent: parseInt(entrySizePercent) as 2 | 4 | 6,
                })
              }
            >
              Review &amp; Execute Entry
            </Button>
          </CardContent>
        </Card>

        {/* ── Rotation Exit ──────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingDown className="h-4 w-4 text-red-500" />
              Rotation Exit
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Pair</Label>
              <Select value={exitPair} onValueChange={setExitPair}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROTATION_PAIRS.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Exit Type</Label>
              <div className="flex gap-2 flex-wrap">
                {(["full", "capital", "emergency"] as const).map((t) => (
                  <Button
                    key={t}
                    variant={exitType === t ? (t === "emergency" ? "destructive" : "default") : "outline"}
                    size="sm"
                    onClick={() => setExitType(t)}
                    className="capitalize"
                  >
                    {t === "full" ? "Full Exit" : t === "capital" ? "Capital Exit" : "⚠ Emergency"}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {exitType === "full" && "Sell 100% of position · Smart Routing"}
                {exitType === "capital" && "Sell original BTC risked only · profits stay in trade"}
                {exitType === "emergency" && "Market order · immediate fill · no price guarantee"}
              </p>
            </div>

            {exitType === "capital" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Entry BTC Cost</Label>
                  <Input
                    type="number"
                    step="0.0001"
                    placeholder="0.0000"
                    value={capitalExitBtcCost}
                    onChange={(e) => setCapitalExitBtcCost(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Current Price (BTC)</Label>
                  <Input
                    type="number"
                    step="0.0001"
                    placeholder="0.0000"
                    value={capitalExitCurrentPrice}
                    onChange={(e) => setCapitalExitCurrentPrice(e.target.value)}
                  />
                </div>
              </div>
            )}

            <Button
              className="w-full"
              variant={exitType === "emergency" ? "destructive" : "default"}
              disabled={exitType === "capital" && (!capitalExitBtcCost || !capitalExitCurrentPrice)}
              onClick={() =>
                setPendingAction({ type: "exit", pair: exitPair, exitType })
              }
            >
              {exitType === "emergency" ? "⚠ Execute Emergency Exit" : "Review & Execute Exit"}
            </Button>
          </CardContent>
        </Card>

        {/* ── Trailing Stop ──────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4 text-blue-500" />
              Set Trailing Stop
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Pair</Label>
              <Select value={trailPair} onValueChange={setTrailPair}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROTATION_PAIRS.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Trailing Stop %</Label>
              <div className="flex gap-2">
                {["6", "10", "15"].map((pct) => (
                  <Button
                    key={pct}
                    variant={trailStopPercent === pct ? "default" : "outline"}
                    size="sm"
                    className="flex-1"
                    onClick={() => setTrailStopPercent(pct)}
                  >
                    {pct}%
                  </Button>
                ))}
              </div>
              <Input
                type="number"
                step="0.5"
                min="1"
                max="50"
                placeholder="Custom %"
                value={trailStopPercent}
                onChange={(e) => setTrailStopPercent(e.target.value)}
                className="mt-2"
              />
              <p className="text-xs text-muted-foreground">
                6% = low volatility · 10% = medium · 15% = high volatility
              </p>
            </div>
            <Button
              className="w-full"
              onClick={() =>
                setPendingAction({
                  type: "trailing_stop",
                  pair: trailPair,
                  stopPercent: parseFloat(trailStopPercent) / 100,
                })
              }
              disabled={!trailStopPercent || parseFloat(trailStopPercent) <= 0}
            >
              Set Trailing Stop on All Clients
            </Button>
          </CardContent>
        </Card>

        {/* ── Emergency Liquidation ─────────────────────────────── */}
        <Card className="border-destructive/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <Zap className="h-4 w-4" />
              Emergency Liquidation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Sells ALL assets (BTC + all altcoins) to USD for a single client. For client offboarding only. This cannot be undone.
              </AlertDescription>
            </Alert>
            <div className="space-y-1.5">
              <Label>Client</Label>
              <Select value={liquidationClientId} onValueChange={setLiquidationClientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select client…" />
                </SelectTrigger>
                <SelectContent>
                  {clients?.map((c) => (
                    <SelectItem key={c.userId} value={String(c.userId)}>
                      {c.name ?? `User #${c.userId}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="destructive"
              className="w-full"
              disabled={!liquidationClientId}
              onClick={() => {
                const client = clients?.find((c) => c.userId === parseInt(liquidationClientId));
                if (client) {
                  setPendingAction({
                    type: "liquidation",
                    userId: client.userId,
                    clientName: client.name ?? `User #${client.userId}`,
                  });
                }
              }}
            >
              Initiate Liquidation
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ── Rules reminder ──────────────────────────────────────── */}
      <Card className="bg-muted/30">
        <CardContent className="pt-4 pb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs text-muted-foreground">
            <div>
              <p className="font-medium text-foreground mb-1">Entry Limits</p>
              <p>Max 6% per trade</p>
              <p>Max 12% per altcoin</p>
              <p>Max 3 concurrent rotations</p>
            </div>
            <div>
              <p className="font-medium text-foreground mb-1">Exit Types</p>
              <p>Full: 100% Smart Routing</p>
              <p>Capital: original BTC only</p>
              <p>Emergency: Market order</p>
            </div>
            <div>
              <p className="font-medium text-foreground mb-1">Trailing Stop Tiers</p>
              <p>Low volatility: 6%</p>
              <p>Medium: 10%</p>
              <p>High volatility: 15%</p>
            </div>
            <div>
              <p className="font-medium text-foreground mb-1">Execution</p>
              <p>Smart Routing (default)</p>
              <p>All clients simultaneously</p>
              <p>Every trade logged</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!pendingAction}
        onClose={() => setPendingAction(null)}
        onConfirm={handleConfirm}
        action={pendingAction}
        isLoading={isExecuting}
      />
    </div>
  );
}
