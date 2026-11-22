import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Printer, Mail, SlidersHorizontal, AlertTriangle, CheckCircle2, Clock, Copy, Send } from 'lucide-react';
import type {
  AppDataState,
  OrderLogisticsMeta,
  ProposalExtraMeta,
} from '../types';
import {
  cleanQuoteNoForCustomer,
  computeFloorPriceScaled,
  fmtNumber,
  fmtUSD,
  getOrderStage6Number,
  INCOTERMS_2020_MATRIX,
  parseOrderItems,
  toNum,
  WORKFLOW_6_STAGES,
} from '../utils/calculations';
import {
  buildExportEmailHtml,
  buildQuotationEmailHtml,
  buildQuotationEmailSubject,
  generateContractDocHtml,
  generateExportDocumentHtml,
  generateQuotationDocHtml,
} from '../utils/documentHtml';

export interface PreviewModalTarget {
  kind: 'QUOTATION' | 'CONTRACT' | 'INVOICE' | 'PACKING_LIST' | 'CO' | 'BL';
  orderId: string;
}

interface DocumentPreviewModalProps {
  target: PreviewModalTarget | null;
  data: AppDataState;
  orderMetaMap: Record<string, OrderLogisticsMeta>;
  proposalMetaMap: Record<string, ProposalExtraMeta>;
  allowQuickAdjust: boolean;
  onClose: () => void;
  onConfirmQuickAdjust?: (orderId: string, newIncoterm: string, newPrice: number, templateMode: 'STANDARD' | 'COMPARISON') => Promise<void>;
  onMarkQuotationSent?: (orderId: string, emailSubject: string) => Promise<void>;
  onRequestRepriceFromModal?: (orderId: string, reason: string) => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info' | 'warning', title: string) => void;
}

