// WebRTCService.ts
export const USE_PERFECT_NEGOTIATION = true;

interface RTCConfiguration {
  iceServers: RTCIceServer[];
}

export interface SignalingMessage {
  type: 'register' | 'call-request' | 'call-response' | 'offer' | 'answer' | 'ice-candidate' |
  'hangup' | 'reject' | 'registered' | 'incoming-call' | 'call-answered' | 'call-ringing' |
  'call-failed' | 'call-ended' | 'call-rejected' | 'hang-up' | 'user-list' | 'user-joined' |
  'user-left' | 'error' | 'media-renegotiation' | 'dtmf' | 'connected';
  data?: any;
  from?: string;
  to?: string;
  username?: string;
  sdp?: any;
  callId?: string;
  accepted?: boolean;
  users?: string[];
  message?: string;
  reason?: string;
  digit?: string;
  duration?: number;
}

export interface WebRTCEvents {
  onRemoteStream: (stream: MediaStream) => void;
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
  onCallRequest: (from: string) => void;
  onCallResponse: (accepted: boolean, from: string) => void;
  onCallEnd: () => void;
  onError: (error: string) => void;
  onLocalStreamUpdated: (stream: MediaStream | null) => void;
}

export class WebRTCService {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private signalingSocket: WebSocket | null = null;
  private events: Partial<WebRTCEvents> = {};
  private isInitialized = false;
  private username = '';
  private currentCall: { with: string; isInitiator: boolean } | null = null;
  private needsUserRegistration = false;
  private rtcConfig: RTCConfiguration;

  // Perfect Negotiation
  private makingOffer = false;
  private ignoreOffer = false;
  private isSettingRemoteAnswerPending = false;
  private polite = false;

  private isNegotiating = false;
  private pendingIceCandidates: RTCIceCandidate[] = [];
  private pendingOffer: RTCSessionDescriptionInit | null = null;

