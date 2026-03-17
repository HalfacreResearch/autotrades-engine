import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { RefreshCw, TrendingUp, TrendingDown, AlertTriangle, Activity, Shield, Zap } from "lucide-react";

function pnlColor(pnl: number) {
  if (pnl > 0) return "text-emerald-500";
  if (pnl < 0) return "text-red-500";
  return "text-muted-foreground";
}

type ExitType = "full" | "capital" | "emergency";

interface Position {
  id: number;
  userId: number;
  pair: string;
  entryPrice: string;
  entryBtcAmount: string;
  currentPrice?: string | null;
  unrealizedBtcPnl?: string | null;
  peakPrice?: string | null;
  trailingStopPct?: string | null;
  trailingStopPrice?: string | null;
  openedAt: string | Date;
}

interface ExitDialogProps {
  position: Position;
  onClose: () => void;
  onSuccess: () => void;
}

function ExitDialog({ position, onClose, onSuccess }: ExitDialogProps) {
  const [exitType, setExitType] = useState<ExitType>("full");
  const [capitalBtcCost, setCapitalBtcCost] = useState("");
  const [capitalCurrentPrice, setCapitalCurrentPrice] = useState("");

  const manualExit = trpc.trading.executeManualExit.useMutation();
  const capitalExit = trpc.trading.executeCapitalExit.useMutation();
  const emergencyExit = trpc.trading.executeEmergencyExit.useMutation();

  const isLoading = manualExit.isPending || capitalExit.isPending || emergencyExit.isPending;
  const pnl = parseFloat(String(position.unrealizedBtcPnl ?? "0"));
  const entryPrice = parseFloat(String(position.entryPrice));

  async function handleExit() {
    try {
      if (exitType === "full") {
        const r = await manualExit.mutateAsync({ pair: position.pair });
        const ok = r.clientResults.filter((c) => c.success).length;
        toast.success(`Full exit executed — ${ok} client${ok !== 1 ? "s" : ""} closed`);
      } else if (exitType === "capital") {
        const r = await capitalExit.mutateAsync({
          pair: position.pair,
          entryBtcCost: parseFloat(capitalBtcCost),
          currentPrice: parseFloat(capitalCurrentPrice),
        });
        const ok = r.clientResults.filter((c) => c.success).length;
        toast.success(`Capital exit executed — ${ok} client${ok !== 1 ? "s" : ""} processed`);
      } else if (exitType === "emergency") {
        const r = await emergencyExit.mutateAsync({ pair: position.pair });
        const ok = r.clientResults.filter((c) => c.success).length;
        toast.success(`Emergency exit fired — ${ok} client${ok !== 1 ? "s" : ""} processed`);
      }
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Exit failed");
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Close Position — {position.pair}</DialogTitle>
          <DialogDescription>
            Fires across all active clients simultaneously.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Position summary */}
          <div className="rounded-lg border p-3 text-sm space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Entry Price</span>
              <span>{entryPrice.toFixed(8)} BTC</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Position Size</span>
              <span>{parseFloat(String(position.entryBtcAmount)).toFixed(4)} BTC risked</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Unrealized P&L</span>
              <span className={pnlColor(pnl)}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%</span>
            </div>
          </div>

          {/* Exit type selector */}
          <div className="space-y-2">
            <Label>Exit Type</Label>
            <div className="flex gap-2">
              {(["full", "capital", "emergency"] as const).map((t) => (
                <Button
                  key={t}
                  size="sm"
                  variant={exitType === t ? (t === "emergency" ? "destructive" : "default") : "outline"}
                  className="flex-1 capitalize text-xs"
                  onClick={() => setExitType(t)}
                >
                  {t === "full" ? "Full" : t === "capital" ? "Capital" : "⚠ Emergency"}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {exitType === "full" && "Sell 100% of position via Smart Routing"}
              {exitType === "capital" && "Sell only the original BTC risked — profits stay in trade"}
              {exitType === "emergency" && "Market order — immediate fill, no price guarantee"}
            </p>
          </div>

          {exitType === "capital" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Entry BTC Cost</Label>
                <Input type="number" step="0.0001" placeholder="0.0000" value={capitalBtcCost} onChange={(e) => setCapitalBtcCost(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Current Price (BTC)</Label>
                <Input type="number" step="0.0001" placeholder="0.0000" value={capitalCurrentPrice} onChange={(e) => setCapitalCurrentPrice(e.target.value)} />
              </div>
            </div>
          )}

          {exitType === "emergency" && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Market order — you may receive a significantly worse price than current market rate.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
          <Button
            variant={exitType === "emergency" ? "destructive" : "default"}
            onClick={handleExit}
            disabled={isLoading || (exitType === "capital" && (!capitalBtcCost || !capitalCurrentPrice))}
          >
            {isLoading ? "Executing…" : exitType === "emergency" ? "Execute Emergency Exit" : "Confirm Exit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface TrailingStopDialogProps {
  pair: string;
  onClose: () => void;
}

function TrailingStopDialog({ pair, onClose }: TrailingStopDialogProps) {
  const [stopPercent, setStopPercent] = useState("10");
  const setTrailingStop = trpc.trading.setTrailingStop.useMutation();

  async function handleSet() {
    try {
      const r = await setTrailingStop.mutateAsync({ pair, stopPercent: parseFloat(stopPercent) / 100 });
      const ok = r.clientResults.filter((c) => c.success).length;
      toast.success(`Trailing stop set — ${ok} client${ok !== 1 ? "s" : ""} updated`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to set trailing stop");
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Set Trailing Stop — {pair}</DialogTitle>
          <DialogDescription>Places a SFOX trailing stop order for all clients holding this position.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            {["6", "10", "15"].map((p) => (
              <Button key={p} size="sm" variant={stopPercent === p ? "default" : "outline"} className="flex-1" onClick={() => setStopPercent(p)}>
                {p}%
              </Button>
            ))}
          </div>
          <Input type="number" step="0.5" min="1" max="50" value={stopPercent} onChange={(e) => setStopPercent(e.target.value)} placeholder="Custom %" />
          <p className="text-xs text-muted-foreground">6% = low vol · 10% = medium · 15% = high vol</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSet} disabled={setTrailingStop.isPending || !stopPercent || parseFloat(stopPercent) <= 0}>
            {setTrailingStop.isPending ? "Setting…" : "Set Trailing Stop"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ActivePositions() {
  const { data: positions, isLoading, refetch } = trpc.positions.getAll.useQuery();
  const [exitPosition, setExitPosition] = useState<Position | null>(null);
  const [trailPair, setTrailPair] = useState<string | null>(null);

  const openCount = positions?.length ?? 0;
  const profitableCount = positions?.filter((p) => parseFloat(String(p.unrealizedBtcPnl ?? "0")) > 0).length ?? 0;
  const trailingStopCount = positions?.filter((p) => p.trailingStopPrice).length ?? 0;
  const activePairs = Array.from(new Set(positions?.map((p) => p.pair) ?? []));

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Active Positions</h1>
          <p className="text-sm text-muted-foreground mt-1">Open rotation positions across all clients</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" />Refresh
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Open Positions", value: `${openCount} / 3 max`, highlight: openCount >= 3 ? "text-orange-500" : undefined },
          { label: "Profitable", value: String(profitableCount), highlight: profitableCount > 0 ? "text-emerald-500" : undefined },
          { label: "Trailing Stop Triggered", value: String(trailingStopCount), highlight: trailingStopCount > 0 ? "text-red-500" : undefined },
          { label: "Active Pairs", value: activePairs.join(", ") || "—" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="py-4 px-5">
              <div className="text-muted-foreground text-xs mb-1">{s.label}</div>
              <div className={`text-xl font-bold truncate ${s.highlight ?? ""}`}>{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : !positions || positions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Activity className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p>No open positions. Execute a rotation entry from Manual Trading.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {positions.map((pos) => {
            const pnl = parseFloat(String(pos.unrealizedBtcPnl ?? "0"));
            const peak = parseFloat(String(pos.peakPrice ?? "0"));
            const trailStop = parseFloat(String(pos.trailingStopPct ?? "0"));
            const entryPrice = parseFloat(String(pos.entryPrice));
            const currentPrice = parseFloat(String(pos.currentPrice ?? "0"));
            const hasTrailingStop = trailStop > 0;

            return (
              <Card
                key={pos.id}
                className={pos.trailingStopPrice ? "border-red-500/50" : ""}
              >
                <CardContent className="py-4 px-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      {/* Header row */}
                      <div className="flex items-center gap-3 mb-3">
                        <span className="font-semibold text-lg">{pos.pair}</span>
                        <Badge variant="outline" className="text-xs">{parseFloat(String(pos.entryBtcAmount)).toFixed(4)} BTC</Badge>
                        {pos.trailingStopPrice && (
                          <Badge variant="destructive" className="text-xs gap-1">
                            <AlertTriangle className="w-3 h-3" />Trailing Stop Hit
                          </Badge>
                        )}
                        {hasTrailingStop && !pos.trailingStopPrice && (
                          <Badge variant="secondary" className="text-xs gap-1">
                            <Shield className="w-3 h-3" />{(trailStop * 100).toFixed(0)}% trail
                          </Badge>
                        )}
                      </div>

                      {/* Data grid */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1.5 text-sm">
                        <div className="flex gap-2">
                          <span className="text-muted-foreground">Entry</span>
                          <span>{entryPrice.toFixed(8)}</span>
                        </div>
                        {currentPrice > 0 && (
                          <div className="flex gap-2">
                            <span className="text-muted-foreground">Current</span>
                            <span>{currentPrice.toFixed(8)}</span>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <span className="text-muted-foreground">P&L</span>
                          <span className={`font-medium ${pnlColor(pnl)}`}>
                            {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <span className="text-muted-foreground">Peak</span>
                          <span className="text-emerald-500">{peak > 0 ? "+" : ""}{peak.toFixed(2)}%</span>
                        </div>
                        <div className="flex gap-2">
                          <span className="text-muted-foreground">Opened</span>
                          <span className="text-muted-foreground">{new Date(pos.openedAt).toLocaleDateString()}</span>
                        </div>
                        {hasTrailingStop && (
                          <div className="flex gap-2">
                            <span className="text-muted-foreground">Trail Stop</span>
                            <span>{(trailStop * 100).toFixed(0)}% from peak</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-col gap-2 shrink-0">
                      {pnl > 0 ? (
                        <TrendingUp className="w-4 h-4 text-emerald-500 mx-auto" />
                      ) : (
                        <TrendingDown className="w-4 h-4 text-red-500 mx-auto" />
                      )}
                      <Button
                        size="sm"
                        variant={pos.trailingStopPrice ? "destructive" : "default"}
                        onClick={() => setExitPosition(pos as unknown as Position)}
                        className="text-xs"
                      >
                        {pos.trailingStopPrice ? "Exit Now" : "Close"}
                      </Button>
                      {!hasTrailingStop && pnl > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setTrailPair(pos.pair)}
                          className="text-xs gap-1"
                        >
                          <Shield className="w-3 h-3" />Trail
                        </Button>
                      )}
                      {pos.trailingStopPrice && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setExitPosition({ ...pos as unknown as Position })}
                          className="text-xs gap-1 border-orange-500/50 text-orange-500"
                        >
                          <Zap className="w-3 h-3" />Emergency
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {exitPosition && (
        <ExitDialog
          position={exitPosition}
          onClose={() => setExitPosition(null)}
          onSuccess={() => refetch()}
        />
      )}

      {trailPair && (
        <TrailingStopDialog
          pair={trailPair}
          onClose={() => setTrailPair(null)}
        />
      )}
    </div>
  );
}
