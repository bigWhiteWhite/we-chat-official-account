import { describe, expect, it } from "vitest";

import {
  nextPanelFileName,
  parsePanelVersion,
  resolvePanelVersionFile,
  sortPanelVersions,
} from "@/pipeline/panel-versions";

describe("parsePanelVersion", () => {
  it("旧格式无后缀文件视为初始版本 0", () => {
    expect(parsePanelVersion(0, "panel-01.png")).toBe(0);
  });

  it("vN 文件解析为对应版本号", () => {
    expect(parsePanelVersion(0, "panel-01.v1.png")).toBe(1);
    expect(parsePanelVersion(2, "panel-03.v42.png")).toBe(42);
  });

  it("其他格 / 非 png / 非法版本号一律返回 null", () => {
    expect(parsePanelVersion(0, "panel-02.v1.png")).toBeNull();
    expect(parsePanelVersion(0, "panel-01.v1.jpg")).toBeNull();
    expect(parsePanelVersion(0, "panel-01.v01.png")).toBeNull();
    expect(parsePanelVersion(0, "panel-01.v.png")).toBeNull();
    expect(parsePanelVersion(0, "panel-01v1.png")).toBeNull();
    expect(parsePanelVersion(0, "style-01.png")).toBeNull();
  });
});

describe("nextPanelFileName", () => {
  it("目录为空时首次生成 v1", () => {
    expect(nextPanelFileName(1, [])).toBe("panel-02.v1.png");
  });

  it("旧格式无后缀文件不占 vN 序号", () => {
    expect(nextPanelFileName(1, ["panel-02.png"])).toBe("panel-02.v1.png");
  });

  it("取已有最大版本号 + 1", () => {
    expect(nextPanelFileName(1, ["panel-02.v1.png", "panel-02.v3.png"])).toBe("panel-02.v4.png");
  });

  it("忽略其他格的文件", () => {
    expect(nextPanelFileName(1, ["panel-01.v9.png", "panel-02.v2.png"])).toBe("panel-02.v3.png");
  });
});

describe("sortPanelVersions", () => {
  it("按版本号升序，初始版本在最前，不修改原数组", () => {
    const input = [
      { version: 2, fileName: "panel-01.v2.png", mtimeMs: 3 },
      { version: 0, fileName: "panel-01.png", mtimeMs: 1 },
      { version: 1, fileName: "panel-01.v1.png", mtimeMs: 2 },
    ];
    const sorted = sortPanelVersions(input);
    expect(sorted.map((e) => e.version)).toEqual([0, 1, 2]);
    expect(input.map((e) => e.version)).toEqual([2, 0, 1]);
  });
});

describe("resolvePanelVersionFile", () => {
  const dir = "data/images/t1";

  it("接受本格合法版本路径（兼容反斜杠），返回文件名", () => {
    expect(resolvePanelVersionFile(dir, 0, `data\\images\\t1\\panel-01.v2.png`)).toBe(
      "panel-01.v2.png",
    );
    expect(resolvePanelVersionFile(dir, 0, "data/images/t1/panel-01.png")).toBe("panel-01.png");
  });

  it("拒绝其他格 / 其他任务目录 / 非法扩展名", () => {
    expect(resolvePanelVersionFile(dir, 0, "data/images/t1/panel-02.v1.png")).toBeNull();
    expect(resolvePanelVersionFile(dir, 0, "data/images/t2/panel-01.v1.png")).toBeNull();
    expect(resolvePanelVersionFile(dir, 0, "data/images/t1/panel-01.v1.jpg")).toBeNull();
    expect(resolvePanelVersionFile(dir, 0, "../panel-01.v1.png")).toBeNull();
  });
});
