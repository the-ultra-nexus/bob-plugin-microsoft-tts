# 项目开发规范（Trellis Spec）

> Bob（macOS 翻译/朗读软件）的 Microsoft TTS 语音合成插件。
> 通过 Edge TTS / Azure 认知服务 / Azure 体验服务 / OpenAI 兼容网关四种 Provider 合成音频，
> 零 API Key，运行在 JavaScriptCore 环境（无 Node.js / 浏览器 API）。

---

## 架构分层

本项目是单仓库（无 packages 配置），按代码依赖方向分为四层：

| 层 | 目录 | 职责 | 入口文件 |
|----|------|------|---------|
| [入口契约层](./entry/index.md) | `src/main.ts`, `src/runtime/`, `src/service/`, `src/types.ts`, `src/config.ts`, `src/globals.d.ts` | 对接 Bob 运行时契约：入口函数、选项读取、请求构建、全局类型 | `src/main.ts` |
| [Provider 层](./providers/index.md) | `src/providers/` | 各 TTS 后端实现与路由中心（注册表、回退、重试、分块） | `src/providers/index.ts` |
| [纯逻辑核心](./core/index.md) | `src/core/` | 领域逻辑：SSML 构建、音频格式、文本分块、Azure Token | `src/core/ssml.ts` 等 |
| [跨运行时工具](./util/index.md) | `src/util/` | 通用工具：字节归一化、错误模型、重试、纯 JS 密码学 | `src/util/bytes.ts` 等 |

依赖方向：`main.ts → service → providers → core / util`。`core` 与 `util` 之间互相依赖（如 `core/ssml.ts` 依赖 `types`，`core/azure-token.ts` 依赖 `util/error`）。

其余思考指南见 [guides/](./guides/index.md)。

---

## Pre-Development Checklist（编码前必读）

- [ ] 读本任务涉及层的 `index.md`（含本页运行时约束）
- [ ] 确认改动是否跨越层边界（如新 Provider 会同时触及 `providers/`、`types.ts`、`info.json`、`README.md`）
- [ ] 确认不引入 Node.js 专属 API（`fs` / `path` / `Buffer` 直接使用等）——运行环境是 JavaScriptCore，见下方运行时约束
- [ ] 确认错误通过 `makeError` 构造（而不是 `throw new Error(...)`）

## Quality Check（编码后必查）

- [ ] `pnpm typecheck` 通过
- [ ] 新增/修改的常量是否同时更新了所有使用处（见 [pre-modification rule](./guides/index.md#pre-modification-rule-critical)）
- [ ] 中文错误消息，遵循现有消息风格
- [ ] 不修改 `vendor/bob-shim.js` 除非是运行时兼容性修复（该文件独立于 src/ 编译）

---

## 运行时约束（最高优先级，违反即出 bug）

Bob 插件运行在 **JavaScriptCore 环境**，与 Node.js / 浏览器完全不同：

1. **无 Node.js API**：没有 `fs`、`path`、`process`、原生 `Buffer`（可通过 `typeof Buffer` 检测）。所有宿主 API 必须通过 `typeof` 守卫或 bob-shim 注入使用。
2. **Web API 由 `vendor/bob-shim.js` 注入**：`fetch`（包装 `$http`）、`crypto.subtle`（基于 `util/crypto.ts` 的纯 JS SHA-256）、`atob`/`btoa`、`TextEncoder`、`setTimeout`。`src/main.ts` 顶部必须先 `require('../vendor/bob-shim.js')` 再执行任何依赖这些 API 的代码。
3. **二进制数据以 `number[]` 为统一表示**（每项 0–255）。所有来自 Blob / Buffer / shim 对象的数据必须经 `util/bytes.ts` 的 `normalizeBytes` 归一化后才能处理。
4. **Bob 全局变量**：`$option`（用户配置）、`$data`（Base64 编码）、`$http`（HTTP）、`$websocket`（WebSocket，Bob 1.6.0+）。它们的类型声明在 `src/globals.d.ts`，代码中直接以全局变量名引用。
5. **`tts` 入口不支持返回 Promise**：必须通过 `completion` 回调返回结果，详见 [入口契约层](./entry/index.md)。

## 验证命令

```bash
pnpm typecheck   # 类型检查（主要验证手段，项目无自动化测试）
pnpm build       # 完整构建：esbuild 打包 → zip → appcast → release notes
```

---

**语言**：本目录规范一律使用中文书写。
