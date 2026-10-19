<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  ArrowDownToLine,
  AudioLines,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleHelp,
  FileText,
  Headphones,
  LoaderCircle,
  Play,
  Repeat1,
  Search,
  X,
} from '@lucide/vue';
import type { Cue, Locale, SubtitleMode } from '../types';
import { message, type MessageKey } from '../i18n';
import { formatTime } from '../lib/subtitles';
import { useWordSelection } from '../composables/useWordSelection';

const props = defineProps<{
  cues: Cue[];
  activeIndex: number;
  anchorIndex: number;
  loopId?: string;
  paused: boolean;
  locale: Locale;
  loading: boolean;
  subtitlesFailed: boolean;
  processing: boolean;
  canImport: boolean;
}>();
const emit = defineEmits<{ jump: [cue: Cue]; import: []; refresh: []; lookup: [word: string] }>();
const subtitleMode = defineModel<SubtitleMode>('subtitleMode', { required: true });
const query = ref('');
const following = ref(true);
const transcript = ref<HTMLElement | null>(null);
const wordSelection = useWordSelection(transcript, (word) => emit('lookup', word), pauseFollowing);
let resizeObserver: ResizeObserver | null = null;
const t = (key: MessageKey) => message(props.locale, key);
const modes: { value: SubtitleMode; label: MessageKey }[] = [
  { value: 'bilingual', label: 'bilingual' },
  { value: 'en', label: 'english' },
  { value: 'zh', label: 'chinese' },
  { value: 'hidden', label: 'hidden' },
];
const modeLabel = computed(() => modes.find((mode) => mode.value === subtitleMode.value)!.label);
const filteredCues = computed(() => {
  const search = query.value.trim().toLocaleLowerCase();
  return props.cues
    .map((cue, index) => ({ cue, index }))
    .filter(({ cue }) => !search || `${cue.en}\n${cue.zh}`.toLocaleLowerCase().includes(search));
});

function scrollToCurrent(behavior: ScrollBehavior = 'smooth') {
  const container = transcript.value;
  if (!container || !props.cues.length) return;
  const index = props.activeIndex >= 0 ? props.activeIndex : Math.max(0, props.anchorIndex);
  const row = container.querySelector<HTMLElement>(`[data-cue-index="${index}"]`);
  if (!row) return;
  const target = Math.max(
    0,
    container.scrollTop +
      row.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      container.clientHeight / 2 +
      row.clientHeight / 2,
  );
  container.scrollTo({
    top: target,
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : behavior,
  });
}

async function followCurrent() {
  query.value = '';
  following.value = true;
  await nextTick();
  scrollToCurrent();
}

function pauseFollowing() {
  if (props.cues.length) following.value = false;
}
function onTranscriptKey(event: KeyboardEvent) {
  if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key))
    pauseFollowing();
}
watch(
  () => props.activeIndex,
  async () => {
    if (following.value && !query.value) {
      await nextTick();
      scrollToCurrent();
    }
  },
);
watch(
  () => props.cues,
  async () => {
    wordSelection.reset();
    query.value = '';
    following.value = true;
    await nextTick();
    if (transcript.value) transcript.value.scrollTop = 0;
    scrollToCurrent('instant');
  },
);
watch(subtitleMode, async () => {
  wordSelection.reset();
  await nextTick();
  if (following.value) scrollToCurrent('instant');
});
onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    if (following.value && !query.value) scrollToCurrent('instant');
  });
  if (transcript.value) resizeObserver.observe(transcript.value);
});
onBeforeUnmount(() => resizeObserver?.disconnect());
defineExpose({ followCurrent });
</script>

