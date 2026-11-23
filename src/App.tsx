import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminProvisionAuthCredential, restoreSupabaseUserSession, signOutSupabase } from './lib/supabase';
import {
  advanceContractMilestone,
  confirmBuyerSignedContract,
  createOrOverwriteContractDraft,
  deleteConsigneeDirect,
  deletePreContractOrder,
  deletePricingRateDirect,
  deleteProductDirect,
  deleteScheduleDirect,
  fetchAllAppData,
  readOrderLogisticsMetaMap,
  readProposalExtraMetaMap,
  saveInquiryRecord,
  saveOrderLogisticsMeta,
  savePricingProposalRecord,
  saveProposalExtraMeta,
  sendContractToSalesForSigning,
  updateOrderMasterRecord,
  updateQuotationWorkflow,
  upsertConsigneeDirect,
  upsertPricingRateDirect,
  upsertProductDirect,
  upsertScheduleDirect,
  upsertSysUserDirect,
  upsertTemplateDirect,
} from './services/supabaseService';
import type {
  AppDataState,
  OrderLogisticsMeta,
  ProposalExtraMeta,
  RoleType,
  SysUser,
  ToastMessage,
  ViewId,
} from './types';
import { isQuickCaptureStatus, isWaitingPricingStatus, normalizeRole, WORKFLOW_STATUS } from './utils/calculations';
import { LoginScreen } from './components/LoginScreen';
import { NAV_GROUPS, Sidebar, TopHeader } from './components/SidebarHeader';
import { DashboardView } from './components/DashboardView';
import { SalesCrmView } from './components/SalesCrmView';
import { XnkCostingView } from './components/XnkCostingView';
import { XnkContractsView } from './components/XnkContractsView';
import { MasterDataView } from './components/MasterDataView';
import {
  ConfirmDialog,
  DocumentPreviewModal,
  OrderTimelineModal,
  PreviewModalTarget,
} from './components/Modals';

const EMPTY_DATA: AppDataState = {
  users: [],
  consignees: [],
  products: [],
  pricingRates: [],
  schedules: [],
  incoterms: [],
  lookups: [],
  templates: [],
  templatePlaceholders: [],
  inquiries: [],
  proposals: [],
  orders: [],
};

