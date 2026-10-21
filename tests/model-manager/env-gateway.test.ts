import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertProfileCapabilities,
  clearModelFallbackState,
  getModelChain,
  resolveModelProfile,
  resolveModelRef,
} from "@/model-manager";
import { getEnvGatewayConfig } from "@/model-manager/catalog/gateways";
import type { ModelCapabilities, ModelProfile } from "@/model-manager/catalog/types";
import type { UnifiedChatRequest } from "@/model-manager/request/types";

const ENV_KEYS = [
  "MODEL_MAIN_PRIMARY",
  "MODEL_MAIN_LIGHT_PRIMARY",
  "MODEL_VISION_PRIMARY",
  "MODEL_MAIN_BASE_URL",
  "MODEL_MAIN_API_KEY",
  "MODEL_MAIN_LIGHT_BASE_URL",
  "MODEL_MAIN_LIGHT_API_KEY",
  "MODEL_VISION_BASE_URL",
  "MODEL_VISION_API_KEY",
  "MODEL_IMAGE_API_BASE_URL",
  "MODEL_IMAGE_API_IMAGE_PROTOCOL",
  "MODEL_BASE_URL",
  "MODEL_API_KEY",
] as const;

describe("model-manager 域级端点与域主模型", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    clearModelFallbackState();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    clearModelFallbackState();
  });

  describe("getEnvGatewayConfig", () => {
    it("域级优先于全局，key 缺省回落全局再占位", () => {
      process.env.MODEL_BASE_URL = "https://global.test/v1";
      process.env.MODEL_API_KEY = "gk";
      process.env.MODEL_VISION_BASE_URL = "https://vision.test/v1";

      const vision = getEnvGatewayConfig("vision");
      expect(vision?.baseUrl).toBe("https://vision.test/v1");
      expect(vision?.apiKey).toBe("gk");

      const main = getEnvGatewayConfig("main");
      expect(main?.baseUrl).toBe("https://global.test/v1");
    });

    it("只配全局时 apiKey 占位 env；都未配置返回 null", () => {
      expect(getEnvGatewayConfig("mainLight")).toBeNull();
      process.env.MODEL_BASE_URL = "https://global.test/v1";
      expect(getEnvGatewayConfig("main")?.apiKey).toBe("env");
      expect(getEnvGatewayConfig("imageApi")?.kind).toBe("image");
      expect(getEnvGatewayConfig("mainLight")?.baseUrl).toBe("https://global.test/v1");
    });

    it("生图协议：缺省 openai，仅 si-image 切换（大小写不敏感）", () => {
      process.env.MODEL_BASE_URL = "https://global.test/v1";
      expect(getEnvGatewayConfig("imageApi")?.imageProtocol).toBe("openai");
      process.env.MODEL_IMAGE_API_IMAGE_PROTOCOL = "SI-Image";
      expect(getEnvGatewayConfig("imageApi")?.imageProtocol).toBe("si-image");
    });
  });

  describe("resolveModelRef", () => {
    it("只接受业务域前缀，未知前缀报错并点名可用域", () => {
      expect(resolveModelRef("main/deepseek-chat").gateway).toBe("main");
      // modelId 自带斜杠（部分端点的模型名如此）
      expect(resolveModelRef("vision/deepseek/deepseek-flash").modelId).toBe(
        "deepseek/deepseek-flash",
      );
      expect(() => resolveModelRef("deepseek-official/x")).toThrow(/未知网关前缀/);
      expect(() => resolveModelRef("deepseek-official/x")).toThrow(
        /main\|mainLight\|vision\|imageApi/,
      );
    });
  });

  describe("域主模型解析", () => {
    it("裸 modelId PRIMARY + 域级端点 → 绑定本域", () => {
      process.env.MODEL_MAIN_BASE_URL = "https://api.deepseek.test/v1";
      process.env.MODEL_MAIN_API_KEY = "sk";
      process.env.MODEL_MAIN_PRIMARY = "deepseek-chat";

      expect(getModelChain("main")).toEqual(["main/deepseek-chat"]);
    });

    it("裸 modelId PRIMARY 无端点 → 报错并提示变量名", () => {
      process.env.MODEL_MAIN_PRIMARY = "deepseek-chat";
      expect(() => getModelChain("main")).toThrow(/MODEL_MAIN_BASE_URL/);
    });
  });

  describe("调用前能力校验", () => {
    const ref = resolveModelRef("main/glm-5.3");
    const profile = (capabilities?: ModelCapabilities): ModelProfile => ({
      match: { gateway: "main", modelIdPrefix: "glm-" },
      extensionKey: "test",
      extensionSchema: { type: "object", properties: {}, additionalProperties: false },
      fieldMap: [],
      capabilities,
    });
    const imageReq: UnifiedChatRequest = {
      messages: [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: "data:image/png;base64,xxx" } }],
        },
      ],
    };
    const jsonReq: UnifiedChatRequest = {
      messages: [{ role: "user", content: "hi" }],
      responseFormat: { type: "json_object" },
    };

    it("profile 声明 vision:false → 图文请求判能力不匹配", () => {
      expect(() => assertProfileCapabilities(ref, profile({ vision: false }), imageReq)).toThrow(
        /不具备必需能力 vision/,
      );
    });

    it("profile 声明 jsonMode:false → JSON 请求判能力不匹配", () => {
      expect(() => assertProfileCapabilities(ref, profile({ jsonMode: false }), jsonReq)).toThrow(
        /不具备必需能力 jsonMode/,
      );
    });

    it("未声明 capabilities 不过滤（未知模型不误杀）", () => {
      expect(() => assertProfileCapabilities(ref, profile(), imageReq)).not.toThrow();
    });
  });

  describe("profile 标准兜底", () => {
    it("profile 表为空 → 任意模型走 standardProfile（标准映射，无 capabilities）", () => {
      const p = resolveModelProfile({ gateway: "main", modelId: "deepseek-chat" });
      expect(p.extensionKey).toBe("standard");
      expect(p.capabilities).toBeUndefined();
    });
  });
});
