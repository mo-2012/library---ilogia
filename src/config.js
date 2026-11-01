// Only PUBLIC values live here. Authorisation is enforced by Row Level Security + RPCs in Supabase, never by this code.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zugwicbbfbefbbwugfxq.supabase.co';
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_34jNpaqwtFeYboTVgO-mYw_efc0T-Ew';

export const BUCKET = 'library-resources';       // private bucket created by migration 002
export const LEGACY_BUCKET = 'library';           // existing bucket (read only, via get_library_file RPC)
export const MAIN_SITE = 'https://ilogia-eg.com';

export const PAGE_SIZE = 24;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;   // keep in sync with the bucket limit (migration 002)
export const MAX_COVER_BYTES = 2 * 1024 * 1024;
export const SIGNED_URL_TTL = 600;                // seconds, for open/download
export const READER_URL_TTL = 7200;               // seconds, PDF reader keeps requesting ranges while reading
export const COVER_URL_TTL = 3600;
