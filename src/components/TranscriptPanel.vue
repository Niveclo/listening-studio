<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Check, ChevronDown, Crosshair, LoaderCircle, Play, Repeat1, Search, X } from '@lucide/vue';
import type { Cue, Locale, SubtitleMode } from '../types';
import { message, type MessageKey } from '../i18n';
import { formatTime } from '../lib/subtitles';
import { useWordSelection } from '../composables/useWordSelection';

const props = defineProps<{
  cues: Cue[];
  activeIndex: number;
  anchorIndex: number;
  loopId?: string;
  locale: Locale;
  loading: boolean;
  subtitlesFailed: boolean;
  processing: boolean;
  canImport: boolean;
  canPlay: boolean;
}>();
const emit = defineEmits<{
  jump: [cue: Cue];
  import: [];
  openVideo: [];
  refresh: [];
  lookup: [word: string];
}>();
const subtitleMode = defineModel<SubtitleMode>('subtitleMode', { required: true });
const transcript = ref<HTMLElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const searchButton = ref<HTMLButtonElement | null>(null);
const searchOpen = ref(false);
const query = ref('');
const searchTerm = computed(() => query.value.trim().toLocaleLowerCase());
const following = ref(true);
const browsing = ref(false);
const { selectedWord, selecting, lookupSelected, doubleClick, reset } = useWordSelection(
  transcript,
  (word) => emit('lookup', word),
);
const canFollow = computed(
  () => following.value && !browsing.value && !searchTerm.value && !selecting.value,
);
const showText = computed(() => !!props.cues.length && subtitleMode.value !== 'hidden');
const showReturn = computed(
  () => showText.value && (browsing.value || !following.value || !!searchTerm.value),
);
let resizeObserver: ResizeObserver | null = null;
let scrollbarPointer: number | null = null;
const t = (key: MessageKey) => message(props.locale, key);
const modes: { value: SubtitleMode; label: MessageKey }[] = [
  { value: 'bilingual', label: 'bilingual' },
  { value: 'en', label: 'english' },
  { value: 'zh', label: 'chinese' },
  { value: 'hidden', label: 'hidden' },
];
const modeLabel = computed(() => modes.find((mode) => mode.value === subtitleMode.value)!.label);
const cueRows = computed(() => props.cues.map((cue, index) => ({ cue, index })));
const filteredCues = computed(() =>
  searchTerm.value
    ? cueRows.value.filter(({ cue }) =>
        `${cue.en}\n${cue.zh}`.toLocaleLowerCase().includes(searchTerm.value),
      )
    : cueRows.value,
);

function scrollToCurrent(behavior: ScrollBehavior = 'smooth', center = false) {
  const container = transcript.value;
  if (!container || !showText.value) return;
  const index = props.activeIndex >= 0 ? props.activeIndex : Math.max(0, props.anchorIndex);
  const row = container.querySelector<HTMLElement>(`[data-cue-index="${index}"]`);
  if (!row) return;
  const rowRect = row.getBoundingClientRect();
  const viewport = container.clientHeight;
  const rowTop = rowRect.top - container.getBoundingClientRect().top;
  const margin = Math.min(48, viewport * 0.12, Math.max(0, (viewport - rowRect.height) / 2));
  if (!center && rowTop >= margin && rowTop + rowRect.height <= viewport - margin) return;
  const delta = rowRect.height >= viewport ? rowTop : rowTop + (rowRect.height - viewport) / 2;
  container.scrollTo({
    top: Math.max(0, container.scrollTop + delta),
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : behavior,
  });
}

function stopScrolling() {
  const container = transcript.value;
  container?.scrollTo({ top: container.scrollTop, behavior: 'instant' });
}

function pauseFollowing() {
  if (!following.value || browsing.value || !showText.value || searchTerm.value) return;
  browsing.value = true;
  stopScrolling();
}

function focusTranscript() {
  transcript.value?.focus({ preventScroll: true });
}

async function followCurrent() {
  const moveFocus = !!document.activeElement?.closest('.back-to-current');
  searchOpen.value = false;
  query.value = '';
  browsing.value = false;
  await nextTick();
  scrollToCurrent('smooth', true);
  if (moveFocus) focusTranscript();
}

