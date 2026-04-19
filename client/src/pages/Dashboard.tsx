import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  RefreshCw, TrendingUp, TrendingDown, Minus, Activity, Brain,
  FileText, Users, RotateCcw, Zap, AlertCircle, AlertTriangle,
  CheckCircle2, Clock, Radio, Shield, ShieldAlert,
} from "lucide-react";
import { useLocation } from "wouter";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function predictionColor(p: string): string {
  if (p === "STRONG_BUY" || p === "AGGRESSIVE") return "text-emerald-500";
  if (p === "BUY") return "text-green-500";
  if (p === "HOLD" || p === "HOLD_BTC" || p === "NORMAL") return "text-muted-foreground";
  if (p === "SELL" || p === "REDUCE") return "text-orange-500";
  if (p === "STRONG_SELL") return "text-red-500";
  if (p.startsWith("ROTATE_")) return "text-blue-500";
  return "text-muted-foreground";
}

function predictionBg(p: string): string {
  if (p === "STRONG_BUY" || p === "AGGRESSIVE") return "border-emerald-500/30 bg-emerald-500/5";
  if (p === "BUY") return "border-green-500/30 bg-green-500/5";
  if (p === "HOLD" || p === "HOLD_BTC" || p === "NORMAL") return "border-border bg-muted/30";
  if (p === "SELL" || p === "REDUCE") return "border-orange-500/30 bg-orange-500/5";
  if (p === "STRONG_SELL") return "border-red-500/30 bg-red-500/5";
  if (p.startsWith("ROTATE_")) return "border-blue-500/30 bg-blue-500/5";
  return "border-border bg-muted/30";
}

function predictionIcon(p: string) {
  if (p.includes("BUY") || p === "AGGRESSIVE" || p.startsWith("ROTATE_"))
    return <TrendingUp className="w-4 h-4" />;
  if (p.includes("SELL") || p === "REDUCE")
    return <TrendingDown className="w-4 h-4" />;
  return <Minus className="w-4 h-4" />;
}

function signalColor(action: string): string {
  const a = (action ?? "").toUpperCase();
  if (a === "ROTATE_IN" || a === "BUY") return "text-blue-500";
  if (a === "ROTATE_OUT" || a === "SELL") return "text-orange-500";
  if (a === "HOLD_BTC" || a === "HOLD") return "text-muted-foreground";
  if (a === "STRONG_ROTATE_IN") return "text-emerald-500";
  return "text-muted-foreground";
}

function signalBg(action: string): string {
  const a = (action ?? "").toUpperCase();
  if (a === "ROTATE_IN" || a === "BUY") return "border-blue-500/30 bg-blue-500/5";
  if (a === "ROTATE_OUT" || a === "SELL") return "border-orange-500/30 bg-orange-500/5";
  if (a === "STRONG_ROTATE_IN") return "border-emerald-500/30 bg-emerald-500/5";
  return "border-border bg-muted/30";
}

function riskBadge(risk: string) {
  const r = (risk ?? "").toUpperCase();
  if (r === "HIGH") return <Badge className="bg-red-500/20 text-red-500 border-red-500/30 text-xs">High Risk</Badge>;
  if (r === "MEDIUM") return <Badge className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30 text-xs">Medium Risk</Badge>;
  return <Badge className="bg-green-500/20 text-green-500 border-green-500/30 text-xs">Low Risk</Badge>;
}

function pnlColor(pnl: number) {
  if (pnl > 0) return "text-emerald-500";
  if (pnl < 0) return "text-red-500";
  return "text-muted-foreground";
}

function statusBadge(status: string) {
  if (status === "filled") return <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30 text-xs">Filled</Badge>;
  if (status === "failed") return <Badge className="bg-red-500/20 text-red-500 border-red-500/30 text-xs">Failed</Badge>;
  if (status === "pending") return <Badge className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30 text-xs">Pending</Badge>;
  return <Badge variant="secondary" className="text-xs">{status}</Badge>;
}

function timeAgo(date: Date | string): string {
  const diff = Date.now() - new Date(date).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 24) return `${Math.floor(h / 24)}d ago`;
  if (h > 0) return `${h}h ago`;
  return `${m}m ago`;
}

const MODEL_LABELS: Record<string, string> = {
  btc_direction_7d: "BTC 7d",
  btc_direction_30d: "BTC 30d",
  rotation_signal: "Rotation",
  dca_intensity: "DCA Intensity",
};

