# Edge TTS MCP Server

This project provides a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that acts as a tool for Large Language Models (LLMs) like Claude or GPT. It uses Microsoft Edge's free Text-to-Speech service to convert text into high-quality audio files.

The server saves the generated audio files locally and exposes them via a built-in HTTP server, allowing web-based clients (e.g., chat interfaces) to play the audio directly.

## Features

- **High-Quality TTS**: Leverages Microsoft Edge's powerful and natural-sounding speech synthesis.
- **Local Hosting**: Saves audio files to a local directory and serves them over HTTP for easy access in web UIs.
- **Configurable Voices**: Supports a wide range of voices, speeds, and pitches.
- **Smart Text Splitting**: Automatically splits long texts into smaller chunks to handle API limits gracefully.
- **Environment-based Configuration**: Securely configured via environment variables, not by LLM input.
- **Standard MCP Tool**: Integrates seamlessly with LangChain Agents or any MCP-compatible client.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later recommended)
- [npm](https://www.npmjs.com/) or another package manager

## Installation

1.  Clone the repository:
    ```bash
    git clone <your-repo-url>
    cd <your-repo-directory>
    ```

2.  Install the dependencies:
    ```bash
    npm install
    ```
    Required packages include `@modelcontextprotocol/sdk`, `express`, and `uuid`.

## Configuration

The server is configured using environment variables. You can set them in your shell or create a `.env` file (and use a library like `dotenv`).

| Variable          | Description                                                                 | Default                                 |
| ----------------- | --------------------------------------------------------------------------- | --------------------------------------- |
| `TTS_SAVE_PATH`   | **Required**. The absolute path to the directory where audio files will be saved. | System's temporary directory            |

### Example Configuration

**Windows (PowerShell):**
```powershell
$env:TTS_SAVE_PATH="C:\audio-output"
```

**Linux / macOS:**
```bash
export TTS_SAVE_PATH="/home/user/audio-output"
```

## Running the Server

Once configured, you can run the server. If you are using TypeScript, you need to compile it to JavaScript first.

1.  **Compile TypeScript (if applicable):**
    ```bash
    npx tsc
    ```

2.  **Run the server:**
    ```bash
    node dist/edge-tts-mcp-server.js
    ```
    You should see output confirming that the MCP server is running on stdio and the HTTP server is serving files from your configured path.

## Tool Usage for LLMs

The server exposes one tool named `batch_generate_speech`. The LLM should be instructed to provide arguments in the following JSON format:

### Input Schema

```json
{
  "segments": [
    {
      "speech_content": "The text you want to convert to speech.",
      "voice_id": "zh-CN-XiaoxiaoMultilingualNeural", // Optional
      "speech_rate": 25, // Optional, percentage increase (e.g., 25 is 1.25x)
      "speech_pitch": 0 // Optional, percentage change
    }
  ]
}
```

### Expected Output

The tool will process the request and return a JSON string containing URLs for the generated audio files.

```json
[
  {
    "text": "The original text segment.",
    "audio_list": [
      {
        "text": "The text chunk that was converted.",
        "audio_url": "http://localhost:7877/tts_0_1764095555123_abcd.mp3"
      }
    ]
  }
]
```

A web-based client can then parse this JSON and create playable `<audio>` elements using these URLs.