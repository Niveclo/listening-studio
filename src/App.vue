<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useTheme } from 'vuetify';
import {
  AudioLines,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Headphones,
  Languages,
  Leaf,
  ListVideo,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  RefreshCw,
  Repeat1,
  Settings2,
  SkipBack,
  SkipForward,
  Sun,
  Video,
  VideoOff,
  Volume2,
  Wifi,
  X,
} from '@lucide/vue';
import type { Cue, Episode, Locale, SubtitleMode, ThemeMode } from './types';
import { message, type MessageKey } from './i18n';
import { parseSubtitles, formatTime } from './lib/subtitles';
import { readStored, writeStored } from './lib/storage';
import { usePlayer } from './composables/usePlayer';
import { useSidebars } from './composables/useSidebars';
import TranscriptPanel from './components/TranscriptPanel.vue';
import DictionaryDialog from './components/DictionaryDialog.vue';

const storedLocale = readStored<string>('locale', 'zh');
const locale = ref<Locale>(storedLocale === 'en' ? 'en' : 'zh');
const storedTheme = readStored(
  'theme',
  matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
);
const themeMode = ref<ThemeMode>(storedTheme === 'dark' ? 'dark' : 'light');
const storedMode = readStored('subtitleMode', 'bilingual');
const subtitleMode = ref<SubtitleMode>(
  ['bilingual', 'en', 'zh', 'hidden'].includes(storedMode)
    ? (storedMode as SubtitleMode)
    : 'bilingual',
);
const theme = useTheme();
const t = (key: MessageKey) => message(locale.value, key);
const episodes = ref<Episode[]>([]);
const activeId = ref('');
const active = computed(() => episodes.value.find((episode) => episode.id === activeId.value));
const activeOrder = computed(
  () => episodes.value.findIndex((episode) => episode.id === activeId.value) + 1,
);
const cues = ref<Cue[]>([]);
const loading = ref(false);
const libraryLoading = ref(false);
const libraryFailed = ref(false);
const subtitlesFailed = ref(false);
const videoFailed = ref(false);
const toastKey = ref<MessageKey | null>(null);
const settingsOpen = ref(false);
const libraryOpen = ref(false);
const mobileVideoOpen = ref(false);
const dictionaryOpen = ref(false);
const dictionaryWord = ref('');
const {
  shell,
  shellStyle,
  widths: sidebarWidths,
  minWidth: sidebarMinWidth,
  maxWidth: sidebarMaxWidth,
  collapsed: sidebarsCollapsed,
  resizing: resizingSidebar,
  startResize,
  finishResize,
  resizeWithKeyboard,
  toggleSidebar,
} = useSidebars();
const subtitleInput = ref<HTMLInputElement | null>(null);
const videoInput = ref<HTMLInputElement | null>(null);
const transcriptPanel = ref<InstanceType<typeof TranscriptPanel> | null>(null);
const video = ref<HTMLVideoElement | null>(null);
const importedCues = new Map<string, Cue[]>();
const localUrls: string[] = [];
const localIds = new Set<string>();
const savedOffset = readStored('offset', 0);
const offset = ref(
  typeof savedOffset === 'number' && Number.isFinite(savedOffset)
    ? Math.max(-5, Math.min(5, savedOffset))
    : 0,
);
const player = usePlayer(video, cues, activeId, offset, () => {
  toastKey.value = 'playbackError';
});
const { time, duration, paused, rate, loopCue, activeIndex, anchorIndex } = player;
const rates = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 1.75, 2];
let subtitleRequest: AbortController | null = null;
let libraryRequest: AbortController | null = null;
let disposed = false;

function statusLabel(episode: Episode): MessageKey {
  if (!episode.videoAvailable) return 'videoMissing';
  if (importedCues.has(episode.id)) return 'subtitleReady';
  return episode.subtitleStatus === 'ready'
    ? 'subtitleReady'
    : episode.subtitleStatus === 'processing'
      ? 'processing'
      : 'subtitleMissing';
}