const MODEL_ICONS: Record<string, React.ReactNode> = {
  btc_direction_7d: <TrendingUp className="w-3.5 h-3.5" />,
  btc_direction_30d: <TrendingUp className="w-3.5 h-3.5" />,
  rotation_signal: <RotateCcw className="w-3.5 h-3.5" />,
  dca_intensity: <Zap className="w-3.5 h-3.5" />,
};

// BTC orange -- exact match to the Bitcoin logo
const BTC_ORANGE = "#F7931A";

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { data: predictions, isLoading: predsLoading, refetch: refetchPreds } = trpc.mlPredictions.getLatest.useQuery();
  const { data: positions, isLoading: posLoading, refetch: refetchPos } = trpc.positions.getAll.useQuery();
  const { data: log, isLoading: logLoading, refetch: refetchLog } = trpc.log.getAll.useQuery({ limit: 5 });
  const { data: clients, refetch: refetchClients } = trpc.clients.getAll.useQuery();
  const { data: pendingInitial } = trpc.clients.getPendingInitialBuy.useQuery();
  const { data: signals, isLoading: signalsLoading, refetch: refetchSignals } = trpc.signals.getLatest.useQuery({ limit: 20 });

  function refetchAll() {
    refetchPreds();
    refetchPos();
    refetchLog();
    refetchClients();
    refetchSignals();
  }

  const openPositionCount = positions?.length ?? 0;
  const activeClientCount = clients?.filter((c) => c.isActive && c.hasApiKey).length ?? 0;
  const executedCount = log?.filter((l) => l.status === "filled").length ?? 0;

  // Signals: group by pair, show one per pair (most recent)
  const pairOrder = ["ETH/BTC", "SOL/BTC", "XRP/BTC", "LINK/BTC"];
  const signalsByPair: Record<string, typeof signals extends undefined ? never : NonNullable<typeof signals>[number]> = {};
  if (signals) {
    for (const sig of signals) {
      const pair = (sig.pair ?? "").toUpperCase();
      if (!signalsByPair[pair]) signalsByPair[pair] = sig;
    }
  }

  // Clients: separate LIVE from MOCK
  const liveClients = clients?.filter((c) => c.isLive) ?? [];
  const mockClients = clients?.filter((c) => !c.isLive) ?? [];

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">BTC Treasury Codex — Operator Overview</p>
        </div>
        <Button variant="outline" size="sm" onClick={refetchAll}>
          <RefreshCw className="w-4 h-4 mr-2" />Refresh
        </Button>
      </div>

      {/* ── Alerts ─────────────────────────────────────────────────── */}

      {/* Pending initial buy alerts */}
      {pendingInitial && pendingInitial.length > 0 && (
        <div className="space-y-2">
          {pendingInitial.map((client) => (
            <Alert key={client.userId} className="border-blue-500/40 bg-blue-500/5">
              <Clock className="h-4 w-4 text-blue-500" />
              <AlertDescription className="flex items-center justify-between">
                <span className="text-sm">
                  <strong>{client.name ?? `User #${client.userId}`}</strong> — new client pending initial 25% BTC purchase
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-4 shrink-0 border-blue-500/40 text-blue-500 hover:bg-blue-500/10"
                  onClick={() => navigate("/manual")}
                >
                  Execute Initial Buy
                </Button>
              </AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {/* ── Stats row ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Activity className="w-3.5 h-3.5" />Open Positions
            </div>
            <p className={`text-2xl font-bold ${openPositionCount >= 3 ? "text-orange-500" : ""}`}>
              {posLoading ? "—" : openPositionCount}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Max 3 concurrent rotations</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Users className="w-3.5 h-3.5" />Active Clients
            </div>
            <p className="text-2xl font-bold">{activeClientCount}</p>
            <p className="text-xs text-muted-foreground mt-0.5">With SFOX API key configured</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <CheckCircle2 className="w-3.5 h-3.5" />Recent Executions
            </div>
            <p className="text-2xl font-bold">{logLoading ? "—" : executedCount}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Last 5 log entries</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Arbiter Signal Feed ────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Radio className="w-4 h-4" style={{ color: BTC_ORANGE }} />
              Live Arbiter Signals
            </CardTitle>
            <span className="text-xs text-muted-foreground">Updated 3:00 AM UTC daily</span>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {signalsLoading && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 bg-muted rounded-lg animate-pulse" />)}
            </div>
          )}
          {!signalsLoading && Object.keys(signalsByPair).length === 0 && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
              <AlertCircle className="w-4 h-4 shrink-0" style={{ color: BTC_ORANGE }} />
              No active signals. Arbiter runs at 3:00 AM UTC. Check VPS cron log if expected.
            </div>
          )}
          {!signalsLoading && Object.keys(signalsByPair).length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {pairOrder.map((pair) => {
                const sig = signalsByPair[pair];
                if (!sig) {
                  // No signal for this pair -- show HOLD BTC placeholder
                  return (
                    <div key={pair} className="rounded-lg border border-border bg-muted/30 p-3">
                      <div className="text-xs text-muted-foreground font-mono mb-1.5">{pair}</div>
                      <div className="flex items-center gap-1 font-bold text-sm text-muted-foreground">
                        <Minus className="w-4 h-4" />
                        <span>HOLD BTC</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5">No active signal</p>
                    </div>
                  );
                }
                return (
                  <div key={pair} className={`rounded-lg border p-3 ${signalBg(sig.action)}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-muted-foreground font-mono">{pair}</span>
                      {riskBadge(sig.riskLevel)}
                    </div>
                    <div className={`flex items-center gap-1 font-bold text-sm ${signalColor(sig.action)}`}>
                      {(sig.action ?? "").toUpperCase().includes("ROTATE_IN") || (sig.action ?? "").toUpperCase() === "BUY"
                        ? <TrendingUp className="w-4 h-4" />
                        : (sig.action ?? "").toUpperCase().includes("ROTATE_OUT") || (sig.action ?? "").toUpperCase() === "SELL"
                          ? <TrendingDown className="w-4 h-4" />
                          : <Minus className="w-4 h-4" />}
                      <span className="truncate">{(sig.action ?? "HOLD").replace(/_/g, " ")}</span>
                    </div>
                    {sig.positionSize && sig.positionSize !== "0" && (
                      <p className="text-xs text-muted-foreground mt-1">Size: {sig.positionSize}</p>
                    )}
                    <div className="mt-1.5 h-1 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.round((sig.confidence ?? 0) * 100)}%`,
                          backgroundColor: BTC_ORANGE,
                          opacity: 0.7,
                        }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {Math.round((sig.confidence ?? 0) * 100)}% confidence &middot; {timeAgo(sig.createdAt)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Client Accounts ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Users className="w-4 h-4" style={{ color: BTC_ORANGE }} />
            Client Accounts
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          {/* LIVE accounts */}
          {liveClients.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Live Accounts</p>
              <div className="space-y-2">
                {liveClients.map((c) => (
                  <div
                    key={c.userId}
                    className="flex items-center justify-between rounded-lg border px-3 py-2.5"
                    style={{ borderColor: `${BTC_ORANGE}40`, backgroundColor: `${BTC_ORANGE}08` }}
                  >
                    <div className="flex items-center gap-3">
                      <ShieldAlert className="w-4 h-4 shrink-0" style={{ color: BTC_ORANGE }} />
                      <div>
                        <p className="text-sm font-medium">{c.name ?? `User #${c.userId}`}</p>
                        <p className="text-xs text-muted-foreground">{c.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        className="text-xs font-semibold"
                        style={{ backgroundColor: `${BTC_ORANGE}25`, color: BTC_ORANGE, borderColor: `${BTC_ORANGE}50` }}
                      >
                        LIVE
                      </Badge>
                      {c.hasApiKey
                        ? <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30 text-xs">API Connected</Badge>
                        : <Badge className="bg-red-500/20 text-red-500 border-red-500/30 text-xs">No API Key</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* MOCK accounts */}
          {mockClients.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Mock Accounts</p>
              <div className="space-y-2">
                {mockClients.map((c) => (
                  <div key={c.userId} className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <Shield className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{c.name ?? `User #${c.userId}`}</p>
                        <p className="text-xs text-muted-foreground">{c.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">MOCK</Badge>
                      {c.hasApiKey
                        ? <Badge className="bg-muted text-muted-foreground border-border text-xs">API Set</Badge>
                        : <Badge className="bg-red-500/20 text-red-500 border-red-500/30 text-xs">No API Key</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(!clients || clients.length === 0) && (
            <p className="text-muted-foreground text-sm py-2">No clients configured.</p>
          )}
        </CardContent>
      </Card>

      {/* ── ML Predictions summary ─────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Brain className="w-4 h-4" style={{ color: BTC_ORANGE }} />
              Current ML Predictions
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/ml")} className="text-xs text-muted-foreground h-7 px-2">
              Full analysis →
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {predsLoading && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />)}
            </div>
          )}
          {!predsLoading && (!predictions || predictions.length === 0) && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
              <AlertCircle className="w-4 h-4 shrink-0" style={{ color: BTC_ORANGE }} />
              No ML predictions available. Check VPS training log.
            </div>
          )}
          {!predsLoading && predictions && predictions.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {predictions.map((pred) => (
                <div key={pred.modelName} className={`rounded-lg border p-3 ${predictionBg(pred.prediction)}`}>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1.5">
                    {MODEL_ICONS[pred.modelName]}
                    {MODEL_LABELS[pred.modelName] ?? pred.modelName}
                  </div>
                  <div className={`flex items-center gap-1 font-bold text-sm ${predictionColor(pred.prediction)}`}>
                    {predictionIcon(pred.prediction)}
                    <span className="truncate">{pred.prediction.replace(/_/g, " ")}</span>
                  </div>
                  <div className="mt-1.5 h-1 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.round(pred.confidence * 100)}%`, backgroundColor: BTC_ORANGE, opacity: 0.7 }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{Math.round(pred.confidence * 100)}% confidence</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Open Positions ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4" style={{ color: BTC_ORANGE }} />
              Open Positions
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/positions")} className="text-xs text-muted-foreground h-7 px-2">
              Manage →
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {posLoading && <div className="h-12 bg-muted rounded-lg animate-pulse" />}
          {!posLoading && openPositionCount === 0 && (
            <p className="text-muted-foreground text-sm py-2">No open positions.</p>
          )}
          {!posLoading && positions && positions.length > 0 && (
            <div className="space-y-2">
              {positions.map((pos) => {
                const entryPrice = parseFloat(String(pos.entryPrice));
                const currentPrice = parseFloat(String(pos.currentPrice ?? pos.entryPrice));
                const pnl = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
                const tranche = pos.trancheNumber ?? 1;
                const exitStage = pos.exitStage ?? "none";
                const phase2Target = entryPrice * 1.036;
                const phase3Target = entryPrice * 1.066;
                const hardStopPrice = entryPrice * 1.026;

                function exitStageBadge(stage: string) {
                  if (stage === "trailing_stop_placed")
                    return <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30 text-xs">Trailing Stop Active</Badge>;
                  if (stage === "hard_stop_placed")
                    return <Badge className="bg-blue-500/20 text-blue-500 border-blue-500/30 text-xs">Hard Stop Placed</Badge>;
                  return <Badge variant="secondary" className="text-xs">Monitoring</Badge>;
                }

                return (
                  <div key={pos.id} className="rounded-lg border px-3 py-2.5 text-sm space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium">{pos.pair}</span>
                        <Badge
                          className="text-xs font-bold"
                          style={{ backgroundColor: `${BTC_ORANGE}20`, color: BTC_ORANGE, borderColor: `${BTC_ORANGE}40` }}
                        >
                          T{tranche}
                        </Badge>
                        <span className="text-muted-foreground text-xs">{parseFloat(String(pos.entryBtcAmount)).toFixed(4)} BTC</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {exitStageBadge(exitStage)}
                        <span className={`font-medium text-xs ${pnlColor(pnl)}`}>
                          {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>Entry: <span className="font-mono">{entryPrice.toFixed(6)}</span></span>
                      <span className={pnl >= 3.6 ? "text-blue-500" : ""}>
                        +3.6% target: <span className="font-mono">{phase2Target.toFixed(6)}</span>
                      </span>
                      <span className={pnl >= 6.6 ? "text-emerald-500" : ""}>
                        +6.6% target: <span className="font-mono">{phase3Target.toFixed(6)}</span>
                      </span>
                      {exitStage === "hard_stop_placed" && (
                        <span className="text-blue-400">Hard stop: <span className="font-mono">{hardStopPrice.toFixed(6)}</span></span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Recent Execution Log ───────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <FileText className="w-4 h-4" style={{ color: BTC_ORANGE }} />
              Recent Executions
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/log")} className="text-xs text-muted-foreground h-7 px-2">
              Full log →
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {logLoading && <div className="h-12 bg-muted rounded-lg animate-pulse" />}
          {!logLoading && (!log || log.length === 0) && (
            <p className="text-muted-foreground text-sm py-2">No executions yet.</p>
          )}
          {!logLoading && log && log.length > 0 && (
            <div className="space-y-2">
              {log.slice(0, 5).map((entry) => (
                <div key={entry.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                  <div className="flex items-center gap-3">
                    {statusBadge(entry.status)}
                    <span className="text-sm">{entry.strategy}</span>
                    <span className="text-muted-foreground text-xs font-mono">{entry.pair}</span>
                  </div>
                  <span className="text-muted-foreground text-xs">{timeAgo(entry.executedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
