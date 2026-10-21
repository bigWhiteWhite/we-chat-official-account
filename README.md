# 微信公众号 AI 漫画自动生产系统（MVP）

LLM 自创选题 → 剧本 → 主体确认 → 分格生图 → 人工审核 → 微信草稿箱 的 MVP 全链路。
**自动化终点 = 公众号草稿箱**，文章从草稿箱到正式发表需登录公众号后台人工操作。

控制台采用「**搜索列表 + 六步交互向导**」：列表页可按标题/状态/时间/ID 搜索并查看详情；
「新建生产」为六步弹窗向导（通道选择 → 剧本创作 → 主体确认 → 漫画生成 → 人工审核 → 发布）；
另有独立的「主体资产库」沉淀复用角色/场景/画风，「合集」管理连载系列（人物/画风/前情衔接）。

## 前置条件

- Node.js ≥ 20，pnpm
- 微信公众号开发者凭证（APPID / APPSECRET），本机公网 IP 已加入公众号 IP 白名单
- 至少一个 OpenAI 兼容端点及其 Key（官方 DeepSeek / OpenAI / 自建 NewAPI、OneAPI、vLLM 等都行）；
  某域缺端点或 Key 时，该域调用报中文错误点名要改哪一项，不会静默换模型
- SQLite 无需安装（Prisma 7 + `@prisma/adapter-libsql`）

## 快速开始

```bash
cp .env.example .env   # 填写 APPID / APPSECRET / AUTHOR 与模型端点 Key
pnpm install           # 安装依赖（postinstall 自动执行 prisma generate）
pnpm db:push           # 建表（连接 URL 由 prisma.config.ts 解析，自动加载 .env）
pnpm db:seed           # 可选：灌入 22 个预设内容标签（幂等，同名跳过）
pnpm dev               # http://localhost:3000
```

可选项：

- `pnpm check:image` 检查当前配置的图像模型是否可用。
- `pnpm db:seed`（等价 `prisma db seed`）把 `src/lib/preset-tags.ts` 里的预设内容标签写进标签库。
  不跑也能用——没选标签时选题会回落 `DEFAULT_THEME_HINT`，跑完则能在 `/tags` 页直接挑现成标签。
  脚本**只写 `Tag` 表**：不生成图片、不建合集/主体/任务，也不碰 `AppSetting`（模型端点与密钥属于你自己的配置）。
  幂等且安全：重复执行只补缺失项，同名标签跳过，你改写过的标签说明不会被覆盖。
  灌到别的库：`DB_FILE=./data/other.db pnpm db:seed`。

## 环境配置要点（.env）

- **业务**：`APPID` / `APPSECRET`（微信发布）与 `AUTHOR`（默认署名）不填也能启动，相关功能在运行时报中文提示；
  填了占位符（`your-*` / `xxx`）会被 `env.ts` 拒绝。另有 `STYLE_PRESET`（画风兜底）、
  `NARRATION_IN_IMAGE`（旁白是否渲染进画面）、`IMAGE_GEN_CONCURRENCY`（生图并发，默认 2）等。
- **模型解析（域 + 裸 modelId）**：四个业务域各配一个主模型 `MODEL_<域>_PRIMARY`
  （`MODEL_MAIN_PRIMARY` / `MODEL_MAIN_LIGHT_PRIMARY` / `MODEL_VISION_PRIMARY` / `MODEL_IMAGE_API_PRIMARY`），
  写裸 modelId 即绑定该域端点；模型名自带斜杠时写 `域/modelId`（如 `vision/deepseek/deepseek-flash`）。
- **失败处理**：每域只有一个主模型，未配端点 / 缺 Key / 缺能力 / 请求失败都会抛中文错误并点名该改哪一项（不静默换模型）；
  `MODEL_AUTO_FALLBACK` 的多候选降级 + 冷却机制作为代码能力保留，当前无候选可切，该开关暂无实际效果。
- **接新厂商（OpenAI 兼容）不改代码**：配 `MODEL_<域>_BASE_URL` / `MODEL_<域>_API_KEY`
  （域级，缺省回落全局 `MODEL_BASE_URL` / `MODEL_API_KEY`），再在 `MODEL_<域>_PRIMARY` 写裸 modelId。
- **改配置两种方式**：`.env`，或前端 `/settings` 页（存 `AppSetting` 表，**优先级高于 `.env`**，保存即时生效）。
- **本地图生图服务**：任何 OpenAI 兼容 `/images/generations` + `/images/edits` 端点都可作图像主模型
  （`MODEL_IMAGE_API_BASE_URL` + `MODEL_IMAGE_API_PRIMARY`）；服务端不校验鉴权时 Key 留空即可（仍会发占位 Bearer）。
