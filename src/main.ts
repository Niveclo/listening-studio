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
    VBtn: { rounded: 'md', elevation: 0, style: 'text-transform: none; letter-spacing: 0' },
  },
  theme: {
    defaultTheme: 'light',
    themes: {
      light: {
        dark: false,
        colors: {
          primary: '#2f627d',
          surface: '#ffffff',
          background: '#f7f8fa',
          'surface-variant': '#eef1f4',
          'on-surface': '#202832',
          'on-background': '#202832',
          'on-primary': '#ffffff',
          error: '#913e36',
          'on-error': '#ffffff',
        },
      },
      dark: {
        dark: true,
        colors: {
          primary: '#8ab5cd',
          surface: '#22272e',
          background: '#181c21',
          'surface-variant': '#20252b',
          'on-surface': '#e8edf2',
          'on-background': '#e8edf2',
          'on-primary': '#181c21',
          error: '#f4b3aa',
          'on-error': '#432d30',
        },
      },
    },
  },
});

createApp(App).use(vuetify).mount('#app');
