# lazysql 架构设计

> 一个 lazygit 风格的终端数据库管理工具（TUI）。
> 设计目标：**架构干净、链路清晰、可持续演进、严格遵循 SOLID**。

---

## 1. 设计哲学与约束

### 1.1 三条不可妥协的原则

1. **领域无关于基础设施**：核心业务逻辑（连接、浏览、查询、编辑）不知道自己跑在 PostgreSQL 还是 MongoDB 上，也不知道 LLM 是 Claude 还是 OpenAI。
2. **能力驱动而非类型驱动**：UI 不写 `if (db === 'redis')`，而是问 `if (source.supports(Capability.RowEdit))`。新数据源进来不碰旧代码。
3. **副作用收敛在边缘**：所有 IO（DB、LLM、文件、密钥）只发生在最外层适配器，内核是可纯函数测试的。

### 1.2 关键约束（来自需求）

- 首期数据库：**PostgreSQL、MySQL/MariaDB、SQLite、MongoDB、Redis** —— 决定了抽象层必须是「通用数据源」而非「SQL 中心」。
- 首期功能：**数据浏览/编辑、SQL 查询编辑器、Schema 管理、连接/会话管理、语法补全、NL→SQL(LLM)**。
- 体验基准：lazygit —— 键盘驱动、面板式、快、零配置可上手。

---

## 2. 技术栈决策（ADR 摘要）

| 关注点 | 选型 | 理由 |
|--------|------|------|
| 语言 | **TypeScript (strict)** | LLM/补全生态一等公民；团队熟悉度高 |
| 运行时 | **Bun**（开发&分发）/ 兼容 Node 22 | `bun build --compile` 出单二进制；保持运行时无关 |
| 数据源驱动 | `bun:sqlite` · **Bun.SQL（PG）** · `mysql2` · `mongodb` · **Bun 内置 `RedisClient`** | 每引擎一薄驱动，藏在适配器后；SQLite/PG/Redis 走 Bun 内置，依赖极轻 |
| TUI | **OpenTUI (React)** | 原生 cell-diff 渲染器，任意终端零闪烁。初版为 Ink，其短板兑现后按 `adr/0003` 预设的撤退路径切换，影响止于 `presentation/` |
| 状态 | **Zustand** + 特性 slice | 轻量、可测、与 React 渲染解耦（export / connForm 已成独立 slice） |
| LLM | **`SqlGenerator` 端口 + provider 适配器** | 端口即 provider 抽象；默认 **Qwen（百炼）**，可切 Claude / 任意 OpenAI 兼容 provider（见 `adr/0004`） |
| SQL 补全 | **自研 tokenizer 引擎**（`presentation/completion`，纯函数） | 半成品 SQL 上比 AST 解析器稳（原计划 node-sql-parser，未采用） |
| 行编辑 DML 生成 | **自研参数化 builder**（`adapters/…/sql/dml.ts`） | 绑定参数防注入；确认框回显同一 builder 的 value-inlined 预览（原计划 Kysely，未引入） |
| 密钥 | **FileSecretStore**（chmod 600）默认；macOS Keychain（`security` CLI）经 `LAZYSQL_SECRETS=keychain` 启用 | 不进 YAML；keytar 类 native 依赖被刻意避开 |

> ⚠️ **诚实的代价（已兑付）**：① Ink 的 ScrollView/FPS 短板在数据网格上如期出现，已按 `adr/0003` 切到 OpenTUI——这次撤退验证了「性能风险隔离在 presentation/」的分层假设；② native 模块的打包成本改由 CI 按平台编译子包吸收（`scripts/build-npm.ts`），运行时依赖保持纯 JS/Bun 内置。

---

## 3. 分层架构（Clean / Hexagonal）

依赖方向**严格自外向内**，内层永不 import 外层。

```
┌─────────────────────────────────────────────────────────────┐
│  presentation/ (TUI)   OpenTUI 组件 · keymap · store/slices    │  ← 可替换为 Web/GUI
├─────────────────────────────────────────────────────────────┤
│  application/ (用例)    ConnectDataSource · BrowseTable ·       │
│                        RunQuery · EditRow · GenerateSql         │
│                        (依赖 ports，不依赖具体实现)              │
├─────────────────────────────────────────────────────────────┤
│  domain/ (内核)         DataSource 端口 · 能力接口 · ResultSet   │  ← 纯，无任何 IO
│                        Schema/Table/Column · Connection 实体     │
├─────────────────────────────────────────────────────────────┤
│  adapters/ (基础设施)   SQL/Mongo/Redis 适配器 · LLM provider ·  │  ← 实现内层端口
│                        Keychain · Yaml 配置仓储                  │
└─────────────────────────────────────────────────────────────┘
         ▲ 组合根 main.ts：把具体适配器注入用例（手动 DI）
```

