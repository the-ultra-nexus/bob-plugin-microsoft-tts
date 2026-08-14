# 代码复用思考指南

> **目的**：写新代码前停下来想一想——是否已存在？

---

## 核心问题

**重复代码是行为不一致 bug 的头号来源。**

当复制粘贴或重写已有逻辑时：
- bug 修复无法传播
- 行为随时间分叉
- 代码库更难理解

本项目规模小（约 15 个源文件），复用错误比大项目更容易出现——因为"看起来只有两行"的复制往往会被忽略。

---

## 写新代码前

### 第一步：先搜索

```bash
# 搜索相似函数名
grep -rn "functionName" src/

# 搜索相似逻辑
grep -rn "keyword" src/
```

### 第二步：问自己

| 问题 | 若是则…… |
|------|-----------|
| 已有类似函数？ | 使用或扩展它 |
| 该模式在别处出现过？ | 遵循现有模式 |
| 是否该抽成公共工具？ | 放到正确的层（`core/` 或 `util/`） |
| 正在从别的文件复制代码？ | **停下**——提取到共享处 |

---

## 本项目的高价值复用点（实际踩过的坑）

### 1. 字节处理必须走 `util/bytes.ts`

所有二进制数据（Blob、Buffer、shim 对象、字符串）在消费前必须经 `normalizeBytes` / `normalizeBytesSync` 归一化为 `number[]`。

- **反例**：`Array.from(new Uint8Array(...))` 手写转换——漏掉 Blob shim 形态，且跨运行时行为不一致。
- **正确**：`const bytes = await normalizeBytes(await response.blob());`

### 2. 错误构造必须走 `util/error.ts` 的 `makeError`

- **反例**：`throw new Error(...)`——丢失 `type` / `statusCode`，Bob 面板无法显示、429/5xx 无法重试。
- **正确**：`throw makeError('api', '消息', detail, statusCode);`

### 3. SSML 构建必须走 `core/ssml.ts` 的 `buildSsml`

四个 Provider 中有三个发 SSML。任何新 Provider / 新端点都复用 `buildSsml`（内含 `escapeXml` 安全转义）。

### 4. 重试必须走 `util/retry.ts` 的 `withRetry`

- **反例**：每个 Provider 手写重试循环——退避参数、重试条件分叉。
- **正确**：`withRetry(() => fetchX(), { maxRetries: 3, baseDelayMs: 500 })`。

### 5. 常量单一数据源（本项目最容易漏的点）

| 常量 | 单一来源 | 同步位置 |
|------|---------|---------|
| Provider ID | `src/types.ts` 的 `PROVIDER_IDS` | `providers/index.ts` 注册表、`info.json` menuValues、`README.md` Provider 表 |
| 默认语音 | `src/config.ts` 的 `defaultVoices` | `info.json` 各 `*-speaker` 默认值 |
| 语言映射 | `src/config.ts` 的 `supportedLanguages` | `info.json`、README 语种列表 |
| UA | `src/config.ts` 的 `USER_AGENT` | 所有 HTTP 请求头 |

**规则**：改上述任何常量前先 `grep` 全仓库找使用处。

### 6. Provider 输出校验集中或复用

- 空数据校验：`synthesizeWithProvider` 已统一做（`bytes.length === 0`），Provider 内不要重复抛"音频为空"。
- 音频格式校验：`core/audio.ts` 的 `looksLikeAudioBytes` 被 `providers/index.ts` 与 `openai-gateway.ts` 复用。

---

## 何时抽象

**应该抽象**：
- 相同代码出现 3 次以上
- 逻辑复杂到容易出 bug（如字节归一化、重试）
- 多处消费同一契约（如 `SynthesisParams` 字段）

**不要抽象**：
- 只使用一次
- 一行琐碎代码
- 抽象后比重复更复杂

---

## 批量修改后检查

对多个文件做了相似修改后：

1. **复查**：是否漏掉了实例？
2. **搜索**：`grep` 确认没有遗漏。
3. **思考**：是否应该抽象？

---

## 提交前清单

- [ ] 已搜索是否已有相似代码
- [ ] 没有应共享却被复制的逻辑
- [ ] 常量定义在单一位置
- [ ] 相似模式遵循同一结构（如 Provider 都用同一骨架）
- [ ] 未在多个文件里手写 Base64 / SHA-256 / 重试 / SSML
