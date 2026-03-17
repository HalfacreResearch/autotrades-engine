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
- [ ] Save checkpoint and deploy to GitHub/Hostinger
