# ADR 0004：LLM Provider 策略 —— 端口即抽象，Provider 即注册项

- 状态：已接受
- 日期：2026-06-25
- 取代：ADR 0002「技术栈」中关于 LLM 选 **Vercel AI SDK** 的设想（见下「背景」）

## 背景

需求要求 NL→SQL 由 LLM 生成。最初设想用 **Vercel AI SDK（`ai`）** 取其「provider 无关」。
Phase 4 实际落地时改用官方 `@anthropic-ai/sdk` 直连 Claude——因为**真正提供 provider 无关性的
不是某个 SDK，而是 `SqlGenerator` 出站端口本身**。应用层只依赖端口，换 provider = 换适配器。

现在用户要求把默认模型切到**阿里云百炼（Bailian / Model Studio）的 Qwen（`qwen3.7-plus`）**。
这正是检验上述判断的时机：新增一个 provider 应当**只动 `adapters/llm/`**。

## 决策

**保留 `SqlGenerator` 端口不变，新增 provider 走「适配器 + 注册项」两层扩展点**，与
`createDataSource` 的数据源注册表同构：

> 落到目录上，与 `datasource/`（`registry.ts` 在根、`dialects/`·`drivers/` 在子目录）同构：
> 工厂 `createSqlGenerator.ts` 与共享 `prompt.ts` 在 `adapters/llm/` 根，具体 provider 实现集中在
> `adapters/llm/providers/`。

1. **`OpenAiCompatibleSqlGenerator`（一个适配器，服务一类 provider）**
   百炼、DeepSeek、Moonshot/Kimi、本地 Ollama/vLLM 都暴露 **OpenAI 兼容** 的
   `/chat/completions`。它们的差异仅是 `{ baseURL, model, apiKey }`，因此**共用一个适配器**。
   用 forced function-calling 拿到结构化 `{ sql, explanation }`，并对「无视 `tool_choice` 的模型」
   兜底解析 content。走**原生 `fetch`**（线格式小而稳定、零依赖、保持单二进制精简），日后若需
   流式可在该文件内换成官方 `openai` SDK，外部无感。

2. **`providers/presets.ts`（注册表）** —— 每个 OpenAI 兼容 provider 是一条 **preset**
   `{ id, label, baseURL, apiKeyEnv, defaultModel }`。新增 provider = 加一条 preset，**零新代码**。
   百炼 preset：`baseURL = https://dashscope.aliyuncs.com/compatible-mode/v1`、
   `apiKeyEnv = DASHSCOPE_API_KEY`、`defaultModel = qwen3.7-plus`。

3. **`createSqlGenerator(env)`（工厂/组合根）** —— LLM 版的 `createDataSource`：
   - 显式：`LAZYSQL_LLM_PROVIDER=anthropic|alibaba|openai|deepseek|…`(provider id）
   - 否则按密钥**自动探测**（存在 `DASHSCOPE_API_KEY` 优先 Qwen，否则 `ANTHROPIC_API_KEY` → Claude）
   - 都没有 → `null`，NL→SQL 静默关闭（`^G` 提示隐藏）
   - 覆盖项：`LAZYSQL_LLM_MODEL`、`LAZYSQL_LLM_BASE_URL`

**默认 provider = Qwen（百炼）**：当配置了 `DASHSCOPE_API_KEY` 时自动选用。Claude 适配器保留，
随时经 `LAZYSQL_LLM_PROVIDER=anthropic` 或仅配 `ANTHROPIC_API_KEY` 切回。

## 为什么不删掉 Claude 适配器

多 provider 共存的成本几乎为零（端口已就位），却换来：①运行期可切换/对照；②证明端口抽象对
**两种完全不同的 SDK/线格式**都成立（Anthropic Messages tool-use vs OpenAI chat-completions
function-calling）——这本身就是架构的可执行证据。删了反而要在日后重建工厂层。

## 影响与边界

- **改动面**：全部落在 `adapters/llm/` + 组合根 `main.tsx` 一行装配。`domain/`、`application/`、
  `presentation/` **零改动**——再次兑现 DIP/OCP。
- **测试**：`createSqlGenerator.test.ts` 以注入 `env` 纯校验选择逻辑（无网络、无密钥）。真实模型
  调用不进 CI（耗费 token / 需密钥），与 Claude 路径一致。
- **安全链路不变**：生成的 SQL 仍只**填入编辑器供审查**，破坏性语句红色 ⚠，绝不自动执行（§5.2）。

## 撤退路径

若某 provider 不满足 OpenAI 兼容（如需特殊鉴权/流式协议），为其单独写一个适配器实现
`SqlGenerator` 即可，注册表与工厂结构不变。端口是稳定边界。

## 后续修订（2026-07-22）：生成请求可取消

`SqlGenerator.generate(input, signal?)` 接受调用方的 `AbortSignal`。presentation 负责一次 Ask AI 请求的
生命周期，`GenerateSql` 只线性透传，provider adapter 负责把 signal 交给实际 HTTP/SDK 调用。
这仍是同一个 provider-neutral 端口：取消是长耗时出站 IO 的共同契约，不属于任何一家模型的特殊能力。

取消后 presentation 立即撤销该请求的写回权；即便 provider 忽略 abort 并迟到返回，也不能覆盖 SQL 草稿。
因此取消既停止可中断的网络工作，也承担并发正确性边界，而不是仅隐藏 loading 状态。