**依赖倒置（DIP）的体现**：`application` 定义 *出站端口*（如 `SqlGenerator`、`ConnectionRepository`），`adapters` 实现它们，`main.ts` 在启动时装配。内核对「数据库」「LLM」一无所知。

---

## 4. 核心抽象：DataSource 端口模型（整个项目的心脏）

### 4.1 为什么要分段（Interface Segregation）

一个「胖接口」会逼着 Redis 去实现 `listForeignKeys()`、逼着只读连接实现 `editRow()`。所以拆成**基础接口 + 多个能力接口**：

```ts
// domain/datasource/DataSource.ts —— 所有数据源的最小公共面
interface DataSource {
  readonly id: SourceId
  connect(): Promise<Result<void, ConnectionError>>
  disconnect(): Promise<void>
  ping(): Promise<boolean>
  capabilities(): CapabilitySet            // 声明自己支持哪些能力
}

// 能力接口（按需实现）—— ISP 落地
interface Queryable {            // 执行原生查询/命令 → 统一结果集
  execute(q: Query, signal?: AbortSignal): Promise<ResultSet>
}
interface SchemaIntrospectable { // 列出命名空间/表/集合/列/索引/约束
  introspect(): Promise<SchemaSnapshot>
}
interface RowEditable {          // 行/文档级 CRUD（参数化、带主键定位）
  insert(t: ObjectRef, row: Record): Promise<EditResult>
  update(t: ObjectRef, key: RowKey, patch: Record): Promise<EditResult>
  delete(t: ObjectRef, key: RowKey): Promise<EditResult>
}
interface Transactional {        // begin/commit/rollback
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
}
interface Streamable {           // 游标/流式，海量结果不撑爆内存
  stream(q: Query, opts: Cursor): AsyncIterable<Row>
}
```

> 以上为奠基时的核心五个；随功能演进又按同一模式长出了 `Browsable`（分页读窗口，`BrowseSpec`
> 携带主键 `stableKey` 保证窗口顺序确定）、`BrowsePreviewable` / `EditPreviewable`（把将要执行的
> 读/写渲染为可回显语句，display-only）、`DdlScriptable`（DROP 草稿 + CASCADE 升级）与
> `SqlDumpable`（导出 INSERT dump）。完整清单以 `domain/datasource/DataSource.ts` 为准——
> 每个能力都配 `asXxx` guard，UI 只经 guard 触达。

| 数据源 | Queryable | Schema | RowEdit | Transactional | Streamable |
|--------|:---:|:---:|:---:|:---:|:---:|
| PostgreSQL / MySQL / SQLite | ✅ | ✅ | ✅ | ✅ | ✅ |
| MongoDB | ✅(命令) | ✅(集合/文档形态) | ✅ | ✅(4.0+) | ✅ |
| Redis | ✅(命令) | ◐(keyspace 扫描) | ◐(key 级) | ◐(MULTI) | ◐(SCAN) |

UI 只问能力，不问类型 —— 这是「未来可演进」的根。

### 4.2 统一结果模型（让表格/文档/KV 收敛到一处）

```ts
// domain/datasource/ResultSet.ts
interface ResultSet {
  columns: ColumnMeta[]        // 名称、声明类型、可空、是否主键
  rows: Row[]                  // Row = 有序值数组 + 按列名索引
  shape: 'tabular' | 'document' | 'keyvalue'   // 决定 UI 渲染策略
  affected?: number
  truncated: boolean           // 是否被分页/游标截断
}
```

- SQL → `tabular`，直接进数据网格。
- Mongo 文档 → `document`，网格按投影列展平 + 可展开为树。
- Redis → `keyvalue`，专用渲染。

一个结果模型、三种渲染策略（**策略模式**），UI 主流程不分叉。

### 4.3 SQL 内部的方言隔离（Strategy Pattern）

