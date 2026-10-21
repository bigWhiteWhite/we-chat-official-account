# AGENTS.md

## 项目简介

微信公众号 AI 漫画自动生产系统（MVP）。LLM 自创选题 → 剧本 → 主体确认 → 分格生图 → 人工审核 → 微信草稿箱。自动化终点是公众号草稿箱，文章发表需人工操作。

## 技术栈

- **框架**: Next.js 15 (App Router) + React 19 + TypeScript
- **数据库**: SQLite via Prisma 7 + `@prisma/adapter-libsql`（无需安装 SQLite）
- **包管理**: pnpm
- **前端状态/数据**: TanStack Query (轮询/SSE) + TanStack Table + TanStack Form (表单) + Zustand (UI 状态)
- **UI 组件**: shadcn/ui + Tailwind CSS v4
- **测试**: Vitest（`tests/` 目录，node 环境）
- **Lint / 格式化**: oxlint + oxfmt

## 常用命令

| 用途                             | 命令                                |
| -------------------------------- | ----------------------------------- |
| 安装依赖（自动 prisma generate） | `pnpm install`                      |
| 建表 / 同步 schema               | `pnpm db:push`                      |
| 灌预设内容标签（幂等）           | `pnpm db:seed`                      |
| 开发                             | `pnpm dev`（http://localhost:3000） |
| 构建                             | `pnpm build`                        |
| 测试                             | `pnpm test`                         |
| Lint                             | `pnpm lint`                         |
| 格式化                           | `pnpm format`                       |
| 格式化检查（CI 用）              | `pnpm format:check`                 |
| 检查图片模型可用性               | `pnpm check:image`                  |

## 环境配置

1. `cp .env.example .env`，在 `/settings` 页或 `.env` 填 `APPID` / `APPSECRET` / `AUTHOR` 与至少一个模型端点 Key。
2. 每域只有一个主模型：缺 Key、缺配置或能力不匹配时该域调用直接报中文错误并点名要改的变量，**不会自动换模型或重试同一模型**；换模型改 `/settings` 页或 `.env` 的 `MODEL_<域>_PRIMARY` 即可。
3. `DB_FILE` 默认 `./data/comics.db`；`prisma.config.ts` 自动加载 `.env`。
4. 本机公网 IP 必须加入微信公众号 IP 白名单。
5. **`.env` 含真实密钥，严禁提交。** `.env.example` 只保留占位符。
6. 接新厂商（OpenAI 兼容）不改代码：`.env` 配 `MODEL_<域>_BASE_URL` / `MODEL_<域>_API_KEY`（域级，缺省回落全局 `MODEL_BASE_URL` / `MODEL_API_KEY`）+ `MODEL_<域>_PRIMARY` 用裸 modelId；端点解析见 `src/model-manager/catalog/gateways.ts`（网关 id 即业务域名，无内置厂商表）。私有生图端点（TokenHub / 混元）再加 `MODEL_IMAGE_API_IMAGE_PROTOCOL=si-image`。
7. 模型与业务配置除 `.env` 外可在前端 `/settings` 页维护（存 `AppSetting` 表），**优先级高于 `.env`**，保存即时生效（model-manager 与业务 getter 读 `envOrSetting`：DB 覆盖 → env 回落 → 默认值）。
8. 启动校验已放宽：`APPID` / `APPSECRET` / `AUTHOR` 为可选项（空 `.env` 也能启动），占位符仍拒绝；缺失时相关功能（微信发布 / token）在运行时报中文提示而非启动崩溃。

## 目录结构与职责

