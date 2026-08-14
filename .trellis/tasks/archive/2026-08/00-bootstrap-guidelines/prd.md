# Bootstrap Task: Fill Project Development Guidelines

**You (the AI) are running this task. The developer does not read this file.**

The developer just ran `trellis init` on this project for the first time.
`.trellis/` now exists with empty spec scaffolding, and this bootstrap task
exists under `.trellis/tasks/`. When they want to work on it, they should start
this task from a session that provides Trellis session identity.

**Your job**: help them populate `.trellis/spec/` with the team's real
coding conventions. Every future AI session — this project's
`trellis-implement` and `trellis-check` sub-agents — auto-loads spec files
listed in per-task jsonl manifests. Empty spec = sub-agents write generic
code. Real spec = sub-agents match the team's actual patterns.

---

## Status (update the checkboxes as you complete each item)

- [x] 分析项目真实架构并重构 spec 层（删除不适用的 frontend 模板）
- [x] 按真实架构编写 4 层中文 spec（entry / providers / core / util）
- [x] 清理 guides/ 中 Trellis 自身模板残留，替换为本项目真实模式
- [x] 校验：无占位符、无断链、index 与文件集一致

## 分析结论（架构实测）

本项目是 **Bob（macOS 翻译/朗读）TTS 语音合成插件**，TypeScript 编写，esbuild
打包为单文件 CJS bundle，运行在 **JavaScriptCore 环境**（无 Node / 浏览器 API，
由 `vendor/bob-shim.js` 注入 fetch / crypto.subtle / atob 等）。`trellis init`
按启发式将项目标记为 "frontend"，生成的 React 模板（component / hooks /
state-management）与实际代码库完全不符，已删除。

真实架构四层（按依赖方向）：

1. **入口契约层**（`src/main.ts`、`src/runtime/bob-options.ts`、`src/service/synthesis-request.ts`、`src/types.ts`、`src/config.ts`、`src/globals.d.ts`）——对接 Bob 回调式 API：`tts(query, completion)` 必须走 completion 回调；`makeError` + `completeError` 错误模型。
2. **Provider 层**（`src/providers/`）——4 个 TTS 后端（edge-tts WebSocket / azure-cognitive REST 分块并发 / azure-trial PCM→WAV / openai-gateway 参数转换）+ 路由中心（注册表、`resolveProviderId` 回退、测试注入、音频校验）。
3. **纯逻辑核心**（`src/core/`）——`buildSsml`（XML 转义红线）、`rawPcmToWavBytes` / `looksLikeAudioBytes`、`splitText` 分块、`azure-token` 缓存+HMAC 签名。
4. **跨运行时工具**（`src/util/`）——`normalizeBytes` 字节归一化（跨运行时最大坑）、`makeError` 双属性错误、`withRetry` 指数退避、纯 JS SHA-256（桥接 bob-shim）。

关键事实：无自动化测试（`pnpm typecheck` 是主要验证）；`outputFormat` 默认值存在
两处（入口层 48kbitrate / edge 协议层 96kbitrate，后者是有意为之）；错误消息统一中文。

## Spec files to populate

### 分层指南（全部已填，中文）

| 文件 | 内容 |
|------|------|
| `.trellis/spec/index.md` | 总导航、架构分层、运行时约束、Pre-Dev / Quality Check、验证命令 |
| `.trellis/spec/entry/index.md` | Bob 契约：入口函数模式、选项读取、请求构建、类型单一数据源 |
| `.trellis/spec/providers/index.md` | Provider 契约、路由中心回退规则、HTTP/WebSocket 模式、分块并发、参数转换 |
| `.trellis/spec/core/index.md` | SSML 转义红线、音频字节处理、文本分块、Token 缓存语义 |
| `.trellis/spec/util/index.md` | 字节归一化、错误模型、重试条件、纯 JS 密码学与 bob-shim 桥接 |

### 思考指南（清理 Trellis 残留后重写为本项目模式）

| 文件 | 处理 |
|------|------|
| `.trellis/spec/guides/code-reuse-thinking-guide.md` | 重写：6 个本项目高价值复用点（bytes/makeError/buildSsml/withRetry/常量单一来源/输出校验） |
| `.trellis/spec/guides/cross-layer-thinking-guide.md` | 重写：真实数据流（Bob → service → providers → completion）+ 各边界问题 |
| `.trellis/spec/guides/index.md` | 触发器清单定制为本项目场景；保留 AI 评审误报验证规则 |

### 已删除

- `.trellis/spec/frontend/`（React 模板：component-guidelines、hook-guidelines、state-management、directory-structure、type-safety、quality-guidelines）——不适用于 Bob 插件项目。

---

## Completion

When the developer confirms the checklist items above are done with real
examples (not placeholders), guide them to run:

```bash
python3 ./.trellis/scripts/task.py finish
python3 ./.trellis/scripts/task.py archive 00-bootstrap-guidelines
```

After archive, every new developer who joins this project will get a
`00-join-<slug>` onboarding task instead of this bootstrap task.
