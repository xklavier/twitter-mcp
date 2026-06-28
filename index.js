import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { TwitterApi } from "twitter-api-v2";
import { z } from "zod";

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json());

const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY || "",
  appSecret: process.env.TWITTER_API_SECRET || "",
  accessToken: process.env.TWITTER_ACCESS_TOKEN || "",
  accessSecret: process.env.TWITTER_ACCESS_SECRET || "",
});

const server = new McpServer({
  name: "twitter-mcp",
  version: "1.0.0",
});

server.tool(
  "post_tweet",
  "Post a new tweet or reply to X (Twitter)",
  {
    text: z.string().min(1).describe("The tweet text"),
    replyToId: z.string().optional().describe("Optional ID of tweet to reply to"),
  },
  async ({ text, replyToId }) => {
    try {
      let result;

      if (replyToId) {
        result = await twitterClient.v2.tweet(text, {
          reply: { in_reply_to_tweet_id: replyToId },
        });
      } else {
        result = await twitterClient.v2.tweet(text);
      }

      return {
        content: [
          {
            type: "text",
            text: `Tweet başarıyla gönderildi. ID: ${result.data.id}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Twitter API hatası: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

const activeTransports = new Map();

app.get("/sse", async (req, res) => {
  try {
    // Render proxy buffering engellemek için
    res.setHeader("X-Accel-Buffering", "no");

    // Monkey-patch writeHead to flush headers automatically when the SDK writes them
    const originalWriteHead = res.writeHead;
    res.writeHead = function(...args) {
      const result = originalWriteHead.apply(this, args);
      res.flushHeaders?.();
      return result;
    };

    // Monkey-patch write to flush headers after every write to ensure data is sent immediately
    const originalWrite = res.write;
    res.write = function(...args) {
      const result = originalWrite.apply(this, args);
      res.flushHeaders?.();
      return result;
    };

    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;
    activeTransports.set(sessionId, transport);
    console.log(`SSE bağlantısı açıldı. Session ID: ${sessionId}`);

    req.on("close", () => {
      console.log(`Bağlantı kapandı, temizleniyor: ${sessionId}`);
      activeTransports.delete(sessionId);

      try {
        transport.close?.();
      } catch (_) {}
    });

    await server.connect(transport);
  } catch (error) {
    console.error("SSE başlatma hatası:", error);
    if (!res.headersSent) {
      res.status(500).send("SSE başlatılamadı");
    }
  }
});

app.post("/messages", async (req, res) => {
  const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : "";

  if (!sessionId) {
    return res.status(400).send("sessionId eksik");
  }

  const transport = activeTransports.get(sessionId);

  if (!transport) {
    return res.status(404).send(`Aktif transport bulunamadı. Session ID: ${sessionId}`);
  }

  try {
    await transport.handlePostMessage(req, res);
  } catch (error) {
    console.error("POST mesaj işleme hatası:", error);
    if (!res.headersSent) {
      res.status(500).send("Mesaj işlenirken hata oluştu");
    }
  }
});

app.get("/", (_req, res) => {
  res.send("Twitter MCP Server çalışıyor");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ${PORT}`);
});