SQL 三家有差异（分页、引号、类型、内省查询）。因此**一个通用 `SqlDataSource` + 可插拔 `Dialect`**，而不是三个独立适配器：

```
SqlDataSource ──持有──▶ Dialect (接口)
                          ├─ PostgresDialect  (LIMIT/OFFSET, "ident", pg_catalog 内省)
                          ├─ MySqlDialect     (LIMIT, `ident`, information_schema 内省)
                          └─ SqliteDialect    (LIMIT, "ident", pragma 内省)
                       └持有──▶ Driver (薄封装 pg / mysql2 / better-sqlite3)
```

新增一个 SQL 方言（如 ClickHouse）= 新 `Dialect`，`SqlDataSource` 一行不改（OCP）。

---

## 5. LLM 子系统：NL→SQL + 语法补全

### 5.1 出站端口（领域不知道有 LLM）

```ts
// application/ports/SqlGenerator.ts
interface SqlGenerator {
  generate(input: {
    nl: string                  // 用户自然语言
    schemaContext: SchemaContext // 压缩后的 schema（表/列/类型/关系）
    dialect: DialectId
  }): Promise<GeneratedSql>      // { sql, explanation, confidence, isDestructive }
}
```

### 5.2 NL→SQL 安全链路（绝不自动执行破坏性语句）

```
用户输入自然语言
   │
   ▼ ① 收集相关 schema（按表名/关键词裁剪，控制 token）
   ▼ ② SqlGenerator.generate() —— 经 provider 适配器（默认 Qwen/百炼，可切 Claude）
   ▼ ③ 静态分析生成的 SQL（node-sql-parser）：判定读/写/DDL、标记破坏性
   ▼ ④ 【强制】在编辑器中展示 SQL + 解释，等待用户确认
   ▼ ⑤ 写操作 → 先 EXPLAIN/dry-run，二次确认
   ▼ ⑥ 执行 → 结果回灌网格
```

- Provider 无关：`SqlGenerator` 端口即抽象，`createSqlGenerator` 按 env 选 provider。
  默认 **Qwen（百炼）**（配 `DASHSCOPE_API_KEY`），可切 **Claude** 或任意 OpenAI 兼容 provider
  （DeepSeek / Moonshot / 本地 Ollama）—— 新增只动 `adapters/llm/`，见 `adr/0004`。
- **只读优先**：默认生成 `SELECT`，写/DDL 需显式开启 + 二次确认。

### 5.3 语法补全（与 LLM 解耦，独立引擎）

补全 ≠ LLM。用 **schema 感知的确定性补全**（快、离线、零成本）：

```
SchemaAwareCompleter:
  光标上下文(node-sql-parser tokenize)
    ├─ FROM/JOIN 后 → 补全表/集合名（来自最近一次 introspect 快照）
    ├─ SELECT/WHERE 中 → 补全当前表的列名（含类型提示）
    └─ 句首 → 补全 SQL 关键字
```

LLM 仅用于「整句生成」，补全走本地引擎 —— 两条独立链路，互不阻塞。

---

## 6. TUI 架构（lazygit 风格）

### 6.1 面板布局

```
┌──────────────┬───────────────────────────────────────────────┐
│ Connections  │  Main Panel (随上下文切换)                       │
│  ▾ prod-pg   │  ┌─ DataGrid ──────────────────────────────┐   │
│    ▾ public  │  │ id │ name      │ created_at              │   │
│      users   │  │ 1  │ alice     │ 2026-01-02              │   │
│    ▸ orders  │  │ 2  │ bob       │ 2026-01-03  [虚拟化渲染] │   │
│  ▸ cache-rds │  └──────────────────────────────────────────┘   │
│              │  (或 QueryEditor / SchemaView，按 Tab 切换)       │
├──────────────┴───────────────────────────────────────────────┤
│ StatusBar: prod-pg · public.users · 1.2k rows · 23ms  [? help] │
└───────────────────────────────────────────────────────────────┘
```

- 左：连接/库/Schema/表的树（Sidebar）。
- 主：DataGrid / QueryEditor / SchemaView 三态切换。
- 底：状态栏 + 命令栏。
- 叠加层：连接配置、确认框、**命令面板（Command Palette）**。

### 6.2 键位表：描述 + 行为的唯一真相（详见 ADR 0007）

