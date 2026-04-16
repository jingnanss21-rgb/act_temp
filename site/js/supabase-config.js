/**
 * supabase-config.js - Supabase 连接配置
 */
const SUPABASE_URL = 'https://wiyarxoivfmkneumfmbl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndpeWFyeG9pdmZta25ldW1mbWJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzOTExMDYsImV4cCI6MjA5MDk2NzEwNn0.jo1GoR3ZuFv2HFZcVoOKpVb19SBUIHZL3EoR266njU4';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
