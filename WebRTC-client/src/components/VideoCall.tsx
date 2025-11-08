import { useState, useEffect } from "react";
import { VideoStream } from "./VideoStream";
import { ControlPanel } from "./ControlPanel";

interface VideoCallProps {
    remoteStream?: MediaStream;
    localStream?: MediaStream;
    remoteName?: string;
    className?: string;
    onToggleMute?: () => boolean; // Cambiato: ritorna lo stato attuale
    onToggleVideo?: () => boolean; // Cambiato: ritorna lo stato attuale
    onEndCall?: () => void;
}

export const VideoCall = ({
                              remoteStream,
                              localStream,
                              remoteName = "Marco Rossi",
                              className,
                              onToggleMute,
                              onToggleVideo,
                              onEndCall
                          }: VideoCallProps) => {
    const [isMuted, setIsMuted] = useState(false);
    const [isVideoOff, setIsVideoOff] = useState(false);
    const [isLocalPinned, setIsLocalPinned] = useState(false);

    // Debug per vedere se gli stream cambiano
    useEffect(() => {
        console.log('📺 VideoCall streams updated:', {
            hasLocal: !!localStream,
            hasRemote: !!remoteStream,
            localTracks: localStream?.getTracks().length || 0,
            remoteTracks: remoteStream?.getTracks().length || 0,
            isMuted,
            isVideoOff
        });
    }, [localStream, remoteStream, isMuted, isVideoOff]);

    // Sincronizza lo stato con le tracce effettive del local stream
    useEffect(() => {
        if (localStream) {
            const audioTrack = localStream.getAudioTracks()[0];
            const videoTrack = localStream.getVideoTracks()[0];

            console.log('📺 VideoCall sync effect:', {
                hasAudioTrack: !!audioTrack,
                hasVideoTrack: !!videoTrack,
                audioEnabled: audioTrack?.enabled,
                videoEnabled: videoTrack?.enabled,
                audioReadyState: audioTrack?.readyState,
                videoReadyState: videoTrack?.readyState
            });

            if (audioTrack) {
                const newMutedState = !audioTrack.enabled;
                if (newMutedState !== isMuted) {
                    console.log('📺 Updating muted state:', newMutedState);
                    setIsMuted(newMutedState);
                }
            }

            // Per il video, considera sia enabled che readyState
            if (videoTrack) {
                const newVideoOffState = !videoTrack.enabled || videoTrack.readyState === 'ended';
                if (newVideoOffState !== isVideoOff) {
                    console.log('📺 Updating video off state:', newVideoOffState);
                    setIsVideoOff(newVideoOffState);
                }
            } else {
                // Se non c'è track video, il video è off
                if (!isVideoOff) {
                    console.log('📺 No video track - setting video off');
                    setIsVideoOff(true);
                }
            }
        }
    }, [localStream, isMuted, isVideoOff]);

    const handleToggleMute = () => {
        if (onToggleMute) {
            const newMutedState = onToggleMute();
            console.log('📺 Toggle mute result:', newMutedState);
            setIsMuted(newMutedState);
        }
    };

    const handleToggleVideo = () => {
        if (onToggleVideo) {
            const newVideoOffState = onToggleVideo();
            console.log('📺 Toggle video result:', newVideoOffState);
            setIsVideoOff(newVideoOffState);

            // Forza un aggiornamento dopo un breve delay per assicurarsi che lo state sia sincronizzato
            setTimeout(() => {
                if (localStream) {
                    const videoTrack = localStream.getVideoTracks()[0];
                    const actualVideoOff = !videoTrack || !videoTrack.enabled || videoTrack.readyState === 'ended';
                    if (actualVideoOff !== newVideoOffState) {
                        console.log('📺 Force updating video state after toggle:', actualVideoOff);
                        setIsVideoOff(actualVideoOff);
                    }
                }
            }, 100);
        }
    };


    const handleEndCall = () => {
        onEndCall?.();
    };

    const handlePinToggle = () => {
        setIsLocalPinned(!isLocalPinned);
    };

    // Determina quale stream mostrare - LOGICA SEMPLIFICATA
    // Lasciamo che VideoStream gestisca autonomamente lo stato del remote video
    const mainStream = isLocalPinned ? localStream : remoteStream;
    const mainVideoOff = isLocalPinned ? isVideoOff : false; // Solo per local, remote gestito da VideoStream
    const mainName = isLocalPinned ? "Tu" : remoteName;

    const pipStream = isLocalPinned ? remoteStream : localStream;
    const pipVideoOff = isLocalPinned ? false : isVideoOff; // Solo per local, remote gestito da VideoStream
    const pipName = isLocalPinned ? remoteName : "Tu";

    return (
        <div className={`w-full h-full flex flex-col ${className}`}>
            <div className="flex-1 min-h-0 flex items-center justify-center">
                <div className="w-full max-w-[1280px] max-h-full aspect-video flex flex-col">
                    {/* Main video area */}
                    <div className="flex-1 min-h-0 p-4 relative">
                        {/* Main video */}
                        <VideoStream
                            stream={mainStream}
                            isVideoOff={mainVideoOff}
                            isMuted={isLocalPinned ? isMuted : false}
                            participantName={mainName}
                            isLocal={isLocalPinned}
                            className="w-full h-full"
                        />

                        {/* Overlay video (picture-in-picture) */}
                        <div className="absolute top-6 right-6 w-64 h-36 z-10">
                            <VideoStream
                                stream={pipStream}
                                isLocal={!isLocalPinned}
                                isVideoOff={pipVideoOff}
                                isMuted={isLocalPinned ? false : isMuted}
                                participantName={pipName}
                                showPinButton={true}
                                onPinToggle={handlePinToggle}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Control panel */}
            <div className="flex justify-center pb-4">
                <ControlPanel
                    isMuted={isMuted}
                    isVideoOff={isVideoOff}
                    onToggleMute={handleToggleMute}
                    onToggleVideo={handleToggleVideo}
                    onEndCall={handleEndCall}
                />
            </div>
        </div>
    );
};