- **生图协议开关**：`MODEL_IMAGE_API_IMAGE_PROTOCOL`（`/settings` 页生图卡「生图协议」下拉）默认 `openai`；
  TokenHub / 混元等私有端点填 `si-image`，改走 `/wand/si-image/generation`（参考图 base64，最多 10 张）。
- `.env` 含真实密钥，**严禁提交**；`.env.example` 只留占位符。

## 使用流程（交互式工作流）

1. **列表页** `/`：顶部搜索栏支持「标题/关键词（模糊）· 状态 · 生成时间起/止 · 任务ID/草稿ID」，
   点击「搜索」刷新表格；表格列含创建时间（默认倒序，点表头切换）、标题、状态、内容标签（Popover 多选即时保存）、来源、
   格数、草稿ID、错误、查看详情（链接 `/tasks/:id`）。合集筛选「某合集」匹配主合集或归属，「无合集」= 两者皆空。
2. **新建生产**（六步向导弹窗）：
   1. **通道选择**：创作通道为「AI 创作」（填大纲 = 引导展开，全留空 = LLM 自创）；
      **内容标签**可多选（下拉按名称/说明搜索，标签说明即 AI 的题材要求，留空由 AI 自由发挥）；
      **合集·连载设定**：可选所属合集（选择后自动带入画风、主角与已有设定），
      本集画风可切换、本集出场角色可增减（默认主角全部出场）、
      可勾选「剧本生成时带入最近 3 集剧情简介」（`carryContext`，保持连载连续性）。
   2. **剧本创作**：进入即自动发起流式生成（SSE），左侧实时展示模型/思考/节点/降级/错误，
      右侧展示剧本卡；可对剧本提修改意见让 Agent 整份重写；确认无误后点「确认剧本，下一步」。
   3. **主体确认**：进入时先用 LLM 语义匹配主体库并预填「画风 / 主场景 / 各角色」，
      每个主体可在下拉里选库内主体复用或「新生成」（文生图）；确认时 SSE 实时回传主体卡，
      生成完成后角色/场景固定为参考图；确认完成才能进入下一步（可「重新确认」）。
      未绑定场景则不传场景参考图（主场景不再单独文生图）。
   4. **漫画生成**：顶部展示已确认的主体参考卡（hover 可「重新生成 / 存为资产」），
      每格按其出场角色/场景动态取参考图，以图生图**并行**生成分格图；
      每格支持 hover「重新生成 / 删除」，生成中有过渡遮罩；遮罩「版本」按钮可打开版本弹窗
      在多次重生成（`panel-NN.vN.png`）间切换当前选中版本。
   5. **人工审核**：整稿预览 + 备注，可「通过审核 / 弃稿 / 返回改图」。
   6. **发布**：一键发布到微信草稿箱，展示微信原始反馈（errcode/errmsg）成功/失败卡；
      「查看日志」按 2s 轮询事件时间线，「完成并关闭」刷新列表。
3. **详情页** `/tasks/:id`：查看剧本分格、主体参考、分图、执行日志；「通过 / 重新生图 / 弃稿」，
   可编辑标题与各格台词（保存后覆盖剧本并同步标题）；可管理任务的多合集归属。
4. **合集** `/series`、`/series/:id`：系列列表与详情，管理合集的常驻主角/常设场景/画风、
   剧集（每集摘要、集数编号）、资产归属与拖拽排序。
5. **标签库** `/tags`：内容标签增删改（标签说明会被注入选题/创作提示词），删除即级联解绑。
6. **设置** `/settings`：在线维护模型端点（三域主模型 + Base URL / API Key + API 类型，生图域另有「生图协议」）与业务参数，
   存 `AppSetting` 表，**优先级高于 `.env`**，保存即时生效；密钥只回显掩码。
7. 登录公众号后台 → 草稿箱 → 人工发表。

## 主体管理与资产库

漫画一致性拆成三个独立问题——**角色身份 / 场景布局 / 画风**，统一沉淀为可复用「主体」（Asset）：

| 维度     | 机制                                                                           |
| -------- | ------------------------------------------------------------------------------ |
| 角色身份 | 主体库（type=character）存角色参考图；生图时按格取对应角色图作为参考           |
| 场景     | 主体库（type=scene）存场景参考图；主场景不再单独文生图，未绑定则不传场景参考图 |
| 画风     | 主体库（type=style）存画风样图；优先级：库内 preset > `.env` 的 `STYLE_PRESET` |

- **资产库页面** `/assets`：按类型（角色 / 场景 / 画风）Tab + 关键词搜索 + 表格筛选，
  支持新建、编辑（名称/摘要/关键词/形象变体/画风变体）、删除、复用计数；图片存于 `data/assets/<type>/`。
  资产选择统一用 `tree-select`（顶部搜索 + 树形/列表切换，单选/多选两用）。