<template>
  <section class="transcript-card" :aria-label="t('transcript')">
    <div class="transcript-top">
      <div class="transcript-title">
        <span class="transcript-icon"><FileText :size="19" /></span>
        <h2>{{ t('transcript') }}</h2>
        <span class="cue-count">{{ cues.length }} {{ t('lines') }}</span>
      </div>
      <div class="transcript-actions">
        <v-btn
          variant="text"
          class="import-button"
          :disabled="!canImport"
          :aria-label="t('importSubtitle')"
          :title="t('importSubtitle')"
          @click="emit('import')"
        >
          <ArrowDownToLine :size="16" />
          <span>{{ t('importSubtitle') }}</span>
        </v-btn>
        <v-menu>
          <template #activator="{ props: menuProps }">
            <v-btn v-bind="menuProps" variant="tonal" class="mode-button">
              <span>{{ t(modeLabel) }}</span>
              <ChevronDown :size="14" />
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
              <template v-if="subtitleMode === mode.value" #append><Check :size="16" /></template>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>
    </div>
    <div v-if="cues.length && subtitleMode !== 'hidden'" class="transcript-tools">
      <label class="search-field">
        <Search :size="17" />
        <input v-model="query" :aria-label="t('search')" :placeholder="t('search')" type="search" />
        <button v-if="query" :aria-label="t('clearSearch')" @click="query = ''">
          <X :size="15" />
        </button>
      </label>
      <button
        class="follow-toggle"
        :class="{ enabled: following }"
        :aria-pressed="following"
        @click="following ? (following = false) : followCurrent()"
      >
        <span class="toggle-track"><span></span></span>
        <span>{{ t(following ? 'follow' : 'followOff') }}</span>
      </button>
    </div>
    <div
      ref="transcript"
      class="transcript-scroll"
      :class="{ 'empty-scroll': !cues.length || subtitleMode === 'hidden' }"
      tabindex="0"
      :aria-label="t('transcript')"
      @wheel.passive="pauseFollowing"
      @touchstart.passive="pauseFollowing"
      @pointerdown.self="pauseFollowing"
      @keydown="onTranscriptKey"
    >
      <div v-if="loading" class="empty-state" role="status">
        <LoaderCircle class="spin" :size="30" />
        <p>{{ t('loading') }}</p>
      </div>
      <div v-else-if="subtitlesFailed" class="empty-state" role="alert">
        <CircleHelp :size="32" />
        <h3>{{ t('subtitleError') }}</h3>
        <v-btn color="primary" variant="tonal" @click="emit('import')">
          {{ t('importSubtitle') }}
        </v-btn>
      </div>
      <div v-else-if="!cues.length" class="empty-state">
        <span class="empty-illustration"><AudioLines :size="36" :stroke-width="1.2" /></span>
        <h3>{{ t('emptyTitle') }}</h3>
        <p>{{ t(processing ? 'processingBody' : 'emptyBody') }}</p>
        <v-btn
          color="primary"
          variant="tonal"
          :disabled="!canImport"
          @click="processing ? emit('refresh') : emit('import')"
        >
          {{ t(processing ? 'refresh' : 'importSubtitle') }}
        </v-btn>
      </div>
      <div v-else-if="subtitleMode === 'hidden'" class="empty-state">
        <Headphones :size="35" :stroke-width="1.3" />
        <h3>{{ t('textHidden') }}</h3>
        <p>{{ t('textHiddenBody') }}</p>
        <v-btn color="primary" variant="tonal" @click="subtitleMode = 'bilingual'">
          {{ t('showText') }}
        </v-btn>
      </div>
      <div v-else-if="!filteredCues.length" class="empty-state">
        <Search :size="30" />
        <h3>{{ t('searchEmpty') }}</h3>
      </div>
      <ol v-else class="cue-list">
        <li
          v-for="{ cue, index } in filteredCues"
          :key="cue.id"
          :data-cue-index="index"
          :class="{ 'is-active': activeIndex === index, 'is-looped': loopId === cue.id }"
        >
          <div
            class="cue-button"
            role="button"
            tabindex="0"
            :aria-current="activeIndex === index ? 'true' : undefined"
            :aria-label="`${formatTime(cue.start)} ${cue.en || cue.zh}`"
            @pointerdown="wordSelection.startSelection"
            @click="wordSelection.clickCue($event, () => emit('jump', cue))"
            @dblclick="wordSelection.doubleClick"
            @contextmenu="wordSelection.contextMenu"
            @keydown.enter.self.prevent="emit('jump', cue)"
            @keydown.space.self.prevent="emit('jump', cue)"
          >
            <span class="cue-time">
              <AudioLines v-if="activeIndex === index && !paused" :size="16" />
              <span v-else>{{ formatTime(cue.start) }}</span>
            </span>
            <span class="cue-text">
              <span v-if="cue.en && subtitleMode !== 'zh'" class="cue-en" lang="en">
                {{ cue.en }}
              </span>
              <span v-if="cue.zh && subtitleMode !== 'en'" class="cue-zh" lang="zh-CN">
                {{ cue.zh }}
              </span>
              <span v-if="subtitleMode === 'en' && !cue.en" class="cue-zh" lang="zh-CN">
                {{ cue.zh }}
              </span>
              <span v-if="subtitleMode === 'zh' && !cue.zh" class="cue-en" lang="en">
                {{ cue.en }}
              </span>
            </span>
            <span class="cue-end">
              <span
                v-if="cue.needsReview"
                class="review-dot"
                :title="t('review')"
                :aria-label="t('review')"
              ></span>
              <Repeat1 v-if="loopId === cue.id" :size="16" />
              <Play v-else :size="15" />
            </span>
          </div>
        </li>
      </ol>
    </div>
    <div class="transcript-footer">
      <span>
        <span class="footer-dot"></span>
        <span :title="t('dictionaryHint')">
          {{ query ? `${filteredCues.length} ${t('result')}` : t('dictionaryHint') }}
        </span>
      </span>
      <button v-if="cues.length && !following" class="back-to-current" @click="followCurrent">
        <ChevronLeft :size="13" />
        {{ t('backToCurrent') }}
      </button>
      <span v-else class="keyboard-hint">
        <kbd>SPACE</kbd>
        {{ t('space') }}
      </span>
    </div>
  </section>
</template>
