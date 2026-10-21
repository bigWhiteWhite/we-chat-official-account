import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export type TempDb = {
  dir: string;
  cleanup: () => Promise<void>;
};

let originalUrl: string | undefined;

/**
 * 创建临时 SQLite 库、push 当前 schema 并指向 DB_FILE（抽自 tests/db.test.ts 的既有行为）。
 * Prisma 7：连接 URL 由 prisma.config.ts / driver adapter 提供，
 * 测试库的表结构需要按当前临时库逐次 push（首次建库建表，后续为 no-op）。
 * 注意：@/lib/db 单例按模块级 const 绑定首个 DB_FILE，同一测试文件请全程共用一个临时库。
 * 凡静态 import 会传递性引入 @/lib/db 的模块（settings-store / settings-payload / business-settings /
 * model-manager 等），ES import 提升会先于本函数执行、把单例绑到真实 data/comics.db，测试写入即污染真实库。
 * 这类模块必须在 beforeAll 里 await import()（先 import @/lib/db 绑临时库），范式见 settings-payload.test.ts。
 */
export function setupTempDb(): TempDb {
  const dir = mkdtempSync(path.join(tmpdir(), "comics-db-"));
  originalUrl = process.env.DB_FILE;
  process.env.DB_FILE = `file:${path.join(dir, "test.db")}`;
  execFileSync(
    process.execPath,
    [path.resolve(__dirname, "../../node_modules/prisma/build/index.js"), "db", "push"],
    {
      cwd: path.resolve(__dirname, "../.."),
      env: { ...process.env },
      stdio: "ignore",
    },
  );
  return {
    dir,
    cleanup: async () => {
      try {
        const mod = await import("@/lib/db");
        await mod.db.$disconnect();
      } catch {
        // 客户端尚未创建过时忽略
      }
      // Windows 上 libsql 的原生句柄要等 GC/后台回收后才释放，立即 unlink 会报 EBUSY；
      // 带重试清理（上限 ~8s）。仍失败时不判测试失败——临时目录在 %TEMP%，交由系统回收。
      for (let attempt = 0; attempt < 40; attempt++) {
        try {
          rmSync(dir, { recursive: true, force: true });
          break;
        } catch {
          if (attempt === 39) {
            console.warn(`[test-db] 临时库目录暂未释放，交由系统回收: ${dir}`);
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
      if (originalUrl === undefined) delete process.env.DB_FILE;
      else process.env.DB_FILE = originalUrl;
    },
  };
}
