import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { readStored, writeStored } from '../lib/storage';

type Side = 'left' | 'right';
interface SidebarPreferences {
  widths: Record<Side, number | null>;
  collapsed: Record<Side, boolean>;
}

export function useSidebars() {
  const saved = readStored<Partial<SidebarPreferences> | null>('sidebars', null);
  const shell = ref<HTMLElement | null>(null);
  const availableWidth = ref(document.documentElement.clientWidth);
  const requestedWidths = ref<Record<Side, number | null>>({
    left: storedWidth(saved?.widths?.left) ?? 230,
    right: storedWidth(saved?.widths?.right),
  });
  const collapsed = ref<Record<Side, boolean>>({
    left: saved?.collapsed?.left === true,
    right: saved?.collapsed?.right === true,
  });
  const resizing = ref<Side | null>(null);
  const maxWidth = computed(() => Math.floor(availableWidth.value * 0.25));
  const minWidth = computed(() => Math.min(200, maxWidth.value));
  const widths = computed(() => ({
    left: clampWidth(requestedWidths.value.left ?? 230),
    right: clampWidth(
      requestedWidths.value.right ?? Math.min(380, Math.max(260, availableWidth.value * 0.24)),
    ),
  }));
  const shellStyle = computed(() => ({
    '--left-sidebar-width': `${collapsed.value.left ? 0 : widths.value.left}px`,
    '--right-sidebar-width': `${collapsed.value.right ? 0 : widths.value.right}px`,
  }));
  let observer: ResizeObserver | null = null;
  let drag: {
    side: Side;
    pointerId: number;
    startX: number;
    startWidth: number;
    handle: HTMLElement;
  } | null = null;

  function storedWidth(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  }

  function clampWidth(value: number) {
    return Math.round(Math.max(minWidth.value, Math.min(maxWidth.value, value)));
  }

  function savePreferences() {
    writeStored('sidebars', { widths: requestedWidths.value, collapsed: collapsed.value });
  }

  function finishResize() {
    const previous = drag;
    if (!previous) return;
    drag = null;
    resizing.value = null;
    if (previous.handle.hasPointerCapture(previous.pointerId))
      previous.handle.releasePointerCapture(previous.pointerId);
    savePreferences();
  }

  function startResize(side: Side, event: PointerEvent) {
    if (event.button !== 0 || collapsed.value[side] || availableWidth.value <= 900) return;
    finishResize();
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    drag = {
      side,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: widths.value[side],
      handle,
    };
    resizing.value = side;
  }

  function moveResize(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!event.buttons) {
      finishResize();
      return;
    }
    const delta = (event.clientX - drag.startX) * (drag.side === 'left' ? 1 : -1);
    requestedWidths.value[drag.side] = clampWidth(drag.startWidth + delta);
  }

  function endResize(event: PointerEvent) {
    if (drag?.pointerId === event.pointerId) finishResize();
  }

  function resizeWithKeyboard(side: Side, event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 10;
    const direction = (event.key === 'ArrowRight' ? 1 : -1) * (side === 'left' ? 1 : -1);
    requestedWidths.value[side] =
      event.key === 'Home'
        ? minWidth.value
        : event.key === 'End'
          ? maxWidth.value
          : clampWidth(widths.value[side] + direction * step);
    savePreferences();
  }

  function toggleSidebar(side: Side) {
    finishResize();
    collapsed.value[side] = !collapsed.value[side];
    savePreferences();
  }

  onMounted(() => {
    observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width === availableWidth.value) return;
      finishResize();
      availableWidth.value = entry.contentRect.width;
    });
    if (shell.value) observer.observe(shell.value);
    window.addEventListener('pointermove', moveResize);
    window.addEventListener('pointerup', endResize);
    window.addEventListener('pointercancel', endResize);
    window.addEventListener('blur', finishResize);
  });
  onBeforeUnmount(() => {
    finishResize();
    observer?.disconnect();
    window.removeEventListener('pointermove', moveResize);
    window.removeEventListener('pointerup', endResize);
    window.removeEventListener('pointercancel', endResize);
    window.removeEventListener('blur', finishResize);
  });

  return {
    shell,
    shellStyle,
    widths,
    minWidth,
    maxWidth,
    collapsed,
    resizing,
    startResize,
    finishResize,
    resizeWithKeyboard,
    toggleSidebar,
  };
}
