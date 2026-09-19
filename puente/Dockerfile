# El puente de DS Monitor: Node 22, sin dependencias de sistema.
FROM node:22-alpine AS construccion
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY tsconfig.json tsconfig.contrato.json ./
COPY src ./src
COPY contrato ./contrato
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=construccion /app/node_modules ./node_modules
COPY --from=construccion /app/dist ./dist
COPY package.json ./
# Los archivos (respaldo legible y modo sin base) van en un volumen.
RUN mkdir -p /var/data && chown node:node /var/data
USER node
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:${PUENTE_PUERTO:-10000}/salud >/dev/null || exit 1
CMD ["node", "dist/index.js"]
