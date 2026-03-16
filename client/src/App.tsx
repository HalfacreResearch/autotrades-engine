import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import SignalFeed from "./pages/SignalFeed";
import ClientRoster from "./pages/ClientRoster";
import ActivePositions from "./pages/ActivePositions";
import TradeLog from "./pages/TradeLog";
import Home from "./pages/Home";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/signals">
        <DashboardLayout>
          <SignalFeed />
        </DashboardLayout>
      </Route>
      <Route path="/clients">
        <DashboardLayout>
          <ClientRoster />
        </DashboardLayout>
      </Route>
      <Route path="/positions">
        <DashboardLayout>
          <ActivePositions />
        </DashboardLayout>
      </Route>
      <Route path="/log">
        <DashboardLayout>
          <TradeLog />
        </DashboardLayout>
      </Route>
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