- **主体扩展**：基于「已有主体 + 用户提示词」由 LLM 生成新主体设定，再以图生图产出新图入库；
  角色外观可由 LLM 补全未绑定角色的设定。
- **一致性保证**：确认后的主体图写入 `task.referencePathsJson`，作为生图唯一数据源；
  分格图按「该格出场角色图 + 主场景图 + 画风样图」动态组参考集（`buildPanelRefs`），保证跨格一致。
- **旧任务兼容**：旧格式 `referencePathsJson`（扁平 `{character, scene}`）只读展示，不参与新的按格匹配。

## 合集（连载）

- `Task.seriesId` 为**主合集**：集数编号、`carryContext` 上下文、主体锁定、画风回落、每集摘要都按它计算；
  `TaskSeriesLink` 支持**多对多归属**（主合集 + 附加归属仅作归档展示），任务列表合集列为 Popover 多选编辑。
- 选中合集后，向导自动带入合集画风、常驻主角与设定；剧本创作时通过 `buildSeriesPromptSection`
  注入「连载合集 / 本集画风 / 出场人物 / 前情回顾」段落，约束人设、画风与剧情衔接。
- 剧集发布成功后自动生成一句话「本集简介」存入 `episodeDigest`，供后续剧集在 `carryContext` 开启时作前情回顾。

## 目录结构

```
src/
  app/
    api/            # Next.js 薄壳路由：参数校验 + SSE 建连 + 调 pipeline，不含业务逻辑
    assets/         # 资产库页面
    series/         # 系列（合集）列表与详情
    tags/           # 标签库页面
    settings/       # 设置页（模型配置 / 业务设置）
    tasks/          # 任务详情页
    page.tsx        # 首页（任务搜索列表）
  components/
    ui/             # shadcn/ui 基础组件
    workflow/       # 六步向导（step-channel / step-script / step-subjects / step-images /
                    #   step-review / step-publish，含 panel-version-dialog 版本选择）
    assets/         # 资产库组件
    series/         # 合集组件（series-library / series-detail / series-form-dialog）
    tags/           # 标签库组件（tag-library 管理页 / tag-select 可筛选多选下拉）
    settings/       # 设置页组件（model-domain-card / global-card / business-card）
    tree-select.tsx # 通用下拉：顶部搜索 + 树形/列表切换（资产选择统一使用）
  pipeline/         # 核心业务层——状态机纯函数，不依赖 Next.js
    prompts/        # LLM 提示词集中管理（writer/panel/subjects/series/topic/digest/tags）
    topic.ts writer.ts subjects.ts subject-bind.ts subject-extend.ts
    artist.ts panel-versions.ts panels.ts episode-digest.ts
    publisher.ts script-md.ts schema.ts weixin/
  model-manager/    # 模型注入层：域端点解析 + 域主模型解析（每域一个）+ 失败分类
    catalog/ providers/ fallback.ts resolve.ts registry.ts
  lib/              # db / sse / task-events / task-query / assets / api / inflight / status
                    #   settings-store（AppSetting + envOrSetting）/ settings-payload /
                    #   business-settings / provider-presets / use-ai-stream
  env.ts            # 环境变量校验（@t3-oss/env-nextjs）
  store/ui.ts       # Zustand UI 状态
data/               # 运行产物（.gitignore 排除，仓库不含示例数据）
  assets/<type>/    # 图片资产（character / scene / style）
  images/<taskId>/  # 分格图 panel-NN.vN.png（版本化）
  comics.db         # SQLite 数据库（含 /settings 页保存的密钥，切勿外传）
prisma/             # Prisma 7 schema（Task / Series / TaskSeriesLink / Tag / Asset / ...）
tests/              # Vitest 单测（node 环境）
scripts/            # db-seed.ts（预设标签灌库）、check-image-models.ts（模型可用性探测）等
```

## 技术栈

- **框架**：Next.js 15 (App Router) + React 19 + TypeScript
- **数据库**：SQLite via Prisma 7 + `@prisma/adapter-libsql`
- **状态/数据**：TanStack Query（轮询/SSE）+ TanStack Table + TanStack Form + Zustand
- **UI**：shadcn/ui + Tailwind CSS v4
- **测试 / Lint / 格式化**：Vitest / oxlint / oxfmt
- **生图并发**：`p-limit`（`IMAGE_GEN_CONCURRENCY` 默认 2），支持中断后补生成缺失格

## 页面路由

