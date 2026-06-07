import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

export const SUPABASE_URL = "https://umxpfhudmrqcwpeuveuq.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVteHBmaHVkbXJxY3dwZXV2ZXVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjA3OTgsImV4cCI6MjA4OTMzNjc5OH0.D1shdzANYXiZVDufQ9cm2LaAMCcVOKIoZ7GadJoaUwI";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});