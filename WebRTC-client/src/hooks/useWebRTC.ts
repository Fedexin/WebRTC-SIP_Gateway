// useWebRTC.ts
import { useState, useEffect, useRef } from 'react';
import { WebRTCService, type WebRTCEvents } from '@/services/WebRTCService';
import { useToast } from '@/hooks/use-toast';

export interface UseWebRTCReturn {
  // State
  isInitialized: boolean;
  isConnected: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  connectionState: RTCPeerConnectionState | null;
  currentCall: { with: string; isInitiator: boolean } | null;
  incomingCall: { from: string } | null;
  username: string;

  // Actions
  initialize: (username: string) => Promise<void>;
  connect: (serverUrl: string) => Promise<void>;
  startCall: (targetUser: string) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  endCall: () => void;
  toggleAudio: () => boolean;
  toggleVideo: () => boolean;
  switchDevice: (deviceId: string, kind: 'audioinput' | 'videoinput') => Promise<void>;
  getMediaDevices: () => Promise<{ audioInputs: MediaDeviceInfo[], videoInputs: MediaDeviceInfo[] }>;
  getCurrentDevices: () => { audioDeviceId?: string, videoDeviceId?: string };
  disconnect: () => void;

  // WebRTC service instance
  service: WebRTCService;
}



export const useWebRTC = (): UseWebRTCReturn => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState | null>(null);
  const [currentCall, setCurrentCall] = useState<{ with: string; isInitiator: boolean } | null>(null);
  const [incomingCall, setIncomingCall] = useState<{ from: string } | null>(null);
  const [username, setUsername] = useState('');

  const serviceRef = useRef<WebRTCService>(new WebRTCService());
  const { toast } = useToast();

  useEffect(() => {
    const service = serviceRef.current;

    console.log('🔧 Registering WebRTC events...');
    const events: WebRTCEvents = {
      onRemoteStream: (stream: MediaStream) => {
        console.log('Remote stream received');
        setRemoteStream(stream);
      },

      onConnectionStateChange: (state: RTCPeerConnectionState) => {
        console.log('Connection state changed to:', state);
        setConnectionState(state);
        setCurrentCall(service.getCurrentCall());

        if (state === 'connected') {
          toast({
            title: "Chiamata connessa",
            description: "La chiamata è ora attiva",
          });
        } else if (state === 'failed') {
          toast({
            title: "Connessione fallita",
            description: "La chiamata non è riuscita",
            variant: "destructive"
          });
        }
      },

      onLocalStreamUpdated: (stream: MediaStream | null) => {
        console.log('Local stream updated');
        setLocalStream(stream);
      },

      onCallRequest: (from: string) => {
        console.log('🔔 Hook: onCallRequest triggered by:', from);
        console.log('🔍 Hook: Setting incomingCall state...');
        setIncomingCall({ from });
        console.log('✅ Hook: incomingCall state set');
        toast({
          title: "Chiamata in arrivo",
          description: `${from} ti sta chiamando`,
        });
        console.log('✅ Hook: Toast shown');
      },

      onCallResponse: (accepted: boolean, from: string) => {
        console.log('Call response:', accepted, 'from:', from);
        if (accepted) {
          toast({
            title: "Chiamata accettata",
            description: `${from} ha accettato la chiamata`,
          });
          setCurrentCall(service.getCurrentCall());
        } else {
          toast({
            title: "Chiamata rifiutata",
            description: `${from} ha rifiutato la chiamata`,
            variant: "destructive"
          });
          setCurrentCall(null);
        }
        setIncomingCall(null);
      },

      onCallEnd: () => {
        console.log('Call ended');
        setRemoteStream(null);
        setConnectionState(null);
        setCurrentCall(null);
        setIncomingCall(null);

        // Ferma i media locali anche per chi viene disconnesso
        serviceRef.current.stopLocalMediaAfterCall();

        toast({
          title: "Chiamata terminata",
          description: "La chiamata è stata chiusa",
        });
      },


      onError: (error: string) => {
        console.error('WebRTC Error:', error);
        toast({
          title: "Errore WebRTC",
          description: error,
          variant: "destructive"
        });
      }
    };

    // Register events
    Object.entries(events).forEach(([event, callback]) => {
      console.log('🔧 Registering event:', event);
      service.on(event as keyof WebRTCEvents, callback);
    });
    console.log('✅ All events registered');

    // Cleanup only events, keep connection
    return () => {
      console.log('Cleaning up useWebRTC hook events');
    };
  }, [toast]);



  const initialize = async (username: string): Promise<void> => {
    try {
      await serviceRef.current.initialize(username);
      setLocalStream(serviceRef.current.getLocalStream());
      setIsInitialized(true);
      setUsername(username);
      toast({
        title: "WebRTC inizializzato",
        description: `Benvenuto ${username}`,
      });
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Failed to initialize WebRTC');
    }
  };

  const connect = async (serverUrl: string): Promise<void> => {
    try {
      await serviceRef.current.connectToSignalingServer(serverUrl);
      setIsConnected(serviceRef.current.isConnected());
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Failed to connect to signaling server');
    }
  };

  const startCall = async (targetUser: string): Promise<void> => {
    try {
      console.log('🔄 Hook: Starting call to', targetUser);
      await serviceRef.current.startCall(targetUser);
      setCurrentCall(serviceRef.current.getCurrentCall());
      setLocalStream(serviceRef.current.getLocalStream());
      console.log('✅ Hook: Call started, currentCall:', serviceRef.current.getCurrentCall());
      toast({
        title: "Chiamata in corso",
        description: `Chiamando ${targetUser}...`,
      });
    } catch (error) {
      console.error('❌ Hook: startCall error:', error);
      throw new Error(error instanceof Error ? error.message : 'Failed to start call');
    }
  };

  const acceptCall = async (): Promise<void> => {
    try {
      await serviceRef.current.acceptCall();
      setCurrentCall(serviceRef.current.getCurrentCall());
      setLocalStream(serviceRef.current.getLocalStream());
      setIncomingCall(null);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Failed to accept call');
    }
  };

  const rejectCall = (): void => {
    serviceRef.current.rejectCall();
    setIncomingCall(null);
  };

  const endCall = (): void => {
    serviceRef.current.endCall();
  };

  const toggleAudio = (): boolean => {
    const result = serviceRef.current.toggleAudio(false);
    console.log('🔄 Hook: Audio toggled (disable only), muted:', result);
    return result;
  };

  const toggleVideo = (): boolean => {
    const result = serviceRef.current.toggleVideo(false);
    console.log('🔄 Hook: Video toggled (disable only), off:', result);
    return result;
  };



  const switchDevice = async (deviceId: string, kind: 'audioinput' | 'videoinput'): Promise<void> => {
    await serviceRef.current.switchDevice(deviceId, kind);
  };

  const getCurrentDevices = (): { audioDeviceId?: string, videoDeviceId?: string } => {
    return serviceRef.current.getCurrentDevices();
  };


  const getMediaDevices = async (): Promise<{ audioInputs: MediaDeviceInfo[], videoInputs: MediaDeviceInfo[] }> => {
    return await serviceRef.current.getMediaDevices();
  };


  const disconnect = (): void => {
    serviceRef.current.disconnect();
    setIsInitialized(false);
    setIsConnected(false);
    setLocalStream(null);
    setRemoteStream(null);
    setConnectionState(null);
    setCurrentCall(null);
    setIncomingCall(null);
    setUsername('');
  };

  return {
    // State
    isInitialized,
    isConnected,
    localStream,
    remoteStream,
    connectionState,
    currentCall,
    incomingCall,
    username,

    // Actions
    initialize,
    connect,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleAudio,
    toggleVideo,
    switchDevice,
    getMediaDevices,
    getCurrentDevices,
    disconnect,

    // Service
    service: serviceRef.current
  };
};
