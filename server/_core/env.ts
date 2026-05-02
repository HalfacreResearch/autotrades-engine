export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  // codex_portal: operations data (users, credentials, positions, execution log)
  clientPortalDatabaseUrl: process.env.CLIENT_PORTAL_DATABASE_URL ?? "",
  // tradinghq: research data (factors, ML models, backtests, signals, candlesticks)
  tradinghqDatabaseUrl: process.env.TRADINGHQ_DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};
