/**
 * Gestisce la logica base WebRTC per eventuali estensioni future
 */
export class WebRTCService {
    constructor() {
        this.clients = new Map();
    }

    registerClient(username, ws) {
        this.clients.set(username, ws);
    }

    removeClient(username) {
        this.clients.delete(username);
    }

    getClient(username) {
        return this.clients.get(username);
    }
}
