FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

EXPOSE ${PORT}

CMD ["node", "src/app.js"]
