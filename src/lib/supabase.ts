import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { SysUser } from '../types';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  }
);

export async function signInWithSupabaseEmail(email: string, password: string): Promise<SysUser> {
  if (!isSupabaseConfigured) {
    throw new Error('Chưa cấu hình VITE_SUPABASE_URL hoặc VITE_SUPABASE_ANON_KEY trong biến môi trường.');
  }
  const cleanEmail = email.trim().toLowerCase();
  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email: cleanEmail,
    password,
  });
  if (authErr || !authData.user) {
    throw new Error(authErr?.message || 'Email hoặc mật khẩu Supabase Auth không chính xác.');
  }

  const userProfile = await fetchSysUserByEmail(cleanEmail);
  if (!userProfile) {
    await supabase.auth.signOut();
    throw new Error(`Tài khoản "${cleanEmail}" chưa được khai báo trong bảng sys_users.`);
  }
  const st = String(userProfile.status || '').trim().toLowerCase();
  if (st.includes('khóa') || st.includes('inactive') || st.includes('disabled') || st.includes('ngưng')) {
    await supabase.auth.signOut();
    throw new Error('Tài khoản đang bị tạm khóa trong bảng sys_users.');
  }
  return userProfile;
}

export async function fetchSysUserByEmail(email: string): Promise<SysUser | null> {
  if (!isSupabaseConfigured) return null;
  const cleanEmail = email.trim().toLowerCase();
  const { data, error } = await supabase
    .from('sys_users')
    .select('employee_id, full_name, department, role, email, status')
    .ilike('email', cleanEmail)
    .limit(1);

  if (error) {
    throw new Error(`Lỗi truy vấn sys_users: ${error.message}`);
  }
  if (!data || data.length === 0) return null;
  return data[0] as SysUser;
}

export async function restoreSupabaseUserSession(): Promise<SysUser | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await supabase.auth.getSession();
  const email = data?.session?.user?.email;
  if (!email) return null;
  try {
    return await fetchSysUserByEmail(email);
  } catch {
    return null;
  }
}

export async function signOutSupabase(): Promise<void> {
  if (!isSupabaseConfigured) return;
  await supabase.auth.signOut();
}
