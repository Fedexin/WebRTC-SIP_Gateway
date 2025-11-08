FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 8080
EXPOSE 5060/udp

CMD ["node", "signaling-server.js"]