```
src/
  app/
    api/            # Next.js 薄壳路由——只做参数校验、SSE 建连、调 pipeline，不含业务逻辑（示例列表，非全量）
    assets/         # 资产库页面
    series/         # 系列管理页面
    settings/       # 设置页（模型配置 / 业务设置）
    tags/           # 标签库页面
    tasks/          # 任务详情页
    page.tsx        # 首页（搜索列表）
  components/
    ui/             # shadcn/ui 基础组件
    workflow/       # 六步向导组件（step-script / step-subjects / step-images / step-review / step-publish 等）
    assets/         # 资产库组件
    series/         # 系列管理组件
    settings/       # 设置页组件（model-domain-card / global-card / business-card）
    tags/           # 标签库组件（tag-library 管理页 / tag-select 可筛选多选下拉）
    tree-select.tsx # 通用下拉选择：顶部搜索 + 树形/列表切换（资产选择统一使用）
  pipeline/         # 核心业务层——状态机纯函数，不依赖 Next.js
    prompts/          # LLM 提示词集中管理：纯文本 + 纯组装函数，按业务域分文件（writer/panel/subjects/series/topic/digest，另含跨域纯函数 tags.ts），只许 import schema、themes 与 type-only 类型
    topic.ts          # 选题（LLM 调用编排）
    writer.ts         # 剧本生成（SSE 流式，LLM 调用编排）
    subjects.ts       # 主体绑定 / 参考集构建 / 匹配结果清洗
    subject-bind.ts   # 解析 referencePathsJson → 参考图列表
    subject-extend.ts # 基于已有主体扩展新主体
    artist.ts         # 分格图生成（drawPanels）与主体预览图编排
    panel-versions.ts # 分格图版本化纯函数（文件名解析/下一版本名/版本文件合法性校验）
    publisher.ts      # 微信草稿箱发布
    weixin/           # 微信 API 封装（token / media / draft）
    script-md.ts      # 剧本 Markdown 解析（输出模板在 prompts/writer.ts，两者格式须同步）
    schema.ts         # ComicScript 等 Zod schema 与剧本纯函数（clampScript/splitNames/uniqueCast/sceneName）
  model-manager/    # 模型注入层——域端点解析 + 域主模型解析 + 失败分类
    catalog/          # gateways.ts 域端点解析（BIZ_ENV_INFIX → MODEL_<域>_BASE_URL/API_KEY）、profiles/（仅 standard 兜底，厂商 profile 表当前为空）
    providers/        # openai-compat.ts 单一 OpenAI 兼容工厂（标准映射，无厂商怪癖开关）
    fallback.ts       # 失败分类与重试策略（classifyFailure / 冷却缓存；多候选循环保留，当前每域仅一个模型）
    resolve.ts        # 模型解析（域/modelId，运行时域名校验）
    registry.ts       # 域主模型解析：MODEL_<域>_PRIMARY（每域一个；裸 modelId 绑本域端点，域/modelId 可借用别的域端点）
  lib/
    db.ts             # Prisma 单例（按 DB_FILE 重建）
    sse.ts            # SSE 发送/解析
    task-events.ts    # 事件落库
    task-query.ts     # 搜索 where 构建
    assets.ts         # 资产库服务（CRUD + 图片读写）
    api.ts            # 前端 API 客户端
    inflight.ts       # 任务并发锁（防重复触发）
    settings-store.ts    # AppSetting 表读写 + 进程内缓存（DB 覆盖 → env 回落）
    settings-payload.ts  # 设置页读/写 payload 组装（密钥掩码）
    provider-presets.ts  # 供应商预设与 API 类型（纯数据，前端/后端共用）
    preset-tags.ts    # 预设内容标签（纯数据 + missingPresetTags 纯函数，供 db:seed 灌库）
    business-settings.ts # 业务字段 getter（envOrSetting：DB 覆盖 → env → 默认值）
  env.ts              # 环境变量校验（@t3-oss/env-nextjs）
  store/ui.ts         # Zustand UI 状态

tests/                # Vitest 测试（与 src 同级）
  helpers/test-db.ts  # 临时 SQLite 工具（setupTempDb / cleanup）
scripts/              # tsx 直跑的 CLI 脚本
  db-seed.ts          # 预设标签灌库（只写 Tag 表；幂等，同名跳过，不碰 AppSetting/图片）
  check-image-models.ts # 生图模型可用性探测（pnpm check:image）
  fill-tag-descriptions.ts # 用 mainLight 批量补齐标签说明书
  migrate-variants.ts # 旧资产 → 形象变体模型的一次性迁移
docs/               # 本地设计与实现文档（.gitignore 排除，不入库）
  superpowers/specs/  # 设计文档
  superpowers/plans/  # 实现计划
data/
  assets/<type>/      # 图片资产（character / scene / style）
  images/<taskId>/    # 生成的分格图
  comics.db           # SQLite 数据库
```

