// PLAT-7's cursor module: the codec moved into the kernel's list page helper with the rest of the
// cursor lists (PLAT-12 plan 2.4); its names stay importable from here.
export {
  CURSOR_CODEC,
  CursorCodec,
  cursorHmacKey,
  cursorLifetimeSeconds,
  type CursorBinding,
} from '../contract/list-page.js';
