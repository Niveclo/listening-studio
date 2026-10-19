import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import type { Cue } from '../types';
import { cueAt } from '../lib/subtitles';
import { readStored, writeStored } from '../lib/storage';

export function usePlayer(
  video: Ref<HTMLVideoElement | null>,
  cues: Ref<Cue[]>,
  identity: Ref<string>,
  offset: Ref<number>,
  onError: () => void,
) {
  const time = ref(0);
  const duration = ref(0);
  const paused = ref(true);
  const loopCue = ref<Cue | null>(null);
  const initialRate = readStored('rate', 1);
  const rate = ref([0.5, 0.75, 0.9, 1, 1.25, 1.5, 1.75, 2].includes(initialRate) ? initialRate : 1);
  let animation = 0;
  let lastSaved = 0;
  let loadedIdentity = '';
  let pendingSeek: number | null = null;
  const anchorIndex = computed(() => cueAt(cues.value, time.value - offset.value));
  const activeIndex = computed(() => {
    const index = anchorIndex.value;
    return index >= 0 && time.value - offset.value < cues.value[index].end ? index : -1;
  });

  function saveProgress() {
    if (loadedIdentity && loadedIdentity === identity.value && duration.value > 0) {
      writeStored(`progress:${loadedIdentity}`, { time: time.value, duration: duration.value });
      lastSaved = Date.now();
    }
  }

  function update() {
    const element = video.value;
    if (!element || loadedIdentity !== identity.value) return;
    let position = element.currentTime;
    if (loopCue.value && !element.seeking && !element.paused) {
      const start = Math.max(0, loopCue.value.start + offset.value);
      const end = Math.min(duration.value, loopCue.value.end + offset.value);
      if (end > start && position >= end - 0.025) {
        element.currentTime = start;
        position = start;
      }
    }
    // Check repeat boundaries every frame without repainting the UI at video frame rate.
    if (element.paused || Math.abs(time.value - position) >= 0.08) time.value = position;
    if (Date.now() - lastSaved > 3000) saveProgress();
  }

  function tick() {
    update();
    if (!paused.value) animation = requestAnimationFrame(tick);
  }

  function onPlay() {
    paused.value = false;
    cancelAnimationFrame(animation);
    tick();
  }

  function onPause() {
    paused.value = true;
    cancelAnimationFrame(animation);
    update();
    saveProgress();
  }

  function onLoaded() {
    const element = video.value;
    if (!element) return;
    loadedIdentity = identity.value;
    duration.value = Number.isFinite(element.duration) ? element.duration : 0;
    element.playbackRate = rate.value;
    const progress = readStored<{ time: number } | null>(`progress:${identity.value}`, null);
    if (pendingSeek !== null) {
      element.currentTime = Math.min(duration.value, pendingSeek);
      pendingSeek = null;
    } else if (
      progress &&
      Number.isFinite(progress.time) &&
      progress.time > 0 &&
      progress.time < duration.value - 2
    )
      element.currentTime = progress.time;
    time.value = element.currentTime;
  }

  async function play() {
    const element = video.value;
    if (!element) return;
    try {
      await element.play();
    } catch (error) {
      if (
        video.value === element &&
        !(error instanceof DOMException && error.name === 'AbortError')
      )
        onError();
    }
  }

  function togglePlay() {
    if (!video.value) return;
    if (video.value.paused) void play();
    else video.value.pause();
  }

  function seek(value: number) {
    if (!video.value || !Number.isFinite(value)) return;
    if (!duration.value) {
      pendingSeek = Math.max(0, value);
      return;
    }
    const target = Math.max(0, Math.min(duration.value, value));
    video.value.currentTime = target;
    time.value = target;
  }

  function jumpTo(cue: Cue) {
    if (loopCue.value) loopCue.value = isPlayableCue(cue) ? cue : null;
    seek(cue.start + offset.value);
    void play();
  }

  function adjacent(direction: -1 | 1) {
    if (!cues.value.length) return;
    const index = Math.max(0, Math.min(cues.value.length - 1, anchorIndex.value + direction));
    jumpTo(cues.value[index]);
  }

  function toggleLoop() {
    if (loopCue.value) {
      loopCue.value = null;
      return;
    }
    const cue = cues.value[Math.max(0, anchorIndex.value)];
    if (!cue || !isPlayableCue(cue)) return;
    loopCue.value = cue;
    jumpTo(cue);
  }

  function onSeeking() {
    const cue = loopCue.value;
    if (
      cue &&
      video.value &&
      (video.value.currentTime < Math.max(0, cue.start + offset.value) - 0.05 ||
        video.value.currentTime > cue.end + offset.value + 0.05)
    )
      loopCue.value = null;
  }

  function onEnded() {
    if (loopCue.value && isPlayableCue(loopCue.value)) {
      seek(loopCue.value.start + offset.value);
      void play();
    } else {
      loopCue.value = null;
      onPause();
    }
  }

  function isPlayableCue(cue: Cue) {
    return (
      duration.value > 0 && cue.start + offset.value < duration.value && cue.end + offset.value > 0
    );
  }

  watch(rate, (value) => {
    if (video.value) video.value.playbackRate = value;
    writeStored('rate', value);
  });
  watch(identity, () => {
    cancelAnimationFrame(animation);
    paused.value = true;
    duration.value = 0;
    time.value = 0;
    loadedIdentity = '';
    pendingSeek = null;
    loopCue.value = null;
  });
  watch(cues, () => {
    loopCue.value = null;
  });
  watch(offset, () => {
    if (loopCue.value && !isPlayableCue(loopCue.value)) loopCue.value = null;
    if (loopCue.value) seek(loopCue.value.start + offset.value);
  });
  onMounted(() => {
    window.addEventListener('pagehide', saveProgress);
    document.addEventListener('visibilitychange', saveProgress);
  });
  onBeforeUnmount(() => {
    saveProgress();
    cancelAnimationFrame(animation);
    window.removeEventListener('pagehide', saveProgress);
    document.removeEventListener('visibilitychange', saveProgress);
  });

  return {
    time,
    duration,
    paused,
    rate,
    loopCue,
    anchorIndex,
    activeIndex,
    saveProgress,
    onLoaded,
    onPlay,
    onPause,
    update,
    onSeeking,
    onEnded,
    togglePlay,
    jumpTo,
    adjacent,
    toggleLoop,
    seek,
  };
}