## 核心架构约定

### 1. Pipeline 纯函数 vs API 薄壳

- `src/pipeline/` 里的函数是纯业务逻辑，不 import Next.js / React，可以单独在 Vitest 里测试。
- `src/app/api/` 里的 route handler 是薄壳：参数解析 → 调 pipeline → SSE / JSON 响应，不在路由里写业务 if-else。
- 新增业务逻辑一律放 `src/pipeline/`，不要塞进 route 文件。

### 1.1 LLM 提示词集中在 pipeline/prompts/

- 所有发给 LLM 的提示词（system 人设、模板、组装函数）一律放 `src/pipeline/prompts/`，按业务域分文件：writer（剧本）/ panel（单格生图）/ subjects（主体匹配/扩展/参考图）/ series（连载上下文）/ topic（选题）/ digest（本集简介）；tags.ts 为跨域纯组装（内容标签段落格式化，writer 与 topic 共用）。
- prompts/ 内只允许纯函数与纯文本，禁止 import db / model-manager / env / node:*（schema、themes、type-only 类型除外），保证前端组件也能直接复用（如 `buildPanelPrompt` 被前端弹窗兜底引用）。
- env 相关取值（如 `STYLE_PRESET` / `NARRATION_IN_IMAGE`）由调用方显式传参，不在提示词模块内取默认值。

### 2. 模型调用必须走 model-manager

- **禁止**在 pipeline 或 route 里直接拼 fetch 调模型 API。
- 通过 model-manager 的 `withModelFallback` / `getGatewayHttpConfig` 获取 HTTP 配置。
- **每个业务域只有一个主模型** `MODEL_<域>_PRIMARY`（/settings 页或 `.env`，无内置兜底池、无候选列表）；未配置或不可解析时调用报错并提示变量名，换模型就改这一项。
- 对话端点走 OpenAI 兼容协议，接新厂商不改代码也不加配置项：只改 `MODEL_<域>_BASE_URL` / `MODEL_<域>_API_KEY` 与 `MODEL_<域>_PRIMARY`（裸 modelId）。生图域额外有协议开关 `MODEL_<域>_IMAGE_PROTOCOL`（见下条）。
- 厂商非标参数才需要 profile（`catalog/profiles/`，纯数据，按 `match.gateway` = 业务域名匹配）；当前 profile 表为空，未命中一律走 standardProfile 标准映射。调用前按请求形态做能力校验（`image_url`→vision、json responseFormat→jsonMode），profile 显式 `false` 时报能力不匹配错误（不发请求，需更换该域主模型）。
- 生图不走 chat transform 管线：`pipeline/artist.ts` 按 imageApi 域的 `imageProtocol` 选协议——`openai`（默认）文生图 `/images/generations` + 图生图 `/images/edits`（multipart 多图）；`si-image` 走 TokenHub / 混元私有 `/wand/si-image/generation`（JSON，参考图 `data:image/png;base64,…` 最多 10 张，响应回 `url` 再下载）。协议在 /settings 页生图卡下拉切换。

### 3. 数据访问统一走 Prisma 单例

