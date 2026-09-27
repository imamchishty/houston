FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm i -g tsx
COPY src ./src
ENV PORT=4000 HOUSTON_DATA_DIR=/data
VOLUME /data
EXPOSE 4000
CMD ["tsx", "src/index.ts"]
