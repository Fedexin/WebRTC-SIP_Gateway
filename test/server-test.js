'use strict';
const dgram = require('dgram');
const crypto = require('crypto');

const BIND_ADDR = process.env.BIND_ADDR || '0.0.0.0';     // es. 0.0.0.0
const PORT = parseInt(process.env.PORT || '5060', 10);    // es. 5060
const ADVERTISE_ADDR = process.env.ADVERTISE_ADDR || '192.168.1.209'; // IP che metti in Contact

const CRLF = '\r\n';

function parseSipMessage(buf) {
  const data = buf.toString();
  const headerEnd = data.indexOf('\r\n\r\n');
  const head = headerEnd >= 0 ? data.slice(0, headerEnd) : data;
  const body = headerEnd >= 0 ? data.slice(headerEnd + 4) : '';

  const lines = head.split(/\r\n/);
  const startLine = lines.shift() || '';
  const isResponse = startLine.startsWith('SIP/2.0');
  let method = '';
  let uri = '';
  let status = 0;
  let reason = '';

  if (isResponse) {
    const m = startLine.match(/^SIP\/2\.0\s+(\d{3})\s+(.*)$/);
    if (m) {
      status = parseInt(m[1], 10);
      reason = m[2];
    }
  } else {
    const m = startLine.match(/^(\w+)\s+(\S+)\s+SIP\/2\.0$/);
    if (m) {
      method = m[1];
      uri = m[2];
    }
  }

  const headers = {};
  let currentName = '';
  let currentValue = '';
  const pushHeader = () => {
    if (!currentName) return;
    const name = currentName.toLowerCase();
    if (headers[name] === undefined) {
      headers[name] = currentValue;
    } else if (Array.isArray(headers[name])) {
      headers[name].push(currentValue);
    } else {
      headers[name] = [headers[name], currentValue];
    }
  };

  for (const raw of lines) {
    if (/^[ \t]/.test(raw)) {
      currentValue += ' ' + raw.trim();
      continue;
    }
    if (currentName) pushHeader();
    const idx = raw.indexOf(':');
    if (idx >= 0) {
      currentName = raw.slice(0, idx).trim();
      currentValue = raw.slice(idx + 1).trim();
    }
  }
  if (currentName) pushHeader();

  // Espandi compact headers comuni
  if (headers.v && !headers['via']) headers['via'] = headers.v;
  if (headers.f && !headers['from']) headers['from'] = headers.f;
  if (headers.t && !headers['to']) headers['to'] = headers.t;
  if (headers.i && !headers['call-id']) headers['call-id'] = headers.i;
  if (headers.l && !headers['content-length']) headers['content-length'] = headers.l;
  if (headers.c && !headers['content-type']) headers['content-type'] = headers.c;

  // Normalizza Via a array
  if (headers['via'] && !Array.isArray(headers['via'])) {
    headers['via'] = [headers['via']];
  }

  return { startLine, isResponse, method, uri, status, reason, headers, body };
}

function ensureToHasTag(toValue) {
  if (!toValue) return `;tag=${crypto.randomBytes(4).toString('hex')}`;
  if (/;tag=/.test(toValue)) return toValue;
  return `${toValue};tag=${crypto.randomBytes(4).toString('hex')}`;
}

function adjustTopViaForRport(viaValue, rinfo) {
  // Se c'è rport senza valore, aggiungi rport=<port> e received=<ip>
  // Esempio: SIP/2.0/UDP 1.2.3.4:5060;branch=...;rport
  if (!viaValue) return viaValue;
  const hasRport = /(;|\s)rport(=|;|$)/i.test(viaValue);
  if (!hasRport) return viaValue;
  // rport già valorizzato?
  if (/rport=\d+/.test(viaValue)) {
    // aggiungi received se manca
    if (!/received=/.test(viaValue)) {
      return viaValue + `;received=${rinfo.address}`;
    }
    return viaValue;
  }
  // rport senza valore: sostituisci "rport" con "rport=<port>"
  let out = viaValue.replace(/(;|\s)rport(?!=)/i, `;rport=${rinfo.port}`);
  if (!/received=/.test(out)) out += `;received=${rinfo.address}`;
  return out;
}

