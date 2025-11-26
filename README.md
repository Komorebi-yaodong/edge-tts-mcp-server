# Edge TTS MCP 服务器

本项目提供一个[模型上下文协议 (MCP)](https://modelcontextprotocol.io/) 服务器，可作为大型语言模型 (LLM)（如 Claude、GPT 等）的工具。它利用微软 Edge 浏览器免费的文本转语音 (TTS) 服务，将文本转换为高质量的音频。

与旧版本不同，此服务器不会将生成的音频文件保存在本地，而是**自动将其上传至 URUSAI! API**，并返回一个可公开访问的 URL。这使得客户端（例如网页聊天界面）无需额外部署，即可直接在线播放音频。

## 功能特性

-   **高质量 TTS**: 借助微软 Edge 强大而自然的语音合成技术。
-   **在线上传与托管**: 将生成的音频文件自动上传至 URUSAI! 服务，无需本地存储或自行搭建 HTTP 服务器。
-   **可配置的声音**: 支持多种声音、语速和音调的调整。
-   **智能文本切分**: 能够自动将长文本分割成较小的片段，以优雅地处理 API 的限制。
-   **基于环境变量的配置**: 通过环境变量进行安全配置，避免 LLM 直接接触敏感信息。
-   **标准 MCP 工具**: 可无缝集成到 LangChain Agents 或任何兼容 MCP 的客户端中。

## 先决条件

-   [Node.js](https://nodejs.org/) (推荐 v18 或更高版本)
-   [npm](https://www.npmjs.com/) 或其他包管理器

## 安装

1.  克隆本仓库：
    ```bash
    git clone <你的仓库URL>
    cd <你的仓库目录>
    ```

2.  安装依赖项：
    ```bash
    npm install
    ```
    必需的依赖包包括 `@modelcontextprotocol/sdk` 和 `uuid`。

## 配置

服务器通过环境变量进行配置。您可以在命令行中设置它们，或创建一个 `.env` 文件（并使用 `dotenv` 等库加载）。

| 变量 | 描述 | 默认值 |
| :--- | :--- | :--- |
| `URUSAI_API_TOKEN` | **可选**。用于上传到 URUSAI! API 的个人凭证 (Token)。如果未提供，将以匿名方式上传。 | 无 (匿名上传) |

### 配置示例

**Windows (PowerShell):**
```powershell
$env:URUSAI_API_TOKEN="your_personal_token_here"
```

**Linux / macOS:**
```bash
export URUSAI_API_TOKEN="your_personal_token_here"
```

## 运行服务器

配置完成后，即可运行服务器。如果您正在使用 TypeScript，需要先将其编译为 JavaScript。

1.  **编译 TypeScript (如果需要):**
    ```bash
    npx tsc
    ```

2.  **运行服务器:**
    ```bash
    node dist/index.js
    ```
    您应该会看到类似 `Edge TTS MCP Server (Online Upload Mode) running on stdio` 的输出，这表明 MCP 服务器已在标准输入/输出上成功运行。

## LLM 工具使用说明

服务器暴露了一个名为 `batch_generate_speech` 的工具。LLM 需要按照以下 JSON 格式提供参数：

### 输入模式 (Input Schema)

```json
{
  "segments": [
    {
      "speech_content": "你想要转换为语音的文本。",
      "voice_id": "zh-CN-XiaoxiaoMultilingualNeural", // 可选
      "speech_rate": 25, // 可选, 语速增加的百分比 (例如 25 代表 1.25 倍速)
      "speech_pitch": 0 // 可选, 音调变化的百分比
    }
  ]
}
```

### 预期输出 (Expected Output)

该工具会处理请求，并返回一个包含音频文件公开链接的 JSON 字符串。

```json
[
  {
    "text": "原始的文本片段。",
    "audio_list": [
      {
        "text": "被转换的具体文本块。",
        "audio_path": "https://i.urusai.cc/shine.mp3"
      }
    ]
  }
]
```

基于 Web 的客户端可以解析此 JSON，并使用返回的 URL 创建可播放的 `<audio>` 元素。