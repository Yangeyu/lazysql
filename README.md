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
bun install        # 安装依赖（SQLite 驱动用 Bun 内置 bun:sqlite，无 native 安装）
bun run seed       # 生成样例库 data/sample.db（120 users / 300 orders）
bun start          # 启动 TUI（默认连 data/sample.db）
bun start <db>     # 连接指定 SQLite 文件
bun test           # 单元 + 适配器契约 + 无头 TUI 集成测试
bun run typecheck  # 严格类型检查
```

操作：`↑/↓` 移动 · `⏎` 打开表 · `tab` 切换面板 · `n/p` 翻页 · `q` 退出。

## 状态

✅ **Phase 0（行走骨架）已完成**：SQLite 连接 → 内省对象 → 分页浏览表 → Ink 面板，
端到端 7 项测试全绿。后续按 `docs/ARCHITECTURE.md` §11 推进（Phase 1：分页/筛选/排序 +
PG/MySQL 适配器 + 连接管理）。
