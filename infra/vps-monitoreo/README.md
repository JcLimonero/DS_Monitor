# Monitoreo de VPS para DS Monitor

Solo Prometheus. Cada VPS corre **node_exporter** (CPU, memoria, disco, red,
tiempo arriba) y **cAdvisor** (contenedores); un Prometheus central los
recolecta y DS Monitor le pregunta por HTTP. Grafana no hace falta: el portal
grafica (Servidores, carrusel, Hoy) y avisa por Telegram cuando un servidor
se pasa de umbral (disco ≥ 85 %, memoria ≥ 90 %, CPU ≥ 85 %, disco ≥ 95 % es
crítico) o deja de reportar.

## 1. En el VPS principal (el que tendrá Prometheus)

```bash
mkdir -p /opt/monitoreo && cd /opt/monitoreo
# copia aquí docker-compose.yml, prometheus.yml y web.yml.example
cp web.yml.example web.yml
# genera el hash de la contraseña y pégalo en web.yml
sudo apt-get install -y apache2-utils && htpasswd -nBC 12 "" | tr -d ':\n'
docker compose --profile central up -d
```

Si el VPS tiene `ufw`, deja que la red de Docker llegue a node_exporter (corre
en la red del host) y que el puente lea Prometheus:

```bash
sudo ufw allow from 10.0.0.0/8 to any port 9100 proto tcp
sudo ufw allow from 172.16.0.0/12 to any port 9100 proto tcp
sudo ufw allow 9090/tcp
```

Comprueba: `curl -u dsmonitor:TU_CONTRASEÑA http://localhost:9090/api/v1/targets`
debe listar `node` y `cadvisor` con `"health":"up"`. (node_exporter corre en la
red del host; Prometheus lo alcanza como `host.docker.internal:9100`.)

Si `node` sale `down` con "context deadline exceeded", es el firewall: mira con
qué red creó Compose (`docker network inspect monitoreo_default`) y permite esa
red al 9100. Si `host.docker.internal` no resuelve, en `prometheus.yml` pon la
IP del gateway de esa red en lugar de `host.docker.internal`.

El 9090 va con contraseña pero en HTTP plano. Mejor: ponlo detrás de tu proxy
con TLS (Caddy/Nginx) en `https://monitor.tudominio.com` y deja 9090 cerrado.

## 2. En cada VPS adicional (solo agentes)

```bash
mkdir -p /opt/monitoreo && cd /opt/monitoreo
# copia solo docker-compose.yml
docker compose --profile agente up -d
```

(En el agente cAdvisor sí publica el 8080; en el central no hace falta, Prometheus
le habla por la red interna.) Abre **9100** y **8080** únicamente a la IP del VPS principal (ufw:
`ufw allow from IP_PRINCIPAL to any port 9100,8080 proto tcp`). Luego agrega
el VPS en `prometheus.yml` del principal, en los jobs `node` y `cadvisor`, con
su etiqueta `nombre`, y recarga: `docker compose --profile central restart prometheus`.

## Variante: un Prometheus en cada VPS

Si prefieres no abrir 9100/8080 entre servidores, corre el perfil `central`
en **cada** VPS (Prometheus + exporters, misma contraseña en todos) y en DS
Monitor pones una línea por servidor. Es lo más simple cuando son pocos.

## 3. En DS Monitor

Integraciones → Servicios → **Servidores (Prometheus)**:

- Servidores, uno por línea, como `etiqueta|url`; la etiqueta es como se ve
  en el portal, el carrusel y Telegram:
  ```
  Nexus 1|http://74.208.151.19:9090
  OperativAI|https://monitor.operativai.com.mx
  ```
- Usuario `dsmonitor` y la contraseña de `web.yml` (la misma en todos).
- "Etiqueta con el nombre del servidor": vacío.

"Probar" debe decir cuántos servidores reportan. A partir de ahí:
**Servidores** en el menú, la diapositiva del carrusel, el aviso en Hoy y los
mensajes de Telegram.

## Qué se lee

| Dato | Métrica |
| --- | --- |
| CPU % | `rate(node_cpu_seconds_total{mode="idle"}[5m])` |
| Memoria % | `node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes` |
| Disco % | `node_filesystem_avail_bytes{mountpoint="/"}` / size |
| Red | `rate(node_network_receive/transmit_bytes_total[5m])` sin interfaces virtuales |
| Tiempo arriba | `node_boot_time_seconds` |
| Contenedores | `container_last_seen`, `container_cpu_usage_seconds_total`, `container_memory_working_set_bytes` |
| Curvas de 6 h | `query_range` de CPU y memoria cada 5 min |
