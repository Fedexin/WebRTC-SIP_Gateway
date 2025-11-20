const EventEmitter = require('events');
const Client = require('rtpengine-client').Client;
const crypto = require('crypto');
const dgram = require('dgram');
const os = require('os');

class SipGateway extends EventEmitter {
  constructor(config, logger = null) {
    super();

    this.config = {
      sipServerHost: config.sipServerHost || 'localhost',
      sipServerPort: config.sipServerPort || 5060,
      sipDomain: config.sipDomain || 'localhost',
      displayName: config.displayName || 'WebRTC-SIP Gateway',
      localSipPort: config.localSipPort || 5060,
      rtpengineHost: config.rtpengineHost || 'localhost',
      rtpenginePort: config.rtpenginePort || 22222,
      publicIP: config.publicIP || null,
      maxConcurrentSessions: config.maxConcurrentSessions || 1000,
      ...config
    };

    this.logger = logger || {
      info: (msg, meta) => console.log(`[INFO] ${msg}`, meta || ''),
      warn: (msg, meta) => console.warn(`[WARN] ${msg}`, meta || ''),
      error: (msg, meta) => console.error(`[ERROR] ${msg}`, meta || ''),
      debug: (msg, meta) => console.log(`[DEBUG] ${msg}`, meta || '')
    };

    this.sessions = new Map();
    this.transactions = new Map();
    this.inviteTransactions = new Map();

    this.rtpengineClient = new Client({
      timeout: 5000,
      rejectOnFailure: true
    });

    this.socket = null;
    this.isRunning = false;
    this.localIP = this.getLocalIP();
    this.advertiseIP = this.resolvePublicIP();

    // RFC 3261 Timer values
    this.T1 = 500;
    this.T2 = 4000;
    this.TIMER_B = 64 * this.T1;
    this.TIMER_F = 64 * this.T1;
    this.TIMER_H = 64 * this.T1;

    this.metrics = {
      activeSessions: 0,
      totalCalls: 0,
      failedCalls: 0,
      reInvites: 0,
      startTime: Date.now(),
      dtmfDigitsReceived: 0,
      retriedInvites: 0
    };

    this.logger.info('SIP Gateway initialized', {
      advertiseIP: this.advertiseIP,
      localIP: this.localIP,
      sipServer: `${this.config.sipServerHost}:${this.config.sipServerPort}`,
      rtpengine: `${this.config.rtpengineHost}:${this.config.rtpenginePort}`
    });
  }

  resolvePublicIP() {
    if (this.config.publicIP === 'auto') {
      this.logger.info('PUBLIC_IP=auto detected, using local IP for LAN deployment');
      return this.localIP;
    }
    return this.config.publicIP || this.localIP;
  }

  async initialize() {
    try {
      this.logger.info('Testing RTPEngine connection...');
      const pingResult = await this.rtpengineClient.ping(
        this.config.rtpenginePort,
        this.config.rtpengineHost
      );
      this.logger.info('RTPEngine ping successful', { result: pingResult });

      await this.setupSipSocket();

      this.isRunning = true;
      this.emit('ready');
      this.logger.info('SIP Gateway initialized and ready');
    } catch (error) {
      this.logger.error('Error initializing SIP Gateway', { error: error.message });
      this.emit('error', error);
      throw error;
    }
  }

