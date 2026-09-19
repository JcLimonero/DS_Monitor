# El portal de DS Monitor: se construye con Angular y se sirve con nginx, que
# ademas reenvia /api/portal/* al puente (mismo origen, sin CORS).
FROM node:22-alpine AS construccion
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=construccion /app/dist/portal/browser /usr/share/nginx/html
EXPOSE 80
