import React, { useState } from 'react';
import { Lock, Mail, Sprout, AlertTriangle, LogIn, UserPlus, User, Building2, CheckCircle2 } from 'lucide-react';
import { isSupabaseConfigured, registerWithSupabaseEmail, signInWithSupabaseEmail } from '../lib/supabase';
import type { SysUser } from '../types';
import { capitalizeWordsPreservingSpaces } from '../utils/calculations';

export const COMPANY_LOGO_URL =
  'https://cqxchzwksyfwguzavqbz.supabase.co/storage/v1/object/public/images/logo-icon.png';

interface LoginScreenProps {
  onLoginSuccess: (user: SysUser) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [department, setDepartment] = useState<'SALES' | 'XNK'>('SALES');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [logoError, setLogoError] = useState(false);

  const switchMode = (nextMode: 'login' | 'register') => {
    setMode(nextMode);
    setError('');
    setSuccessMsg('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (mode === 'login') {
      if (!email.trim() || !password) {
        setError('Vui lòng nhập Email / Tên đăng nhập và Mật khẩu.');
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
      return;
    }

    if (!fullName.trim() || !email.trim() || !password) {
      setError('Vui lòng điền đầy đủ Họ tên, Email và Mật khẩu.');
      return;
    }
    if (password.length < 6) {
      setError('Mật khẩu phải có ít nhất 6 ký tự.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }

    setLoading(true);
    try {
      await registerWithSupabaseEmail({
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        department,
      });
      setPassword('');
      setConfirmPassword('');
      setFullName('');
      setMode('login');
      setSuccessMsg('Đăng ký thành công! Tài khoản đang ở trạng thái PENDING chờ Quản trị viên phê duyệt trước khi đăng nhập.');
    } catch (err: any) {
      setError(err?.message || 'Đăng ký tài khoản thất bại.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-emerald-bg flex items-center justify-center p-4">
      <div className="login-glass-card w-full max-w-md rounded-2xl p-7 text-[#f4f8f5]">
        <div className="flex flex-col items-center text-center mb-5">
          <div className="w-24 h-24 rounded-full bg-[#f6f3e3] border-2 border-[#fde68a] p-1 flex items-center justify-center shadow-lg mb-3 overflow-hidden">
            {!logoError ? (
              <img
                src={COMPANY_LOGO_URL}
                alt="GREEN AGRI-EXPORTS"
                onError={() => setLogoError(true)}
                className="w-full h-full rounded-full object-contain"
              />
            ) : (
              <Sprout className="w-10 h-10 text-[#0f4a33]" />
            )}
          </div>
          <h1 className="text-xl font-extrabold tracking-wide text-[#fff5d6]">
            GREEN AGRI-EXPORTS
          </h1>
          <p className="text-xs text-[#d2ebe0] mt-1">
            Hệ thống Quản lý Xuất khẩu Nông sản Xanh
          </p>
        </div>

        <div className="grid grid-cols-2 gap-1 bg-[#07281c] p-1 rounded-xl border border-[#186635] mb-4">
          <button
            type="button"
            onClick={() => switchMode('login')}
            className={`py-1.5 rounded-lg text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              mode === 'login' ? 'bg-[#f4d98a] text-[#07281c]' : 'text-[#d2ebe0] hover:text-white'
            }`}
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Đăng nhập</span>
          </button>
          <button
            type="button"
            onClick={() => switchMode('register')}
            className={`py-1.5 rounded-lg text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              mode === 'register' ? 'bg-[#f4d98a] text-[#07281c]' : 'text-[#d2ebe0] hover:text-white'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Đăng ký tài khoản</span>
          </button>
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
          <div className="mb-3 px-3 py-2 rounded-xl bg-[#8c3b3b] border border-[#6e2b2b] text-xs font-semibold text-white leading-snug">
            {error}
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 rounded-xl bg-[#0f4a33] border border-[#f4d98a] text-xs font-semibold text-[#fff5d6] flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[#f4d98a]" />
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {mode === 'register' && (
            <>
              <div>
                <label className="block text-xs font-bold text-[#fff5d6] mb-1">
                  Họ và tên nhân sự *
                </label>
                <div className="relative login-input-group">
                  <User className="login-input-icon w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => {
                      const el = e.currentTarget;
                      const start = el.selectionStart;
                      const end = el.selectionEnd;
                      const formatted = capitalizeWordsPreservingSpaces(el.value);
                      setFullName(formatted);
                      if (start !== null && end !== null) {
                        window.requestAnimationFrame(() => {
                          if (document.activeElement === el) {
                            el.setSelectionRange(start, end);
                          }
                        });
                      }
                    }}
                    placeholder="Nguyễn Văn A"
                    className="agri-input pl-9"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#fff5d6] mb-1">
                  Phòng ban đăng ký *
                </label>
                <div className="relative login-input-group">
                  <Building2 className="login-input-icon w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value === 'XNK' ? 'XNK' : 'SALES')}
                    className="agri-input pl-9 font-bold"
                  >
                    <option value="SALES">Phòng Kinh doanh (SALES)</option>
                    <option value="XNK">Phòng Xuất Nhập Khẩu (XNK)</option>
                  </select>
                </div>
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-bold text-[#fff5d6] mb-1">
              {mode === 'login' ? 'Email hoặc Tên đăng nhập *' : 'Email nhân sự *'}
            </label>
            <div className="relative login-input-group">
              <Mail className="login-input-icon w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type={mode === 'login' ? 'text' : 'email'}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={mode === 'login' ? 'Nhập email, họ tên hoặc mã nhân viên...' : 'name@greenagri-vn.com'}
                className="agri-input pl-9"
                autoComplete={mode === 'login' ? 'username' : 'email'}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#fff5d6] mb-1">
              Mật khẩu *
            </label>
            <div className="relative login-input-group">
              <Lock className="login-input-icon w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="agri-input pl-9"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
              />
            </div>
          </div>

          {mode === 'register' && (
            <div>
              <label className="block text-xs font-bold text-[#fff5d6] mb-1">
                Xác nhận mật khẩu *
              </label>
              <div className="relative login-input-group">
                <Lock className="login-input-icon w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="agri-input pl-9"
                  autoComplete="new-password"
                  required
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full agri-btn-gold py-2.5 flex items-center justify-center gap-2 text-sm disabled:opacity-60 mt-1"
          >
            {mode === 'login' ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
            <span>
              {loading
                ? 'Loading...'
                : mode === 'login'
                ? 'Đăng nhập Hệ thống'
                : 'Gửi Yêu cầu Đăng ký'}
            </span>
          </button>
        </form>
      </div>
    </div>
  );
};