键位是一张上下文感知的表 `GROUPS: Record<KeyContext, KeyGroup>`，每个 binding **同时**携带匹配、展示与行为：

```ts
interface KeyBinding {
  match: readonly string[];                 // 'up' / 'k' / '^g' …（机器匹配）
  keys: string; hint: string; desc: string; // footer 与 ? 帮助的展示
  run: (s: AppState, env) => void;          // 行为：作用于 store 活态
  enabled?: (flags) => boolean;             // 能力门控：同时决定显隐与是否触发
}
```

`footerHints`/`helpGroups` 与唯一派发器 `dispatchKey` **读同一批行**，所以一个键定义一次，
footer、帮助、真实行为永不漂移。`deriveContext(state)` 是「在哪个上下文」的唯一纯函数。
`App` 的输入处理器退为一行 `useKeyboard(k => dispatchKey(store.getState(), k, { quit }))`。

文本输入用 OpenTUI **原生 `<input>`**（过滤 / 单元格编辑 / NL ask / SQL 编辑器，详见 ADR 0008）：widget
自己持有文本 + 光标（光标是终端的，不跳），`onInput` 报告编辑、`onSubmit` 提交。store 只留**已提交值**
（SQL 编辑器经 `value` 受控 + `onInput` 同步），不再存草稿。聚焦的 widget 自吃文本键与 `⏎`，`dispatchKey`
只处理它不消费的应用级键（`Esc`/`^G`/`Tab`/`^C`）；这些 widget 自管的键在表里留作展示行
（`KeyBinding.match/run` 可选）。连接表单仍用 append-only 渲染。

收益：① footer/帮助自动生成且永不漂移；② 派发是纯逻辑、脱离终端可测；③ 光标 / 编辑（undo、词操作、选区）
由经验证的原生内核提供，不自造轮子。

### 6.3 状态流（单向数据流）

```
键位/输入 ──▶ dispatchKey(按 context 查表) ──▶ store action / 用例 ──▶ 更新 Zustand store
                                                                        │
   OpenTUI 组件 ◀── selector/ViewModel 派生视图状态 ◀────────────────────┘
```

文本录入是同一条链路的特例：`dispatchKey` → `editX(op)` → 对 `TextField` 应用纯操作 → store。
异步 DB/LLM 操作通过 store 的 `loading/error` 状态驱动 UI，**用 `AbortController` 贯穿取消**（长查询可中断）。

### 6.4 渲染性能纪律（OpenTUI）

初版按 `adr/0003` 选 Ink；其 ~30 FPS / 无 ScrollView 短板在数据网格上如期兑现，已按同一 ADR 预设的撤退路径切换到 **OpenTUI**（原生 cell-diff 渲染，逐格差量重绘，任意终端零闪烁）——切换影响止于 `presentation/`，domain/application 一行未动。迁移不豁免以下纪律：

1. **严格分页 + 游标**：DB 侧分页（并以主键 `stableKey` 保证窗口顺序确定），永不全量进内存（第 4、12 节）。
2. **视口虚拟化**：网格只渲染可见行；半页跳转按组件上报的实际视口行数计算。
3. **memoization + store 切片**：组件 `React.memo` 化；store 按特性切 slice，杜绝全树重渲染。
4. **stdout 独占**：日志绝不写 stdout（架构测试机械强制）；运行期诊断走 F12 的 OpenTUI console 覆盖层。

---

## 7. 目录结构（按层 + 按特性）

