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

// Poke'un istediği Hafıza Havuzu (Map)
const activeTransports = new Map();

// GET /sse - Akışı başlatan kapı
app.get("/sse", async (req, res) => {
  // 1. Buffer engelleme header'ları
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  
  res.flushHeaders();

  // 2. Çökmeyi engelleyen Benzersiz SessionID Tanımı
  // Poke ekibinin query'den göndereceği sessionId ile eşleşecek benzersiz ID'yi oluşturuyoruz
  const sId = req.query.sessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  console.log(`Bağlantı isteği geldi. Atanan Session ID: ${sId}`);

  const transport = new SSEServerTransport("/messages", res);
  
  // Havuza güvenli bir şekilde kaydediyoruz
  activeTransports.set(sId, transport);
  
  try {
    await server.connect(transport);
  } catch (err) {
    console.error("MCP Bağlantı Hatası:", err);
    activeTransports.delete(sId);
    return;
  }

  // Bağlantı koptuğunda sadece bu spesifik session'ı temizle
  req.on("close", () => {
    console.log(`Bağlantı kapandı, hafıza temizleniyor: ${sId}`);
    try {
      transport.close();
    } catch (e) {}
    activeTransports.delete(sId);
  });
});

// POST /messages - Komutları alan ve havuzdan eşleştiren kapı
app.post("/messages", async (req, res) => {
  const { sessionId } = req.query;
  
  // Eğer istemci spesifik bir sessionId göndermediyse havuzdaki ilk aktif transportu yedek olarak seç
  let transport = activeTransports.get(sessionId);
  if (!transport && activeTransports.size > 0) {
    transport = activeTransports.values().next().value;
  }

  if (transport) {
    try {
      await transport.handlePostMessage(req, res);
    } catch (err) {
      console.error("Mesaj işleme hatası:", err);
      res.status(500).send("Mesaj işlenemedi.");
    }
  } else {
    res.status(400).send(`Aktif SSE baglantisi bulunamadi kanka. Gelen SessionId: ${sessionId || 'Yok'}`);
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