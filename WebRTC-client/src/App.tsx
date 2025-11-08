import { createContext, useContext } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { useWebRTC, type UseWebRTCReturn } from "@/hooks/useWebRTC";
import { useEffect } from "react";
import NotFound from "./pages/NotFound";
import Home from "./pages/Home";
import Setup from "./pages/Setup";
import Call from "./pages/Call";

const queryClient = new QueryClient();

// Crea il context per WebRTC
const WebRTCContext = createContext<UseWebRTCReturn | null>(null);

// Hook per usare il context
export const useWebRTCContext = () => {
    const context = useContext(WebRTCContext);
    if (!context) {
        throw new Error('useWebRTCContext must be used within WebRTCProvider');
    }
    return context;
};

// Provider component
const WebRTCProvider = ({ children }: { children: React.ReactNode }) => {
    const webrtc = useWebRTC();
    return (
        <WebRTCContext.Provider value={webrtc}>
            {children}
        </WebRTCContext.Provider>
    );
};

// Component wrapper per gestire i redirect
const ProtectedRoutes = () => {
    const { isInitialized, isConnected, currentCall, incomingCall } = useWebRTCContext();
    const location = useLocation();
    const navigate = useNavigate();

    useEffect(() => {
        const currentPath = location.pathname;

        console.log('🔄 Route check:', {
            currentPath,
            isInitialized,
            isConnected,
            hasCall: !!currentCall,
            hasIncoming: !!incomingCall
        });

        // Se non sei connesso e non sei in /setup o /, vai al setup
        if (!isInitialized || !isConnected) {
            if (currentPath !== '/setup' && currentPath !== '/') {
                console.log('➡️ Redirecting to setup (not connected)');
                navigate('/setup', { replace: true });
            }
            return;
        }

        // Se sei connesso e hai una chiamata attiva o in arrivo, vai alla call
        if ((currentCall || incomingCall) && currentPath !== '/call') {
            console.log('➡️ Redirecting to call (has active call)');
            navigate('/call', { replace: true });
            return;
        }

        // Se sei connesso ma non hai chiamate e non sei nella dashboard, vai alla dashboard
        if (isConnected && !currentCall && !incomingCall && currentPath !== '/setup' && currentPath !== '/') {
            console.log('➡️ Redirecting to dashboard (connected, no calls)');
            navigate('/setup', { replace: true });
        }
    }, [isInitialized, isConnected, currentCall, incomingCall, location.pathname, navigate]);

    return (
        <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="/call" element={<Call />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
};

const App = () => (
    <QueryClientProvider client={queryClient}>
        <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
                <WebRTCProvider>
                    <ProtectedRoutes />
                </WebRTCProvider>
            </BrowserRouter>
        </TooltipProvider>
    </QueryClientProvider>
);

export default App;