```
src/
  __tests__/                   # 架构闸门（依赖方向 · 命名导出 · no-console，机械强制）
  domain/                      # 纯内核，零 IO，可独立单测
    datasource/
      DataSource.ts            # 基础端口 + 全部能力接口 + asXxx guards
      capabilities.ts          # Capability 枚举 + CapabilitySet
      ResultSet.ts             # 统一结果模型（tabular/document/keyvalue）
      schema.ts                # ObjectRef/ColumnDef/DetailSection 领域模型
      edit.ts                  # RowKey/RowPatch/EditResult
    connection/                # ConnectionProfile 值对象
    query/                     # Query/Page/Sort/Filter/BrowseSpec · classify（危险语句分类）
    export/                    # RowFormatter：CSV/JSON/SQL 行格式化（纯函数）
    errors/                    # 领域错误类型 + Result 边界助手（toDataSourceError/attempt）
  application/
    usecases/                  # 一文件一用例：BrowseTable · RunQuery · EditRow · ListObjects ·
                               # OpenConnection · ConnectDataSource · GenerateSql ·
                               # ExportResult/ExportTable/ExportTablesCombined ·
                               # browsePages/streamExport（导出的分页与流式驱动）
    ports/                     # ConnectionService · ConnectionRepository · SecretStore ·
                               # SqlGenerator · Exporter · QueryHistoryStore · Clipboard ·
                               # DataSourceFactory
  adapters/
    datasource/
      sql/
        SqlDataSource.ts       # 通用 SQL 适配器（能力实现共用一套）
        dialects/              # PostgresDialect · MySqlDialect · SqliteDialect（Strategy）
        drivers/               # BunSqliteDriver · PgDriver(Bun.SQL) · MySqlDriver(mysql2)
        whereBuilder.ts        # 共享 WHERE/ORDER BY 构建（注入安全 + stableKey 尾键）
        dml.ts / inlineParams.ts # 参数化 DML 构建 · 预览用 value-inline
        __tests__/sqlContract.ts # 参数化共享契约套件（三引擎装配运行）
      mongo/                   # 文档源 → 'document' 形态（_id 稳定排序尾键）
      redis/                   # 键值源 → 'keyvalue' 形态
      tunnel/SshTunnel.ts      # SSH 本地端口转发（系统 ssh，key/agent 认证）
      registry.ts              # DataSourceFactory：driver → 适配器（OCP 扩展点）；
                               # profile.ssh 先建隧道再改写 host/port，隧道随源断开而关闭
    llm/
      createSqlGenerator.ts    # provider 工厂：env/config → SqlGenerator
      providers/               # AnthropicSqlGenerator · OpenAiCompatible + presets（OCP）
    persistence/               # YamlConnectionRepository · File/KeychainSecretStore ·
                               # JsonQueryHistoryStore · appConfig · paths
    export/FileExporter.ts     # 导出 sink（原子写 + abort 丢弃半成品）
    clipboard/SystemClipboard.ts
  presentation/
    app/                       # App/Root 装配 · store.ts（组合根+连接生命周期）· layout
      slices/                  # 特性切片：browse · editor · tree · export · connForm（互不导入，见架构闸门 4）
    keymap/                    # 键位注册表：描述+行为唯一真相（ADR 0007）
    components/                # Sidebar · DataGrid · QueryEditor · CellView · HelpOverlay · …
    completion/                # 自研 tokenizer 补全引擎（纯函数）
    input/ · theme/ · tree/    # 键解码 · 主题/CARET · 树投影
    testing/                   # renderTest：headless TUI 测试基建
  shared/                      # Result<T,E> · path（跨层纯工具，禁业务逻辑）
  cli/                         # spec/parse/help：argv → 意图判别联合（adr/0009）
  main.tsx                     # 组合根：唯一 import 具体 adapter 处
```

---

## 8. SOLID 映射（逐条兑现）

| 原则 | 在本架构中的落地 |
|------|------|
| **S** 单一职责 | Driver（连接&发请求）/ Dialect（方言差异）/ Adapter（端口适配）三者分离；用例只编排不实现 |
| **O** 开闭 | 加数据库 = 新 Adapter + 注册到 `registry`；加 LLM provider = 新 provider；**核心零修改** |
| **L** 里氏替换 | 所有适配器遵守端口契约；用**能力接口**避免「被迫实现不支持的操作」，从而保证可替换性在声明能力内恒成立 |
| **I** 接口隔离 | `Queryable/SchemaIntrospectable/RowEditable/Transactional/Streamable` 分段，而非一个胖接口 |
| **D** 依赖倒置 | domain/application 只依赖端口；adapters 依赖内层；`main.ts` 注入具体实现 |

---

## 9. 横切关注点

- **错误处理**：边界返回 `Result<T,E>`，领域错误带类型；TUI 统一错误展示层。
- **取消**：`AbortController` 贯穿查询/LLM 调用；长操作可中断。
- **日志**：结构化日志写文件（`~/.local/state/lazysql/`），含查询耗时；调试面板可视。
- **密钥**：连接密码进 OS Keychain；配置文件只存引用（`secret://` 或 env 占位）。
- **配置**：`~/.config/lazysql/config.yml`（连接、偏好、键位）；schema 可校验。