async function toggleSearch() {
  searchOpen.value = !searchOpen.value;
  if (searchOpen.value) {
    await nextTick();
    searchInput.value?.focus();
  } else {
    query.value = '';
    searchButton.value?.focus();
  }
}

function onScrollbarPointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button === 0) scrollbarPointer = event.pointerId;
}

function onPointerEnd(event: PointerEvent) {
  if (event.pointerId === scrollbarPointer) scrollbarPointer = null;
}

function clearScrollbarPointer() {
  scrollbarPointer = null;
}

function onTranscriptKey(event: KeyboardEvent) {
  if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) {
    pauseFollowing();
  }
}

watch(following, async (enabled) => {
  if (!enabled) {
    stopScrolling();
    return;
  }
  browsing.value = false;
  await nextTick();
  if (canFollow.value) scrollToCurrent('smooth', true);
});
watch(selecting, (value) => {
  if (value) stopScrolling();
});
watch(
  () => props.activeIndex,
  () => {
    if (canFollow.value) scrollToCurrent();
  },
  { flush: 'post' },
);
watch(
  searchTerm,
  (value) => {
    if (value && transcript.value) transcript.value.scrollTop = 0;
    else if (canFollow.value) scrollToCurrent('instant');
  },
  { flush: 'post' },
);
watch(
  () => props.cues,
  async () => {
    reset();
    query.value = '';
    searchOpen.value = false;
    browsing.value = false;
    scrollbarPointer = null;
    await nextTick();
    if (transcript.value) transcript.value.scrollTop = 0;
    if (canFollow.value) scrollToCurrent('instant', true);
  },
);
watch(subtitleMode, async (mode) => {
  reset();
  if (mode === 'hidden') {
    query.value = '';
    searchOpen.value = false;
  }
  await nextTick();
  if (canFollow.value) scrollToCurrent('instant');
});
onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    if (canFollow.value) scrollToCurrent('instant');
  });
  if (transcript.value) resizeObserver.observe(transcript.value);
  window.addEventListener('pointerup', onPointerEnd);
  window.addEventListener('pointercancel', onPointerEnd);
  window.addEventListener('blur', clearScrollbarPointer);
});
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  window.removeEventListener('pointerup', onPointerEnd);
  window.removeEventListener('pointercancel', onPointerEnd);
  window.removeEventListener('blur', clearScrollbarPointer);
});
defineExpose({ focusTranscript });
</script>

