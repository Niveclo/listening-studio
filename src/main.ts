import { createApp } from 'vue';
import { createVuetify } from 'vuetify';
import { md3 } from 'vuetify/blueprints';
import { VApp, VBtn, VDialog, VMenu, VList, VListItem, VSnackbar } from 'vuetify/components';
import { Ripple } from 'vuetify/directives';
import 'vuetify/styles';
import './style.css';
import App from './App.vue';

const vuetify = createVuetify({
  blueprint: md3,
  components: { VApp, VBtn, VDialog, VMenu, VList, VListItem, VSnackbar },
  directives: { Ripple },
  defaults: {
    VBtn: { rounded: 'pill', elevation: 0, style: 'text-transform: none; letter-spacing: 0' },
  },
  theme: {
    defaultTheme: 'light',
    themes: {
      light: {
        dark: false,
        colors: {
          primary: '#197c78',
          secondary: '#82651e',
          surface: '#fdf6e3',
          background: '#f5eedb',
          'surface-variant': '#eee8d5',
          'on-surface': '#344f57',
          'on-background': '#344f57',
          'on-primary': '#fdf6e3',
          'on-secondary': '#fdf6e3',
          error: '#b64c35',
          'on-error': '#fdf6e3',
        },
      },
      dark: {
        dark: true,
        colors: {
          primary: '#64beb0',
          secondary: '#d4b66a',
          surface: '#073642',
          background: '#002b36',
          'surface-variant': '#103e48',
          'on-surface': '#d4ddd1',
          'on-background': '#d4ddd1',
          'on-primary': '#002b36',
          'on-secondary': '#002b36',
          error: '#ec9985',
          'on-error': '#402620',
        },
      },
    },
  },
});

createApp(App).use(vuetify).mount('#app');
