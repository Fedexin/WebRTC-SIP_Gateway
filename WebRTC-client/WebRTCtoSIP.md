# WebRTCtoSIP: Tipi di Pacchetti, Campi e Flusso di Segnalazione

## Introduzione
Questo documento spiega nel dettaglio i principali pacchetti che WebRTC e SIP possono ricevere e inviare. Per ogni tipo vengono analizzati tutti i campi rilevanti, la funzione di ognuno, un esempio concreto, e il flusso di scambio tra client WebRTC e SIP attraverso un gateway di signaling.

---

## 1. Pacchetti WebRTC

### a) SDP (Session Description Protocol)
Utilizzato da WebRTC nel modello Offer/Answer (RFC 3264) per negoziare la connessione audio/video.

```text
v=0 // Versione SDP
 o=alice 2890844526 2890844526 IN IP4 host.anywhere.com // Origin: username, session id/version, IP
 s=- // Session name
 t=0 0 // Timing
 c=IN IP4 203.0.113.1 // Connection info: indirizzo IP del media
 m=audio 49170 RTP/AVP 0 // Media: tipo (audio), porta, trasporto, payload types
 a=rtpmap:0 PCMU/8000 // Associa payload type 0 a codec PCMU 8000Hz
 a=sendrecv // Direzione: invio e ricezione
 a=ice-ufrag:abcd
 a=ice-pwd:xyzabr // Credenziali ICE
 a=candidate:1 1 UDP 2130706431 192.0.2.1 54400 typ host // ICE Candidate dettagliata
 a=fingerprint:sha-256 12:34:56:... // Fingerprint DTLS
```

**Campi principali:**
- `v`: versione SDP
- `o`: origin (user, session id/version)
- `s`: session name
- `t`: timing
- `c`: connection info
- `m`: media line (audio/video, porta, trasporto, codec)
- `a`: attributi vari (rtpmap, fmtp, ice-ufrag, ice-pwd, candidate, fingerprint, sendrecv)

**Funzione:** Descrive capacità sessione, codec, trasporto, sicurezza, attraversamento NAT.

---

### b) STUN (Session Traversal Utilities for NAT – RFC 5389)
Pacchetti usati da WebRTC (tramite ICE) per scoprire l'indirizzo pubblico e validare connettività.

```text
// Header STUN (20 byte)
0 1 2 3  // byte
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|0 0| Message Type | Message Length |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Magic Cookie |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Transaction ID (96 bit) |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+

// Attributi STUN (TLV)
| Type (16 bit) | Length (16 bit) | Value |
```

**Header:**
- `Message Type` (14 bit): es. 0x0001 Binding Request
- `Message Length` (16 bit): lunghezza attributi
- `Magic Cookie` (32 bit): valore fisso 0x2112A442
- `Transaction ID` (96 bit): identificativo univoco

**Attributi principali:**
- `USERNAME`: autenticazione (per ICE)
- `MESSAGE-INTEGRITY`: HMAC-SHA1
- `FINGERPRINT`: CRC32
- `XOR-MAPPED-ADDRESS`: indirizzo/porta visti dal server (NAT)
- `SOFTWARE`: info implementazione

**Esempio Binding Request:**
```text
Message Type: 0x0001
Message Length: ...
Magic Cookie: 0x2112A442
Transaction ID: aabbccddeeff001122334455
[ Attribute ]
Type: USERNAME (0x0006)
Value: "ufrag1:ufrag2"
Type: MESSAGE-INTEGRITY (0x0008)
Type: FINGERPRINT (0x8028)
```

**Funzione:** Permette scambio address/validazione con server, attraversamento NAT (ICE).

---

### c) TURN (Traversal Using Relays Around NAT – RFC 5766)
Per inoltrare traffico media in caso di NAT restrittivi.

**Messaggi TURN:**
- Allocate Request/Response (creazione relayed transport address)
- Refresh (estensione/terminazione allocazione)
- ChannelBind, CreatePermission, Send/Indication

**Campi chiave:**
- Network 5-tuple: client IP/port, server IP/port, protocol
- relayed transport address: IP/port sul server
- lifetime: durata allocazione

**Esempio:**
```text
Allocate Request (con autenticazione)
Success Response: relayed address=192.0.2.15:50000
Refresh ogni N sec (default 10min)
```

**Funzione:** Permette relay media, zona di buffer per gestire NAT e sicurezza.

---

### d) RTP (Real-Time Transport Protocol – RFC 3550)
Protocollo di trasporto media in tempo reale (audio/video).

```text
// Header RTP (12+ byte)
0 1 2 3
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|V=2|P|X|CC|M|PT| sequence number |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| timestamp |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| SSRC |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| CSRC list (se presente) |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
// Payload (audio/video)
```

**Campi header:**
- `V` (Version): sempre 2
- `P` (Padding): presenza padding
- `X` (Extension): header extension
- `CC` (CSRC count): numero mixer
- `M` (Marker): evento significativo (frame boundary)
- `PT` (Payload Type): codec (es 111=Opus)
- `sequence number`, `timestamp`: ordinamento/sinc
- `SSRC`, `CSRC`: identificatori sorgente

---

