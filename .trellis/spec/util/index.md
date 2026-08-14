# 跨运行时工具层（Utility Layer）

> 通用工具：字节归一化、错误模型、重试策略、纯 JS 密码学、随机数。
> 这些工具是项目跨运行时（JavaScriptCore / Node 测试环境）生存的基础，
> 任何新增的网络/二进制/错误处理代码都应复用本层。

---

## 层范围

| 文件 | 职责 |
|------|------|
| `src/util/bytes.ts` | 字节归一化（`normalizeBytes` / `normalizeBytesSync`）、Base64 编解码、字节拼接 |
| `src/util/error.ts` | `makeError`（双属性错误）、`completeError`（转 Bob 格式） |
| `src/util/retry.ts` | `withRetry` 指数退避重试 |
| `src/util/crypto.ts` | 纯 JS SHA-256（FIPS 180-4），无外部依赖 |
| `src/util/random.ts` | `randomHex32` 随机 ID |
| `src/util/async.ts` | `delay` 延迟工具 |

---

## 字节归一化（`src/util/bytes.ts`）—— 最高频的坑

Bob 环境中二进制数据可能以任意形态出现（`number[]`、Node `Buffer`、Blob shim、`ArrayBuffer`、带 `toByteArray()` 的对象、字符串），**处理前必须先归一化**：

- `normalizeBytes(value): Promise<number[]>` —— 异步版本，支持 Blob/ArrayBuffer（内部调 `arrayBuffer()`）。
- `normalizeBytesSync(value): number[]` —— 同步版本，仅支持同步类型；已知输入为同步类型时使用。
- 检测顺序：`null` → `Array` → `Buffer`（`typeof Buffer !== 'undefined'` 守卫）→ `toByteArray()` → `_shimBlob.bytes` → `arrayBuffer()` → 类数组 → 字符串（Latin-1 低 8 位）→ 空数组。

规则：
- 所有对宿主 API 的引用必须加 `typeof` 守卫（`Buffer`、`$data`、`atob` 同理），因为同一份代码会跑在有无这些 API 的不同环境。
- `bytesToBase64`：优先 `$data.fromByteArray(bytes).toBase64()`（Bob 环境），回退 `Buffer`，两者都无才抛错。
- `base64ToBytes`：兼容标准 Base64 与 base64url（`-_` → `+/`），供 JWT payload 解码使用。
- `concatBytes`：预分配总长度数组再填充（避免扩容开销），用于拼接分块/帧音频。

反模式：手写 `Array.from(new Uint8Array(...))` 处理所有输入（漏掉 Blob shim 形态）；对 `response.blob()` 结果直接当 `number[]` 用。

## 错误模型（`src/util/error.ts`）

**`makeError` 是本项目唯一允许的错误构造方式**：

```ts
throw makeError('api', 'Azure 认知服务 429：...', detail, 429);
//              type    message                        addtion  statusCode
```

- 同时写入带 `_` 前缀与不带前缀的属性（`type/_type`、`message/_message`、`addtion/_addtion`、`statusCode/_statusCode`）：带前缀供 `completeError` 读取，不带前缀便于标准 Error 上下文使用。
- `addtion` 是 Bob 规范拼写（非 typo），携带调试信息（原始错误、响应体等）。
- `statusCode` 必须传——`retry.ts` 的默认重试条件优先依赖它判断 429/5xx。

错误类型约定（`type` 字段）：`'api'`（服务端/网络错误）、`'unsupportLanguage'`（语种不支持）、`'unknown'`（兜底）。`completeError` 从未知 Error 提取 `_type`，缺失时回退 `'unknown'`。

**入口统一收尾**：`completeError(completion, err)` 把 Error 转成 Bob 格式 `{ error: { type, message, addtion } }`，只在 `main.ts` 的 catch 中调用。

## 重试策略（`src/util/retry.ts`）

`withRetry(fn, { maxRetries, baseDelayMs, retryOn? })` 通用重试器，指数退避：`等待 = baseDelayMs × 2^attempt`。

默认重试条件（`DEFAULT_RETRY_ON`）：
- Error 带 `statusCode` 且为 **429 或 5xx** → 重试；
- 无 `statusCode` 时回退消息匹配：`429` / `5\d{2}` / `timeout` / `ECONNRESET`；
- 非 Error 实例（网络层原始异常）→ 重试。

规则：
- Provider 层所有网络请求走 `withRetry`，参数按 Provider 在 [Provider 层](./providers/index.md#http-rest-provider-模式) 的表中配置。
- 需要自定义判定时传 `retryOn`（暂无现成用例，但接口已预留）。
- 4xx（除 429 外）默认**不**重试——构造错误时务必带 `statusCode`，否则消息匹配可能误判。

## 纯 JS 密码学（`src/util/crypto.ts`）

JavaScriptCore 无 Web Crypto，`crypto.ts` 提供无依赖的 SHA-256 实现（FIPS 180-4）：

- `sha256Hex(message)`：大写十六进制摘要，用于 Edge 协议的 Sec-MS-GEC 签名。
- `sha256Bytes(bytes)`：字节摘要。
- 文件末尾 `(globalThis as ...).__sha256Bytes = sha256Bytes`：**桥接给 `vendor/bob-shim.js`**——shim 基于它实现 HMAC-SHA256 并注入 `crypto.subtle`。esbuild 会把 `crypto.ts` 打进 bundle，使 `__sha256Bytes` 在运行时全局可用。

规则：
- 使用 HMAC（如 azure-token 签名）走 `crypto.subtle`（shim 注入），不要在此文件外另写 HMAC。
- `sha256Hex` 仅支持 Latin-1 范围输入（码点 ≤ 0xFF）——Edge 签名的输入都是 ASCII，够用。
- **不要**引入 `node:crypto`——会破坏 JavaScriptCore 兼容性（构建脚本 `scripts/build.js` 例外，它跑在 Node）。

## 其他工具

- `randomHex32()`（`util/random.ts`）：32 位大写十六进制随机串，用于连接 ID / 请求 ID / UUID 等标识。基于 `Math.random()`，够用即可，无需加密级随机。
- `delay(ms)`（`util/async.ts`）：`setTimeout` 封装，用于批量请求错峰。

## 常见错误

- 在 Provider / core 里手写 Base64、手写重试循环、手写 SHA-256（必须复用本层）。
- 忘记 `typeof` 守卫导致在 Node 单测环境引用 `$data` / `Buffer` 崩掉。
- `makeError` 不传 `statusCode`，导致 429 限流不重试。
- 修改 `crypto.ts` 的 `__sha256Bytes` 导出桥接时不同步验证 `vendor/bob-shim.js` 的 HMAC（两者耦合）。
