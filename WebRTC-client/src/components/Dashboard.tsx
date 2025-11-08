import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { User, Phone, LogOut } from 'lucide-react';
import type {WebRTCFormData} from './WebRTCForm';

export interface WebRTCDashboardConfig {
    enableRooms?: boolean;
    title?: string;
    description?: string;
}

export interface WebRTCDashboardActions {
    onCall?: (targetUser: string) => void;
    onDisconnect?: () => void;
}

interface WebRTCDashboardProps {
    config: WebRTCDashboardConfig;
    actions: WebRTCDashboardActions;
    userData: WebRTCFormData;
    username: string;
}

export const WebRTCDashboard: React.FC<WebRTCDashboardProps> = ({
                                                                    config,
                                                                    actions,
                                                                    userData,
                                                                    username
                                                                }) => {
    const [targetUser, setTargetUser] = useState('');
    const [error, setError] = useState<string | null>(null);

    const handleCall = () => {
        if (!targetUser.trim()) {
            setError('Inserisci il nome utente da chiamare');
            return;
        }
        if (targetUser.trim() === username) {
            setError('Non puoi chiamare te stesso');
            return;
        }
        setError(null);
        console.log('🎯 Dashboard: Starting call to', targetUser);
        actions.onCall?.(targetUser);
    };

    return (
        <Card className="w-full max-w-md mx-auto bg-gradient-card border-border shadow-card">
            <CardHeader className="text-center">
                <CardTitle className="text-foreground">
                    {config.title || 'WebRTC Dashboard'}
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                    {config.description || 'Gestisci le tue comunicazioni'}
                </CardDescription>
            </CardHeader>

            <CardContent>
                {error && (
                    <Alert className="mb-4 border-destructive bg-destructive/10">
                        <AlertDescription className="text-destructive">
                            {error}
                        </AlertDescription>
                    </Alert>
                )}

                <div className="space-y-6">
                    <div className="flex items-center gap-2 text-success">
                        <User className="h-4 w-4" />
                        <span className="text-sm">Connesso come {username}</span>
                        {config.enableRooms && userData.room && (
                            <span className="text-sm text-muted-foreground">in {userData.room}</span>
                        )}
                    </div>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="target-user">Chiama Utente</Label>
                            <div className="flex gap-2">
                                <Input
                                    id="target-user"
                                    placeholder="Nome utente da chiamare"
                                    value={targetUser}
                                    onChange={(e) => setTargetUser(e.target.value)}
                                    className="bg-input border-border"
                                />
                                <Button onClick={handleCall} variant="outline">
                                    <Phone className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>

                        <div className="grid gap-2">
                            <Button
                                onClick={actions.onDisconnect}
                                variant="destructive"
                                className="justify-start"
                            >
                                <LogOut className="mr-2 h-4 w-4" />
                                Disconnetti
                            </Button>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};
