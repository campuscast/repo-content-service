FROM node:22-alpine AS builder
WORKDIR /workspace

COPY repo-shared-libs ./repo-shared-libs
RUN cd repo-shared-libs && npm ci && npm run build && SHARED_LIBS_TGZ="$(npm pack | tail -n 1)" && mv "$SHARED_LIBS_TGZ" /workspace/shared-libs.tgz

WORKDIR /workspace/repo-content-service
COPY repo-content-service/package*.json ./
RUN npm ci && npm install --no-save /workspace/shared-libs.tgz && test ! -L node_modules/@campuscast/shared-libs
COPY repo-content-service/. ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -s /bin/sh -D appuser
COPY --from=builder /workspace/repo-content-service/dist ./dist
COPY --from=builder /workspace/repo-content-service/node_modules ./node_modules
COPY --from=builder /workspace/repo-content-service/package.json ./
USER appuser
EXPOSE 3000
CMD ["node", "dist/main.js"]
