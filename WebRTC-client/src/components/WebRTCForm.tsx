import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Wifi, User } from 'lucide-react';

export interface WebRTCFormConfig {
    mode: 'two-phase' | 'single-phase';
    enableRooms?: boolean;
    title?: string;
    description?: string;
}

export interface WebRTCFormData {
    serverUrl: string;
    username: string;
    room?: string;
}

export interface WebRTCFormActions {
    onConnect?: (serverUrl: string) => Promise<void>;
    onRegister?: (data: WebRTCFormData) => Promise<void>;
    onSuccess?: (data: WebRTCFormData) => void;
}

interface WebRTCFormProps {
    config: WebRTCFormConfig;
    actions: WebRTCFormActions;
}

type FormPhase = 'connection' | 'registration';

export const WebRTCForm: React.FC<WebRTCFormProps> = ({ config, actions }) => {
    const [phase, setPhase] = useState<FormPhase>('connection');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [formData, setFormData] = useState<WebRTCFormData>({
        serverUrl: 'ws://localhost:8080',
        username: '',
        room: ''
    });

    const handleConnect = async () => {
        if (!formData.serverUrl.trim()) {
            setError('Inserisci l\'indirizzo del server');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            if (actions.onConnect) {
                await actions.onConnect(formData.serverUrl);
            }

            if (config.mode === 'two-phase') {
                setPhase('registration');
            } else {
                if (!formData.username.trim()) {
                    setError('Inserisci il nome utente');
                    return;
                }
                if (actions.onRegister) {
                    await actions.onRegister(formData);
                }
                actions.onSuccess?.(formData);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Errore di connessione');
        } finally {
            setLoading(false);
        }
    };

    const handleRegister = async () => {
        if (!formData.username.trim()) {
            setError('Inserisci il nome utente');
            return;
        }

        if (config.enableRooms && !formData.room?.trim()) {
            setError('Inserisci il nome della room');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            if (actions.onRegister) {
                await actions.onRegister(formData);
            }
            actions.onSuccess?.(formData);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Errore di registrazione');
        } finally {
            setLoading(false);
        }
    };

    const updateFormData = (field: keyof WebRTCFormData, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        if (error) setError(null);
    };

    const renderConnectionPhase = () => (
        <div className="space-y-6">
            <div className="space-y-2">
                <Label htmlFor="server">Indirizzo Server</Label>
                <Input
                    id="server"
                    type="url"
                    placeholder="ws://localhost:8080"
                    value={formData.serverUrl}
                    onChange={(e) => updateFormData('serverUrl', e.target.value)}
                    className="bg-input border-border"
                />
                <p className="text-xs text-muted-foreground">
                    Inserisci l'indirizzo del server di signaling WebRTC
                </p>
            </div>

            {config.mode === 'single-phase' && (
                <>
                    <div className="space-y-2">
                        <Label htmlFor="username">Nome Utente</Label>
                        <Input
                            id="username"
                            placeholder="Il tuo nome"
                            value={formData.username}
                            onChange={(e) => updateFormData('username', e.target.value)}
                            className="bg-input border-border"
                        />
                    </div>

                    {config.enableRooms && (
                        <div className="space-y-2">
                            <Label htmlFor="room">Room</Label>
                            <Input
                                id="room"
                                placeholder="Nome della room"
                                value={formData.room}
                                onChange={(e) => updateFormData('room', e.target.value)}
                                className="bg-input border-border"
                            />
                        </div>
                    )}
                </>
            )}

            <div className="space-y-2">
                <Button
                    onClick={handleConnect}
                    disabled={loading}
                    className="w-full bg-gradient-primary hover:bg-gradient-hover shadow-glow"
                >
                    {loading ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Connessione...
                        </>
                    ) : (
                        <>
                            <Wifi className="mr-2 h-4 w-4" />
                            Connetti al Server
                        </>
                    )}
                </Button>
            </div>
        </div>
    );

    const renderRegistrationPhase = () => (
        <div className="space-y-6">
            <div className="flex items-center gap-2 text-success">
                <Wifi className="h-4 w-4" />
                <span className="text-sm">Connesso al server</span>
            </div>

            <div className="space-y-2">
                <Label htmlFor="username-reg">Nome Utente</Label>
                <Input
                    id="username-reg"
                    placeholder="Il tuo nome"
                    value={formData.username}
                    onChange={(e) => updateFormData('username', e.target.value)}
                    className="bg-input border-border"
                />
            </div>

            {config.enableRooms && (
                <div className="space-y-2">
                    <Label htmlFor="room-reg">Room</Label>
                    <Input
                        id="room-reg"
                        placeholder="Nome della room"
                        value={formData.room}
                        onChange={(e) => updateFormData('room', e.target.value)}
                        className="bg-input border-border"
                    />
                </div>
            )}

            <Button
                onClick={handleRegister}
                disabled={loading}
                variant="default"
                className="w-full bg-gradient-primary hover:bg-gradient-hover"
            >
                {loading ? (
                    <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Registrazione...
                    </>
                ) : (
                    <>
                        <User className="mr-2 h-4 w-4" />
                        Registrati
                    </>
                )}
            </Button>
        </div>
    );

    return (
        <Card className="w-full max-w-md mx-auto bg-gradient-card border-border shadow-card">
            <CardHeader className="text-center">
                <CardTitle className="text-foreground">
                    {config.title || 'WebRTC Connection'}
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                    {config.description || 'Connettiti e inizia a comunicare'}
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

                {phase === 'connection' && renderConnectionPhase()}
                {phase === 'registration' && renderRegistrationPhase()}
            </CardContent>
        </Card>
    );
};