async function loadSubtitles(episode: Episode) {
  subtitleRequest?.abort();
  const controller = new AbortController();
  subtitleRequest = controller;
  cues.value = importedCues.get(episode.id) || [];

  subtitlesFailed.value = false;
  loading.value = false;
  if (cues.value.length || !episode.subtitleUrl) return;
  loading.value = true;
  try {
    const response = await fetch(episode.subtitleUrl, { signal: controller.signal });
    if (!response.ok) throw new Error('subtitle_fetch_failed');
    const parsed = parseSubtitles(await response.text(), episode.subtitleFormat || '');
    if (!controller.signal.aborted && activeId.value === episode.id) cues.value = parsed;
  } catch {
    if (!controller.signal.aborted && activeId.value === episode.id) subtitlesFailed.value = true;
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}

function selectEpisode(episode: Episode) {
  libraryOpen.value = false;
  if (episode.id === activeId.value) return;
  player.saveProgress();
  video.value?.pause();
  activeId.value = episode.id;
  writeStored('episode', episode.id);

  videoFailed.value = false;
  void loadSubtitles(episode);
}

async function refreshLibrary() {
  libraryRequest?.abort();
  const controller = new AbortController();
  libraryRequest = controller;
  libraryLoading.value = true;
  libraryFailed.value = false;
  try {
    const response = await fetch('/api/library', { signal: controller.signal });
    if (!response.ok) throw new Error('library_fetch_failed');
    const data = await response.json();
    if (!Array.isArray(data.episodes)) throw new Error('invalid_library');
    if (controller.signal.aborted || disposed) return;
    const locals = episodes.value.filter((episode) => localIds.has(episode.id));
    episodes.value = [...data.episodes, ...locals];
    const saved = readStored('episode', '');
    const selected =
      episodes.value.find((episode) => episode.id === activeId.value) ||
      episodes.value.find((episode) => episode.id === saved) ||
      episodes.value.find((episode) => episode.videoAvailable) ||
      episodes.value[0];
    if (selected) {
      if (activeId.value !== selected.id) selectEpisode(selected);
      else await loadSubtitles(selected);
    }
  } catch {
    if (!controller.signal.aborted) libraryFailed.value = true;
  } finally {
    if (!controller.signal.aborted) libraryLoading.value = false;
  }
}

async function importSubtitles(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  const episodeId = activeId.value;
  if (!file || !episodeId) return;
  if (file.size > 8 * 1024 * 1024) {
    toastKey.value = 'subtitleLarge';
    return;
  }
  try {
    const parsed = parseSubtitles(await file.text(), file.name.split('.').pop());
    if (disposed) return;
    importedCues.set(episodeId, parsed);
    if (activeId.value !== episodeId) return;
    subtitleRequest?.abort();
    loading.value = false;
    subtitlesFailed.value = false;
    cues.value = parsed;

    toastKey.value = 'imported';
  } catch {
    toastKey.value = 'subtitleError';
  }
}

function openVideo(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  // Stable per-file identity lets the browser remember progress after reselecting it.
  let hash = 0;
  for (const char of `${file.name}:${file.size}:${file.lastModified}`)
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  const id = `local-${(hash >>> 0).toString(16)}`;
  const existing = episodes.value.find((episode) => episode.id === id);
  if (existing) {
    selectEpisode(existing);
    return;
  }
  const url = URL.createObjectURL(file);
  localUrls.push(url);
  localIds.add(id);
  const episode: Episode = {
    id,
    title: { zh: file.name.replace(/\.[^.]+$/, ''), en: file.name.replace(/\.[^.]+$/, '') },
    collection: { zh: message('zh', 'temporary'), en: message('en', 'temporary') },
    description: { zh: message('zh', 'temporaryHint'), en: message('en', 'temporaryHint') },
    videoUrl: url,
    subtitleUrl: null,
    subtitleFormat: null,
    subtitleStatus: 'missing',
    videoAvailable: true,
    poster: '',
  };
  episodes.value.push(episode);
  selectEpisode(episode);
}

function followCurrent() {
  void transcriptPanel.value?.followCurrent();
}

function openDictionary(word: string) {
  dictionaryWord.value = word;
  dictionaryOpen.value = true;
  video.value?.pause();
}

function keydown(event: KeyboardEvent) {
  if (event.defaultPrevented) return;
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    settingsOpen.value ||
    libraryOpen.value ||
    dictionaryOpen.value
  )
    return;
  if (
    (event.target as HTMLElement).closest(
      'input, textarea, select, button, video, [contenteditable="true"], [role="button"], [role="menu"], [role="dialog"]',
    )
  )
    return;
  const actions: Record<string, () => void> = {
    ' ': player.togglePlay,
    ArrowLeft: () => player.seek(time.value - 5),
    ArrowRight: () => player.seek(time.value + 5),
    '[': () => player.adjacent(-1),
    ']': () => player.adjacent(1),
    l: player.toggleLoop,
    L: player.toggleLoop,
  };
  if (actions[event.key]) {
    event.preventDefault();
    actions[event.key]();
  }
}

