# repo-content-service

Content Service — upload, hash, sign, manage media assets

## Local

- Install:       npm ci
- Build:       npm run build
- Test:       npm test -- --passWithNoTests

## Runtime

- Health:         GET /health
- Metrics:         GET /metrics
- Audit sink: set `AUDIT_SERVICE_URL` (for Docker: `http://audit-service:3009`).
- Audit events on complete upload: `content.uploaded`, `content.ready`.