| 路径          | 说明                        |
| ------------- | --------------------------- |
| `/`           | 任务搜索列表                |
| `/tasks/:id`  | 任务详情（剧本/分图/日志）  |
| `/assets`     | 主体资产库                  |
| `/series`     | 合集（系列）列表            |
| `/series/:id` | 合集（系列）详情            |
| `/tags`       | 标签库（内容标签管理）      |
| `/settings`   | 设置（模型配置 / 业务设置） |

## 发布边界

- 自动发布到**微信草稿箱**（`/api/tasks/:id/publish`），展示微信原始 `errcode`/`errmsg`。
- 采用**默认排版**：全部分格按序 + 剧本标题 + 系统默认作者 + 首图封面。
- 文章从草稿箱到正式发表，需登录公众号后台人工操作。

### 第一次发布报 `40164 invalid ip`

微信不给未加白名单的出口 IP 发 `access_token`，这是新手 100% 会遇到的一次报错。错误文案已经把
当前出口 IP 从 `errmsg` 里抠出来显示（`当前出口 IP：x.x.x.x`），不用自己去查：

1. 复制报错里的 IP → 公众号后台「设置与开发 → 基本配置 → IP 白名单」添加并保存。
2. **等 1~3 分钟再重试**。白名单在微信侧有传播延迟，刚保存就重试通常仍是 40164——
   这一步最容易白折腾，不是没配对，是需要耐心。
3. 之后点侧边栏「刷新微信 access_token」（`POST /api/weixin/token/refresh`）。
   调用链本身已有 40164 自愈（失效缓存 token → 重取 → 自动重试一次），一般无需手动点。
4. **不需要重启服务**；只有顺手改了 `.env` 里的 `APPID` / `APPSECRET`（启动期读取）才必须重启。

家宽多为动态 IP，网络重连后出口变化会让同样的报错再冒一次，按上面三步处理即可。

## 验证

```bash
pnpm test                    # vitest 单测
pnpm exec tsc --noEmit       # 类型检查
pnpm lint                    # oxlint
pnpm format:check            # oxfmt 格式检查
pnpm build                   # Next.js 构建
```

`format:check` 要求 LF 换行：仓库已通过 `.gitattributes` 固定为 LF，Windows 上若用
`core.autocrlf=true` 检出会得到 CRLF 副本（全量报格式错，提交时仍会归一化为 LF）。
本地想跑得过请把检出设为 LF（`git config core.autocrlf input`）。

## 安全与部署边界

- **单用户本地工具：全站没有任何鉴权**，所有 `/api/*` 路由可直接读写数据库与设置项。
  只应在 `localhost` 或受信任内网使用，**不要**直接部署到公网或反代暴露给他人。
- 密钥有两处：`.env` 与 `data/comics.db` 的 `AppSetting` 表（`/settings` 页保存的内容）。
  两者都不进仓库（`.gitignore` 已排除 `.env` 与 `data/`）；分享截图/数据库前先自行清理。
- 生成内容全部先进草稿箱，正式发表是人工动作；模型输出未经自动审查。
  自行核实是否符合微信公众平台规范，并留意生图/推理的实际计费额度。
- 第三方依赖：调用 OpenAI 兼容端点与微信 `api.weixin.qq.com`，请求会带你的 Key / AppID，
  端点选择由你在 `.env` 或 `/settings` 页填写决定。

## 已知待清理

- `.env` 的 `COMICS_DIR` / `INBOX_DIR` / `TOPIC_SOURCES` / `DAILY_BUDGET_CNY` / `MAX_IMAGE_PER_TASK`
  目前只在 `env.ts` 声明并在设置页只读展示，没有业务逻辑消费（历史设计遗留）。
- `src/pipeline/subjects.ts` 的「新生成主体」失败时静默返回占位图，任务页不会提示生成失败。
- `vision` 业务域配置契约齐全但暂无 pipeline 调用方（`/settings` 页也因此不显示该卡片）。

## 贡献

开发环境、提交前自检与约定见 [CONTRIBUTING.md](CONTRIBUTING.md)；架构约定全文在 [AGENTS.md](AGENTS.md)。

## 许可

MIT，见 [LICENSE](LICENSE)。

## 架构约定（速览）

- `src/pipeline/` 为纯业务逻辑，不 import Next.js/React，可单独 Vitest 测试；新增业务逻辑一律放这里，不塞 route。
- LLM 提示词集中在 `src/pipeline/prompts/`，纯文本 + 纯组装函数，只可 import schema/themes/type-only 类型。
- 模型调用必须走 model-manager（`withModelFallback` / `getGatewayHttpConfig`），禁止在 pipeline/route 直接 fetch。
- 数据访问统一走 Prisma 单例 `@/lib/db`；schema 变更后 `pnpm db:push`。
- 生成类操作（剧本/图/发布）先查在途锁再 `registerRun`，完成/异常后 `unregisterRun`，防并发重复触发。
