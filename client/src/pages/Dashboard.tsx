import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, TrendingUp, TrendingDown, Minus, Activity, Brain, FileText, Users, RotateCcw, Zap, AlertCircle } from "lucide-react";
import { useLocation } from "wouter";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function predictionColor(prediction: string): string {
  if (prediction === "STRONG_BUY" || prediction === "AGGRESSIVE") return "text-emerald-400";
  if (prediction === "BUY") return "text-green-400";
  if (prediction === "HOLD" || prediction === "HOLD_BTC" || prediction === "NORMAL") return "text-zinc-300";
  if (prediction === "SELL" || prediction === "REDUCE") return "text-orange-400";
  if (prediction === "STRONG_SELL") return "text-red-400";
  if (prediction.startsWith("ROTATE_")) return "text-blue-400";
  return "text-zinc-300";
}

function predictionBg(prediction: string): string {
  if (prediction === "STRONG_BUY" || prediction === "AGGRESSIVE") return "border-emerald-500/30 bg-emerald-500/5";
  if (prediction === "BUY") return "border-green-500/30 bg-green-500/5";
  if (prediction === "HOLD" || prediction === "HOLD_BTC" || prediction === "NORMAL") return "border-zinc-700 bg-zinc-800/40";
  if (prediction === "SELL" || prediction === "REDUCE") return "border-orange-500/30 bg-orange-500/5";
  if (prediction === "STRONG_SELL") return "border-red-500/30 bg-red-500/5";
  if (prediction.startsWith("ROTATE_")) return "border-blue-500/30 bg-blue-500/5";
  return "border-zinc-700 bg-zinc-800/40";
}

function predictionIcon(prediction: string) {
  if (prediction.includes("BUY") || prediction === "AGGRESSIVE" || prediction.startsWith("ROTATE_"))
    return <TrendingUp className="w-4 h-4" />;
  if (prediction.includes("SELL") || prediction === "REDUCE")
    return <TrendingDown className="w-4 h-4" />;
  return <Minus className="w-4 h-4" />;
}

function formatPrediction(prediction: string): string {
  return prediction.replace(/_/g, " ");
}

function pnlColor(pnl: number) {
  if (pnl > 0) return "text-emerald-400";
  if (pnl < 0) return "text-red-400";
  return "text-zinc-400";
}

function statusBadge(status: string) {
  switch (status) {
    case "executed":
      return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">Executed</Badge>;
    case "failed":
      return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">Failed</Badge>;
    case "pending":
      return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">Pending</Badge>;
    default:
      return <Badge className="bg-zinc-700 text-zinc-400 text-xs">{status}</Badge>;
  }
}

