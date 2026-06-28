import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { TwitterApi } from "twitter-api-v2";
import { z } from "zod";

const app = express();

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

// Poke'un istediği global aktif transport değişkeni
let activeTransport = null;

// GET /sse - Bağlantıyı canlı tutan ve akışı başlatan kapı
app.get("/sse", async (req, res) => {
  // 1. Render/Nginx buffer'lamasın diye header'ları zorla gönderiyoruz
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  
  res.flushHeaders(); // Bağlantıyı anında fırlatıp başlatıyoruz

  console.log("Poke bağlandı. Transport başlatılıyor...");

  // 2. Transport'u oluşturup global değişkene eşitliyoruz ve MCP'ye bağlıyoruz
  const transport = new SSEServerTransport("/messages", res);
  activeTransport = transport; 
  
  await server.connect(transport);

  // 3. Bağlantı koparsa güvenli temizlik yapalım
  req.on("close", () => {
    console.log("Bağlantı kapandı, activeTransport temizleniyor.");
    transport.close();
    if (activeTransport === transport) {
      activeTransport = null;
    }
  });
});

// POST /messages - Poke'un komutları (Tool Call) göndereceği global kapı
app.post("/messages", async (req, res) => {
  if (activeTransport) {
    await activeTransport.handlePostMessage(req, res);
  } else {
    res.status(400).send("Aktif SSE baglantisi bulunamadi kanka");
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