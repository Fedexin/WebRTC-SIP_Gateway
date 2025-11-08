const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

// Funzione per generare certificati self-signed
function generateCertificate() {
    const certDir = path.join(__dirname, '..', 'certs');
    const keyPath = path.join(certDir, 'key.pem');
    const certPath = path.join(certDir, 'cert.pem');

    // Crea la directory se non esiste
    if (!fs.existsSync(certDir)) {
        fs.mkdirSync(certDir);
    }

    // Genera il certificato se non esiste
    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
        console.log('🔐 Generazione certificati SSL self-signed...');

        // Comando per generare certificati
        const openssl = spawn('openssl', [
            'req', '-x509', '-newkey', 'rsa:2048', '-keyout', keyPath,
            '-out', certPath, '-days', '365', '-nodes', '-subj',
            '/C=IT/ST=Test/L=Test/O=Test/CN=localhost'
        ], { stdio: 'inherit' });

        openssl.on('close', (code) => {
            if (code === 0) {
                console.log('✅ Certificati generati con successo!');
                console.log(`📁 Percorso: ${certDir}`);
            } else {
                console.error('❌ Errore nella generazione dei certificati');
                console.log('Installa OpenSSL o usa i flag di Chrome per il testing');
            }
        });

        openssl.on('error', (err) => {
            console.error('❌ OpenSSL non trovato:', err.message);
            console.log('💡 Alternative:');
            console.log('1. Installa OpenSSL');
            console.log('2. Usa i flag di Chrome per il testing');
            console.log('3. Usa ngrok per tunnel HTTPS');
        });
    } else {
        console.log('✅ Certificati SSL già presenti');
    }

    return { keyPath, certPath };
}

// Funzione per ottenere l'IP locale
function getLocalIP() {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

console.log('🚀 Avvio dev server HTTPS...');
const { keyPath, certPath } = generateCertificate();
const localIP = getLocalIP();

console.log('\n📋 Indirizzi disponibili:');
console.log(`   Locale:        https://localhost:5173`);
console.log(`   Rete locale:   https://${localIP}:5173`);
console.log('\n⚠️  Se vedi errori di certificato, clicca "Avanzate" → "Procedi"');
