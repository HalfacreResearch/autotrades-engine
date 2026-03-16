import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RefreshCw, FileText, CheckCircle2, XCircle, Clock } from "lucide-react";

function typeBadge(type: string) {
  switch (type) {
    case "DCA_BUY":
      return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">DCA Buy</Badge>;
    case "ROTATION_ENTRY":
      return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs">Rotation Entry</Badge>;
    case "ROTATION_EXIT":
      return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs">Rotation Exit</Badge>;
    default:
      return <Badge className="bg-zinc-700 text-zinc-400 text-xs">{type}</Badge>;
  }
}

function statusBadge(status: string) {
  switch (status) {
    case "executed":
      return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 gap-1 text-xs"><CheckCircle2 className="w-3 h-3" />Executed</Badge>;
    case "failed":
      return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 gap-1 text-xs"><XCircle className="w-3 h-3" />Failed</Badge>;
    case "pending":
      return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 gap-1 text-xs"><Clock className="w-3 h-3" />Pending</Badge>;
    case "cancelled":
      return <Badge className="bg-zinc-700 text-zinc-400 text-xs">Cancelled</Badge>;
    default:
      return <Badge className="bg-zinc-700 text-zinc-400 text-xs">{status}</Badge>;
  }
}

export default function TradeLog() {
  const { data: log, isLoading, refetch } = trpc.log.getAll.useQuery({ limit: 100 });
  const { data: clients } = trpc.clients.getAll.useQuery();

  function getClientName(clientId: number) {
    return clients?.find(c => c.id === clientId)?.clientName ?? `Client #${clientId}`;
  }

  const executedCount = log?.filter(l => l.status === "executed").length ?? 0;
  const failedCount = log?.filter(l => l.status === "failed").length ?? 0;
  const liveCount = log?.filter(l => !l.isTestAccount).length ?? 0;
  const testCount = log?.filter(l => l.isTestAccount).length ?? 0;

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
          { label: "Successful", value: executedCount, color: "text-emerald-400" },
          { label: "Failed", value: failedCount, color: failedCount > 0 ? "text-red-400" : "text-zinc-100" },
          { label: "Live / Test", value: `${liveCount} / ${testCount}` },
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
            <p>No trades executed yet. Use the Signal Feed to execute your first trade.</p>
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
                    <th className="text-left py-3 px-4 text-zinc-500 font-medium">Type</th>
                    <th className="text-left py-3 px-4 text-zinc-500 font-medium">Pair</th>
                    <th className="text-right py-3 px-4 text-zinc-500 font-medium">Size</th>
                    <th className="text-right py-3 px-4 text-zinc-500 font-medium">Price</th>
                    <th className="text-right py-3 px-4 text-zinc-500 font-medium">P&L</th>
                    <th className="text-left py-3 px-4 text-zinc-500 font-medium">Status</th>
                    <th className="text-left py-3 px-4 text-zinc-500 font-medium">Mode</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map(entry => {
                    const pnl = parseFloat(String(entry.realizedPnlPercent ?? "0"));
                    return (
                      <tr key={entry.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                        <td className="py-3 px-4 text-zinc-400 text-xs whitespace-nowrap">
                          {new Date(entry.createdAt).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-zinc-300 whitespace-nowrap">
                          {getClientName(entry.clientId)}
                        </td>
                        <td className="py-3 px-4">
                          {typeBadge(entry.tradeType)}
                        </td>
                        <td className="py-3 px-4 text-zinc-200 font-medium">
                          {entry.pair}
                        </td>
                        <td className="py-3 px-4 text-right text-zinc-300">
                          {entry.positionSizePercent}%
                        </td>
                        <td className="py-3 px-4 text-right text-zinc-300 font-mono text-xs">
                          {entry.executionPrice ? parseFloat(String(entry.executionPrice)).toFixed(8) : "—"}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {entry.realizedPnlPercent ? (
                            <span className={pnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                              {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
                            </span>
                          ) : "—"}
                        </td>
                        <td className="py-3 px-4">
                          {statusBadge(entry.status)}
                        </td>
                        <td className="py-3 px-4">
                          <Badge className={entry.isTestAccount ? "bg-zinc-700 text-zinc-400 text-xs" : "bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs"}>
                            {entry.isTestAccount ? "Test" : "Live"}
                          </Badge>
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
