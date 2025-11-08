import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { VideoCall } from '@/components/VideoCall';
import { IncomingCallModal } from '@/components/IncomingCallModal';
import SettingsMenu, { type SettingsMenuOption } from '@/components/SettingsMenu';
import { useWebRTCContext } from '@/App';
import { Button } from '@/components/ui/button';
import { ArrowLeft, PhoneOff } from 'lucide-react';

const Call = () => {
    const location = useLocation();
    const navigate = useNavigate();

    const {
        localStream,
        remoteStream,
        currentCall,
        incomingCall,
        isInitialized,
        isConnected,
        connectionState,
        username,
        toggleAudio,
        toggleVideo,
        acceptCall,
        rejectCall,
        endCall,
        switchDevice,
        getMediaDevices,
        getCurrentDevices
    } = useWebRTCContext();


    // Get call state from navigation
    const callState = location.state as {
        callActive?: boolean;
        targetUser?: string;
        isInitiator?: boolean;
    } | null;

    const targetUser = callState?.targetUser || currentCall?.with || "Utente";
    const isInCall = currentCall !== null;

    // Settings options including device management
    const settingsOptions: SettingsMenuOption[] = [
        {
            title: "Microfono",
            items: [],
            defaultIndex: 0,
            type: 'device',
            deviceType: 'audioinput'
        },
        {
            title: "Camera",
            items: [],
            defaultIndex: 0,
            type: 'device',
            deviceType: 'videoinput'
        },
        {
            title: "Qualità Video",
            items: ["4K", "1080p", "720p", "480p"],
            defaultIndex: 1
        },
        {
            title: "Tema",
            items: ["Dark", "Light", "Auto"],
            defaultIndex: 0
        }
    ];

    // Handle settings changes
    const handleSettingsChange = (optionIndex: number, selectedItem: string, selectedIndex: number) => {
        console.log(`Setting changed - Option ${optionIndex}: ${selectedItem} (index: ${selectedIndex})`);
    };

    // Handle device changes
    const handleDeviceChange = async (deviceId: string, kind: 'audioinput' | 'videoinput') => {
        try {
            await switchDevice(deviceId, kind);
            console.log(`Switched ${kind} to device:`, deviceId);
        } catch (error) {
            console.error('Failed to switch device:', error);
        }
    };

    // Handle mute toggle
    const handleToggleMute = (): boolean => {
        return toggleAudio();
    };

    // Handle video toggle
    const handleToggleVideo = (): boolean => {
        return toggleVideo();
    };


    // Handle call end
    const handleEndCall = () => {
        endCall();
        // La navigazione avverrà automaticamente tramite ProtectedRoutes
    };

    // Handle incoming call acceptance
    const handleAcceptIncomingCall = async () => {
        try {
            console.log('🔔 Call: Accepting call from', incomingCall?.from);
            await acceptCall();
            console.log('✅ Call: Call accepted');
        } catch (error) {
            console.error('Failed to accept call:', error);
        }
    };

    // Update page title
    useEffect(() => {
        document.title = isInCall ? `In chiamata con ${targetUser}` : 'Video Call';
        return () => {
            document.title = 'WebRTC Video Call';
        };
    }, [isInCall, targetUser]);

    // Debug: log state changes
    useEffect(() => {
        console.log('📊 Call page state:', {
            isInitialized,
            isConnected,
            currentCall: currentCall?.with,
            incomingCall: incomingCall?.from,
            hasLocalStream: !!localStream,
            hasRemoteStream: !!remoteStream,
            localStreamId: localStream?.id,
            remoteStreamId: remoteStream?.id
        });
    }, [isInitialized, isConnected, currentCall, incomingCall, localStream, remoteStream]);


    // Se non dovremmo essere qui, mostra placeholder (ma il redirect sarà gestito da ProtectedRoutes)
    if (!isInitialized || !isConnected || (!currentCall && !incomingCall)) {
        return (
            <div className="h-screen flex items-center justify-center bg-background">
                <div className="text-center">
                    <PhoneOff className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                    <h2 className="text-xl font-semibold mb-2">Nessuna chiamata attiva</h2>
                    <Button onClick={() => navigate('/setup')} className="gap-2">
                        <ArrowLeft className="h-4 w-4" />
                        Torna alla Dashboard
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <main className="h-screen flex flex-col bg-background relative">
            {/* Header with navigation and settings */}
            <div className="flex justify-between items-center p-4 flex-shrink-0 bg-background/95 backdrop-blur-sm border-b border-border/50 relative z-[60]">
                <div className="flex items-center gap-4">
                    <Button
                        onClick={() => navigate('/setup')}
                        variant="ghost"
                        size="sm"
                        className="gap-2"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Dashboard
                    </Button>

                    {isInCall && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                            <span>In chiamata con {targetUser}</span>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2 relative z-[70]">
                    <SettingsMenu
                        options={settingsOptions}
                        variant="modern"
                        onSelectionChange={handleSettingsChange}
                        onDeviceChange={handleDeviceChange}
                        getMediaDevices={getMediaDevices}
                        getCurrentDevices={getCurrentDevices}
                        className="relative z-[80]"
                    />
                </div>
            </div>

            {/* Video call area */}
            <div className="flex-1 min-h-0 relative z-10">
                <VideoCall
                    localStream={localStream || undefined}
                    remoteStream={remoteStream || undefined}
                    remoteName={targetUser}
                    onToggleMute={handleToggleMute}
                    onToggleVideo={handleToggleVideo}
                    onEndCall={handleEndCall}
                />

                {/* Enhanced Debug Info */}
                {process.env.NODE_ENV === 'development' && (
                    <div className="absolute top-4 left-4 bg-black/80 text-white p-2 rounded text-xs space-y-1">
                        <div>Local: {localStream ? 'OK' : 'NO'}</div>
                        <div>Remote: {remoteStream ? 'OK' : 'NO'}</div>
                        <div>Call: {currentCall ? `${currentCall.with} (${currentCall.isInitiator ? 'OUT' : 'IN'})` : 'NO'}</div>
                        <div>State: {connectionState || 'NO'}</div>
                        <div>User: {username}</div>
                        <div>Initialized: {isInitialized ? 'YES' : 'NO'}</div>
                        <div>Connected: {isConnected ? 'YES' : 'NO'}</div>
                    </div>
                )}
            </div>

            {/* Incoming call modal */}
            {incomingCall && (
                <div className="relative z-[100]">
                    <IncomingCallModal
                        callerName={incomingCall.from}
                        onAccept={handleAcceptIncomingCall}
                        onReject={rejectCall}
                    />
                </div>
            )}
        </main>
    );
};

export default Call;
