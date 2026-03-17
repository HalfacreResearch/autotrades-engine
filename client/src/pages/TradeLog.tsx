import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RefreshCw, FileText, CheckCircle2, XCircle, Clock, AlertCircle } from "lucide-react";

function strategyBadge(strategy: string) {
  switch (strategy) {
    case "DCA":
      return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">DCA</Badge>;
    case "ROTATION":
      return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs">Rotation</Badge>;
    default:
      return <Badge className="bg-zinc-700 text-zinc-400 text-xs">{strategy}</Badge>;
  }
}

function sideBadge(side: string) {
  return side === "buy"
    ? <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">Buy</Badge>
    : <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">Sell</Badge>;
}

function statusBadge(status: string) {
  switch (status) {
    case "filled":
      return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 gap-1 text-xs"><CheckCircle2 className="w-3 h-3" />Filled</Badge>;
    case "failed":
      return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 gap-1 text-xs"><XCircle className="w-3 h-3" />Failed</Badge>;
    case "pending":
      return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 gap-1 text-xs"><Clock className="w-3 h-3" />Pending</Badge>;
    case "partial":
      return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 gap-1 text-xs"><AlertCircle className="w-3 h-3" />Partial</Badge>;
    case "cancelled":
      return <Badge className="bg-zinc-700 text-zinc-400 text-xs">Cancelled</Badge>;
    default:
      return <Badge className="bg-zinc-700 text-zinc-400 text-xs">{status}</Badge>;
  }
}

export default function TradeLog() {
  const { data: log, isLoading, refetch } = trpc.log.getAll.useQuery({ limit: 100 });
  const { data: clients } = trpc.clients.getAll.useQuery();

  function getClientName(userId: number) {
    return clients?.find(c => c.userId === userId)?.name ?? `User #${userId}`;
  }

  const filledCount = log?.filter(l => l.status === "filled").length ?? 0;
  const failedCount = log?.filter(l => l.status === "failed").length ?? 0;
  const dcaCount = log?.filter(l => l.strategy === "DCA").length ?? 0;
  const rotationCount = log?.filter(l => l.strategy === "ROTATION").length ?? 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Execution Log</h1>
          <p className="text-zinc-400 text-sm mt-1">Complete audit trail of all trade executions</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
          <RefreshCw className="w-4 h-4 mr-2" />Refresh
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Executions", value: log?.length ?? 0 },
          { label: "Filled", value: filledCount, color: "text-emerald-400" },
          { label: "Failed", value: failedCount, color: failedCount > 0 ? "text-red-400" : "text-zinc-100" },
          { label: "DCA / Rotation", value: `${dcaCount} / ${rotationCount}` },
        ].map(s => (
          <Card key={s.label} className="bg-zinc-900 border-zinc-800">
            <CardContent className="py-4 px-5">
              <div className="text-zinc-500 text-xs mb-1">{s.label}</div>
              <div className={`text-2xl font-bold ${s.color ?? "text-zinc-100"}`}>{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="h-12 bg-zinc-800 rounded-lg animate-pulse" />)}</div>
      ) : !log || log.length === 0 ? (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="py-12 text-center text-zinc-500">
            <FileText className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p>No trades executed yet.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left py-3 px-4 text-zinc-500 font-medium">Time</th>
                    <th className="text-left py-3 px-4 text-zinc-500 font-medium">Client</th>
                    <th className="text-left py-3 px-4 text-zinc-500 font-medium">Strategy</th>
                    <th className="text-left py-3 px-4 text-zinc-500 font-medium">Side</th>
                    <th className="text-left py-3 px-4 text-zinc-500 font-medium">Pair</th>
                    <th className="text-right py-3 px-4 text-zinc-500 font-medium">Qty</th>
                    <th className="text-right py-3 px-4 text-zinc-500 font-medium">Price</th>
                    <th className="text-right py-3 px-4 text-zinc-500 font-medium">BTC P&L</th>
                    <th className="text-left py-3 px-4 text-zinc-500 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map(entry => {
                    const btcPnl = entry.btcPnl ? parseFloat(String(entry.btcPnl)) : null;
                    return (
                      <tr key={entry.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                        <td className="py-3 px-4 text-zinc-400 text-xs whitespace-nowrap">
                          {new Date(entry.executedAt).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-zinc-300 whitespace-nowrap">
                          {getClientName(entry.userId)}
                        </td>
                        <td className="py-3 px-4">
                          {strategyBadge(entry.strategy)}
                        </td>
                        <td className="py-3 px-4">
                          {sideBadge(entry.side)}
                        </td>
                        <td className="py-3 px-4 text-zinc-200 font-medium">
                          {entry.pair}
                        </td>
                        <td className="py-3 px-4 text-right text-zinc-300 font-mono text-xs">
                          {parseFloat(String(entry.quantity)).toFixed(6)}
                        </td>
                        <td className="py-3 px-4 text-right text-zinc-300 font-mono text-xs">
                          {entry.price ? parseFloat(String(entry.price)).toFixed(8) : "—"}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {btcPnl !== null ? (
                            <span className={btcPnl >= 0 ? "text-emerald-400 font-mono text-xs" : "text-red-400 font-mono text-xs"}>
                              {btcPnl >= 0 ? "+" : ""}{btcPnl.toFixed(6)} BTC
                            </span>
                          ) : <span className="text-zinc-600">—</span>}
                        </td>
                        <td className="py-3 px-4">
                          {statusBadge(entry.status)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
