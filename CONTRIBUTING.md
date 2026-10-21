# 参与贡献

欢迎提 PR。动手前请先读 [AGENTS.md](AGENTS.md)——里面有目录职责、分层约束（pipeline 纯函数 vs API 薄壳、提示词集中管理、模型调用必须走 model-manager）和代码风格约定，本文件的命令是它的摘要。

## 环境准备

```bash
cp .env.example .env   # 填 APPID / APPSECRET / AUTHOR 与至少一个模型端点
pnpm install           # postinstall 会自动 prisma generate
pnpm db:push           # 建表（SQLite 文件默认 data/comics.db，无需安装数据库）
pnpm db:seed           # 可选：灌入预设内容标签（幂等，见 README「快速开始」）
pnpm dev               # http://localhost:3000
```

模型和业务参数也可以启动后在前端 `/settings` 页维护；`AppSetting` 表的值**优先级高于 `.env`**。

## 提交前自检

```bash
pnpm exec tsc --noEmit   # 类型检查
pnpm lint                # oxlint（当前基线：0 errors）
pnpm test                # vitest，tests/ 下按模块名命名 *.test.ts
pnpm format:check        # oxfmt；要求 LF 检出（见下）
pnpm build               # Next.js 构建
```

- **换行符**：仓库用 `.gitattributes` 固定 LF。Windows 上若 `core.autocrlf=true`，工作副本会是 CRLF，
  `format:check` 会对全量文件报格式错（提交时 git 仍会归一化为 LF，不影响仓库）。本地想跑干净：
  `git config core.autocrlf input` 后重新检出。
- **涉及数据库的测试**用 `tests/helpers/test-db.ts` 的 `setupTempDb()` 建临时库，并在 `afterAll` 里 `cleanup()`。
- **预设标签数据**只改 `src/lib/preset-tags.ts`（纯数据 + `missingPresetTags` 纯函数），灌库逻辑在 `scripts/db-seed.ts`；
  `tests/preset-tags.test.ts` 守的是「注入 prompt 的库内数据」不变量（单行、不超长、基调不被统一写成搞笑向）。
  预设里不要放真实作品的合集名/角色名，标签说明也别假设所有题材都要好笑。
- **UI**：通用元素一律用 `src/components/ui/` 下的 shadcn 组件（缺的先 `pnpm shadcn add`，不要手写仿制）；
  资产下拉复用 `src/components/tree-select.tsx`，内容标签复用 `src/components/tags/tag-select.tsx`；
  可点击元素需要 `cursor-pointer`。状态优先级：组件内 state → Zustand → TanStack Query。
- **注释**默认不写；确需说明「为什么」时用中文。不要加 copyright / license 头。
- schema 变更后同步更新 `AGENTS.md`（架构/目录/命令有变化时也必须同步）。

## 议题与 PR

- 提交前先跑一遍上面的自检；PR 描述里说明动机、影响的流程与验证方式（截图/录屏对 UI 改动很有用）。
- 本项目定位是**本地单用户工具**（无鉴权、无多用户模型），需要服务端鉴权/多租户的改动建议先开 issue 讨论。
- 微信公众号内容规范与模型计费由使用者自行把握，见 README「安全与部署边界」。

## 许可

提交 PR 即表示同意你的贡献以 MIT 许可证许可（见 [LICENSE](LICENSE)）。
