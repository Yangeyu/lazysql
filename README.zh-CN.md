# lazysql

[English](README.md) · **简体中文**

[![npm](https://img.shields.io/npm/v/@vascent/lazysql)](https://www.npmjs.com/package/@vascent/lazysql)
[![license](https://img.shields.io/npm/l/@vascent/lazysql)](LICENSE)
![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)

> 一个 lazygit 风格的终端数据库客户端(TUI)。键盘驱动、面板式、跨数据库,并能用自然语言生成 SQL——全程不离开键盘。

在终端里像用 lazygit 操作 git 一样操作数据库:连接、浏览、编辑、查询、管理 schema。

![lazysql 演示](docs/assets/demo.gif?v=0.1.21)

## ✨ 功能

- 🔌 **多数据源**:PostgreSQL · MySQL/MariaDB · SQLite · MongoDB · Redis
- 📊 **浏览 / 编辑**:分页 · 列排序 · 列筛选 · 行级编辑与删除(参数化、跑在真事务里,`affected≠1` 自动回滚)
- ⌨️ **SQL 编辑器**:**多行编辑** · 执行 · 按连接持久化的历史(`^P/^N`)· **schema 感知补全**(表名 / 按 FROM 作用域的列名 / 关键字,`^T` 开关)
- 📤 **数据导出**:导出为 **CSV · JSON · SQL**——当前网格视图、整张表、整个 schema/类别,或多选(`v` 标记)的若干表;流式写盘、常量内存、可取消(`esc`)、实时行数进度。CSV 一表一文件,JSON 与 SQL 各自合并为单文件
- 🧬 **Schema 内省**:表 / 视图 / 索引 / 序列 / 触发器 / 存储过程;查看对象的列与 DDL 定义
- 🛡️ **破坏性操作守卫**:无 `WHERE` 的 `UPDATE/DELETE`、`DROP`、`TRUNCATE` 一律弹**居中确认弹窗**,回显将执行的完整 SQL;Postgres 因依赖而 `DROP` 失败时,提供 `CASCADE` 重试并**点名列出会被连带删除的对象**
- 🌳 **tree 实时同步**:DDL(`CREATE/DROP/ALTER/…`)执行成功后自动刷新对象树
- 🤖 **NL→SQL**:`^G` 输入自然语言,LLM 生成 SQL **填入编辑器供审查**(绝不自动执行);Ask AI 中 `↑/↓` 召回当前连接的内存 prompt 历史,`esc` 或点击任一面板/SQL 编辑区退出输入,`esc` 可取消生成,破坏性语句红色 ⚠ 标注
- 🗂️ **连接管理**:多连接配置 · in-TUI 新建 / 编辑 / 测试连接 · 密码与配置分离存储(可选 OS Keychain) · **SSH 隧道**直连跳板机后的数据库(key/agent 认证,支持 `~/.ssh/config` 别名)
- 🖱️ **现代终端体验**:鼠标 / 滚轮 · 系统剪贴板复制 · 全单元格检查器(长文本按显示宽度换行,中文不截断)

## 📦 安装

**装好即用,无需 Bun**——预编译的 `bun --compile` 原生二进制经 npm 分发,每平台一份,只装匹配你系统的那个。支持 **macOS(Apple Silicon)· Linux(x64 / arm64)· Windows(x64)**。

### 包管理器(推荐)

| 方式 | 命令 |
|------|------|
| npm | `npm i -g @vascent/lazysql` |
| bun | `bun add -g @vascent/lazysql` |
| 免安装试用 | `npx @vascent/lazysql --list` |

装完直接敲 `lazysql`。

> 用 `bun add -g` 安装时,若敲 `lazysql` 提示 command not found,是 Bun 的全局目录 `~/.bun/bin` 不在 `PATH`——`bun add -g` 结尾通常会提示你加(`npm i -g` 一般无此问题)。

### 从源码(尝鲜未发版的改动)

想用尚未发布的最新代码,或本地改完即用:

```bash
git clone https://github.com/Yangeyu/lazysql && cd lazysql
bun install
bun link            # 注册全局 lazysql → ~/.bun/bin/lazysql(软链到本仓库)
```

`bun link` 把命令放进 Bun 的全局目录 `~/.bun/bin`,需确认它在 `PATH` 上(`command -v lazysql` 有输出即可);没有就加一行——**和 `bun add -g` 需要的配置完全一样**:

```bash
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

软链指向仓库,`git pull` 或改完代码即时生效、无需重装;撤销在仓库内 `bun unlink`。

### 升级

```bash
npm i -g @vascent/lazysql@latest      # bun: bun add -g @vascent/lazysql@latest
```

从源码安装的走 `git pull`,软链即时生效。

### 卸载

```bash
npm un -g @vascent/lazysql            # bun: bun remove -g @vascent/lazysql;从源码: bun unlink
```

卸载只移除程序本身。配置与历史(连接、密码、SQL 历史)留在 `~/.config/lazysql/`,如需彻底清除:

```bash
rm -rf ~/.config/lazysql
```

> macOS 上若曾设 `LAZYSQL_SECRETS=keychain`,密码存在系统钥匙串里,删 `~/.config/lazysql` 不会清掉——在「钥匙串访问」中搜索 `lazysql` 手动删除对应条目。

## 🚀 用法

```bash
lazysql                   # 打开默认(第一个已保存的)连接
lazysql <name>            # 按 id / 名称打开已保存的连接
lazysql <file.db>         # 临时打开一个 SQLite 文件
lazysql --list            # 列出已保存的连接并退出
```

首次运行会自动生成 `~/.config/lazysql/connections.yml`。进入 TUI 后:按 `?` 看完整键位、`` ` `` 切换连接、`n` 新建连接——其余见下方「键位」。

## ⌨️ 键位

vim 风格,面板式。下面按上下文分组;完整列表在 app 内按 `?` 查看(footer 与帮助都从同一张键位表渲染,永不漂移)。

**全局**

| 键 | 作用 |
|----|------|
| `` ` `` | 切换连接(回到选择器) |
| `:` | 打开 SQL 编辑器 |
| `^O` | 展开 / 收起 SQL 编辑器 |
| `^G` | 用自然语言生成 SQL |
| `tab` | 在树 ↔ 结果间切焦点 |
| `^H` / `^L` | 直接聚焦树 / 结果网格 |
| `^⇧-` / `^⇧+` | 收窄 / 加宽连接侧栏 |
| `!` | 重新打开当前错误详情 |
| `F12` | 切换运行时调试控制台(日志 / 未处理异常) |
| `?` | 切换帮助 |
| `q` | 退出 |

写入被拒、连接丢失或导出失败时会自动弹出完整错误详情。`esc` / `⏎` 关闭;`!` 可重新打开保留的详情。

**侧栏(树)**

| 键 | 作用 |
|----|------|
| `k` / `j` · `↑` / `↓` | 移动选择 |
| `⏎` / `space` | 展开 / 折叠 / 打开对象 |
| `→` / `l` | 展开 |
| `←` / `h` | 折叠 / 跳到父节点 |
| `a` | 干净 `SELECT *` 浏览选中表 |
| `v` | 标记 / 取消标记一张表以批量导出(多选) |
| `X` | 导出——已标记的表,否则节点下所有表(schema / 类别),否则当前这张 |
| `esc` | 清空所有导出标记 |
| `g` / `G` | 跳到首 / 尾 |
| `D` | 查看对象的 DDL / 结构 |
| `d` | 把 `DROP` 草拟进编辑器 |
| `r` | 刷新连接与对象树 |
| `n` / `e` | 新建 / 编辑连接 |
| `x` | 移除选中的连接 |

**结果网格**

| 键 | 作用 |
|----|------|
| `k` / `j` | 移动行光标 |
| `h` / `l` · `←` / `→` | 移动列光标 · 宽表横向滚动 |
| `g` / `G` | 跳到首 / 尾行 |
| `^u` / `^d` | 上 / 下半页 |
| `⏎` | 检查完整单元格值 |
| `a` | 浏览选中表(`SELECT *`) |
| `s` | 循环排序(升 → 降 → 无) |
| `/` | 按列子串筛选 |
| `d` | 删除行(`⏎` 检查后按 `e` 编辑单元格) |
| `X` | 导出当前视图——浏览的表导出 CSV / JSON / SQL(含筛选与排序),查询结果导出 CSV / JSON |
| `n` / `p` | 下 / 上一页 |
| `D` | 切换 Data / DDL 标签 |

**SQL 编辑器**

| 键 | 作用 |
|----|------|
| `⏎` | 运行查询(结果显示在网格) |
| `⇧⏎` | 插入换行——编写多行 SQL |
| `tab` | 接受补全,否则切到下一面板 |
| `^P` / `^N` | 上 / 下一条历史 |
| `^T` | 开关 schema 感知补全 |
| `^G` | 从自然语言生成 SQL(`esc` 或点击任一面板/SQL 编辑区退出输入;`esc` 可取消生成) |
| `↑` / `↓`(Ask AI) | 召回上一条 / 下一条已提交 prompt(仅存内存,切换连接后清空) |
| `^C` | 清空草稿 |
| `esc` | 回到结果网格 |

**确认弹窗**

| 键 | 作用 |
|----|------|
| `y` | 应用待执行的写操作 / 执行导出 |
| `n` | 取消 |
| `f` | 循环导出格式(CSV / JSON / SQL)——仅导出确认 |

**单元格检查器**

| 键 | 作用 |
|----|------|
| `j` / `k` · `↑` / `↓` | 滚动值 |
| `e` | 就地编辑该单元格 |
| `y` | 复制完整值到剪贴板 |
| `q` / `esc` / `⏎` | 关闭 |

**新建 / 编辑连接表单**

| 键 | 作用 |
|----|------|
| `↑` / `↓` | 在驱动与字段间移动 |
| `←` / `→` | 切换驱动(在 Driver 行) |
| `^R` | 显示 / 隐藏密码 |
| `^T` | 测试连接(不保存) |
| `⏎` | 保存连接 |
| `esc` | 取消 |

数据库在跳板机后面时,在 **SSH** 行填 `user@host[:port]`(或 `~/.ssh/config` 里的 Host 别名),**SSH key** 行可选填私钥路径——详见下方「SSH 隧道」。

## ⚙️ 配置

均位于 `~/.config/lazysql/`:

| 文件 | 内容 |
|------|------|
| `connections.yml` | 连接配置,**不含密码**,可手动编辑 |
| `secrets.json` | 密码(`chmod 600`) |
| `config.yml` | 应用设置(含 NL→SQL 的 `llm:` 块) |
| `history.json` | 每个连接的 SQL 历史(各上限 100 条) |

密码默认存 `secrets.json`;macOS 上设 `LAZYSQL_SECRETS=keychain` 改用系统钥匙串(零 native 依赖)。

### SSH 隧道

给连接加一个 `ssh:` 块(或在 in-TUI 表单里填 SSH 行),即可穿过跳板机连数据库。lazysql 调用系统 `ssh` 做本地端口转发,所以 `~/.ssh/config`、密钥和 agent 全部生效——`host` 可以直接写 config 里的 Host 别名:

```yaml
connections:
  - id: prod
    name: prod
    driver: postgres
    options:
      host: db.internal        # 从跳板机视角的地址
      port: 5432
      user: app
      database: app
    ssh:
      host: bastion.example.com   # 或 ~/.ssh/config 的 Host 别名
      user: ubuntu                # 可选
      port: 22                    # 可选
      keyFile: ~/.ssh/id_ed25519  # 可选(-i);agent/config 里的密钥无需填
```

适用于 PostgreSQL / MySQL / MongoDB / Redis,且仅支持离散的 `host`/`port` 选项——`url`/`connectionString` 形式无法走隧道(URL 内嵌的 host 无法改写)。认证**仅支持 key/agent**:TUI 独占终端,SSH 的交互式密码提示无法应答(强制 `BatchMode`,需要提示的连接会快速失败并带回 ssh 的报错,而不是挂住)。

走隧道的 MongoDB 连接会自动固定 `directConnection=true`——副本集成员的真实地址只在隧道对端可达。SSH 链路死掉时,keepalive 会让 ssh 在约 90 秒内自行退出,而不是端着一个不通的转发;按 `r` 重连即可。

### NL→SQL(LLM)

provider 经 `SqlGenerator` 端口隔离;**不配密钥则 `^G` 静默关闭**。可在 `config.yml` 固定,或用环境变量临时覆盖(env 优先)。**API key 只从环境读,绝不写入 config.yml。**

`config.yml`:

```yaml
llm:
  provider: alibaba        # anthropic | alibaba | openai | deepseek
  model: qwen3.7-plus      # 可选,覆盖默认模型
  # baseUrl: https://...   # 可选,覆盖默认 base URL(如海外节点)
```

| Provider | id | API key 环境变量 | 默认模型 |
|----------|----|------------------|----------|
| Alibaba Cloud(Qwen) | `alibaba` | `DASHSCOPE_API_KEY` | `qwen3.7-plus` |
| OpenAI | `openai` | `OPENAI_API_KEY` | `gpt-4o` |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` | `deepseek-chat` |
| Anthropic(Claude) | `anthropic` | `ANTHROPIC_API_KEY` | `claude-opus-4-8` |

未显式指定 `provider` 时,按「哪个 API key 存在」自动探测(Qwen 优先、Anthropic 最后)。每次运行还可用 `LAZYSQL_LLM_PROVIDER` / `LAZYSQL_LLM_MODEL` / `LAZYSQL_LLM_BASE_URL` 覆盖。

```bash
export DASHSCOPE_API_KEY=sk-xxx && lazysql              # 默认 Qwen
ANTHROPIC_API_KEY=sk-ant-xxx LAZYSQL_LLM_PROVIDER=anthropic lazysql  # 临时切 Claude
```

## 🏗️ 架构

**技术栈**:`TypeScript(strict)` · `Bun` · `OpenTUI`(`@opentui/react` + React 19)· `Zustand` · `yaml`。LLM 经 `@anthropic-ai/sdk` + 任意 OpenAI 兼容后端(Qwen / OpenAI / DeepSeek)。

**Clean / Hexagonal** 分层,核心是**能力分段(capability-segmented)的 `DataSource` 端口**——UI 询问数据源「支持哪些能力」(`Queryable` / `Browsable` / `RowEditable` / `Transactional` / …)而非「是什么类型」,所以新增一个数据库 = 新增一个 adapter,核心零修改。跨层一律经 `Result<T,E>` + port 握手,内层永不依赖外层。

```
src/
  domain/         纯业务规则 / 实体 / 值对象(无 IO)
  application/    ports(出站接口)+ usecases(用例编排)
  adapters/       datasource · llm · persistence · clipboard(连真实 IO)
  presentation/   app · components · keymap · tree(TUI,单向数据流 + Zustand)
  shared/         跨层纯工具(如 Result)
```

设计的事实来源是 **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**;关键决策记录见 **[docs/adr/](docs/adr/)**(能力模型、TUI 框架、NL→SQL provider 策略、键位派发等)。

## 🛠️ 开发

> 需要 [Bun](https://bun.sh)。SQLite 用 Bun 内置的 `bun:sqlite`,无 native 依赖。

```bash
bun install        # 安装依赖
bun run seed       # 生成样例库 data/sample.db
bun start          # 从源码运行(「用法」里的启动参数同样适用,如 bun start <name>)
```

### 测试

```bash
bun run typecheck   # 严格类型检查
bun test            # 单元 + 五引擎适配器契约 + 持久化 + 无头 TUI 集成
```

「完成」的客观裁判是 `bun run typecheck && bun test` 全绿。每个数据源适配器都过**同一套契约测试**(LSP 的可执行验收);契约测试需可达真实库,**不可达自动跳过**,所以无 Docker 的机器不会失败。要跑全契约,起对应容器即可:

```bash
# PostgreSQL
docker run -d --name lazysql-pg -e POSTGRES_PASSWORD=lazysql \
  -e POSTGRES_USER=lazysql -e POSTGRES_DB=lazysql -p 5432:5432 postgres:16-alpine
# MySQL / MariaDB
docker run -d --name lazysql-mysql -e MARIADB_ROOT_PASSWORD=lazysql -p 3306:3306 mariadb:11
# MongoDB
docker run -d --name lazysql-mongo -p 27017:27017 mongo:7
# Redis
docker run -d --name lazysql-redis -p 6379:6379 redis:7-alpine
```

贡献者请先读 **[CLAUDE.md](CLAUDE.md)**(工作守则:分层、命名、提交规范)与 **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**。提交走 Conventional Commits(`.githooks` + commitlint 强制),`bun install` 时 `prepare` 脚本会把 `core.hooksPath` 指向 `.githooks`。

## 📄 许可

[MIT](LICENSE) © yangwb
