import { Mic, MicOff, Video, VideoOff, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ControlPanelProps {
    isMuted: boolean;
    isVideoOff: boolean;
    onToggleMute: () => void;
    onToggleVideo: () => void;
    onEndCall: () => void;
    className?: string;
}

export const ControlPanel = ({
                                 isMuted,
                                 isVideoOff,
                                 onToggleMute,
                                 onToggleVideo,
                                 onEndCall,
                                 className,
                             }: ControlPanelProps) => {
    return (
        <div
            className={cn(
                "flex items-center justify-center space-x-6 p-6 bg-black/20 backdrop-blur-md rounded-2xl shadow-control animate-control-slide-up",
                className
            )}
        >
            {/* Mute/Unmute Button */}
            <Button
                variant="secondary"
                size="icon"
                onClick={onToggleMute}
                className={cn(
                    "w-14 h-14 rounded-full transition-all duration-300",
                    isMuted
                        ? "bg-destructive hover:bg-destructive/90 shadow-glow-destructive"
                        : "bg-secondary hover:bg-secondary/80 shadow-glow-primary"
                )}
            >
                {isMuted ? (
                    <MicOff className="w-6 h-6" />
                ) : (
                    <Mic className="w-6 h-6" />
                )}
            </Button>

            {/* End Call Button */}
            <Button
                variant="destructive"
                size="icon"
                onClick={onEndCall}
                className="w-16 h-16 rounded-full bg-destructive hover:bg-destructive/90 shadow-glow-destructive transition-all duration-300 hover:scale-110"
            >
                <Phone className="w-7 h-7 rotate-[135deg]" />
            </Button>

            {/* Video On/Off Button */}
            <Button
                variant="secondary"
                size="icon"
                onClick={onToggleVideo}
                className={cn(
                    "w-14 h-14 rounded-full transition-all duration-300",
                    isVideoOff
                        ? "bg-destructive hover:bg-destructive/90 shadow-glow-destructive"
                        : "bg-secondary hover:bg-secondary/80 shadow-glow-primary"
                )}
            >
                {isVideoOff ? (
                    <VideoOff className="w-6 h-6" />
                ) : (
                    <Video className="w-6 h-6" />
                )}
            </Button>
        </div>
    );
};