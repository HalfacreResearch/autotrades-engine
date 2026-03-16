import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Users, Plus, Key, Wifi, WifiOff, RefreshCw, Eye, EyeOff, AlertTriangle } from "lucide-react";

function statusBadge(status: string) {
  switch (status) {
    case "connected":
      return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 gap-1"><Wifi className="w-3 h-3" />Connected</Badge>;
    case "error":
      return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 gap-1"><WifiOff className="w-3 h-3" />Error</Badge>;
    case "pending":
      return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Pending</Badge>;
    default:
      return <Badge className="bg-zinc-700 text-zinc-400">Unconfigured</Badge>;
  }
}

interface AddClientDialogProps { onClose: () => void; onSuccess: () => void; }
function AddClientDialog({ onClose, onSuccess }: AddClientDialogProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const addMutation = trpc.clients.add.useMutation();

  async function handleAdd() {
    if (!name || !email) { toast.error("Name and email are required"); return; }
    try {
      await addMutation.mutateAsync({ clientName: name, clientEmail: email });
      toast.success(`${name} added successfully`);
      onSuccess();
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to add client");
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-zinc-100 max-w-md">
        <DialogHeader><DialogTitle>Add New Client</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-zinc-300">Client Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="John Smith" className="bg-zinc-800 border-zinc-700 text-zinc-100" />
          </div>
          <div className="space-y-2">
            <Label className="text-zinc-300">Email Address</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="john@example.com" type="email" className="bg-zinc-800 border-zinc-700 text-zinc-100" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">Cancel</Button>
          <Button onClick={handleAdd} disabled={addMutation.isPending} className="bg-orange-500 hover:bg-orange-600">
            {addMutation.isPending ? "Adding..." : "Add Client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ApiKeyDialogProps { clientId: number; clientName: string; onClose: () => void; onSuccess: () => void; }
function ApiKeyDialog({ clientId, clientName, onClose, onSuccess }: ApiKeyDialogProps) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const setKeyMutation = trpc.clients.setApiKey.useMutation();

  async function handleSave() {
    if (!apiKey || apiKey.length < 10) { toast.error("Please enter a valid SFOX API key"); return; }
    try {
      const result = await setKeyMutation.mutateAsync({ clientId, apiKey });
      if (result.connected) {
        toast.success(`API key saved and connection verified for ${clientName}`);
      } else {
        toast.warning(`API key saved but connection test failed: ${result.error}`);
      }
      onSuccess();
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save API key");
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-zinc-100 max-w-md">
        <DialogHeader><DialogTitle>Set SFOX API Key — {clientName}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-start gap-2 bg-orange-500/10 border border-orange-500/30 rounded-lg p-3 text-orange-400 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            The API key is encrypted with AES-256-GCM before storage and is never returned to the browser after saving.
          </div>
          <div className="space-y-2">
            <Label className="text-zinc-300">SFOX API Key</Label>
            <div className="relative">
              <Input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                type={showKey ? "text" : "password"}
                placeholder="Enter SFOX API key..."
                className="bg-zinc-800 border-zinc-700 text-zinc-100 pr-10"
              />
              <button onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200">
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">Cancel</Button>
          <Button onClick={handleSave} disabled={setKeyMutation.isPending} className="bg-orange-500 hover:bg-orange-600">
            {setKeyMutation.isPending ? "Saving & Testing..." : "Save & Test Connection"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface BalanceCardProps { clientId: number; clientName: string; onClose: () => void; }
function BalanceCard({ clientId, clientName, onClose }: BalanceCardProps) {
  const { data, isLoading } = trpc.clients.getBalances.useQuery({ clientId });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-zinc-100 max-w-md">
        <DialogHeader><DialogTitle>Balances — {clientName}</DialogTitle></DialogHeader>
        <div className="py-2">
          {isLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-8 bg-zinc-800 rounded animate-pulse" />)}</div>
          ) : data?.error ? (
            <div className="text-red-400 text-sm">{data.error}</div>
          ) : (
            <div className="space-y-2">
              {data?.balances.filter(b => b.balance > 0).map(b => (
                <div key={b.currency} className="flex justify-between items-center bg-zinc-800 rounded-lg px-4 py-2">
                  <span className="font-medium text-zinc-200">{b.currency}</span>
                  <div className="text-right">
                    <div className="text-zinc-100">{b.balance.toFixed(8)}</div>
                    <div className="text-xs text-zinc-500">Available: {b.available.toFixed(8)}</div>
                  </div>
                </div>
              ))}
              {data?.balances.filter(b => b.balance > 0).length === 0 && (
                <p className="text-zinc-500 text-center py-4">No balances found</p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ClientRoster() {
  const { data: clients, isLoading, refetch } = trpc.clients.getAll.useQuery();
  const testMutation = trpc.clients.testConnection.useMutation();
  const [showAdd, setShowAdd] = useState(false);
  const [apiKeyClient, setApiKeyClient] = useState<{ id: number; name: string } | null>(null);
  const [balanceClient, setBalanceClient] = useState<{ id: number; name: string } | null>(null);

  async function handleTestConnection(clientId: number) {
    try {
      const result = await testMutation.mutateAsync({ clientId });
      if (result.connected) {
        toast.success(`Connection verified — BTC balance: ${result.btcBalance?.toFixed(8)} BTC`);
      } else {
        toast.error(`Connection failed: ${result.error}`);
      }
      refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    }
  }

  const connectedCount = clients?.filter(c => c.connectionStatus === "connected").length ?? 0;
  const totalCount = clients?.length ?? 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Client Roster</h1>
          <p className="text-zinc-400 text-sm mt-1">
            {connectedCount} of {totalCount} clients connected to SFOX
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
            <RefreshCw className="w-4 h-4 mr-2" />Refresh
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)} className="bg-orange-500 hover:bg-orange-600">
            <Plus className="w-4 h-4 mr-2" />Add Client
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Clients", value: totalCount },
          { label: "Connected", value: connectedCount, color: "text-emerald-400" },
          { label: "With API Key", value: clients?.filter(c => c.hasApiKey).length ?? 0 },
          { label: "Active", value: clients?.filter(c => c.isActive).length ?? 0 },
        ].map(s => (
          <Card key={s.label} className="bg-zinc-900 border-zinc-800">
            <CardContent className="py-4 px-5">
              <div className="text-zinc-500 text-xs mb-1">{s.label}</div>
              <div className={`text-2xl font-bold ${s.color ?? "text-zinc-100"}`}>{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Client list */}
      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-zinc-800 rounded-xl animate-pulse" />)}</div>
      ) : !clients || clients.length === 0 ? (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="py-12 text-center text-zinc-500">
            <Users className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p>No clients yet. Add a client to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {clients.map(client => (
            <Card key={client.id} className="bg-zinc-900 border-zinc-800 hover:border-zinc-700 transition-colors">
              <CardContent className="py-4 px-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-zinc-100">{client.clientName}</span>
                      {statusBadge(client.connectionStatus)}
                      {!client.isActive && <Badge className="bg-zinc-700 text-zinc-400 text-xs">Inactive</Badge>}
                    </div>
                    <div className="text-zinc-500 text-sm mt-0.5">{client.clientEmail}</div>
                    {client.lastVerifiedAt && (
                      <div className="text-zinc-600 text-xs mt-0.5">
                        Last verified: {new Date(client.lastVerifiedAt).toLocaleString()}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {client.hasApiKey && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setBalanceClient({ id: client.id, name: client.clientName })}
                          className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs"
                        >
                          Balances
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleTestConnection(client.id)}
                          disabled={testMutation.isPending}
                          className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs"
                        >
                          <RefreshCw className="w-3 h-3 mr-1" />Test
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setApiKeyClient({ id: client.id, name: client.clientName })}
                      className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs"
                    >
                      <Key className="w-3 h-3 mr-1" />
                      {client.hasApiKey ? "Update Key" : "Set API Key"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showAdd && <AddClientDialog onClose={() => setShowAdd(false)} onSuccess={() => refetch()} />}
      {apiKeyClient && <ApiKeyDialog clientId={apiKeyClient.id} clientName={apiKeyClient.name} onClose={() => setApiKeyClient(null)} onSuccess={() => refetch()} />}
      {balanceClient && <BalanceCard clientId={balanceClient.id} clientName={balanceClient.name} onClose={() => setBalanceClient(null)} />}
    </div>
  );
}