<template>
  <section class="transcript-panel" :aria-label="t('transcript')">
    <div v-if="cues.length" class="transcript-tools">
      <button
        v-if="showText"
        ref="searchButton"
        type="button"
        class="search-button"
        :aria-label="t('search')"
        :title="t('search')"
        :aria-expanded="searchOpen"
        aria-controls="transcript-search"
        @click="toggleSearch"
      >
        <Search :size="18" aria-hidden="true" />
      </button>
      <v-menu>
        <template #activator="{ props: menuProps }">
          <v-btn v-bind="menuProps" variant="text" class="mode-button">
            {{ t(modeLabel) }}
            <ChevronDown :size="16" aria-hidden="true" />
          </v-btn>
        </template>
        <v-list density="compact" class="studio-menu">
          <v-list-item
            v-for="mode in modes"
            :key="mode.value"
            :active="subtitleMode === mode.value"
            @click="subtitleMode = mode.value"
          >
            <template #title>{{ t(mode.label) }}</template>
            <template v-if="subtitleMode === mode.value" #append>
              <Check :size="16" aria-hidden="true" />
            </template>
          </v-list-item>
        </v-list>
      </v-menu>
      <label v-if="showText" class="follow-toggle">
        <input v-model="following" type="checkbox" />
        {{ t('follow') }}
      </label>
    </div>
    <div v-show="searchOpen && showText" id="transcript-search" class="search-field">
      <input
        ref="searchInput"
        v-model="query"
        type="search"
        enterkeyhint="search"
        :aria-label="t('search')"
        :placeholder="t('search')"
        @keydown.esc.stop.prevent="toggleSearch"
      />
      <button
        type="button"
        :aria-label="t('closeSearch')"
        :title="t('closeSearch')"
        @click="toggleSearch"
      >
        <X :size="18" aria-hidden="true" />
      </button>
    </div>

    <div
      ref="transcript"
      class="transcript-scroll"
      tabindex="0"
      :aria-label="t('transcript')"
      @wheel.passive="pauseFollowing"
      @touchmove.passive="pauseFollowing"
      @pointerdown.self.passive="onScrollbarPointerDown"
      @scroll.passive="scrollbarPointer !== null && pauseFollowing()"
      @keydown="onTranscriptKey"
    >
      <div v-if="loading" class="empty-state" role="status">
        <LoaderCircle class="spin" :size="20" aria-hidden="true" />
        <p>{{ t('loading') }}</p>
      </div>
      <div v-else-if="subtitlesFailed" class="empty-state" role="alert">
        <p>{{ t('subtitleError') }}</p>
        <v-btn color="primary" @click="emit('import')">{{ t('importSubtitle') }}</v-btn>
      </div>
      <div v-else-if="!cues.length" class="empty-state">
        <template v-if="canImport">
          <h2>{{ t(processing ? 'processing' : 'subtitleMissing') }}</h2>
          <p>{{ t(processing ? 'processingBody' : 'emptyBody') }}</p>
          <v-btn color="primary" @click="processing ? emit('refresh') : emit('import')">
            {{ t(processing ? 'refresh' : 'importSubtitle') }}
          </v-btn>
        </template>
        <template v-else>
          <p>{{ t('firstVideo') }}</p>
          <v-btn color="primary" @click="emit('openVideo')">{{ t('importVideo') }}</v-btn>
        </template>
      </div>
      <div v-else-if="!showText" class="empty-state">
        <h2>{{ t('textHidden') }}</h2>
        <v-btn color="primary" @click="subtitleMode = 'bilingual'">{{ t('showText') }}</v-btn>
      </div>
      <div v-else-if="!filteredCues.length" class="empty-state" role="status">
        <p>{{ t('searchEmpty') }}</p>
      </div>
      <ol v-else class="cue-list">
        <li
          v-for="{ cue, index } in filteredCues"
          :key="cue.id"
          class="cue-row"
          :data-cue-index="index"
          :class="{ 'is-active': activeIndex === index, 'is-looped': loopId === cue.id }"
        >
          <button
            type="button"
            class="cue-time"
            :disabled="!canPlay"
            :aria-current="activeIndex === index ? 'true' : undefined"
            :aria-label="`${t('playLine')} ${formatTime(cue.start)}`"
            :title="t('playLine')"
            @click="emit('jump', cue)"
          >
            <Play :size="12" class="cue-play-icon" aria-hidden="true" />
            {{ formatTime(cue.start) }}
          </button>
          <div class="cue-text">
            <p
              v-if="cue.en && (subtitleMode !== 'zh' || !cue.zh)"
              class="cue-en"
              lang="en"
              @dblclick="doubleClick"
            >
              {{ cue.en }}
            </p>
            <p v-if="cue.zh && (subtitleMode !== 'en' || !cue.en)" class="cue-zh" lang="zh-CN">
              {{ cue.zh }}
            </p>
          </div>
          <span v-if="cue.needsReview || loopId === cue.id" class="cue-state">
            <span
              v-if="cue.needsReview"
              class="review-dot"
              role="img"
              :title="t('review')"
              :aria-label="t('review')"
            ></span>
            <Repeat1 v-if="loopId === cue.id" :size="16" role="img" :aria-label="t('looping')" />
          </span>
        </li>
      </ol>
    </div>

    <div v-if="showText && (searchTerm || showReturn || selectedWord)" class="transcript-status">
      <span v-if="searchTerm" role="status">{{ filteredCues.length }} {{ t('result') }}</span>
      <v-btn
        v-if="selectedWord"
        variant="tonal"
        color="primary"
        class="lookup-button"
        @pointerdown.prevent
        @click="lookupSelected"
      >
        {{ t('lookUp') }}
        <span lang="en">{{ selectedWord }}</span>
      </v-btn>
      <v-btn v-if="showReturn" variant="text" class="back-to-current" @click="followCurrent">
        <Crosshair :size="18" aria-hidden="true" />
        {{ t('backToCurrent') }}
      </v-btn>
    </div>
  </section>
</template>
