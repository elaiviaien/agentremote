import fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import path from 'path';
import { config } from './config';
import { initAuth, verifyToken } from './auth';
import { apiRoutes } from './routes/api';
import { clientWsManager } from './ws/clientWs';
import { workerWsManager } from './ws/workerWs';

const app = fastify({
  logger: {
    level: config.isProduction ? 'info' : 'debug',
  },
  disableRequestLogging: config.isProduction,
  bodyLimit: 12 * 1024 * 1024,
});

async function main() {
  // Initialize default admin user
  initAuth();

  // Register plugins
  await app.register(fastifyCookie);
  await app.register(fastifyCors, {
    origin: true,
    credentials: true,
  });

  await app.register(fastifyWebsocket, {
    options: {
      maxPayload: 10 * 1024 * 1024, // 10MB
    },
  });

  // Serve static Web IDE frontend
  const staticPath = path.resolve(__dirname, '../../src/client');
  const fallbackStatic = path.resolve(__dirname, '../client');
  const clientDir = require('fs').existsSync(staticPath) ? staticPath : fallbackStatic;

  await app.register(fastifyStatic, {
    root: clientDir,
    prefix: '/',
    setHeaders(res, filePath) {
      if (/\.(html|js)$/i.test(String(filePath))) {
        res.setHeader('Cache-Control', 'no-store');
      }
    },
  });

  // Register REST API
  await app.register(apiRoutes, { prefix: '/api' });

  // Register WebSockets
  app.register(async function (fastify) {
    // Client WebSocket (Web IDE frontend)
    fastify.get('/ws/client', { websocket: true }, (connection: any, req) => {
      const socket = connection.socket || connection;
      // Auth verification
      const queryToken = (req.query as any)?.token;
      const cookieToken = (req as any).cookies?.auth_token;
      const token = queryToken || cookieToken;

      const user = token ? verifyToken(token) : null;
      if (!user) {
        socket.send(JSON.stringify({ type: 'error', message: 'Unauthorized WebSocket' }));
        socket.close(4001, 'Unauthorized');
        return;
      }

      clientWsManager.handleConnection(socket);
    });

    // Worker WebSocket (Local PC/Laptop Daemons)
    fastify.get('/ws/worker', { websocket: true }, (connection: any, req) => {
      const socket = connection.socket || connection;
      const token = (req.query as any)?.token;
      workerWsManager.handleConnection(socket, token);
    });
  });

  // Health check endpoint for Railway
  app.get('/health', async () => {
    const memory = process.memoryUsage();
    return {
      status: 'ok',
      uptime: process.uptime(),
      ramRssMb: Math.round(memory.rss / (1024 * 1024)),
      ramHeapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
    };
  });

  // Start listening
  try {
    const address = await app.listen({ port: config.port, host: config.host });
    console.log(`\n======================================================`);
    console.log(`🚀 AgentRemote Hub running at: ${address}`);
    console.log(`🔑 Admin user: '${config.adminUsername}'`);
    console.log(`🌐 Web IDE: ${address}`);
    console.log(`⚡ RAM Usage: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`);
    console.log(`======================================================\n`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
