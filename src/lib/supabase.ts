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

function assertActiveUserStatus(userProfile: SysUser): void {
  const st = String(userProfile.status || '').trim().toLowerCase();
  if (st === 'pending' || st.includes('chờ duyệt') || st.includes('chờ phê duyệt')) {
    throw new Error('Tài khoản đang chờ Quản trị viên phê duyệt.');
  }
  if (st.includes('khóa') || st.includes('inactive') || st.includes('disabled') || st.includes('ngưng')) {
    throw new Error('Tài khoản đang bị tạm khóa.');
  }
}

export async function resolveLoginEmail(identifier: string): Promise<string> {
  if (!isSupabaseConfigured) {
    throw new Error('Chưa cấu hình VITE_SUPABASE_URL hoặc VITE_SUPABASE_ANON_KEY trong biến môi trường.');
  }
  const clean = identifier.trim();
  if (!clean) {
    throw new Error('Vui lòng nhập Email, Họ tên hoặc Mã nhân viên.');
  }
  if (clean.includes('@')) {
    return clean.toLowerCase();
  }

  try {
    const { data: rpcData, error: rpcErr } = await supabase.rpc('resolve_login_email', {
      p_identifier: clean,
    });
    if (!rpcErr && rpcData) {
      if (typeof rpcData === 'string' && rpcData.trim()) {
        return rpcData.trim().toLowerCase();
      }
      if (Array.isArray(rpcData) && rpcData[0]?.email) {
        return String(rpcData[0].email).trim().toLowerCase();
      }
      if (typeof rpcData === 'object' && (rpcData as any).email) {
        return String((rpcData as any).email).trim().toLowerCase();
      }
    }
  } catch {
    // Fallback to direct case-insensitive lookup on public.sys_users
  }

  const byEmp = await supabase
    .from('sys_users')
    .select('email')
    .ilike('employee_id', clean)
    .limit(1);
  if (!byEmp.error && byEmp.data && byEmp.data.length > 0 && byEmp.data[0]?.email) {
    return String(byEmp.data[0].email).trim().toLowerCase();
  }

  const byName = await supabase
    .from('sys_users')
    .select('email')
    .ilike('full_name', clean)
    .limit(1);
  if (!byName.error && byName.data && byName.data.length > 0 && byName.data[0]?.email) {
    return String(byName.data[0].email).trim().toLowerCase();
  }

  throw new Error('Tên đăng nhập hoặc Mã nhân viên không tồn tại.');
}

export async function signInWithSupabaseEmail(identifier: string, password: string): Promise<SysUser> {
  if (!isSupabaseConfigured) {
    throw new Error('Chưa cấu hình VITE_SUPABASE_URL hoặc VITE_SUPABASE_ANON_KEY trong biến môi trường.');
  }
  const resolvedEmail = await resolveLoginEmail(identifier);
  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email: resolvedEmail,
    password,
  });
  if (authErr || !authData.user) {
    throw new Error(authErr?.message || 'Email/Tên đăng nhập hoặc mật khẩu không chính xác.');
  }

  const userProfile = await fetchSysUserByEmail(resolvedEmail);
  if (!userProfile) {
    await supabase.auth.signOut();
    throw new Error(`Tài khoản "${resolvedEmail}" chưa được khai báo trong bảng sys_users.`);
  }
  try {
    assertActiveUserStatus(userProfile);
  } catch (err) {
    await supabase.auth.signOut();
    throw err;
  }
  return userProfile;
}

export async function registerWithSupabaseEmail(params: {
  fullName: string;
  email: string;
  password: string;
  department: 'SALES' | 'XNK';
}): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error('Chưa cấu hình VITE_SUPABASE_URL hoặc VITE_SUPABASE_ANON_KEY trong biến môi trường.');
  }
  const cleanEmail = params.email.trim().toLowerCase();
  const cleanName = params.fullName.trim();
  // Strictly lock Admin role creation from client-side registration
  const safeDept: 'SALES' | 'XNK' = params.department === 'XNK' ? 'XNK' : 'SALES';
  const safeRole: 'Sale' | 'XNK' = safeDept === 'XNK' ? 'XNK' : 'Sale';

  const existing = await fetchSysUserByEmail(cleanEmail);
  if (existing) {
    throw new Error(`Email "${cleanEmail}" đã được đăng ký trong hệ thống (${existing.status}).`);
  }

  const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
    email: cleanEmail,
    password: params.password,
    options: {
      data: {
        full_name: cleanName,
        department: safeDept,
        role: safeRole,
      },
    },
  });

  if (signUpErr) {
    throw new Error(signUpErr.message || 'Không thể đăng ký tài khoản.');
  }

  const suffix = String(Date.now()).slice(-4);
  const empId = `EMP-${suffix}`;
  const newUserRow: Omit<SysUser, 'id'> = {
    employee_id: empId,
    full_name: cleanName,
    department: safeDept,
    role: safeRole,
    email: cleanEmail,
    status: 'PENDING',
  };

  const { error: insertErr } = await supabase.from('sys_users').insert(newUserRow);
  if (signUpData.session) {
    await supabase.auth.signOut();
  }
  if (insertErr) {
    throw new Error(`Không thể hoàn tất lưu hồ sơ nhân sự: ${insertErr.message}`);
  }
}

export async function adminProvisionAuthCredential(params: {
  email: string;
  password: string;
  fullName: string;
  department: string;
}): Promise<void> {
  if (!isSupabaseConfigured) return;
  const cleanEmail = params.email.trim().toLowerCase();
  if (!cleanEmail || !params.password) return;

  // Ephemeral client without session persistence so Admin stays logged in
  const ephemeralClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { error } = await ephemeralClient.auth.signUp({
    email: cleanEmail,
    password: params.password,
    options: {
      data: {
        full_name: params.fullName,
        department: params.department,
      },
    },
  });
  if (error && !String(error.message || '').toLowerCase().includes('already registered')) {
    throw new Error(`Lỗi tạo tài khoản đăng nhập cho nhân sự: ${error.message}`);
  }
}

export async function fetchSysUserByEmail(email: string): Promise<SysUser | null> {
  if (!isSupabaseConfigured) return null;
  const cleanEmail = email.trim().toLowerCase();
  const { data, error } = await supabase
    .from('sys_users')
    .select('id, employee_id, full_name, department, role, email, status')
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
    const profile = await fetchSysUserByEmail(email);
    if (!profile) return null;
    assertActiveUserStatus(profile);
    return profile;
  } catch {
    await supabase.auth.signOut();
    return null;
  }
}

export async function signOutSupabase(): Promise<void> {
  if (!isSupabaseConfigured) return;
  await supabase.auth.signOut();
}
