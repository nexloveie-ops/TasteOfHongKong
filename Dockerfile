# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install --ignore-scripts
COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend
FROM node:20-alpine AS backend-build
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install --ignore-scripts
COPY backend/ ./
RUN npm run build

# Stage 3: Production image
FROM node:20-alpine AS production
WORKDIR /app

# Copy backend build output and dependencies
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=backend-build /app/backend/package*.json ./
RUN npm install --omit=dev --ignore-scripts

# Copy frontend build output to public directory for express.static
COPY --from=frontend-build /app/frontend/dist ./public

EXPOSE 8080
ENV NODE_ENV=production
ENV PORT=8080

CMD ["node", "dist/server.js"]
