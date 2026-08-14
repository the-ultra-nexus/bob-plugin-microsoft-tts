# 入口契约层（Entry / Bob Interface Layer）

> 负责与 Bob 运行时对接的代码：入口函数、配置选项读取、请求参数构建、全局类型声明。
> 这些代码是 Bob 插件规范（回调式 API）与内部纯逻辑之间的**唯一**适配层。

---

## 层范围

| 文件 | 职责 |
|------|------|
| `src/main.ts` | Bob 入口：导出 `supportLanguages()` 与 `tts(query, completion)` |
| `src/runtime/bob-options.ts` | 安全读取 Bob 注入的 `$option` 全局变量 |
| `src/service/synthesis-request.ts` | 将 Bob 查询/选项转换为标准化 `SynthesisRequest` |
| `src/types.ts` | 所有跨模块共享类型 + Provider ID 单一数据源 |
| `src/config.ts` | `USER_AGENT`、语言映射表、默认语音表 |
| `src/globals.d.ts` | Bob 全局变量（`$option`/`$data`/`$http`/`$websocket`）的类型声明 |

---

## 入口函数约定（`src/main.ts`）

Bob 运行时通过模块导出契约调用插件，**必须导出**两个函数：

1. `supportLanguages(): BobLang[]` —— 返回支持语言列表，委托给 `service/synthesis-request.ts` 的同名函数。
2. `tts(query: BobQuery, completion: Completion): void` —— 合成入口。

**关键模式：`tts` 不支持直接返回 Promise，必须走 `completion` 回调。**

```ts
// src/main.ts —— 标准模式，新增流程时照抄此结构
export function tts(query: BobQuery, completion: Completion): void {
    void (async () => {
        const request = createSynthesisRequest(query, getRuntimeOptions());
        const bytes = await synthesizeWithProvider(request);
        completion({
            result: { type: 'base64', value: bytesToBase64(bytes), raw: {} },
        });
    })().catch((err: Error) => {
        completeError(completion, err);
    });
}
```

要点：
- 用 **async IIFE + `.catch()`** 包裹，禁止改为 `async function` 直接返回 Promise。
- 成功载荷固定为 `{ result: { type: 'base64', value, raw: {} } }`（TTS 插件结果类型只能是 `'base64'`，见 `types.ts` 中 `BobResult`）。
- 失败统一交给 `completeError(completion, err)`（`util/error.ts`），不要在入口处手写 `completion({ error: ... })`。
- 文件顶部必须先 `require('../vendor/bob-shim.js')`（注入 fetch / crypto.subtle 等 Web API），且位于其他 import 之前。

## 选项读取（`src/runtime/bob-options.ts`）

Bob 通过全局 `$option` 注入用户配置（键值均为字符串）。读取规则：

- `getRuntimeOptions(): OptionBag` —— 从 `$option` 读取；`$option` 未定义（非 Bob 环境）时返回 `{}`，**不要**直接抛错。
- `readOption(options, key): string | undefined` —— 安全读取单个键；值非字符串时返回 `undefined`，**不要**做隐式类型假设。

```ts
// 正确：先判 undefined 再使用，调用方负责兜底默认值
const voice = readOption(options, 'zh-CN-speaker') || defaultVoices['zh-CN'];
```

禁止模式：直接访问 `$option` 全局（绕过类型安全层）；对配置值做 `as string` 强转。

## 请求构建（`src/service/synthesis-request.ts`）

`createSynthesisRequest(query, options): SynthesisRequest` 是入口层唯一出口，职责：

1. `resolveLocale(query.lang)`：`BobLang` → `Locale` 映射（`langMap` 由 `config.ts` 的 `supportedLanguages` 构建），未知语种抛 `makeError('unsupportLanguage', '不支持该语种')`。
2. `readProviderOption(options)`：读 `provider` 选项，未知值回退（委托 `providers/index.ts` 的 `resolveProviderId`）。
3. 各参数读取顺序：`readOption(options, '<locale>-speaker') || defaultVoices[locale]`，其余参数 `||` 固定默认值（`'+0%'` / `'+0Hz'` / `'general'` / `'audio-24khz-48kbitrate-mono-mp3'`）。
4. `customEndpoint` 读取后必须 `.trim()`。

所有默认值集中在 `src/config.ts`（`defaultVoices`）与 `synthesis-request.ts` 函数体内——新增配置项时同步检查这两处。

## 类型与常量单一数据源（`src/types.ts`）

- `PROVIDER_IDS = [...] as const` 是 Provider 标识的唯一事实来源；`ProviderId` 与 `VALID_PROVIDER_IDS` 均由它派生。
- 新增 Provider 必须同步：`PROVIDER_IDS` + `providers/index.ts` 注册表 + `info.json` 的 options.menuValues + `README.md` 的 Provider 表。
- `SynthesisProvider = (params: SynthesisRequest) => Promise<number[]>` 是 Provider 统一签名，见 [Provider 层](../providers/index.md)。
- 跨模块共享的接口（`SynthesisParams`、`BobHttpRequestOptions` 等）集中在此文件，**不要**在消费模块里重复定义。

## 配置表（`src/config.ts`）

- `USER_AGENT`：模拟 Edge 浏览器的 UA，所有对外 HTTP 请求复用（`providers/` 与 `core/azure-token.ts` 引用），新请求一律带上。
- `supportedLanguages: Array<[BobLang, Locale]>`：数组顺序 = `supportLanguages()` 输出顺序 = Bob 面板展示顺序，新增语种时注意顺序语义。
- `defaultVoices: Record<Locale, string>`：默认发音人，键为 `Locale`。

## 常见错误

- 在 `main.ts` 之外直接调用 `completion` 回调（回调只在入口出现）。
- 修改 `types.ts` 的 `BobLang` / `Locale` 联合类型时忘记更新 `config.ts` 的映射表（两处必须同步）。
- 在 `globals.d.ts` 中声明 `declare function` 而非 `declare const`（这些是全局变量不是函数）。
- 在入口层写业务逻辑（如 SSML 构建、重试）——这些必须下沉到 `core/` 或 `providers/`。