### e) RTCP (Real-Time Transport Control Protocol)
Controllo qualità/feedback per RTP.

```text
// Header RTCP
0 1 2 3
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|V=2|P|RC|PT| length |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
// Payload diverso per tipo (SR, RR, SDES, BYE, APP)
```

**Tipi pacchetti:**
- `SR` (Sender Report, PT=200)
- `RR` (Receiver Report, PT=201)
- `SDES`, `BYE`, `APP`

**Campi SR:**
- `SSRC`: ID mittente
- `NTP Timestamp`: wall clock
- `RTP Timestamp`: sinc media
- `Packet count`, `Octet count`: statistica media

**Funzione:** qualità canale, statistiche, chiusura stream, feedback (NACK, PLI).

---

## 2. Pacchetti SIP

### a) SIP Request (RFC 3261)
Gestisce segnalazione (INVITE, ACK, BYE, REGISTER, CANCEL, ...).

```text
INVITE sip:bob@biloxi.com SIP/2.0
Via: SIP/2.0/UDP pc33.atlanta.com;branch=z9hG4bK776asdhds
Max-Forwards: 70
From: "Alice" <sip:alice@atlanta.com>;tag=1928301774
To: "Bob" <sip:bob@biloxi.com>
Call-ID: a84b4c76e66710
CSeq: 314159 INVITE
Contact: <sip:alice@pc33.atlanta.com>
Content-Type: application/sdp
Content-Length: ...

[v=0... SDP in body]
```

**Header chiave:**
- `Via`: rotta (con branch)
- `From`: mittente (con tag)
- `To`: destinatario (con tag lato UAS)
- `Call-ID`: id globale chiamata
- `CSeq`: sequence e metodo
- `Contact`: indirizzo diretto future richieste
- `Max-Forwards`: limite hops
- `Content-Type/Length`: tipo e lunghezza corpo (SDP/media)

**Funzione:** avvio, aggiornamento, terminazione dialoghi/media.

---

### b) SIP Response
Risposte a richieste SIP (1xx provisional, 2xx successo, 3xx redirezione, 4xx error client, 5xx error server, 6xx error globale).

```text
SIP/2.0 200 OK
Via: SIP/2.0/UDP pc33.atlanta.com;branch=z9hG4bK776asdhds
From: "Alice" <sip:alice@atlanta.com>;tag=1928301774
To: "Bob" <sip:bob@biloxi.com>;tag=hsu78
Call-ID: a84b4c76e66710
CSeq: 314159 INVITE
Contact: <sip:bob@client.biloxi.com>
Content-Type: application/sdp
Content-Length: ...

[v=0... SDP in body]
```

**Header chiave:** uguali alla richiesta corrispondente.

**Funzione:** completamento, errore, avanzamento stato della chiamata/dialogo.

---

## 3. Flusso di Scambio: WebRTC ↔ Gateway ↔ SIP
Di seguito il flusso tipico di scambio pacchetti tra client WebRTC e SIP, con specifiche dei tipi e campi.

### Step 1) Collegamento iniziale
- WebRTC: genera SDP Offer con `m=`, `a=ice-ufrag`, `a=ice-pwd`, `a=fingerprint`, `a=candidate`, inviato al server gateway.
- SIP: invia REGISTER (aggiorna bindings), riceve 200 OK.

### Step 2) Avvio chiamata/negoziazione
- WebRTC → Gateway: SDP Offer (con ICE/codec)
- Gateway → SIP: INVITE con SDP nel body
- SIP UAS → Gateway: 180 Ringing, 200 OK con SDP Answer
- Gateway → WebRTC: SDP Answer

### Step 3) ICE NAT Traversal
- STUN Binding Request/Response per validazione candidati
- TURN Allocate/Refresh per relay se necessario

### Step 4) Media e Controllo
- RTP: trasporto media in pacchetti con header sopra
- RTCP: report qualità, sincronizzazione, chiusura (BYE)

### Step 5) Messaggi intermedi
- SIP UPDATE/INFO/MESSAGE per nuovi parametri, diagnostica
- Re-INVITE per cambio codec/direzionalità in corso

### Step 6) Termine chiamata
- SIP BYE (chiusura dialogo)
- RTCP BYE (fine stream)
- TURN Refresh lifetime=0 (rilascio relay)

### Step 7) Uscita
- WebRTC chiude peer connection, rilascia risorse
- SIP dialogo chiuso, nessuna nuova segnalazione

---

## Tabella comparativa ruoli/format

| Aspetto          | WebRTC                                        | SIP                       |
|------------------|-----------------------------------------------|---------------------------|
| Negoziazione     | SDP Offer/Answer; ICE, DTLS/SRTP              | INVITE, risposta, dialogo |
| NAT Traversal    | ICE (STUN/TURN)                               | Demandato a media path    |
| Media            | RTP, RTCP; codec negoziati                    | SDP in body, media via RTP|
| Controllo        | RTCP feedback, report                         | Metodi, risposte, dialoghi|

---

## Fonti principali
- RFC 3264, RFC 3261, RFC 5389, RFC 5766, RFC 3550
- Esempi e dettagli tratti da RFC e documentazione tecnica
