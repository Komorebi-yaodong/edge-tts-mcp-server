# Edge TTS MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

这是一个 MCP (Model Context Protocol) 服务器，集成了 **Microsoft Edge Read Aloud** 的高质量语音合成能力和 **[URUSAI!](https://urusai.cc/)** 的图床/文件存储服务。

它可以让 Claude Desktop 或 LangChain Agent 具备“说话”的能力：能够生成极其自然的中文/多语言语音，支持多片段拼接，并将生成的 MP3 音频自动上传至云端，返回可永久访问的播放链接。

## ✨ 特性

- **微软超自然语音 (Neural Voices)**: 使用 Edge 浏览器同款的 `zh-CN-Xiaoxiao` (晓晓)、`zh-CN-Yunyang` (云扬) 等高质量语音。
- **智能音频合并 (Smart Merge)**: 支持一次性输入多个文本片段，服务器会自动将它们无缝拼接成一个完整的 MP3 文件，非常适合生成长对话或有停顿的旁白。
- **精细化控制 (Precise Control)**: 支持自定义语速、语调，并能精确控制段落之间的静音时长（毫秒级）。
- **自动云端存储 (Auto Upload)**: 生成的音频文件会自动上传至 URUSAI!，直接返回公网 URL，方便在大模型对话中直接播放或通过 API 调用。

## 🧰 工具详情 (Tools)

本服务器向 MCP 客户端暴露了一个核心工具：

### `batch_generate_speech`

用于将文本转换为语音，支持批量处理和合并。

* **描述**: Generates speech from plain text, returns public audio URLs. Supports merging multiple segments.
* **输入参数 (Input Schema)**:

此工具接受一个 `segments` 数组，每个对象包含以下字段：

| 参数名             | 类型        | 必填 | 说明                                                                     |
| :----------------- | :---------- | :--- | :----------------------------------------------------------------------- |
| `speech_content` | `string`  | ✅   | **纯文本内容**。请勿使用 XML/SSML 标签，直接输入文字即可。         |
| `voice_id`       | `string`  | ❌   | 声音 ID (详见下方列表)。默认为 `zh-CN-XiaoxiaoMultilingualNeural`。    |
| `speech_rate`    | `number`  | ❌   | **语速控制** (详见下方特殊说明)。默认为 `25`。                   |
| `speech_pitch`   | `number`  | ❌   | 语调百分比。例如 `20` 为高音，`-10` 为低音。默认为 `0`。           |
| `pause_after_ms` | `number`  | ❌   | 在此片段播放结束后，插入的静音时长（毫秒）。                             |
| `merge_audio`    | `boolean` | ❌   | **仅需在第一个片段设置**。设为 `true` 将合并所有片段为一个 MP3。 |

#### 🚀 语速设置说明 (`speech_rate`)

本服务器重新定义了语速参数的数值逻辑，请务必遵守：

| 数值         | 速度描述                    | 适用场景                                           |
| :----------- | :-------------------------- | :------------------------------------------------- |
| **25** | **标准速度 (Normal)** | 默认值。适合大多数阅读、对话场景 (对应 API +25%)。 |
| **0**  | **慢速 (Slow)**       | 适合悲伤、严肃、恐怖或深沉的独白 (对应 API +0%)。  |
| **40** | **快速 (Fast)**       | 适合激动、争吵、兴奋或紧急广播 (对应 API +40%)。   |

#### 🗣️ 支持的声音列表 (`voice_id`)

支持微软 Azure/Edge 系列的大量语音，部分推荐如下：

| ID                                     | 描述      | 风格                                 |
| :------------------------------------- | :-------- | :----------------------------------- |
| `zh-CN-XiaoxiaoMultilingualNeural`   | 晓晓 (女) | **默认**，多语言，温柔，全能型 |
| `zh-CN-YunyiMultilingualNeural`      | 云逸 (男) | **默认**，多语言，稳重         |
| `zh-CN-YunyangNeural`                | 云扬 (男) | 央视播音腔，专业，阳光               |
| `zh-CN-XiaoshuangMultilingualNeural` | 晓双 (女) | 萝莉音，可爱                         |
| `zh-CN-YunxiNeural`                  | 云希 (男) | 少年音，清朗                         |
| `zh-CN-XiaomoNeural`                 | 晓墨 (女) | 文艺，情感丰富                       |

*(完整列表请参考源代码中的 `VOICE_MAP`)*

## 🦜 LangChain 集成

你可以使用 [`langchain-mcp-adapters`](https://github.com/langchain-ai/langchainjs/tree/main/libs/langchain-mcp-adapters) 将此 TTS 能力赋予你的 AI Agent。

```typescript
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { ChatAnthropic } from "@langchain/anthropic";
import { createAgent } from "langchain";

// 1. 连接 MCP 服务器
const client = new MultiServerMCPClient({
    "edge-tts": {
        transport: "stdio",
        command: "node",
        args: ["/path/to/edge-tts-mcp-server/dist/index.js"], // 指向编译后的文件
    },
});

// 2. 获取工具并创建 Agent
const tools = await client.getTools();
const agent = createAgent({
    model: "claude-3-5-sonnet-latest",
    tools,
});

// 3. 调用示例：生成一段带停顿的合并语音
await agent.invoke({
    messages: [{ 
        role: "user", 
        content: "请用云扬的声音说一句'警报！警报！'，语速要快，然后停顿一秒，再说'系统正在崩溃'，语速放慢。请合并成一个音频文件。" 
    }],
});
```

## 🚀 使用方法 (Claude Desktop)

直接修改 Claude Desktop 的配置文件以在本地运行。

### 1. 找到配置文件

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

### 2. 添加配置

```json
{
  "mcpServers": {
    "edge-tts": {
      "command": "npx",
      "args": [
        "-y",
	"edge-tts-mcp-server" 
      ]
    }
  }
}
```

或者git clone到本地

```
{
  "mcpServers": {
    "edge-tts": {
      "command": "node",
      "args": [
	"项目的绝对路径（/.../edge-tts-mcp-server）/dist/index.js" 
      ]
    }
  }
}
```

## 🛠️ 本地开发与构建

如果你想修改代码或进行调试：

```bash
# 1. 克隆仓库 (假设你已经有代码)
# git clone ...
cd edge-tts-mcp-server

# 2. 安装依赖
pnpm install

# 3. 编译 (生成 dist/index.js)
pnpm build
```

### 环境变量 (可选)

可以使用特定的 API Token记录自己生成的音频：

- `URUSAI_API_TOKEN`: 设置上传到 api.urusai.cc 的 Token (如果未设置，服务器将匿名上传)。

## License

MIT
