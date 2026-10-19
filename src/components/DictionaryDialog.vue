<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { BookOpen, LoaderCircle, RefreshCw, Volume2, VolumeX, X } from '@lucide/vue';
import type { Locale } from '../types';
import { message, type MessageKey } from '../i18n';
import { readStored, writeStored } from '../lib/storage';
import {
  cachedDefinition,
  DictionaryError,
  lookupWord,
  responseError,
  type DictionaryEntry,
} from '../lib/dictionary';

const props = defineProps<{ word: string; locale: Locale }>();
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ pronounce: [] }>();
const t = (key: MessageKey) => message(props.locale, key);
const entry = ref<DictionaryEntry | null>(null);
const loading = ref(false);
const cached = ref(false);
const failure = ref('');
const audioFailure = ref('');
const audio = ref<HTMLAudioElement | null>(null);
const storedVolume = readStored<unknown>('dictionaryVolume', 35);
const pronunciationVolume = ref(
  typeof storedVolume === 'number' && Number.isFinite(storedVolume)
    ? Math.round(Math.max(0, Math.min(100, storedVolume)))
    : 35,
);
const playingAccent = ref<'uk' | 'us' | null>(null);
const loadingAccent = ref<'uk' | 'us' | null>(null);
let request: AbortController | null = null;
let requestTimer = 0;
let audioRequest: AbortController | null = null;
let audioGeneration = 0;
let diagnosedGeneration = -1;
let audioUrl = '';
let disposed = false;

function errorMessage(code: string, isAudio = false): MessageKey {
  if (code === 'QUOTA_EXHAUSTED') return 'dictionaryQuota';
  if (code === 'RATE_LIMITED') return 'dictionaryRate';
  if (code === 'PLAY_BLOCKED') return 'dictionaryAudioBlocked';
  if (code === 'BACKEND_UNAVAILABLE') return 'dictionaryBackendUnavailable';
  if (code === 'INVALID_RESPONSE') return 'dictionaryInvalidResponse';
  if (isAudio) return 'dictionaryAudioError';
  if (code === 'NOT_FOUND') return 'dictionaryNotFound';
  return 'dictionaryUnavailable';
}
const failureMessage = computed(() => errorMessage(failure.value));
const audioFailureMessage = computed(() => errorMessage(audioFailure.value, true));

function stopAudio() {
  audioGeneration++;
  diagnosedGeneration = -1;
  audioRequest?.abort();
  audioRequest = null;
  if (audio.value) {
    audio.value.pause();
    audio.value.removeAttribute('src');
    audio.value.load();
  }
  audioUrl = '';
  playingAccent.value = null;
  loadingAccent.value = null;
}

async function loadDefinition() {
  request?.abort();
  request = null;
  window.clearTimeout(requestTimer);
  stopAudio();
  failure.value = '';
  audioFailure.value = '';
  entry.value = null;
  loading.value = false;
  cached.value = false;
  if (!open.value || !props.word) return;
  const saved = cachedDefinition(props.word);
  if (saved) {
    entry.value = saved;
    cached.value = true;
    return;
  }
  const controller = new AbortController();
  request = controller;
  requestTimer = window.setTimeout(() => controller.abort(), 22000);
  loading.value = true;
  try {
    const result = await lookupWord(props.word, controller.signal);
    if (!disposed && request === controller && open.value) entry.value = result;
  } catch (error) {
    if (!disposed && request === controller && open.value)
      failure.value = error instanceof DictionaryError ? error.code : 'UNAVAILABLE';
  } finally {
    if (request === controller) {
      window.clearTimeout(requestTimer);
      loading.value = false;
      request = null;
    }
  }
}

async function diagnoseAudio() {
  const generation = audioGeneration;
  if (!audioUrl || diagnosedGeneration === generation || !open.value) return;
  diagnosedGeneration = generation;
  playingAccent.value = null;
  loadingAccent.value = null;
  const controller = new AbortController();
  audioRequest = controller;
  const timer = window.setTimeout(() => controller.abort(), 15000);
  try {
    // A native <audio> cannot expose an API's JSON error. The backend shares this request/cache.
    const response = await fetch(audioUrl, { signal: controller.signal });
    const error = response.ok
      ? new DictionaryError('AUDIO_UNAVAILABLE')
      : await responseError(response);
    if (response.ok) await response.body?.cancel();
    if (!disposed && generation === audioGeneration) audioFailure.value = error.code;
  } catch {
    if (!disposed && generation === audioGeneration) audioFailure.value = 'AUDIO_UNAVAILABLE';
  } finally {
    window.clearTimeout(timer);
    if (audioRequest === controller) audioRequest = null;
  }
}

async function pronounce(accent: 'uk' | 'us') {
  if (!audio.value || !entry.value) return;
  stopAudio();
  audioFailure.value = '';
  emit('pronounce');
  const generation = audioGeneration;
  playingAccent.value = accent;
  loadingAccent.value = accent;
  audioUrl = `/api/dictionary/audio?word=${encodeURIComponent(entry.value.word)}&accent=${accent}`;
  audio.value.volume = pronunciationVolume.value / 100;
  // Call play inside the click gesture, including on browsers with strict mobile audio policies.
  audio.value.src = audioUrl;
  try {
    await audio.value.play();
    if (generation === audioGeneration) loadingAccent.value = null;
  } catch (error) {
    if (disposed || generation !== audioGeneration) return;
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      playingAccent.value = null;
      loadingAccent.value = null;
      audioFailure.value = 'PLAY_BLOCKED';
    } else await diagnoseAudio();
  }
}

