import React from 'react';
import {
  LayoutDashboard,
  FilePlus2,
  FileSpreadsheet,
  FileSignature,
  Calculator,
  FileCheck2,
  FolderOpen,
  Users,
  Package,
  Ship,
  Receipt,
  FileCode2,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  LogOut,
  Search,
  Sprout,
} from 'lucide-react';
import type { RoleType, SysUser, ViewId } from '../types';
import { translateDepartment } from '../utils/calculations';

interface NavGroup {
  title: string;
  items: Array<{
    id: ViewId;
    label: string;
    icon: React.FC<{ className?: string }>;
    roles: RoleType[];
  }>;
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Khu vực chung',
    items: [{ id: 'dashboard', label: 'Trang tổng quan', icon: LayoutDashboard, roles: ['SALES', 'XNK', 'ADMIN'] }],
  },
  {
    title: 'Phòng Kinh doanh',
    items: [
      { id: 'sales-inquiry', label: 'Danh sách tính giá', icon: FilePlus2, roles: ['SALES', 'ADMIN'] },
      { id: 'sales-quotation', label: 'Quản lý Báo giá', icon: FileSpreadsheet, roles: ['SALES', 'ADMIN'] },
      { id: 'sales-contracts', label: 'Hợp đồng chờ ký', icon: FileSignature, roles: ['SALES', 'ADMIN'] },
    ],
  },
  {
    title: 'XNK & Logistics',
    items: [
      { id: 'xnk-pricing', label: 'Bảng tính giá', icon: Calculator, roles: ['XNK', 'ADMIN'] },
      { id: 'xnk-contract', label: 'Hợp đồng Ngoại thương', icon: FileCheck2, roles: ['XNK', 'ADMIN'] },
      { id: 'xnk-documents', label: 'Bộ chứng từ Xuất khẩu', icon: FolderOpen, roles: ['XNK', 'ADMIN'] },
    ],
  },
  {
    title: 'DANH MỤC',
    items: [
      { id: 'sales-customers', label: 'Danh sách Khách hàng', icon: Users, roles: ['SALES', 'XNK', 'ADMIN'] },
      { id: 'master-products', label: 'Danh mục Sản phẩm', icon: Package, roles: ['SALES', 'XNK', 'ADMIN'] },
      { id: 'xnk-shipping', label: 'Lịch tàu & Cước vận chuyển', icon: Ship, roles: ['XNK', 'ADMIN'] },
      { id: 'xnk-rates', label: 'Bảng giá Phụ phí', icon: Receipt, roles: ['XNK', 'ADMIN'] },
      { id: 'admin-templates', label: 'Quản lý Phôi mẫu', icon: FileCode2, roles: ['XNK', 'ADMIN'] },
    ],
  },
  {
    title: 'Quản trị hệ thống',
    items: [{ id: 'admin-users', label: 'Tài khoản & Phân quyền', icon: ShieldCheck, roles: ['ADMIN'] }],
  },
];

const VIEW_TITLES: Record<ViewId, string> = {
  dashboard: 'Trang tổng quan Điều hành Xuất khẩu',
  'sales-inquiry': 'Danh sách Yêu cầu Tính giá (Inquiry & RFQ)',
  'sales-quotation': 'Quản lý Báo giá Khách hàng',
  'sales-contracts': 'Hợp đồng Chờ Ký & Xác nhận Khách',
  'sales-customers': 'Danh sách Khách hàng Quốc tế',
  'xnk-pricing': 'Bảng Tính giá XNK · FCL/LCL & Incoterms 2020',
  'xnk-contract': 'Quản lý Hợp đồng Ngoại thương',
  'xnk-documents': 'Bộ chứng từ Xuất khẩu (Docs Hub)',
  'xnk-shipping': 'Lịch tàu & Cước vận chuyển Đường biển',
  'xnk-rates': 'Bảng giá Phụ phí, Bao bì, Bảo hiểm & Container',
  'master-products': 'Danh mục Sản phẩm Nông sản Xuất khẩu',
  'admin-templates': 'Quản lý Phôi mẫu Chứng từ',
  'admin-users': 'Tài khoản & Phân quyền Nhân sự',
};

interface SidebarProps {
  currentUser: SysUser;
  role: RoleType;
  activeView: ViewId;
  collapsed: boolean;
  pendingQuickLogCount: number;
  pendingPricingCount: number;
  pendingSignCount: number;
  onToggleCollapse: () => void;
  onNavigate: (view: ViewId) => void;
}

export const COMPANY_LOGO_URL =
  'https://cqxchzwksyfwguzavqbz.supabase.co/storage/v1/object/public/images/logo-icon.png';

