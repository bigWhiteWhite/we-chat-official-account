import { describe, expect, it } from "vitest";
import { API_TYPE_OPTIONS, PROVIDER_PRESETS, inferProviderId } from "@/lib/provider-presets";

describe("provider-presets", () => {
  it("API_TYPE_OPTIONS 仅含 chat / responses 两项", () => {
    expect(API_TYPE_OPTIONS.map((o) => o.value).sort()).toEqual(["chat", "responses"]);
    for (const o of API_TYPE_OPTIONS) {
      expect(o.label).toBeTruthy();
    }
  });

  it("每个预设字段完整（custom 允许空 knownModels）", () => {
    for (const p of PROVIDER_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(["chat", "image", "both"]).toContain(p.kind);
      expect(p.defaultBaseUrl).toMatch(/^https:\/\//);
      expect(p.auth).toBe("required");
      if (p.id !== "custom") {
        expect(p.knownModels.length).toBeGreaterThan(0);
      }
    }
  });

  it("inferProviderId：精确匹配（忽略尾部斜杠），不匹配返回 custom", () => {
    expect(inferProviderId("https://api.deepseek.com/v1")).toBe("deepseek");
    expect(inferProviderId("https://api.deepseek.com/v1/")).toBe("deepseek");
    expect(inferProviderId("https://api.openai.com/v1")).toBe("openai");
    expect(inferProviderId("https://my-company-llm.internal/v1")).toBe("custom");
    expect(inferProviderId("")).toBe("custom");
  });
});
