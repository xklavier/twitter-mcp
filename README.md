# Twitter MCP Server

A modern Model Context Protocol (MCP) server for posting tweets to X (formerly Twitter) via the Twitter API v2. Built with Express.js, this server implements a robust, production-ready architecture with support for both modern Streamable HTTP transport and legacy SSE transport.

## Features

- **Streamable HTTP Transport**: Modern bidirectional communication protocol for MCP clients (Poke, Claude, and other current implementations)
- **SSE Fallback Transport**: Legacy Server-Sent Events support for older clients
- **Session Management**: Automatic idle session cleanup with configurable timeout (default 5 minutes)
- **CORS Support**: Cross-origin requests enabled for flexible client integration
- **Error Handling**: Comprehensive try-catch blocks prevent crashes on individual request failures
- **Tweet Posting**: Post new tweets or reply to existing tweets via the Twitter API v2

## How It Works

### Streamable HTTP Transport

The server uses the `StreamableHTTPServerTransport` from the Model Context Protocol SDK, which provides a modern, stateless HTTP-based communication layer:

- **POST /mcp**: Clients send MCP requests and receive responses
- **GET /mcp**: Clients establish a persistent connection to receive server notifications
- **DELETE /mcp**: Clients cleanly terminate sessions

Each client is identified by an `mcp-session-id` header. Sessions are stored in memory and automatically cleaned up after 5 minutes of inactivity.

### Session Cleanup & Idle Timeout

The server implements an idle timeout mechanism to prevent memory leaks:

- Sessions are tracked with a `lastSeen` timestamp (updated on every request)
- A background interval runs every 60 seconds, removing sessions idle for more than 300 seconds (5 minutes)
- Clients can explicitly delete sessions via DELETE /mcp, which bypasses the timeout

This ensures that dropped client connections don't accumulate indefinitely in server memory.

### Available Tools

#### post_tweet

Post a new tweet or reply to an existing tweet.

**Parameters:**
- `text` (string, required): The tweet text (minimum 1 character)
- `replyToId` (string, optional): The tweet ID to reply to

**Response:**
Returns the newly created tweet's ID on success, or an error message on failure.

**Example:**
```json
{
  "text": "Hello, world!",
  "replyToId": "1234567890"
}
```

## Environment Variables

Configure the server using the following environment variables:

- `TWITTER_API_KEY`: Your Twitter API v2 API Key (Consumer Key)
- `TWITTER_API_SECRET`: Your Twitter API v2 API Secret (Consumer Secret)
- `TWITTER_ACCESS_TOKEN`: Your OAuth 1.0a Access Token
- `TWITTER_ACCESS_SECRET`: Your OAuth 1.0a Access Secret
- `PORT`: The port the server listens on (default: 3000)

Obtain these credentials from the [Twitter Developer Portal](https://developer.twitter.com/en/portal).

## Getting Started

### Prerequisites

- Node.js 18+ (ES modules support required)
- A Twitter API v2 developer account with elevated access

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/xklavier/twitter-mcp.git
   cd twitter-mcp
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   export TWITTER_API_KEY=your_api_key
   export TWITTER_API_SECRET=your_api_secret
   export TWITTER_ACCESS_TOKEN=your_access_token
   export TWITTER_ACCESS_SECRET=your_access_secret
   ```

4. Start the server:
   ```bash
   npm start
   ```

The server will listen on `0.0.0.0:3000` by default.

## Deployment to Render

Render provides free and paid hosting for Node.js applications with automatic deployments from GitHub.

### Step-by-Step Deployment

1. **Push to GitHub**: Ensure your repository is public or linked to your Render account.

2. **Create a Render Account**: Visit [render.com](https://render.com) and sign up.

3. **Connect Your Repository**:
   - Go to your Render dashboard
   - Click "New +" and select "Web Service"
   - Connect your GitHub account
   - Select the `xklavier/twitter-mcp` repository

4. **Configure the Service**:
   - **Name**: Choose a service name (e.g., `twitter-mcp`)
   - **Environment**: Select "Node"
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Choose Free (with limitations) or Paid

5. **Add Environment Variables**:
   - In the Render dashboard, go to your service's "Environment" tab
   - Add the following variables:
     - `TWITTER_API_KEY`
     - `TWITTER_API_SECRET`
     - `TWITTER_ACCESS_TOKEN`
     - `TWITTER_ACCESS_SECRET`
   - Do NOT commit these to Git—add them only in Render's dashboard

6. **Deploy**:
   - Click "Create Web Service"
   - Render will automatically build and deploy your application
   - Your service will be available at `https://<your-service-name>.onrender.com`

### Post-Deployment

- **Monitoring**: View logs in the Render dashboard under "Logs"
- **Redeploy**: Push new commits to GitHub; Render will automatically rebuild and redeploy
- **Scaling**: Upgrade your plan if you need more performance or persistent uptime

## Alternative Deployment: Vercel

If you prefer Vercel, you can use the included `vercel.json` configuration.

### Steps
1. **Connect Repository**: Import the project into your Vercel dashboard.
2. **Environment Variables**: Add `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, and `TWITTER_ACCESS_SECRET` in the project settings.
3. **Deploy**: Vercel will detect the configuration and deploy the server as a Serverless Function.

## Architecture

### File Structure

- **index.js**: Main server implementation with MCP transport handlers
- **package.json**: Node.js dependencies and scripts
- **vercel.json**: Optional Vercel deployment configuration (alternative to Render)

### Design Highlights

- **Stateless HTTP**: The Streamable HTTP transport allows horizontal scaling—sessions live in memory but are independent
- **Clean Separation**: Session management, transport handling, and tool logic are clearly separated
- **Error Resilience**: Route handlers include comprehensive error handling to prevent crashes
- **Memory Efficiency**: Automatic session cleanup prevents unbounded memory growth

## Troubleshooting

### Server Fails to Start

- **Port Already in Use**: Change the `PORT` environment variable (e.g., `PORT=3001`)
- **Missing Environment Variables**: Ensure all four Twitter API credentials are set

### Tweet Posting Fails

- **Invalid Credentials**: Verify your API keys and tokens in the Twitter Developer Portal
- **Rate Limiting**: The Twitter API enforces rate limits; wait before retrying
- **Tweet Too Long**: X enforces a 280-character limit for most tweets (higher for premium accounts)

## License

This project is provided as-is. Refer to your repository for licensing details.

## Contributing

Contributions are welcome! Feel free to fork, enhance, and submit pull requests.
