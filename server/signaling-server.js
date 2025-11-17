// ==================== LOAD ENVIRONMENT VARIABLES ====================
// V1
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

      // Convert SDP string to RTCSessionDescription format for WebRTC client
      const sdpOffer = {
        type: 'offer',
        sdp: data.sdp
      };

      const sent = sendToUser(targetUser, {
        type: 'incoming-call',
        from: data.from,
        callId: data.callId,
        sdp: sdpOffer
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

          // Check if this is a response to an incoming SIP call
          const sipCallResponseData = Array.from(activeCalls.values()).find(
            call => call.webrtcUser === username && call.direction === 'incoming'
          );

          if (sipCallResponseData && sipGateway) {
            if (message.accepted) {
              // User accepted - wait for answer SDP
              logger.info('SIP call accepted by user, waiting for answer SDP', {
                callId: sipCallResponseData.callId
              });
              // The answer will be handled in the 'answer' case
            } else {
              // User rejected
              logger.info('SIP call rejected by user', {
                callId: sipCallResponseData.callId
              });
              try {
                await sipGateway.rejectCall(sipCallResponseData.callId, 603, 'Decline');
                activeCalls.delete(sipCallResponseData.callId);
              } catch (error) {
                logger.error('Error rejecting SIP call', { error: error.message, callId: sipCallResponseData.callId });
              }
            }
          } else {
            // Regular WebRTC-to-WebRTC call response
            sendToUser(message.to, {
              type: 'call-response',
              from: username,
              accepted: message.accepted
            });
          }
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
          if (!username || !message.data) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid answer' }));
            return;
          }

          // Check if this is an answer to an incoming SIP call
          const sipCallData = Array.from(activeCalls.values()).find(
            call => call.webrtcUser === username && call.direction === 'incoming'
          );

          if (sipCallData && sipGateway) {
            logger.info('Answering incoming SIP call', {
              callId: sipCallData.callId,
              webrtcUser: username
            });

            try {
              // FIX: Gestione robusta dell'SDP in vari formati
              let sdpString;

              if (typeof message.data === 'string') {
                // Caso 1: SDP già come stringa
                sdpString = message.data;
                logger.debug('SDP received as string', {
                  callId: sipCallData.callId,
                  length: sdpString.length
                });
              }
              else if (message.data && typeof message.data === 'object') {
                // Caso 2: RTCSessionDescription object
                if (message.data.type && message.data.sdp) {
                  sdpString = message.data.sdp;
                  logger.debug('SDP extracted from RTCSessionDescription', {
                    callId: sipCallData.callId,
                    type: message.data.type,
                    length: sdpString.length
                  });
                }
                // Caso 3: Solo il campo sdp nell'oggetto
                else if (message.data.sdp) {
                  sdpString = message.data.sdp;
                  logger.debug('SDP extracted from object.sdp', {
                    callId: sipCallData.callId,
                    length: sdpString.length
                  });
                }
                // Caso 4: Oggetto serializzato male
                else {
                  logger.warn('Received object without sdp field, attempting JSON stringify', {
                    callId: sipCallData.callId,
                    keys: Object.keys(message.data)
                  });
                  sdpString = JSON.stringify(message.data);
                }
              }
              else {
                throw new Error(`Invalid SDP format: ${typeof message.data}`);
              }

              // Validazione SDP
              if (!sdpString || sdpString.trim().length === 0) {
                throw new Error('SDP is empty after extraction');
              }

              // Verifica che sia SDP valido
              if (!sdpString.startsWith('v=0')) {
                logger.error('SDP does not start with v=0', {
                  callId: sipCallData.callId,
                  firstChars: sdpString.substring(0, 50)
                });
                throw new Error('Invalid SDP: does not start with v=0');
              }

              // Log dettagliato PRIMA di inviare a SIP Gateway
              const sdpLines = sdpString.split(/\r?\n/);
              const audioLine = sdpLines.find(l => l.startsWith('m=audio'));
              const codecLines = sdpLines.filter(l => l.startsWith('a=rtpmap:'));

              logger.info('WebRTC Answer SDP Analysis', {
                callId: sipCallData.callId,
                totalLines: sdpLines.length,
                audioLine: audioLine || 'NOT FOUND',
                codecs: codecLines,
                hasPCMU: sdpString.includes('PCMU'),
                hasPCMA: sdpString.includes('PCMA'),
                hasOpus: sdpString.includes('opus'),
                hasICE: sdpString.includes('ice-ufrag'),
                hasDTLS: sdpString.includes('fingerprint')
              });

              // Log completo in debug mode
              if (process.env.LOG_LEVEL === 'debug') {
                logger.debug('Complete WebRTC Answer SDP', {
                  callId: sipCallData.callId,
                  sdp: sdpString
                });
              }

              // Invia a SIP Gateway
              await sipGateway.answerSipCall(sipCallData.callId, username, sdpString);

              logger.info('SIP call answered successfully', {
                callId: sipCallData.callId
              });

            } catch (error) {
              logger.error('Error answering SIP call', {
                error: error.message,
                callId: sipCallData.callId,
                stack: error.stack,
                messageDataType: typeof message.data
              });
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Failed to answer call: ' + error.message
              }));
            }
          } else {
            // Regular WebRTC-to-WebRTC answer
            if (!message.to) {
              ws.send(JSON.stringify({ type: 'error', message: 'Invalid answer: missing to field' }));
              return;
            }
            logger.debug('Forwarding answer', { from: username, to: message.to });

            sendToUser(message.to, {
              type: 'answer',
              from: username,
              data: message.data
            });
          }
          break;

        case 'hangup':
        case 'hang-up':
          if (!username) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not registered' }));
            return;
          }

          logger.info('Hangup request received', {
            username,
            callId: message.callId,
            to: message.to
          });

          // Gestione hangup per chiamate SIP
          if (message.callId && sipGateway) {
            const callData = activeCalls.get(message.callId);

            if (callData) {
              logger.info('Hanging up SIP call', {
                callId: message.callId,
                direction: callData.direction,
                webrtcUser: callData.webrtcUser
              });

              if (callData.webrtcUser === username) {
                try {
                  await sipGateway.hangup(message.callId);
                  logger.info('SIP hangup successful', { callId: message.callId });
                } catch (err) {
                  logger.error('Error hanging up SIP call', {
                    callId: message.callId,
                    error: err.message
                  });
                }

                activeCalls.delete(message.callId);

                ws.send(JSON.stringify({
                  type: 'call-ended',
                  callId: message.callId,
                  reason: 'Call terminated'
                }));
              } else {
                logger.warn('User attempted to hangup call they are not part of', {
                  username,
                  callId: message.callId,
                  actualUser: callData.webrtcUser
                });
              }
            } else {
              logger.warn('Call ID not found in active calls', {
                callId: message.callId,
                username
              });
            }
          }

          // Gestione hangup per chiamate WebRTC-to-WebRTC
          if (message.to) {
            logger.debug('Forwarding hangup to WebRTC peer', {
              from: username,
              to: message.to
            });

            sendToUser(message.to, {
              type: 'hang-up',
              from: username,
              reason: message.reason || 'Call ended by remote party'
            });
          }
          break;

        case 'reject':
          if (!username) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not registered' }));
            return;
          }

          logger.info('Reject request received', {
            username,
            callId: message.callId,
            to: message.to
          });

          // Gestione reject per chiamate SIP in arrivo
          if (message.callId && sipGateway) {
            const callData = activeCalls.get(message.callId);

            if (callData && callData.direction === 'incoming' && callData.webrtcUser === username) {
              logger.info('Rejecting incoming SIP call', {
                webrtcUser: username,
                callId: message.callId
              });

              try {
                await sipGateway.rejectCall(message.callId, 603, 'Decline');
                logger.info('SIP reject successful', { callId: message.callId });
              } catch (err) {
                logger.error('Error rejecting SIP call', {
                  callId: message.callId,
                  error: err.message
                });
              }

              activeCalls.delete(message.callId);
            }
          }

          // Gestione reject per chiamate WebRTC-to-WebRTC
          if (message.to) {
            logger.debug('Forwarding reject to WebRTC peer', {
              from: username,
              to: message.to
            });

            sendToUser(message.to, {
              type: 'call-rejected',
              from: username
            });
          }
          break;

        case 'ice-candidate':
          if (!username || !message.to || !message.data) return;
          sendToUser(message.to, {
            type: 'ice-candidate',
            from: username,
            data: message.data
          });
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

  ws.on('close', async () => {
    if (username) {
      users.delete(username);
      logger.info('User disconnected', {
        username,
        totalUsers: users.size
      });

      // Cleanup migliorato delle chiamate SIP quando l'utente si disconnette
      if (sipGateway) {
        const callsToCleanup = [];

        activeCalls.forEach((callData, callId) => {
          if (callData.webrtcUser === username) {
            callsToCleanup.push({ callId, callData });
          }
        });

        for (const { callId, callData } of callsToCleanup) {
          logger.info('Cleaning up SIP call on user disconnect', {
            username,
            callId,
            direction: callData.direction
          });

          try {
            await sipGateway.hangup(callId);
            logger.info('SIP call terminated on disconnect', { callId });
          } catch (err) {
            logger.error('Error cleaning up SIP call on disconnect', {
              callId,
              error: err.message
            });
          }

          activeCalls.delete(callId);
        }
      }

      broadcast({
        type: 'user-left',
        username: username
      }, username);
    } else {
      logger.debug('Anonymous connection closed', { clientIP: 'unknown' });
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