- 导入 `import { db } from "@/lib/db"`，不要在业务代码里 `new PrismaClient()`。
- Schema 变更后跑 `pnpm db:push`（MVP 阶段不用 migrate）。

### 4. SSE 流式

- 剧本生成、主体匹配、分格图生成均使用 SSE。
- 发送端用 `src/lib/sse.ts` 的 `createSseStream`；前端用 `src/lib/use-ai-stream.ts` 消费。

### 5. 任务并发锁

- 涉及"生成"类操作（剧本 / 图 / 发布）必须先检查在途锁，成功后 `registerRun`，完成/异常后 `unregisterRun`，防止同一任务并发重复触发。
- 锁粒度（`src/lib/inflight.ts`）：主流程（剧本/批量生图）以 `taskId` 为 key；单格重生成以 `panelRunKey(taskId, index)` 为 key，**多格可并行、同格互斥**。剧本/批量生图入口用 `hasAnyRun(taskId)` 做任务级互斥（任一单格在途也拒绝）；`runningPanelIndexes(taskId)` 供任务详情返回 `generatingPanels`，前端据此对单个格子显示"生成中"遮罩；`abortRun(taskId)` 同时中断主流程与全部在途单格。
- 并行单格重生成共用 `imagePathsJson` 字段：落库统一走 `panels.ts` 的 `savePanelImage`（进程内串行链，重读最新值后写入，防互相覆盖）。

### 6. UI 组件一律优先使用 shadcn（最高优先级规则）

- 通用 UI 元素（按钮、对话框、下拉、复选框、徽标、标签页、分页、分隔线、骨架屏、Tooltip、表单字段等）**一律优先使用 `src/components/ui/` 下的 shadcn 组件**，不要用手写原生 HTML 元素替代。
- 需要但 `src/components/ui/` 中还没有的 shadcn 组件，先用 `pnpm shadcn add <组件名>` 拉取再使用，**不要自己仿写一个原生版本**。
- shadcn 已配置：style `radix-nova`、图标用 `lucide-react`、别名 `@/components/ui`、`cn()` 来自 `@/lib/utils`。
- **例外**：项目已固定的第三方组件库按既有选型使用，不再另起炉灶——表格用 TanStack Table、拖拽用 dnd-kit、命令面板用 cmdk、日期用 react-day-picker、图片预览用 react-photo-view。
- 表格/列表内的图片缩略图（参考图、样图）圆角用小圆角（如 `rounded-sm`），**不要用 `rounded` / `rounded-full` 等大圆角**。
- 仅当上述均无对应组件、或有特殊交互/性能要求时，才允许直接使用原生元素，并在代码注释里说明原因。
- 样式统一用 Tailwind CSS v4 + `cn()`，跟随 shadcn 设计 token（base color `neutral`）；**不用 CSS Modules、内联 style，也不新增其他 UI 组件库**。

### 7. 表单统一使用 @tanstack/react-form

- 所有表单（新建/编辑弹窗、批量生产、外观编辑等）统一用 `useForm` 声明状态，字段用 `<form.Field>` 渲染，提交按钮用 `<form.Subscribe>` 订阅 `isSubmitting` 与必填校验，提交走 `form.handleSubmit()`。
- 复杂嵌套子状态（形象变体列表、按合集归组选择等）可保留组件 state，不强行塞进表单字段。
- 资产类下拉选择统一复用 `src/components/tree-select.tsx`（顶部搜索 + 树形/列表切换，单选/多选两用，多选触发器平铺已选胶囊），不要另写手写下拉。
- 内容标签选择统一复用 `src/components/tags/tag-select.tsx`（Popover + Command 多选：搜索命中名称与说明、勾选不关面板、`max` 上限禁用未选项），不要再用平铺胶囊铺全量标签。

## 漫画一致性机制（核心设计）

一致性拆成三个独立问题，统一沉淀为可复用「主体」（Asset）：

