// Directions to a downloaded file. Web apps can't open the Downloads folder
// or reveal a file, so we tell people exactly where to look on their device.

import { detectBrowser, detectKind, type UaHints } from './deviceName';

export interface Directions {
  /** Short place name: "Downloads". */
  place: string;
  steps: string[];
}

export function whereToFind(hints: UaHints): Directions {
  const kind = detectKind(hints);
  const browser = detectBrowser(hints.userAgent);
  switch (kind) {
    case 'android':
      return {
        place: 'Downloads',
        steps: [
          'Open the Files app (or "Files by Google") and tap Downloads.',
          `Or in ${browser === 'Browser' ? 'your browser' : browser}, open the menu (⋮) and tap Downloads.`,
        ],
      };
    case 'ios':
      return {
        place: 'Downloads',
        steps: [
          'Open the Files app, tap Browse, then Downloads (in iCloud Drive or On My iPhone).',
          'In Safari you can also tap the downloads arrow next to the address bar.',
        ],
      };
    case 'mac':
      return {
        place: 'Downloads',
        steps: [
          'Open Finder and choose Downloads in the sidebar (or press ⌥⌘L in Finder).',
          browser === 'Safari'
            ? 'In Safari, click the downloads arrow in the toolbar.'
            : `In ${browser}, press ⌥⌘L or open the menu and choose Downloads.`,
        ],
      };
    case 'windows':
      return {
        place: 'Downloads',
        steps: [
          'Open File Explorer and choose Downloads.',
          `In ${browser === 'Browser' ? 'your browser' : browser}, press Ctrl + J to see your downloads.`,
        ],
      };
    default:
      return {
        place: 'Downloads',
        steps: [
          'Open your file manager and go to the Downloads folder.',
          'Or open your browser’s downloads list (usually Ctrl + J).',
        ],
      };
  }
}
