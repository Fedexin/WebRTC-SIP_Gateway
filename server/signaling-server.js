// ==================== LOAD ENVIRONMENT VARIABLES ====================
require('dotenv').config();

if (!process.env.PORT && !process.env.ENABLE_SIP_GATEWAY) {
  console.warn('⚠️  WARNING: Environment variables not loaded from .env file!');
}

const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const os = require('os');
const fs = require('fs');
const winston = require('winston');

// ==================== STRUCTURED LOGGING ====================
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
          return `[${timestamp}] ${level}: ${message} ${metaStr}`;
        })
      )
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 10485760,
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 10485760,
      maxFiles: 5
    })
  ]
});

// ==================== CONFIGURAZIONE ====================
const PORT = process.env.PORT || 8080;
const ENABLE_SIP_GATEWAY = process.env.ENABLE_SIP_GATEWAY === 'true';
const ENABLE_SSL = process.env.ENABLE_SSL === 'true';

let sipGateway = null;

if (ENABLE_SIP_GATEWAY) {
  const SipGateway = require('./plugins/sipGateway');
  const SIP_CONFIG = {
    sipServerHost: process.env.SIP_SERVER_HOST || 'localhost',
    sipServerPort: parseInt(process.env.SIP_SERVER_PORT || '5060'),
    sipDomain: process.env.SIP_DOMAIN || 'localhost',
    displayName: 'WebRTC-SIP Gateway',
    localSipPort: parseInt(process.env.LOCAL_SIP_PORT || '5060'),
    rtpengineHost: process.env.RTPENGINE_HOST || 'localhost',
    rtpenginePort: parseInt(process.env.RTPENGINE_PORT || '22222'),
    publicIP: process.env.PUBLIC_IP || null,
    maxConcurrentSessions: parseInt(process.env.MAX_SESSIONS || '1000')
  };
  sipGateway = new SipGateway(SIP_CONFIG, logger);
}

// ==================== SERVER HTTP/HTTPS ====================
let server;
if (ENABLE_SSL) {
  try {
    const sslOptions = {
      key: fs.readFileSync(process.env.SSL_KEY_PATH || './ssl/server.key'),
      cert: fs.readFileSync(process.env.SSL_CERT_PATH || './ssl/server.crt')
    };
    server = https.createServer(sslOptions, handleHttpRequest);
    logger.info('HTTPS server created with SSL/TLS');
  } catch (error) {
    logger.error('Failed to load SSL certificates', { error: error.message });
    logger.warn('Falling back to HTTP server');
    server = http.createServer(handleHttpRequest);
  }
} else {
  server = http.createServer(handleHttpRequest);
  logger.info('HTTP server created (SSL disabled)');
}

function handleHttpRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/health') {
    const metrics = sipGateway ? sipGateway.getMetrics() : {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      ssl: ENABLE_SSL,
      webrtcUsers: users.size,
      activeCalls: activeCalls.size,
      sipGatewayEnabled: !!sipGateway,
      ...metrics
    }));
    return;
  }

  if (req.url === '/') {
    const protocol = ENABLE_SSL ? 'wss' : 'ws';
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html>
<html>
<head><title>WebRTC Signaling Server</title></head>
<body>
  <h1>WebRTC Signaling Server</h1>
  <p><strong>Status:</strong> Running</p>
  <p><strong>WebSocket:</strong> ${protocol}://${getLocalIP()}:${PORT}</p>
  <p><strong>SSL:</strong> ${ENABLE_SSL ? '✅ Enabled' : '❌ Disabled'}</p>
  <p><strong>Active Users:</strong> ${users.size}</p>
  <p><strong>Active Calls:</strong> ${activeCalls.size}</p>
  <p><strong>SIP Gateway:</strong> ${ENABLE_SIP_GATEWAY ? '✅ Enabled' : '❌ Disabled'}</p>
  <p><a href="/health">Health Check</a></p>
</body>
</html>`);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}

// ==================== WEBSOCKET SERVER ====================
const wss = new WebSocket.Server({
  server,
  perMessageDeflate: false,
  maxPayload: 65536
});

logger.info('WebSocket server created', {
  protocol: ENABLE_SSL ? 'WSS' : 'WS',
  maxPayload: 65536
});

// ==================== STATE MANAGEMENT ====================
const users = new Map();
const activeCalls = new Map();

// ==================== UTILITY FUNCTIONS ====================
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function sendToUser(username, message) {
  const user = users.get(username);
  if (user && user.ws.readyState === WebSocket.OPEN) {
    try {
      user.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      logger.error('Error sending message to user', {
        username,
        error: error.message,
        messageType: message.type
      });
      return false;
    }
  }
  return false;
}

function broadcast(message, excludeUser = null) {
  const data = JSON.stringify(message);
  const disconnectedUsers = [];

  users.forEach((user, username) => {
    if (username !== excludeUser) {
      if (user.ws.readyState === WebSocket.OPEN) {
        try {
          user.ws.send(data);
        } catch (error) {
          logger.error('Error broadcasting to user', {
            username,
            error: error.message,
            messageType: message.type
          });
          disconnectedUsers.push(username);
        }
      } else {
        disconnectedUsers.push(username);
      }
    }
  });

  disconnectedUsers.forEach(username => {
    users.delete(username);
    logger.info('Auto-removed disconnected user', { username });
  });
}

// ==================== SIP GATEWAY EVENT HANDLERS ====================
if (sipGateway) {
  sipGateway.on('ready', () => {
    logger.info('SIP Gateway ready and listening');
  });

  sipGateway.on('error', (error) => {
    logger.error('SIP Gateway error', { error: error.message });
  });

  sipGateway.on('sip-ringing', (webrtcClientId) => {
    logger.info('SIP call ringing', { webrtcClientId });
    sendToUser(webrtcClientId, {
      type: 'call-ringing',
      message: 'Remote party is ringing'
    });
  });

  sipGateway.on('call-answered', (webrtcClientId, sdp) => {
    logger.info('SIP call answered', { webrtcClientId });
    sendToUser(webrtcClientId, {
      type: 'call-answered',
      sdp: sdp
    });
  });

  sipGateway.on('call-failed', (webrtcClientId, reason) => {
    logger.warn('SIP call failed', { webrtcClientId, reason });
    sendToUser(webrtcClientId, {
      type: 'call-failed',
      reason: reason
    });

    activeCalls.forEach((callData, callId) => {
      if (callData.webrtcUser === webrtcClientId) {
        activeCalls.delete(callId);
      }
    });
  });

  sipGateway.on('call-ended', (webrtcClientId) => {
    logger.info('SIP call ended', { webrtcClientId });
    sendToUser(webrtcClientId, {
      type: 'call-ended',
      reason: 'Remote party hung up'
    });

    activeCalls.forEach((callData, callId) => {
      if (callData.webrtcUser === webrtcClientId) {
        activeCalls.delete(callId);
      }
    });
  });

  sipGateway.on('incoming-sip-call', async (data) => {
    const targetUser = data.toUser;
    logger.info('Incoming SIP call', {
      targetUser,
      from: data.from,
      callId: data.callId
    });

    if (users.has(targetUser)) {
      activeCalls.set(data.callId, {
        webrtcUser: targetUser,
        sipCaller: data.from,
        direction: 'incoming',
        callId: data.callId
      });

      const sent = sendToUser(targetUser, {
        type: 'incoming-call',
        from: data.from,
        callId: data.callId,
        sdp: data.sdp
      });

      if (!sent) {
        logger.warn('Target user not reachable', { targetUser, callId: data.callId });
        await sipGateway.rejectCall(data.callId, 480, 'Temporarily Unavailable');
        activeCalls.delete(data.callId);
      }
    } else {
      logger.warn('Target user not found', { targetUser, callId: data.callId });
      await sipGateway.rejectCall(data.callId, 404, 'Not Found');
    }
  });

  sipGateway.on('sip-call-ended', (callId) => {
    logger.info('SIP call ended by remote', { callId });
    const callData = activeCalls.get(callId);
    if (callData) {
      sendToUser(callData.webrtcUser, {
        type: 'call-ended',
        callId: callId,
        reason: 'Remote party hung up'
      });
      activeCalls.delete(callId);
    }
  });

  sipGateway.on('dtmf-received', (data) => {
    logger.debug('DTMF digit received', data);
    const callData = activeCalls.get(data.callId);
    if (callData) {
      sendToUser(callData.webrtcUser, {
        type: 'dtmf',
        callId: data.callId,
        digit: data.digit,
        duration: data.duration
      });
    }
  });

  sipGateway.on('media-renegotiation', (data) => {
    logger.info('Media renegotiation required', {
      callId: data.callId,
      webrtcClientId: data.webrtcClientId
    });

    sendToUser(data.webrtcClientId, {
      type: 'media-renegotiation',
      callId: data.callId,
      sdp: data.sdp,
      message: 'Remote party requested media renegotiation (hold/resume or codec change)'
    });
  });
}

// ==================== WEBSOCKET CONNECTION HANDLER ====================
wss.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress;
  const clientPort = req.socket.remotePort;
  const protocol = req.connection.encrypted ? 'WSS' : 'WS';

  logger.info('New WebSocket connection', {
    clientIP,
    clientPort,
    protocol
  });

  let username = null;

  try {
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Connected to WebRTC Signaling Server',
      serverTime: new Date().toISOString()
    }));
  } catch (error) {
    logger.error('Error sending welcome message', { error: error.message });
  }

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (JSON.stringify(message).length > 65536) {
        ws.send(JSON.stringify({ type: 'error', message: 'Message too large' }));
        return;
      }

      if (message.type !== 'ice-candidate') {
        logger.debug('WebSocket message received', {
          username: username || 'anonymous',
          type: message.type
        });
      }

      switch (message.type) {
        case 'register':
          if (!message.username) {
            ws.send(JSON.stringify({ type: 'error', message: 'Username required' }));
            return;
          }

          if (!/^[a-zA-Z0-9_]{3,32}$/.test(message.username)) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Invalid username format (3-32 alphanumeric characters)'
            }));
            return;
          }

          if (users.has(message.username)) {
            ws.send(JSON.stringify({ type: 'error', message: 'Username already taken' }));
            return;
          }

          username = message.username;
          users.set(username, { ws, lastSeen: Date.now() });

          logger.info('User registered', {
            username,
            totalUsers: users.size,
            clientIP
          });

          ws.send(JSON.stringify({
            type: 'registered',
            username: username,
            message: 'Registration successful'
          }));

          const userList = Array.from(users.keys()).filter(u => u !== username);
          ws.send(JSON.stringify({
            type: 'user-list',
            users: userList
          }));

          broadcast({
            type: 'user-joined',
            username: username
          }, username);
          break;

        case 'call-request':
          if (!username || !message.to) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid call-request' }));
            return;
          }

          logger.info('Call request', { from: username, to: message.to });

          const successRequest = sendToUser(message.to, {
            type: 'call-request',
            from: username
          });

          if (!successRequest) {
            ws.send(JSON.stringify({
              type: 'error',
              message: `User ${message.to} not found or offline`
            }));
          }
          break;

        case 'call-response':
          if (!username || !message.to || message.accepted === undefined) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid call-response' }));
            return;
          }

          logger.info('Call response', {
            from: username,
            to: message.to,
            accepted: message.accepted
          });

          sendToUser(message.to, {
            type: 'call-response',
            from: username,
            accepted: message.accepted
          });
          break;

        case 'offer':
          if (!username || !message.to || !message.data) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid offer' }));
            return;
          }

          logger.debug('Forwarding offer', { from: username, to: message.to });

          sendToUser(message.to, {
            type: 'offer',
            from: username,
            data: message.data
          });
          break;

        case 'answer':
          if (!username || !message.to || !message.data) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid answer' }));
            return;
          }

          logger.debug('Forwarding answer', { from: username, to: message.to });

          sendToUser(message.to, {
            type: 'answer',
            from: username,
            data: message.data
          });
          break;

        case 'ice-candidate':
          if (!username || !message.to || !message.data) return;

          sendToUser(message.to, {
            type: 'ice-candidate',
            from: username,
            data: message.data
          });
          break;

        case 'hangup':
        case 'hang-up':
          if (message.callId && sipGateway) {
            const callData = activeCalls.get(message.callId);
            if (callData && (callData.sipTarget || callData.sipCaller)) {
              logger.info('Hanging up SIP call', { callId: message.callId });
              sipGateway.hangup(message.callId)
                .catch(err => logger.error('Error hanging up', {
                  callId: message.callId,
                  error: err.message
                }));
              activeCalls.delete(message.callId);
            }
          }

          if (username && message.to) {
            sendToUser(message.to, {
              type: 'hang-up',
              from: username,
              reason: 'Call ended by remote party'
            });
          }
          break;

        case 'reject':
          if (message.callId && sipGateway) {
            const callData = activeCalls.get(message.callId);
            if (callData && callData.direction === 'incoming') {
              logger.info('Rejecting SIP call', {
                webrtcUser: username,
                callId: message.callId
              });
              await sipGateway.rejectCall(message.callId, 603, 'Decline');
              activeCalls.delete(message.callId);
            }
          }

          if (username && message.to) {
            sendToUser(message.to, {
              type: 'call-rejected',
              from: username
            });
          }
          break;

        default:
          logger.warn('Unknown message type', { type: message.type });
          break;
      }
    } catch (error) {
      logger.error('Error processing message', {
        error: error.message,
        stack: error.stack
      });
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Malformed message'
      }));
    }
  });

  ws.on('close', () => {
    if (username) {
      users.delete(username);
      logger.info('User disconnected', {
        username,
        totalUsers: users.size
      });

      if (sipGateway) {
        activeCalls.forEach((callData, callId) => {
          if (callData.webrtcUser === username && (callData.sipTarget || callData.sipCaller)) {
            sipGateway.hangup(callId)
              .catch(err => logger.error('Error cleanup hangup', {
                callId,
                error: err.message
              }));
          }
          if (callData.webrtcUser === username) {
            activeCalls.delete(callId);
          }
        });
      }

      broadcast({
        type: 'user-left',
        username: username
      }, username);
    } else {
      logger.debug('Anonymous connection closed', { clientIP });
    }
  });

  ws.on('error', (error) => {
    logger.error('WebSocket error', {
      username: username || 'anonymous',
      error: error.message
    });
  });

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
});

// ==================== HEARTBEAT ====================
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeat);
});

// ==================== GRACEFUL SHUTDOWN ====================
async function gracefulShutdown(signal) {
  logger.warn('Shutdown initiated', { signal });

  server.close();

  wss.clients.forEach(ws => {
    ws.close(1001, 'Server shutting down');
  });

  if (sipGateway) {
    await sipGateway.shutdown();
  }

  logger.info('Server shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack
  });
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// ==================== START SERVER ====================
async function startServer() {
  try {
    if (sipGateway) {
      await sipGateway.initialize();
    }

    server.listen(PORT, '0.0.0.0', () => {
      const localIP = getLocalIP();
      console.log('='.repeat(70));
      console.log('WebRTC Signaling Server Started');
      console.log('='.repeat(70));
      console.log(`Port: ${PORT}`);
      console.log(`Protocol: ${ENABLE_SSL ? 'HTTPS/WSS (Secure)' : 'HTTP/WS (Insecure)'}`);
      console.log(`Local: ${ENABLE_SSL ? 'wss' : 'ws'}://localhost:${PORT}`);
      console.log(`Network: ${ENABLE_SSL ? 'wss' : 'ws'}://${localIP}:${PORT}`);
      console.log(`Health: ${ENABLE_SSL ? 'https' : 'http'}://localhost:${PORT}/health`);
      console.log(`SIP Gateway: ${ENABLE_SIP_GATEWAY ? 'ENABLED ✅' : 'DISABLED ❌'}`);
      console.log(`SSL/TLS: ${ENABLE_SSL ? 'ENABLED ✅' : 'DISABLED ❌'}`);
      console.log('='.repeat(70));
      logger.info('Server ready, waiting for connections');
    });

    server.on('error', (error) => {
      logger.error('Server error', { error: error.message });
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} already in use`);
        process.exit(1);
      }
    });
  } catch (error) {
    logger.error('Failed to start server', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

startServer();