watch(
  locale,
  (value) => {
    document.documentElement.lang = value === 'zh' ? 'zh-CN' : 'en';
    document.title = `${message(value, 'brand')} · ${active.value?.title[value] || 'Listening Studio'}`;
    writeStored('locale', value);
  },
  { immediate: true },
);
watch(active, (value) => {
  document.title = `${t('brand')} · ${value?.title[locale.value] || 'Listening Studio'}`;
});
watch(
  themeMode,
  (value) => {
    theme.change(value);
    document.documentElement.dataset.theme = value;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', value === 'dark' ? '#002b36' : '#f5eedb');
    writeStored('theme', value);
  },
  { immediate: true },
);
watch(subtitleMode, (value) => writeStored('subtitleMode', value));
watch(offset, (value) => {
  if (!Number.isFinite(value)) {
    offset.value = 0;
    return;
  }
  if (value < -5 || value > 5) {
    offset.value = Math.max(-5, Math.min(5, value));
    return;
  }
  writeStored('offset', value);
});
onMounted(() => {
  void refreshLibrary();
  window.addEventListener('keydown', keydown);
});
onBeforeUnmount(() => {
  disposed = true;
  subtitleRequest?.abort();
  libraryRequest?.abort();
  window.removeEventListener('keydown', keydown);
  for (const url of localUrls) URL.revokeObjectURL(url);
});
</script>

