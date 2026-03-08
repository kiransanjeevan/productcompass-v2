import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = "https://ehihqgkkuualltuqwmfz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVoaWhxZ2trdXVhbGx0dXF3bWZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0Nzc2NDksImV4cCI6MjA4NzA1MzY0OX0.qrdeMSOazuboETWCcRRsQ_E-EIRnVFKajSG7qarcNNw";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});