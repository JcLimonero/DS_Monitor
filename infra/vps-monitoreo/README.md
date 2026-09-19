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

Comprueba: `curl -u dsmonitor:TU_CONTRASEÑA http://localhost:9090/api/v1/targets`
debe listar `node` y `cadvisor` con `"health":"up"`.

Abre el puerto **9090** solo hacia afuera si Prometheus se va a consultar desde
Render (el puente de DS Monitor). Mejor todavía: ponlo detrás de tu proxy con
TLS (Caddy/Nginx) en `https://monitor.tudominio.com` y deja 9090 cerrado.

## 2. En cada VPS adicional (solo agentes)

```bash
mkdir -p /opt/monitoreo && cd /opt/monitoreo
# copia solo docker-compose.yml
docker compose --profile agente up -d
```

Abre **9100** y **8080** únicamente a la IP del VPS principal (ufw:
`ufw allow from IP_PRINCIPAL to any port 9100,8080 proto tcp`). Luego agrega
el VPS en `prometheus.yml` del principal, en los jobs `node` y `cadvisor`, con
su etiqueta `nombre`, y recarga: `docker compose --profile central restart prometheus`.

## 3. En DS Monitor

Integraciones → Servicios → **Servidores (Prometheus)**:

- URL: `https://monitor.tudominio.com` (o `http://IP:9090`), sin `/api`.
- Usuario `dsmonitor` y la contraseña que pusiste en `web.yml`.
- Etiqueta con el nombre: `nombre` (la de prometheus.yml).

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