function timeAgo(date: Date | string): string {
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { data: predictions, isLoading: predsLoading, refetch: refetchPreds } = trpc.mlPredictions.getLatest.useQuery();
  const { data: positions, isLoading: posLoading, refetch: refetchPos } = trpc.positions.getAll.useQuery();
  const { data: log, isLoading: logLoading, refetch: refetchLog } = trpc.log.getAll.useQuery({ limit: 5 });
  const { data: clients } = trpc.clients.getAll.useQuery();

  function refetchAll() {
    refetchPreds();
    refetchPos();
    refetchLog();
  }

  const openPositionCount = positions?.length ?? 0;
  const executedCount = log?.filter(l => l.status === "executed").length ?? 0;
  const activeClientCount = clients?.filter(c => c.isActive && c.hasApiKey).length ?? 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Dashboard</h1>
          <p className="text-zinc-400 text-sm mt-1">BTC Treasury Codex — Operator Overview</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refetchAll}
          className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-zinc-400 text-xs mb-1">
              <Activity className="w-3.5 h-3.5" />
              Open Positions
            </div>
            <p className="text-2xl font-bold text-zinc-100">{posLoading ? "—" : openPositionCount}</p>
            <p className="text-xs text-zinc-500 mt-0.5">Max 3 concurrent rotations</p>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-zinc-400 text-xs mb-1">
              <Users className="w-3.5 h-3.5" />
              Active Clients
            </div>
            <p className="text-2xl font-bold text-zinc-100">{activeClientCount}</p>
            <p className="text-xs text-zinc-500 mt-0.5">With SFOX API key configured</p>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-zinc-400 text-xs mb-1">
              <FileText className="w-3.5 h-3.5" />
              Recent Executions
            </div>
            <p className="text-2xl font-bold text-zinc-100">{logLoading ? "—" : executedCount}</p>
            <p className="text-xs text-zinc-500 mt-0.5">Last 5 log entries</p>
          </CardContent>
        </Card>
      </div>

      {/* ML Predictions summary */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader className="pb-3 pt-4 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <Brain className="w-4 h-4 text-orange-500" />
              Current ML Predictions
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/ml")}
              className="text-xs text-zinc-400 hover:text-zinc-200 h-7 px-2"
            >
              View full analysis →
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {predsLoading && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map(i => <div key={i} className="h-16 bg-zinc-800 rounded-lg animate-pulse" />)}
            </div>
          )}
          {!predsLoading && (!predictions || predictions.length === 0) && (
            <div className="flex items-center gap-2 text-zinc-400 text-sm py-2">
              <AlertCircle className="w-4 h-4 text-orange-400 shrink-0" />
              No ML predictions available. Check VPS training log.
            </div>
          )}
          {!predsLoading && predictions && predictions.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {predictions.map(pred => (
                <div
                  key={pred.modelName}
                  className={`rounded-lg border p-3 ${predictionBg(pred.prediction)}`}
                >
                  <div className="flex items-center gap-1 text-xs text-zinc-500 mb-1.5">
                    {MODEL_ICONS[pred.modelName]}
                    {MODEL_LABELS[pred.modelName] ?? pred.modelName}
                  </div>
                  <div className={`flex items-center gap-1 font-bold text-sm ${predictionColor(pred.prediction)}`}>
                    {predictionIcon(pred.prediction)}
                    <span className="truncate">{formatPrediction(pred.prediction)}</span>
                  </div>
                  <div className="mt-1.5 h-1 bg-zinc-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-orange-500/70 rounded-full"
                      style={{ width: `${Math.round(pred.confidence * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">{Math.round(pred.confidence * 100)}%</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Open Positions */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader className="pb-3 pt-4 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <Activity className="w-4 h-4 text-orange-500" />
              Open Positions
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/positions")}
              className="text-xs text-zinc-400 hover:text-zinc-200 h-7 px-2"
            >
              Manage →
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {posLoading && <div className="h-12 bg-zinc-800 rounded-lg animate-pulse" />}
          {!posLoading && openPositionCount === 0 && (
            <p className="text-zinc-500 text-sm py-2">No open positions.</p>
          )}
          {!posLoading && positions && positions.length > 0 && (
            <div className="space-y-2">
              {positions.map(pos => {
                const pnl = parseFloat(pos.unrealizedPnlPercent ?? "0");
                return (
                  <div key={pos.id} className="flex items-center justify-between bg-zinc-800/60 rounded-lg px-3 py-2 text-sm">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-zinc-200 text-xs">{pos.pair}</span>
                      <span className="text-zinc-500 text-xs">Entry: ${parseFloat(pos.entryPrice).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`font-medium text-xs ${pnlColor(pnl)}`}>
                        {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
                      </span>
                      {pos.trailingStopTriggered && (
                        <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs">Stop Triggered</Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Execution Log */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader className="pb-3 pt-4 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <FileText className="w-4 h-4 text-orange-500" />
              Recent Executions
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/log")}
              className="text-xs text-zinc-400 hover:text-zinc-200 h-7 px-2"
            >
              Full log →
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {logLoading && <div className="h-12 bg-zinc-800 rounded-lg animate-pulse" />}
          {!logLoading && (!log || log.length === 0) && (
            <p className="text-zinc-500 text-sm py-2">No executions yet.</p>
          )}
          {!logLoading && log && log.length > 0 && (
            <div className="space-y-2">
              {log.slice(0, 5).map(entry => (
                <div key={entry.id} className="flex items-center justify-between bg-zinc-800/60 rounded-lg px-3 py-2 text-sm">
                  <div className="flex items-center gap-3">
                    {statusBadge(entry.status)}
                    <span className="text-zinc-300 text-xs">{entry.tradeType.replace(/_/g, " ")}</span>
                    <span className="text-zinc-500 text-xs font-mono">{entry.pair}</span>
                  </div>
                  <span className="text-zinc-500 text-xs">{timeAgo(entry.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
