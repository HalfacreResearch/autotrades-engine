# AutoTrades Engine — TODO

## Schema & Database
- [x] Define autotrades schema: executionLog, clientConnections tables
- [x] Apply schema migration via webdev_execute_sql
- [x] Set up dual DB connection helpers (tradinghq + codex-client-portal)

## Backend — SFOX Execution Engine
- [x] Port SFOX API service from tradinghq (balances, buy, sell, safety checks)
- [x] Implement executeDCABuy with safety checks
- [x] Implement executeRotationEntry with safety checks
- [x] Implement executeRotationExit with safety checks
- [x] AUTOTRADES_SECRET server-to-server auth middleware

## Backend — tRPC Routes
- [x] signals.getFeed — live signal feed from tradinghq DB
- [x] clients.getAll — client roster with SFOX balances
- [x] clients.testConnection — verify SFOX API key
- [x] clients.setApiKey — save encrypted SFOX API key
- [x] clients.add — add new client
- [x] clients.getBalances — fetch live SFOX balances
- [x] trades.executeDCA — execute DCA buy for a client
- [x] trades.executeRotationEntry — execute rotation entry
- [x] trades.executeRotationExit — execute rotation exit
- [x] positions.getAll — all open rotation positions
- [x] log.getAll — full trade execution history
- [x] safety.runChecks — run all safety checks before execution

## Frontend — Operator Dashboard
- [x] Dark theme with orange accent, sidebar navigation
- [x] Home landing page with operator login
- [x] Signal Feed page — live recommendations with confidence, expiry, trade buttons
- [x] Client Roster page — all clients, BTC balance, position count, SFOX status
- [x] Active Positions page — open rotations with P&L, peak, trailing stop status
- [x] Execution Log page — full history table
- [x] Trade execution dialog — client select, position size, test/live toggle, safety check summary
- [x] Exit dialog — confirm exit with current P&L preview

## Security & Safety
- [x] AUTOTRADES_SECRET env var wired
- [x] All API keys encrypted at rest (AES-256-GCM, never exposed to frontend)
- [x] Safety check gate before every execution
- [x] Max 3 concurrent rotations enforced server-side

## Testing & Deployment
- [x] Vitest tests for safety checks and execution logic (8 tests passing)
- [x] Wire TRADINGHQ_DATABASE_URL, CLIENT_PORTAL_DATABASE_URL, AUTOTRADES_SECRET secrets
- [x] Save checkpoint
- [x] Create GitHub repo and push
- [x] Guide Hostinger Node.js deployment

## ML Predictions UI (March 17, 2026)
- [x] Add getLatestMlPredictions() DB helper reading from tradinghq.ml_predictions
- [x] Add getLatestRuleBasedSignals() DB helper reading from tradinghq.factor_snapshots
- [x] Add mlPredictions.getLatest tRPC endpoint
- [x] Add mlPredictions.getRuleBasedSignals tRPC endpoint
- [x] Build MLPredictions page — 4 XGBoost model cards with SHAP features + probability bars
- [x] Build Dashboard overview page — ML summary, open positions, recent log
- [x] Add Dashboard and ML Predictions to sidebar navigation
- [x] Redirect post-login to /dashboard instead of /signals
- [x] All 11 tests passing

## Restructure — Remove Out-of-Scope Pages (March 17, 2026)
- [x] Remove Client Roster page (client management belongs to client.codexyield.com)
- [x] Remove Signal Feed page (redundant — trade_recommendations is manual, ML Predictions covers the signal view)
- [x] Remove client API key management endpoints from routers.ts (setApiKey, testConnection, getBalances)
- [x] Update DashboardLayout nav to: Dashboard, ML Predictions, Active Positions, Execution Log
- [x] Update App.tsx routing to remove /signals and /clients routes
- [x] All 11 tests passing, TypeScript clean
- [x] Save checkpoint and deploy to GitHub/Hostinger

## Full Trading System Build (March 17, 2026)

### sfoxEngine.ts — Full Order Type Expansion
- [ ] Add getOrderEstimate() — pre-trade price/fee estimate from SFOX /v1/offer/:side
- [ ] Add placeSmartRoutingBuy() — algorithm_id 200, amount-based (USD spend), WeightedExchange routing
- [ ] Add placeSmartRoutingSell() — algorithm_id 200, quantity-based, WeightedExchange routing
- [ ] Add placeTrailingStop() — algorithm_id 308, stop_percent or stop_amount, sell-side only
- [ ] Add placeTWAP() — algorithm_id 307, total_time + interval + continuous + post_only (for large DCA buys)
- [ ] Add getOpenOrders() — GET /v1/orders with filters
- [ ] Add getDoneOrders() — GET /v1/orders/done for execution history
- [ ] Add emergencyLiquidation() — sell all alts to BTC then BTC to USD via Smart Routing
- [ ] Add calculateVolatilityTier() — 30d price volatility → 6% / 10% / 15% trailing stop recommendation
- [ ] Update runSafetyChecks() — cover all trade types including initial 25% buy guard

