import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { TwitterApi } from "twitter-api-v2";
import { z } from "zod"; // Poke AI ve SDK'nın beklediği Zod doğrulaması

const app = express();

// Dışarıdan gelecek Poke AI istekleri için CORS kilidini açıyoruz
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

// Poke AI'ın tam istediği gibi Zod ile sarmalanmış Twitter Tool yapısı
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
        // Tweete cevap verme senaryosu
        result = await twitterClient.v2.tweet(text, {
          reply: { in_reply_to_tweet_id: replyToId }
        });
      } else {
        // Normal yeni tweet atma
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

// Canlı SSE akış kapısı
app.get("/sse", async (req, res) => {
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

// Kontrol için anasayfa rotası
app.get("/", (req, res) => {
  res.send("Twitter MCP Server Render üzerinde canavar gibi çalışıyor!");
});

// Render dinamik port ayarı
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running");
});