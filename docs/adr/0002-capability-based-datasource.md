# ADR 0002：能力分段的 DataSource 抽象（核心抽象）

- 状态：已接受
- 日期：2026-06-24

## 背景

首期需同时支持关系库（PG/MySQL/SQLite）与非关系库（MongoDB/Redis）。
若抽象层以 SQL 为中心，NoSQL 接入时领域模型将被迫重写——违反 OCP。

## 决策

定义**最小基础端口 `DataSource`** + **多个可选能力接口**
（`Queryable` / `SchemaIntrospectable` / `RowEditable` / `Transactional` / `Streamable`）。
每个数据源**声明**自己实现的能力（`CapabilitySet`），UI 按能力启用功能，而非按数据库类型分支。

SQL 三家差异收敛到可插拔的 **`Dialect`** 策略对象，由单一 `SqlDataSource` 持有。

## 后果

**正面**
- 加数据库 = 新适配器 + 注册到 `registry`，核心零修改（OCP）。
- 无能力的数据源不被迫实现不支持的操作（ISP / LSP）。
- UI 主流程不出现 `if (db === 'redis')`。

**代价**
- 需要一个足够通用的 `ResultSet`（`tabular`/`document`/`keyvalue` 三态），渲染端用策略模式分流。
- 能力组合需用**契约测试套件**保证一致性（每个适配器按声明能力跑同一套验收）。

## 替代方案（已否决）

- 单一胖接口：逼迫所有源实现全部方法 → 违反 ISP。
- 每个数据库一个独立顶层抽象：重复代码、UI 需感知具体类型 → 违反 DRY/OCP。
