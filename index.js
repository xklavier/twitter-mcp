import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { TwitterApi } from "twitter-api-v2";
import { z } from "zod";

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json()); // 1. Poke'un özellikle belirttiği JSON middleware'i

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

// 2. Poke'un istediği profesyonel Hafıza Havuzu (Map)
const activeTransports = new Map();

// GET /sse - Akışı başlatan ve sessionId üreten kapı
app.get("/sse", async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  
  res.flushHeaders();

  console.log("Poke bağlandı. Transport oluşturuluyor...");

  // Transport oluşturulur oluşturulmaz arkada otomatik benzersiz bir sessionId kazanır
  const transport = new SSEServerTransport("/messages", res);
  
  // Her bağlantıyı kendi benzersiz sessionId'si ile Map'e kaydediyoruz
  activeTransports.set(transport.sessionId, transport);
  console.log(`Yeni session havaza eklendi: ${transport.sessionId}`);
  
  await server.connect(transport);

  // Bağlantı koptuğunda sadece bu kapanan spesifik session'ı temizliyoruz
  req.on("close", () => {
    console.log(`Session kapatılıyor: ${transport.sessionId}`);
    transport.close();
    activeTransports.delete(transport.sessionId);
  });
});

// POST /messages - Gelen komutları query'deki sessionId ile havuzdan eşleştiren kapı
app.post("/messages", async (req, res) => {
  // İstemciden (Poke AI) gelen URL query parametresinden sessionId'yi yakalıyoruz
  const { sessionId } = req.query;
  const transport = activeTransports.get(sessionId);

  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("Aktif SSE baglantisi bulunamadi kanka. SessionId: " + sessionId);
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