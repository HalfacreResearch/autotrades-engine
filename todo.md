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
