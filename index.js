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

// Poke'un istediği Çoklu Bağlantı Hafıza Havuzu (Map)
const activeTransports = new Map();

// GET /sse - Akışı başlatan ana kapı
app.get("/sse", async (req, res) => {
  console.log("Poke'dan yeni bir SSE bağlantı isteği geldi.");

  // 1. Render/Nginx buffer katmanını kırmak için header'ı Express seviyesinde ayarlıyoruz
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // 2. SDK'nın yazma (write) metodunu takibe alıyoruz (Hooking)
  // SDK res.write yaptığında Render/Nginx araya sıkışmasın diye veriyi anında dışarı fırlatıyoruz (flush)
  const originalWrite = res.write;
  res.write = function (...args) {
    const result = originalWrite.apply(this, args);
    if (res.flushHeaders) res.flushHeaders();
    if (res.flush) res.flush();
    return result;
  };

  // 3. İstemcinin query ile gönderdiği veya bizim ürettiğimiz sessionId
  const sId = req.query.sessionId || `session-${Date.now()}`;
  
  // 4. Transport oluşturuluyor (Yol eşitlemesi yapıldı)
  const transport = new SSEServerTransport("/messages", res);
  
  // Havuza kayıt
  activeTransports.set(sId, transport);
  console.log(`Bağlantı havuzlandı. Session ID: ${sId}`);

  // 5. Sunucuya bağlıyoruz. Await burayı kilitlemesin diye catch bloğuyla koruyoruz
  try {
    await server.connect(transport);
    
    // Bağlantı başarılı kurulduğu an ilk veriyi ittirmek için flush tetikliyoruz
    if (res.flushHeaders) res.flushHeaders();
    if (res.flush) res.flush();
  } catch (err) {
    console.error("MCP server.connect hatası:", err);
    activeTransports.delete(sId);
    return;
  }

  // Bağlantı koptuğunda temizlik rutinleri
  req.on("close", () => {
    console.log(`Bağlantı kapandı, havuzdan siliniyor: ${sId}`);
    try {
      transport.close();
    } catch (e) {}
    activeTransports.delete(sId);
  });
});

// POST /messages - Gelen komutları doğru session'a uçuran kapı
app.post("/messages", async (req, res) => {
  const { sessionId } = req.query;
  
  // Belirli bir sessionId gelmişse onu seç, yoksa havuzdaki ilk aktif hattı kurtarıcı olarak kullan
  let transport = activeTransports.get(sessionId);
  if (!transport && activeTransports.size > 0) {
    transport = activeTransports.values().next().value;
  }

  if (transport) {
    try {
      await transport.handlePostMessage(req, res);
    } catch (err) {
      console.error("POST mesaj işleme hatası:", err);
      res.status(500).send("Mesaj işlenirken hata oluştu.");
    }
  } else {
    res.status(400).send(`Aktif SSE bağlantısı bulunamadı. Gelen SessionId: ${sessionId || 'Yok'}`);
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