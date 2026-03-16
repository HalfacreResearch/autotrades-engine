import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { RefreshCw, TrendingUp, TrendingDown, AlertTriangle, Activity } from "lucide-react";

function pnlColor(pnl: number) {
  if (pnl > 0) return "text-emerald-400";
  if (pnl < 0) return "text-red-400";
  return "text-zinc-400";
}

interface ExitDialogProps {
  position: {
    id: number;
    clientId: number;
    pair: string;
    entryPrice: string;
    unrealizedPnlPercent: string | null;
  };
  onClose: () => void;
  onSuccess: () => void;
}

function ExitDialog({ position, onClose, onSuccess }: ExitDialogProps) {
  const [isTestAccount, setIsTestAccount] = useState(true);
  const exitMutation = trpc.trades.executeRotationExit.useMutation();
  const { data: clients } = trpc.clients.getAll.useQuery();
  const client = clients?.find(c => c.id === position.clientId);
  const pnl = parseFloat(position.unrealizedPnlPercent ?? "0");

  async function handleExit() {
    try {
      const result = await exitMutation.mutateAsync({
        clientId: position.clientId,
        positionId: position.id,
        pair: position.pair,
        entryPrice: parseFloat(position.entryPrice),
        isTestAccount,
        sellPercent: 100,
      });
      if (result.success) {
        toast.success(`Position closed — P&L: ${result.realizedPnlPercent?.toFixed(2)}%`);
        onSuccess();
        onClose();
      } else {
        toast.error(result.error ?? "Exit failed");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Exit failed");
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-zinc-100 max-w-md">
        <DialogHeader>
          <DialogTitle>Close Position — {position.pair}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="bg-zinc-800 rounded-lg p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-zinc-400">Client</span>
              <span>{client?.clientName ?? `Client #${position.clientId}`}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Pair</span>
              <span>{position.pair}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Entry Price</span>
              <span>{parseFloat(position.entryPrice).toFixed(8)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Unrealized P&L</span>
              <span className={pnlColor(pnl)}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%</span>
            </div>
          </div>

          <div className="flex items-center justify-between bg-zinc-800 rounded-lg p-3">
            <div>
              <Label className="text-zinc-300">Account Mode</Label>
              <p className="text-xs text-zinc-500 mt-0.5">
                {isTestAccount ? "Test account — no real funds" : "LIVE account — real funds at risk"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">Test</span>
              <Switch checked={!isTestAccount} onCheckedChange={(v) => setIsTestAccount(!v)} className="data-[state=checked]:bg-orange-500" />
              <span className={`text-xs font-medium ${!isTestAccount ? "text-orange-400" : "text-zinc-400"}`}>Live</span>
            </div>
          </div>

          {!isTestAccount && (
            <div className="flex items-center gap-2 bg-orange-500/10 border border-orange-500/30 rounded-lg p-3 text-orange-400 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              This will sell 100% of the {position.pair.split("/")[0]} position using real client funds.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">Cancel</Button>
          <Button
            onClick={handleExit}
            disabled={exitMutation.isPending}
            className={isTestAccount ? "bg-zinc-600 hover:bg-zinc-500" : "bg-red-600 hover:bg-red-700"}
          >
            {exitMutation.isPending ? "Closing..." : isTestAccount ? "Close Position (Test)" : "Close Position LIVE"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ActivePositions() {
  const { data: positions, isLoading, refetch } = trpc.positions.getAll.useQuery();
  const { data: clients } = trpc.clients.getAll.useQuery();
  const [exitPosition, setExitPosition] = useState<NonNullable<typeof positions>[number] | null>(null);

  const openCount = positions?.length ?? 0;
  const profitableCount = positions?.filter(p => parseFloat(String(p.unrealizedPnlPercent ?? "0")) > 0).length ?? 0;
  const trailingStopCount = positions?.filter(p => p.trailingStopTriggered).length ?? 0;

  function getClientName(clientId: number) {
    return clients?.find(c => c.id === clientId)?.clientName ?? `Client #${clientId}`;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Active Positions</h1>
          <p className="text-zinc-400 text-sm mt-1">Open rotation positions across all clients</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
          <RefreshCw className="w-4 h-4 mr-2" />Refresh
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Open Positions", value: `${openCount} / 3 max`, color: openCount >= 3 ? "text-orange-400" : "text-zinc-100" },
          { label: "Profitable", value: profitableCount, color: "text-emerald-400" },
          { label: "Trailing Stop Triggered", value: trailingStopCount, color: trailingStopCount > 0 ? "text-red-400" : "text-zinc-100" },
          { label: "Pairs Active", value: Array.from(new Set(positions?.map(p => p.pair) ?? [])).join(", ") || "—" },
        ].map(s => (
          <Card key={s.label} className="bg-zinc-900 border-zinc-800">
            <CardContent className="py-4 px-5">
              <div className="text-zinc-500 text-xs mb-1">{s.label}</div>
              <div className={`text-xl font-bold truncate ${s.color ?? "text-zinc-100"}`}>{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 bg-zinc-800 rounded-xl animate-pulse" />)}</div>
      ) : !positions || positions.length === 0 ? (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="py-12 text-center text-zinc-500">
            <Activity className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p>No open positions. Execute a rotation entry from the Signal Feed.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {positions.map(pos => {
            const pnl = parseFloat(String(pos.unrealizedPnlPercent ?? "0"));
            const peak = parseFloat(String(pos.peakPnlPercent ?? "0"));
            const trailingStop = parseFloat(String(pos.trailingStopPercent ?? "5"));
            const entryPrice = parseFloat(String(pos.entryPrice));
            const currentPrice = parseFloat(String(pos.currentPrice ?? "0"));

            return (
              <Card key={pos.id} className={`bg-zinc-900 border-zinc-800 hover:border-zinc-700 transition-colors ${pos.trailingStopTriggered ? "border-red-500/50" : ""}`}>
                <CardContent className="py-4 px-5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="font-semibold text-zinc-100 text-lg">{pos.pair}</span>
                        <Badge variant="outline" className="border-zinc-700 text-zinc-400 text-xs">{getClientName(pos.clientId)}</Badge>
                        {pos.trailingStopTriggered && (
                          <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs gap-1">
                            <AlertTriangle className="w-3 h-3" />Trailing Stop Hit
                          </Badge>
                        )}
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-sm">
                        <div>
                          <span className="text-zinc-500">Entry</span>
                          <span className="ml-2 text-zinc-300">{entryPrice.toFixed(8)}</span>
                        </div>
                        {currentPrice > 0 && (
                          <div>
                            <span className="text-zinc-500">Current</span>
                            <span className="ml-2 text-zinc-300">{currentPrice.toFixed(8)}</span>
                          </div>
                        )}
                        <div>
                          <span className="text-zinc-500">P&L</span>
                          <span className={`ml-2 font-medium ${pnlColor(pnl)}`}>
                            {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-500">Peak</span>
                          <span className="ml-2 text-emerald-400">{peak > 0 ? "+" : ""}{peak.toFixed(2)}%</span>
                        </div>
                        <div>
                          <span className="text-zinc-500">Size</span>
                          <span className="ml-2 text-zinc-300">{pos.sizePercent}% of BTC</span>
                        </div>
                        <div>
                          <span className="text-zinc-500">Trail Stop</span>
                          <span className="ml-2 text-zinc-300">{trailingStop}% from peak</span>
                        </div>
                        <div>
                          <span className="text-zinc-500">Opened</span>
                          <span className="ml-2 text-zinc-400">{new Date(pos.openedAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 shrink-0">
                      {pnl > 0 ? <TrendingUp className="w-5 h-5 text-emerald-400 mx-auto" /> : <TrendingDown className="w-5 h-5 text-red-400 mx-auto" />}
                      <Button
                        size="sm"
                        onClick={() => setExitPosition(pos)}
                        className={pos.trailingStopTriggered ? "bg-red-600 hover:bg-red-700 text-white" : "bg-zinc-700 hover:bg-zinc-600 text-zinc-100"}
                      >
                        {pos.trailingStopTriggered ? "Exit Now" : "Close"}
                      </Button>
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
    </div>
  );
}
