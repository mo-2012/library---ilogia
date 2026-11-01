import { createElement, House, Search, BookOpen, Bookmark, BookmarkCheck, Library, Upload, ShieldCheck, Languages, LogOut, Menu, X, Download,
  Share2, Flag, Plus, Trash2, Pencil, Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ZoomIn, ZoomOut, Maximize, Minimize,
  FileText, Notebook, Layers, Clipboard, Sparkles, Clock, History, Folder, FolderPlus, LayoutGrid, List, SlidersHorizontal, ArrowUpRight,
  Link, Video, Music, Image, FileSpreadsheet, Presentation, File, CircleAlert, Eye, Users, ChartColumn, Inbox, RefreshCw, Play, ArrowRight,
  ArrowLeft, Info, Mail, Lock, Globe, CircleCheck, CircleX, TriangleAlert, FolderOpen, Tag, Rows3, BookMarked, WifiOff, Ban, Undo2, Gauge,
  ExternalLink, Save } from 'lucide';

const MAP = { home: House, search: Search, 'book-open': BookOpen, bookmark: Bookmark, 'bookmark-check': BookmarkCheck, library: Library, upload: Upload,
  shield: ShieldCheck, languages: Languages, logout: LogOut, menu: Menu, x: X, download: Download, share: Share2, flag: Flag, plus: Plus, trash: Trash2,
  edit: Pencil, check: Check, 'chev-l': ChevronLeft, 'chev-r': ChevronRight, 'chevs-l': ChevronsLeft, 'chevs-r': ChevronsRight, 'zoom-in': ZoomIn,
  'zoom-out': ZoomOut, maximize: Maximize, minimize: Minimize, 'file-text': FileText, notebook: Notebook, layers: Layers, clipboard: Clipboard,
  sparkles: Sparkles, clock: Clock, history: History, folder: Folder, 'folder-plus': FolderPlus, 'folder-open': FolderOpen, grid: LayoutGrid, list: List,
  filter: SlidersHorizontal, 'arrow-up-right': ArrowUpRight, link: Link, video: Video, audio: Music, image: Image, sheet: FileSpreadsheet,
  slides: Presentation, file: File, alert: CircleAlert, eye: Eye, users: Users, chart: ChartColumn, inbox: Inbox, refresh: RefreshCw, play: Play,
  'arrow-r': ArrowRight, 'arrow-l': ArrowLeft, info: Info, mail: Mail, lock: Lock, globe: Globe, 'ok': CircleCheck, 'no': CircleX, warn: TriangleAlert,
  tag: Tag, rows: Rows3, 'book-marked': BookMarked, offline: WifiOff, ban: Ban, undo: Undo2, gauge: Gauge, external: ExternalLink, save: Save };

const cache = new Map();
/** Returns an inline SVG string. Unknown names fall back to a generic file icon. */
export function icon(name, size = 18, cls = '') {
  const key = `${name}|${size}|${cls}`;
  if (cache.has(key)) return cache.get(key);
  const node = MAP[name] || File;
  const el = createElement(node, { width: size, height: size, 'stroke-width': 1.75, 'aria-hidden': 'true', focusable: 'false', class: `ic ${cls}`.trim() });
  const s = el.outerHTML; cache.set(key, s); return s;
}
// Resource file types → icon
export const TYPE_ICON = { pdf: 'file-text', doc: 'file-text', ppt: 'slides', xls: 'sheet', video: 'video', audio: 'audio', image: 'image', epub: 'book-open', text: 'file-text', link: 'link', other: 'file' };