| 维度         | 机制                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| **角色身份** | 主体库（Asset type=character）存角色参考图；`referencePathsJson` 记录角色→图片映射；生图时按格取对应角色图作为参考          |
| **场景**     | 主体库（type=scene）存场景参考图；同上机制（主场景不再单独文生图，参考图仅来自绑定资产/其画风变体，未绑定则不传场景参考图） |
| **画风**     | 主体库（type=style）存画风样图；优先级：库内 preset > `.env` 的 `STYLE_PRESET`                                              |

关键函数：

- `buildPanelRefs(script, refs, panelIndex)` — 按格出场角色/场景动态组装参考图列表
- `parseTaskReferences(referencePathsJson)` — 解析新旧两种格式（旧格式兼容只读）
- `stylePresetFor(refs, envPreset)` — 解析画风优先级

**生图流程**：确认主体 → 参考图写入 `task.referencePathsJson` → 每格调 `buildPanelRefs` 取该格角色图 + 主场景图（绑定了场景资产时才有）+ 画风样图 → 以图生图并行生成（`p-limit` 并发）。主场景不单独文生图（见上表「场景」行）。

## 代码风格

- TypeScript strict mode；Zod 做运行时校验（API 入参、LLM 输出解析）。
- 路径别名 `@/` 指向 `src/`。
- 使用函数式组件 + hooks，不使用 class 组件。
- 新写 UI 前先查 `src/components/ui/` 是否有现成 shadcn 组件，有则直接复用，不重复造轮子（详见「核心架构约定 §6」）。
- 状态管理优先级：组件内 state → Zustand（跨组件 UI 状态）→ TanStack Query（服务端状态）。
- 错误处理：pipeline 层 `throw Error`，route 层返回 `{ error: msg }` 与适当 HTTP status。
- 日志：`pino` 用于 route 层/后台脚本；pipeline 层通过 `emit` 写 `TaskEvent` 表。
- 不要添加 copyright / license header。
- 不要添加非必要注释；已有项目注释使用中文，新增注释也应保持中文。
- `cursor-pointer` 可点击的交互元素（按钮、图标、图片预览、弹窗遮罩层等）必须加 `cursor-pointer`，确保鼠标悬停时有手型反馈。`PreviewImage` 组件默认自带 `cursor-pointer`，使用时无需重复添加。

## 测试

- 测试文件放 `tests/`，命名为 `<模块名>.test.ts`。
- 涉及数据库的测试使用 `tests/helpers/test-db.ts` 的 `setupTempDb()` 创建临时 SQLite，并在 `afterAll` 中 `cleanup()`。
- 测试中使用 `import ... from "@/..."` 路径别名（Vitest 已配置 alias）。
- pipeline 纯函数可直接 import 测试，不需要 mock Next.js。

## 前端页面路由

| 路径          | 说明                       |
| ------------- | -------------------------- |
| `/`           | 任务搜索列表               |
| `/tasks/:id`  | 任务详情（剧本/分图/日志） |
| `/assets`     | 主体资产库                 |
| `/series`     | 系列列表                   |
| `/series/:id` | 系列详情                   |
| `/tags`       | 标签库（内容标签管理）     |
| `/settings`   | 设置（模型配置/业务设置）  |

## 发布流程边界

- 系统自动发布到**微信草稿箱**（`/api/tasks/:id/publish`），展示微信原始 `errcode`/`errmsg`。
- 发布内容采用**默认排版**：全部分格按序 + 剧本标题 + 系统默认作者 + 首图封面（自定义草稿编辑已移除，不再可编辑）。
- 文章从草稿箱到正式发表，需要登录公众号后台人工操作。

## 注意事项

