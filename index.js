import express from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { TwitterApi } from 'twitter-api-v2';
import z from 'zod';

// Vercel'in bağlantıyı koparmasını (timeout) engelleyen modern akış ayarı:
export const config = {
  runtime: 'nodejs',
  supportsResponseStreaming: true,
};

const app = express();

// Tüm kaynaklardan (Poke AI) gelen isteklere izin ver
app.use(cors({ origin: '*' }));
app.use(express.json());

// X (Twitter) API Bağlantısı
const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

// Resmi MCP Sunucu Tanımı
const server = new McpServer({
  name: "twitter-mcp",
  version: "1.0.0"
});

// Tweet Atma Aracı (Tool)
server.tool(
  "post_tweet",
  "X (Twitter) hesabından yeni bir tweet atar veya bir tweete cevap verir.",
  { 
    text: z.string().describe("Atılacak tweetin metni"),
    replyToId: z.string().optional().describe("Eğer bir tweete cevap verilecekse, o tweetin ID'si (Opsiyonel)")
  },
  async ({ text, replyToId }) => {
    try {
      let result;
      if (replyToId) {
        // Eğer replyToId gelirse tweete cevap yazar
        result = await twitterClient.v2.tweet(text, {
          reply: { in_reply_to_tweet_id: replyToId }
        });
      } else {
        // Normal tweet atar
        result = await twitterClient.v2.tweet(text);
      }
      return { content: [{ type: "text", text: `Başarılı! Tweet gönderildi. ID: ${result.data.id}` }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Twitter API Hatası: ${error.message}` }], isError: true };
    }
  }
);

let transport = null;

// 1. Poke AI'ın beklediği Canlı SSE Akış Kapısı
app.get('/sse', async (req, res) => {
  transport = new SSEServerTransport('/api/mcp', res);
  await server.connect(transport);
});

// 2. Poke AI'ın POST isteklerini göndereceği yol
app.post('/api/mcp', async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(500).send('SSE baglantisi henüz kurulmadi veya aktif degil.');
  }
});

// Anasayfa mesajı
app.get('/', (req, res) => {
  res.send('Twitter MCP Server aktif. Lütfen Poke AI entegrasyonunda /sse uzantısını kullanın.');
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(3000, () => console.log('Yerel sunucu 3000 portunda aktif.'));
}

export default app;