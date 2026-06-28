import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { TwitterApi } from "twitter-api-v2";
import { z } from "zod";

const app = express();

// Tüm kaynaklardan (Poke AI) gelen isteklere izin ver
app.use(cors({ origin: '*' }));
app.use(express.json());

// X (Twitter) API Bağlantısı
const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY || '',
  appSecret: process.env.TWITTER_API_SECRET || '',
  accessToken: process.env.TWITTER_ACCESS_TOKEN || '',
  accessSecret: process.env.TWITTER_ACCESS_SECRET || '',
});

const server = new McpServer({
  name: "twitter-mcp",
  version: "1.0.0",
});

// Twitter Tool Yapısı
server.tool(
  "post_tweet",
  "Post a new tweet or reply to X (Twitter)",
  {
    text: z.string().describe("The tweet text"),
    replyToId: z.string().optional().describe("Optional ID of tweet to reply to")
  },
  async ({ text, replyToId }) => {
    try {
      let result;
      if (replyToId) {
        result = await twitterClient.v2.tweet(text, {
          reply: { in_reply_to_tweet_id: replyToId }
        });
      } else {
        result = await twitterClient.v2.tweet(text);
      }
      return {
        content: [{ type: "text", text: `Tweet başarıyla gönderildi. ID: ${result.data.id}` }]
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Twitter API Hatası: ${error.message}` }],
        isError: true
      };
    }
  }
);

let transport;

// Poke AI ekibinin buffer kilidini kıran yeni /sse endpoint'i
app.get("/sse", async (req, res) => {
  // 1. SSE header'larını anında ayarla (Render/Nginx buffer'lamayı kapatır)
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no" 
  });

  // 2. Header'ları anında istemciye fırlat
  if (res.flushHeaders) {
    res.flushHeaders();
  }

  console.log("Poke bağlandı. Transport başlatılıyor...");
  
  // 3. Transport'u bağla
  transport = new SSEServerTransport("/api/mcp", res);
  await server.connect(transport);
});

// Araçların tetikleneceği POST kapısı
app.post("/api/mcp", async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("No active session");
  }
});

// Kontrol rotası
app.get("/", (req, res) => {
  res.send("Twitter MCP Server Render üzerinde canavar gibi çalışıyor!");
});

// Render dinamik port ayarı
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running");
});