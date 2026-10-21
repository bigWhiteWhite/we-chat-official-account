import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const optionalNonPlaceholder = (name: string) =>
  z
    .string()
    .optional()
    .refine((v) => v === undefined || !/^your[-_]|^xxx|^placeholder/i.test(v), {
      message: `${name} 是占位符，请在设置页或 .env 填写真实值`,
    });

const numInt = (def: number) => z.coerce.number().int().default(def);

const bool = (def: boolean) =>
  z
    .enum(["true", "false", "1", "0", "yes", "no"])
    .default(def ? "true" : "false")
    .transform((v) => v === "true" || v === "1" || v === "yes");

export const serverEnv = createEnv({
  server: {
    APPID: optionalNonPlaceholder("APPID"),
    APPSECRET: optionalNonPlaceholder("APPSECRET"),
    AUTHOR: optionalNonPlaceholder("AUTHOR"),
    COMICS_DIR: z.string().default("./comics"),
    INBOX_DIR: z.string().default("./inbox"),
    TOPIC_SOURCES: z.string().default("self-made"),
    PANELS_MAX_PER_CHAPTER: numInt(40),
    STYLE_PRESET: z.string().default("简约线条+低饱和色块+扁平卡通"),
    NARRATION_IN_IMAGE: bool(false),
    DAILY_BUDGET_CNY: numInt(10),
    MAX_IMAGE_PER_TASK: numInt(12),
    IMAGE_GEN_CONCURRENCY: numInt(2),
    DB_FILE: z.string().default("./data/comics.db"),
    MODEL_MAIN_PRIMARY: z.string().optional(),
    MODEL_MAIN_LIGHT_PRIMARY: z.string().optional(),
    MODEL_VISION_PRIMARY: z.string().optional(),
    MODEL_IMAGE_API_PRIMARY: z.string().optional(),
    MODEL_AUTO_FALLBACK: z.string().optional(),
    MODEL_HEALTH_TIMEOUT_MS: z.string().optional(),
    MODEL_FALLBACK_COOLDOWN_MS: z.string().optional(),
    // 域级端点（接新厂商只改配置：MODEL_<域>_PRIMARY 写裸 modelId）
    MODEL_BASE_URL: z.string().optional(),
    MODEL_API_KEY: z.string().optional(),
    MODEL_MAIN_BASE_URL: z.string().optional(),
    MODEL_MAIN_API_KEY: z.string().optional(),
    MODEL_MAIN_LIGHT_BASE_URL: z.string().optional(),
    MODEL_MAIN_LIGHT_API_KEY: z.string().optional(),
    MODEL_VISION_BASE_URL: z.string().optional(),
    MODEL_VISION_API_KEY: z.string().optional(),
    MODEL_IMAGE_API_BASE_URL: z.string().optional(),
    MODEL_IMAGE_API_API_KEY: z.string().optional(),
  },
  // Next.js >= 13.4.4 推荐路径：experimental__runtimeEnv 传入 process.env，
  // 运行时为 {...process.env} 浅拷贝（不会像直接传 runtimeEnv 那样原地删改 process.env），
  // 且类型层面对 server 段宽松，无需对 ProcessEnv 做强转。
  experimental__runtimeEnv: process.env,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
  emptyStringAsUndefined: true,
  onValidationError: (issues) => {
    const names = [
      ...new Set(
        issues.flatMap((issue) =>
          (issue.path ?? []).filter((p): p is string => typeof p === "string"),
        ),
      ),
    ].join(", ");
    throw new Error(`Invalid environment variables: ${names}`);
  },
});

export const env = serverEnv;