export const App: React.FC = () => {
  const [authChecking, setAuthChecking] = useState(true);
  const [currentUser, setCurrentUser] = useState<SysUser | null>(null);
  const [data, setData] = useState<AppDataState>(EMPTY_DATA);
  const [orderMetaMap, setOrderMetaMap] = useState<Record<string, OrderLogisticsMeta>>(() => readOrderLogisticsMetaMap());
  const [proposalMetaMap, setProposalMetaMap] = useState<Record<string, ProposalExtraMeta>>(() => readProposalExtraMetaMap());

  const [activeView, setActiveView] = useState<ViewId>('dashboard');
  const prevViewRef = useRef<ViewId | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | undefined>(undefined);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('nsx_sidebar_collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [quickSearch, setQuickSearch] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState('');

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [previewTarget, setPreviewTarget] = useState<PreviewModalTarget | null>(null);
  const [timelineOrderId, setTimelineOrderId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    message: string;
    danger?: boolean;
    onConfirm: () => Promise<void>;
  } | null>(null);

  const pushToast = useCallback((type: ToastMessage['type'], title: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, type, title }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  const syncData = useCallback(async (opts?: { silent?: boolean }) => {
    setIsSyncing(true);
    try {
      const fresh = await fetchAllAppData();
      setData(fresh);
      setOrderMetaMap(readOrderLogisticsMetaMap());
      setProposalMetaMap(readProposalExtraMetaMap());
      const now = new Date();
      setLastSyncedAt(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
      if (!opts?.silent) pushToast('success', 'Đã đồng bộ dữ liệu từ Supabase.');
    } catch (err: any) {
      if (!opts?.silent) pushToast('error', err?.message || 'Lỗi tải dữ liệu.');
    } finally {
      setIsSyncing(false);
    }
  }, [pushToast]);

  useEffect(() => {
    let active = true;
    (async () => {
      const user = await restoreSupabaseUserSession();
      if (!active) return;
      setCurrentUser(user);
      setAuthChecking(false);
      if (user) {
        await syncData({ silent: true });
      }
    })();
    return () => {
      active = false;
    };
  }, [syncData]);

  const role = useMemo(() => normalizeRole(currentUser?.role, currentUser?.department), [currentUser]);

  const canAccessView = useCallback((r: RoleType, view: ViewId): boolean => {
    if (r === 'ADMIN') return true;
    const item = NAV_GROUPS.flatMap((g) => g.items).find((it) => it.id === view);
    return item ? item.roles.includes(r) : view === 'dashboard';
  }, []);

  useEffect(() => {
    if (currentUser && !canAccessView(role, activeView)) {
      setActiveView('dashboard');
    }
  }, [currentUser, role, activeView, canAccessView]);

  // Silent auto-reload ONLY when navigating back to Dashboard from another screen
  const handleNavigate = useCallback(
    (nextView: ViewId, highlightId?: string) => {
      if (!canAccessView(role, nextView)) {
        setActiveView('dashboard');
        return;
      }
      const prev = prevViewRef.current;
      prevViewRef.current = activeView;
      setActiveView(nextView);
      setHighlightedId(highlightId);
      if (nextView === 'dashboard' && prev !== 'dashboard') {
        void syncData({ silent: true });
      }
    },
    [activeView, canAccessView, role, syncData]
  );

  const pendingQuickLogCount = useMemo(() => {
    return data.inquiries.filter((i) => isQuickCaptureStatus(i.inquiry_status)).length;
  }, [data.inquiries]);

  const pendingPricingCount = useMemo(() => {
    return data.inquiries.filter((i) => isWaitingPricingStatus(i.inquiry_status)).length;
  }, [data.inquiries]);

  const pendingSignCount = useMemo(() => {
    return data.orders.filter((o) => {
      const meta = orderMetaMap[o.order_id];
      const st = String(o.fulfillment_status || '').toLowerCase();
      return !meta?.is_locked && (meta?.sent_to_sales || st.includes('chờ sales'));
    }).length;
  }, [data.orders, orderMetaMap]);

  if (authChecking) {
    return (
      <div className="login-emerald-bg flex items-center justify-center text-[#fff5d6] text-sm font-bold">
        Đang kiểm tra phiên đăng nhập Supabase...
      </div>
    );
  }

  if (!currentUser) {
    return (
      <LoginScreen
        onLoginSuccess={async (user) => {
          setCurrentUser(user);
          setActiveView('dashboard');
          await syncData({ silent: true });
        }}
      />
    );
  }

  return (
    <div className="workspace-shell flex min-h-screen">
      <Sidebar
        currentUser={currentUser}
        role={role}
        activeView={activeView}
        collapsed={sidebarCollapsed}
        pendingQuickLogCount={pendingQuickLogCount}
        pendingPricingCount={pendingPricingCount}
        pendingSignCount={pendingSignCount}
        onToggleCollapse={() => {
          const next = !sidebarCollapsed;
          setSidebarCollapsed(next);
          try {
            localStorage.setItem('nsx_sidebar_collapsed', next ? '1' : '0');
          } catch {}
        }}
        onNavigate={(v) => handleNavigate(v)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopHeader
          currentUser={currentUser}
          activeView={activeView}
          quickSearch={quickSearch}
          lastSyncedAt={lastSyncedAt}
          isSyncing={isSyncing}
          onQuickSearchChange={setQuickSearch}
          onManualRefresh={() => syncData({ silent: false })}
          onLogout={async () => {
            await signOutSupabase();
            setCurrentUser(null);
            setData(EMPTY_DATA);
          }}
        />

        <main className="flex-1 p-4 sm:p-5">
          {activeView === 'dashboard' && (
            <DashboardView
              data={data}
              role={role}
              orderMetaMap={orderMetaMap}
              proposalMetaMap={proposalMetaMap}
              onNavigate={handleNavigate}
              onOpenTimeline={setTimelineOrderId}
            />
          )}

          {(activeView === 'sales-inquiry' ||
            activeView === 'sales-quotation' ||
            activeView === 'sales-contracts' ||
            activeView === 'sales-customers') && (
            <SalesCrmView
              activeView={activeView}
              data={data}
              currentUser={currentUser}
              quickSearch={quickSearch}
              orderMetaMap={orderMetaMap}
              proposalMetaMap={proposalMetaMap}
              onSaveInquiry={async (params) => {
                await saveInquiryRecord(data, params);
                await syncData({ silent: true });
              }}
              onDeletePreContract={async (orderId) => {
                await deletePreContractOrder(data, orderId);
                pushToast('success', `Đã hủy và xóa đơn ${orderId}.`);
                await syncData({ silent: true });
              }}
              onConfirmOrder={async (orderId) => {
                await updateQuotationWorkflow(orderId, { inquiry_status: WORKFLOW_STATUS.CONFIRMED_ORDER });
                pushToast('success', `Đã chốt đơn ${orderId} chuyển sang XNK lập Hợp đồng.`);
                await syncData({ silent: true });
              }}
              onRequestReprice={async (orderId, reason) => {
                const inq = data.inquiries.find((i) => i.order_id === orderId);
                await updateQuotationWorkflow(orderId, {
                  inquiry_status: WORKFLOW_STATUS.REPRICE_REQUESTED,
                  note: `${inq?.note ? inq.note + ' | ' : ''}[Tính lại]: ${reason}`,
                });
                pushToast('info', `Đã gửi yêu cầu tính lại đơn ${orderId} cho XNK.`);
                await syncData({ silent: true });
              }}
              onConfirmSignedContract={async (orderId) => {
                const ord = data.orders.find((o) => o.order_id === orderId);
                if (!ord) return;
                await confirmBuyerSignedContract(ord);
                pushToast('success', `Hợp đồng ${ord.contract_no} đã xác nhận khách ký · Chuyển Mốc 3/6.`);
                await syncData({ silent: true });
              }}
              onUpsertConsignee={async (row, isEdit) => {
                await upsertConsigneeDirect(row, isEdit);
                pushToast('success', 'Đã lưu thông tin khách hàng.');
                await syncData({ silent: true });
              }}
              onDeleteConsignee={async (cid) => {
                await deleteConsigneeDirect(cid);
                pushToast('success', 'Đã xóa khách hàng.');
                await syncData({ silent: true });
              }}
              onOpenPreview={setPreviewTarget}
              onOpenTimeline={setTimelineOrderId}
              onRequestConfirm={(title, message, onConfirm, danger) =>
                setConfirmState({ open: true, title, message, onConfirm, danger })
              }
              onToast={pushToast}
            />
          )}

          {activeView === 'xnk-pricing' && (
            <XnkCostingView
              data={data}
              currentUser={currentUser}
              proposalMetaMap={proposalMetaMap}
              onSaveProposal={async (proposal, extraMeta, itemsJson) => {
                await savePricingProposalRecord(data, proposal, extraMeta, itemsJson);
                pushToast('success', `Đã lưu phương án giá ${extraMeta.quotation_no} và gửi Sales.`);
                await syncData({ silent: true });
              }}
              onOpenTimeline={setTimelineOrderId}
              onToast={pushToast}
            />
          )}

          {(activeView === 'xnk-contract' || activeView === 'xnk-documents') && (
            <XnkContractsView
              activeView={activeView}
              data={data}
              currentUser={currentUser}
              quickSearch={quickSearch}
              highlightedOrderId={highlightedId}
              orderMetaMap={orderMetaMap}
              onCreateContractDraft={async (orderId) => {
                const ord = await createOrOverwriteContractDraft(data, orderId, currentUser.full_name);
                pushToast('success', `Đã khởi tạo Hợp đồng ${ord.contract_no}.`);
                await syncData({ silent: true });
              }}
              onUpdateContractAndMeta={async (order, metaPatch) => {
                await updateOrderMasterRecord(order, metaPatch);
                pushToast('success', `Đã cập nhật Hợp đồng ${order.contract_no} & Cut-offs.`);
                await syncData({ silent: true });
              }}
              onSendContractToSales={async (order) => {
                await sendContractToSalesForSigning(order);
                pushToast('success', `Đã gửi ${order.contract_no} sang Sales đưa khách ký.`);
                await syncData({ silent: true });
              }}
              onAdvanceMilestone={async (order, nextStatus) => {
                await advanceContractMilestone(order, nextStatus);
                pushToast('success', `Đã chuyển ${order.contract_no} sang ${nextStatus}.`);
                await syncData({ silent: true });
              }}
              onOpenPreview={setPreviewTarget}
              onOpenTimeline={setTimelineOrderId}
              onRequestConfirm={(title, message, onConfirm, danger) =>
                setConfirmState({ open: true, title, message, onConfirm, danger })
              }
              onToast={pushToast}
            />
          )}

          {(activeView === 'master-products' ||
            activeView === 'xnk-shipping' ||
            activeView === 'xnk-rates' ||
            activeView === 'admin-templates' ||
            activeView === 'admin-users') && (
            <MasterDataView
              activeView={activeView}
              data={data}
              quickSearch={quickSearch}
              highlightedId={highlightedId}
              onUpsertProduct={async (row, isEdit) => {
                await upsertProductDirect(row, isEdit);
                pushToast('success', 'Đã lưu sản phẩm.');
                await syncData({ silent: true });
              }}
              onDeleteProduct={async (sku) => {
                await deleteProductDirect(sku);
                pushToast('success', `Đã xóa ${sku}.`);
                await syncData({ silent: true });
              }}
              onUpsertSchedule={async (row, isEdit) => {
                await upsertScheduleDirect(row, isEdit);
                pushToast('success', 'Đã lưu lịch tàu.');
                await syncData({ silent: true });
              }}
              onDeleteSchedule={async (sid) => {
                await deleteScheduleDirect(sid);
                pushToast('success', `Đã xóa ${sid}.`);
                await syncData({ silent: true });
              }}
              onUpsertRate={async (row, isEdit) => {
                await upsertPricingRateDirect(row, isEdit);
                pushToast('success', 'Đã lưu biểu phí.');
                await syncData({ silent: true });
              }}
              onDeleteRate={async (code) => {
                await deletePricingRateDirect(code);
                pushToast('success', `Đã xóa ${code}.`);
                await syncData({ silent: true });
              }}
              onUpsertTemplate={async (row, isEdit) => {
                await upsertTemplateDirect(row, isEdit);
                pushToast('success', 'Đã lưu phôi mẫu.');
                await syncData({ silent: true });
              }}
              onRefreshData={async () => {
                await syncData({ silent: true });
              }}
              onUpsertUser={async (row, isEdit, initialPassword) => {
                if (!isEdit && initialPassword) {
                  await adminProvisionAuthCredential({
                    email: row.email,
                    password: initialPassword,
                    fullName: row.full_name,
                    department: row.department,
                  });
                }
                await upsertSysUserDirect(row, isEdit);
                pushToast('success', 'Đã lưu thông tin nhân sự.');
                await syncData({ silent: true });
              }}
              onRequestConfirm={(title, message, onConfirm, danger) =>
                setConfirmState({ open: true, title, message, onConfirm, danger })
              }
              onToast={pushToast}
            />
          )}
        </main>
      </div>

      {/* Modals */}
      <DocumentPreviewModal
        target={previewTarget}
        data={data}
        orderMetaMap={orderMetaMap}
        proposalMetaMap={proposalMetaMap}
        allowQuickAdjust={role === 'SALES' || role === 'ADMIN'}
        onClose={() => setPreviewTarget(null)}
        onConfirmQuickAdjust={async (orderId, newInc, newPrice, tplMode) => {
          await updateQuotationWorkflow(
            orderId,
            { quotation_mode: tplMode === 'COMPARISON' ? 'COMPARISON' : 'SINGLE' },
            { recommended_incoterm: newInc, final_selling_price: newPrice }
          );
          pushToast('success', `Đã lưu điều chỉnh ${newInc} · $${newPrice.toFixed(2)}.`);
          await syncData({ silent: true });
        }}
        onMarkQuotationSent={async (orderId, linkOrSubject) => {
          await updateQuotationWorkflow(orderId, {
            inquiry_status: WORKFLOW_STATUS.SENT_WAITING_CUST,
            sent_mail_link: linkOrSubject,
          });
          pushToast('success', 'Đã đánh dấu Đã gửi Báo giá cho Khách.');
          await syncData({ silent: true });
        }}
        onDocumentSaved={async () => {
          await syncData({ silent: true });
        }}
        onRequestRepriceFromModal={async (orderId, reason) => {
          const inq = data.inquiries.find((i) => i.order_id === orderId);
          await updateQuotationWorkflow(orderId, {
            inquiry_status: WORKFLOW_STATUS.REPRICE_REQUESTED,
            note: `${inq?.note ? inq.note + ' | ' : ''}[Dưới sàn]: ${reason}`,
          });
          pushToast('info', 'Đã gửi yêu cầu XNK tính giá lại.');
          await syncData({ silent: true });
        }}
        onToast={pushToast}
      />

      <OrderTimelineModal
        orderId={timelineOrderId}
        data={data}
        orderMetaMap={orderMetaMap}
        proposalMetaMap={proposalMetaMap}
        onClose={() => setTimelineOrderId(null)}
      />

      {confirmState && (
        <ConfirmDialog
          open={confirmState.open}
          title={confirmState.title}
          message={confirmState.message}
          danger={confirmState.danger}
          onCancel={() => setConfirmState(null)}
          onConfirm={async () => {
            const fn = confirmState.onConfirm;
            setConfirmState(null);
            try {
              await fn();
            } catch (err: any) {
              pushToast('error', err?.message || 'Thao tác thất bại.');
            }
          }}
        />
      )}

      {/* Toast Stack */}
      <div className="fixed bottom-4 right-4 z-[70] space-y-2 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-4 py-2.5 rounded-xl border-2 shadow-lg text-xs font-bold text-white ${
              t.type === 'error'
                ? 'bg-[#8c3b3b] border-[#6e2b2b]'
                : t.type === 'warning'
                ? 'bg-[#9a6e1f] border-[#f4d98a]'
                : t.type === 'info'
                ? 'bg-[#16977f] border-[#0f4a33]'
                : 'bg-[#0f4a33] border-[#f4d98a]'
            }`}
          >
            {t.title}
          </div>
        ))}
      </div>
    </div>
  );
};

export default App;
