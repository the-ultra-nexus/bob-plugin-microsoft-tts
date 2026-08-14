# 纯逻辑核心层（Core Logic Layer）

> 领域逻辑：SSML 构建、音频字节格式、长文本分块、Azure Token 获取。
> 本层应保持与 Bob 运行时解耦（不直接读 `$option`、不直接调 `completion`），
> 以便独立测试和跨 Provider 复用。

---

## 层范围

| 文件 | 职责 |
|------|------|
| `src/core/ssml.ts` | SSML 构建与 XML 转义 |
| `src/core/audio.ts` | PCM → WAV 封装、音频魔数检测 |
| `src/core/text-split.ts` | 长文本按句子边界分块 |
| `src/core/azure-token.ts` | Azure 认知服务端点 Token 获取、HMAC 签名、JWT 解码、缓存 |

> 注意：`azure-token.ts` 是唯一直接使用网络（`fetch`）的 core 文件，因为 Token 获取是
> 认证领域逻辑而非 Provider 特有实现。其余 core 文件均为纯函数。

---

## SSML 构建（`src/core/ssml.ts`）

`buildSsml(options: SynthesisRequest): string` 是唯一 SSML 生成入口，所有 Provider（azure-cognitive / azure-trial / edge-tts）复用。

规则：
- **必须 XML 转义**：文本、voice、locale 全部经 `escapeXml` 处理（`& < > " '` → 实体），防止 SSML 注入。这是安全红线，新增属性拼接时不要跳过。
- **`xml:lang` 跟随 voice**：由 `voiceToLocale` 从 voice 名前缀推导（`en-GB-RyanNeural` → `en-GB`），voice 无匹配前缀（如 openai-gateway 自定义 voice 名）时回退 `options.locale`。因为 `en-*语音` 菜单可选用任意英语区域语音（美式/英式等），固定用 `options.locale` 会与 voice 不匹配。默认语音（如 `zh-CN-XiaoxiaoNeural` → `zh-CN`）行为不变。
- `style` 非空时生成 `<mstts:express-as style="..." styledegree="2.0">` 包裹 `<prosody>`；否则仅 `<prosody rate pitch volume>`。`style` 值本身不转义（来自 `info.json` 的固定枚举），但也不要拼接用户输入。
- `rate` / `pitch` / `volume` 有兜底默认（`'+0%'` / `'+0Hz'` / `'+0%'`）。

反模式：字符串模板直接插值文本而不转义；在 Provider 里各写一份 SSML 模板（必须复用 `buildSsml`）。

## 音频字节处理（`src/core/audio.ts`）

两个纯函数：

1. `rawPcmToWavBytes(pcmBytes, sampleRate): number[]` —— 把 raw PCM 封装为 WAV（固定单声道、16bit、44 字节头）。`azure-trial.ts` 用它把 24kHz PCM 转成可播放 WAV。WAV 头字段用模块内私有小工具（`setUInt16LE` / `setUInt32LE` / `writeAscii`）写入，新增字段时注意字节偏移。
2. `looksLikeAudioBytes(bytes): boolean` —— 前 4 字节魔数检测（RIFF / ID3 / `0xFF 0xE0+` MP3 帧 / OggS），用于过滤非音频响应。仅做快速过滤，不保证完整校验。

字节表示约定：全项目二进制统一为 `number[]`（0–255），WAV 头与音频数据写入时对每个字节 `& 0xff` 截断。

## 长文本分块（`src/core/text-split.ts`）

`splitText(text, maxChunkSize = 1500): string[]`：

- 句子边界：`。！？\n`（按 `text.split(/[。！？\n]/)`）。
- 单句超过上限 → 按 `maxChunkSize` 强制截断。
- 相邻短句合并（用 `。` 连接）直到接近上限，避免碎片化请求。
- 返回块均过滤空串。

被 `azure-cognitive.ts` 的分块流程使用；新增 Provider 需要分块时复用此函数，不要另写。

## Azure Token 获取（`src/core/azure-token.ts`）

模拟 Microsoft Translator Android 客户端认证流程，核心点：

1. **签名**：`sign()` 用 HMAC-SHA256 对 `MSTranslatorAndroidApp + encodeURIComponent(url) + 日期 + UUID`（全小写）签名，`crypto.subtle` 由 bob-shim 注入（见 [项目总索引](../index.md#运行时约束最高优先级违反即出-bug)）。
2. **JWT 解码**：`decodeJwtPayload()` 兼容 base64url（`-_` 替代 `+/`、可无 padding），失败抛 `makeError('api', ...)`。
3. **缓存策略**（`getAzureEndpoint`）：
   - 令牌缓存于模块级 `tokenCache`，**过期前 3 分钟**（`TOKEN_REFRESH_BEFORE_EXPIRY`）视为有效直接返回；
   - 刷新失败时若缓存仍有 token，**即使过期也回退使用缓存**并 `console.warn`；
   - 无缓存可用才 `resetTokenCache()` 并抛错。
   - 缓存是模块级单例——测试或需要强制刷新时调用 `resetTokenCache()`。

反模式：每次请求都重新获取 Token（浪费）；把 `HMAC_KEY_B64` 等签名常量散落到其他文件；用 `JSON.parse(atob(jwt))` 而不经 `base64ToBytes`（bob-shim 的 `atob` 虽已兼容 base64url，但统一走 `util/bytes.ts` 的 `base64ToBytes` 更一致）。

## 常见错误

- 在 `core/` 里直接访问 `$option` / `$websocket` 等 Bob 全局（破坏层解耦，导致无法在 Node 环境单测）。
- 新增 SSML 属性时绕过 `escapeXml`。
- 分块逻辑与 `text-split.ts` 重复实现（曾造成分块行为不一致的隐患）。
- 忽略 `azure-token.ts` 的缓存语义，自行在 Provider 里缓存 Token。
