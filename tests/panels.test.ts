import { describe, expect, it } from "vitest";

import { removePanelAt, reorderPanels, replacePanelImage } from "@/pipeline/panels";

const script = {
  title: "测试",
  source: "self-made",
  source_url: "",
  theme: "t",
  target_panels: 4,
  panels: [
    { scene: "s1", character: "c1", dialogue: "d1" },
    { scene: "s2", character: "c2", dialogue: "d2" },
    { scene: "s3", character: "c3", dialogue: "d3" },
    { scene: "s4", character: "c4", dialogue: "d4" },
  ],
  punchline: "p",
  risk_tags: [],
};

const scriptJson = JSON.stringify(script);
const imagePathsJson = JSON.stringify(["panel-01.png", null, "panel-03.png", "panel-04.png"]);

describe("removePanelAt", () => {
  it("删中间格：剧本与图片数组按下标同步删除", () => {
    const r = removePanelAt(scriptJson, imagePathsJson, 1);
    const s = JSON.parse(r.scriptJson);
    const imgs = JSON.parse(r.imagePathsJson!);
    expect(s.panels).toHaveLength(3);
    expect(s.panels[1].scene).toBe("s3");
    expect(imgs).toEqual(["panel-01.png", "panel-03.png", "panel-04.png"]);
  });

  it("删首格/末格正常", () => {
    const head = JSON.parse(removePanelAt(scriptJson, imagePathsJson, 0).scriptJson).panels;
    expect(head[0].scene).toBe("s2");
    const tail = JSON.parse(removePanelAt(scriptJson, imagePathsJson, 3).scriptJson).panels;
    expect(tail).toHaveLength(3);
    expect(tail[2].scene).toBe("s3");
  });

  it("imagePathsJson 为 null 时保持 null", () => {
    const r = removePanelAt(scriptJson, null, 0);
    expect(r.imagePathsJson).toBeNull();
    expect(JSON.parse(r.scriptJson).panels).toHaveLength(3);
  });

  it("下标越界抛错", () => {
    expect(() => removePanelAt(scriptJson, imagePathsJson, -1)).toThrow(/越界/);
    expect(() => removePanelAt(scriptJson, imagePathsJson, 4)).toThrow(/越界/);
  });
});

describe("replacePanelImage", () => {
  it("替换指定下标，其余位不变", () => {
    const out = replacePanelImage(imagePathsJson, 1, "panel-02.png");
    expect(JSON.parse(out)).toEqual([
      "panel-01.png",
      "panel-02.png",
      "panel-03.png",
      "panel-04.png",
    ]);
  });

  it("null 输入视为空数组，任何下标均越界", () => {
    expect(() => replacePanelImage(null, 0, "a.png")).toThrow(/越界/);
  });
});

describe("reorderPanels", () => {
  it("从中间移动：剧本与图片数组同步移动", () => {
    const r = reorderPanels(scriptJson, imagePathsJson, 1, 3);
    const s = JSON.parse(r.scriptJson);
    const imgs = JSON.parse(r.imagePathsJson!);
    expect((s.panels as Array<{ scene: string }>).map((p) => p.scene)).toEqual([
      "s1",
      "s3",
      "s4",
      "s2",
    ]);
    expect(imgs).toEqual(["panel-01.png", "panel-03.png", "panel-04.png", null]);
  });

  it("前后移动方向均正确", () => {
    const forward = JSON.parse(reorderPanels(scriptJson, imagePathsJson, 0, 2).scriptJson)
      .panels as Array<{ scene: string }>;
    expect(forward.map((p) => p.scene)).toEqual(["s2", "s3", "s1", "s4"]);
    const backward = JSON.parse(reorderPanels(scriptJson, imagePathsJson, 3, 0).scriptJson)
      .panels as Array<{ scene: string }>;
    expect(backward.map((p) => p.scene)).toEqual(["s4", "s1", "s2", "s3"]);
  });

  it("from 与 to 相同：原样返回，不改动字符串", () => {
    const r = reorderPanels(scriptJson, imagePathsJson, 1, 1);
    expect(r.scriptJson).toBe(scriptJson);
    expect(r.imagePathsJson).toBe(imagePathsJson);
  });

  it("imagePathsJson 为 null 时保持 null，仅剧本重排", () => {
    const r = reorderPanels(scriptJson, null, 0, 1);
    expect(r.imagePathsJson).toBeNull();
    expect(
      (JSON.parse(r.scriptJson).panels as Array<{ scene: string }>).map((p) => p.scene),
    ).toEqual(["s2", "s1", "s3", "s4"]);
  });

  it("下标越界抛错", () => {
    expect(() => reorderPanels(scriptJson, imagePathsJson, -1, 0)).toThrow(/越界/);
    expect(() => reorderPanels(scriptJson, imagePathsJson, 0, 4)).toThrow(/越界/);
  });
});
