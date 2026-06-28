import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { TwitterApi } from "twitter-api-v2";
import { z } from "zod";

const app = express();

app.use(
  cors({
    origin: "*",
    exposedHeaders: ["Mcp-Session-Id"],
    allowedHeaders: ["Content-Type", "Mcp-Session-Id"],
  })
);
app.use(express.json());

const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY || "",
  appSecret: process.env.TWITTER_API_SECRET || "",
  accessToken: process.env.TWITTER_ACCESS_TOKEN || "",
  accessSecret: process.env.TWITTER_ACCESS_SECRET || "",
});

/**
 * Creates and configures a fresh McpServer instance with all tools registered.
 */
function createMcpServer() {
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

  return server;
}

// sessionId -> { server, transport }
const transports = {};

// Modern Streamable HTTP endpoint - Poke ve diğer güncel MCP istemcileri burayı kullanır
app.post("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"];

    let entry = sessionId ? transports[sessionId] : undefined;

    if (!entry) {
      if (!isInitializeRequest(req.body)) {
        return res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Geçerli bir oturum bulunamadı (initialize bekleniyor)" },
          id: null,
        });
      }

      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports[id] = { server, transport };
          console.log(`MCP oturumu başlatıldı: ${id}`);
        },
      });

      res.on("close", () => {
        if (transport.sessionId) {
          delete transports[transport.sessionId];
          console.log(`MCP oturumu kapandı: ${transport.sessionId}`);
        }
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    await entry.transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP POST hatası:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "İç sunucu hatası" },
        id: null,
      });
    }
  }
});

// Sunucudan istemciye bildirimler için (GET) - SSE akışı
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  const entry = sessionId ? transports[sessionId] : undefined;

  if (!entry) {
    return res.status(400).send("Geçersiz veya eksik oturum ID");
  }

  await entry.transport.handleRequest(req, res);
});

// Oturumu sonlandırmak için (DELETE)
app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  const entry = sessionId ? transports[sessionId] : undefined;

  if (!entry) {
    return res.status(400).send("Geçersiz veya eksik oturum ID");
  }

  await entry.transport.handleRequest(req, res);
});

app.get("/", (_req, res) => {
  res.send("Twitter MCP Server çalışıyor");
});

// --- Geriye dönük uyumluluk: eski SSE transport (Poke gibi bazı istemciler bunu bekliyor) ---
const sseTransports = new Map();

app.get("/sse", async (req, res) => {
  try {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;
    sseTransports.set(sessionId, transport);
    console.log(`SSE bağlantısı açıldı. Session ID: ${sessionId}`);

    // Render gibi proxy'lerin bağlantıyı timeout ile kapatmasını önlemek için
    // periyodik olarak yorum satırı (heartbeat) gönderiyoruz.
    const heartbeat = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch (_) {
        clearInterval(heartbeat);
      }
    }, 15000);

    req.on("close", () => {
      console.log(`SSE bağlantısı kapandı: ${sessionId}`);
      clearInterval(heartbeat);
      sseTransports.delete(sessionId);
      try {
        transport.close?.();
      } catch (_) {}
    });

    const server = createMcpServer();
    await server.connect(transport);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("SSE başlatma hatası:", errorMessage);
    if (!res.headersSent) {
      res.status(500).send(`SSE başlatılamadı: ${errorMessage}`);
    }
  }
});

app.post("/messages", async (req, res) => {
  const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : "";

  if (!sessionId) {
    return res.status(400).send("sessionId eksik");
  }

  const transport = sseTransports.get(sessionId);

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

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ${PORT}`);
});
