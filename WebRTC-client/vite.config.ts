import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from "path"
import fs from "fs"

// HTTPS=true npm run dev      # HTTPS su https://localhost:5173
// npm run dev                 # HTTP su http://localhost:5173
const useHttps = process.env.HTTPS === "true";

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: useHttps
        ? {
            https: {
                key: fs.readFileSync(path.resolve(__dirname, "certs/key.pem")),
                cert: fs.readFileSync(path.resolve(__dirname, "certs/cert.pem")),
            }
        }
        : {}
})