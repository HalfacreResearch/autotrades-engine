import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { RefreshCw, ShieldCheck, AlertTriangle, CheckCircle2, Clock, TrendingUp, TrendingDown, Minus } from "lucide-react";

const POSITION_SIZES: Record<string, number[]> = {
  DCA: [5, 10, 15, 20, 25],
  ROTATION_ENTRY: [2, 4, 6, 8, 10, 12],
  ROTATION_EXIT: [100],
};

const SUPPORTED_PAIRS = ["ETH/BTC", "SOL/BTC", "BNB/BTC", "XRP/BTC"];

function signalColor(signal: string) {
  if (signal.includes("STRONG_BUY")) return "text-emerald-400";
  if (signal.includes("BUY")) return "text-green-400";
  if (signal.includes("STRONG_SELL")) return "text-red-400";
  if (signal.includes("SELL")) return "text-orange-400";
  return "text-zinc-400";
}

function signalIcon(signal: string) {
  if (signal.includes("BUY")) return <TrendingUp className="w-4 h-4" />;
  if (signal.includes("SELL")) return <TrendingDown className="w-4 h-4" />;
  return <Minus className="w-4 h-4" />;
}

function confidenceBadge(confidence: number) {
  if (confidence >= 75) return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">{confidence}%</Badge>;
  if (confidence >= 55) return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">{confidence}%</Badge>;
  return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">{confidence}%</Badge>;
}

function riskBadge(risk: string) {
  if (risk === "LOW") return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">LOW RISK</Badge>;
  if (risk === "MEDIUM") return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">MED RISK</Badge>;
  return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">HIGH RISK</Badge>;
}

