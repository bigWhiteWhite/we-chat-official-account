// Prisma 7 requires CLI (migrate/db push) to get the connection URL from prisma.config.ts;
// the schema.prisma datasource url attribute is no longer supported.
// DB_FILE default stays consistent with src/env.ts; bare paths get a file: prefix
// (same normalization as src/lib/db.ts).
// The Prisma CLI does not auto-load .env (only the Next.js runtime does), so load it
// explicitly here. loadEnvFile does not override existing env vars, so a test-injected
// DB_FILE always takes priority.

import { defineConfig } from "prisma/config";

try {
  process.loadEnvFile();
} catch {
  // no .env file present; fall back to system env vars or the default path
}

function resolveDbUrl(): string {
  const raw = (process.env.DB_FILE ?? "").trim();
  const value = raw || "./data/comics.db";
  return value.startsWith("file:") ? value : `file:${value}`;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: resolveDbUrl(),
  },
  migrations: {
    // 让 `prisma db seed` 与 `pnpm db:seed` 指向同一个幂等预设脚本
    seed: "tsx scripts/db-seed.ts",
  },
});