### Automated Engines (scheduler)
- [ ] Build dcaEngine.ts — reads ML predictions, maps signal strength to 2.5/5/7.5/10% of USD, executes Smart Routing buy across all clients
- [ ] Signal strength → position size mapping: STRONG=10%, MODERATE=7.5%, WEAK=5%, MINIMAL=2.5%
- [ ] Build rotationEngine.ts — reads rotation signals, manages 2/4/6% BTC entries, monitors P&L, auto-sets trailing stop when net profitable
- [ ] Net profit calculation: entry price + SFOX fee estimate + slippage buffer → breakeven threshold
- [ ] Trailing stop tier: calculate 30d volatility → assign 6%/10%/15% → place on SFOX automatically
- [ ] Multi-client execution: loop all active clients, execute same trade for each, log individually

### tRPC Endpoints
- [ ] trading.getOrderEstimate — pre-trade estimate for confirmation screen
- [ ] trading.executeManualEntry — rotation entry across all clients (Smart Routing, 2/4/6% BTC)
- [ ] trading.executeManualExit — full exit across all clients (Smart Routing)
- [ ] trading.executeCapitalExit — partial exit: sell original BTC risked only, leave profits
- [ ] trading.executeEmergencyExit — market order exit for a specific client
- [ ] trading.executeEmergencyLiquidation — full BTC+alts→USD for specific client (offboarding, double confirm)
- [ ] trading.executeInitialBuy — manual 25% USD→BTC for new client (with confirmation screen)
- [ ] trading.setTrailingStop — manually set/adjust trailing stop on open position
- [ ] positions.getOpenSFOXOrders — live open orders from SFOX API per client
- [ ] clients.getPendingInitialBuy — clients with no initial buy yet (for Dashboard alert)

### Manual Trading Page (new page /manual-trade)
- [ ] Rotation entry form: pair selector, size (2/4/6%), order estimate panel, confirm button
- [ ] Executes across all clients simultaneously
- [ ] Confirmation screen: estimated price, fees, BTC amount per client, total exposure
- [ ] Smart Routing only for entries

### Active Positions Page Updates
- [ ] Show trailing stop status per position (active/not set/triggered)
- [ ] Show net P&L in BTC terms (current value minus entry cost minus estimated fees)
- [ ] Show breakeven threshold (entry + fees + slippage buffer)
- [ ] Full exit button (Smart Routing, all clients)
- [ ] Capital exit button (sell original BTC risked, leave profits — all clients)
- [ ] Emergency exit button (Market order, protected with confirmation)
- [ ] Set/adjust trailing stop button with volatility tier suggestion

### Dashboard Updates
- [ ] Pending initial buy alerts for new clients (clients with no initial buy on record)
- [ ] Scheduler status: DCA engine last run, rotation engine last run, next scheduled run
- [ ] Active trailing stops count and status summary
- [ ] SFOX connectivity health per client

### Safety & Hard Limits (server-side enforced)
- [ ] DCA buys: never exceed 10% of USD balance automatically (25% only via manual initial buy)
- [ ] Rotation entries: never exceed 6% of BTC balance in a single trade
- [ ] Total altcoin exposure: never exceed 12% of BTC balance per altcoin
- [ ] Emergency liquidation: requires typed confirmation string ("LIQUIDATE [CLIENT NAME]")
- [ ] All trades logged to codex_portal execution_log: client_id, order_id, fill_price, fees, timestamp, trade_type

## Full Trading System — Completed Items (March 17, 2026)
- [x] sfoxEngine.ts — Smart Routing (200), Trailing Stop (308), TWAP (307), Order Estimate, Open Orders, Emergency Liquidation, volatility tier calculator
- [x] dcaEngine.ts — reads ML predictions, maps signal strength to 2.5/5/7.5/10% of USD, executes Smart Routing buy across all clients
- [x] rotationEngine.ts — 2/4/6% BTC entries, P&L monitoring, auto trailing stop when net profitable
- [x] tRPC: trading.executeManualEntry, executeManualExit, executeCapitalExit, executeEmergencyExit, executeEmergencyLiquidation, setTrailingStop, getOrderEstimate
- [x] tRPC: clients.getPendingInitialBuy (new client alert on Dashboard)
- [x] Schema: initialBuyExecuted column added to client_connections (defaults TRUE — all existing clients protected)
- [x] DB migration applied
- [x] ManualTrading page — rotation entry (2/4/6%), full/capital/emergency exit, trailing stop setter, emergency liquidation with typed confirmation
- [x] ActivePositions page — trailing stop status badges, inline exit dialog with all 3 exit types, set trailing stop button when profitable
- [x] Dashboard — pending initial buy alerts, trailing stop triggered alerts, clean theme-aware styling
- [x] Manual Trading added to sidebar navigation (5 nav items total)
- [x] All 11 tests passing, TypeScript clean (0 errors)
- [ ] Save checkpoint and push to GitHub
