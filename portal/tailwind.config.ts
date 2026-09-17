import type { Config } from 'tailwindcss';

/**
 * Los colores salen de variables CSS (ver src/styles.scss) en lugar de estar
 * escritos aqui. Asi el tema claro y el oscuro se definen una sola vez y las
 * plantillas usan nombres semanticos (`bg-surface`, `text-ink-muted`) en vez de
 * repetir `dark:` en cada clase.
 */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        app: token('app'),
        surface: token('surface'),
        'surface-muted': token('surface-muted'),
        line: token('line'),
        ink: token('ink'),
        'ink-muted': token('ink-muted'),
        'ink-subtle': token('ink-subtle'),
        brand: token('brand'),
        'brand-soft': token('brand-soft'),
        accent: token('accent'),
        'accent-soft': token('accent-soft'),
        ok: token('ok'),
        warn: token('warn'),
        danger: token('danger'),
        info: token('info')
      },
      fontFamily: {
        // Las de dealersolutions.com.mx: IBM Plex Sans para el texto, Archivo
        // para los titulos y IBM Plex Mono para lo tecnico.
        sans: ['IBM Plex Sans', 'Arial', 'Helvetica Neue', 'sans-serif'],
        display: ['Archivo', 'IBM Plex Sans', 'Arial', 'sans-serif'],
        mono: ['IBM Plex Mono', 'SFMono-Regular', 'Consolas', 'monospace']
      },
      boxShadow: {
        card: '0 1px 2px rgb(10 37 64 / 0.05), 0 8px 24px -12px rgb(10 37 64 / 0.20)'
      },
      // El sitio de la marca usa esquinas casi rectas (2 px); aqui apenas un
      // poco mas, para que las tarjetas no se vean cortantes en pantalla.
      borderRadius: {
        DEFAULT: '0.125rem',
        md: '0.125rem',
        lg: '0.25rem',
        xl: '0.375rem',
        '2xl': '0.5rem'
      }
    }
  },
  plugins: []
} satisfies Config;