  private defaultRTCConfiguration: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  };

  constructor(rtcConfig?: RTCConfiguration) {
    this.rtcConfig = rtcConfig || this.defaultRTCConfiguration;
  }

  async initialize(username: string): Promise<void> {
    if (this.isInitialized) {
      throw new Error('WebRTC service is already initialized');
    }

    this.username = username;
    console.log(`ℹ️ WebRTC Service initialized with username: ${username}`);
    console.log(`ℹ️ Perfect Negotiation Pattern: ${USE_PERFECT_NEGOTIATION ? 'ENABLED' : 'DISABLED'}`);
    this.isInitialized = true;

    if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
      console.log('Already connected to server, registering user now...');
      this.sendSignalingMessage({
        type: 'register',
        username: this.username
      });
      this.needsUserRegistration = false;
    } else {
      this.needsUserRegistration = true;
    }
  }

  async connectToSignalingServer(serverUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.signalingSocket = new WebSocket(serverUrl);

        this.signalingSocket.onopen = () => {
          console.log('✅ Connected to signaling server');
          if (this.username || this.needsUserRegistration) {
            if (this.username) {
              console.log('Registering user:', this.username);
              this.sendSignalingMessage({
                type: 'register',
                username: this.username
              });
              this.needsUserRegistration = false;
            }
          }
          resolve();
        };

        this.signalingSocket.onmessage = (event) => {
          console.log('📨 Received message from server:', event.data);
          this.handleSignalingMessage(JSON.parse(event.data));
        };

        this.signalingSocket.onerror = (error) => {
          console.error('❌ Signaling socket error:', error);
          this.events.onError?.('Connection to signaling server failed');
          reject(new Error('Failed to connect to signaling server'));
        };

        this.signalingSocket.onclose = () => {
          console.log('Disconnected from signaling server');
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  async getUserMedia(constraints: MediaStreamConstraints = { video: true, audio: true }): Promise<MediaStream> {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      return this.localStream;
    } catch (error) {
      console.error('Error getting user media:', error);
      throw new Error('Failed to access camera/microphone');
    }
  }

  async getMediaDevices(): Promise<{ audioInputs: MediaDeviceInfo[], videoInputs: MediaDeviceInfo[] }> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      const videoInputs = devices.filter(device => device.kind === 'videoinput');

      const filteredAudioInputs = this.filterDuplicateWindowsDevices(audioInputs);
      const filteredVideoInputs = this.filterDuplicateWindowsDevices(videoInputs);

      return { audioInputs: filteredAudioInputs, videoInputs: filteredVideoInputs };
    } catch (error) {
      console.error('Error getting media devices:', error);
      throw new Error('Failed to get media devices');
    }
  }

  private filterDuplicateWindowsDevices(devices: MediaDeviceInfo[]): MediaDeviceInfo[] {
    const filtered: MediaDeviceInfo[] = [];
    const seenLabels = new Set<string>();

    for (const device of devices) {
      let deviceLabel = device.label;

      if (deviceLabel.startsWith('Predefinito - ') ||
        deviceLabel.startsWith('Comunicazioni - ') ||
        deviceLabel.startsWith('Default - ') ||
        deviceLabel.startsWith('Communications - ')) {
        continue;
      }

      if (seenLabels.has(deviceLabel)) {
        continue;
      }

      seenLabels.add(deviceLabel);
      filtered.push(device);
    }

    return filtered.length > 0 ? filtered : devices;
  }

  async switchDevice(deviceId: string, kind: 'audioinput' | 'videoinput'): Promise<void> {
    try {
      console.log(`🔄 Switching ${kind} to device:`, deviceId);

      if (!this.localStream) {
        throw new Error('No local stream available');
      }

      const currentAudioTrack = this.localStream.getAudioTracks()[0];
      const currentVideoTrack = this.localStream.getVideoTracks()[0];
      const currentAudioEnabled = currentAudioTrack?.enabled ?? true;
      const currentVideoEnabled = currentVideoTrack?.enabled ?? true;

      let newStream: MediaStream;

      if (kind === 'audioinput') {
        const audioConstraints: MediaStreamConstraints = {
          audio: { deviceId: { exact: deviceId } },
          video: false
        };
        newStream = await navigator.mediaDevices.getUserMedia(audioConstraints);

        if (this.peerConnection) {
          const senders = this.peerConnection.getSenders();
          const newAudioTrack = newStream.getAudioTracks()[0];
          const audioSender = senders.find(s => s.track?.kind === 'audio');

          if (audioSender && newAudioTrack) {
            newAudioTrack.enabled = currentAudioEnabled;
            await audioSender.replaceTrack(newAudioTrack);
          }
        }

        if (currentAudioTrack) {
          currentAudioTrack.stop();
          this.localStream.removeTrack(currentAudioTrack);
        }

        const newAudioTrack = newStream.getAudioTracks()[0];
        if (newAudioTrack) {
          newAudioTrack.enabled = currentAudioEnabled;
          this.localStream.addTrack(newAudioTrack);
        }

      } else {
        const videoConstraints: MediaStreamConstraints = {
          audio: false,
          video: { deviceId: { exact: deviceId } }
        };
        newStream = await navigator.mediaDevices.getUserMedia(videoConstraints);

        if (this.peerConnection) {
          const senders = this.peerConnection.getSenders();
          const newVideoTrack = newStream.getVideoTracks()[0];
          const videoSender = senders.find(s => s.track?.kind === 'video');

          if (videoSender && newVideoTrack) {
            newVideoTrack.enabled = currentVideoEnabled;
            await videoSender.replaceTrack(newVideoTrack);
          }
        }

        if (currentVideoTrack) {
          currentVideoTrack.stop();
          this.localStream.removeTrack(currentVideoTrack);
        }

        const newVideoTrack = newStream.getVideoTracks()[0];
        if (newVideoTrack) {
          newVideoTrack.enabled = currentVideoEnabled;
          this.localStream.addTrack(newVideoTrack);
        }
      }

      if (this.peerConnection && this.currentCall) {
        await this.renegotiateConnection();
      }

      this.events.onLocalStreamUpdated?.(this.localStream);
    } catch (error) {
      console.error('Error switching device:', error);
      throw new Error(`Failed to switch ${kind} device`);
    }
  }

  private async renegotiateConnection(): Promise<void> {
    if (!this.peerConnection || !this.currentCall) return;

    try {
      console.log('🔄 Renegotiating connection...');
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      this.sendSignalingMessage({
        type: 'offer',
        to: this.currentCall.with,
        from: this.username,
        data: offer
      });
    } catch (error) {
      console.error('❌ Error during renegotiation:', error);
      throw error;
    }
  }

  async startCall(targetUser: string): Promise<void> {
    console.log('🚀 Starting call to', targetUser);

    if (!this.isInitialized || !this.signalingSocket) {
      throw new Error('WebRTC service not properly initialized');
    }

    if (!this.localStream) {
      await this.restartLocalMedia();
    }

    this.currentCall = { with: targetUser, isInitiator: true };
    this.polite = this.username < targetUser;
    console.log(`🎭 This peer is ${this.polite ? 'POLITE' : 'IMPOLITE'}`);

    console.log('📤 Sending call-request');
    this.sendSignalingMessage({
      type: 'call-request',
      to: targetUser,
      from: this.username
    });
  }

  async acceptCall(): Promise<void> {
    if (!this.currentCall || this.currentCall.isInitiator) {
      throw new Error('No incoming call to accept');
    }

    if (!this.localStream) {
      await this.restartLocalMedia();
    }

    this.polite = this.username < this.currentCall.with;
    console.log(`🎭 This peer is ${this.polite ? 'POLITE' : 'IMPOLITE'}`);

    console.log('📤 Sending call-response (accepted)');
    this.sendSignalingMessage({
      type: 'call-response',
      to: this.currentCall.with,
      from: this.username,
      accepted: true
    });

    if (!this.peerConnection) {
      await this.createPeerConnection();
    }

    if (this.pendingOffer) {
      console.log('📥 Processing pending offer after accept...');
      await this.handleOffer({
        type: 'offer',
        data: this.pendingOffer,
        from: this.currentCall.with
      });
      this.pendingOffer = null;
    }
  }

  rejectCall(): void {
    if (!this.currentCall || this.currentCall.isInitiator) {
      throw new Error('No incoming call to reject');
    }

    console.log('📤 Sending call-response (rejected)');
    this.sendSignalingMessage({
      type: 'call-response',
      to: this.currentCall.with,
      from: this.username,
      accepted: false
    });

    this.currentCall = null;
    this.pendingOffer = null;
  }

  endCall(): void {
    if (this.currentCall) {
      this.sendSignalingMessage({
        type: 'hangup',
        to: this.currentCall.with,
        from: this.username
      });
    }

    this.closePeerConnection();
    this.currentCall = null;
    this.pendingOffer = null;
    this.stopLocalMedia();
    this.events.onCallEnd?.();
  }

  private stopLocalMedia(types?: { audio?: boolean, video?: boolean }): void {
    if (!this.localStream) return;

    const stopAudio = types?.audio ?? true;
    const stopVideo = types?.video ?? true;

    if (stopAudio) {
      const audioTracks = this.localStream.getAudioTracks();
      audioTracks.forEach(track => {
        track.stop();
        this.localStream!.removeTrack(track);
      });
    }

    if (stopVideo) {
      const videoTracks = this.localStream.getVideoTracks();
      videoTracks.forEach(track => {
        track.stop();
        this.localStream!.removeTrack(track);
      });
    }

    if (this.localStream.getTracks().length === 0) {
      this.localStream = null;
    }

    this.events.onLocalStreamUpdated?.(this.localStream);
  }

  stopAudio(): void {
    this.stopLocalMedia({ audio: true, video: false });
    if (this.peerConnection) {
      const audioSender = this.peerConnection.getSenders().find(s => s.track?.kind === 'audio');
      if (audioSender) {
        audioSender.replaceTrack(null);
      }
    }
  }

  stopVideo(): void {
    this.stopLocalMedia({ audio: false, video: true });
    if (this.peerConnection) {
      const videoSender = this.peerConnection.getSenders().find(s => s.track?.kind === 'video');
      if (videoSender) {
        videoSender.replaceTrack(null);
      }
    }
  }

  async restartLocalMedia(): Promise<void> {
    if (!this.localStream) {
      try {
        await this.getUserMedia();
        this.events.onLocalStreamUpdated?.(this.localStream);
      } catch (error) {
        console.error('Failed to restart local media:', error);
        throw error;
      }
    }
  }

  toggleVideo(useTrackStop: boolean = false): boolean {
    if (!this.localStream) return false;

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (!videoTrack) return false;

    const wasEnabled = videoTrack.enabled;

    if (wasEnabled) {
      if (useTrackStop) {
        videoTrack.stop();
        if (this.peerConnection) {
          const videoSender = this.peerConnection.getSenders()
            .find(sender => sender.track?.kind === 'video');
          if (videoSender) {
            videoSender.replaceTrack(null);
          }
        }
      } else {
        videoTrack.enabled = false;
        if (this.peerConnection) {
          const videoSender = this.peerConnection.getSenders()
            .find(sender => sender.track?.kind === 'video');
          if (videoSender && videoSender.track) {
            videoSender.track.enabled = false;
          }
        }
      }
      this.events.onLocalStreamUpdated?.(this.localStream);
      return true;
    } else {
      if (videoTrack.readyState === 'ended') {
        this.restartVideoStreamSimple();
        return false;
      } else {
        videoTrack.enabled = true;
        if (this.peerConnection) {
          const videoSender = this.peerConnection.getSenders()
            .find(sender => sender.track?.kind === 'video');
          if (videoSender && videoSender.track) {
            videoSender.track.enabled = true;
          }
        }
        this.events.onLocalStreamUpdated?.(this.localStream);
        return false;
      }
    }
  }

  private async restartVideoStreamSimple(): Promise<void> {
    try {
      const audioTrack = this.localStream?.getAudioTracks()[0];
      const audioEnabled = audioTrack?.enabled ?? true;

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      if (this.localStream) {
        this.localStream.getTracks().forEach(track => track.stop());
      }

      this.localStream = newStream;

      const newAudioTrack = this.localStream.getAudioTracks()[0];
      if (newAudioTrack) {
        newAudioTrack.enabled = audioEnabled;
      }

      if (this.peerConnection) {
        const senders = this.peerConnection.getSenders();

        const videoSender = senders.find(s => s.track?.kind === 'video');
        const newVideoTrack = this.localStream.getVideoTracks()[0];
        if (videoSender && newVideoTrack) {
          await videoSender.replaceTrack(newVideoTrack);
        }

        const audioSender = senders.find(s => s.track?.kind === 'audio');
        if (audioSender && newAudioTrack) {
          await audioSender.replaceTrack(newAudioTrack);
        }
      }

      this.events.onLocalStreamUpdated?.(this.localStream);
    } catch (error) {
      console.error('Failed to restart video stream:', error);
    }
  }

  toggleAudio(useTrackStop: boolean = false): boolean {
    if (!this.localStream) return false;

    const audioTrack = this.localStream.getAudioTracks()[0];
    if (!audioTrack) return false;

    const wasEnabled = audioTrack.enabled;

    if (wasEnabled) {
      audioTrack.enabled = false;
      if (this.peerConnection) {
        const audioSender = this.peerConnection.getSenders()
          .find(sender => sender.track?.kind === 'audio');
        if (audioSender && audioSender.track) {
          audioSender.track.enabled = false;
        }
      }
      this.events.onLocalStreamUpdated?.(this.localStream);
      return true;
    } else {
      audioTrack.enabled = true;
      if (this.peerConnection) {
        const audioSender = this.peerConnection.getSenders()
          .find(sender => sender.track?.kind === 'audio');
        if (audioSender && audioSender.track) {
          audioSender.track.enabled = true;
        }
      }
      this.events.onLocalStreamUpdated?.(this.localStream);
      return false;
    }
  }

  private async createPeerConnection(): Promise<void> {
    console.log('🔧 Creating peer connection...');

    this.peerConnection = new RTCPeerConnection(this.rtcConfig);

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        this.peerConnection!.addTrack(track, this.localStream!);
      });
    }

    this.peerConnection.ontrack = (event) => {
      console.log('📺 Remote track received');
      this.events.onRemoteStream?.(event.streams[0]);
    };

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.currentCall) {
        console.log('🧊 Sending ICE candidate');
        this.sendSignalingMessage({
          type: 'ice-candidate',
          to: this.currentCall.with,
          from: this.username,
          data: event.candidate
        });
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection!.connectionState;
      console.log('🔗 Connection state:', state);
      this.events.onConnectionStateChange?.(state);

      if (state === 'failed' || state === 'disconnected') {
        this.endCall();
      }
    };

    if (USE_PERFECT_NEGOTIATION) {
      this.peerConnection.onnegotiationneeded = async () => {
        try {
          if (this.isNegotiating) {
            console.log('⏳ Already negotiating, skipping...');
            return;
          }

          this.isNegotiating = true;
          this.makingOffer = true;

          console.log('🔄 Negotiation needed, creating offer...');
          await this.peerConnection!.setLocalDescription();

          console.log('📤 Sending offer via negotiation');
          this.sendSignalingMessage({
            type: 'offer',
            to: this.currentCall!.with,
            from: this.username,
            data: this.peerConnection!.localDescription
          });
        } catch (error) {
          console.error('❌ Error in negotiation needed:', error);
        } finally {
          this.makingOffer = false;
          this.isNegotiating = false;
        }
      };
    }

    console.log('✅ Peer connection created');
  }

  private async handleSignalingMessage(message: SignalingMessage): Promise<void> {
    console.log('📨 Handling message type:', message.type);

    try {
      switch (message.type) {
        case 'connected':
          console.log('✅ Server connection confirmed');
          break;

        case 'registered':
          console.log('✅ Registration confirmed');
          break;

        case 'user-list':
          console.log('📋 Received users list:', message.users);
          break;

        case 'call-request':
          console.log('📞 Call request from:', message.from);
          this.currentCall = { with: message.from!, isInitiator: false };
          this.events.onCallRequest?.(message.from!);
          break;

        case 'call-response':
          console.log('📞 Call response:', message.accepted, 'from:', message.from);

          if (message.accepted) {
            if (this.currentCall?.isInitiator && !this.peerConnection) {
              await this.createPeerConnection();
            }
            this.events.onCallResponse?.(true, message.from!);
          } else {
            this.currentCall = null;
            this.pendingOffer = null;
            this.events.onCallResponse?.(false, message.from!);
          }
          break;

        case 'incoming-call':
          console.log('📞 Incoming call from:', message.from);
          this.currentCall = { with: message.from!, isInitiator: false };

          if (message.sdp) {
            console.log('💾 Saving pending offer with SDP');
            this.pendingOffer = message.sdp;
          }

          this.events.onCallRequest?.(message.from!);
          break;

        case 'call-answered':
          console.log('✅ Call answered by:', message.from);
          this.events.onCallResponse?.(true, message.from!);

          if (message.sdp) {
            try {
              if (!this.peerConnection) {
                await this.createPeerConnection();
              }
              const answerDesc = new RTCSessionDescription({
                type: 'answer',
                sdp: typeof message.sdp === 'string' ? message.sdp : message.sdp.sdp || JSON.stringify(message.sdp)
              });
              console.log('📥 Setting remote description (SIP answer)');
              await this.peerConnection!.setRemoteDescription(answerDesc);

              // Flush any queued ICE candidates
              if (this.pendingIceCandidates.length > 0) {
                console.log(`🧊 Adding ${this.pendingIceCandidates.length} pending ICE candidates`);
                for (const candidate of this.pendingIceCandidates) {
                  await this.peerConnection!.addIceCandidate(new RTCIceCandidate(candidate));
                }
                this.pendingIceCandidates = [];
              }
            } catch (error) {
              console.error('❌ Failed to apply SIP answer SDP:', error);
              this.events.onError?.('Failed to apply SIP answer SDP');
            }
          }
          break;

        case 'call-ringing':
          console.log('📞 Call ringing');
          break;

        case 'call-failed':
          console.log('❌ Call failed:', message.reason);
          this.currentCall = null;
          this.pendingOffer = null;
          this.events.onError?.(message.reason || 'Call failed');
          break;

        case 'call-rejected':
          console.log('❌ Call rejected by:', message.from);
          this.currentCall = null;
          this.pendingOffer = null;
          this.events.onCallResponse?.(false, message.from!);
          break;

        case 'offer':
          console.log('📨 Received offer from:', message.from);
          await this.handleOffer(message);
          break;

        case 'answer':
          console.log('📨 Received answer from:', message.from);
          await this.handleAnswer(message);
          break;

        case 'ice-candidate':
          if (this.peerConnection && message.data) {
            try {
              if (this.peerConnection.remoteDescription) {
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(message.data));
                console.log('🧊 ICE candidate added');
              } else {
                this.pendingIceCandidates.push(message.data);
                console.log('🧊 ICE candidate queued');
              }
            } catch (error) {
              console.error('❌ Error adding ICE candidate:', error);
            }
          }
          break;

        case 'hang-up':
        case 'call-ended':
          console.log('📞 Call ended by:', message.from);
          this.closePeerConnection();
          this.currentCall = null;
          this.pendingOffer = null;
          this.events.onCallEnd?.();
          break;

        case 'media-renegotiation':
          console.log('🔄 Media renegotiation requested');
          if (message.sdp) {
            await this.handleOffer({
              type: 'offer',
              data: message.sdp,
              from: message.from
            });
          }
          break;

        case 'dtmf':
          console.log('🔢 DTMF digit received:', message.digit);
          break;

        case 'error':
          console.error('❌ Server error:', message.message);
          this.events.onError?.(message.message || 'Unknown error');
          break;

        case 'user-joined':
          console.log('👋 User joined:', message.username);
          break;

        case 'user-left':
          console.log('👋 User left:', message.username);
          break;

        default:
          console.log('❓ Unknown message type:', message.type);
          break;
      }
    } catch (error) {
      console.error('Error handling signaling message:', error);
      this.events.onError?.(`Signaling error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleOffer(message: SignalingMessage): Promise<void> {
    if (!message.data) {
      console.error('❌ Offer without data');
      return;
    }

    if (!this.peerConnection) {
      await this.createPeerConnection();
    }

    if (USE_PERFECT_NEGOTIATION) {
      const offerCollision = (message.data.type === 'offer') &&
        (this.makingOffer || this.peerConnection!.signalingState !== 'stable');

      this.ignoreOffer = !this.polite && offerCollision;

      if (this.ignoreOffer) {
        console.log('⚠️ Impolite peer ignoring colliding offer');
        return;
      }

      if (this.polite && offerCollision) {
        console.log('🔄 Polite peer rolling back');
        await this.peerConnection!.setLocalDescription({ type: 'rollback' });
      }
    }

    try {
      console.log('📥 Setting remote description (offer)');
      await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(message.data));

      if (this.pendingIceCandidates.length > 0) {
        console.log(`🧊 Adding ${this.pendingIceCandidates.length} pending ICE candidates`);
        for (const candidate of this.pendingIceCandidates) {
          await this.peerConnection!.addIceCandidate(new RTCIceCandidate(candidate));
        }
        this.pendingIceCandidates = [];
      }

      console.log('📝 Creating answer...');
      const answer = await this.peerConnection!.createAnswer();
      await this.peerConnection!.setLocalDescription(answer);

      console.log('📤 Sending answer');
      this.sendSignalingMessage({
        type: 'answer',
        to: message.from!,
        from: this.username,
        data: answer
      });
    } catch (error) {
      console.error('❌ Error handling offer:', error);
      throw error;
    }
  }

  private async handleAnswer(message: SignalingMessage): Promise<void> {
    if (!message.data) {
      console.error('❌ Answer without data');
      return;
    }

    if (!this.peerConnection) {
      console.error('❌ No peer connection for answer');
      return;
    }

    try {
      console.log('📥 Setting remote description (answer)');
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(message.data));

      if (this.pendingIceCandidates.length > 0) {
        console.log(`🧊 Adding ${this.pendingIceCandidates.length} pending ICE candidates`);
        for (const candidate of this.pendingIceCandidates) {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
        this.pendingIceCandidates = [];
      }
    } catch (error) {
      console.error('❌ Error handling answer:', error);
      throw error;
    }
  }

  private sendSignalingMessage(message: SignalingMessage): void {
    if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
      this.signalingSocket.send(JSON.stringify(message));
    } else {
      console.error('Signaling socket not connected');
    }
  }

  private closePeerConnection(): void {
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.pendingIceCandidates = [];
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.isSettingRemoteAnswerPending = false;
    this.isNegotiating = false;
  }

  on<K extends keyof WebRTCEvents>(event: K, callback: WebRTCEvents[K]): void {
    this.events[event] = callback;
  }

  disconnect(): void {
    this.endCall();

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    if (this.signalingSocket) {
      this.signalingSocket.close();
      this.signalingSocket = null;
    }

    this.isInitialized = false;
    this.username = '';
    this.events = {};
    this.pendingOffer = null;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  getConnectionState(): RTCPeerConnectionState | null {
    return this.peerConnection?.connectionState || null;
  }

  getCurrentCall(): { with: string; isInitiator: boolean } | null {
    return this.currentCall;
  }

  getUsername(): string {
    return this.username;
  }

  getCurrentDevices(): { audioDeviceId?: string, videoDeviceId?: string } {
    if (!this.localStream) return {};

    const audioTrack = this.localStream.getAudioTracks()[0];
    const videoTrack = this.localStream.getVideoTracks()[0];

    return {
      audioDeviceId: audioTrack?.getSettings().deviceId,
      videoDeviceId: videoTrack?.getSettings().deviceId
    };
  }

  stopLocalMediaAfterCall(): void {
    this.stopLocalMedia();
  }

  isConnected(): boolean {
    return this.signalingSocket?.readyState === WebSocket.OPEN || false;
  }

  public isPerfectNegotiationEnabled(): boolean {
    return USE_PERFECT_NEGOTIATION;
  }
}
