# 跨层思考指南

> **目的**：实现前想清楚层与层之间的数据流。

---

## 核心问题

**大多数 bug 出在层边界，而不是层内部。**

本项目常见的跨层 bug 形态：
- Bob 传入的 `BobLang`（`'zh-Hans'`）与 Azure `Locale`（`'zh-CN'`）映射不一致
- Provider 输出格式差异（MP3 vs WAV vs 网关原始格式）被消费方误假设
- Azure SSML 参数格式（`'+50%'`）与 OpenAI 兼容 API 参数格式（`1.5`）混用
- 同一常量在多个层各定义一份，改了一处漏了另一处

---

## 本项目的真实数据流

```
Bob 运行时
  │  query: { text, lang: 'zh-Hans' }   +   $option（用户配置面板）
  ▼
入口层（src/main.ts → service/synthesis-request.ts）
  │  转换：BobLang → Locale（config.supportedLanguages）
  │  组装：voice/rate/pitch/volume/style/outputFormat/customEndpoint
  │  输出：SynthesisRequest（跨层契约，src/types.ts）
  ▼
Provider 层（providers/index.ts 路由 → 具体 Provider）
  │  azure-cognitive / azure-trial：buildSsml → HTTP REST
  │  edge-tts：buildSsml → WebSocket 协议帧
  │  openai-gateway：参数格式转换 → HTTP REST
  │  输出：音频字节 number[]（MP3 / WAV / 网关原始格式）
  ▼
路由中心校验（空数据、openai 网关音频魔数）
  ▼
入口层：bytesToBase64 → completion({ result: { type: 'base64', value } })
```

### 每个箭头的关键问题

| 边界 | 格式是什么？ | 可能出什么问题？ |
|------|-------------|-----------------|
| Bob `lang` → `resolveLocale` | `BobLang` → `Locale` | 映射表漏项 → `unsupportLanguage` 错误 |
| `$option` → `SynthesisRequest` | 字符串 → 类型化字段 | 值非字符串 / 缺失 → 默认值兜底 |
| `SynthesisRequest` → Provider | 统一契约 | Provider 字段误用（如把 `text` 当 `voice`） |
| SSML → 服务端 | XML 字符串 | 文本未转义 → SSML 注入 |
| Provider 输出 → 路由校验 | `number[]` | 空数组 / 非音频数据（openai 网关常见） |
| 错误 → 入口 | `makeError` Error | 未带 `statusCode` → 重试策略失效 |

---

## 跨层改动的检查清单

### 新增 Provider 时（跨越 providers + types + info.json + README 四层）

- [ ] `types.ts` 的 `PROVIDER_IDS` 加入新 ID（单一数据源）
- [ ] `providers/index.ts` 的 `defaultProviders` 注册实现
- [ ] `info.json` 的 `provider` 选项 menuValues 加入新方案
- [ ] `README.md` 的 Provider 表、配置项表同步
- [ ] 确认回退语义：`resolveProviderId` 对未知 ID 回退 `azure-cognitive`

### 修改参数格式转换时（openai-gateway 特有）

- [ ] `rateToSpeed` / `pitchToHz` / `volumeToVoicecraftVolume` 的正则覆盖全部合法输入（`[+-]N%` / `[+-]NHz`）
- [ ] 转换失败回退中性值，不抛错
- [ ] 端点补全幂等（`resolveOpenAiSpeechEndpoint`）

### 修改 SSML / 输出格式时（core → 多 Provider）

- [ ] `buildSsml` 的改动同时验证三个消费方（azure-cognitive / azure-trial / edge-tts）
- [ ] `outputFormat` 默认值存在**两处**：入口层（`audio-24khz-48kbitrate-mono-mp3`）与 edge-tts 协议层（`audio-24khz-96kbitrate-mono-mp3`）——edge 层是协议回退，不是笔误，改时两边都要看

### 修改错误/重试语义时（util → 全层）

- [ ] `makeError` 的错误类型 `type` 保持枚举（`api` / `unsupportLanguage` / `unknown`）
- [ ] 429/5xx 场景必带 `statusCode`，否则默认重试条件会退化到消息匹配
- [ ] 错误消息统一中文，风格与现有消息一致

---

## 何时写流程文档

- 功能跨越 3+ 层
- 数据格式复杂
- 该功能曾出过 bug

本项目体量下，`SynthesisRequest` 的字段说明（`src/types.ts` 的 JSDoc）即是最好的契约文档——新字段必须补 JSDoc。

---

## 提交前清单

- [ ] 数据流从 Bob 入口到 `completion` 回调全程走通
- [ ] 每个边界格式明确、无隐式假设（尤其音频格式与参数格式）
- [ ] 跨层常量只有一处定义
- [ ] 错误路径按层正确传播（Provider `makeError` → 入口 `completeError`）