- **Prisma 7**：连接 URL 由 `prisma.config.ts` 与 driver adapter 提供，不是传统 `datasource url = env(...)` 写法。
- **自定义草稿功能已移除**：发布固定用默认排版；原 `draftTitle`/`draftIntro`/`draftDigest`/`draftAuthor`/`draftCoverPath`/`draftBodyJson` 字段、`/api/tasks/:id/draft` 接口与草稿编辑器组件均已删除，DB 列已 drop。注意区分 `draftMediaId`（微信草稿 media_id，用于发布去重），它仍然保留。
- **旧任务兼容**：`referencePathsJson` 存在旧格式（扁平 `{character, scene}`），解析时走 `parseTaskReferences` 的兼容分支，只读展示，不参与新的按格匹配逻辑。
- **内容标签替代题材方向/类别**：`Tag` 表（name 唯一 + description 即 LLM 行为说明书），`TaskTag` / `SeriesTag` 多对多（级联删除）；旧 `themeText`/`categoryText` 列已 drop，21 项预设迁移为 Tag 行。标签说明注入 `buildTopicPrompt` / `buildCreatePrompt`（无标签时选题回落 `DEFAULT_THEME_HINT`）；合集标签在新建剧集时自动带入。任务/合集写接口用 `tagIds` 全量替换（同 `seriesIds` 模式）；任务列表标签列为 Popover 多选即时保存；`/tags` 页管理标签增删改（删除即级联解绑）。
- **任务-合集多对多归属**：`TaskSeriesLink` 表（taskId+seriesId 唯一，级联删除）；`Task.seriesId` 仍是主合集（集数编号 / carryContext 上下文 / 主体锁定 / 画风回落 / 每集摘要都按它算），其余归属仅作归档展示。任务列表合集列为 Popover 多选编辑（`PATCH /api/tasks/:id` 的 `seriesIds` 全量替换）；原主合集被取消勾选时自动顺延为勾选的第一个并清空 `episodeNo`。合集筛选「某合集」匹配主合集或归属（`buildTaskWhere`），「无合集」= 两者皆空；读取时主合集与 links 联合展示（存量数据无需回填），合集详情剧集列表同样按两者查询。
- **图片存储**：本地文件系统（`data/assets/` / `data/images/`），未接 OSS；路径写入 DB，读取时使用 `fs.readFile`。
- **分格图版本化**：分格图落盘为 `data/images/<taskId>/panel-NN.vN.png`（N 为第 N 次重生成，从 v1 起），旧的无版本名 `panel-NN.png` 视为「初始版本」(version 0)，不占 vN 序号。磁盘保留所有版本，`imagePathsJson[index]` 只存当前选中版本的路径（指针）。版本号由扫描目录取最大 vN+1 得到（`src/pipeline/panel-versions.ts`），不改 SQLite schema，天然自愈。`GET /api/tasks/:id/images/:index/versions` 列版本（升序、标记 `isActive`）；`POST` 同路由切换指针（复用 `savePanelImage` 串行链，`hasAnyRun` 时 409，非法/跨格路径 400）。前端 step-images 遮罩「版本」按钮打开 `PanelVersionDialog` 选图。
- **生图并发**：由 `IMAGE_GEN_CONCURRENCY` 控制（默认 2），通过 `p-limit` 实现。
- **断点续传**：分格图生成支持中断后补生成缺失格（检查 `imagePathsJson` 中已有图）。

## 本文件维护（AGENTS.md）

- **发生大的流程或架构变更时，必须同步更新本文件**，保证这里的约定与代码实际状态一致。至少包括以下情形：
  - pipeline 阶段增删/重排（选题/剧本/主体/生图/审核/发布）
  - 六步向导步骤或门控逻辑变化
  - 主体一致性机制变化（参考集组装、画风优先级、`referencePathsJson` 格式）
  - 新增/移除模型业务域或降级策略变化
  - Prisma schema 新增/删除数据表或字段
  - 主要页面路由或目录结构重组
  - 常用命令、构建/测试流程变化
- 更新时只改对应小节，不要整文件重写；改完后核对「目录结构与职责」「核心架构约定」两节是否仍与代码一致。
