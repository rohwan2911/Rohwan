import React, { useMemo, useState } from 'react';
import { FileCheck2, Send, ArrowRightCircle, Ship, FolderOpen, Edit3, Eye, FileDown } from 'lucide-react';
import type { AppDataState, OrderLogisticsMeta, OrderMaster, ProposalExtraMeta, SysUser, ViewId } from '../types';
import {
  COMPLETED_ORDER_STATUS,
  fmtNumber,
  fmtUSD,
  getEffectiveFulfillmentStatus,
  getNextContractMilestone,
  getOrderStage6Number,
  INCOTERMS_2020_MATRIX,
  isConfirmedStatus,
  suggestCoFormCode,
  toNum,
} from '../utils/calculations';
import type { PreviewModalTarget } from './Modals';
import { SearchableCombo } from './SearchableCombo';
import { isStoredDocumentPath, openDocumentWithSignedUrl } from '../services/supabaseService';

interface XnkContractsViewProps {
  activeView: Extract<ViewId, 'xnk-contract' | 'xnk-documents'>;
  data: AppDataState;
  currentUser: SysUser;
  quickSearch: string;
  highlightedOrderId?: string;
  orderMetaMap: Record<string, OrderLogisticsMeta>;
  proposalMetaMap?: Record<string, ProposalExtraMeta>;
  onCreateContractDraft: (orderId: string) => Promise<void>;
  onUpdateContractAndMeta: (order: OrderMaster, metaPatch: Partial<OrderLogisticsMeta>) => Promise<void>;
  onSendContractToSales: (order: OrderMaster) => Promise<void>;
  onAdvanceMilestone: (order: OrderMaster, nextStatus: string) => Promise<void>;
  onOpenPreview: (target: PreviewModalTarget) => void;
  onOpenTimeline: (orderId: string) => void;
  onRequestConfirm: (title: string, message: string, onConfirm: () => Promise<void>, danger?: boolean) => void;
  onToast: (type: 'success' | 'error' | 'info' | 'warning', title: string) => void;
}

