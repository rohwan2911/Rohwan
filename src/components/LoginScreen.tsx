import React, { useState } from 'react';
import { Lock, Mail, Sprout, AlertTriangle, LogIn } from 'lucide-react';
import { isSupabaseConfigured, signInWithSupabaseEmail } from '../lib/supabase';
import type { SysUser } from '../types';

interface LoginScreenProps {
  onLoginSuccess: (user: SysUser) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Vui lòng nhập đầy đủ Email và Mật khẩu.');
      return;
    }
    setLoading(true);
    try {
      const user = await signInWithSupabaseEmail(email, password);
      onLoginSuccess(user);
    } catch (err: any) {
      setError(err?.message || 'Đăng nhập thất bại.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-emerald-bg flex items-center justify-center p-4">
      <div className="login-glass-card w-full max-w-md rounded-2xl p-7 text-[#f4f8f5]">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-16 h-16 rounded-full bg-white border-2 border-[#f4d98a] flex items-center justify-center shadow-lg mb-3">
            <Sprout className="w-8 h-8 text-[#0f4a33]" />
          </div>
          <h1 className="text-xl font-extrabold tracking-wide text-[#fff5d6]">
            GREEN AGRI-EXPORTS
          </h1>
          <p className="text-xs text-[#d2ebe0] mt-1">
            Hệ thống Quản lý Xuất khẩu Nông sản Xanh
          </p>
        </div>

        {!isSupabaseConfigured && (
          <div className="mb-4 p-3 rounded-xl bg-[#8c3b3b]/90 border border-[#f4d98a] text-xs text-white flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#f4d98a]" />
            <div>
              Chưa phát hiện <code className="font-mono font-bold">VITE_SUPABASE_URL</code> hoặc <code className="font-mono font-bold">VITE_SUPABASE_ANON_KEY</code> trong môi trường. Vui lòng cấu hình biến môi trường trước khi đăng nhập.
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-[#8c3b3b] border border-[#6e2b2b] text-xs font-semibold text-white">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-[#fff5d6] mb-1.5">
              Email nhân sự
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-[#0f4a33] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@greenagri-vn.com"
                className="agri-input pl-9"
                autoComplete="email"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#fff5d6] mb-1.5">
              Mật khẩu
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#0f4a33] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="agri-input pl-9"
                autoComplete="current-password"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full agri-btn-gold py-2.5 flex items-center justify-center gap-2 text-sm disabled:opacity-60"
          >
            <LogIn className="w-4 h-4" />
            <span>{loading ? 'Đang xác thực Supabase...' : 'Đăng nhập Hệ thống'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
