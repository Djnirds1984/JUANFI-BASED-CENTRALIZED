const AdminThemes = {
  STORAGE_KEY: 'juanfi.adminTheme',

  themes: {
    midnight: {
      id: 'midnight',
      name: 'Midnight',
      description: 'Deep slate default with vivid blue accents.',
      mode: 'dark',
      banner: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #2563eb 100%)',
      swatches: ['#1e293b', '#2563eb', '#60a5fa', '#0f172a'],
      vars: {
        '--primary': '#2563eb',
        '--primary-dark': '#1d4ed8',
        '--primary-light': 'rgba(37, 99, 235, 0.16)',
        '--success': '#16a34a',
        '--danger': '#dc2626',
        '--warning': '#d97706',
        '--bg': '#0f172a',
        '--bg-card': '#1e293b',
        '--text': '#e2e8f0',
        '--text-muted': '#94a3b8',
        '--border': '#334155',
        '--sidebar-bg': '#111827',
        '--sidebar-text': '#cbd5e1',
        '--sidebar-active': '#2563eb',
        '--radius': '8px',
        '--shadow': '0 1px 3px rgba(0,0,0,0.4)',
        '--shadow-lg': '0 8px 24px rgba(0,0,0,0.5)',
      },
    },

    ocean: {
      id: 'ocean',
      name: 'Ocean Breeze',
      description: 'Calming teal and cyan tones for a clean dashboard.',
      mode: 'dark',
      banner: 'linear-gradient(135deg, #083344 0%, #0e7490 55%, #22d3ee 100%)',
      swatches: ['#0e7490', '#06b6d4', '#67e8f9', '#083344'],
      vars: {
        '--primary': '#06b6d4',
        '--primary-dark': '#0e7490',
        '--primary-light': 'rgba(6, 182, 212, 0.16)',
        '--success': '#10b981',
        '--danger': '#f43f5e',
        '--warning': '#f59e0b',
        '--bg': '#082f49',
        '--bg-card': '#0c4a6e',
        '--text': '#e0f2fe',
        '--text-muted': '#7dd3fc',
        '--border': '#0369a1',
        '--sidebar-bg': '#052e4a',
        '--sidebar-text': '#bae6fd',
        '--sidebar-active': '#06b6d4',
        '--radius': '8px',
        '--shadow': '0 1px 3px rgba(0,0,0,0.4)',
        '--shadow-lg': '0 8px 24px rgba(2, 44, 63, 0.6)',
      },
    },

    emerald: {
      id: 'emerald',
      name: 'Emerald Forest',
      description: 'Rich greens with a fresh, natural feel.',
      mode: 'dark',
      banner: 'linear-gradient(135deg, #052e16 0%, #15803d 55%, #4ade80 100%)',
      swatches: ['#15803d', '#22c55e', '#86efac', '#052e16'],
      vars: {
        '--primary': '#22c55e',
        '--primary-dark': '#15803d',
        '--primary-light': 'rgba(34, 197, 94, 0.16)',
        '--success': '#16a34a',
        '--danger': '#ef4444',
        '--warning': '#eab308',
        '--bg': '#0b2818',
        '--bg-card': '#14361f',
        '--text': '#dcfce7',
        '--text-muted': '#86efac',
        '--border': '#1f5133',
        '--sidebar-bg': '#082013',
        '--sidebar-text': '#bbf7d0',
        '--sidebar-active': '#22c55e',
        '--radius': '8px',
        '--shadow': '0 1px 3px rgba(0,0,0,0.4)',
        '--shadow-lg': '0 8px 24px rgba(0,0,0,0.55)',
      },
    },

    sunset: {
      id: 'sunset',
      name: 'Sunset Glow',
      description: 'Warm ambers and coral for a vibrant workspace.',
      mode: 'dark',
      banner: 'linear-gradient(135deg, #431407 0%, #ea580c 55%, #fbbf24 100%)',
      swatches: ['#ea580c', '#f97316', '#fbbf24', '#431407'],
      vars: {
        '--primary': '#f97316',
        '--primary-dark': '#ea580c',
        '--primary-light': 'rgba(249, 115, 22, 0.16)',
        '--success': '#84cc16',
        '--danger': '#ef4444',
        '--warning': '#f59e0b',
        '--bg': '#271205',
        '--bg-card': '#3a1c0a',
        '--text': '#ffedd5',
        '--text-muted': '#fdba74',
        '--border': '#5a2c10',
        '--sidebar-bg': '#1f0e04',
        '--sidebar-text': '#fed7aa',
        '--sidebar-active': '#f97316',
        '--radius': '8px',
        '--shadow': '0 1px 3px rgba(0,0,0,0.4)',
        '--shadow-lg': '0 8px 24px rgba(67, 20, 7, 0.6)',
      },
    },

    violet: {
      id: 'violet',
      name: 'Violet Royal',
      description: 'Elegant purple gradients with a premium look.',
      mode: 'dark',
      banner: 'linear-gradient(135deg, #2e1065 0%, #7c3aed 55%, #c084fc 100%)',
      swatches: ['#7c3aed', '#a855f7', '#d8b4fe', '#2e1065'],
      vars: {
        '--primary': '#a855f7',
        '--primary-dark': '#7c3aed',
        '--primary-light': 'rgba(168, 85, 247, 0.16)',
        '--success': '#10b981',
        '--danger': '#f43f5e',
        '--warning': '#f59e0b',
        '--bg': '#1e1035',
        '--bg-card': '#2b1a4d',
        '--text': '#f3e8ff',
        '--text-muted': '#c4b5fd',
        '--border': '#422b6b',
        '--sidebar-bg': '#170b2a',
        '--sidebar-text': '#ddd6fe',
        '--sidebar-active': '#a855f7',
        '--radius': '8px',
        '--shadow': '0 1px 3px rgba(0,0,0,0.4)',
        '--shadow-lg': '0 8px 24px rgba(46, 16, 101, 0.6)',
      },
    },

    sakura: {
      id: 'sakura',
      name: 'Sakura Light',
      description: 'Soft light theme with rose-pink accents.',
      mode: 'light',
      banner: 'linear-gradient(135deg, #fdf2f8 0%, #fbcfe8 55%, #f472b6 100%)',
      swatches: ['#ec4899', '#f472b6', '#fbcfe8', '#fff1f2'],
      vars: {
        '--primary': '#ec4899',
        '--primary-dark': '#db2777',
        '--primary-light': 'rgba(236, 72, 153, 0.14)',
        '--success': '#16a34a',
        '--danger': '#e11d48',
        '--warning': '#d97706',
        '--bg': '#fff1f2',
        '--bg-card': '#ffffff',
        '--text': '#3f1d2b',
        '--text-muted': '#9d174d',
        '--border': '#fbcfe8',
        '--sidebar-bg': '#3f1d2b',
        '--sidebar-text': '#fce7f3',
        '--sidebar-active': '#ec4899',
        '--radius': '10px',
        '--shadow': '0 1px 3px rgba(190, 24, 93, 0.12)',
        '--shadow-lg': '0 8px 24px rgba(190, 24, 93, 0.18)',
      },
    },
  },

  getThemeList() {
    return Object.values(this.themes);
  },

  getTheme(id) {
    return this.themes[id] || this.themes.midnight;
  },

  getStoredId() {
    try {
      const id = localStorage.getItem(this.STORAGE_KEY);
      return this.themes[id] ? id : 'midnight';
    } catch (e) {
      return 'midnight';
    }
  },

  store(id) {
    try {
      localStorage.setItem(this.STORAGE_KEY, id);
    } catch (e) {
      /* storage may be unavailable */
    }
  },

  apply(id) {
    const theme = this.getTheme(id);
    const root = document.documentElement;
    Object.entries(theme.vars).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
    document.body.setAttribute('data-admin-theme', theme.id);
    document.body.setAttribute('data-admin-mode', theme.mode);
    this.store(theme.id);
    return theme;
  },

  applyStored() {
    return this.apply(this.getStoredId());
  },
};

if (typeof window !== 'undefined') {
  window.AdminThemes = AdminThemes;
}
