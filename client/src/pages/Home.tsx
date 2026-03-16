import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { useEffect } from "react";
import { useLocation } from "wouter";
import { ShieldCheck, Zap, BarChart3 } from "lucide-react";

export default function Home() {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && isAuthenticated) {
      navigate("/signals");
    }
  }, [isAuthenticated, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <span className="font-semibold text-lg tracking-tight">BTC Treasury Codex</span>
          <span className="text-zinc-500 text-sm ml-1">| Auto Trades</span>
        </div>
        <Button
          className="bg-orange-500 hover:bg-orange-600 text-white"
          onClick={() => (window.location.href = getLoginUrl())}
        >
          Operator Login
        </Button>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-8 py-20">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 bg-orange-500/10 border border-orange-500/20 rounded-full px-4 py-1.5 text-orange-400 text-sm mb-6">
            <ShieldCheck className="w-4 h-4" />
            Secure Operator Access Only
          </div>
          <h1 className="text-5xl font-bold tracking-tight mb-4">
            Automated Trade
            <span className="text-orange-500"> Execution Engine</span>
          </h1>
          <p className="text-zinc-400 text-lg leading-relaxed mb-8">
            Algorithmic-assisted DCA and rotation trade execution for BTC Treasury Codex clients.
            All trades execute through SFOX with comprehensive safety checks and full audit logging.
          </p>
          <Button
            size="lg"
            className="bg-orange-500 hover:bg-orange-600 text-white px-8"
            onClick={() => (window.location.href = getLoginUrl())}
          >
            Access Operator Dashboard
          </Button>
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl w-full mt-4">
          {[
            {
              icon: <Zap className="w-5 h-5 text-orange-500" />,
              title: "Live Signal Feed",
              desc: "Real-time recommendations from the tradinghq signal engine with confidence scores and expiry timers.",
            },
            {
              icon: <ShieldCheck className="w-5 h-5 text-orange-500" />,
              title: "Safety-First Execution",
              desc: "Every trade passes balance verification, position limit checks, and slippage protection before execution.",
            },
            {
              icon: <BarChart3 className="w-5 h-5 text-orange-500" />,
              title: "Full Audit Trail",
              desc: "Complete execution log with timestamps, prices, P&L outcomes, and client attribution for every trade.",
            },
          ].map((f) => (
            <div key={f.title} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 text-left">
              <div className="mb-3">{f.icon}</div>
              <div className="font-medium mb-1">{f.title}</div>
              <div className="text-zinc-400 text-sm">{f.desc}</div>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-zinc-800 px-8 py-4 text-center text-zinc-600 text-sm">
        BTC Treasury Codex — Operator Access Only. Unauthorized access is prohibited.
      </footer>
    </div>
  );
}
