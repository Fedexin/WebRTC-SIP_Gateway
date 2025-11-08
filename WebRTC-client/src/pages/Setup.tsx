import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { WebRTCForm, type WebRTCFormConfig, type WebRTCFormActions, type WebRTCFormData } from '@/components/WebRTCForm';
import { WebRTCDashboard, type WebRTCDashboardActions } from '@/components/Dashboard';
import { IncomingCallModal } from '@/components/IncomingCallModal';
import { useWebRTCContext } from '@/App';

const Setup: React.FC = () => {
    const [isConnected, setIsConnected] = useState(false);
    const [userData, setUserData] = useState<WebRTCFormData | null>(null);
    const navigate = useNavigate();

    const {
        isInitialized,
        incomingCall,
        currentCall,
        connectionState,
        username,
        initialize,
        connect,
        startCall,
        acceptCall,
        rejectCall,
        disconnect
    } = useWebRTCContext();

    // Update local state when WebRTC state changes
    useEffect(() => {
        setIsConnected(isInitialized && !!username);
    }, [isInitialized, username]);

    // Configuration for WebRTC form
    const formConfig: WebRTCFormConfig = {
        mode: 'two-phase',
        enableRooms: false,
        title: 'Configurazione WebRTC',
        description: 'Connetti al server WebRTC'
    };

    // Handle connection to server
    const handleConnect = async (serverUrl: string): Promise<void> => {
        await connect(serverUrl);
    };

    // Handle user registration
    const handleRegister = async (data: WebRTCFormData): Promise<void> => {
        await initialize(data.username);
        setUserData(data);
    };

    // Handle successful setup completion
    const handleSuccess = (data: WebRTCFormData) => {
        setUserData(data);
        setIsConnected(true);
    };

    // Handle call initiation
    const handleCall = async (targetUser: string) => {
        try {
            console.log('📞 Setup: Initiating call to', targetUser);
            await startCall(targetUser);
            console.log('✅ Setup: Call initiated successfully, waiting for response...');
        } catch (error) {
            console.error('❌ Setup: Failed to start call:', error);
        }
    };

    // Handle disconnect
    const handleDisconnect = () => {
        disconnect();
        setIsConnected(false);
        setUserData(null);
    };

    // Handle incoming call acceptance
    const handleAcceptCall = async () => {
        try {
            console.log('🔔 Setup: Accepting call from', incomingCall?.from);
            await acceptCall();
            console.log('✅ Setup: Call accepted, should navigate to call page');
            // La navigazione avverrà automaticamente tramite ProtectedRoutes
        } catch (error) {
            console.error('Failed to accept call:', error);
        }
    };

    // Handle call response for the initiator
    useEffect(() => {
        // Solo l'iniziatore naviga quando la connessione è stabilita
        if (currentCall?.isInitiator && connectionState === 'connected') {
            console.log('✅ Setup: Call connected for initiator');
            // La navigazione avverrà automaticamente tramite ProtectedRoutes
        }
    }, [connectionState, currentCall]);

    // Actions for the form
    const formActions: WebRTCFormActions = {
        onConnect: handleConnect,
        onRegister: handleRegister,
        onSuccess: handleSuccess
    };

    // Actions for the dashboard
    const dashboardActions: WebRTCDashboardActions = {
        onCall: handleCall,
        onDisconnect: handleDisconnect
    };

    return (
        <div className="min-h-screen flex flex-col bg-background p-4">
            {/* Main content */}
            <div className="flex-1 flex justify-center items-center">
                <div className="w-full">
                    {!isConnected || !isInitialized ? (
                        <WebRTCForm
                            config={formConfig}
                            actions={formActions}
                        />
                    ) : (
                        <WebRTCDashboard
                            config={{ enableRooms: false }}
                            actions={dashboardActions}
                            userData={userData!}
                            username={username}
                        />
                    )}
                </div>
            </div>

            {/* Incoming call modal */}
            {incomingCall && (
                <IncomingCallModal
                    callerName={incomingCall.from}
                    onAccept={handleAcceptCall}
                    onReject={rejectCall}
                />
            )}
        </div>
    );
};

export default Setup;