---

## 10. 测试策略

| 层 | 手段 | 特点 |
|----|------|------|
| domain / application | 纯单元测试（无 IO） | 快、稳、覆盖核心逻辑 |
| adapters | `docker-compose.test.yml` 一键起 PG/MySQL/Mongo/Redis 真实库 + SQLite 文件库 | 验证方言/内省正确性；服务不可达自动跳过 |
| **契约测试** | 共享参数化套件 `sql/__tests__/sqlContract.ts`（三 SQL 引擎装配同一组断言，结构上不可漂移）；Mongo/Redis 各自验证能力矩阵的「有与无」 | 强制 LSP，新适配器接入即验收 |
| TUI | `renderTest`（@opentui/react test-utils 无头渲染真实 App）+ keymap/store 单测 | 渲染与交互可回归 |
| **架构闸门** | `src/__tests__/architecture.test.ts` | 依赖方向 / 命名导出 / no-console 由测试机械强制，不靠自觉 |

> 「适配器契约测试套件」是本设计的专业要点：它把「LSP 是否被遵守」变成**可执行的验收**。

---

## 11. 演进路线（每阶段都是可运行的垂直切片）

> 关键策略：**NoSQL 排在后期，但抽象从第 0 天就为它设计**——这是「未来可演进」的真正含义。

