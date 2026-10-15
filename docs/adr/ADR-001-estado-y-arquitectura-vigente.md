# ADR-001 — Estado y arquitectura vigente de DS Monitor

- **Fecha:** 2026-10-14
- **Estado:** Aceptado como foto del estado. Se revisa cuando cambie la arquitectura.
- **Repo:** `JcLimonero/DS_Monitor` · rama `main` en `47c8f95`
- **Fuentes:** `CLAUDE.md`, `portal/README.md`, `puente/README.md`, `puente/INGESTA.md` e historial de git.

## Contexto

Tablero para **una sola persona** (el director) y la gente de su equipo. Junta pendientes, juntas,
correo, servidores, despliegues, licencias, dominios y CRM de varias empresas. Se usa en tres
lugares: el **portal** en la computadora, el **carrusel** (`/carrusel`) y una página sin sesión para
el equipo (`/mio/:token`).

## Decisiones vigentes

- **Dos paquetes independientes**, cada uno con su `package.json`, `node_modules` y job en
  `.github/workflows/ci.yml`:
  - `portal/` — Angular 20 **sin zone.js** (signals), Tailwind 3. Estático.
  - `puente/` — backend en Node 22 + TypeScript (ESM). Guarda credenciales, consulta o recibe datos
    y los traduce al modelo del portal. **Única dependencia de ejecución: `pg`**; el router y el
    servidor HTTP son propios, sin framework.
- **`puente/INGESTA.md` es el contrato**: documenta el cuerpo exacto de cada envío a `/ingesta/*`.
- **Las pruebas del puente corren sobre `dist/`**: hay que compilar antes.
- **Los ajustes compartidos viven en el puente**, no en el navegador: apagar fuentes, modo y buzones
  del portal se guardan allá y se comparten entre dispositivos.
- **Una aplicación de Entra ID propia por buzón de Microsoft** (decisión del 2026-10-09), en vez de
  una app compartida.
- El dispositivo principal del carrusel es un iPad: las tarjetas son compactas y de escala fluida.

## Estado al 14 de octubre de 2026

- **Correo (Microsoft/Entra ID):** app propia por buzón (#58); el regreso de Microsoft conserva el
  resultado y la pestaña de Correo (#59, #60). Es el hilo que se acaba de cerrar.
- **Cotizaciones:** seguimiento de estatus, etapa movible desde el tablero y pendiente por falta de
  movimiento (#57).
- **Dominios:** se leen de Cloudflare y se ven sus subdominios (#54); mensaje claro cuando el ID de
  cuenta de Cloudflare no es válido (#56).
- **Licencias:** confirmar renovación y agregar licencias, guardadas en el puente y desde el
  carrusel (#52).
- **Carrusel:** tarjetas compactas y escala fluida para iPad (#53), scroll y texto dentro de las
  tarjetas (#49, #50).
- **PR abierto:** #69 — `fix(pendientes): no mostrar ni crear copias del mismo asunto`.

### Pruebas y CI

Hay CI en `.github/workflows/ci.yml` con un job por paquete. **No se corrió en esta sesión.**

## Pendientes y huecos conocidos

1. **Cerrar el PR #69** (copias del mismo asunto en pendientes).
2. **`.claude/worktrees/` aparece sin seguir por git** y hay dos ramas `worktree-agent-*` vivas
   (2026-10-02 y 2026-10-09): limpiar.
3. Ramas sin mezclar de octubre: `feat/correo-app-por-buzon`, `fix/aviso-conexion-microsoft`,
   `fix/cloudflare-id-cuenta`, `fix/retorno-oauth-microsoft`. *Confirmar si ya entraron por PR y
   borrarlas.*
4. Existe un directorio `tmp/` en la raíz del repo: revisar si debe estar.

## Riesgos y deuda

- **La sección «Estado» del `README.md` raíz está desactualizada:** dice que todo corre en
  demostración, cuando hoy hay datos reales. Quien lo lea primero se lleva una idea equivocada.
- El puente guarda credenciales de terceros (Microsoft, Cloudflare, CRM): es el componente de mayor
  riesgo del repo y no tiene un documento de amenazas propio.
- Es un tablero para una sola persona, con una página **sin sesión** (`/mio/:token`): la seguridad
  depende enteramente de que el token no se filtre.

## Lo que sigue

1. Mezclar el PR #69.
2. Corregir la sección «Estado» del `README.md`.
3. Limpiar worktrees y ramas ya mezcladas.
