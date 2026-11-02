import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';
import { ssoAuth } from './sso.js';

// PKCE keeps OAuth / e-mail-link tokens out of the URL hash, which the hash router owns.
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, ...ssoAuth },
});
