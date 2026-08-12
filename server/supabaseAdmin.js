import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabaseAdmin = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  try {
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    console.log('✅ Supabase admin client initialized');
  } catch (err) {
    console.warn('⚠️ Failed to initialize Supabase admin client:', err?.message || err);
  }
} else {
  console.warn('⚠️ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set; supabaseAdmin disabled');
}

export default supabaseAdmin;
