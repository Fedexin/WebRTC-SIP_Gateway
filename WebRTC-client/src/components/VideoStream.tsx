import { User, UserX, Pin, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

interface VideoStreamProps {
    stream?: MediaStream;
    isLocal?: boolean;
    isMuted?: boolean;
    isVideoOff?: boolean;
    participantName?: string;
    className?: string;
    showPinButton?: boolean;
    onPinToggle?: () => void;
}

export const VideoStream = ({
                                stream,
                                isLocal = false,
                                isMuted = false,
                                isVideoOff = false,
                                participantName = "Partecipante",
                                className,
                                showPinButton = false,
                                onPinToggle,
                            }: VideoStreamProps) => {
    const [isHovered, setIsHovered] = useState(false);
    const [showPlaceholderOverlay, setShowPlaceholderOverlay] = useState(!isLocal && !stream);

    const videoRef = useRef<HTMLVideoElement | null>(null);

// Sostituisci la logica nel useEffect per remote stream
    useEffect(() => {
        console.log('🎥 VideoStream effect:', {
            hasStream: !!stream,
            isVideoOff,
            isLocal,
            participantName,
            streamId: stream?.id,
            tracks: stream?.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled, state: t.readyState }))
        });

        if (isLocal) {
            console.log('🎥 Local stream - isVideoOff:', isVideoOff);
            setShowPlaceholderOverlay(isVideoOff);
        } else {
            // Per remote stream - DETECTION MIGLIORATA
            if (!stream) {
                setShowPlaceholderOverlay(true);
                return;
            }

            const videoTrack = stream.getVideoTracks()[0];
            if (!videoTrack) {
                setShowPlaceholderOverlay(true);
                return;
            }

            // Stato iniziale
            setShowPlaceholderOverlay(false);

            let consecutiveBlackFrames = 0;
            let lastValidFrame = false;

            const checkVideoFrames = () => {
                const video = videoRef.current;
                if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
                    // Nessun video - mostra subito placeholder
                    console.log('🎥 No video dimensions, showing placeholder for:', participantName);
                    setShowPlaceholderOverlay(true);
                    return;
                }

                // Campiona più punti per rilevare frame neri
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = 10;
                    canvas.height = 10;
                    const ctx = canvas.getContext('2d');

                    if (ctx) {
                        // Prendi una piccola sezione dal centro
                        ctx.drawImage(video, video.videoWidth/3, video.videoHeight/3,
                            video.videoWidth/3, video.videoHeight/3, 0, 0, 10, 10);

                        const imageData = ctx.getImageData(0, 0, 10, 10);
                        let totalBrightness = 0;

                        // Calcola la luminosità media
                        for (let i = 0; i < imageData.data.length; i += 4) {
                            const r = imageData.data[i];
                            const g = imageData.data[i + 1];
                            const b = imageData.data[i + 2];
                            totalBrightness += (r + g + b) / 3;
                        }

                        const avgBrightness = totalBrightness / (imageData.data.length / 4);
                        const isBlackFrame = avgBrightness < 5; // Soglia molto bassa per frame neri

                        if (isBlackFrame) {
                            consecutiveBlackFrames++;
                            if (consecutiveBlackFrames >= 3) { // Solo 1.5 secondi invece di 3+
                                console.log('🎥 Detected black frames, showing placeholder for:', participantName);
                                setShowPlaceholderOverlay(true);
                            }
                        } else {
                            consecutiveBlackFrames = 0;
                            lastValidFrame = true;
                            setShowPlaceholderOverlay(false);
                        }
                    }
                } catch (error) {
                    consecutiveBlackFrames++;
                    if (consecutiveBlackFrames >= 3) {
                        console.log('🎥 Cannot read video frame, showing placeholder for:', participantName);
                        setShowPlaceholderOverlay(true);
                    }
                }
            };

            // Controlla più frequentemente
            const frameCheckInterval = setInterval(checkVideoFrames, 250); // 250ms invece di 500ms

            return () => {
                clearInterval(frameCheckInterval);
            };
        }
    }, [stream, isLocal, isVideoOff, participantName]);



    // Video element - sempre visibile, non lo nascondiamo mai
    useEffect(() => {
        const el = videoRef.current;
        if (!el || !stream) return;

        console.log('🎥 Setting video srcObject for:', participantName);
        (el as any).srcObject = stream;

        try {
            const p = el.play();
            if (p && typeof (p as Promise<void>).catch === 'function') {
                (p as Promise<void>).catch((error) => {
                    console.error('Video play failed:', error);
                });
            }
        } catch (error) {
            console.error('Video play error:', error);
        }

        return () => {
            console.log('🎥 Cleaning up video for:', participantName);
        };
    }, [stream, participantName]);

    console.log('🎥 Rendering VideoStream:', {
        participantName,
        hasStream: !!stream,
        showPlaceholderOverlay,
        isLocal
    });

    return (
        <div
            className={cn(
                "relative rounded-xl overflow-hidden border border-video-border bg-video-overlay shadow-video animate-video-fade-in",
                isLocal ? "aspect-video" : "w-full h-full",
                className
            )}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Video element - SEMPRE presente se c'è uno stream */}
            {stream && (
                <video
                    className={cn(
                        "w-full h-full object-cover",
                        isLocal && "scale-x-[-1]" // ✅ Mirror del video locale
                    )}
                    autoPlay
                    playsInline
                    muted={isLocal}
                    ref={videoRef}
                />
            )}

            {/* Placeholder OVERLAY - si sovrappone al video quando necessario */}
            {(!stream || showPlaceholderOverlay) && (
                <div className="absolute inset-0 w-full h-full flex items-center justify-center bg-gradient-to-br from-video-overlay to-video-bg z-10">
                    <div className="flex flex-col items-center space-y-4">
                        <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center">
                            <UserX className="w-8 h-8 text-muted-foreground" />
                        </div>
                        <div className="text-center">
                            <p className="text-sm font-medium text-foreground">{participantName}</p>
                            <p className="text-xs text-muted-foreground mt-1">Camera disattivata</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Name badge with mute indicator */}
            <div className="absolute top-3 left-3 px-2 py-1 bg-black/50 backdrop-blur-sm rounded-md flex items-center gap-2 z-20">
                <p className="text-xs font-medium text-white">{participantName}</p>
                {isMuted && (
                    <div className="w-4 h-4 bg-destructive/90 rounded-full flex items-center justify-center">
                        <MicOff className="w-3 h-3 text-white" />
                    </div>
                )}
            </div>

            {/* Pin button */}
            {showPinButton && onPinToggle && (
                <button
                    onClick={onPinToggle}
                    className={cn(
                        "absolute top-3 right-3 w-8 h-8 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center transition-all duration-200 z-20",
                        isHovered ? "opacity-100 scale-100" : "opacity-0 scale-95",
                        "hover:bg-black/70"
                    )}
                >
                    <Pin className="w-4 h-4 text-white" />
                </button>
            )}
        </div>
    );
};
