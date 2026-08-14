# Provider 层（TTS Backend Layer）

> 不同 TTS 后端（Edge WebSocket / Azure REST / OpenAI 兼容网关）的实现与路由中心。
> 每个 Provider 是独立可插拔的合成后端，统一签名、统一错误、统一重试。

---

## 层范围

| 文件 | 职责 |
|------|------|
| `src/providers/index.ts` | 路由中心：注册表、`resolveProviderId` 回退、测试注入、空/格式校验 |
| `src/providers/edge-tts/` | Edge 大声朗读 WebSocket 协议（`index.ts` 主流程 / `protocol.ts` 协议构建 / `frame.ts` 二进制帧解析） |
| `src/providers/azure-cognitive.ts` | Azure 认知服务 REST，支持长文本分块、批量并发、重试 |
| `src/providers/azure-trial.ts` | Azure 免费体验端点（accfreetrial），raw PCM → WAV |
| `src/providers/openai-gateway.ts` | OpenAI 兼容 `/v1/audio/speech` 网关，参数格式转换 |

---

## Provider 契约

每个 Provider 导出**一个**异步合成函数，签名统一为：

```ts
// src/types.ts
export type SynthesisProvider = (params: SynthesisRequest) => Promise<number[]>;
```

约定：
- 入参：完整的 `SynthesisRequest`（text / voice / locale / rate / pitch / volume / style / outputFormat / providerId / customEndpoint）。
- 出参：音频字节数组（`number[]`，0–255），**由 Provider 负责把原始响应归一化为字节**（用 `util/bytes.ts` 的 `normalizeBytes`）。
- 返回的音频类型：`edge-tts` / `azure-cognitive` 返回 MP3，`azure-trial` 返回 WAV（raw PCM 经 `rawPcmToWavBytes` 封装），`openai-gateway` 返回网关原始格式。
- 错误必须用 `makeError(type, message, addtion?, statusCode?)` 构造，其中 `statusCode` 供重试策略结构化判断（见 [util 层](../util/index.md)）。

## 路由中心（`src/providers/index.ts`）

三层结构：

1. **注册表** `defaultProviders: Record<ProviderId, SynthesisProvider>` —— 新增 Provider 必须在此登记。
2. **测试注入** `setProviderOverrides(overrides)` —— 允许测试覆盖注册表；生产代码不要调用。
3. **入口** `synthesizeWithProvider(request)`：

```ts
export async function synthesizeWithProvider(request: SynthesisRequest): Promise<number[]> {
    const providerId = resolveProviderId(request.providerId, request.customEndpoint);
    const provider = _providerOverrides[providerId] || defaultProviders[providerId];
    if (!provider) throw makeError('api', `未找到 TTS Provider：${providerId}`);

    const bytes = await normalizeBytes(await provider({ ...request, providerId }));
    if (bytes.length === 0) throw makeError('api', '后端返回的音频数据为空');
    if (providerId === 'openai-gateway' && !looksLikeAudioBytes(bytes)) {
        throw makeError('api', '自建网关没有返回可播放音频，请确认填写的是 /v1/audio/speech 完整 URL');
    }
    return bytes;
}
```

**回退规则（`resolveProviderId`）**——违反会导致用户配置静默失效：
- `providerId` 为空或不在 `VALID_PROVIDER_IDS` → 回退 `'azure-cognitive'`（**不是** edge-tts）。
- `providerId === 'openai-gateway'` 但 `customEndpoint` 不是 `http` 开头 → 回退 `'azure-cognitive'`。

路由中心做**跨 Provider 通用**校验（空数据、openai 网关音频格式），Provider 内的特化校验由各 Provider 自己完成。

## HTTP REST Provider 模式（azure-cognitive / azure-trial / openai-gateway）

统一骨架：**构建请求 → fetch → 校验状态码 → 解析响应 → 归一化字节 → （可选）格式转换**。

```ts
// azure-trial.ts 的典型片段
const response = await fetch(URL, { method: 'POST', headers: {...}, body: ... });
if (!response.ok) {
    let detail = '';
    try { detail = await response.text(); } catch (_) {}
    throw makeError('api', detail ? `Azure 体验服务 ${response.status}：${detail}` : `...无响应体`, detail, response.status);
}
```

规则：
- **状态码校验必带 `statusCode` 参数**（`makeError` 第 4 参）——`util/retry.ts` 的默认重试条件依赖它判断 429/5xx。
- 非 2xx 时尽量附带响应体文本作为 `detail`（`addtion`），失败读取用 `try/catch` 吞掉。
- 请求头必须带 `USER_AGENT`（来自 `config.ts`）；`Content-Type` 按端点要求（`application/ssml+xml` / `application/json`）。
- 对不稳定端点（429 频发）整体包 `withRetry`，重试参数见下表：

