import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  adminProvisionAuthCredential,
  deleteTemplateWithStorage,
  restoreSupabaseUserSession,
  signOutSupabase,
} from './lib/supabase';
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
  incrementQuotationSendCount,
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
import { fmtUSD, isQuickCaptureStatus, isWaitingPricingStatus, normalizeRole, WORKFLOW_STATUS } from './utils/calculations';
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

  const patchProposalMeta = useCallback((orderId: string, patch: Partial<ProposalExtraMeta>) => {
    const currentMap = readProposalExtraMetaMap();
    const prev = currentMap[orderId];
    const base: ProposalExtraMeta = {
      order_id: orderId,
      quotation_no: prev?.quotation_no || '',
      floor_price_usd: prev?.floor_price_usd || 0,
      min_margin_pct: prev?.min_margin_pct || 0,
      margin_pct: prev?.margin_pct || 0,
      exw_price: prev?.exw_price || 0,
      fob_price: prev?.fob_price || 0,
      cfr_price: prev?.cfr_price || 0,
      cif_price: prev?.cif_price || 0,
    };
    saveProposalExtraMeta(orderId, {
      ...(prev || base),
      ...patch,
      order_id: orderId,
    });
    setProposalMetaMap(readProposalExtraMetaMap());
  }, []);

  const patchOrderMeta = useCallback((orderId: string, patch: Partial<OrderLogisticsMeta>) => {
    saveOrderLogisticsMeta(orderId, patch);
    setOrderMetaMap(readOrderLogisticsMetaMap());
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
      if (!opts?.silent) pushToast('success', 'Đã đồng bộ dữ liệu.');
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
      const wasDashboard = activeView === 'dashboard';
      prevViewRef.current = activeView;
      setActiveView(nextView);
      setHighlightedId(highlightId);
      if (nextView === 'dashboard' && !wasDashboard) {
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
      <div className="login-emerald-bg flex items-center justify-center gap-2 text-[#fff5d6] text-sm font-bold">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Loading...</span>
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
    <div className="workspace-shell flex h-screen overflow-hidden">
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

      <main className="workspace-main flex-1 min-w-0 h-screen overflow-y-auto overscroll-contain flex flex-col">
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

        <div className="flex-1 p-4 sm:p-5">
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
                const saved = await saveInquiryRecord(data, params);
                await syncData({ silent: true });
                return saved;
              }}
              onDeletePreContract={async (orderId) => {
                await deletePreContractOrder(data, orderId);
                pushToast('success', `Đã hủy và xóa đơn ${orderId}.`);
                await syncData({ silent: true });
              }}
              onConfirmOrder={async (orderId) => {
                await updateQuotationWorkflow(orderId, { inquiry_status: WORKFLOW_STATUS.CONFIRMED_ORDER });
                const ord = await createOrOverwriteContractDraft(data, orderId, currentUser.full_name);
                patchOrderMeta(orderId, { sent_to_sales: true });
                await syncData({ silent: true });
                pushToast('success', `Đã chốt đơn & lập Hợp đồng ${ord.contract_no} — Sẵn sàng xem, xuất file và gửi khách.`);
                setPreviewTarget({ kind: 'CONTRACT', orderId });
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
              onPatchProposalMeta={patchProposalMeta}
              onPatchOrderMeta={patchOrderMeta}
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
                setProposalMetaMap(readProposalExtraMetaMap());
                pushToast('success', `Đã lưu phương án giá ${extraMeta.quotation_no} và gửi Sales.`);
                await syncData({ silent: true });
              }}
              onOpenPreview={setPreviewTarget}
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
              proposalMetaMap={proposalMetaMap}
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
              onUpsertProduct={async (row, isEdit, silent) => {
                await upsertProductDirect(row, isEdit);
                if (!silent) {
                  pushToast('success', 'Đã lưu sản phẩm.');
                  await syncData({ silent: true });
                }
              }}
              onDeleteProduct={async (sku) => {
                await deleteProductDirect(sku);
                pushToast('success', `Đã xóa ${sku}.`);
                await syncData({ silent: true });
              }}
              onUpsertSchedule={async (row, isEdit, silent) => {
                await upsertScheduleDirect(row, isEdit);
                if (!silent) {
                  pushToast('success', 'Đã lưu lịch tàu.');
                  await syncData({ silent: true });
                }
              }}
              onDeleteSchedule={async (sid) => {
                await deleteScheduleDirect(sid);
                pushToast('success', `Đã xóa ${sid}.`);
                await syncData({ silent: true });
              }}
              onUpsertRate={async (row, isEdit, silent) => {
                await upsertPricingRateDirect(row, isEdit);
                if (!silent) {
                  pushToast('success', 'Đã lưu biểu phí.');
                  await syncData({ silent: true });
                }
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
              onDeleteTemplate={async (tpl) => {
                await deleteTemplateWithStorage(tpl.template_id, tpl.google_doc_file_id);
                pushToast('success', `Đã xóa phôi mẫu ${tpl.template_id} và tệp .docx thành công.`);
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
                const normalizedRow: SysUser = {
                  ...row,
                  employee_id: row.employee_id.trim(),
                  full_name: row.full_name.trim(),
                  department: row.department.trim(),
                  role: row.role.trim(),
                  email: row.email.trim().toLowerCase(),
                  status: row.status.trim(),
                };
                setData((prev) => {
                  const idx = prev.users.findIndex(
                    (u) => u.employee_id.trim().toLowerCase() === normalizedRow.employee_id.toLowerCase()
                  );
                  const nextUsers =
                    idx >= 0
                      ? prev.users.map((u, i) => (i === idx ? { ...u, ...normalizedRow } : u))
                      : [...prev.users, normalizedRow];
                  return { ...prev, users: nextUsers };
                });
                pushToast(
                  'success',
                  isEdit
                    ? `Đã cập nhật nhân sự ${normalizedRow.full_name}.`
                    : `Đã tạo tài khoản nhân sự ${normalizedRow.full_name} thành công.`
                );
                void syncData({ silent: true });
              }}
              onRequestConfirm={(title, message, onConfirm, danger) =>
                setConfirmState({ open: true, title, message, onConfirm, danger })
              }
              onToast={pushToast}
            />
          )}
        </div>
      </main>

      {/* Modals */}
      <DocumentPreviewModal
        target={previewTarget}
        data={data}
        currentUser={currentUser}
        orderMetaMap={orderMetaMap}
        proposalMetaMap={proposalMetaMap}
        allowQuickAdjust={role === 'SALES' || role === 'ADMIN'}
        allowInternalView={role === 'SALES' || role === 'XNK' || role === 'ADMIN'}
        onClose={() => setPreviewTarget(null)}
        onConfirmQuickAdjust={async (orderId, newInc, newPrice, validityDays, paymentTerm) => {
          await updateQuotationWorkflow(
            orderId,
            {
              quotation_mode: 'SINGLE',
              ...(paymentTerm ? { proposed_payment_term: paymentTerm } : {}),
            },
            { recommended_incoterm: newInc, final_selling_price: newPrice }
          );
          if (validityDays && validityDays >= 7 && validityDays <= 15) {
            patchProposalMeta(orderId, { validity_days: validityDays });
          }
          pushToast('success', `Đã lưu điều chỉnh ${newInc} · ${fmtUSD(newPrice)} · Hiệu lực ${validityDays || 7} ngày.`);
          await syncData({ silent: true });
        }}
        onMarkQuotationSent={async (orderId, linkOrSubject) => {
          const existingInq = data.inquiries.find((i) => i.order_id === orderId);
          await updateQuotationWorkflow(orderId, {
            inquiry_status: WORKFLOW_STATUS.SENT_WAITING_CUST,
            sent_mail_link: linkOrSubject,
          });
          const nextSendCount = incrementQuotationSendCount(
            orderId,
            Boolean(existingInq?.sent_mail_link)
          );
          setProposalMetaMap(readProposalExtraMetaMap());
          pushToast('success', `Đã đánh dấu Đã gửi Báo giá cho Khách (Lần ${nextSendCount}).`);
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