export const Sidebar: React.FC<SidebarProps> = ({
  currentUser,
  role,
  activeView,
  collapsed,
  pendingQuickLogCount,
  pendingPricingCount,
  pendingSignCount,
  onToggleCollapse,
  onNavigate,
}) => {
  const [logoError, setLogoError] = React.useState(false);
  const initials = (currentUser.full_name || 'NS')
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  return (
    <aside className={`app-sidebar h-screen flex flex-col overflow-hidden shrink-0 select-none ${collapsed ? 'is-collapsed' : ''}`}>
      <div
        className={`logo shrink-0 border-b border-[#186635] flex items-center ${
          collapsed ? 'flex-col gap-2 px-2 py-3' : 'justify-between gap-2.5 px-3.5 py-3.5'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-9 h-9 rounded-full bg-[#f6f3e3] border-2 border-[#f4d98a] p-0.5 flex items-center justify-center shrink-0 shadow overflow-hidden">
            {!logoError ? (
              <img
                src={COMPANY_LOGO_URL}
                alt="GREEN AGRI-EXPORTS"
                onError={() => setLogoError(true)}
                className="w-full h-full rounded-full object-contain"
              />
            ) : (
              <Sprout className="w-5 h-5 text-[#0f4a33]" />
            )}
          </div>
          <div className="sidebar-hide-collapsed min-w-0 flex-1 pr-3">
            <div className="text-[11px] font-extrabold text-[#fff5d6] tracking-normal whitespace-nowrap">
              GREEN AGRI-EXPORTS
            </div>
            <div className="text-[10.5px] text-[#9bccb8] whitespace-nowrap truncate">Nông Sản Xanh · ERP</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleCollapse}
          title={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'}
          className="p-1.5 ml-1 rounded-lg text-[#f4d98a] hover:bg-white/10 shrink-0 cursor-pointer"
        >
          {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2.5 space-y-4">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter((it) => role === 'ADMIN' || it.roles.includes(role));
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.title}>
              <div className="sidebar-hide-collapsed px-2.5 mb-1.5 text-[10px] font-extrabold uppercase tracking-wider text-[#f4d98a]/80">
                {group.title}
              </div>
              <div className="space-y-1">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const active = activeView === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      title={item.label}
                      onClick={() => onNavigate(item.id)}
                      className={`nav-item ${active ? 'is-active' : ''}`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="sidebar-hide-collapsed flex-1 truncate">{item.label}</span>
                      {item.id === 'sales-inquiry' && pendingQuickLogCount > 0 && (
                        <em className="not-italic sidebar-hide-collapsed px-1.5 py-0.5 rounded-full bg-[#f4d98a] text-[#07281c] text-[10px] font-extrabold leading-none shrink-0">
                          {pendingQuickLogCount}
                        </em>
                      )}
                      {item.id === 'xnk-pricing' && pendingPricingCount > 0 && (
                        <em className="not-italic sidebar-hide-collapsed px-1.5 py-0.5 rounded-full bg-[#f4d98a] text-[#07281c] text-[10px] font-extrabold leading-none shrink-0">
                          {pendingPricingCount}
                        </em>
                      )}
                      {item.id === 'sales-contracts' && pendingSignCount > 0 && (
                        <em className="not-italic sidebar-hide-collapsed px-1.5 py-0.5 rounded-full bg-[#f4d98a] text-[#07281c] text-[10px] font-extrabold leading-none shrink-0">
                          {pendingSignCount}
                        </em>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div
        className={`me shrink-0 border-t border-[#186635] bg-[#07281c]/75 flex items-center gap-2.5 ${
          collapsed ? 'justify-center px-2 py-2.5' : 'px-3.5 py-2.5'
        }`}
        title={`${currentUser.full_name} · ${translateDepartment(currentUser.department)}`}
      >
        <div className="w-8 h-8 rounded-full bg-[#16977f] border border-[#f4d98a] text-[#fff5d6] text-xs font-extrabold flex items-center justify-center shrink-0">
          {initials || 'NS'}
        </div>
        <div className="sidebar-hide-collapsed min-w-0 flex-1 leading-tight">
          <div className="text-xs font-bold text-[#fff5d6] truncate">{currentUser.full_name}</div>
          <div className="text-[10px] text-[#f4d98a] font-semibold truncate">
            {translateDepartment(currentUser.department)} · {currentUser.role || 'Staff'}
          </div>
        </div>
      </div>
    </aside>
  );
};

interface HeaderProps {
  currentUser: SysUser;
  activeView: ViewId;
  quickSearch: string;
  lastSyncedAt: string;
  isSyncing: boolean;
  onQuickSearchChange: (val: string) => void;
  onManualRefresh: () => void;
  onLogout: () => void;
}

export const TopHeader: React.FC<HeaderProps> = ({
  currentUser,
  activeView,
  quickSearch,
  lastSyncedAt,
  isSyncing,
  onQuickSearchChange,
  onManualRefresh,
  onLogout,
}) => {
  return (
    <header className="sticky top-0 z-30 sticky-header-bar px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="whitespace-nowrap">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-[#0f4a33]">
            GREEN AGRI-EXPORTS · Hệ thống Xuất khẩu
          </div>
          <h2 className="text-sm sm:text-base font-extrabold text-[#07281c] truncate">
            {VIEW_TITLES[activeView]}
          </h2>
        </div>
      </div>

      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="relative w-52 sm:w-64">
          <Search className="w-3.5 h-3.5 text-[#0f4a33] absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={quickSearch}
            onChange={(e) => onQuickSearchChange(e.target.value)}
            placeholder="Tìm nhanh mã đơn, HĐ, khách..."
            className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg border-[1.5px] border-[#186635] bg-[#d7eee4] text-[#0b2418] placeholder-[#1e4231]/65 focus:bg-white outline-none"
          />
        </div>

        <button
          type="button"
          onClick={onManualRefresh}
          disabled={isSyncing}
          className="px-2.5 py-1.5 rounded-lg bg-[#0f4a33] hover:bg-[#07281c] text-[#fff5d6] border border-[#186635] text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          <span>{lastSyncedAt ? `Đồng bộ ${lastSyncedAt}` : 'Làm mới'}</span>
        </button>

        <div className="flex items-center gap-2 bg-[#547d59] text-[#fff5d6] border-[1.5px] border-[#186635] rounded-xl px-3 py-1 whitespace-nowrap">
          <div className="text-right leading-tight">
            <div className="text-xs font-bold">{currentUser.full_name}</div>
            <div className="text-[10px] text-[#f4d98a] font-semibold">
              {translateDepartment(currentUser.department)} · {currentUser.role || 'Staff'}
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            title="Đăng xuất"
            className="p-1.5 rounded-lg bg-[#07281c]/50 hover:bg-[#8c3b3b] text-[#fff5d6] transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
};
