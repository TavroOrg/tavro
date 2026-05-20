FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN apt-get update && apt-get install -y wget && rm -rf /var/lib/apt/lists/*
RUN npm ci --production
COPY . .
EXPOSE 4000
CMD ["node", "server.js"]