export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({
  target,
  data,
  orderMetaMap,
  proposalMetaMap,
  allowQuickAdjust,
  onClose,
  onConfirmQuickAdjust,
  onMarkQuotationSent,
  onRequestRepriceFromModal,
  onToast,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [templateMode, setTemplateMode] = useState<'STANDARD' | 'COMPARISON'>('STANDARD');
  const [adjIncoterm, setAdjIncoterm] = useState('CIF');
  const [adjPrice, setAdjPrice] = useState('');
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBodyHtml, setEmailBodyHtml] = useState('');
  const [showEmailPane, setShowEmailPane] = useState(false);
  const [docLoading, setDocLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const ctx = useMemo(() => {
    if (!target) return null;
    const inq = data.inquiries.find((i) => i.order_id === target.orderId);
    const prop = data.proposals.find((p) => p.order_id === target.orderId);
    const extraMeta = proposalMetaMap[target.orderId];
    const order = data.orders.find((o) => o.order_id === target.orderId);
    const meta = orderMetaMap[target.orderId];
    const cusId = order?.consignee_id || inq?.consignee_id || '';
    const cus = data.consignees.find((c) => c.consignee_id === cusId);
    const sch = prop ? data.schedules.find((s) => s.schedule_id === prop.schedule_id) : undefined;
    return { inq, prop, extraMeta, order, meta, cus, sch };
  }, [target, data, orderMetaMap, proposalMetaMap]);

  useEffect(() => {
    if (!target || !ctx) return;
    if (target.kind === 'QUOTATION' && ctx.inq) {
      const mode = String(ctx.inq.quotation_mode || '').toUpperCase().includes('COMP') || (ctx.prop?.proposed_incoterms || '').split(',').filter(Boolean).length >= 2
        ? 'COMPARISON'
        : 'STANDARD';
      setTemplateMode(mode);
      const inc = ctx.prop?.recommended_incoterm || ctx.inq.desired_incoterm || 'CIF';
      const price = toNum(ctx.prop?.final_selling_price);
      setAdjIncoterm(inc);
      setAdjPrice(price > 0 ? price.toFixed(2) : '');
      setEmailTo(ctx.cus?.email || ctx.inq.email || '');
      setEmailSubject(buildQuotationEmailSubject(ctx.inq, ctx.prop, ctx.extraMeta, data.products));
      setEmailBodyHtml(buildQuotationEmailHtml(ctx.inq, ctx.cus, ctx.prop, ctx.extraMeta, ctx.sch, data.products, inc, price));
    } else if (ctx.order) {
      setEmailTo(ctx.cus?.email || ctx.inq?.email || '');
      const label = target.kind === 'CONTRACT' ? `Sales Contract ${ctx.order.contract_no}` : `${target.kind} – ${ctx.order.contract_no}`;
      setEmailSubject(`[GREEN AGRI-EXPORTS] ${label}`);
      setEmailBodyHtml(buildExportEmailHtml(label, ctx.order, ctx.cus));
    }
    setShowEmailPane(false);
    setDocLoading(true);
  }, [target, ctx, data.products]);

  const floorForSelectedInc = useMemo(() => {
    if (!ctx?.prop) return 0;
    return computeFloorPriceScaled(ctx.prop, ctx.extraMeta, adjIncoterm);
  }, [ctx, adjIncoterm]);

  const numericAdjPrice = toNum(adjPrice);
  const isBelowFloor = floorForSelectedInc > 0 && numericAdjPrice > 0 && numericAdjPrice < floorForSelectedInc;

  const docHtml = useMemo(() => {
    if (!target || !ctx) return '';
    if (target.kind === 'QUOTATION' && ctx.inq) {
      return generateQuotationDocHtml({
        inq: ctx.inq,
        prop: ctx.prop,
        extraMeta: ctx.extraMeta,
        cus: ctx.cus,
        sch: ctx.sch,
        products: data.products,
        pricingRates: data.pricingRates,
        templateMode,
        overrideIncoterm: adjIncoterm,
        overrideSellingPrice: numericAdjPrice > 0 ? numericAdjPrice : undefined,
      });
    }
    if (target.kind === 'CONTRACT' && ctx.order) {
      return generateContractDocHtml({
        order: ctx.order,
        meta: ctx.meta,
        inq: ctx.inq,
        cus: ctx.cus,
        products: data.products,
        pricingRates: data.pricingRates,
      });
    }
    if (ctx.order && (target.kind === 'INVOICE' || target.kind === 'PACKING_LIST' || target.kind === 'CO' || target.kind === 'BL')) {
      return generateExportDocumentHtml(target.kind, {
        order: ctx.order,
        meta: ctx.meta,
        inq: ctx.inq,
        cus: ctx.cus,
        prop: ctx.prop,
        products: data.products,
        pricingRates: data.pricingRates,
      });
    }
    return '';
  }, [target, ctx, data.products, data.pricingRates, templateMode, adjIncoterm, numericAdjPrice]);

  if (!target || !ctx) return null;

  const cleanQuoteTitle = target.kind === 'QUOTATION'
    ? `Báo giá ${cleanQuoteNoForCustomer(ctx.extraMeta?.quotation_no || '', target.orderId)}`
    : `${target.kind} · ${ctx.order?.contract_no || target.orderId}`;

  const handlePrint = () => {
    iframeRef.current?.contentWindow?.print();
  };

  const handleDownloadHtml = () => {
    const blob = new Blob([docHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cleanQuoteTitle.replace(/[^a-zA-Z0-9_-]+/g, '_')}.html`;
    a.click();
    URL.revokeObjectURL(url);
    onToast('success', 'Đã tải xuống file chứng từ HTML (mở in PDF trực tiếp).');
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#07281c]/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
      <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden text-[#f4f8f5]">
        <div className="px-4 py-3 bg-[#0f4a33] border-b-2 border-[#186635] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm sm:text-base font-extrabold text-[#fff5d6]">{cleanQuoteTitle}</h3>
            <p className="text-[11px] text-[#9bccb8]">
              Khách hàng: {ctx.cus?.consignee_name || ctx.inq?.consignee_id || ctx.order?.consignee_id}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {target.kind === 'QUOTATION' && (
              <div className="flex items-center bg-[#07281c] rounded-lg p-0.5 border border-[#186635]">
                <button
                  type="button"
                  onClick={() => setTemplateMode('STANDARD')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold cursor-pointer ${templateMode === 'STANDARD' ? 'bg-[#f4d98a] text-[#07281c]' : 'text-[#d2ebe0]'}`}
                >
                  Mẫu Chuẩn
                </button>
                <button
                  type="button"
                  onClick={() => setTemplateMode('COMPARISON')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold cursor-pointer ${templateMode === 'COMPARISON' ? 'bg-[#f4d98a] text-[#07281c]' : 'text-[#d2ebe0]'}`}
                >
                  Mẫu So sánh ĐK
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowEmailPane((s) => !s)}
              className="px-3 py-1.5 rounded-lg bg-[#16977f] hover:bg-[#117865] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>{showEmailPane ? 'Ẩn Soạn Email' : 'Soạn Email Gửi Khách'}</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="px-3 py-1.5 rounded-lg bg-[#f4d98a] text-[#07281c] text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>In / Lưu PDF</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadHtml}
              className="px-2.5 py-1.5 rounded-lg bg-[#07281c] text-[#fff5d6] border border-[#186635] text-xs font-semibold cursor-pointer"
            >
              Tải File
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-[#8c3b3b] text-white hover:bg-[#6e2b2b] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {target.kind === 'QUOTATION' && allowQuickAdjust && ctx.prop && (
          <div className="px-4 py-2.5 bg-[#07281c] border-b border-[#186635] flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1 font-bold text-[#f4d98a]">
                <SlidersHorizontal className="w-3.5 h-3.5" /> Điều chỉnh nhanh Sales:
              </span>
              <select
                value={adjIncoterm}
                onChange={(e) => {
                  const nextInc = e.target.value;
                  setAdjIncoterm(nextInc);
                  if (ctx.inq && ctx.prop) {
                    setEmailBodyHtml(buildQuotationEmailHtml(ctx.inq, ctx.cus, ctx.prop, ctx.extraMeta, ctx.sch, data.products, nextInc, numericAdjPrice));
                  }
                }}
                className="px-2 py-1 rounded-lg bg-[#0f4a33] border border-[#f4d98a]/60 text-[#fff5d6] font-mono font-bold text-xs"
              >
                {INCOTERMS_2020_MATRIX.map((r) => (
                  <option key={r.code} value={r.code}>{r.code} — {r.fullName}</option>
                ))}
              </select>
              <div className="flex items-center gap-1.5">
                <span className="text-[#9bccb8]">Giá chào (USD):</span>
                <input
                  type="number"
                  step="0.01"
                  value={adjPrice}
                  onChange={(e) => setAdjPrice(e.target.value)}
                  className="w-28 px-2 py-1 rounded-lg bg-[#d7eee4] text-[#07281c] font-mono font-bold text-xs"
                />
              </div>
              <span className="text-[11px] text-[#9bccb8]">
                Giá sàn XNK ({adjIncoterm}): <strong className="text-[#f4d98a] font-mono">{fmtUSD(floorForSelectedInc)}</strong>
              </span>
            </div>

            <div className="flex items-center gap-2">
              {isBelowFloor ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (!onRequestRepriceFromModal) return;
                    setBusy(true);
                    try {
                      await onRequestRepriceFromModal(target.orderId, `Sales đề nghị giảm giá xuống ${fmtUSD(numericAdjPrice)} (${adjIncoterm}), thấp hơn giá sàn ${fmtUSD(floorForSelectedInc)}.`);
                      onClose();
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="px-3 py-1 rounded-lg bg-[#8c3b3b] hover:bg-[#6e2b2b] text-white font-bold flex items-center gap-1 cursor-pointer"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Dưới sàn — Gửi XNK Tính lại</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (!onConfirmQuickAdjust) return;
                    setBusy(true);
                    try {
                      await onConfirmQuickAdjust(target.orderId, adjIncoterm, numericAdjPrice, templateMode);
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="px-3 py-1 rounded-lg bg-[#16977f] hover:bg-[#0f4a33] text-white font-bold cursor-pointer"
                >
                  Lưu điều chỉnh lên Báo giá
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12">
          <div className={`${showEmailPane ? 'lg:col-span-7' : 'lg:col-span-12'} relative bg-white min-h-[460px]`}>
            {docLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#d7eee4]/90 text-[#07281c] text-xs font-bold">
                Đang tải chứng từ...
              </div>
            )}
            <iframe
              ref={iframeRef}
              title={cleanQuoteTitle}
              srcDoc={docHtml}
              onLoad={() => setDocLoading(false)}
              className="w-full h-full min-h-[520px] border-0"
            />
          </div>

          {showEmailPane && (
            <div className="lg:col-span-5 bg-[#0b3a27] border-l-2 border-[#186635] p-4 flex flex-col gap-3 overflow-y-auto">
              <div className="text-xs font-extrabold text-[#f4d98a] uppercase tracking-wider">
                Email Gửi Khách Hàng (Chuẩn Quốc Tế)
              </div>
              <div>
                <label className="block text-[11px] text-[#9bccb8] mb-1">Người nhận (To)</label>
                <input
                  type="email"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  className="agri-input text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#9bccb8] mb-1">Tiêu đề Email (Không chứa mã nội bộ)</label>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="agri-input text-xs font-semibold"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[11px] text-[#9bccb8] mb-1">Xem trước nội dung Email HTML</label>
                <div
                  className="bg-white text-slate-900 p-3 rounded-xl border border-[#186635] text-xs leading-relaxed max-h-60 overflow-y-auto"
                  dangerouslySetInnerHTML={{ __html: emailBodyHtml }}
                />
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    const plain = emailBodyHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
                    navigator.clipboard?.writeText(`Subject: ${emailSubject}\n\n${plain}`);
                    onToast('success', 'Đã sao chép tiêu đề & nội dung email vào bộ nhớ tạm.');
                  }}
                  className="px-3 py-2 rounded-lg bg-[#0f4a33] border border-[#f4d98a]/50 text-[#fff5d6] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" /> Copy Email
                </button>
                {target.kind === 'QUOTATION' && onMarkQuotationSent && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await onMarkQuotationSent(target.orderId, emailSubject);
                        onClose();
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="flex-1 agri-btn-gold flex items-center justify-center gap-1.5 text-xs"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Xác nhận Đã gửi Báo giá cho Khách</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface OrderTimelineModalProps {
  orderId: string | null;
  data: AppDataState;
  orderMetaMap: Record<string, OrderLogisticsMeta>;
  proposalMetaMap: Record<string, ProposalExtraMeta>;
  onClose: () => void;
}

export const OrderTimelineModal: React.FC<OrderTimelineModalProps> = ({
  orderId,
  data,
  orderMetaMap,
  proposalMetaMap,
  onClose,
}) => {
  if (!orderId) return null;
  const inq = data.inquiries.find((i) => i.order_id === orderId);
  const prop = data.proposals.find((p) => p.order_id === orderId);
  const extra = proposalMetaMap[orderId];
  const order = data.orders.find((o) => o.order_id === orderId);
  const meta = orderMetaMap[orderId];
  const cusId = order?.consignee_id || inq?.consignee_id || '';
  const cus = data.consignees.find((c) => c.consignee_id === cusId);
  const items = inq ? parseOrderItems(inq, data.products, data.pricingRates) : [];
  const stageNum = order ? getOrderStage6Number(order, meta) : prop ? 1 : 1;

  return (
    <div className="fixed inset-0 z-50 bg-[#07281c]/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] overflow-y-auto text-[#f4f8f5]">
        <div className="px-5 py-3.5 bg-[#0f4a33] border-b-2 border-[#186635] flex items-center justify-between">
          <div>
            <div className="text-xs font-mono text-[#f4d98a] font-bold">{orderId} {order ? `· ${order.contract_no}` : ''}</div>
            <h3 className="text-base font-extrabold text-[#fff5d6]">
              Hồ sơ Vòng đời Đơn hàng · {cus?.consignee_name || cusId}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg bg-[#8c3b3b] text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            {WORKFLOW_6_STAGES.map((st, idx) => {
              const num = idx + 1;
              const done = stageNum > num || stageNum >= 7;
              const current = stageNum === num;
              return (
                <div
                  key={st}
                  className={`p-2 rounded-xl border text-center ${
                    done
                      ? 'bg-[#0f4a33] border-[#16977f] text-[#fff5d6]'
                      : current
                      ? 'bg-[#f4d98a] border-[#186635] text-[#07281c] font-bold'
                      : 'bg-[#07281c]/40 border-[#186635] text-[#9bccb8]'
                  }`}
                >
                  <div className="flex justify-center mb-1">
                    {done ? <CheckCircle2 className="w-4 h-4 text-[#16977f]" /> : <Clock className="w-4 h-4" />}
                  </div>
                  <div className="text-[10.5px] leading-tight">{st}</div>
                </div>
              );
            })}
          </div>

          <div className="agri-card-inner p-3.5 space-y-2">
            <div className="font-extrabold text-[#07281c] uppercase text-[11px]">1. Yêu cầu Báo giá (Sales CRM)</div>
            {inq ? (
              <div className="grid grid-cols-2 gap-2">
                <div><strong>Sale phụ trách:</strong> {inq.sale_rep}</div>
                <div><strong>Trạng thái:</strong> {inq.inquiry_status}</div>
                <div><strong>Điều kiện mong muốn:</strong> {inq.desired_incoterm} · {inq.proposed_payment_term}</div>
                <div><strong>Tổng Net Weight:</strong> {fmtNumber(inq.net_weight_kgs)} KG</div>
                <div className="col-span-2">
                  <strong>Sản phẩm:</strong>{' '}
                  {items.map((it) => `${it.name} (${fmtNumber(it.weight)} KG)`).join('; ') || inq.product_name_vie}
                </div>
              </div>
            ) : (
              <div className="italic opacity-75">Không có bản ghi Inquiry.</div>
            )}
          </div>

          <div className="agri-card-inner p-3.5 space-y-2">
            <div className="font-extrabold text-[#07281c] uppercase text-[11px]">2. Phương án Tính giá (XNK)</div>
            {prop ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div><strong>Số báo giá:</strong> {extra?.quotation_no || `QT-${orderId}`}</div>
                <div><strong>Nhân viên XNK:</strong> {prop.xnk_rep}</div>
                <div><strong>Lịch tàu:</strong> {prop.schedule_id || '-'}</div>
                <div><strong>Container:</strong> {prop.container_type} ({prop.container_qty} cont)</div>
                <div><strong>Giá vốn hàng:</strong> {fmtUSD(prop.goods_cost)}</div>
                <div><strong>Giá chốt ({prop.recommended_incoterm}):</strong> <span className="font-bold text-[#0f4a33]">{fmtUSD(prop.final_selling_price)}</span></div>
              </div>
            ) : (
              <div className="italic opacity-75">XNK chưa lập phương án tính giá.</div>
            )}
          </div>

          <div className="agri-card-inner p-3.5 space-y-2">
            <div className="font-extrabold text-[#07281c] uppercase text-[11px]">3. Hợp đồng Ngoại thương &amp; Vận hành</div>
            {order ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div><strong>Số Hợp đồng:</strong> {order.contract_no}</div>
                <div><strong>Ngày HĐ:</strong> {order.contract_date}</div>
                <div><strong>Giá trị HĐ:</strong> <span className="font-bold">{fmtUSD(order.contract_value)}</span></div>
                <div><strong>Tuyến cảng:</strong> {order.pol} → {order.pod}</div>
                <div><strong>C/O Form:</strong> {order.co_form || '-'}</div>
                <div><strong>Booking No.:</strong> {meta?.bk_no || 'Chưa cập nhật'}</div>
                <div><strong>Tàu / Chuyến:</strong> {meta?.ves_voy || '-'}</div>
                <div><strong>Cont / Seal:</strong> {meta?.cont_seal_list || '-'}</div>
                <div><strong>Khóa ký:</strong> {meta?.is_locked ? `Đã ký (${meta.signed_date || 'OK'})` : 'Chờ ký'}</div>
              </div>
            ) : (
              <div className="italic opacity-75">Chưa khởi tạo Hợp đồng Ngoại thương.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel = 'Xác nhận',
  danger = false,
  onCancel,
  onConfirm,
}) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] bg-[#07281c]/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl shadow-2xl w-full max-w-md p-5 text-[#f4f8f5]">
        <h4 className="text-base font-extrabold text-[#fff5d6] mb-2">{title}</h4>
        <p className="text-xs text-[#e2f2eb] leading-relaxed mb-5">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-[#07281c] text-[#fff5d6] text-xs font-bold border border-[#186635] cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-xs font-extrabold cursor-pointer ${
              danger ? 'bg-[#8c3b3b] hover:bg-[#6e2b2b] text-white' : 'agri-btn-gold'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
