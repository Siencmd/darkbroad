import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const supabaseUrl = 'https://bhjzafenxdalggfucluo.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoanphZmVueGRhbGdnZnVjbHVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzNzU5NTIsImV4cCI6MjA4NTk1MTk1Mn0.--9A_MTKSFhBllDz_KqSwJu3uniXegkKyKbYgqGKk_Q';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
