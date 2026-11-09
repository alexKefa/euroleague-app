# Monorepo build: Angular frontend (static) + Express backend (API), served
# as one Railway service from one origin — see the static-file block in
# backend/src/index.ts for why (avoids CORS / refresh-cookie SameSite
# issues a two-service split would introduce).

FROM node:22 AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Clutch Court's shared physics/rules (imported by relative path as ../shared).
COPY shared/ ../shared/
RUN npm run build

FROM node:22 AS backend-build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
# The backend compiles ../shared (Clutch Court physics/rules) into dist/shared.
COPY shared/ ../shared/
RUN npm run build

FROM node:22
WORKDIR /app/backend
ENV NODE_ENV=production
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=backend-build /app/backend/dist ./dist
# Fonts + logo for the server-rendered game story cards (services/gameStory).
COPY backend/assets ./assets
COPY --from=frontend-build /app/frontend/dist/euroleague-app-frontend/browser ./public

EXPOSE 4000
CMD ["node", "dist/backend/src/index.js"]
