// rtpengine-test.js - Test isolato per capire il flusso
const Client = require('rtpengine-client').Client;

const rtpengineClient = new Client({
  timeout: 5000,
  rejectOnFailure: true
});

const RTPENGINE_HOST = 'localhost';
const RTPENGINE_PORT = 22222;

// SDP da SIP client (dal tuo log)
const sipOfferSdp = `v=0
o=client1 0 0 IN IP4 192.168.1.127
s=-
c=IN IP4 192.168.1.127
t=0 0
m=audio 50001 rtp/avp 0 8
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
`;

// SDP da WebRTC client (ipotetico, basato sui tuoi log precedenti)
const webrtcAnswerSdp = `v=0
o=mozilla...THIS_IS_SDPARTA-99.0 9070652540500807940 0 IN IP4 0.0.0.0
s=-
t=0 0
a=msid-semantic:WMS *
m=audio 54321 UDP/TLS/RTP/SAVPF 0 8
c=IN IP4 192.168.1.209
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=ice-ufrag:test
a=ice-pwd:testpassword
a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF
a=setup:active
a=sendrecv
`;

async function testRTPEngineFlow() {
  console.log('🧪 Test RTPEngine Flow per Incoming Call\n');

  const callId = 'test-call-' + Date.now() + '@test';
  const fromTag = 'from-' + Math.random().toString(36).substring(7);
  const toTag = 'to-' + Math.random().toString(36).substring(7);

  try {
    // ============================================================
    // STEP 1: SIP Offer → WebRTC Offer
    // ============================================================
    console.log('📥 STEP 1: Processing SIP offer through RTPEngine');
    console.log('   Input: SIP SDP (RTP/AVP)');
    console.log('   Expected Output: WebRTC SDP (UDP/TLS/RTP/SAVPF)\n');

    const offerPayload = {
      'call-id': callId,
      'from-tag': fromTag,
      'sdp': sipOfferSdp,
      'ICE': 'force',
      'DTLS': 'passive',
      'transport-protocol': 'UDP/TLS/RTP/SAVPF',
      'rtcp-mux': ['require']
      // NO 'direction' - non supportato
    };

    console.log('Sending offer() to RTPEngine...');
    const offerResponse = await rtpengineClient.offer(
      RTPENGINE_PORT,
      RTPENGINE_HOST,
      offerPayload
    );

    console.log('✅ Offer response:', {
      result: offerResponse.result,
      sdpLength: offerResponse.sdp?.length || 0,
      hasSdp: !!offerResponse.sdp
    });

    if (offerResponse.result !== 'ok') {
      throw new Error('Offer failed: ' + offerResponse['error-reason']);
    }

    console.log('\n📤 WebRTC Offer SDP (first 200 chars):');
    console.log(offerResponse.sdp.substring(0, 200) + '...\n');

    // ============================================================
    // STEP 2: WebRTC Answer → SIP Answer
    // ============================================================
    console.log('📥 STEP 2: Processing WebRTC answer through RTPEngine');
    console.log('   Input: WebRTC SDP (UDP/TLS/RTP/SAVPF)');
    console.log('   Expected Output: SIP SDP (RTP/AVP)\n');

    const answerPayload = {
      'call-id': callId,
      'from-tag': fromTag,
      'to-tag': toTag,  // ← IMPORTANTE: deve esserci per answer()
      'sdp': webrtcAnswerSdp,
      'ICE': 'remove',
      'DTLS': 'off',
      'transport-protocol': 'RTP/AVP',
      'rtcp-mux': ['demux']
      // NO 'direction' - non supportato
    };

    console.log('Sending answer() to RTPEngine...');
    const answerResponse = await rtpengineClient.answer(
      RTPENGINE_PORT,
      RTPENGINE_HOST,
      answerPayload
    );

    console.log('✅ Answer response:', {
      result: answerResponse.result,
      sdpLength: answerResponse.sdp?.length || 0,
      hasSdp: !!answerResponse.sdp
    });

    if (answerResponse.result !== 'ok') {
      throw new Error('Answer failed: ' + answerResponse['error-reason']);
    }

    console.log('\n📤 SIP Answer SDP (first 200 chars):');
    console.log(answerResponse.sdp.substring(0, 200) + '...\n');

    // ============================================================
    // STEP 3: Cleanup
    // ============================================================
    console.log('🧹 Cleaning up session...');
    await rtpengineClient.delete(
      RTPENGINE_PORT,
      RTPENGINE_HOST,
      {
        'call-id': callId,
        'from-tag': fromTag,
        'to-tag': toTag
      }
    );

    console.log('\n✅ TEST PASSED - RTPEngine flow is correct!\n');
    console.log('Summary:');
    console.log('- offer() converted SIP → WebRTC');
    console.log('- answer() converted WebRTC → SIP');
    console.log('- No "No matching media" error\n');

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error('\nError details:', error);

    // Cleanup on error
    try {
      await rtpengineClient.delete(
        RTPENGINE_PORT,
        RTPENGINE_HOST,
        {
          'call-id': callId,
          'from-tag': fromTag,
          'to-tag': toTag
        }
      );
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

// Verifica connessione RTPEngine
async function pingRTPEngine() {
  console.log('🏓 Pinging RTPEngine...');
  try {
    const result = await rtpengineClient.ping(RTPENGINE_PORT, RTPENGINE_HOST);
    console.log('✅ RTPEngine is reachable:', result, '\n');
    return true;
  } catch (error) {
    console.error('❌ Cannot reach RTPEngine:', error.message);
    return false;
  }
}

// Main
async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  RTPEngine Flow Test - Incoming SIP Call');
  console.log('═══════════════════════════════════════════════════════\n');

  const isAlive = await pingRTPEngine();
  if (!isAlive) {
    console.log('Please start RTPEngine first:');
    console.log('  docker start server-rtpengine-1');
    process.exit(1);
  }

  await testRTPEngineFlow();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