export const XnkContractsView: React.FC<XnkContractsViewProps> = ({
  activeView,
  data,
  quickSearch,
  highlightedOrderId,
  orderMetaMap,
  proposalMetaMap,
  onCreateContractDraft,
  onUpdateContractAndMeta,
  onSendContractToSales,
  onAdvanceMilestone,
  onOpenPreview,
  onOpenTimeline,
  onRequestConfirm,
  onToast,
}) => {
  const [editOrder, setEditOrder] = useState<OrderMaster | null>(null);
  const [editMeta, setEditMeta] = useState<OrderLogisticsMeta>({ order_id: '' });
  const [saving, setSaving] = useState(false);

  const pendingConfirmed = useMemo(() => {
    const existingIds = new Set(data.orders.map((o) => o.order_id));
    return data.inquiries.filter((i) => isConfirmedStatus(i.inquiry_status) && !existingIds.has(i.order_id));
  }, [data.inquiries, data.orders]);

  const qLower = quickSearch.trim().toLowerCase();
  const filteredOrders = useMemo(() => {
    return data.orders
      .filter((o) => {
        if (!qLower) return true;
        const cus = data.consignees.find((c) => c.consignee_id === o.consignee_id);
        return `${o.order_id} ${o.contract_no} ${cus?.consignee_name || ''} ${o.sku_code} ${o.pod}`.toLowerCase().includes(qLower);
      })
      .slice()
      .reverse();
  }, [data.orders, data.consignees, qLower]);

  const [quickOrderSelect, setQuickOrderSelect] = useState('');

  const contractOrderSelectOptions = useMemo(() => {
    const existingOpts = data.orders
      .slice()
      .reverse()
      .map((o) => {
        const cus = data.consignees.find((c) => c.consignee_id === o.consignee_id);
        return {
          value: o.order_id,
          label: `${o.order_id} · ${o.contract_no}`,
          subLabel: `${cus?.consignee_name || o.consignee_id} · ${o.applied_incoterm} · ${o.pod || '-'}`,
        };
      });
    const pendingOpts = pendingConfirmed.map((i) => {
      const cus = data.consignees.find((c) => c.consignee_id === i.consignee_id);
      return {
        value: i.order_id,
        label: `${i.order_id} · Chờ tạo Nháp HĐ`,
        subLabel: `${cus?.consignee_name || i.consignee_id} · ${fmtNumber(i.net_weight_kgs)} KG`,
      };
    });
    return activeView === 'xnk-contract' ? [...pendingOpts, ...existingOpts] : existingOpts;
  }, [data.orders, data.consignees, pendingConfirmed, activeView]);

  const openEditContractModal = (ord: OrderMaster) => {
    const meta = orderMetaMap[ord.order_id] || { order_id: ord.order_id };
    setEditOrder({ ...ord, co_form: ord.co_form || suggestCoFormCode(ord.pod, data.consignees.find((c) => c.consignee_id === ord.consignee_id)?.country) });
    setEditMeta({ ...meta });
  };

  const handleQuickJumpOrder = (orderId: string) => {
    setQuickOrderSelect(orderId);
    if (!orderId) return;
    const existing = data.orders.find((o) => o.order_id === orderId);
    if (existing) {
      openEditContractModal(existing);
      return;
    }
    const pending = pendingConfirmed.find((i) => i.order_id === orderId);
    if (pending && activeView === 'xnk-contract') {
      void onCreateContractDraft(pending.order_id);
    }
  };

  if (activeView === 'xnk-documents') {
    return (
      <div key="xnk-documents" className="space-y-4">
        <div className="agri-table-wrap">
          <div className="px-4 py-3 bg-[#0f4a33] border-b border-[#186635] flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-extrabold text-[#fff5d6] flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-[#f4d98a]" /> Bộ chứng từ Xuất khẩu · Commercial Invoice · Packing List · C/O · Draft B/L
            </h3>
            <div className="w-72">
              <SearchableCombo
                dark
                value={quickOrderSelect}
                onChange={handleQuickJumpOrder}
                options={contractOrderSelectOptions}
                allowCustom={false}
                placeholder="Chọn nhanh Order ID / Hợp đồng..."
              />
            </div>
          </div>
          <div className="agri-table-scroll">
            <table className="agri-table">
              <thead>
                <tr>
                  <th className="text-center">Hợp đồng / Đơn</th>
                  <th className="text-left">Khách hàng</th>
                  <th className="text-left">Tuyến &amp; Tàu / Booking</th>
                  <th className="text-left">Mốc 6 Cut-off đã nhập</th>
                  <th className="text-center">C/O Form</th>
                  <th className="text-center">Xuất Chứng từ Chuẩn Quốc Tế</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((ord) => {
                  const cus = data.consignees.find((c) => c.consignee_id === ord.consignee_id);
                  const meta = orderMetaMap[ord.order_id];
                  const isHighlighted = highlightedOrderId === ord.order_id;
                  const cutoffs = [
                    meta?.si_cutoff && `S/I: ${meta.si_cutoff}`,
                    meta?.vgm_cutoff && `VGM: ${meta.vgm_cutoff}`,
                    meta?.cfs_cutoff && `CFS: ${meta.cfs_cutoff}`,
                    meta?.cy_cutoff && `CY: ${meta.cy_cutoff}`,
                    meta?.customs_cutoff && `HQ: ${meta.customs_cutoff}`,
                    meta?.draft_bl_cutoff && `Draft B/L: ${meta.draft_bl_cutoff}`,
                  ].filter(Boolean);
                  return (
                    <tr key={ord.order_id} className={isHighlighted ? '!bg-[#f4d98a]/40 ring-2 ring-inset ring-[#186635]' : ''}>
                      <td className="text-center">
                        <div className="font-mono font-bold">{ord.contract_no}</div>
                        <button type="button" onClick={() => onOpenTimeline(ord.order_id)} className="font-mono text-[11px] hover:underline cursor-pointer">
                          {ord.order_id}
                        </button>
                      </td>
                      <td className="text-left">
                        <div className="font-bold">{cus?.consignee_name || ord.consignee_id}</div>
                        <div className="text-[11px] opacity-80">{ord.applied_incoterm} · {fmtUSD(ord.contract_value)}</div>
                      </td>
                      <td className="text-left text-xs">
                        <div>{ord.pol} → {ord.pod}</div>
                        <div className="font-mono text-[11px]">BK: {meta?.bk_no || '-'} · {meta?.ves_voy || '-'}</div>
                      </td>
                      <td className="text-left text-[11px] font-mono">
                        {cutoffs.length > 0 ? cutoffs.join(' · ') : <span className="opacity-65 italic">Chưa nhập Cut-off</span>}
                      </td>
                      <td className="text-center font-mono font-bold">{ord.co_form || suggestCoFormCode(ord.pod, cus?.country)}</td>
                      <td className="text-center space-y-1">
                        <div className="inline-flex flex-wrap justify-center gap-1">
                          <button type="button" onClick={() => onOpenPreview({ kind: 'INVOICE', orderId: ord.order_id })} className="keep-btn-style px-2 py-1 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold cursor-pointer">Invoice</button>
                          <button type="button" onClick={() => onOpenPreview({ kind: 'PACKING_LIST', orderId: ord.order_id })} className="keep-btn-style px-2 py-1 rounded bg-[#16977f] text-white text-[11px] font-bold cursor-pointer">Packing List</button>
                          <button type="button" onClick={() => onOpenPreview({ kind: 'CO', orderId: ord.order_id })} className="keep-btn-style px-2 py-1 rounded bg-[#f4d98a] text-[#07281c] text-[11px] font-extrabold cursor-pointer">C/O</button>
                          <button type="button" onClick={() => onOpenPreview({ kind: 'BL', orderId: ord.order_id })} className="keep-btn-style px-2 py-1 rounded bg-[#07281c] text-[#fff5d6] text-[11px] font-bold cursor-pointer">Draft B/L</button>
                          <button type="button" onClick={() => openEditContractModal(ord)} className="keep-btn-style px-2 py-1 rounded bg-[#d7eee4] text-[#07281c] border border-[#186635] text-[11px] font-bold cursor-pointer">Sửa Cut-off</button>
                        </div>
                        {(isStoredDocumentPath(meta?.invoice_link) ||
                          isStoredDocumentPath(meta?.packing_list_link) ||
                          isStoredDocumentPath(meta?.co_link) ||
                          isStoredDocumentPath(meta?.bl_link)) && (
                          <div className="flex justify-center flex-wrap gap-1">
                            {meta?.invoice_link && (
                              <button type="button" onClick={() => openDocumentWithSignedUrl(meta.invoice_link!).catch((e: any) => onToast('error', e?.message || 'Lỗi tải file'))} className="keep-btn-style px-1.5 py-0.5 rounded bg-[#d7eee4] text-[#07281c] text-[10px] font-bold inline-flex items-center gap-0.5 cursor-pointer">
                                <FileDown className="w-2.5 h-2.5" /> CI.docx
                              </button>
                            )}
                            {meta?.packing_list_link && (
                              <button type="button" onClick={() => openDocumentWithSignedUrl(meta.packing_list_link!).catch((e: any) => onToast('error', e?.message || 'Lỗi tải file'))} className="keep-btn-style px-1.5 py-0.5 rounded bg-[#d7eee4] text-[#07281c] text-[10px] font-bold inline-flex items-center gap-0.5 cursor-pointer">
                                <FileDown className="w-2.5 h-2.5" /> PL.docx
                              </button>
                            )}
                            {meta?.co_link && (
                              <button type="button" onClick={() => openDocumentWithSignedUrl(meta.co_link!).catch((e: any) => onToast('error', e?.message || 'Lỗi tải file'))} className="keep-btn-style px-1.5 py-0.5 rounded bg-[#d7eee4] text-[#07281c] text-[10px] font-bold inline-flex items-center gap-0.5 cursor-pointer">
                                <FileDown className="w-2.5 h-2.5" /> CO.docx
                              </button>
                            )}
                            {meta?.bl_link && (
                              <button type="button" onClick={() => openDocumentWithSignedUrl(meta.bl_link!).catch((e: any) => onToast('error', e?.message || 'Lỗi tải file'))} className="keep-btn-style px-1.5 py-0.5 rounded bg-[#d7eee4] text-[#07281c] text-[10px] font-bold inline-flex items-center gap-0.5 cursor-pointer">
                                <FileDown className="w-2.5 h-2.5" /> BL.docx
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filteredOrders.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8 opacity-75">Chưa có hợp đồng để xuất chứng từ.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Shared Modal for Cut-offs & Booking */}
        {editOrder && (
          <ContractBookingModal
            data={data}
            order={editOrder}
            meta={editMeta}
            isLocked={Boolean(orderMetaMap[editOrder.order_id]?.is_locked)}
            saving={saving}
            onChangeOrder={setEditOrder}
            onChangeMeta={setEditMeta}
            onClose={() => setEditOrder(null)}
            onSave={async () => {
              setSaving(true);
              try {
                await onUpdateContractAndMeta(editOrder, editMeta);
                setEditOrder(null);
              } finally {
                setSaving(false);
              }
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div key="xnk-contract" className="space-y-5">
      {pendingConfirmed.length > 0 && (
        <div className="agri-card p-4 space-y-3 border-l-4 border-l-[#f4d98a]">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-[#fff5d6] flex items-center gap-2">
              <FileCheck2 className="w-4 h-4 text-[#f4d98a]" /> Đơn hàng Khách đã chốt · Chờ Khởi tạo Hợp đồng ({pendingConfirmed.length})
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pendingConfirmed.map((inq) => {
              const prop = data.proposals.find((p) => p.order_id === inq.order_id);
              const cus = data.consignees.find((c) => c.consignee_id === inq.consignee_id);
              return (
                <div key={inq.order_id} className="agri-card-inner p-3 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <div className="font-mono font-bold text-[#07281c]">{inq.order_id} · {cus?.consignee_name || inq.consignee_id}</div>
                    <div className="truncate opacity-85">{inq.product_name_vie || inq.sku_code} · {fmtNumber(inq.net_weight_kgs)} KG · {fmtUSD(prop?.final_selling_price || 0)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onCreateContractDraft(inq.order_id)}
                    className="agri-btn-primary shrink-0 py-1.5 px-3 text-xs"
                  >
                    Khởi tạo Nháp HĐ
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="agri-table-wrap">
        <div className="px-4 py-3 bg-[#0f4a33] border-b border-[#186635] flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-extrabold text-[#fff5d6]">Quản lý Hợp đồng Ngoại thương ({filteredOrders.length} HĐ)</h3>
          <div className="w-72">
            <SearchableCombo
              dark
              value={quickOrderSelect}
              onChange={handleQuickJumpOrder}
              options={contractOrderSelectOptions}
              allowCustom={false}
              placeholder="Chọn nhanh Order ID / Hợp đồng..."
            />
          </div>
        </div>
        <div className="agri-table-scroll">
          <table className="agri-table">
            <thead>
              <tr>
                <th className="text-center">Đơn / Số Hợp đồng</th>
                <th className="text-left">Khách hàng</th>
                <th className="text-left">Sản phẩm · KL</th>
                <th className="text-center">Incoterm / TT</th>
                <th className="text-left">POL → POD / Booking</th>
                <th className="text-center">Giá trị HĐ</th>
                <th className="text-center">Trạng thái</th>
                <th className="text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((ord) => {
                const cus = data.consignees.find((c) => c.consignee_id === ord.consignee_id);
                const meta = orderMetaMap[ord.order_id];
                const propExtra = proposalMetaMap?.[ord.order_id];
                const sendCount =
                  typeof propExtra?.send_count === 'number' && propExtra.send_count > 0
                    ? propExtra.send_count
                    : 0;
                const isLocked = Boolean(meta?.is_locked);
                const stageNum = getOrderStage6Number(ord, meta);
                const nextM = getNextContractMilestone(stageNum);
                const statusTxt = getEffectiveFulfillmentStatus(ord, meta);
                const displayStatus = !isLocked
                  ? 'Chờ ký'
                  : stageNum >= 7
                  ? COMPLETED_ORDER_STATUS
                  : statusTxt;
                return (
                  <tr key={ord.order_id}>
                    <td className="text-center">
                      <button type="button" onClick={() => onOpenTimeline(ord.order_id)} className="font-mono font-bold hover:underline cursor-pointer">
                        {ord.order_id}
                      </button>
                      <div className="font-mono font-bold">{ord.contract_no}</div>
                      <div className="text-[10.5px] opacity-80">{ord.contract_date}</div>
                      <div className="mt-1 flex items-center justify-center flex-wrap gap-1">
                        <span className={`keep-badge-color inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${isLocked ? 'bg-[#0f4a33] text-[#fff5d6]' : 'bg-[#f4d98a] text-[#07281c]'}`}>
                          {isLocked ? `Đã ký (${meta?.signed_date || 'OK'})` : meta?.sent_to_sales ? 'Đã gửi Sales ký' : 'Bản nháp XNK'}
                        </span>
                        {sendCount > 0 && (
                          <span className="keep-badge-color inline-block px-1.5 py-0.5 rounded-full bg-[#16977f] text-white text-[10px] font-extrabold">
                            Lần {sendCount}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="text-left">
                      <div className="font-bold">{cus?.consignee_name || ord.consignee_id}</div>
                      <div className="text-[11px] opacity-80">NV: {ord.in_charge_staff}</div>
                    </td>
                    <td className="text-left">
                      <div className="font-mono font-bold">{ord.sku_code}</div>
                      <div className="font-mono text-[11px]">{fmtNumber(ord.nw_confirmed_kgs)} KG</div>
                    </td>
                    <td className="text-center">
                      <div className="font-mono font-bold">{ord.applied_incoterm}</div>
                      <div className="text-[11px]">{ord.payment_terms}</div>
                    </td>
                    <td className="text-left text-xs">
                      <div className="font-semibold">{ord.pol} → {ord.pod}</div>
                      {meta?.bk_no && <div className="font-mono text-[11px]">BK: {meta.bk_no}</div>}
                    </td>
                    <td className="text-center font-mono font-extrabold">{fmtUSD(ord.contract_value)}</td>
                    <td className="text-center">
                      <span className="keep-badge-color inline-block px-2 py-0.5 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold">
                        {displayStatus}
                      </span>
                    </td>
                    <td className="text-center space-y-1">
                      <div className="inline-flex justify-center gap-1 flex-wrap">
                        <button type="button" onClick={() => onOpenPreview({ kind: 'CONTRACT', orderId: ord.order_id })} className="keep-btn-style px-2 py-1 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer">
                          <Eye className="w-3 h-3" /> Xem HĐ
                        </button>
                        {ord.contract_link && (
                          <button
                            type="button"
                            onClick={() =>
                              openDocumentWithSignedUrl(ord.contract_link).catch((err: any) =>
                                onToast('error', err?.message || 'Không thể tải file Hợp đồng.')
                              )
                            }
                            className="keep-btn-style px-2 py-1 rounded bg-[#f4d98a] text-[#07281c] text-[11px] font-extrabold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <FileDown className="w-3 h-3" /> Tải HĐ
                          </button>
                        )}
                        <button type="button" onClick={() => openEditContractModal(ord)} className="keep-btn-style px-2 py-1 rounded bg-[#d7eee4] text-[#07281c] border border-[#186635] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer">
                          <Edit3 className="w-3 h-3" /> Sửa
                        </button>
                      </div>
                      <div className="flex justify-center flex-wrap gap-1">
                        {!isLocked && (
                          <button
                            type="button"
                            onClick={() =>
                              onRequestConfirm(
                                'Gửi Hợp đồng cho Sales đưa khách ký?',
                                `Hợp đồng ${ord.contract_no} sẽ xuất hiện tại mục "Hợp đồng chờ ký" của Phòng Kinh doanh.`,
                                () => onSendContractToSales(ord)
                              )
                            }
                            className="keep-btn-style px-2.5 py-1 rounded bg-[#f4d98a] text-[#07281c] text-[11px] font-extrabold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Send className="w-3 h-3" /> Gửi sale
                          </button>
                        )}
                        {isLocked && nextM && (
                          <button
                            type="button"
                            onClick={() => onAdvanceMilestone(ord, nextM.nextStatus)}
                            className="keep-btn-style px-2.5 py-1 rounded bg-[#16977f] text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <ArrowRightCircle className="w-3 h-3" /> {nextM.label}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-8 opacity-75">
                    Chưa có Hợp đồng Ngoại thương nào.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editOrder && (
        <ContractBookingModal
          data={data}
          order={editOrder}
          meta={editMeta}
          isLocked={Boolean(orderMetaMap[editOrder.order_id]?.is_locked)}
          saving={saving}
          onChangeOrder={setEditOrder}
          onChangeMeta={setEditMeta}
          onClose={() => setEditOrder(null)}
          onSave={async () => {
            if (!editOrder.pod.trim()) {
              onToast('warning', 'Vui lòng nhập Cảng đến (POD).');
              return;
            }
            setSaving(true);
            try {
              await onUpdateContractAndMeta(editOrder, editMeta);
              setEditOrder(null);
            } finally {
              setSaving(false);
            }
          }}
        />
      )}
    </div>
  );
};

interface ContractBookingModalProps {
  data: AppDataState;
  order: OrderMaster;
  meta: OrderLogisticsMeta;
  isLocked: boolean;
  saving: boolean;
  onChangeOrder: (o: OrderMaster) => void;
  onChangeMeta: (m: OrderLogisticsMeta) => void;
  onClose: () => void;
  onSave: () => Promise<void>;
}

const ContractBookingModal: React.FC<ContractBookingModalProps> = ({
  data,
  order,
  meta,
  isLocked,
  saving,
  onChangeOrder,
  onChangeMeta,
  onClose,
  onSave,
}) => {
  const cus = useMemo(
    () => data.consignees.find((c) => c.consignee_id === order.consignee_id),
    [data.consignees, order.consignee_id]
  );
  const prop = useMemo(
    () => data.proposals.find((p) => p.order_id === order.order_id),
    [data.proposals, order.order_id]
  );
  const [selectedScheduleId, setSelectedScheduleId] = useState(prop?.schedule_id || '');

  const incotermOptions = useMemo(() => {
    const map = new Map<string, { value: string; label: string; subLabel?: string }>();
    data.incoterms.forEach((h) => {
      const code = String(h.incoterms_code || '').trim().toUpperCase();
      if (!code) return;
      map.set(code, { value: code, label: code, subLabel: h.full_name || h.risk_transfer_point });
    });
    INCOTERMS_2020_MATRIX.forEach((r) => {
      if (!map.has(r.code)) {
        map.set(r.code, { value: r.code, label: r.code, subLabel: r.fullName });
      }
    });
    return Array.from(map.values());
  }, [data.incoterms]);

  const coFormOptions = useMemo(() => {
    const map = new Map<string, { value: string; label: string; subLabel?: string }>();
    data.lookups
      .filter((l) => /co|c\/o|origin/i.test(`${l.category} ${l.code} ${l.display_name_vie}`))
      .forEach((l) => {
        const val = l.display_name_vie || l.code;
        if (val) map.set(val.toUpperCase(), { value: val, label: val, subLabel: l.contract_text_eng || l.code });
      });
    [
      { value: 'Form B', label: 'Form B', subLabel: 'Non-preferential C/O (General)' },
      { value: 'Form D', label: 'Form D', subLabel: 'ATIGA (ASEAN)' },
      { value: 'Form E', label: 'Form E', subLabel: 'ACFTA (China)' },
      { value: 'Form AK', label: 'Form AK', subLabel: 'AKFTA / VKFTA (Korea)' },
      { value: 'Form AJ', label: 'Form AJ', subLabel: 'AJCEP / VJEPA (Japan)' },
      { value: 'Form EUR.1', label: 'Form EUR.1', subLabel: 'EVFTA (EU)' },
      { value: 'Form CPTPP', label: 'Form CPTPP', subLabel: 'CPTPP Member Countries' },
      { value: 'Form RCEP', label: 'Form RCEP', subLabel: 'RCEP Member Countries' },
      { value: 'Form AANZ', label: 'Form AANZ', subLabel: 'AANZFTA (Australia / NZ)' },
      { value: 'Form AI', label: 'Form AI', subLabel: 'AIFTA (India)' },
    ].forEach((d) => {
      if (!map.has(d.value.toUpperCase())) map.set(d.value.toUpperCase(), d);
    });
    return Array.from(map.values());
  }, [data.lookups]);

  const paymentOptions = useMemo(() => {
    const set = new Map<string, { value: string; label: string; subLabel?: string }>();
    data.lookups
      .filter((l) => String(l.category).toUpperCase().includes('PAYMENT'))
      .forEach((l) => {
        const val = l.contract_text_eng || l.display_name_vie;
        if (val) set.set(val.toLowerCase(), { value: val, label: val, subLabel: l.display_name_vie !== val ? l.display_name_vie : l.code });
      });
    [
      'T/T 30% Deposit / 70% against B/L copy',
      'T/T 100% in advance',
      'Irrevocable L/C at sight',
      'D/P at sight',
      'D/A 30 days',
    ].forEach((d) => {
      if (!set.has(d.toLowerCase())) set.set(d.toLowerCase(), { value: d, label: d });
    });
    return Array.from(set.values());
  }, [data.lookups]);

  const polOptions = useMemo(() => {
    const set = new Set<string>(['Cát Lái (HCMC)', 'Hải Phòng', 'Đà Nẵng', 'Cái Mép - Thị Vải']);
    data.schedules.forEach((s) => s.pol && set.add(s.pol.trim()));
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }, [data.schedules]);

  const podOptions = useMemo(() => {
    const countryLow = (cus?.country || '').trim().toLowerCase();
    const matched = data.schedules.filter((s) => !countryLow || s.country.trim().toLowerCase() === countryLow);
    const pool = matched.length > 0 ? matched : data.schedules;
    const map = new Map<string, { value: string; label: string; subLabel?: string }>();
    pool.forEach((s) => {
      if (!s.pod) return;
      const p = s.pod.trim();
      if (!map.has(p.toLowerCase())) {
        map.set(p.toLowerCase(), { value: p, label: p, subLabel: s.country || undefined });
      }
    });
    // Also include remaining PODs if country filter narrowed the list
    if (matched.length > 0 && matched.length < data.schedules.length) {
      data.schedules.forEach((s) => {
        if (!s.pod) return;
        const p = s.pod.trim();
        if (!map.has(p.toLowerCase())) {
          map.set(p.toLowerCase(), { value: p, label: p, subLabel: `${s.country || ''} (Khác quốc gia KH)` });
        }
      });
    }
    return Array.from(map.values());
  }, [data.schedules, cus?.country]);

  const scheduleOptions = useMemo(() => {
    const countryLow = (cus?.country || '').trim().toLowerCase();
    const sorted = data.schedules.slice().sort((a, b) => {
      const aMatch = countryLow && a.country.trim().toLowerCase() === countryLow ? 0 : 1;
      const bMatch = countryLow && b.country.trim().toLowerCase() === countryLow ? 0 : 1;
      return aMatch - bMatch;
    });
    return sorted.map((s) => ({
      value: s.schedule_id,
      label: `${s.schedule_id} · ${s.shipping_line} (${s.pol} → ${s.pod})`,
      subLabel: `${s.country} · ${s.vessel || '-'} ${s.voyage || ''} · ETD ${s.etd || '-'}`,
    }));
  }, [data.schedules, cus?.country]);

  const blTypeOptions = useMemo(() => {
    const base = [
      { value: 'ORIGINAL', label: 'Original B/L', subLabel: 'Vận đơn gốc (3/3)' },
      { value: 'SURRENDERED', label: 'Surrendered B/L', subLabel: 'Vận đơn điện giao hàng' },
      { value: 'SEAWAY BILL', label: 'Sea Waybill', subLabel: 'Giấy gửi hàng đường biển' },
    ];
    const seen = new Set(base.map((b) => b.value.toUpperCase()));
    data.lookups
      .filter((l) => /bl|b\/l|bill/i.test(`${l.category} ${l.code}`))
      .forEach((l) => {
        const val = (l.code || l.display_name_vie).trim();
        if (val && !seen.has(val.toUpperCase())) {
          seen.add(val.toUpperCase());
          base.push({ value: val, label: l.display_name_vie || val, subLabel: l.contract_text_eng || '' });
        }
      });
    return base;
  }, [data.lookups]);

  return (
    <div className="fixed inset-0 z-50 bg-[#07281c]/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
      <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto text-[#f4f8f5]">
        <div className="px-5 py-3.5 bg-[#0f4a33] border-b-2 border-[#186635] flex items-center justify-between">
          <div>
            <h4 className="text-sm sm:text-base font-extrabold text-[#fff5d6] flex items-center gap-2">
              <Ship className="w-4 h-4 text-[#f4d98a]" /> Cập nhật Hợp đồng, Booking &amp; 6 Mốc Cut-off · {order.contract_no}
            </h4>
            {isLocked && <p className="text-[11px] text-[#f4d98a]">Hợp đồng đã ký: khóa điều khoản thương mại, giữ nguyên quyền sửa thông tin Logistics &amp; Cut-offs.</p>}
          </div>
          <button type="button" onClick={onClose} className="px-2.5 py-1 rounded bg-[#8c3b3b] text-white text-xs font-bold cursor-pointer">Đóng</button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          <div className="agri-card-inner p-3.5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block font-bold mb-1">KL Net Xác nhận (KG)</label>
              <input type="number" disabled={isLocked} value={order.nw_confirmed_kgs} onChange={(e) => onChangeOrder({ ...order, nw_confirmed_kgs: toNum(e.target.value) })} className="agri-input font-mono disabled:opacity-60" />
            </div>
            <div>
              <label className="block font-bold mb-1">Incoterm áp dụng</label>
              <SearchableCombo
                disabled={isLocked}
                value={order.applied_incoterm}
                onChange={(v) => onChangeOrder({ ...order, applied_incoterm: v.toUpperCase() })}
                options={incotermOptions}
                allowCustom
                placeholder="Chọn Incoterm..."
              />
            </div>
            <div>
              <label className="block font-bold mb-1">Giá trị HĐ (USD)</label>
              <input type="number" step="0.01" disabled={isLocked} value={order.contract_value} onChange={(e) => onChangeOrder({ ...order, contract_value: toNum(e.target.value) })} className="agri-input font-mono font-bold disabled:opacity-60" />
            </div>
            <div>
              <label className="block font-bold mb-1">C/O Form</label>
              <SearchableCombo
                value={order.co_form}
                onChange={(v) => onChangeOrder({ ...order, co_form: v })}
                options={coFormOptions}
                allowCustom
                placeholder="Chọn Form C/O..."
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-bold mb-1">Thanh toán</label>
              <SearchableCombo
                disabled={isLocked}
                value={order.payment_terms}
                onChange={(v) => onChangeOrder({ ...order, payment_terms: v })}
                options={paymentOptions}
                allowCustom
                placeholder="Chọn điều khoản thanh toán..."
              />
            </div>
            <div>
              <label className="block font-bold mb-1">POL (Cảng đi)</label>
              <SearchableCombo
                value={order.pol}
                onChange={(v) => onChangeOrder({ ...order, pol: v })}
                options={polOptions}
                allowCustom
                placeholder="Chọn Cảng đi..."
              />
            </div>
            <div>
              <label className="block font-bold mb-1">POD (Cảng đến{cus?.country ? ` · ${cus.country}` : ''})</label>
              <SearchableCombo
                value={order.pod}
                onChange={(v) => onChangeOrder({ ...order, pod: v })}
                options={podOptions}
                allowCustom
                placeholder="Chọn Cảng đến..."
              />
            </div>
            <div className="sm:col-span-4">
              <label className="block font-bold mb-1">Đường dẫn Tệp Hợp đồng đã ký</label>
              <input value={order.contract_link} onChange={(e) => onChangeOrder({ ...order, contract_link: e.target.value })} placeholder="orders/..." className="agri-input" />
            </div>
          </div>

          <div className="agri-card-inner p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-extrabold text-[#07281c] uppercase text-[11px]">Thông tin Booking &amp; Vận hành Tàu</div>
              <div className="w-full sm:w-80">
                <SearchableCombo
                  value={selectedScheduleId}
                  onChange={(sid) => {
                    setSelectedScheduleId(sid);
                    const sch = data.schedules.find((s) => s.schedule_id === sid);
                    if (sch) {
                      onChangeOrder({
                        ...order,
                        pol: sch.pol || order.pol,
                        pod: sch.pod || order.pod,
                      });
                      onChangeMeta({
                        ...meta,
                        ves_voy: [sch.vessel, sch.voyage].filter(Boolean).join(' / ') || meta.ves_voy,
                        fwd_name: sch.shipping_line || meta.fwd_name,
                      });
                    }
                  }}
                  options={scheduleOptions}
                  allowCustom={false}
                  placeholder="Áp dụng nhanh từ Lịch tàu (Schedule_ID)..."
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-bold mb-1">Số Booking (B/K No.)</label>
                <input value={meta.bk_no || ''} onChange={(e) => onChangeMeta({ ...meta, bk_no: e.target.value })} className="agri-input font-mono" />
              </div>
              <div>
                <label className="block font-bold mb-1">Tên Tàu / Chuyến (Ves/Voy)</label>
                <input value={meta.ves_voy || ''} onChange={(e) => onChangeMeta({ ...meta, ves_voy: e.target.value })} className="agri-input" />
              </div>
              <div>
                <label className="block font-bold mb-1">Số Container / Seal</label>
                <input value={meta.cont_seal_list || ''} onChange={(e) => onChangeMeta({ ...meta, cont_seal_list: e.target.value })} className="agri-input font-mono" />
              </div>
              <div>
                <label className="block font-bold mb-1">Loại Vận đơn (B/L Type)</label>
                <SearchableCombo
                  value={meta.bl_type || 'ORIGINAL'}
                  onChange={(v) => onChangeMeta({ ...meta, bl_type: v })}
                  options={blTypeOptions}
                  allowCustom
                  placeholder="Chọn loại B/L..."
                />
              </div>
              <div>
                <label className="block font-bold mb-1">FWD / Hãng tàu phụ trách</label>
                <input value={meta.fwd_name || ''} onChange={(e) => onChangeMeta({ ...meta, fwd_name: e.target.value })} className="agri-input" />
              </div>
              <div>
                <label className="block font-bold mb-1">Kho CFS (Nếu LCL)</label>
                <input value={meta.cfs_warehouse || ''} onChange={(e) => onChangeMeta({ ...meta, cfs_warehouse: e.target.value })} className="agri-input" />
              </div>
            </div>
          </div>

          <div className="agri-card-inner p-3.5 space-y-2.5">
            <div className="font-extrabold text-[#07281c] uppercase text-[11px]">6 Mốc Cut-off Xuất khẩu (Hiển thị đếm ngược trên Dashboard)</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                ['S/I Cut-off', 'si_cutoff'],
                ['VGM Cut-off', 'vgm_cutoff'],
                ['CFS (LCL) Cut-off', 'cfs_cutoff'],
                ['CY (FCL) Cut-off', 'cy_cutoff'],
                ['Customs / Vào sổ tàu', 'customs_cutoff'],
                ['Draft B/L Cut-off', 'draft_bl_cutoff'],
              ].map(([label, key]) => (
                <div key={key}>
                  <label className="block font-bold mb-1">{label}</label>
                  <input
                    type="datetime-local"
                    value={(meta as any)[key] || ''}
                    onChange={(e) => onChangeMeta({ ...meta, [key]: e.target.value })}
                    className="agri-input font-mono text-xs"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-[#07281c] text-white font-bold cursor-pointer">Hủy</button>
            <button type="button" disabled={saving} onClick={onSave} className="agri-btn-gold px-5">
              {saving ? 'Loading...' : 'Lưu Cập nhật Hợp đồng & Cut-off'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