function timeLeft(expiresAt: Date | string) {
  const exp = new Date(expiresAt);
  const now = new Date();
  const diff = exp.getTime() - now.getTime();
  if (diff <= 0) return "Expired";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

interface TradeDialogProps {
  signal: {
    recommendationId: string;
    type: string;
    pair: string;
    signal: string;
    confidence: number;
    positionSize: string;
    priceAtGeneration: string | null;
  } | null;
  onClose: () => void;
}

function TradeDialog({ signal, onClose }: TradeDialogProps) {
  const { data: clients } = trpc.clients.getAll.useQuery();
  const [clientId, setClientId] = useState<string>("");
  const [positionSize, setPositionSize] = useState<string>("");
  const [isTestAccount, setIsTestAccount] = useState(true);
  const [safetyResult, setSafetyResult] = useState<{
    passed: boolean; warnings: string[]; errors: string[];
    btcBalance?: number; usdBalance?: number; openPositionCount?: number;
  } | null>(null);
  const [step, setStep] = useState<"configure" | "safety" | "confirm">("configure");

  const safetyMutation = trpc.safety.runChecks.useMutation();
  const dcaMutation = trpc.trades.executeDCA.useMutation();
  const rotEntryMutation = trpc.trades.executeRotationEntry.useMutation();

  if (!signal) return null;

  const tradeType = signal.type === "DCA" ? "DCA_BUY" : "ROTATION_ENTRY";
  const sizes = POSITION_SIZES[tradeType] ?? [5];

  async function runSafety() {
    if (!clientId || !positionSize) {
      toast.error("Select a client and position size first");
      return;
    }
    const result = await safetyMutation.mutateAsync({
      clientId: parseInt(clientId),
      tradeType,
      pair: signal!.pair,
      positionSizePercent: parseFloat(positionSize),
      currentMarketPrice: signal!.priceAtGeneration ? parseFloat(signal!.priceAtGeneration) : undefined,
    });
    setSafetyResult(result);
    setStep("safety");
  }

  async function executeTrade() {
    const cid = parseInt(clientId);
    const size = parseFloat(positionSize);
    try {
      if (tradeType === "DCA_BUY") {
        await dcaMutation.mutateAsync({
          clientId: cid,
          positionSizePercent: size,
          isTestAccount,
          recommendationId: signal!.recommendationId,
          currentMarketPrice: signal!.priceAtGeneration ? parseFloat(signal!.priceAtGeneration) : undefined,
        });
      } else {
        await rotEntryMutation.mutateAsync({
          clientId: cid,
          pair: signal!.pair,
          positionSizePercent: size,
          isTestAccount,
          recommendationId: signal!.recommendationId,
          currentMarketPrice: signal!.priceAtGeneration ? parseFloat(signal!.priceAtGeneration) : undefined,
        });
      }
      toast.success(`Trade executed successfully${isTestAccount ? " (TEST)" : " (LIVE)"}`);
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Execution failed");
    }
  }

  const isExecuting = dcaMutation.isPending || rotEntryMutation.isPending;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-zinc-100 max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">
            Execute {tradeType === "DCA_BUY" ? "DCA Buy" : "Rotation Entry"} — {signal.pair}
          </DialogTitle>
        </DialogHeader>

        {step === "configure" && (
          <div className="space-y-4 py-2">
            <div className="bg-zinc-800 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-zinc-400">Signal</span>
                <span className={signalColor(signal.signal)}>{signal.signal}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Confidence</span>
                <span>{signal.confidence}%</span>
              </div>
              {signal.priceAtGeneration && (
                <div className="flex justify-between">
                  <span className="text-zinc-400">Reference Price</span>
                  <span>${parseFloat(signal.priceAtGeneration).toLocaleString()}</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-zinc-300">Client</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-100">
                  <SelectValue placeholder="Select client..." />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  {clients?.filter((c) => c.hasApiKey && c.isActive).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)} className="text-zinc-100">
                      {c.clientName}
                      <span className={`ml-2 text-xs ${c.connectionStatus === "connected" ? "text-emerald-400" : "text-red-400"}`}>
                        ({c.connectionStatus})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-zinc-300">Position Size</Label>
              <Select value={positionSize} onValueChange={setPositionSize}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-100">
                  <SelectValue placeholder="Select size..." />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  {sizes.map((s) => (
                    <SelectItem key={s} value={String(s)} className="text-zinc-100">
                      {s}%
                      {tradeType === "ROTATION_ENTRY" && s === 2 && " (Minimum)"}
                      {tradeType === "ROTATION_ENTRY" && s === 6 && " (Recommended — High Confidence)"}
                      {tradeType === "ROTATION_ENTRY" && s === 12 && " (Maximum)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                <Switch
                  checked={!isTestAccount}
                  onCheckedChange={(v) => setIsTestAccount(!v)}
                  className="data-[state=checked]:bg-orange-500"
                />
                <span className={`text-xs font-medium ${!isTestAccount ? "text-orange-400" : "text-zinc-400"}`}>Live</span>
              </div>
            </div>

            {!isTestAccount && (
              <div className="flex items-center gap-2 bg-orange-500/10 border border-orange-500/30 rounded-lg p-3 text-orange-400 text-sm">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Live mode will execute with real client funds. Ensure you have reviewed the signal.
              </div>
            )}
          </div>
        )}

        {step === "safety" && safetyResult && (
          <div className="space-y-3 py-2">
            <div className={`flex items-center gap-2 rounded-lg p-3 ${safetyResult.passed ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400" : "bg-red-500/10 border border-red-500/30 text-red-400"}`}>
              {safetyResult.passed ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
              <span className="font-medium">{safetyResult.passed ? "All safety checks passed" : "Safety checks failed"}</span>
            </div>

            {safetyResult.btcBalance !== undefined && (
              <div className="bg-zinc-800 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-zinc-400">BTC Available</span>
                  <span>{safetyResult.btcBalance?.toFixed(8)} BTC</span>
                </div>
                {safetyResult.usdBalance !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-zinc-400">USD Available</span>
                    <span>${safetyResult.usdBalance?.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-zinc-400">Open Positions</span>
                  <span>{safetyResult.openPositionCount} / 3</span>
                </div>
              </div>
            )}

            {safetyResult.errors.length > 0 && (
              <div className="space-y-1">
                {safetyResult.errors.map((e, i) => (
                  <div key={i} className="flex items-start gap-2 text-red-400 text-sm bg-red-500/10 rounded p-2">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    {e}
                  </div>
                ))}
              </div>
            )}

            {safetyResult.warnings.length > 0 && (
              <div className="space-y-1">
                {safetyResult.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-yellow-400 text-sm bg-yellow-500/10 rounded p-2">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    {w}
                  </div>
                ))}
              </div>
            )}

            {safetyResult.passed && (
              <div className="flex items-center gap-2 text-zinc-400 text-sm">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Ready to execute. Click Confirm to proceed.
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
            Cancel
          </Button>
          {step === "configure" && (
            <Button
              onClick={runSafety}
              disabled={!clientId || !positionSize || safetyMutation.isPending}
              className="bg-zinc-700 hover:bg-zinc-600"
            >
              {safetyMutation.isPending ? "Checking..." : "Run Safety Checks"}
            </Button>
          )}
          {step === "safety" && safetyResult?.passed && (
            <Button
              onClick={executeTrade}
              disabled={isExecuting}
              className={isTestAccount ? "bg-zinc-600 hover:bg-zinc-500" : "bg-orange-500 hover:bg-orange-600"}
            >
              {isExecuting ? "Executing..." : isTestAccount ? "Execute (Test)" : "Execute LIVE"}
            </Button>
          )}
          {step === "safety" && !safetyResult?.passed && (
            <Button variant="outline" onClick={() => setStep("configure")} className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
              Back
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SignalFeed() {
  const { data: signals, isLoading, refetch } = trpc.signals.getFeed.useQuery({ limit: 20 });
  type Signal = NonNullable<typeof signals>[number];
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Signal Feed</h1>
          <p className="text-zinc-400 text-sm mt-1">Live recommendations from the tradinghq signal engine</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-zinc-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : !signals || signals.length === 0 ? (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="py-12 text-center text-zinc-500">
            <Clock className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p>No active signals. The tradinghq engine generates signals periodically.</p>
            <p className="text-xs mt-1">Ensure TRADINGHQ_DATABASE_URL is configured.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {signals.map((s) => (
            <Card key={s.recommendationId} className="bg-zinc-900 border-zinc-800 hover:border-zinc-700 transition-colors">
              <CardContent className="py-4 px-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`flex items-center gap-1.5 font-semibold ${signalColor(s.signal)}`}>
                      {signalIcon(s.signal)}
                      {s.signal}
                    </div>
                    <span className="text-zinc-100 font-medium">{s.pair}</span>
                    <Badge variant="outline" className="border-zinc-700 text-zinc-400 text-xs">
                      {s.type}
                    </Badge>
                    {riskBadge(s.riskLevel)}
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right hidden sm:block">
                      <div className="text-xs text-zinc-500">Confidence</div>
                      <div>{confidenceBadge(s.confidence)}</div>
                    </div>
                    <div className="text-right hidden sm:block">
                      <div className="text-xs text-zinc-500">Score</div>
                      <div className="text-zinc-200 font-medium">{s.score}/100</div>
                    </div>
                    <div className="text-right hidden md:block">
                      <div className="text-xs text-zinc-500">Expires</div>
                      <div className="text-zinc-300 text-sm flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {timeLeft(s.expiresAt)}
                      </div>
                    </div>
                    {(s.type === "DCA" || s.type === "ROTATION_ENTRY") && (
                      <Button
                        size="sm"
                        className="bg-orange-500 hover:bg-orange-600 text-white shrink-0"
                        onClick={() => setSelectedSignal(s as typeof selectedSignal)}
                      >
                        Execute
                      </Button>
                    )}
                  </div>
                </div>

                <p className="text-zinc-400 text-sm mt-2 line-clamp-2">{s.action}</p>

                {s.priceAtGeneration && (
                  <div className="text-xs text-zinc-600 mt-1">
                    Reference price: ${parseFloat(s.priceAtGeneration).toLocaleString()}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedSignal && (
        <TradeDialog signal={selectedSignal} onClose={() => setSelectedSignal(null)} />
      )}
    </div>
  );
}
