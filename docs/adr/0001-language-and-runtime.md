# ADR 0001：语言与运行时选型 —— TypeScript 而非 Go

- 状态：已接受
- 日期：2026-06-24

## 背景

lazysql 是 lazygit 风格的 TUI 数据库工具。lazygit 用 Go，直觉上 Go 是「同源」选择。
但本项目有两个 Go 不占优的硬需求：**LLM 驱动的 NL→SQL** 与 **schema 感知语法补全**。

## 候选

| 方案 | TUI | LLM 生态 | 分发 | 大网格性能 |
|------|-----|---------|------|-----------|
| **Go + tview** | 成熟 | 需自造 | 单二进制 ✅ | 原生 ✅ |
| **TypeScript + Ink** | 成熟(React) | 一等公民 ✅ | 需编译/打包 ⚠️ | 需自研虚拟化 ⚠️ |
| Rust + ratatui | 强 | 弱 | 单二进制 | ✅ |

## 决策

选 **TypeScript (strict) + Bun + Ink**。

**决定性因素**：NL→SQL 与补全是首期核心功能，TS 在 LLM SDK（Vercel AI SDK：provider 无关、
流式、tool-use）与 SQL AST 工具（node-sql-parser）上的生态远胜 Go，能显著降低这两块的实现成本与维护成本。
驱动生态平手（`pg`/`mysql2`/`mongodb`/`ioredis` 纯 JS）。

## 已知代价与缓解

1. **Ink 渲染海量行性能** → 架构上用「分页 + 游标 + 虚拟化渲染」从源头规避，永不 `SELECT *` 全量进内存。
2. **native 模块（`better-sqlite3`/`keytar`）让单二进制打包复杂** → 评估用 Node 22 内置 `node:sqlite`
   与纯 JS keychain 方案；分发用 `bun build --compile` 或 Node SEA，必要时按平台预构建。
3. **CPU 密集解析** → 必要时下沉到 worker thread。

## 推翻条件

若实测中 ① 大结果集 TUI 卡顿无法用虚拟化解决，或 ② 单二进制分发因 native 依赖不可接受，
则回退至 **Go + tview**，代价是 LLM/补全两块自行实现。