<template>
  <v-app>
    <div
      ref="shell"
      class="studio-shell"
      :class="{
        'left-collapsed': sidebarsCollapsed.left,
        'right-collapsed': sidebarsCollapsed.right,
        'is-resizing': resizingSidebar !== null,
      }"
      :style="shellStyle"
    >
      <aside id="library-panel" class="library-panel" :aria-label="t('library')">
        <a class="brand" href="#" @click.prevent="followCurrent">
          <span class="brand-mark"><AudioLines :size="25" :stroke-width="1.7" /></span>
          <span class="brand-name">
            {{ t('brand') }}
            <span v-if="locale === 'zh'" class="brand-english">LISTENING STUDIO</span>
          </span>
        </a>
        <div class="library-heading">
          <span>{{ t('localLibrary') }}</span>
          <v-btn
            variant="text"
            class="icon-button small"
            :loading="libraryLoading"
            :aria-label="t('refresh')"
            :title="t('refresh')"
            @click="refreshLibrary"
          >
            <RefreshCw :size="16" />
          </v-btn>
        </div>
        <div class="collection-art">
          <Leaf :size="36" :stroke-width="1" />
          <span>{{ active?.collection[locale] || t('library') }}</span>
          <small>{{ String(episodes.length).padStart(2, '0') }} {{ t('episodes') }}</small>
        </div>
        <nav class="episode-list" :aria-label="t('chooseEpisode')">
          <button
            v-for="(episode, index) in episodes"
            :key="episode.id"
            class="episode-button"
            :class="{ selected: episode.id === activeId }"
            :aria-current="episode.id === activeId ? 'true' : undefined"
            @click="selectEpisode(episode)"
          >
            <span class="episode-number">
              <AudioLines v-if="episode.id === activeId && !paused" :size="17" />
              <span v-else>{{ String(index + 1).padStart(2, '0') }}</span>
            </span>
            <span class="episode-info">
              <strong>{{ episode.title[locale] }}</strong>
              <small :class="{ ready: episode.subtitleStatus === 'ready' }">
                <span v-if="episode.subtitleStatus === 'ready'" class="status-dot"></span>
                {{ t(statusLabel(episode)) }}
              </small>
            </span>
            <ChevronRight v-if="episode.id === activeId" :size="16" />
          </button>
        </nav>
        <div class="library-bottom">
          <nav class="sidebar-actions" :aria-label="t('menu')">
            <v-btn
              variant="text"
              class="language-button"
              :aria-label="t('language')"
              :title="t('language')"
              @click="locale = locale === 'zh' ? 'en' : 'zh'"
            >
              <Languages :size="19" />
              <span>{{ locale === 'zh' ? 'EN' : '中文' }}</span>
            </v-btn>
            <v-btn
              variant="text"
              class="icon-button"
              :aria-label="t(themeMode === 'light' ? 'dark' : 'light')"
              :title="t(themeMode === 'light' ? 'dark' : 'light')"
              @click="themeMode = themeMode === 'light' ? 'dark' : 'light'"
            >
              <Moon v-if="themeMode === 'light'" :size="20" />
              <Sun v-else :size="20" />
            </v-btn>
            <v-btn
              variant="text"
              class="icon-button"
              :aria-label="t('settings')"
              :title="t('settings')"
              @click="settingsOpen = true"
            >
              <Settings2 :size="20" />
            </v-btn>
          </nav>
          <v-btn variant="outlined" block class="open-video-button" @click="videoInput?.click()">
            <FolderOpen :size="17" />
            {{ t('importVideo') }}
          </v-btn>
          <p>{{ t('importHint') }}</p>
          <div class="local-badge">
            <Wifi :size="14" />
            <span>{{ t('local') }}</span>
            <span class="status-dot"></span>
          </div>
        </div>
      </aside>

      <div
        v-for="side in ['left', 'right'] as const"
        v-show="!sidebarsCollapsed[side]"
        :key="side"
        class="sidebar-resizer"
        :class="[side, { 'is-active': resizingSidebar === side }]"
        role="separator"
        aria-orientation="vertical"
        :aria-label="t(side === 'left' ? 'resizeLibrary' : 'resizeVideo')"
        :aria-controls="side === 'left' ? 'library-panel' : 'video-panel'"
        :aria-valuemin="sidebarMinWidth"
        :aria-valuemax="sidebarMaxWidth"
        :aria-valuenow="sidebarWidths[side]"
        :title="t('resizeSidebarHint')"
        tabindex="0"
        @pointerdown="startResize(side, $event)"
        @lostpointercapture="finishResize"
        @keydown.stop="resizeWithKeyboard(side, $event)"
      ></div>

      <main class="workspace">
        <div v-if="libraryFailed" class="error-banner" role="alert">
          <span>{{ t('libraryError') }}</span>
          <v-btn variant="text" @click="refreshLibrary">{{ t('refresh') }}</v-btn>
        </div>
        <div v-if="videoFailed" class="error-banner" role="alert">
          {{ t('videoError') }}
        </div>
        <section class="episode-intro">
          <v-btn
            variant="text"
            class="icon-button sidebar-toggle"
            :aria-label="t(sidebarsCollapsed.left ? 'expandLibrary' : 'collapseLibrary')"
            :title="t(sidebarsCollapsed.left ? 'expandLibrary' : 'collapseLibrary')"
            :aria-expanded="!sidebarsCollapsed.left"
            aria-controls="library-panel"
            @click="toggleSidebar('left')"
          >
            <PanelLeftOpen v-if="sidebarsCollapsed.left" :size="20" />
            <PanelLeftClose v-else :size="20" />
          </v-btn>
          <div class="episode-heading">
            <div class="eyebrow">
              <Headphones :size="13" />
              {{ t('listening') }}
              <span class="eyebrow-divider">/</span>
              {{ active?.collection[locale] || t('library') }}
            </div>
            <h1>
              <span class="title-index">{{ String(activeOrder).padStart(2, '0') }}</span>
              {{ active?.title[locale] || t('firstVideo') }}
              <span v-if="active && locale === 'zh'" class="title-translation">
                {{ active.title.en }}
              </span>
            </h1>
          </div>
          <div class="lesson-badge">
            <BookOpen :size="16" />
            <span>{{ t('nowPlaying') }}</span>
          </div>
          <v-btn
            variant="text"
            class="icon-button sidebar-toggle"
            :aria-label="t(sidebarsCollapsed.right ? 'expandVideo' : 'collapseVideo')"
            :title="t(sidebarsCollapsed.right ? 'expandVideo' : 'collapseVideo')"
            :aria-expanded="!sidebarsCollapsed.right"
            aria-controls="video-panel"
            @click="toggleSidebar('right')"
          >
            <PanelRightOpen v-if="sidebarsCollapsed.right" :size="20" />
            <PanelRightClose v-else :size="20" />
          </v-btn>
        </section>

        <TranscriptPanel
          ref="transcriptPanel"
          v-model:subtitle-mode="subtitleMode"
          :cues="cues"
          :active-index="activeIndex"
          :anchor-index="anchorIndex"
          :loop-id="loopCue?.id"
          :paused="paused"
          :locale="locale"
          :loading="loading"
          :subtitles-failed="subtitlesFailed"
          :processing="active?.subtitleStatus === 'processing'"
          :can-import="!!active"
          @jump="player.jumpTo"
          @import="subtitleInput?.click()"
          @refresh="refreshLibrary"
          @lookup="openDictionary"
        />
      </main>

      <aside
        id="video-panel"
        class="video-sidebar"
        :class="{ 'mobile-video-open': mobileVideoOpen }"
        :aria-label="t('video')"
      >
        <div class="video-heading">
          <span>
            <Video :size="16" />
            {{ t('video') }}
          </span>
          <span class="video-secondary-label">{{ t('nowPlaying') }}</span>
        </div>
        <!-- Keep one media element mounted so collapsing the picture preserves audio and position. -->
        <div class="video-frame">
          <video
            v-if="active?.videoAvailable"
            :key="active.id"
            ref="video"
            :src="active.videoUrl"
            :poster="active.poster || undefined"
            controls
            playsinline
            preload="metadata"
            :aria-label="active.title[locale]"
            @loadedmetadata="player.onLoaded"
            @play="player.onPlay"
            @pause="player.onPause"
            @timeupdate="player.update"
            @seeking="player.onSeeking"
            @ended="player.onEnded"
            @error="videoFailed = true"
            @ratechange="rate = video?.playbackRate || 1"
          ></video>
          <div
            v-if="videoFailed || !active?.videoAvailable"
            class="video-message"
            :role="videoFailed ? 'alert' : undefined"
          >
            <Volume2 :size="30" />
            <p>{{ active ? t('videoError') : t('firstVideo') }}</p>
            <v-btn v-if="!active" color="primary" @click="videoInput?.click()">
              {{ t('importVideo') }}
            </v-btn>
          </div>
        </div>

        <div class="video-details">
          <span class="eyebrow">{{ active?.collection[locale] || t('library') }}</span>
          <h2>{{ active?.title[locale] || t('firstVideo') }}</h2>
          <p v-if="active?.description[locale]">{{ active.description[locale] }}</p>
          <div class="listening-note">
            <Headphones :size="20" :stroke-width="1.5" />
            <p>{{ t('listenFirst') }}</p>
          </div>
        </div>
      </aside>

      <section class="playback-dock" :aria-label="t('playback')">
        <div class="playback-progress">
          <span class="progress-time">{{ formatTime(time) }}</span>
          <input
            class="seek-slider"
            type="range"
            min="0"
            :max="duration || 0"
            step="0.1"
            :value="time"
            :disabled="!duration"
            :aria-label="t('seek')"
            :aria-valuetext="formatTime(time) + ' / ' + formatTime(duration)"
            @input="player.seek(Number(($event.target as HTMLInputElement).value))"
          />
          <span class="progress-time">{{ formatTime(duration) }}</span>
        </div>
        <div class="player-toolbar">
          <div class="transport">
            <v-btn
              variant="text"
              class="icon-button"
              :disabled="!cues.length || !duration"
              :aria-label="t('previous')"
              :title="t('previous') + ' ['"
              @click="player.adjacent(-1)"
            >
              <SkipBack :size="18" />
            </v-btn>
            <v-btn
              color="primary"
              class="play-button"
              :disabled="!active?.videoAvailable"
              :aria-label="t(paused ? 'play' : 'pause')"
              :title="t(paused ? 'play' : 'pause')"
              @click="player.togglePlay"
            >
              <Play v-if="paused" :size="20" fill="currentColor" />
              <Pause v-else :size="20" fill="currentColor" />
            </v-btn>
            <v-btn
              variant="text"
              class="icon-button"
              :disabled="!cues.length || !duration"
              :aria-label="t('next')"
              :title="t('next') + ' ]'"
              @click="player.adjacent(1)"
            >
              <SkipForward :size="18" />
            </v-btn>
          </div>
          <div class="practice-controls">
            <v-menu>
              <template #activator="{ props }">
                <v-btn v-bind="props" variant="text" class="speed-button" :aria-label="t('speed')">
                  {{ rate }}×
                  <ChevronDown :size="14" />
                </v-btn>
              </template>
              <v-list density="compact" class="studio-menu">
                <v-list-item
                  v-for="speed in rates"
                  :key="speed"
                  :active="rate === speed"
                  @click="rate = speed"
                >
                  <template #title>
                    <span>{{ speed }}× {{ speed === 1 ? t('normal') : '' }}</span>
                  </template>
                </v-list-item>
              </v-list>
            </v-menu>
            <v-btn
              :variant="loopCue ? 'tonal' : 'text'"
              :color="loopCue ? 'primary' : undefined"
              class="loop-button"
              :disabled="!cues.length || !duration"
              :aria-pressed="!!loopCue"
              :aria-label="t('loop')"
              :title="t('loop') + ' · L'"
              @click="player.toggleLoop"
            >
              <Repeat1 :size="18" />
              <span>{{ t(loopCue ? 'looping' : 'loop') }}</span>
            </v-btn>
          </div>
        </div>

        <nav class="mobile-navigation" :aria-label="t('menu')">
          <v-btn variant="text" @click="libraryOpen = true">
            <ListVideo :size="20" />
            <span>{{ t('library') }}</span>
          </v-btn>
          <v-btn
            :variant="mobileVideoOpen ? 'tonal' : 'text'"
            :color="mobileVideoOpen ? 'primary' : undefined"
            :aria-expanded="mobileVideoOpen"
            aria-controls="video-panel"
            @click="mobileVideoOpen = !mobileVideoOpen"
          >
            <VideoOff v-if="mobileVideoOpen" :size="20" />
            <Video v-else :size="20" />
            <span>{{ t(mobileVideoOpen ? 'hideVideo' : 'showVideo') }}</span>
          </v-btn>
          <v-btn variant="text" @click="settingsOpen = true">
            <Settings2 :size="20" />
            <span>{{ t('settings') }}</span>
          </v-btn>
        </nav>
      </section>
    </div>

    <input
      ref="subtitleInput"
      class="visually-hidden"
      type="file"
      accept=".srt,.vtt,.json"
      tabindex="-1"
      :aria-label="t('importSubtitle')"
      @change="importSubtitles"
    />
    <input
      ref="videoInput"
      class="visually-hidden"
      type="file"
      accept="video/*,.mkv,.m4v"
      tabindex="-1"
      :aria-label="t('importVideo')"
      @change="openVideo"
    />

    <DictionaryDialog
      v-model="dictionaryOpen"
      :word="dictionaryWord"
      :locale="locale"
      @pronounce="video?.pause()"
    />

    <v-dialog v-model="libraryOpen" max-width="440" scrollable :aria-label="t('chooseEpisode')">
      <div class="settings-card">
        <div class="dialog-heading">
          <h2>{{ t('chooseEpisode') }}</h2>
          <v-btn
            class="icon-button"
            variant="text"
            :aria-label="t('close')"
            @click="libraryOpen = false"
          >
            <X :size="20" />
          </v-btn>
        </div>
        <nav class="dialog-episode-list">
          <button
            v-for="(episode, index) in episodes"
            :key="episode.id"
            class="episode-button"
            :class="{ selected: episode.id === activeId }"
            @click="selectEpisode(episode)"
          >
            <span class="episode-number">{{ String(index + 1).padStart(2, '0') }}</span>
            <span class="episode-info">
              <strong>{{ episode.title[locale] }}</strong>
              <small>{{ t(statusLabel(episode)) }}</small>
            </span>
            <Check v-if="activeId === episode.id" :size="18" />
          </button>
        </nav>
        <div class="dialog-actions">
          <v-btn variant="text" :loading="libraryLoading" @click="refreshLibrary">
            <RefreshCw :size="16" />
            {{ t('refresh') }}
          </v-btn>
          <v-btn
            color="primary"
            @click="
              videoInput?.click();
              libraryOpen = false;
            "
          >
            <FolderOpen :size="16" />
            {{ t('importVideo') }}
          </v-btn>
        </div>
      </div>
    </v-dialog>
    <v-dialog v-model="settingsOpen" max-width="480" :aria-label="t('settings')">
      <div class="settings-card">
        <div class="dialog-heading">
          <h2>{{ t('settings') }}</h2>
          <v-btn
            variant="text"
            class="icon-button"
            :aria-label="t('close')"
            @click="settingsOpen = false"
          >
            <X :size="20" />
          </v-btn>
        </div>
        <div class="appearance-settings">
          <v-btn
            variant="text"
            class="language-button"
            :aria-label="t('language')"
            :title="t('language')"
            @click="locale = locale === 'zh' ? 'en' : 'zh'"
          >
            <Languages :size="19" />
            <span>{{ locale === 'zh' ? 'EN' : '中文' }}</span>
          </v-btn>
          <v-btn
            variant="text"
            class="icon-button"
            :aria-label="t(themeMode === 'light' ? 'dark' : 'light')"
            :title="t(themeMode === 'light' ? 'dark' : 'light')"
            @click="themeMode = themeMode === 'light' ? 'dark' : 'light'"
          >
            <Moon v-if="themeMode === 'light'" :size="20" />
            <Sun v-else :size="20" />
          </v-btn>
        </div>
        <label class="offset-label" for="subtitle-offset">
          {{ t('offset') }}
          <input
            id="subtitle-offset"
            v-model.lazy.number="offset"
            type="number"
            min="-5"
            max="5"
            step="0.25"
          />
        </label>
        <p class="setting-hint">{{ t('offsetHint') }}</p>
        <v-btn variant="text" class="reset-button" @click="offset = 0">
          {{ t('offsetReset') }}
        </v-btn>
        <div class="shortcut-list">
          <h3>{{ t('shortcuts') }}</h3>
          <div>
            <span>{{ t('space') }}</span>
            <kbd>Space</kbd>
          </div>
          <div>
            <span>{{ t('arrows') }}</span>
            <span>
              <kbd>←</kbd>
              <kbd>→</kbd>
            </span>
          </div>
          <div>
            <span>{{ t('brackets') }}</span>
            <span>
              <kbd>[</kbd>
              <kbd>]</kbd>
            </span>
          </div>
          <div>
            <span>{{ t('shortcutLoop') }}</span>
            <kbd>L</kbd>
          </div>
        </div>
        <p class="source-note">{{ t('sourceNote') }}</p>
        <div class="dialog-actions">
          <v-btn color="primary" @click="settingsOpen = false">{{ t('close') }}</v-btn>
        </div>
      </div>
    </v-dialog>
    <v-snackbar
      :model-value="toastKey !== null"
      :timeout="4500"
      color="primary"
      rounded="lg"
      @update:model-value="
        (value) => {
          if (!value) toastKey = null;
        }
      "
    >
      {{ toastKey ? t(toastKey) : '' }}
      <template #actions>
        <v-btn variant="text" :aria-label="t('close')" @click="toastKey = null">
          <X :size="18" />
        </v-btn>
      </template>
    </v-snackbar>
  </v-app>
</template>
