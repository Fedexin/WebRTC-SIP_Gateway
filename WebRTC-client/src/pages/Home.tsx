import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Video, Phone } from 'lucide-react';

const Home = () => {
    const navigate = useNavigate();

    return (
        <main className="min-h-screen flex items-center justify-center bg-background p-4">
            <Card className="w-full max-w-md mx-auto bg-gradient-card border-border shadow-card">
                <CardHeader className="text-center">
                    <div className="w-16 h-16 rounded-full bg-gradient-primary mx-auto mb-4 flex items-center justify-center">
                        <Video className="w-8 h-8 text-primary-foreground" />
                    </div>
                    <CardTitle className="text-2xl text-foreground">
                        WebRTC Video Call
                    </CardTitle>
                    <CardDescription className="text-muted-foreground">
                        Inizia una videochiamata sicura e di alta qualità
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                    <Button
                        onClick={() => navigate('/setup')}
                        className="w-full bg-gradient-primary hover:bg-gradient-hover shadow-glow"
                        size="lg"
                    >
                        <Phone className="mr-2 h-5 w-5" />
                        Inizia Chiamata
                    </Button>

                    <Button
                        onClick={() => navigate('/call')}
                        variant="outline"
                        className="w-full"
                        size="lg"
                    >
                        <Video className="mr-2 h-5 w-5" />
                        Modalità Demo
                    </Button>

                    <div className="text-center text-sm text-muted-foreground">
                        Versione 1.0.0 - Sviluppato con WebRTC
                    </div>
                </CardContent>
            </Card>
        </main>
    );
};

export default Home;