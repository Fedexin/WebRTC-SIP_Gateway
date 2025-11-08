import React from 'react';
import { Phone, PhoneOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface IncomingCallModalProps {
    callerName: string;
    onAccept: () => void;
    onReject: () => void;
}

export const IncomingCallModal: React.FC<IncomingCallModalProps> = ({
                                                                        callerName,
                                                                        onAccept,
                                                                        onReject
                                                                    }) => {
    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[200]">
            <Card className="w-full max-w-md mx-4 bg-card border-border shadow-xl animate-pulse-slow">
                <CardHeader className="text-center pb-4">
                    <div className="w-20 h-20 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 mx-auto mb-4 flex items-center justify-center animate-pulse">
                        <Phone className="w-10 h-10 text-white" />
                    </div>
                    <CardTitle className="text-xl text-foreground">
                        Chiamata in arrivo
                    </CardTitle>
                    <CardDescription className="text-lg text-muted-foreground">
                        <strong className="text-foreground">{callerName}</strong> ti sta chiamando
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-6">
                    <div className="flex gap-6 justify-center">
                        <Button
                            onClick={onReject}
                            variant="destructive"
                            size="lg"
                            className="w-16 h-16 rounded-full p-0 hover:scale-110 transition-transform"
                        >
                            <PhoneOff className="w-6 h-6" />
                        </Button>

                        <Button
                            onClick={onAccept}
                            size="lg"
                            className="w-16 h-16 rounded-full p-0 bg-green-600 hover:bg-green-700 hover:scale-110 transition-transform"
                        >
                            <Phone className="w-6 h-6" />
                        </Button>
                    </div>

                    <div className="text-center text-sm text-muted-foreground">
                        Tocca per rispondere o rifiutare la chiamata
                    </div>

                    <div className="flex items-center justify-center space-x-2">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-ping" />
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-ping delay-75" />
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-ping delay-150" />
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};