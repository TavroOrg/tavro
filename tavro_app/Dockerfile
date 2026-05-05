# ── tavro_app/Dockerfile ─────────────────────────────────────────────────────
# Stage 1: Build the React app
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Empty string = use relative paths, nginx proxies /api/ to tavro-api
ARG VITE_TWIN_API_URL=""
ENV VITE_TWIN_API_URL=$VITE_TWIN_API_URL

RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