| Provider | maxRetries | baseDelayMs | 说明 |
|----------|-----------|-------------|------|
| azure-cognitive 单块 | 3 | 500 | `fetchAudioChunkWithRetry` |
| azure-trial 整体 | 2 | 1000 | raw PCM → WAV |
| openai-gateway 整体 | 2 | 1000 | 网关请求 |

## 长文本分块与批量并发（azure-cognitive）

`src/providers/azure-cognitive.ts` 是唯一做分块的 Provider，参数集中为常量：

```ts
const MAX_CHUNK_SIZE = 1500;   // 单块字符上限
const MAX_CHUNKS = 40;         // 超过则拒绝合成
const BATCH_SIZE = 3;          // 批内并发数
const BATCH_DELAY_MS = 800;    // 批次间延迟
```

流程：文本 ≤ 1500 直接请求 → 否则 `splitText()`（见 [core 层](../core/index.md)）→ `processBatchedChunks` 分批并发（批内第 2 个起错开 200ms）→ `concatBytes` 拼接。调整这些常量时注意与 `info.json` 的说明、README 保持一致。

## WebSocket Provider 模式（edge-tts）

`src/providers/edge-tts/` 拆三个文件，各司其职：

| 文件 | 职责 |
|------|------|
| `index.ts` | 连接生命周期：`$websocket` 能力检测、打开/收帧/收文/错误监听、超时、`turn.end` 后拼接 |
| `protocol.ts` | 纯函数构建协议：`buildWebSocketUrl`（含 Sec-MS-GEC 签名）、`buildWebSocketHeaders`、`buildSpeechConfig`、`makeSsmlMessage` |
| `frame.ts` | 纯函数解析二进制帧：`extractAudioPayload`（2 字节大端 header 长度 + header + payload） |

关键约定：
- **能力检测**：`typeof $websocket === 'undefined'` 时抛 `makeError('api', 'Edge TTS 需要 Bob 1.6.0+ 的 $websocket API')`。
- **生命周期防护**：`done()` 用 `finished` 标志保证只 resolve/reject 一次；`cleanup()` 清理定时器并关闭 socket。
- **超时保护**：全局超时 60s，但回调触发时若实际经过时间 < 5s（`MIN_ELAPSED_SEC`）则忽略——防止运行时定时器 shim 异常导致误超时。新增监听器时保持这个模式。
- 音频帧在 `listenReceiveData` 中累积，`listenReceiveString` 收到 `Path:turn.end` 时 `concatBytes` 返回。
- SSML 消息必须用 `makeSsmlMessage`（时间戳带 `'Z'` 后缀是协议兼容性要求，见 `protocol.ts` 注释，不要移除）。
- Edge 协议仅支持 MP3：`resolveOutputFormat` 对非 mp3 格式回退 `DEFAULT_OUTPUT_FORMAT`（`audio-24khz-96kbitrate-mono-mp3`，注意与入口层默认 `48kbitrate` 不同——这是协议层默认，不是笔误）。

## 参数格式转换（openai-gateway）

Azure SSML 格式（`'+50%'` / `'+10Hz'`）与 OpenAI 兼容 API（`1.5` / `'10'`）的转换函数集中在 `openai-gateway.ts`，均为**纯函数 + 正则**，解析失败回退默认值：

```ts
rateToSpeed('+50%')            // → 1.5
pitchToHz('-5Hz')              // → '-5'
volumeToVoicecraftVolume('+0%') // → '0'
resolveOpenAiSpeechEndpoint('https://api.example.com') // → '.../v1/audio/speech'
```

规则：转换失败**不要抛错**，回退中性值（speed 1.0 / pitch '0' / volume '0'）；端点补全幂等（已以 `/v1/audio/speech` 结尾则不重复追加）。

## 常见错误

- 新 Provider 忘记在 `defaultProviders` 注册 → 路由中心抛"未找到 TTS Provider"。
- 抛错时不带 `statusCode` → 重试策略退化到字符串匹配，429 可能不重试。
- 直接返回 `response.blob()` 原始对象而不归一化为 `number[]`（路由中心与 Bob 都期望 `number[]`）。
- 在 Provider 里重复实现 `normalizeBytes` / `concatBytes`（必须复用 `util/bytes.ts`）。
- 忽略 `resolveProviderId` 的 openai-gateway 端点校验，导致空端点直连网关。
