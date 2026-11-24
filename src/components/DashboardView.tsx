import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, Eye, Ship, Anchor, CalendarClock } from 'lucide-react';
import type { AppDataState, OrderLogisticsMeta, ProposalExtraMeta, RoleType, ViewId } from '../types';
import {
  COMPLETED_ORDER_STATUS,
  computeFreightExpiryStatus,
  deduplicatePortName,
  fmtNumber,
  fmtUSD,
  formatCutoffCountdown,
  formatDateDDMMYYYY,
  getEffectiveFulfillmentStatus,
  getOrderStage6Number,
  isConfirmedStatus,
  isPricedReadyStatus,
  isSentWaitingCustomerStatus,
  isWaitingPricingStatus,
  WORKFLOW_6_STAGES,
} from '../utils/calculations';
import { SearchableCombo } from './SearchableCombo';

interface DashboardViewProps {
  data: AppDataState;
  role: RoleType;
  orderMetaMap: Record<string, OrderLogisticsMeta>;
  proposalMetaMap: Record<string, ProposalExtraMeta>;
  onNavigate: (view: ViewId, highlightId?: string) => void;
  onOpenTimeline: (orderId: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  data,
  role,
  orderMetaMap,
  onNavigate,
  onOpenTimeline,
}) => {
  const [activeTab, setActiveTab] = useState<'sales' | 'xnk'>(role === 'XNK' ? 'xnk' : 'sales');
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [, setTick] = useState(0);

  useEffect(() => {
    if (role === 'XNK') setActiveTab('xnk');
  }, [role]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60000);
    return () => window.clearInterval(id);
  }, []);

  const didAutoSelectRef = useRef(false);

  useEffect(() => {
    if (didAutoSelectRef.current) return;
    if (!selectedOrderId && (data.orders.length > 0 || data.inquiries.length > 0)) {
      didAutoSelectRef.current = true;
      if (data.orders.length > 0) setSelectedOrderId(data.orders[data.orders.length - 1].order_id);
      else setSelectedOrderId(data.inquiries[data.inquiries.length - 1].order_id);
    }
  }, [data.orders, data.inquiries, selectedOrderId]);

  const salesMetrics = useMemo(() => {
    const waiting = data.inquiries.filter((i) => isWaitingPricingStatus(i.inquiry_status));
    const priced = data.inquiries.filter((i) => isPricedReadyStatus(i.inquiry_status));
    const sent = data.inquiries.filter((i) => isSentWaitingCustomerStatus(i.inquiry_status));

    const signedOrderIds = new Set(
      data.orders
        .filter((ord) => {
          const meta = orderMetaMap[ord.order_id];
          return Boolean(meta?.is_locked) || getOrderStage6Number(ord, meta) >= 3;
        })
        .map((o) => o.order_id)
    );
    const confirmedIds = new Set<string>();
    data.inquiries.forEach((i) => {
      if (isConfirmedStatus(i.inquiry_status) && !signedOrderIds.has(i.order_id)) {
        confirmedIds.add(i.order_id);
      }
    });
    data.orders.forEach((ord) => {
      if (!signedOrderIds.has(ord.order_id)) {
        confirmedIds.add(ord.order_id);
      }
    });
    const confirmed = Array.from(confirmedIds);

    const now = Date.now();
    const overdueFollowUps = sent.filter((i) => {
      const ts = i.timestamp ? new Date(i.timestamp.replace(' ', 'T')).getTime() : NaN;
      return !Number.isNaN(ts) && now - ts > 72 * 3600000;
    });
    return { waiting, priced, sent, confirmed, overdueFollowUps };
  }, [data.inquiries, data.orders, orderMetaMap]);

  const xnkMilestones = useMemo(() => {
    const buckets: Record<number, Array<{ id: string; label: string; sub: string }>> = {
      1: [], 2: [], 3: [], 4: [], 5: [], 6: [],
    };
    const contractOrderIds = new Set(data.orders.map((o) => o.order_id));

    data.inquiries.forEach((inq) => {
      if (!contractOrderIds.has(inq.order_id) && !String(inq.inquiry_status || '').includes('Hủy')) {
        const cus = data.consignees.find((c) => c.consignee_id === inq.consignee_id);
        buckets[1].push({
          id: inq.order_id,
          label: `${inq.order_id} · ${cus?.consignee_name || inq.consignee_id}`,
          sub: `${fmtNumber(inq.net_weight_kgs)} KG · ${inq.desired_incoterm}`,
        });
      }
    });

    data.orders.forEach((ord) => {
      const meta = orderMetaMap[ord.order_id];
      const st = getEffectiveFulfillmentStatus(ord, meta);
      if (st === COMPLETED_ORDER_STATUS) return;
      const stageNum = getOrderStage6Number(ord, meta);
      if (stageNum >= 2 && stageNum <= 6) {
        const cus = data.consignees.find((c) => c.consignee_id === ord.consignee_id);
        buckets[stageNum].push({
          id: ord.order_id,
          label: `${ord.contract_no} · ${cus?.consignee_name || ord.consignee_id}`,
          sub: `${fmtUSD(ord.contract_value)} · ${ord.pod}`,
        });
      }
    });

    return WORKFLOW_6_STAGES.map((title, idx) => ({
      stageNum: idx + 1,
      title,
      items: buckets[idx + 1] || [],
    }));
  }, [data.inquiries, data.orders, data.consignees, orderMetaMap]);

  const cutoffAlerts = useMemo(() => {
    const rows: Array<{
      orderId: string;
      contractNo: string;
      customerName: string;
      cutoffType: string;
      cutoffDate: string;
      countdown: NonNullable<ReturnType<typeof formatCutoffCountdown>>;
    }> = [];

    data.orders.forEach((ord) => {
      const meta = orderMetaMap[ord.order_id];
      const st = getEffectiveFulfillmentStatus(ord, meta);
      if (st === COMPLETED_ORDER_STATUS) return;
      const cus = data.consignees.find((c) => c.consignee_id === ord.consignee_id);
      const customerName = cus?.consignee_name || ord.consignee_id;
      const checks: Array<[string, string | undefined]> = [
        ['S/I Cut-off', meta?.si_cutoff],
        ['VGM Cut-off', meta?.vgm_cutoff],
        ['CFS (LCL) Cut-off', meta?.cfs_cutoff],
        ['CY (FCL) Cut-off', meta?.cy_cutoff],
        ['Customs / Vào sổ tàu', meta?.customs_cutoff],
        ['Draft B/L Cut-off', meta?.draft_bl_cutoff],
      ];
      checks.forEach(([cutoffType, val]) => {
        if (!val) return;
        const cd = formatCutoffCountdown(val);
        if (cd) {
          rows.push({
            orderId: ord.order_id,
            contractNo: ord.contract_no,
            customerName,
            cutoffType,
            cutoffDate: val,
            countdown: cd,
          });
        }
      });
    });

    return rows.sort((a, b) => a.countdown.diffMs - b.countdown.diffMs);
  }, [data.orders, data.consignees, orderMetaMap]);

  const orderSelectorOptions = useMemo(() => {
    const list: Array<{ value: string; label: string; subLabel?: string }> = [];
    const seen = new Set<string>();
    data.orders.slice().reverse().forEach((o) => {
      seen.add(o.order_id);
      const cus = data.consignees.find((c) => c.consignee_id === o.consignee_id);
      list.push({
        value: o.order_id,
        label: `${o.order_id} · ${o.contract_no}`,
        subLabel: `${cus?.consignee_name || o.consignee_id} · ${fmtUSD(o.contract_value)}`,
      });
    });
    data.inquiries.slice().reverse().forEach((i) => {
      if (seen.has(i.order_id)) return;
      const cus = data.consignees.find((c) => c.consignee_id === i.consignee_id);
      list.push({
        value: i.order_id,
        label: `${i.order_id} (RFQ)`,
        subLabel: `${cus?.consignee_name || i.consignee_id} · ${fmtNumber(i.net_weight_kgs)} KG`,
      });
    });
    return list;
  }, [data.orders, data.inquiries, data.consignees]);

  const selectedDetail = useMemo(() => {
    const order = data.orders.find((o) => o.order_id === selectedOrderId) || null;
    const inq = data.inquiries.find((i) => i.order_id === selectedOrderId) || null;
    const prop = data.proposals.find((p) => p.order_id === selectedOrderId) || null;
    const meta = selectedOrderId ? orderMetaMap[selectedOrderId] : undefined;
    const cusId = order?.consignee_id || inq?.consignee_id || '';
    const cus = data.consignees.find((c) => c.consignee_id === cusId) || null;
    const sch = prop ? data.schedules.find((s) => s.schedule_id === prop.schedule_id) || null : null;
    const hasSelection = Boolean(order || inq);
    const stageNum = !hasSelection ? 0 : order ? getOrderStage6Number(order, meta) : 1;
    const pct = !hasSelection ? 0 : stageNum >= 7 ? 100 : Math.round((stageNum / 6) * 100);
    return { order, inq, prop, meta, cus, sch, hasSelection, stageNum, pct };
  }, [selectedOrderId, data, orderMetaMap]);

  const freightAlerts = useMemo(() => {
    return data.schedules
      .map((sch) => ({ sch, status: computeFreightExpiryStatus(sch) }))
      .filter((item) => item.status.state === 'EXPIRED' || item.status.state === 'EXPIRING')
      .sort((a, b) => (a.status.daysLeft ?? 999) - (b.status.daysLeft ?? 999));
  }, [data.schedules]);

  return (
    <div className="space-y-5">
      {role !== 'XNK' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex bg-[#07281c] p-1 rounded-xl border-2 border-[#186635]">
            <button
              type="button"
              onClick={() => setActiveTab('sales')}
              className={`px-4 py-1.5 rounded-lg text-xs font-extrabold transition-colors cursor-pointer ${
                activeTab === 'sales' ? 'bg-[#f4d98a] text-[#07281c]' : 'text-[#d2ebe0] hover:text-white'
              }`}
            >
              Phòng Kinh doanh (Sales)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('xnk')}
              className={`px-4 py-1.5 rounded-lg text-xs font-extrabold transition-colors cursor-pointer ${
                activeTab === 'xnk' ? 'bg-[#f4d98a] text-[#07281c]' : 'text-[#d2ebe0] hover:text-white'
              }`}
            >
              Phòng XNK &amp; Logistics
            </button>
          </div>

          {role === 'SALES' && activeTab === 'xnk' && (
            <div className="px-3 py-1.5 rounded-xl bg-[#07281c] border border-[#f4d98a] text-[#f4d98a] text-xs font-semibold flex items-center gap-1.5">
              <Eye className="w-4 h-4" />
              <span>Chế độ Chỉ xem (Sales theo dõi tiến độ XNK &amp; Cut-offs)</span>
            </div>
          )}
        </div>
      )}

      {activeTab === 'sales' ? (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="kpi kpi-1" onClick={() => onNavigate('sales-inquiry')}>
              <div className="text-[11px] font-bold uppercase text-[#d2ebe0]">Chờ XNK Tính giá</div>
              <div className="text-3xl font-extrabold mt-1 font-mono">{salesMetrics.waiting.length}</div>
              <div className="text-[11px] text-[#f4d98a] mt-1">Click để mở Danh sách RFQ →</div>
            </div>
            <div className="kpi kpi-2" onClick={() => onNavigate('sales-quotation')}>
              <div className="text-[11px] font-bold uppercase text-[#d2ebe0]">Đã có giá · Chờ báo khách</div>
              <div className="text-3xl font-extrabold mt-1 font-mono">{salesMetrics.priced.length}</div>
              <div className="text-[11px] text-[#f4d98a] mt-1">Click để gửi Báo giá →</div>
            </div>
            <div className="kpi kpi-3" onClick={() => onNavigate('sales-quotation')}>
              <div className="text-[11px] font-bold uppercase text-[#fff5d6]">Đã gửi · Chờ phản hồi</div>
              <div className="text-3xl font-extrabold mt-1 font-mono">{salesMetrics.sent.length}</div>
              <div className="text-[11px] text-[#fff5d6] mt-1">{salesMetrics.overdueFollowUps.length} đơn quá 72 giờ</div>
            </div>
            <div className="kpi kpi-4" onClick={() => onNavigate('sales-contracts')}>
              <div className="text-[11px] font-bold uppercase text-[#d2ebe0]">Đã chốt · Chờ ký HĐ</div>
              <div className="text-3xl font-extrabold mt-1 font-mono">{salesMetrics.confirmed.length}</div>
              <div className="text-[11px] text-[#f4d98a] mt-1">Theo dõi ký hợp đồng →</div>
            </div>
          </div>

          {salesMetrics.overdueFollowUps.length > 0 && (
            <div className="agri-card p-4 border-l-4 border-l-[#f4d98a]">
              <div className="flex items-center gap-2 text-sm font-extrabold text-[#f4d98a] mb-2">
                <AlertCircle className="w-4 h-4" />
                <span>Cảnh báo Follow-up Báo giá quá 3 ngày (72h) chưa có phản hồi ({salesMetrics.overdueFollowUps.length} đơn)</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {salesMetrics.overdueFollowUps.map((i) => {
                  const cus = data.consignees.find((c) => c.consignee_id === i.consignee_id);
                  return (
                    <div key={i.order_id} className="agri-card-inner p-2.5 flex items-center justify-between gap-2 text-xs">
                      <div>
                        <span className="font-mono font-bold text-[#07281c]">{i.order_id}</span> ·{' '}
                        <span className="font-bold">{cus?.consignee_name || i.consignee_id}</span>
                        <div className="text-[11px] opacity-80">Ngày gửi: {i.timestamp}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onNavigate('sales-quotation', i.order_id)}
                        className="agri-btn-primary py-1 px-2.5 text-[11px]"
                      >
                        Mở Báo giá
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="agri-table-wrap">
            <div className="px-4 py-3 bg-[#0f4a33] border-b border-[#186635] flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-[#fff5d6]">5 Yêu cầu Tính giá Gần nhất</h3>
              <button type="button" onClick={() => onNavigate('sales-inquiry')} className="text-xs font-bold text-[#f4d98a] hover:underline cursor-pointer">
                Xem tất cả →
              </button>
            </div>
            <div className="agri-table-scroll">
              <table className="agri-table">
                <thead>
                  <tr>
                    <th className="text-center">Mã đơn</th>
                    <th className="text-left">Khách hàng</th>
                    <th className="text-left">Sản phẩm</th>
                    <th className="text-center">KL (KG)</th>
                    <th className="text-center">Incoterm</th>
                    <th className="text-center">Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {data.inquiries.slice(-5).reverse().map((inq) => {
                    const cus = data.consignees.find((c) => c.consignee_id === inq.consignee_id);
                    return (
                      <tr key={inq.order_id} onClick={() => onOpenTimeline(inq.order_id)} className="cursor-pointer">
                        <td className="text-center font-mono font-bold whitespace-nowrap">{inq.order_id}</td>
                        <td className="text-left font-semibold">{cus?.consignee_name || inq.consignee_id}</td>
                        <td className="text-left">{inq.product_name_vie || inq.sku_code}</td>
                        <td className="text-center font-mono font-bold whitespace-nowrap">{fmtNumber(inq.net_weight_kgs)}</td>
                        <td className="text-center font-mono font-bold whitespace-nowrap">{inq.desired_incoterm}</td>
                        <td className="text-center font-semibold">
                          <span className="keep-badge-color inline-block px-2 py-0.5 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold">
                            {inq.inquiry_status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {data.inquiries.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-6 opacity-75">Chưa có yêu cầu nào.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Tier 1: 35% Left 2x3 6-Milestone Grid + 65% Right All 6 Cut-offs Countdown Table */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
            <div className="lg:col-span-4 grid grid-cols-2 gap-3">
              {xnkMilestones.map((m, idx) => (
                <div key={m.stageNum} className={`kpi kpi-${idx + 1} flex flex-col justify-between`}>
                  <div>
                    <div className="text-[11px] font-bold leading-snug text-[#fff5d6]">{m.title}</div>
                    <div className="text-3xl font-extrabold font-mono mt-1.5 text-[#f4d98a]">{m.items.length}</div>
                  </div>
                  <div className="text-[10.5px] text-[#d2ebe0] mt-1">
                    {m.items.length > 0 ? 'Di chuột để chọn đơn' : 'Không có đơn'}
                  </div>

                  {m.items.length > 0 && (
                    <div className="kpi-popover space-y-1.5">
                      <div className="text-[10px] font-bold uppercase text-[#f4d98a] border-b border-white/15 pb-1">
                        {m.title} ({m.items.length})
                      </div>
                      {m.items.map((it) => (
                        <button
                          key={it.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedOrderId(it.id);
                          }}
                          className="w-full text-left p-1.5 rounded-lg bg-white/10 hover:bg-[#16977f] text-[11px] text-white transition-colors cursor-pointer"
                        >
                          <div className="font-bold truncate">{it.label}</div>
                          <div className="text-[10px] text-[#f4d98a]">{it.sub}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="lg:col-span-8 agri-table-wrap flex flex-col min-w-0">
              <div className="relative z-10 px-4 py-3 bg-[#0f4a33] border-b border-[#186635] flex flex-wrap items-center justify-between gap-2 shrink-0 min-h-[46px]">
                <div className="flex items-center gap-2 min-w-0">
                  <CalendarClock className="w-4 h-4 text-[#f4d98a] shrink-0" />
                  <h3 className="text-sm font-extrabold text-[#fff5d6] leading-snug">
                    Theo dõi Hạn Cut-off Đơn hàng (S/I · VGM · CFS · CY · Customs · Draft B/L)
                  </h3>
                </div>
                <span className="px-2 py-0.5 rounded bg-[#07281c] text-[#f4d98a] font-mono text-xs font-bold whitespace-nowrap shrink-0">
                  {cutoffAlerts.length} mốc đang chạy
                </span>
              </div>
              <div className="agri-table-scroll flex-1 min-h-[220px] max-h-[340px]">
                <table className="agri-table">
                  <thead>
                    <tr>
                      <th className="text-center">Hợp đồng / Đơn</th>
                      <th className="text-left">Khách hàng</th>
                      <th className="text-center">Loại Cut-off</th>
                      <th className="text-center">Thời hạn</th>
                      <th className="text-center">Đếm ngược</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cutoffAlerts.map((row, idx) => (
                      <tr
                        key={`${row.orderId}-${row.cutoffType}-${idx}`}
                        onClick={() => onNavigate('xnk-documents', row.orderId)}
                        className="cursor-pointer"
                        title="Bấm để mở Bộ chứng từ của đơn này"
                      >
                        <td className="text-center whitespace-nowrap">
                          <div className="font-mono font-bold">{row.contractNo}</div>
                          <div className="text-[10.5px] font-mono opacity-80">{row.orderId}</div>
                        </td>
                        <td className="text-left font-semibold">{row.customerName}</td>
                        <td className="text-center font-bold whitespace-nowrap">{row.cutoffType}</td>
                        <td className="text-center font-mono text-xs whitespace-nowrap">{row.cutoffDate}</td>
                        <td className="text-center whitespace-nowrap">
                          <span
                            className={`keep-badge-color inline-block px-2 py-0.5 rounded text-[11px] font-extrabold ${
                              row.countdown.tone === 'danger'
                                ? 'bg-[#8c3b3b] text-white'
                                : row.countdown.tone === 'warning'
                                ? 'bg-[#f4d98a] text-[#07281c]'
                                : 'bg-[#0f4a33] text-[#fff5d6]'
                            }`}
                          >
                            {row.countdown.label}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {cutoffAlerts.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center py-8 opacity-80">
                          Chưa có mốc Cut-off nào được nhập trên các hợp đồng đang thực hiện.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Tier 2: Synced Order Detail (65% left) + 6-Step Progress Ring & Interactive Checklist (35% right) */}
          <div className="dash-xnk-dark p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 border-b border-white/10 pb-3">
              <div>
                <h3 className="text-sm font-extrabold text-[#f4d98a]">
                  Theo dõi Chi tiết Đơn hàng &amp; Chu trình 6 Mốc Xuất khẩu
                </h3>
                <p className="text-xs text-[#9bccb8]">Đồng bộ trực tiếp giữa chi tiết thương mại – vận hành và tiến độ 6 bước</p>
              </div>
              <div className="w-72 sm:w-80">
                <SearchableCombo
                  dark
                  allowCustom={false}
                  value={selectedOrderId}
                  onChange={setSelectedOrderId}
                  options={orderSelectorOptions}
                  placeholder="Chọn Mã đơn / Hợp đồng..."
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              <div className="lg:col-span-8 space-y-3">
                {selectedDetail.order || selectedDetail.inq ? (
                  <>
                    <div className="rounded-2xl bg-white/5 border border-white/15 p-4">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-[#f4d98a] mb-2.5">
                        1. Thông tin Thương mại
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                        <div>
                          <div className="text-[#9bccb8] text-[11px]">Mã đơn</div>
                          <button
                            type="button"
                            onClick={() => onOpenTimeline(selectedOrderId)}
                            className="font-mono font-bold text-[#f4d98a] hover:underline mt-0.5 cursor-pointer"
                          >
                            {selectedOrderId}
                          </button>
                        </div>
                        <div>
                          <div className="text-[#9bccb8] text-[11px]">Số HĐ / RFQ</div>
                          <div className="font-mono font-bold text-white mt-0.5">
                            {selectedDetail.order?.contract_no || 'Chưa cấp số HĐ'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[#9bccb8] text-[11px]">Giá trị (USD)</div>
                          <div className="font-mono font-extrabold text-emerald-300 mt-0.5">
                            {fmtUSD(selectedDetail.order?.contract_value || selectedDetail.prop?.final_selling_price || 0)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[#9bccb8] text-[11px]">Khách hàng</div>
                          <div className="font-semibold text-white mt-0.5">
                            {selectedDetail.cus?.consignee_name || selectedDetail.order?.consignee_id || selectedDetail.inq?.consignee_id}
                          </div>
                        </div>
                        <div>
                          <div className="text-[#9bccb8] text-[11px]">Thanh toán</div>
                          <div className="text-white mt-0.5">
                            {selectedDetail.order?.payment_terms || selectedDetail.inq?.proposed_payment_term || '-'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[#9bccb8] text-[11px]">Incoterms 2020</div>
                          <div className="font-mono font-bold text-[#2dd4bf] mt-0.5">
                            {selectedDetail.order?.applied_incoterm || selectedDetail.prop?.recommended_incoterm || selectedDetail.inq?.desired_incoterm || '-'}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl bg-white/5 border border-white/15 p-4">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-[#2dd4bf] mb-2.5">
                        2. Hàng hóa &amp; Vận chuyển
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                        <div>
                          <div className="text-[#9bccb8] text-[11px]">Khối lượng Net / Gross</div>
                          <div className="font-mono font-bold text-white mt-0.5">
                            {fmtNumber(selectedDetail.order?.nw_confirmed_kgs || selectedDetail.inq?.net_weight_kgs || 0)} KG
                            {selectedDetail.prop?.total_gross_weight ? ` / ${fmtNumber(selectedDetail.prop.total_gross_weight)} KG` : ''}
                          </div>
                        </div>
                        <div>
                          <div className="text-[#9bccb8] text-[11px]">Container / Quy cách</div>
                          <div className="font-mono text-white mt-0.5">
                            {selectedDetail.prop?.container_type || 'FCL/LCL'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[#9bccb8] text-[11px]">POL → POD</div>
                          <div className="font-semibold text-white mt-0.5">
                            {(selectedDetail.order?.pol || selectedDetail.sch?.pol || 'Cát Lái')} → {(selectedDetail.order?.pod || selectedDetail.sch?.pod || '-')}
                          </div>
                        </div>
                        <div>
                          <div className="text-[#9bccb8] text-[11px]">Booking No.</div>
                          <div className="font-mono text-[#f4d98a] mt-0.5">{selectedDetail.meta?.bk_no || 'Chưa cập nhật'}</div>
                        </div>
                        <div>
                          <div className="text-[#9bccb8] text-[11px]">Tàu / Chuyến</div>
                          <div className="text-white mt-0.5">{selectedDetail.meta?.ves_voy || (selectedDetail.sch ? `${selectedDetail.sch.vessel} / ${selectedDetail.sch.voyage}` : '-')}</div>
                        </div>
                        <div>
                          <div className="text-[#9bccb8] text-[11px]">Cont / Seal</div>
                          <div className="font-mono text-white mt-0.5">{selectedDetail.meta?.cont_seal_list || '-'}</div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="py-10 text-center text-[#9bccb8] text-xs">Chưa có dữ liệu đơn hàng.</div>
                )}
              </div>

              <div className="lg:col-span-4 rounded-2xl bg-white/5 border border-white/15 p-4 flex flex-col items-center">
                <div className="relative w-32 h-32 mb-3">
                  <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                    <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="10" />
                    <circle
                      cx="60"
                      cy="60"
                      r="50"
                      fill="none"
                      stroke="#f4d98a"
                      strokeWidth="10"
                      strokeLinecap="round"
                      strokeDasharray={314}
                      strokeDashoffset={314 - (314 * selectedDetail.pct) / 100}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2">
                    <span className="text-2xl font-extrabold font-mono text-[#f4d98a]">
                      {selectedDetail.hasSelection ? `${selectedDetail.pct}%` : '—'}
                    </span>
                    <span className="text-[10px] text-[#9bccb8] leading-tight mt-0.5">
                      {!selectedDetail.hasSelection
                        ? 'Chưa chọn đơn'
                        : selectedDetail.stageNum >= 7
                        ? 'Hoàn tất'
                        : `Mốc ${selectedDetail.stageNum}/6`}
                    </span>
                  </div>
                </div>

                <div className="w-full space-y-1.5 text-xs">
                  {WORKFLOW_6_STAGES.map((st, idx) => {
                    const num = idx + 1;
                    const done = selectedDetail.hasSelection && (selectedDetail.stageNum > num || selectedDetail.stageNum >= 7);
                    const active = selectedDetail.hasSelection && selectedDetail.stageNum === num;
                    return (
                      <div
                        key={st}
                        className={`px-2.5 py-1.5 rounded-lg flex items-center gap-2 border ${
                          done
                            ? 'bg-[#0f4a33] border-[#16977f] text-[#d2ebe0]'
                            : active
                            ? 'bg-[#f4d98a] border-[#186635] text-[#07281c] font-extrabold'
                            : 'bg-white/5 border-white/10 text-[#9bccb8]/70'
                        }`}
                      >
                        {done ? <CheckCircle2 className="w-3.5 h-3.5 text-[#2dd4bf] shrink-0" /> : <Clock className="w-3.5 h-3.5 shrink-0" />}
                        <span className="truncate">{st}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Tier 3: Full-width Dynamic Transit-Time Freight Expiry Tracker (Expired & Expiring Soon only) */}
          <div className="agri-table-wrap">
            <div className="px-4 py-3 bg-[#0f4a33] border-b border-[#186635] flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Ship className="w-4 h-4 text-[#f4d98a]" />
                <h3 className="text-sm font-extrabold text-[#fff5d6]">
                  Giám sát Hạn Giá Cước Tàu theo Transit-Time Động ({freightAlerts.length} tuyến cần lưu ý)
                </h3>
              </div>
              <span className="text-[11px] text-[#9bccb8]">
                Ngưỡng động: ≤7d→4d · ≤18d→7d · ≤30d→10d · &gt;30d→14d (+2d nếu có POT/Reefer)
              </span>
            </div>
            <div className="agri-table-scroll max-h-[340px]">
              <table className="agri-table">
                <thead>
                  <tr>
                    <th className="text-center">Mã Lịch</th>
                    <th className="text-left">Hãng tàu</th>
                    <th className="text-left">Tuyến (POL → POD)</th>
                    <th className="text-center">ETD / ETA</th>
                    <th className="text-center">Transit / Ngưỡng</th>
                    <th className="text-center">Hết hạn cước</th>
                    <th className="text-center">Cảnh báo</th>
                  </tr>
                </thead>
                <tbody>
                  {freightAlerts.map(({ sch, status }) => (
                    <tr
                      key={sch.schedule_id}
                      onClick={() => onNavigate('xnk-shipping', sch.schedule_id)}
                      className="cursor-pointer"
                    >
                      <td className="text-center font-mono font-bold underline whitespace-nowrap">{sch.schedule_id}</td>
                      <td className="text-left font-semibold">{sch.shipping_line}</td>
                      <td className="text-left">
                        <div className="font-semibold">
                          {deduplicatePortName(sch.pol)} → {deduplicatePortName(sch.pod)}
                        </div>
                        {sch.pot && sch.pot !== '-' && (
                          <div className="text-[10.5px] opacity-80 flex items-center gap-1">
                            <Anchor className="w-3 h-3" /> POT: {sch.pot}
                          </div>
                        )}
                      </td>
                      <td className="text-center font-mono text-xs whitespace-nowrap">
                        <div>ETD: {formatDateDDMMYYYY(sch.etd)}</div>
                        <div>ETA: {formatDateDDMMYYYY(sch.eta)}</div>
                      </td>
                      <td className="text-center font-mono whitespace-nowrap">{status.transitDays}d / ≤{status.threshold}d</td>
                      <td className="text-center font-mono whitespace-nowrap">{formatDateDDMMYYYY(sch.expiry_date)}</td>
                      <td className="text-center whitespace-nowrap">
                        <span
                          className={`keep-badge-color inline-block px-2 py-0.5 rounded text-[11px] font-extrabold ${
                            status.state === 'EXPIRED'
                              ? 'bg-[#8c3b3b] text-white'
                              : 'bg-[#f4d98a] text-[#07281c]'
                          }`}
                        >
                          {status.daysLeft !== null && status.daysLeft < 0
                            ? `Quá hạn ${Math.abs(status.daysLeft)}d`
                            : `Sắp hết hạn (${status.daysLeft}d)`}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {freightAlerts.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-6 opacity-80">
                        Tất cả biểu cước lịch tàu hiện đang còn hạn an toàn.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
