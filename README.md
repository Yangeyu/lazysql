# lazysql

> 一个 lazygit 风格的终端数据库管理工具（TUI）。键盘驱动、面板式、跨数据库。

## 愿景

在终端里像用 lazygit 操作 git 一样操作数据库：连接、浏览、编辑、查询、管理 Schema，
并通过 LLM 用自然语言生成 SQL —— 全程不离开键盘。

## 首期能力

- 🔌 **多数据源**：PostgreSQL · MySQL/MariaDB · SQLite · MongoDB · Redis
- 📊 **数据浏览/编辑**：分页 · 筛选 · 排序 · 行级 CRUD（事务安全）
- ⌨️ **SQL 查询编辑器**：执行 · 历史 · **schema 感知语法补全**
- 🧬 **Schema 管理**：表/索引/外键/约束内省 · DDL
- 🤖 **NL→SQL**：自然语言经 LLM 生成 SQL，强制审查后执行（默认只读、写操作二次确认）
- 🗂️ **连接/会话管理**：多连接配置 · OS Keychain 密钥 · 多标签会话

## 技术栈

`TypeScript(strict)` · `Bun` · `Ink (TUI)` · `Vercel AI SDK (LLM)` · `Zustand`

## 架构

采用 **Clean / Hexagonal** 分层，核心是**能力分段的 DataSource 端口**——
UI 询问数据源「支持什么能力」而非「是什么类型」，新增数据库零修改核心。

详见 **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**，决策记录见 **[docs/adr/](docs/adr/)**。

## 开发

```bash
bun install        # 安装依赖（SQLite 用 Bun 内置 bun:sqlite，无 native 安装）
bun run seed       # 生成样例库 data/sample.db（120 users / 300 orders）
bun start          # 打开默认连接（首次运行自动生成 ~/.config/lazysql/connections.yml）
bun start <name>   # 按名称/id 打开已保存的连接
bun start <db>     # 临时打开一个 SQLite 文件
bun start --list   # 列出已保存的连接
bun test           # 单元 + 适配器契约（SQLite & 真实 PG/MySQL）+ 持久化 + 无头 TUI
bun run typecheck  # 严格类型检查
```

连接配置存于 `~/.config/lazysql/`：`connections.yml`（可手动编辑，**不含密码**）+
`secrets.json`（密码，`chmod 600`）。两者经 `ConnectionRepository` / `SecretStore`
端口隔离，将来换 OS Keychain 只需替换后者的适配器。

操作：`↑/↓` 移动 · `⏎` 打开表 · `tab` 切换面板 · `n/p` 翻页 · `q` 退出。

PostgreSQL 适配器契约测试需一个可达的 PG 实例（无则自动跳过）：

```bash
docker run -d --name lazysql-pg -e POSTGRES_PASSWORD=lazysql \
  -e POSTGRES_USER=lazysql -e POSTGRES_DB=lazysql -p 55432:5432 postgres:16-alpine
```

## 状态

- ✅ **Phase 0（行走骨架）**：SQLite 连接 → 内省 → 分页浏览 → Ink 面板。
- 🚧 **Phase 1（进行中）**：
  - ✅ **PostgreSQL 适配器** —— 复用 `SqlDataSource`，仅新增 `PostgresDialect` + `PgDriver`，
    通过与 SQLite **同一套契约测试**（针对真实 PG 容器）。
  - ✅ **列排序** —— `BrowseSpec` 承载 page + sort，两个方言各自生成 `ORDER BY`；
    grid 内 `←/→` 移动列光标、`s` 循环 升→降→无。
  - ✅ **列筛选** —— 结构化 `Filter` 参数化生成 WHERE（防注入），count 同步；
    grid 内 `/` 进入输入态，对当前列做 contains 筛选。
  - ✅ **MySQL/MariaDB 适配器** —— 第三个引擎复用 `SqlDataSource`，仅加
    `MySqlDialect`（反引号 / `DATABASE()` / `COLUMN_KEY`）+ `MySqlDriver`（mysql2）。
  - ✅ **连接管理** —— `connections.yml`（无密码）+ `secrets.json`（0600）经
    `ConnectionRepository` / `SecretStore` 端口隔离；`OpenConnection` 用例解析密钥并连接。
    **in-TUI 连接选择器 + 会话内切换**（`` ` `` 键）；无 arg 启动进选择器，带名称/文件直连。
  - ✅ **KeychainSecretStore** —— `SecretStore` 的第二实现（macOS `security`，零 native 依赖），
    `LAZYSQL_SECRETS=keychain` 开启。
  - ⬜ in-TUI「新增连接」表单（当前经编辑 `connections.yml` 添加）· Linux/Windows Keychain 后端。

Phase 1 核心完成。详见 `docs/ARCHITECTURE.md` §11。

### Phase 2（数据编辑，进行中）

- ✅ **行编辑（RowEditable + Transactional）** —— 参数化 DML（拒绝无 WHERE 的写）；
  每次写入跑在真事务里，`affected≠1 → 自动回滚`（防误改多行）。三引擎适配器测试覆盖。
- ✅ **TUI 编辑 + 二次确认** —— grid 内 `e` 编辑单元格、`d` 删除行；提交前展示精确
  SQL 语句，`y` 应用 / `n` 取消。无主键的表自动只读。
- ⬜ in-TUI「新增行」表单（Insert 已在适配器层）。

### Phase 3（SQL 查询编辑器，进行中）

- ✅ **查询编辑器** —— `:` 进入；自由写/执行 SQL（经 `Queryable`），结果复用 `DataGrid`，
  会话内历史 `↑/↓`，`tab` 在编辑器/结果间切换，`esc` 返回浏览。
- ✅ **schema 感知补全** —— 纯 tokenizer 引擎，按上下文给 表名 / 列名（按 FROM 作用域）/
  关键字，`Tab` 接受首候选。无新依赖。
- ✅ **NL→SQL（LLM）** —— `^G` 输入自然语言 → Claude 生成 SQL **填入编辑器供审查**
  （绝不自动执行），破坏性语句红色 ⚠ 警告。`SqlGenerator` 端口即 provider 抽象，
  默认官方 `@anthropic-ai/sdk` + `claude-opus-4-8`；设 `ANTHROPIC_API_KEY` 启用。
- ⬜ 多行编辑 · 历史持久化 · Schema 管理视图。

当前 **63 项测试全绿**（含 NL→SQL 端口/分类/store 级测试 + 全部 TUI 集成）。
