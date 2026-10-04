FROM node:24-alpine
WORKDIR /app
COPY server.mjs .
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production DATA_DIR=/data PORT=8787 NODE_NO_WARNINGS=1
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/health || exit 1
CMD ["node", "server.mjs"]