watch(pronunciationVolume, (value) => {
  if (audio.value) audio.value.volume = value / 100;
  writeStored('dictionaryVolume', value);
});

watch(
  () => [open.value, props.word],
  () => void loadDefinition(),
  { immediate: true },
);
onBeforeUnmount(() => {
  disposed = true;
  request?.abort();
  window.clearTimeout(requestTimer);
  stopAudio();
});
</script>

<template>
  <v-dialog v-model="open" class="dictionary-dialog" max-width="560" :aria-label="t('dictionary')">
    <article class="dictionary-card">
      <div class="dictionary-heading">
        <div>
          <span class="eyebrow">
            <BookOpen :size="14" />
            {{ t('dictionary') }}
          </span>
          <h2 lang="en">{{ entry?.word || word }}</h2>
        </div>
        <v-btn variant="text" class="icon-button" :aria-label="t('close')" @click="open = false">
          <X :size="21" />
        </v-btn>
      </div>
      <div class="dictionary-body" aria-live="polite" :aria-busy="loading">
        <div v-if="loading" class="dictionary-state" role="status">
          <LoaderCircle class="spin" :size="28" />
          <p>{{ t('dictionaryLoading') }}</p>
        </div>
        <div v-else-if="failure" class="dictionary-state" role="alert">
          <BookOpen :size="28" />
          <p>{{ t(failureMessage) }}</p>
          <v-btn
            v-if="failure !== 'QUOTA_EXHAUSTED'"
            variant="tonal"
            color="primary"
            @click="loadDefinition"
          >
            <RefreshCw :size="16" />
            {{ t('dictionaryRetry') }}
          </v-btn>
        </div>
        <template v-else-if="entry">
          <div class="dictionary-phonetics">
            <button
              v-for="phonetic in entry.phonetics"
              :key="phonetic.accent"
              class="pronunciation-button"
              :class="{ 'is-playing': playingAccent === phonetic.accent }"
              :disabled="loadingAccent !== null"
              :aria-label="t(phonetic.accent === 'uk' ? 'dictionaryPlayUK' : 'dictionaryPlayUS')"
              @click="pronounce(phonetic.accent)"
            >
              <span>{{ t(phonetic.accent === 'uk' ? 'dictionaryUK' : 'dictionaryUS') }}</span>
              <span class="phonetic-text">
                {{
                  phonetic.text
                    ? `/${phonetic.text.replace(/^\/|\/$/g, '')}/`
                    : t('dictionaryNoPhonetic')
                }}
              </span>
              <LoaderCircle v-if="loadingAccent === phonetic.accent" class="spin" :size="17" />
              <Volume2 v-else :size="17" />
            </button>
          </div>
          <div class="dictionary-volume">
            <label for="dictionary-volume">
              <VolumeX v-if="pronunciationVolume === 0" :size="16" aria-hidden="true" />
              <Volume2 v-else :size="16" aria-hidden="true" />
              <span>{{ t('dictionaryVolume') }}</span>
            </label>
            <input
              id="dictionary-volume"
              v-model.number="pronunciationVolume"
              type="range"
              min="0"
              max="100"
              step="1"
              :aria-valuetext="`${pronunciationVolume}%`"
            />
            <output for="dictionary-volume">{{ pronunciationVolume }}%</output>
          </div>
          <p v-if="audioFailure" class="dictionary-notice" role="alert">
            {{ t(audioFailureMessage) }}
          </p>
          <section class="dictionary-section">
            <h3>{{ t('dictionaryChinese') }}</h3>
            <ol v-if="entry.definitions.length" class="dictionary-definitions">
              <li v-for="(definition, index) in entry.definitions" :key="index">
                <span v-if="definition.partOfSpeech" class="part-of-speech">
                  {{ definition.partOfSpeech }}
                </span>
                <span lang="zh-CN">{{ definition.meaning }}</span>
              </li>
            </ol>
            <p v-else class="dictionary-muted">{{ t('dictionaryNoChinese') }}</p>
          </section>
          <section v-if="entry.englishDefinitions.length" class="dictionary-section">
            <h3>{{ t('dictionaryEnglish') }}</h3>
            <ol class="dictionary-definitions english-definitions" lang="en">
              <li v-for="(definition, index) in entry.englishDefinitions" :key="index">
                <p>
                  <span v-if="definition.partOfSpeech" class="part-of-speech">
                    {{ definition.partOfSpeech }}
                  </span>
                  {{ definition.definition }}
                </p>
                <p v-for="example in definition.examples" :key="example" class="dictionary-example">
                  {{ example }}
                </p>
              </li>
            </ol>
          </section>
          <section v-if="entry.forms.length" class="dictionary-section">
            <h3>{{ t('dictionaryForms') }}</h3>
            <div class="dictionary-forms">
              <span v-for="(form, index) in entry.forms" :key="index">
                <small>{{ form.name }}</small>
                <span lang="en">{{ form.value }}</span>
              </span>
            </div>
          </section>
        </template>
      </div>
      <div class="dictionary-footer">
        <a
          href="https://uapis.cn/docs/api-reference/get-dictionary-lookup"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ t('dictionarySource') }} · UAPI
        </a>
        <span v-if="cached">{{ t('dictionaryCached') }}</span>
      </div>
      <audio
        ref="audio"
        preload="none"
        @error="diagnoseAudio"
        @ended="
          playingAccent = null;
          loadingAccent = null;
        "
      ></audio>
    </article>
  </v-dialog>
</template>
