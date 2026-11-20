import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

export function useWordSelection(
  transcript: Ref<HTMLElement | null>,
  onLookup: (word: string) => void,
) {
  const selectedWord = ref('');
  const selecting = ref(false);

  function englishElement(node: Node | null) {
    const element = node instanceof Element ? node : node?.parentElement;
    return element?.closest('.cue-en');
  }

  function syncSelection() {
    const selection = window.getSelection();
    const { anchorNode, focusNode } = selection ?? {};
    const container = transcript.value;
    selecting.value = !!(
      selection &&
      !selection.isCollapsed &&
      anchorNode &&
      focusNode &&
      container?.contains(anchorNode) &&
      container.contains(focusNode)
    );
    selectedWord.value = '';
    if (!selection || !selecting.value) return;
    const english = englishElement(selection.anchorNode);
    if (!english || english !== englishElement(selection.focusNode)) return;
    const word = selection
      .toString()
      .trim()
      .replaceAll('’', "'")
      .replace(/^[^a-z]+|[^a-z]+$/gi, '');
    if (word.length <= 64 && /^[a-z]+(?:['-][a-z]+)*$/i.test(word)) {
      selectedWord.value = word.toLowerCase();
    }
  }

  function lookupSelected() {
    const word = selectedWord.value;
    if (!word) return;
    window.getSelection()?.removeAllRanges();
    reset();
    onLookup(word);
  }

  function doubleClick() {
    syncSelection();
    lookupSelected();
  }

  function reset() {
    selecting.value = false;
    selectedWord.value = '';
  }

  onMounted(() => document.addEventListener('selectionchange', syncSelection));
  onBeforeUnmount(() => document.removeEventListener('selectionchange', syncSelection));

  return { selectedWord, selecting, lookupSelected, doubleClick, reset };
}
