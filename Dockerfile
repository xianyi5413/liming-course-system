FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5177
ENV DATA_DIR=/app/data

COPY package.json ./
RUN npm install --omit=dev --ignore-scripts

COPY public ./public
COPY src ./src
COPY scripts ./scripts

RUN mkdir -p /app/data

EXPOSE 5177

CMD ["node", "src/server.js"]