- **Phase 0 · 行走骨架** ✅：SQLite 适配器 + 连接 + 浏览一张表 + Ink 外壳。打通端到端纵切，验证抽象。（SQLite 零部署，联调成本最低）
- **Phase 1 · 核心浏览** 🚧：分页/筛选/排序 + PG/MySQL 适配器 + 连接管理 + Keychain。
  - ✅ PostgreSQL 适配器：复用 `SqlDataSource`，仅加 `PostgresDialect`(`$n` 占位/`information_schema` 内省/schema 限定名) + `PgDriver`(`pg`)，过与 SQLite 同一套契约测试。**新增引擎零改动 domain/application/presentation**（OCP 实证）。
  - ✅ 列排序：引入 `BrowseSpec`(page + sort，为 filter 预留)，两个 Dialect 各自生成 `ORDER BY`；UI 列光标 + ▲/▼ 指示。同一增量在 SQLite/PG/TUI 三处验证。
  - ✅ 列筛选：`Filter` 结构化条件挂入 `BrowseSpec`（未改 `Browsable` 签名，验证预留扩展位）；共享 `whereBuilder` 参数化生成 WHERE（`?` vs `$n`、`LIKE` vs `ILIKE`），count 同步应用 filter；TUI `/` 进入输入态，contains 筛选当前列。
  - ✅ MySQL/MariaDB 适配器：再次复用 `SqlDataSource`，仅加 `MySqlDialect`(反引号标识符 / `DATABASE()` 限定 / `COLUMN_KEY='PRI'` 查主键) + `MySqlDriver`(`mysql2`)。**三个 SQL 引擎(SQLite/PG/MySQL)过同一套契约测试**——方言隔离的最强证据。
  - ✅ 连接管理：`ConnectionRepository`/`SecretStore`/`DataSourceFactory` 三个出站端口；`YamlConnectionRepository`(`connections.yml`，无密码，可手编) + `FileSecretStore`(`secrets.json`，`chmod 600`)。`OpenConnection` 用例解析密钥并合并进 options 后连接。**in-TUI 连接选择器**(`Root` 组件管理 选择器↔浏览 阶段机) + 会话内切换(``` ` ``` 键经 `ShellContext`)；组合根无 arg 进选择器、带名称/文件直连、首次运行写起始配置。
  - ✅ `KeychainSecretStore`：`SecretStore` 的第二实现(macOS `security` CLI，零 native 依赖)，`LAZYSQL_SECRETS=keychain` 开启。**新增引擎/密钥后端只动 `adapters/`，端口之上零改动**——三度兑现 OCP/DIP。
  - ⬜ in-TUI「新增连接」表单(当前经编辑 `connections.yml`) · Linux/Windows Keychain 后端。
- **Phase 2 · 数据编辑** ✅：启用 `RowEditable`/`Transactional` 能力。参数化 DML（`dml.ts`，**拒绝无 WHERE 的写**）；每次写入跑在真事务里，`affected≠1 → 回滚`（防误改多行）；TUI `e` 编辑单元格、`d` 删除行，均经**二次确认**展示精确语句后执行。三引擎适配器测试覆盖写入与回滚守卫。Insert 已在适配器层（无 UI 表单，留作后续）。
- **Phase 3 · 查询编辑器** ✅：第二个主视图(`view: browse | query`)。经 `Queryable` 执行自由 SQL、复用 `DataGrid` 渲染结果、会话内历史(`↑/↓`)。**schema 感知补全**——纯 tokenizer 引擎(`sqlCompleter.ts`，无解析器、对半成品 SQL 鲁棒):按前置关键字给 表名/列名(按 FROM 子句作用域)/关键字,`Tab` 接受。`:` 进入、`esc` 返回。
- **Phase 4 · Schema 管理** ⬜：内省视图 + DDL。
- **Phase 5 · NL→SQL (LLM)** ✅：`SqlGenerator` 出站端口（**端口即 provider 抽象**）。`GenerateSql` 用例：生成→`classify`(read/write/ddl)→`Result`；**绝不执行**。TUI `^G` 进入 NL 提示，生成的 SQL **填入编辑器供审查**，破坏性语句红色 ⚠ 警告，用户自行回车运行。store 级测试验证"填入而不执行"。
  - **多 provider（ADR-0004）** ✅：`createSqlGenerator` 工厂按 env 选 provider。默认 **Qwen（百炼）**——`OpenAiCompatibleSqlGenerator`（一个适配器服务一类 OpenAI 兼容 provider，forced function-calling 出 `{sql, explanation}`，原生 `fetch`，`DASHSCOPE_API_KEY` + `qwen3.7-plus`）；可切 **Claude**（官方 `@anthropic-ai/sdk` strict tool use，`ANTHROPIC_API_KEY` + `claude-opus-4-8`）。`LAZYSQL_LLM_PROVIDER` 显式指定、否则按密钥自动探测；`LAZYSQL_LLM_MODEL`/`LAZYSQL_LLM_BASE_URL` 覆盖。**新增 provider 只动 `adapters/llm/`**——四度兑现 OCP/DIP，且证明端口对两种异构 SDK/线格式都成立。
- **Phase 6 · NoSQL** ✅：**MongoDB（文档）+ Redis（键值）适配器——能力模型的试金石（adr/0005）**。
  两源均声明 `SchemaIntrospect`+`Browse`+`RowEdit`，刻意**省略 `Query`（非 SQL）与 `Transaction`（无回滚）**；
  `RowEditable` 靠单文档/单键原子性在**无事务**下保持安全。Mongo 走官方 `mongodb` 驱动、`find().skip().limit()`
  映射、`'document'` 形态（列取并集、`_id` 在前、ObjectId/Date/嵌套压平）；Redis 走 **Bun 内置 RedisClient**
  （零依赖）、按 `:` 前缀分组为 keyspace、`'keyvalue'` 形态。**唯一的 `presentation/` 改动**：store 由
  `asQueryable` 派生 `queryable`，`:`/`^G` 对非 `Query` 源自动隐藏——按能力门控、零 `if (db===…)`。
  **领域/用例零改动**，改动全落 `adapters/`。两套契约测试（真实 Mongo/Redis，不可达则跳过）。
- **Phase 7 · 进阶**：✅ SSH 隧道（`profile.ssh` → 系统 `ssh -L` 本地转发；`DataSourceFactory` 因此异步化。
  仅离散 host/port 选项可走隧道——URL 形式的 host 无法改写指向本地转发；BatchMode 强制 key/agent 认证，
  TUI 独占终端无法应答交互式密码）。导入导出（导出已完成，ADR 0012）、插件化：未动。

---

## 12. 一眼看懂的数据流（端到端示例：浏览一张表）

```
用户在 Sidebar 选中 public.users，按 Enter
  → Command 'table.browse'
  → 用例 BrowseTable(sourceId, ObjectRef)
       → DataSource.execute( Dialect.paginate("SELECT * FROM users", page) )
       → 返回 ResultSet{ shape:'tabular' }
  → store.grid.setResult(rs)
  → DataGrid 组件按 shape 选渲染策略 + 虚拟化只渲染可见行
  → StatusBar 显示 "public.users · 1.2k rows · 23ms"
```

全程领域内核不知道底层是 Postgres —— 换成 SQLite 同一条链路不变。
