import { PrismaClient } from "@prisma/client";
import type { SqlDriverAdapterFactory } from "@prisma/driver-adapter-utils";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const DEFAULT_DB_FILE = "file:./data/comics.db";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaDbFile?: string;
};

function resolveDbFile(): string {
  const raw = process.env.DB_FILE;
  if (!raw || raw.trim() === "") return DEFAULT_DB_FILE;
  // 允许形如 ./data/comics.db 的裸路径（与 src/env.ts 默认值一致），统一补上 libsql 的 file: 前缀
  if (raw.startsWith("file:")) return raw;
  return `file:${raw}`;
}

function createClient(): PrismaClient {
  const dbFile = resolveDbFile();
  const adapter: SqlDriverAdapterFactory = new PrismaLibSql({ url: dbFile });
  return new PrismaClient({ adapter });
}

export const db: PrismaClient = (() => {
  const dbFile = resolveDbFile();
  // 同一进程内连接串未变化时复用全局单例；测试通过修改 DB_FILE 触发重建
  if (globalForPrisma.prisma && globalForPrisma.prismaDbFile === dbFile) {
    return globalForPrisma.prisma;
  }
  const client = createClient();
  globalForPrisma.prisma = client;
  globalForPrisma.prismaDbFile = dbFile;
  return client;
})();

export default db;
