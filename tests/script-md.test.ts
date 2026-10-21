import { describe, expect, it } from "vitest";

import { parseScriptMarkdown, parseScriptOutput } from "@/pipeline/script-md";
import { ComicScriptSchema } from "@/pipeline/schema";

const MD = `标题：今天的KPI
主题：职场
爆点：KPI完成！
风险：无

第1格
画面：办公室发呆
角色：打工仔
台词：老板说要突破

第2格
画面：深夜加班
角色：打工仔
台词：我真的突破了

第3格
画面：医生举病历
角色：医生
台词：突破性进展：住院

第4格
画面：病床竖拇指
角色：打工仔
台词：KPI完成！
`;

const JSON_OUT =
  "好的，剧本如下：\n```json\n" +
  JSON.stringify({
    title: "标题A",
    theme: "职场",
    target_panels: 4,
    panels: [
      { scene: "s1", character: "c1", dialogue: "d1" },
      { scene: "s2", character: "c1", dialogue: "d2" },
      { scene: "s3", character: "c2", dialogue: "d3" },
      { scene: "s4", character: "c1", dialogue: "d4" },
    ],
    punchline: "爆点A",
    risk_tags: [],
  }) +
  "\n```";

describe("parseScriptMarkdown", () => {
  it("解析标准模板（全角冒号）", () => {
    const parsed = parseScriptMarkdown(MD);
    expect(parsed.title).toBe("今天的KPI");
    expect(parsed.theme).toBe("职场");
    expect(parsed.punchline).toBe("KPI完成！");
    expect(parsed.panels).toHaveLength(4);
    expect(parsed.panels[0]).toEqual({
      scene: "办公室发呆",
      character: "打工仔",
      dialogue: "老板说要突破",
      narration: "",
    });
    expect(parsed.risk_tags).toEqual([]);
    expect(parsed.target_panels).toBe(4);
  });

  it("兼容半角冒号与 markdown 标题前缀", () => {
    const md = MD.replace(/：/g, ":").replace(/^第(\d)格$/gm, (m, n) => `## 第${n}格`);
    const parsed = parseScriptMarkdown(md);
    expect(parsed.title).toBe("今天的KPI");
    expect(parsed.panels).toHaveLength(4);
  });

  it("风险标签拆分（逗号/顿号/分号）", () => {
    const parsed = parseScriptMarkdown(MD.replace("风险：无", "风险：医疗、低俗; 引战"));
    expect(parsed.risk_tags).toEqual(["医疗", "低俗", "引战"]);
  });

  it("少于 4 格抛错", () => {
    const cut = MD.slice(0, MD.indexOf("第3格"));
    expect(() => parseScriptMarkdown(cut)).toThrow(/分格不足/);
  });

  it("缺少标题时回退到主题，不抛错", () => {
    const parsed = parseScriptMarkdown(MD.replace("标题：今天的KPI\n", ""));
    expect(parsed.title).toBe("职场");
    expect(parsed.punchline).toBe("KPI完成！");
  });

  it("缺少爆点时 punchline 为空，不抛错", () => {
    const parsed = parseScriptMarkdown(MD.replace("爆点：KPI完成！\n", ""));
    expect(parsed.title).toBe("今天的KPI");
    expect(parsed.punchline).toBe("");
  });

  it("标题兼容无冒号与英文别名", () => {
    const parsed = parseScriptMarkdown(MD.replace("标题：今天的KPI", "Title 今天的KPI"));
    expect(parsed.title).toBe("今天的KPI");
  });

  it("爆点兼容「金句」别名", () => {
    const parsed = parseScriptMarkdown(MD.replace("爆点：KPI完成！", "金句：KPI完成！"));
    expect(parsed.punchline).toBe("KPI完成！");
  });

  it("解析导语与每格说明（科普类）", () => {
    const md = `标题：古代相亲
主题：科普
导语：古人相亲讲究父母之命与媒妁之言。
爆点：八字不合就散
风险：无

第1格
画面：媒婆上门
角色：媒婆
台词：你家小子可中意
说明：古人相亲先看八字再看门第。

第2格
画面：八字合婚
角色：媒婆
台词：八字可合
说明：合婚是媒婆的核心技能。

第3格
画面：对镜梳妆
角色：姑娘
台词：也不知对面是谁
说明：相亲双方往往互不相见。

第4格
画面：拜堂成亲
角色：全家
台词：百年好合
`;
    const parsed = parseScriptMarkdown(md);
    expect(parsed.intro).toBe("古人相亲讲究父母之命与媒妁之言。");
    expect(parsed.panels[0].narration).toBe("古人相亲先看八字再看门第。");
    expect(parsed.panels[1].narration).toBe("合婚是媒婆的核心技能。");
    expect(parsed.panels[3].narration).toBe("");
  });
});

describe("parseScriptOutput", () => {
  it("JSON 输出回退解析（含围栏与前后杂散文本）", () => {
    const s = parseScriptOutput(JSON_OUT, "self-made");
    expect(s.title).toBe("标题A");
    expect(s.source).toBe("self-made");
    expect(s.panels).toHaveLength(4);
  });

  it("Markdown 输出经 schema 校验与 clamp", () => {
    const long = MD.replace("标题：今天的KPI", `标题：${"长".repeat(40)}`);
    const s = parseScriptOutput(long, "user-outline");
    expect(s.title.length).toBe(32);
    expect(s.source).toBe("user-outline");
    expect(s.source_url).toBe("");
    expect(ComicScriptSchema.safeParse(s).success).toBe(true);
  });

  it("乱码输出抛错", () => {
    expect(() => parseScriptOutput("你好，我是AI，以下是思考过程……", "self-made")).toThrow();
  });
});
