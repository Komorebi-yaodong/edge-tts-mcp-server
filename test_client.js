import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";
import { fileURLToPath } from "url";
// === 配置 ===
// 1. 根据你的截图，服务器文件在 src/index.ts
const SERVER_REL_PATH = "src/index.ts";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, SERVER_REL_PATH);
async function main() {
    console.log("🚀 Starting MCP Test Client...");
    // 2. 配置传输层 (Stdio)
    // 关键修改：将 command 改为 "npx"，args 改为 ["tsx", ...]
    // 这样子进程也会用 tsx 运行，避免 ESM 报错
    const transport = new StdioClientTransport({
        command: "npx",
        args: ["tsx", SERVER_PATH],
        // 如果你需要测试代理，取消下面注释
        // env: { 
        //   ...process.env, 
        //   HTTPS_PROXY: "http://127.0.0.1:7890" 
        // }
    });
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    try {
        console.log(`🔌 Connecting to server at ${SERVER_PATH}...`);
        await client.connect(transport);
        console.log("✅ Connected!");
        console.log("YZ Listing tools...");
        const toolsList = await client.listTools();
        const toolNames = toolsList.tools.map(t => t.name).join(", ");
        console.log(`🛠️ Available tools: [${toolNames}]`);
        const inputPayload = {
            segments: [
                {
                    speech_content: "Hello testing.",
                    voice_id: "zh-CN-YunxiMultilingualNeural",
                    speech_rate: 10
                }
            ]
        };
        console.log("\n🎤 Invoking tool 'batch_generate_speech'...");
        const result = await client.callTool({
            name: "batch_generate_speech",
            arguments: inputPayload,
        });
        console.log("\n📦 Result Received:");
        if (result.content && result.content[0] && result.content[0].type === 'text') {
            const jsonResult = JSON.parse(result.content[0].text);
            console.log(JSON.stringify(jsonResult, null, 2));
        }
        else {
            console.log("Raw result:", result);
        }
    }
    catch (error) {
        console.error("\n❌ Error during test execution:", error);
    }
    finally {
        await transport.close();
        process.exit(0);
    }
}
main();
