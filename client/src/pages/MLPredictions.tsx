import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw, Brain, TrendingUp, TrendingDown, Minus, AlertCircle, CheckCircle2, RotateCcw, Zap } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MlPrediction {
  id: number;
  date: string;
  modelName: string;
  prediction: string;
  confidence: number;
  probStrongBuy?: number | null;
  probBuy?: number | null;
  probHold?: number | null;
  probSell?: number | null;
  probStrongSell?: number | null;
  topFeatures?: unknown;
  modelVersion: string;
  createdAt: Date | string;
}

interface RuleBasedSignal {
  id: number;
  predictionType: string;
  pair: string;
  overallSignal: string;
  overallScore: number;
  confidence: number;
  activeFeatureCount: number;
  createdAt: Date | string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MODEL_META: Record<string, { label: string; description: string; icon: React.ReactNode }> = {
  btc_direction_7d: {
    label: "BTC Direction — 7 Day",
    description: "Short-term DCA timing signal",
    icon: <TrendingUp className="w-4 h-4" />,
  },
  btc_direction_30d: {
    label: "BTC Direction — 30 Day",
    description: "Medium-term DCA timing signal",
    icon: <TrendingUp className="w-4 h-4" />,
  },
  rotation_signal: {
    label: "Rotation Signal",
    description: "Which altcoin to rotate into (if any)",
    icon: <RotateCcw className="w-4 h-4" />,
  },
  dca_intensity: {
    label: "DCA Intensity",
    description: "How aggressively to DCA",
    icon: <Zap className="w-4 h-4" />,
  },
};

function predictionColor(prediction: string): string {
  if (prediction === "STRONG_BUY") return "text-emerald-400";
  if (prediction === "BUY") return "text-green-400";
  if (prediction === "HOLD" || prediction === "HOLD_BTC" || prediction === "NORMAL") return "text-zinc-300";
  if (prediction === "SELL") return "text-orange-400";
  if (prediction === "STRONG_SELL") return "text-red-400";
  if (prediction === "AGGRESSIVE") return "text-emerald-400";
  if (prediction === "REDUCE") return "text-orange-400";
  if (prediction.startsWith("ROTATE_")) return "text-blue-400";
  return "text-zinc-300";
}

function predictionBg(prediction: string): string {
  if (prediction === "STRONG_BUY") return "bg-emerald-500/15 border-emerald-500/30";
  if (prediction === "BUY") return "bg-green-500/15 border-green-500/30";
  if (prediction === "HOLD" || prediction === "HOLD_BTC" || prediction === "NORMAL") return "bg-zinc-700/40 border-zinc-600/40";
  if (prediction === "SELL") return "bg-orange-500/15 border-orange-500/30";
  if (prediction === "STRONG_SELL") return "bg-red-500/15 border-red-500/30";
  if (prediction === "AGGRESSIVE") return "bg-emerald-500/15 border-emerald-500/30";
  if (prediction === "REDUCE") return "bg-orange-500/15 border-orange-500/30";
  if (prediction.startsWith("ROTATE_")) return "bg-blue-500/15 border-blue-500/30";
  return "bg-zinc-700/40 border-zinc-600/40";
}

function predictionIcon(prediction: string) {
  if (prediction.includes("BUY") || prediction === "AGGRESSIVE" || prediction.startsWith("ROTATE_"))
    return <TrendingUp className="w-5 h-5" />;
  if (prediction.includes("SELL") || prediction === "REDUCE")
    return <TrendingDown className="w-5 h-5" />;
  return <Minus className="w-5 h-5" />;
}

function confidenceBar(confidence: number) {
  const pct = Math.round(confidence * 100);
  let barColor = "bg-yellow-500";
  if (pct >= 75) barColor = "bg-emerald-500";
  if (pct < 55) barColor = "bg-red-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-zinc-400">Confidence</span>
        <span className="text-zinc-200 font-medium">{pct}%</span>
      </div>
      <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function formatPredictionLabel(prediction: string): string {
  return prediction.replace(/_/g, " ");
}

function formatPair(pair: string): string {
  if (pair === "BTCUSD") return "BTC/USD";
  if (pair.length === 6) return `${pair.slice(0, 3)}/${pair.slice(3)}`;
  return pair;
}

function ruleSignalBadge(signal: string) {
  if (signal === "BUY" || signal === "EXECUTE NOW")
    return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">{signal}</Badge>;
  if (signal === "SELL")
    return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">{signal}</Badge>;
  return <Badge className="bg-zinc-700 text-zinc-400 text-xs">{signal}</Badge>;
}

function timeAgo(date: Date | string): string {
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m ago`;
  return `${m}m ago`;
}

// ─── SHAP Feature List ────────────────────────────────────────────────────────

function TopFeatures({ topFeatures }: { topFeatures: unknown }) {
  if (!topFeatures) return null;
  let features: Array<{ feature: string; value: number }> = [];
  try {
    if (typeof topFeatures === "string") {
      features = JSON.parse(topFeatures);
    } else if (Array.isArray(topFeatures)) {
      features = topFeatures as Array<{ feature: string; value: number }>;
    }
  } catch {
    return null;
  }
  if (!features.length) return null;

  return (
    <div className="mt-3 pt-3 border-t border-zinc-700/60">
      <p className="text-xs text-zinc-500 mb-2 font-medium uppercase tracking-wide">Key Drivers (SHAP)</p>
      <div className="space-y-1">
        {features.slice(0, 5).map((f, i) => {
          const absVal = Math.abs(f.value);
          const isPositive = f.value > 0;
          const maxBar = Math.max(...features.map(x => Math.abs(x.value)));
          const barWidth = maxBar > 0 ? (absVal / maxBar) * 100 : 0;
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="text-zinc-400 w-36 truncate shrink-0">{f.feature.replace(/_/g, " ")}</span>
              <div className="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${isPositive ? "bg-emerald-500/70" : "bg-red-500/70"}`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
              <span className={`w-12 text-right font-mono ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
                {f.value > 0 ? "+" : ""}{f.value.toFixed(3)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Probability Distribution ─────────────────────────────────────────────────

function ProbBars({ pred }: { pred: MlPrediction }) {
  const classes = [
    { label: "STRONG BUY", value: pred.probStrongBuy, color: "bg-emerald-500" },
    { label: "BUY", value: pred.probBuy, color: "bg-green-500" },
    { label: "HOLD", value: pred.probHold, color: "bg-zinc-500" },
    { label: "SELL", value: pred.probSell, color: "bg-orange-500" },
    { label: "STRONG SELL", value: pred.probStrongSell, color: "bg-red-500" },
  ].filter(c => c.value != null && c.value !== undefined);

  if (!classes.length) return null;

  return (
    <div className="mt-3 pt-3 border-t border-zinc-700/60">
      <p className="text-xs text-zinc-500 mb-2 font-medium uppercase tracking-wide">Class Probabilities</p>
      <div className="space-y-1.5">
        {classes.map((c, i) => {
          const pct = Math.round((c.value as number) * 100);
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="text-zinc-400 w-24 shrink-0">{c.label}</span>
              <div className="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${c.color}`} style={{ width: `${pct}%` }} />
              </div>
              <span className="text-zinc-300 w-8 text-right font-mono">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MLPredictions() {
  const { data: predictions, isLoading: predsLoading, refetch: refetchPreds } = trpc.mlPredictions.getLatest.useQuery();
  const { data: ruleSignals, isLoading: ruleLoading, refetch: refetchRule } = trpc.mlPredictions.getRuleBasedSignals.useQuery();

  function refetchAll() {
    refetchPreds();
    refetchRule();
  }

  const isLoading = predsLoading || ruleLoading;

  // Overall market stance summary
  const btc7d = predictions?.find(p => p.modelName === "btc_direction_7d");
  const btc30d = predictions?.find(p => p.modelName === "btc_direction_30d");
  const rotation = predictions?.find(p => p.modelName === "rotation_signal");
  const dcaIntensity = predictions?.find(p => p.modelName === "dca_intensity");

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2">
            <Brain className="w-6 h-6 text-orange-500" />
            ML Predictions
          </h1>
          <p className="text-zinc-400 text-sm mt-1">
            4 XGBoost models trained on 2,626 rows (2019–2026) · Walk-forward backtested · Retrains daily
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refetchAll}
          disabled={isLoading}
          className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Summary banner */}
      {predictions && predictions.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[btc7d, btc30d, rotation, dcaIntensity].filter(Boolean).map((p) => {
            if (!p) return null;
            const meta = MODEL_META[p.modelName] ?? { label: p.modelName, description: "", icon: null };
            return (
              <div
                key={p.modelName}
                className={`rounded-lg border p-3 ${predictionBg(p.prediction)}`}
              >
                <p className="text-xs text-zinc-500 mb-1 truncate">{meta.label}</p>
                <div className={`flex items-center gap-1.5 font-bold text-sm ${predictionColor(p.prediction)}`}>
                  {predictionIcon(p.prediction)}
                  {formatPredictionLabel(p.prediction)}
                </div>
                <p className="text-xs text-zinc-500 mt-1">{Math.round(p.confidence * 100)}% confidence</p>
              </div>
            );
          })}
        </div>
      )}

      {/* ML Model Cards */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide mb-3">XGBoost Model Outputs</h2>
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-48 bg-zinc-800/60 rounded-xl animate-pulse" />
            ))}
          </div>
        )}
        {!isLoading && (!predictions || predictions.length === 0) && (
          <div className="flex items-center gap-3 bg-zinc-800/60 rounded-xl p-6 text-zinc-400">
            <AlertCircle className="w-5 h-5 shrink-0 text-orange-400" />
            <div>
              <p className="font-medium text-zinc-300">No ML predictions available</p>
              <p className="text-sm mt-0.5">
                The daily retraining job may not have run yet. Check{" "}
                <code className="text-orange-400 text-xs">/tmp/ml_training.log</code> on the VPS.
              </p>
            </div>
          </div>
        )}
        {!isLoading && predictions && predictions.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {predictions.map((pred) => {
              const meta = MODEL_META[pred.modelName] ?? { label: pred.modelName, description: "", icon: null };
              return (
                <Card key={pred.modelName} className={`bg-zinc-900 border ${predictionBg(pred.prediction)} rounded-xl`}>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                          {meta.icon}
                          {meta.label}
                        </CardTitle>
                        <p className="text-xs text-zinc-500 mt-0.5">{meta.description}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-zinc-500">{pred.date}</p>
                        <p className="text-xs text-zinc-600 mt-0.5">v{pred.modelVersion}</p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-3">
                    {/* Prediction */}
                    <div className={`flex items-center gap-2 text-xl font-bold ${predictionColor(pred.prediction)}`}>
                      {predictionIcon(pred.prediction)}
                      {formatPredictionLabel(pred.prediction)}
                    </div>

                    {/* Confidence bar */}
                    {confidenceBar(pred.confidence)}

                    {/* Class probabilities (for direction models) */}
                    <ProbBars pred={pred} />

                    {/* SHAP top features */}
                    <TopFeatures topFeatures={pred.topFeatures} />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Rule-Based Signals (Secondary Confirmation) */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide mb-3">
          Rule-Based Signals
          <span className="ml-2 text-zinc-600 normal-case font-normal">(Secondary confirmation — runs every 60 min)</span>
        </h2>
        {ruleLoading && (
          <div className="h-24 bg-zinc-800/60 rounded-xl animate-pulse" />
        )}
        {!ruleLoading && (!ruleSignals || ruleSignals.length === 0) && (
          <div className="flex items-center gap-3 bg-zinc-800/60 rounded-xl p-4 text-zinc-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            No rule-based signals found in factor_snapshots.
          </div>
        )}
        {!ruleLoading && ruleSignals && ruleSignals.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-2.5 font-medium">Type</th>
                  <th className="text-left px-4 py-2.5 font-medium">Pair</th>
                  <th className="text-left px-4 py-2.5 font-medium">Signal</th>
                  <th className="text-right px-4 py-2.5 font-medium">Score</th>
                  <th className="text-right px-4 py-2.5 font-medium">Confidence</th>
                  <th className="text-right px-4 py-2.5 font-medium">Features</th>
                  <th className="text-right px-4 py-2.5 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {ruleSignals.map((sig, i) => (
                  <tr key={sig.id} className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors ${i === ruleSignals.length - 1 ? "border-b-0" : ""}`}>
                    <td className="px-4 py-2.5">
                      <Badge className="bg-zinc-700 text-zinc-300 text-xs">{sig.predictionType}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-200 font-mono text-xs">{formatPair(sig.pair)}</td>
                    <td className="px-4 py-2.5">{ruleSignalBadge(sig.overallSignal)}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-300">{sig.overallScore}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={sig.confidence >= 65 ? "text-emerald-400" : sig.confidence >= 50 ? "text-yellow-400" : "text-red-400"}>
                        {sig.confidence}%
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-400">{sig.activeFeatureCount}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-500 text-xs">{timeAgo(sig.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confluence note */}
      {predictions && predictions.length > 0 && (
        <div className="flex items-start gap-3 bg-zinc-800/40 border border-zinc-700/50 rounded-xl p-4 text-sm">
          <CheckCircle2 className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
          <p className="text-zinc-400">
            <span className="text-zinc-300 font-medium">Confluence required.</span>{" "}
            A trade recommendation is actionable only when ML predictions and rule-based signals agree on direction.
            ML models are the primary signal. Rule-based signals serve as secondary confirmation.
          </p>
        </div>
      )}
    </div>
  );
}