  async setupSipSocket() {
    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket({
        type: 'udp4',
        reuseAddr: true
      });

      this.socket.on('message', async (msg, rinfo) => {
        try {
          const messageStr = msg.toString();

          this.logger.debug('Received raw message', {
            source: `${rinfo.address}:${rinfo.port}`,
            length: messageStr.length,
            firstChars: messageStr.substring(0, 50),
            fullMessage: messageStr
          });

          if (this.isDTMFNotification(messageStr)) {
            this.handleDTMFNotification(messageStr);
            return;
          }

          const message = this.parseSipMessage(messageStr);
          this.handleIncomingMessage(message, rinfo).catch(err => {
            this.logger.error('Error handling SIP message', { error: err.message });
          });
        } catch (error) {
          this.logger.error('Error parsing SIP message', { error: error.message });
        }
      });

      this.socket.on('error', (err) => {
        this.logger.error('Socket error', { error: err.message });
        if (!this.isRunning) {
          reject(err);
        }
        this.emit('error', err);
      });

      this.socket.bind(this.config.localSipPort, () => {
        this.logger.info('SIP socket listening', {
          address: this.advertiseIP,
          port: this.config.localSipPort
        });
        resolve();
      });
    });
  }

  isDTMFNotification(message) {
    return message.startsWith('INFO ') && message.includes('application/dtmf-relay');
  }

  handleDTMFNotification(message) {
    try {
      const lines = message.split('\r\n');
      const callIdLine = lines.find(l => l.toLowerCase().startsWith('call-id:'));
      const bodyStart = lines.indexOf('') + 1;
      const body = lines.slice(bodyStart).join('\r\n');

      if (!callIdLine || !body) return;

      const callId = callIdLine.split(':')[1].trim();

      const signalMatch = body.match(/Signal=(\d+|[A-D*#])/i);
      const durationMatch = body.match(/Duration=(\d+)/i);

      if (signalMatch) {
        const digit = signalMatch[1];
        const duration = durationMatch ? parseInt(durationMatch[1]) : 160;

        this.metrics.dtmfDigitsReceived++;
        this.logger.debug('DTMF digit received', { callId, digit, duration });

        this.emit('dtmf-received', {
          callId,
          digit,
          duration,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      this.logger.error('Error parsing DTMF notification', { error: error.message });
    }
  }

  parseSipMessage(data) {
    const lines = data.split('\r\n');
    const firstLine = lines[0];
    let message = {};

    if (firstLine.startsWith('SIP/2.0')) {
      const parts = firstLine.split(' ');
      message.status = parseInt(parts[1]);
      message.reason = parts.slice(2).join(' ');
      message.isResponse = true;
    } else {
      const parts = firstLine.split(' ');
      message.method = parts[0];
      message.uri = parts[1];
      message.isResponse = false;
    }

    message.headers = {};
    let i = 1;
    let currentHeader = null;
    let currentValue = '';

    for (; i < lines.length; i++) {
      if (lines[i] === '') break;

      if (lines[i][0] === ' ' || lines[i][0] === '\t') {
        currentValue += ' ' + lines[i].trim();
        continue;
      }

      if (currentHeader) {
        this.addHeader(message.headers, currentHeader, currentValue);
      }

      const colonIndex = lines[i].indexOf(':');
      if (colonIndex > 0) {
        currentHeader = lines[i].substring(0, colonIndex).trim();
        currentValue = lines[i].substring(colonIndex + 1).trim();
      }
    }

    if (currentHeader) {
      this.addHeader(message.headers, currentHeader, currentValue);
    }

    this.expandCompactHeaders(message.headers);

    message.body = lines.slice(i + 1).join('\r\n');

    return message;
  }

  addHeader(headers, name, value) {
    const normalized = name.toLowerCase();

    if (normalized === 'via') {
      if (!headers['via']) {
        headers['via'] = [];
      }
      headers['via'].push(value);
    } else {
      headers[normalized] = value;
    }
  }

  expandCompactHeaders(headers) {
    const compactMap = {
      'v': 'via',
      'f': 'from',
      't': 'to',
      'i': 'call-id',
      'm': 'contact',
      'c': 'content-type',
      'l': 'content-length',
      'k': 'supported'
    };

    for (const [compact, full] of Object.entries(compactMap)) {
      if (headers[compact]) {
        headers[full] = headers[compact];
        delete headers[compact];
      }
    }
  }

  async handleIncomingMessage(message, rinfo) {
    if (message.isResponse) {
      this.handleResponse(message, rinfo);
    } else {
      this.handleNATForRequest(message, rinfo);
      await this.handleRequest(message, rinfo);
    }
  }

  handleNATForRequest(request, rinfo) {
    const viaHeader = Array.isArray(request.headers['via']) ?
      request.headers['via'][0] : request.headers['via'];

    if (viaHeader) {
      const viaMatch = viaHeader.match(/SIP\/2\.0\/UDP\s+([^:;]+)(?::(\d+))?/);
      if (viaMatch) {
        const viaHost = viaMatch[1];
        const viaPort = viaMatch[2] ? parseInt(viaMatch[2]) : 5060;

        if (viaHost !== rinfo.address || viaPort !== rinfo.port) {
          this.logger.debug('NAT detected, updating Via header', {
            viaHost,
            viaPort,
            actualHost: rinfo.address,
            actualPort: rinfo.port
          });

          if (viaHeader.includes('rport')) {
            let updatedVia = viaHeader;

            if (viaHeader.includes('rport=')) {
              updatedVia = updatedVia.replace(/rport=\d*/, `rport=${rinfo.port}`);
            } else {
              updatedVia = updatedVia.replace(/rport/, `rport=${rinfo.port}`);
            }

            if (!updatedVia.includes('received=')) {
              updatedVia += `;received=${rinfo.address}`;
            }

            if (Array.isArray(request.headers['via'])) {
              request.headers['via'][0] = updatedVia;
            } else {
              request.headers['via'] = updatedVia;
            }
          }
        }
      }
    }
  }

  handleResponse(response, rinfo) {
    const callId = response.headers['call-id'];
    const cseq = response.headers['cseq'];
    const viaHeader = Array.isArray(response.headers['via']) ?
      response.headers['via'][0] : response.headers['via'];
    const branchMatch = viaHeader ? viaHeader.match(/branch=([^;\s>]+)/) : null;
    const branch = branchMatch ? branchMatch[1] : null;

    const transactionKey = `${branch}-${callId}-${cseq}`;
    const transaction = this.transactions.get(transactionKey);

    if (transaction) {
      if (transaction.timer) {
        clearTimeout(transaction.timer);
      }

      if (transaction.callback) {
        transaction.callback(response, rinfo);
      }

      if (response.status >= 200) {
        this.transactions.delete(transactionKey);
      }
    }
  }

  async handleRequest(request, rinfo) {
    switch (request.method) {
      case 'INVITE':
        await this.handleInvite(request, rinfo);
        break;
      case 'ACK':
        this.handleAck(request, rinfo);
        break;
      case 'BYE':
        this.handleBye(request, rinfo);
        break;
      case 'CANCEL':
        this.handleCancel(request, rinfo);
        break;
      case 'INFO':
        this.handleInfo(request, rinfo);
        break;
      case 'OPTIONS':
        this.sendResponse(request, 200, 'OK', rinfo);
        break;
      default:
        this.logger.warn('Unhandled SIP method', { method: request.method });
        this.sendResponse(request, 501, 'Not Implemented', rinfo);
        break;
    }
  }

  async handleInvite(request, rinfo) {
    const callId = request.headers['call-id'];
    const cseq = request.headers['cseq'];

    const viaHeader = Array.isArray(request.headers['via']) ?
      request.headers['via'][0] : request.headers['via'];
    const branchMatch = viaHeader ? viaHeader.match(/branch=([^;\s>]+)/) : null;
    const branch = branchMatch ? branchMatch[1] : null;

    const transactionKey = `${callId}-${cseq}-${branch}`;

    if (this.inviteTransactions.has(transactionKey)) {
      const existingTransaction = this.inviteTransactions.get(transactionKey);
      this.logger.debug('INVITE retransmission detected, re-sending last response', {
        callId,
        transactionKey,
        state: existingTransaction.state
      });
      this.metrics.retriedInvites++;

      if (existingTransaction.lastResponse) {
        this.sendResponse(
          request,
          existingTransaction.lastResponse.status,
          existingTransaction.lastResponse.reason,
          rinfo,
          existingTransaction.lastResponse.body
        );
      }
      return;
    }

    const existingSession = this.sessions.get(callId);

    if (existingSession && existingSession.state === 'established') {
      this.logger.info('RE-INVITE received', { callId });
      this.metrics.reInvites++;
      return await this.handleReInvite(request, rinfo, existingSession);
    }

    return await this.handleIncomingInvite(request, rinfo, transactionKey);
  }

  async handleReInvite(request, rinfo, session) {
    const callId = request.headers['call-id'];

    try {
      const newSdp = request.body;
      this.validateSDP(newSdp, 're-invite-offer');

      this.logger.debug('Processing RE-INVITE through RTPEngine', { callId });

      const updatePayload = {
        'call-id': callId,
        'from-tag': session.fromTag,
        'to-tag': session.toTag,
        'sdp': newSdp
      };

      const updateResponse = await this.rtpengineOperationWithRetry(() =>
        this.rtpengineClient.offer(
          this.config.rtpenginePort,
          this.config.rtpengineHost,
          updatePayload
        )
      );

      if (updateResponse.result !== 'ok') {
        throw new Error(`RTPEngine update failed: ${updateResponse['error-reason']}`);
      }

      this.validateSDP(updateResponse.sdp, 're-invite-answer');

      this.logger.info('RE-INVITE processed successfully', { callId });
      this.sendResponse(request, 200, 'OK', rinfo, updateResponse.sdp);

      if (session.direction === 'outgoing') {
        this.emit('media-renegotiation', {
          webrtcClientId: session.webrtcClientId,
          callId: callId,
          sdp: updateResponse.sdp
        });
      } else if (session.direction === 'incoming') {
        this.emit('media-renegotiation', {
          webrtcClientId: session.webrtcUserId,
          callId: callId,
          sdp: updateResponse.sdp
        });
      }

    } catch (error) {
      this.logger.error('Error handling RE-INVITE', {
        callId,
        error: error.message
      });
      this.sendResponse(request, 500, 'Internal Server Error', rinfo);
    }
  }

  handleInfo(request, rinfo) {
    const callId = request.headers['call-id'];
    const contentType = request.headers['content-type'];

    if (contentType && contentType.includes('application/dtmf-relay')) {
      this.logger.debug('SIP INFO DTMF received', { callId });
      this.handleDTMFNotification(this.buildSipMessage(request));
      this.sendResponse(request, 200, 'OK', rinfo);
    } else {
      this.sendResponse(request, 200, 'OK', rinfo);
    }
  }

  buildSipMessage(message) {
    let lines = [];

    if (message.isResponse) {
      lines.push(`SIP/2.0 ${message.status} ${message.reason}`);
    } else {
      lines.push(`${message.method} ${message.uri} SIP/2.0`);
    }

    for (const [name, value] of Object.entries(message.headers)) {
      const headerName = this.capitalizeHeader(name);
      if (Array.isArray(value)) {
        value.forEach(v => {
          lines.push(`${headerName}: ${v}`);
        });
      } else {
        lines.push(`${headerName}: ${value}`);
      }
    }

    const hasContentLength = Object.keys(message.headers).some(
      k => k.toLowerCase() === 'content-length'
    );

    if (message.body) {
      const bodyBytes = Buffer.from(message.body, 'utf8');
      if (!hasContentLength) {
        lines.push(`Content-Length: ${bodyBytes.length}`);
      }
      lines.push('');
      lines.push(message.body);
    } else {
      if (!hasContentLength) {
        lines.push('Content-Length: 0');
      }
      lines.push('');
      lines.push('');
    }

    const result = lines.join('\r\n');

    if (result.length < 20) {
      this.logger.error('Generated SIP message too short', {
        length: result.length,
        message: result,
        originalMessage: message
      });
    }

    return result;
  }

  capitalizeHeader(name) {
    const mapping = {
      'call-id': 'Call-ID',
      'cseq': 'CSeq',
      'from': 'From',
      'to': 'To',
      'via': 'Via',
      'contact': 'Contact',
      'content-type': 'Content-Type',
      'content-length': 'Content-Length',
      'max-forwards': 'Max-Forwards',
      'user-agent': 'User-Agent',
      'allow': 'Allow',
      'supported': 'Supported',
      'accept': 'Accept',
      'record-route': 'Record-Route'
    };
    return mapping[name.toLowerCase()] || name;
  }

  sendSipMessage(message, host, port, callback) {
    const data = this.buildSipMessage(message);

    this.socket.send(data, port, host, (err) => {
      if (err) {
        this.logger.error('Error sending SIP message', { error: err.message, host, port });
      }
    });

    if (callback && message.headers) {
      const callId = message.headers['call-id'];
      const cseq = message.headers['cseq'];
      const viaHeader = Array.isArray(message.headers['via']) ?
        message.headers['via'][0] : message.headers['via'];
      const branchMatch = viaHeader ? viaHeader.match(/branch=([^;\s>]+)/) : null;
      const branch = branchMatch ? branchMatch[1] : 'unknown';

      const transactionKey = `${branch}-${callId}-${cseq}`;

      const isInvite = message.method === 'INVITE';
      const timeout = isInvite ? this.TIMER_B : this.TIMER_F;

      const timer = setTimeout(() => {
        const transaction = this.transactions.get(transactionKey);
        if (transaction && transaction.callback) {
          this.logger.warn('Transaction timeout', {
            transactionKey,
            method: message.method,
            timeout
          });
          transaction.callback({
            status: 408,
            reason: 'Request Timeout',
            isTimeout: true
          }, { address: host, port });
        }
        this.transactions.delete(transactionKey);
      }, timeout);

      this.transactions.set(transactionKey, {
        callback,
        timestamp: Date.now(),
        timer,
        method: message.method
      });
    }
  }

  sendResponse(request, status, reason, rinfo, body = null) {
    const toHeader = request.headers['to'];
    let responseToHeader = toHeader;

    if ((status === 180 || status === 200) && !toHeader.includes('tag=')) {
      const session = this.sessions.get(request.headers['call-id']);
      if (session && session.toTag) {
        responseToHeader = `${toHeader};tag=${session.toTag}`;
      }
    }

    const response = {
      isResponse: true,
      status,
      reason,
      headers: {
        'via': request.headers['via'],
        'from': request.headers['from'],
        'to': responseToHeader,
        'call-id': request.headers['call-id'],
        'cseq': request.headers['cseq']
      }
    };

    if (status === 180 || status === 200) {
      response.headers['contact'] = `"${this.config.displayName}" <sip:gateway@${this.advertiseIP}:${this.config.localSipPort}>`;
      response.headers['allow'] = 'INVITE, ACK, BYE, CANCEL, OPTIONS, INFO';
      response.headers['supported'] = 'replaces, timer';
      response.headers['record-route'] = `<sip:gateway@${this.advertiseIP}:${this.config.localSipPort};lr>`;
    }

    if (body) {
      response.headers['content-type'] = 'application/sdp';
      response.headers['accept'] = 'application/sdp';
      response.body = body;
    }

    this.sendSipMessage(response, rinfo.address, rinfo.port);

    const callId = request.headers['call-id'];
    const cseq = request.headers['cseq'];
    const viaHeader = Array.isArray(request.headers['via']) ?
      request.headers['via'][0] : request.headers['via'];
    const branchMatch = viaHeader ? viaHeader.match(/branch=([^;\s>]+)/) : null;
    const branch = branchMatch ? branchMatch[1] : null;
    const transactionKey = `${callId}-${cseq}-${branch}`;

    if (this.inviteTransactions.has(transactionKey)) {
      this.inviteTransactions.get(transactionKey).lastResponse = {
        status,
        reason,
        body
      };
    }
  }

  validateSDP(sdp, direction = 'unknown') {
    let sdpString;

    if (typeof sdp === 'string') {
      sdpString = sdp;
    } else if (sdp && typeof sdp === 'object') {
      if (sdp.sdp) {
        sdpString = sdp.sdp;
        this.logger.debug('Extracted SDP from RTCSessionDescription object', {
          type: sdp.type,
          direction
        });
      } else {
        sdpString = JSON.stringify(sdp);
        this.logger.warn('Received non-standard SDP object, converted to JSON', {
          direction
        });
      }
    } else {
      throw new Error(`Invalid SDP type: ${typeof sdp}`);
    }

    if (!sdpString || sdpString.trim().length === 0) {
      throw new Error('SDP is empty');
    }

    const lines = sdpString.split(/\r?\n/);

    if (!lines[0].startsWith('v=')) {
      throw new Error('SDP must start with version line (v=)');
    }

    const hasMedia = lines.some(line => line.startsWith('m=audio') || line.startsWith('m=video'));
    if (!hasMedia) {
      throw new Error('SDP must contain at least one media line (m=audio or m=video)');
    }

    const hasConnection = lines.some(line => line.startsWith('c=IN IP4') || line.startsWith('c=IN IP6'));
    if (!hasConnection) {
      throw new Error('SDP must contain connection information (c=)');
    }

    const hasOrigin = lines.some(line => line.startsWith('o='));
    if (!hasOrigin) {
      throw new Error('SDP must contain origin line (o=)');
    }

    const hasSessionName = lines.some(line => line.startsWith('s='));
    if (!hasSessionName) {
      throw new Error('SDP must contain session name (s=)');
    }

    this.logger.debug('SDP validation passed', {
      direction,
      lines: lines.length,
      inputType: typeof sdp
    });

    return true;
  }

  async makeCallToSip(webrtcClientId, targetSipUri, webrtcOfferSdp) {
    if (this.sessions.size >= this.config.maxConcurrentSessions) {
      throw new Error('Maximum concurrent sessions reached');
    }

    const callId = this.generateCallId();
    const fromTag = this.generateTag();
    const branch = this.generateBranch();
    const cseq = Math.floor(Math.random() * 10000) + 1;

    this.logger.info('Making outgoing SIP call', { callId, webrtcClientId, targetSipUri });

    this.metrics.totalCalls++;

    try {
      this.validateSDP(webrtcOfferSdp, 'webrtc-offer');

      // ✅ CORRETTO: WebRTC → SIP conversion
      const offerPayload = {
        'call-id': callId,
        'from-tag': fromTag,
        'sdp': webrtcOfferSdp,
        'transport-protocol': 'RTP/AVP',
        'ICE': 'remove',
        'rtcp-mux': ['demux']
      };

      const offerResponse = await this.rtpengineOperationWithRetry(() =>
        this.rtpengineClient.offer(
          this.config.rtpenginePort,
          this.config.rtpengineHost,
          offerPayload
        )
      );

      if (offerResponse.result !== 'ok') {
        throw new Error(`RTPEngine offer failed: ${offerResponse['error-reason']}`);
      }

      const sipSdp = offerResponse.sdp;
      this.validateSDP(sipSdp, 'sip-offer');

      const inviteMessage = {
        method: 'INVITE',
        uri: targetSipUri,
        headers: {
          'via': `SIP/2.0/UDP ${this.advertiseIP}:${this.config.localSipPort};branch=${branch};rport`,
          'max-forwards': '70',
          'from': `"${this.config.displayName}" <sip:webrtc@${this.advertiseIP}>;tag=${fromTag}`,
          'to': `<${targetSipUri}>`,
          'call-id': callId,
          'cseq': `${cseq} INVITE`,
          'contact': `"${this.config.displayName}" <sip:webrtc@${this.advertiseIP}>`,
          'content-type': 'application/sdp',
          'user-agent': 'WebRTC-SIP-Gateway/2.0',
          'allow': 'INVITE, ACK, BYE, CANCEL, OPTIONS, INFO',
          'supported': 'replaces, timer'
        },
        body: sipSdp
      };

      this.sessions.set(callId, {
        direction: 'outgoing',
        webrtcClientId,
        fromTag,
        toTag: null,
        state: 'calling',
        targetUri: targetSipUri,
        cseq,
        viaBranch: branch,
        createdAt: Date.now()
      });

      this.metrics.activeSessions++;

      this.sendSipMessage(
        inviteMessage,
        this.config.sipServerHost,
        this.config.sipServerPort,
        async (response) => {
          await this.handleInviteResponse(response, callId, fromTag, targetSipUri);
        }
      );

      this.logger.info('INVITE sent', { callId, targetSipUri });
      return callId;

    } catch (error) {
      this.logger.error('Error making SIP call', { callId, error: error.message });
      this.metrics.failedCalls++;
      this.emit('call-failed', webrtcClientId, error.message);
      throw error;
    }
  }

  async handleInviteResponse(response, callId, fromTag, targetUri) {
    if (response.isTimeout) {
      this.logger.error('INVITE timeout', { callId });
      const sessionData = this.sessions.get(callId);
      if (sessionData) {
        this.emit('call-failed', sessionData.webrtcClientId, 'Request Timeout');
        await this.cleanupSession(callId);
      }
      return;
    }

    const sessionData = this.sessions.get(callId);
    if (!sessionData) {
      return;
    }

    try {
      if (response.status >= 100 && response.status < 200) {
        this.logger.debug('SIP provisional response', { callId, status: response.status });
        if (response.status === 180) {
          this.emit('sip-ringing', sessionData.webrtcClientId);
        }

      } else if (response.status >= 200 && response.status < 300) {
        this.logger.info('SIP call accepted', { callId });

        const toHeader = response.headers['to'];
        const toTagMatch = toHeader ? toHeader.match(/tag=([^;\s>]+)/) : null;
        const toTag = toTagMatch ? toTagMatch[1] : this.generateTag();
        sessionData.toTag = toTag;
        sessionData.state = 'established';

        const sipAnswerSdp = response.body;
        this.validateSDP(sipAnswerSdp, 'sip-answer');

        // ✅ CORRETTO: SIP answer processing
        const answerPayload = {
          'call-id': callId,
          'from-tag': fromTag,
          'to-tag': toTag,
          'sdp': sipAnswerSdp
          // ✅ No transport-protocol, no ICE, no rtcp-mux
        };

        const answerResponse = await this.rtpengineOperationWithRetry(() =>
          this.rtpengineClient.answer(
            this.config.rtpenginePort,
            this.config.rtpengineHost,
            answerPayload
          )
        );

        if (answerResponse.result !== 'ok') {
          throw new Error(`RTPEngine answer failed: ${answerResponse['error-reason']}`);
        }

        this.validateSDP(answerResponse.sdp, 'webrtc-answer');

        const contactHeader = response.headers['contact'];
        const contactMatch = contactHeader ? contactHeader.match(/<([^>]+)>/) : null;
        const contactUri = contactMatch ? contactMatch[1] : targetUri;

        const ackMessage = {
          method: 'ACK',
          uri: contactUri,
          headers: {
            'via': `SIP/2.0/UDP ${this.advertiseIP}:${this.config.localSipPort};branch=${this.generateBranch()}`,
            'max-forwards': '70',
            'from': response.headers['from'],
            'to': response.headers['to'],
            'call-id': callId,
            'cseq': `${sessionData.cseq} ACK`
          }
        };

        const uriMatch = contactUri.match(/sip:([^@]+@)?([^:;>]+)(?::(\d+))?/);
        const targetHost = uriMatch ? uriMatch[2] : this.config.sipServerHost;
        const targetPort = uriMatch && uriMatch[3] ? parseInt(uriMatch[3]) : this.config.sipServerPort;

        this.sendSipMessage(ackMessage, targetHost, targetPort);

        this.logger.debug('ACK sent', { callId });
        this.emit('call-answered', sessionData.webrtcClientId, answerResponse.sdp);

      } else if (response.status >= 300) {
        this.logger.warn('SIP call failed', { callId, status: response.status });
        this.metrics.failedCalls++;
        await this.cleanupSession(callId);
        this.emit('call-failed', sessionData.webrtcClientId, `${response.status} ${response.reason}`);
      }

    } catch (error) {
      this.logger.error('Error handling INVITE response', { callId, error: error.message });
      this.metrics.failedCalls++;
      this.emit('call-failed', sessionData.webrtcClientId, error.message);
      await this.cleanupSession(callId);
    }
  }

  async handleIncomingInvite(request, rinfo, transactionKey) {
    const callId = request.headers['call-id'];
    const fromHeader = request.headers['from'];
    const toHeader = request.headers['to'];

    const fromTagMatch = fromHeader ? fromHeader.match(/tag=([^;\s>]+)/) : null;
    const fromTag = fromTagMatch ? fromTagMatch[1] : this.generateTag();

    const fromUriMatch = fromHeader ? fromHeader.match(/<([^>]+)>/) : null;
    const callerUri = fromUriMatch ? fromUriMatch[1] : fromHeader.split(';')[0].trim();

    const toUriMatch = toHeader ? toHeader.match(/<sip:([^@]+)/) : null;
    const targetUser = toUriMatch ? toUriMatch[1] : 'default';

    this.logger.info('Incoming SIP call', { callId, from: callerUri, to: targetUser });

    try {
      if (this.sessions.size >= this.config.maxConcurrentSessions) {
        this.sendResponse(request, 503, 'Service Unavailable', rinfo);
        return;
      }

      const sipOfferSdp = request.body;
      this.validateSDP(sipOfferSdp, 'sip-incoming-offer');

      // ✅ CORRETTO: SIP → WebRTC conversion
      const offerPayload = {
        'call-id': callId,
        'from-tag': fromTag,
        'sdp': sipOfferSdp,
        'transport-protocol': 'UDP/TLS/RTP/SAVPF',
        'ICE': 'force',
        'DTLS': 'passive',
        'rtcp-mux': ['require'],
        'flags': ['generate-mid']
        // ✅ Rimosso blocco codec - passthrough PCMU/PCMA
      };

      const offerResponse = await this.rtpengineOperationWithRetry(() =>
        this.rtpengineClient.offer(
          this.config.rtpenginePort,
          this.config.rtpengineHost,
          offerPayload
        )
      );

      if (offerResponse.result !== 'ok') {
        throw new Error(`RTPEngine offer failed: ${offerResponse['error-reason']}`);
      }

      const toTag = this.generateTag();

      this.inviteTransactions.set(transactionKey, {
        callId,
        state: 'proceeding',
        createdAt: Date.now()
      });

      this.sessions.set(callId, {
        direction: 'incoming',
        sipRequest: request,
        fromTag,
        toTag,
        state: 'ringing',
        rinfo,
        cseq: 1,
        createdAt: Date.now(),
        transactionKey,
        from: callerUri
      });

      this.metrics.activeSessions++;
      this.metrics.totalCalls++;

      this.sendResponse(request, 100, 'Trying', rinfo);
      this.sendResponse(request, 180, 'Ringing', rinfo);

      this.emit('incoming-sip-call', {
        callId,
        from: callerUri,
        toUser: targetUser,
        sdp: offerResponse.sdp
      });

    } catch (error) {
      this.logger.error('Error handling incoming SIP call', {
        callId,
        error: error.message,
        stack: error.stack
      });
      this.sendResponse(request, 500, 'Internal Server Error', rinfo);
    }
  }

  async answerSipCall(callId, webrtcUserId, webrtcAnswerSdp) {
    this.logger.info('Answering SIP call', { callId, webrtcUserId });

    const sessionData = this.sessions.get(callId);
    if (!sessionData) {
      throw new Error('Session not found');
    }

    try {
      this.validateSDP(webrtcAnswerSdp, 'webrtc-answer');
      sessionData.state = 'answered';
      sessionData.webrtcUserId = webrtcUserId;

      // ✅ CORRETTO: Payload minimale per answer
      // RTPEngine userà automaticamente i parametri dell'offer precedente
      const answerPayload = {
        'call-id': callId,
        'from-tag': sessionData.fromTag,
        'to-tag': sessionData.toTag,
        'sdp': webrtcAnswerSdp

        // ✅ RIMOSSO:
        // - 'transport-protocol': 'RTP/AVP'
        // - 'rtcp-mux': ['demux']
        // - 'codec': {...}
        //
        // RTPEngine sa già dall'offer() che:
        // - Lato SIP = RTP/AVP senza ICE
        // - Lato WebRTC = UDP/TLS/RTP/SAVPF con ICE
        // L'answer() completa solo la negoziazione ICE/DTLS
      };

      this.logger.debug('Sending answer to RTPEngine', {
        callId,
        fromTag: sessionData.fromTag,
        toTag: sessionData.toTag
      });

      const answerResponse = await this.rtpengineOperationWithRetry(() =>
        this.rtpengineClient.answer(
          this.config.rtpenginePort,
          this.config.rtpengineHost,
          answerPayload
        )
      );

      if (answerResponse.result !== 'ok') {
        throw new Error(`RTPEngine answer failed: ${answerResponse['error-reason']}`);
      }

      this.validateSDP(answerResponse.sdp, 'sip-answer');

      this.logger.debug('RTPEngine answer successful', {
        callId,
        outputSdpPreview: answerResponse.sdp.substring(0, 200)
      });

      const request = sessionData.sipRequest;
      this.sendResponse(request, 200, 'OK', sessionData.rinfo, answerResponse.sdp);

      this.logger.info('200 OK sent', { callId, toTag: sessionData.toTag });

      sessionData.retransmit200Count = 0;
      sessionData.retransmit200Interval = this.T1;
      sessionData.maxRetransmits = 7;

      sessionData.ackTimeoutTimer = setTimeout(() => {
        if (!sessionData.ackReceived) {
          this.logger.error('ACK timeout', { callId });
          this.emit('call-failed', webrtcUserId, 'ACK timeout');
          this.cleanupSession(callId);
        }
      }, this.TIMER_H);

      const retransmit200OK = () => {
        if (sessionData.ackReceived || sessionData.retransmit200Count >= sessionData.maxRetransmits) {
          return;
        }

        sessionData.retransmit200Count++;
        this.sendResponse(request, 200, 'OK', sessionData.rinfo, answerResponse.sdp);

        const nextInterval = Math.min(sessionData.retransmit200Interval * 2, this.T2);
        sessionData.retransmit200Interval = nextInterval;
        sessionData.retransmit200Timer = setTimeout(retransmit200OK, nextInterval);
      };

      sessionData.retransmit200Timer = setTimeout(retransmit200OK, this.T1);

    } catch (error) {
      this.logger.error('Error answering SIP call', {
        callId,
        error: error.message,
        stack: error.stack
      });
      await this.cleanupSession(callId);
      throw error;
    }
  }

  async rejectCall(callId, statusCode = 603, reason = 'Decline') {
    this.logger.info('Rejecting call', { callId, statusCode, reason });

    const sessionData = this.sessions.get(callId);
    if (!sessionData || sessionData.direction !== 'incoming') {
      return;
    }

    try {
      this.sendResponse(
        sessionData.sipRequest,
        statusCode,
        reason,
        sessionData.rinfo
      );

      await this.cleanupSession(callId);
    } catch (error) {
      this.logger.error('Error rejecting call', {
        callId,
        error: error.message
      });
    }
  }

  handleAck(request, rinfo) {
    const callId = request.headers['call-id'];
    const session = this.sessions.get(callId);

    if (session) {
      if (session.retransmit200Timer) {
        clearTimeout(session.retransmit200Timer);
        session.retransmit200Timer = null;
      }

      if (session.ackTimeoutTimer) {
        clearTimeout(session.ackTimeoutTimer);
        session.ackTimeoutTimer = null;
      }

      session.ackReceived = true;
      session.state = 'established';

      this.logger.info('ACK received - call fully established', {
        callId,
        retransmissions: session.retransmit200Count || 0
      });

      if (session.transactionKey) {
        this.inviteTransactions.delete(session.transactionKey);
        this.logger.debug('INVITE transaction completed and removed', {
          callId,
          transactionKey: session.transactionKey
        });
      }
    } else {
      this.logger.warn('ACK received for unknown call', { callId });
    }
  }

  handleBye(request, rinfo) {
    const callId = request.headers['call-id'];
    this.logger.info('BYE received', { callId });

    const session = this.sessions.get(callId);
    if (session) {
      this.sendResponse(request, 200, 'OK', rinfo);

      if (session.direction === 'incoming' && session.webrtcUserId) {
        this.emit('sip-call-ended', callId);
      } else if (session.direction === 'outgoing' && session.webrtcClientId) {
        this.emit('call-ended', session.webrtcClientId);
      }

      this.cleanupSession(callId);
    } else {
      this.sendResponse(request, 481, 'Call/Transaction Does Not Exist', rinfo);
    }
  }

  handleCancel(request, rinfo) {
    const callId = request.headers['call-id'];
    this.logger.info('CANCEL received', { callId });

    const session = this.sessions.get(callId);
    if (session && session.state === 'ringing') {
      this.sendResponse(request, 200, 'OK', rinfo);

      this.sendResponse(session.sipRequest, 487, 'Request Terminated', session.rinfo);

      if (session.webrtcUserId) {
        this.emit('sip-call-ended', callId);
      }

      this.cleanupSession(callId);
    } else {
      this.sendResponse(request, 481, 'Call/Transaction Does Not Exist', rinfo);
    }
  }

  async hangup(callId) {
    const sessionData = this.sessions.get(callId);
    if (!sessionData) {
      throw new Error('Session not found');
    }

    this.logger.info('Hanging up call', { callId });

    const byeMessage = {
      method: 'BYE',
      uri: sessionData.targetUri || `sip:${sessionData.fromTag}@${this.config.sipServerHost}`,
      headers: {
        'via': `SIP/2.0/UDP ${this.advertiseIP}:${this.config.localSipPort};branch=${this.generateBranch()}`,
        'max-forwards': '70',
        'from': sessionData.direction === 'outgoing'
          ? `<sip:webrtc@${this.advertiseIP}>;tag=${sessionData.fromTag}`
          : `<sip:fede@${this.advertiseIP}>;tag=${sessionData.toTag}`,
        'to': sessionData.direction === 'outgoing'
          ? `<${sessionData.targetUri}>;tag=${sessionData.toTag}`
          : `<sip:${sessionData.from}>;tag=${sessionData.fromTag}`,
        'call-id': callId,
        'cseq': `${++sessionData.cseq} BYE`
      }
    };

    this.sendSipMessage(
      byeMessage,
      this.config.sipServerHost,
      this.config.sipServerPort
    );

    this.logger.debug('BYE sent', { callId });

    await this.cleanupSession(callId);
  }

  async cleanupSession(callId) {
    const session = this.sessions.get(callId);
    if (!session) {
      return;
    }

    this.logger.debug('Cleaning up session', { callId });

    if (session.retransmit200Timer) {
      clearTimeout(session.retransmit200Timer);
    }

    if (session.ackTimeoutTimer) {
      clearTimeout(session.ackTimeoutTimer);
    }

    if (session.transactionKey) {
      this.inviteTransactions.delete(session.transactionKey);
      this.logger.debug('INVITE transaction removed during cleanup', {
        callId,
        transactionKey: session.transactionKey
      });
    }

    try {
      await this.rtpengineOperationWithRetry(() =>
        this.rtpengineClient.delete(
          this.config.rtpenginePort,
          this.config.rtpengineHost,
          {
            'call-id': callId,
            'from-tag': session.fromTag,
            'to-tag': session.toTag
          }
        )
      );
      this.logger.debug('RTPEngine session deleted', { callId });
    } catch (error) {
      this.logger.error('Error deleting RTPEngine session', {
        callId,
        error: error.message
      });
    }

    this.sessions.delete(callId);
    this.metrics.activeSessions = Math.max(0, this.metrics.activeSessions - 1);

    this.logger.info('Session cleanup complete', {
      callId,
      activeSessions: this.metrics.activeSessions
    });
  }

  async rtpengineOperationWithRetry(operation, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        return await operation();
      } catch (error) {
        if (i === retries - 1) {
          throw error;
        }
        this.logger.warn('RTPEngine operation failed, retrying...', {
          attempt: i + 1,
          error: error.message
        });
        await new Promise(resolve => setTimeout(resolve, 100 * (i + 1)));
      }
    }
  }

  generateCallId() {
    return `${Date.now()}${Math.floor(Math.random() * 1000000)}@${this.advertiseIP}`;
  }

  generateTag() {
    return crypto.randomBytes(6).toString('hex');
  }

  generateBranch() {
    return `z9hG4bK${crypto.randomBytes(16).toString('hex')}`;
  }

  getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }

  getMetrics() {
    const uptime = Math.floor((Date.now() - this.metrics.startTime) / 1000);
    return {
      ...this.metrics,
      uptimeSeconds: uptime
    };
  }

  async shutdown() {
    this.logger.info('Shutting down SIP Gateway');
    this.isRunning = false;

    for (const callId of this.sessions.keys()) {
      try {
        await this.hangup(callId);
      } catch (error) {
        this.logger.error('Error hanging up call during shutdown', {
          callId,
          error: error.message
        });
      }
    }

    if (this.socket) {
      this.socket.close();
    }

    this.logger.info('SIP Gateway shutdown complete');
  }
}

module.exports = SipGateway;