function buildResponse(req, rinfo, code, reason, extraHeaders = [], body = '') {
  const callId = req.headers['call-id'] || '';
  const cseq = req.headers['cseq'] || '';
  const from = req.headers['from'] || '';
  const to = ensureToHasTag(req.headers['to'] || '');
  const vias = (req.headers['via'] || []).map(v => adjustTopViaForRport(v, rinfo));
  const contact = `<sip:${ADVERTISE_ADDR}:${PORT}>`;
  const contentLength = Buffer.byteLength(body, 'utf8');

  const lines = [];
  lines.push(`SIP/2.0 ${code} ${reason}`);
  vias.forEach(v => lines.push(`Via: ${v}`));
  lines.push(`From: ${from}`);
  lines.push(`To: ${to}`);
  lines.push(`Call-ID: ${callId}`);
  lines.push(`CSeq: ${cseq}`);
  // Contact opzionale nelle risposte non 1xx/ACK/CANCEL
  if (code >= 200 && req.method !== 'BYE') {
    lines.push(`Contact: ${contact}`);
  }
  // Header extra
  extraHeaders.forEach(h => lines.push(h));
  lines.push(`Content-Length: ${contentLength}`);
  if (contentLength > 0) {
    lines.push('');
    lines.push(body);
  }
  return lines.join(CRLF) + CRLF + CRLF;
}

function logCompleteMessage(msg, rinfo, direction = '>>>') {
  const messageStr = msg.toString();
  console.log(`\n${direction} Messaggio completo da ${rinfo.address}:${rinfo.port}`);
  console.log('─'.repeat(80));
  console.log(messageStr);
  console.log('─'.repeat(80));
}

function logRequest(req, rinfo) {
  const from = req.headers['from'] || '';
  const to = req.headers['to'] || '';
  const callId = req.headers['call-id'] || '';
  const cseq = req.headers['cseq'] || '';
  console.log(`\n>>> ${req.startLine}  from ${rinfo.address}:${rinfo.port}`);
  console.log(`From: ${from}`);
  console.log(`To:   ${to}`);
  console.log(`Call-ID: ${callId}  CSeq: ${cseq}`);
}

const socket = dgram.createSocket('udp4');

socket.on('message', (msg, rinfo) => {
  // Prima stampa il messaggio completo
  logCompleteMessage(msg, rinfo, '>>>');

  let req;
  try {
    req = parseSipMessage(msg);
  } catch (e) {
    console.error('Parse error:', e.message);
    return;
  }
  if (!req || req.isResponse) {
    // Logga comunque
    console.log(`\n>>> Response received or malformed from ${rinfo.address}:${rinfo.port}`);
    console.log((msg.toString().slice(0, 2000)));
    return;
  }

  logRequest(req, rinfo);

  const send = (payload) => {
    const buf = Buffer.from(payload, 'utf8');
    // Anche stampa i messaggi in uscita
    logCompleteMessage(buf, rinfo, '<<<');
    socket.send(buf, 0, buf.length, rinfo.port, rinfo.address);
  };

  switch (req.method) {
    case 'INVITE': {
      // 100 Trying
      send(buildResponse(req, rinfo, 100, 'Trying'));
      // 603 Decline per rifiutare tutte le chiamate
      send(buildResponse(req, rinfo, 603, 'Decline'));
      break;
    }
    case 'ACK': {
      // Nessuna risposta a ACK per RFC, solo log
      break;
    }
    case 'CANCEL': {
      // 200 OK al CANCEL
      send(buildResponse(req, rinfo, 200, 'OK'));
      break;
    }
    case 'BYE': {
      // Chiudi dialoghi in test
      send(buildResponse(req, rinfo, 200, 'OK'));
      break;
    }
    case 'OPTIONS': {
      const extra = [
        'Allow: INVITE, ACK, BYE, CANCEL, OPTIONS',
        `Contact: <sip:${ADVERTISE_ADDR}:${PORT}>`,
        'Accept: application/sdp'
      ];
      send(buildResponse(req, rinfo, 200, 'OK', extra));
      break;
    }
    case 'REGISTER': {
      // Permetti ai client di "credere" che si registrino con successo
      const extra = ['Expires: 3600'];
      send(buildResponse(req, rinfo, 200, 'OK', extra));
      break;
    }
    default: {
      send(buildResponse(req, rinfo, 501, 'Not Implemented'));
    }
  }
});

socket.on('listening', () => {
  const addr = socket.address();
  console.log(`Fake SIP sink listening on ${addr.address}:${addr.port} (advertise=${ADVERTISE_ADDR})`);
});

socket.on('error', (err) => {
  console.error('Socket error:', err);
});

socket.bind(PORT, BIND_ADDR);
