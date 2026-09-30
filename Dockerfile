FROM node:20-alpine
RUN apk add --no-cache openssl ffmpeg

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production
ENV FFMPEG_PATH=/usr/bin/ffmpeg

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN npm run build

# exec direto no react-router-serve (em vez de npm run docker-start) pra o
# node virar o PID 1 e receber o SIGTERM do redeploy — npm e sh no meio do
# caminho não repassam o sinal com confiança, e sem ele o agendador não
# consegue esperar a publicação em andamento terminar (ver
# scheduler.server.ts).
CMD ["sh", "-c", "npm run setup && exec ./node_modules/.bin/react-router-serve ./build/server/index.js"]
