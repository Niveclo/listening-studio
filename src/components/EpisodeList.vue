<script setup lang="ts">
import { message, type MessageKey } from '../i18n';
import type { Episode, Locale } from '../types';

defineProps<{
  items: { episode: Episode; status: MessageKey }[];
  activeId: string;
  locale: Locale;
}>();

const emit = defineEmits<{ select: [episode: Episode] }>();
</script>

<template>
  <nav class="episode-list" :aria-label="message(locale, 'chooseEpisode')">
    <ol>
      <li v-for="({ episode, status }, index) in items" :key="episode.id">
        <button
          type="button"
          class="episode-button"
          :aria-current="episode.id === activeId ? 'true' : undefined"
          @click="emit('select', episode)"
        >
          <span class="episode-number">{{ String(index + 1).padStart(2, '0') }}</span>
          <span class="episode-info">
            <strong>{{ episode.title[locale] }}</strong>
            <small v-if="status !== 'subtitleReady'">{{ message(locale, status) }}</small>
          </span>
        </button>
      </li>
    </ol>
  </nav>
</template>
