import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setupTempDb, type TempDb } from "./helpers/test-db";

let tdb: TempDb;

beforeAll(() => {
  tdb = setupTempDb();
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
}, 30_000);

describe("db 单例", () => {
  it("可写入并读回 Task 与 TaskEvent", async () => {
    const { db } = await import("@/lib/db");
    const t = await db.task.create({
      data: { sourceType: "self-made", status: "writing" },
    });
    await db.taskEvent.create({
      data: { taskId: t.taskId, stage: "writing", eventType: "llm_chunk", message: "思考片段" },
    });
    const found = await db.task.findUnique({
      where: { taskId: t.taskId },
      include: { events: true },
    });
    expect(found?.status).toBe("writing");
    expect(found?.events).toHaveLength(1);
    expect(found?.events[0]?.message).toBe("思考片段");
    await db.$disconnect();
  });
  it("Task 新字段 title / referencePathsJson 可写入并读回", async () => {
    const { db } = await import("@/lib/db");
    const created = await db.task.create({
      data: {
        sourceType: "user-outline",
        status: "writing",
        title: "测试标题",
        referencePathsJson: JSON.stringify({ character: "data/images/x/references/character.png" }),
      },
    });
    const found = await db.task.findUnique({ where: { taskId: created.taskId } });
    expect(found?.title).toBe("测试标题");
    const refs = JSON.parse(found?.referencePathsJson ?? "{}") as { character?: string };
    expect(refs.character).toContain("character.png");
    await db.$disconnect();
  });
});
