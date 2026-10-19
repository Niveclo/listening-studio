import { onBeforeUnmount, onMounted, type Ref } from 'vue';

/** Native text selection supports mouse, keyboard and mobile selection handles. */
export function useWordSelection(
  transcript: Ref<HTMLElement | null>,
  onLookup: (word: string) => void,
  onSelecting: () => void,
) {
  let selectionTimer = 0;
  let jumpTimer = 0;
  let pointerDown = false;
  let pointerType = '';
  let startX = 0;
  let startY = 0;
  let started = 0;
  let moved = false;
  let suppressClickUntil = 0;
  let lastWord = '';

  function englishElement(node: Node | null) {
    const element = node instanceof Element ? node : node?.parentElement;
    return element?.closest<HTMLElement>('.cue-en') || null;
  }

  function selectedWord() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return '';
    const start = englishElement(selection.anchorNode);
    const end = englishElement(selection.focusNode);
    if (!start || start !== end || !transcript.value?.contains(start)) return '';
    const word = selection
      .toString()
      .trim()
      .replaceAll('’', "'")
      .replace(/^[^a-z]+|[^a-z]+$/gi, '');
    return word.length <= 64 && /^[a-z]+(?:['-][a-z]+)*$/i.test(word) ? word.toLowerCase() : '';
  }

  function showSelection() {
    const word = selectedWord();
    if (!word || word === lastWord) return;
    window.clearTimeout(jumpTimer);
    lastWord = word;
    suppressClickUntil = Date.now() + 800;
    onSelecting();
    onLookup(word);
    // Dismiss the native copy menu when the dictionary takes focus.
    window.getSelection()?.removeAllRanges();
  }

  function selectionChanged() {
    window.clearTimeout(selectionTimer);
    if (!selectedWord()) {
      lastWord = '';
      return;
    }
    window.clearTimeout(jumpTimer);
    onSelecting();
    if (!pointerDown) selectionTimer = window.setTimeout(showSelection, 280);
  }

  function startSelection(event: PointerEvent) {
    if (event.button !== 0) return;
    window.clearTimeout(jumpTimer);
    window.clearTimeout(selectionTimer);
    pointerDown = true;
    pointerType = event.pointerType;
    startX = event.clientX;
    startY = event.clientY;
    started = performance.now();
    moved = false;
  }

  function moveSelection(event: PointerEvent) {
    if (pointerDown && Math.hypot(event.clientX - startX, event.clientY - startY) > 8) moved = true;
  }

  function endSelection() {
    if (!pointerDown) return;
    pointerDown = false;
    if (moved || performance.now() - started >= 450) suppressClickUntil = Date.now() + 800;
    selectionChanged();
  }

  function cancelSelection() {
    if (!pointerDown) return;
    moved = true;
    endSelection();
  }

  function clickCue(event: MouseEvent, jump: () => void) {
    if (selectedWord()) {
      window.clearTimeout(jumpTimer);
      selectionChanged();
      return;
    }
    if (Date.now() < suppressClickUntil || moved || event.detail > 1) return;
    if (englishElement(event.target as Node) && pointerType !== 'touch' && event.detail !== 0) {
      // Wait through the double-click interval before treating an English word click as a seek.
      window.clearTimeout(jumpTimer);
      jumpTimer = window.setTimeout(jump, 550);
    } else jump();
  }

  function doubleClick() {
    window.clearTimeout(jumpTimer);
    selectionChanged();
  }

  function contextMenu(event: MouseEvent) {
    if (!selectedWord()) return;
    event.preventDefault();
    suppressClickUntil = Date.now() + 800;
    selectionChanged();
  }

  function reset() {
    window.clearTimeout(selectionTimer);
    window.clearTimeout(jumpTimer);
    pointerDown = false;
    lastWord = '';
  }

  onMounted(() => {
    document.addEventListener('selectionchange', selectionChanged);
    window.addEventListener('pointermove', moveSelection, { passive: true });
    window.addEventListener('pointerup', endSelection);
    window.addEventListener('pointercancel', cancelSelection);
    window.addEventListener('blur', cancelSelection);
  });
  onBeforeUnmount(() => {
    reset();
    document.removeEventListener('selectionchange', selectionChanged);
    window.removeEventListener('pointermove', moveSelection);
    window.removeEventListener('pointerup', endSelection);
    window.removeEventListener('pointercancel', cancelSelection);
    window.removeEventListener('blur', cancelSelection);
  });

  return { clickCue, startSelection, doubleClick, contextMenu, reset };
}
