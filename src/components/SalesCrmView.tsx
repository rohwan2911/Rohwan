import React, { useMemo, useRef, useState } from 'react';
import {
  Plus,
  Zap,
  Trash2,
  Eye,
  ExternalLink,
  CheckCircle2,
  RotateCcw,
  FileText,
  Edit3,
  UserPlus,
  Calendar,
} from 'lucide-react';
import type {
  AppDataState,
  ConsigneeDirectory,
  InquiryQuotation,
  OrderItem,
  OrderLogisticsMeta,
  ProposalExtraMeta,
  SysUser,
  ViewId,
} from '../types';
import {
  classifyCustomerByCount,
  cleanQuoteNoForCustomer,
  computeOrderPalletSummary,
  fmtNumber,
  fmtUSD,
  getPackingOptionsForProduct,
  INCOTERMS_2020_MATRIX,
  isConfirmedStatus,
  isContractCreatedStatus,
  isPricedReadyStatus,
  isQuickCaptureStatus,
  isSentWaitingCustomerStatus,
  normalizePlainText,
  parseOrderItems,
  stripItemsTag,
  todayIsoDate,
  toNum,
  WORKFLOW_STATUS,
} from '../utils/calculations';
import { SearchableCombo } from './SearchableCombo';
import type { PreviewModalTarget } from './Modals';
import { isStoredDocumentPath, openDocumentWithSignedUrl } from '../services/supabaseService';

interface SalesCrmViewProps {
  activeView: Extract<ViewId, 'sales-inquiry' | 'sales-quotation' | 'sales-contracts' | 'sales-customers'>;
  data: AppDataState;
  currentUser: SysUser;
  quickSearch: string;
  orderMetaMap: Record<string, OrderLogisticsMeta>;
  proposalMetaMap: Record<string, ProposalExtraMeta>;
  onSaveInquiry: (params: {
    existingOrderId?: string;
    saleRep: string;
    customerInput: {
      consignee_id?: string;
      consignee_name: string;
      country: string;
      address: string;
      tax: string;
      contact_person: string;
      phone: string;
      email: string;
      fax: string;
      default_payment_term: string;
    };
    sku_code: string;
    product_name_vie: string;
    net_weight_kgs: number;
    desired_delivery_date: string;
    desired_incoterm: string;
    proposed_payment_term: string;
    inquiry_status: string;
    note: string;
    order_items: string;
    quotation_mode: string;
  }) => Promise<void>;
  onDeletePreContract: (orderId: string) => Promise<void>;
  onConfirmOrder: (orderId: string) => Promise<void>;
  onRequestReprice: (orderId: string, reason: string) => Promise<void>;
  onConfirmSignedContract: (orderId: string) => Promise<void>;
  onUpsertConsignee: (row: ConsigneeDirectory, isEdit: boolean) => Promise<void>;
  onDeleteConsignee: (consigneeId: string) => Promise<void>;
  onOpenPreview: (target: PreviewModalTarget) => void;
  onOpenTimeline: (orderId: string) => void;
  onRequestConfirm: (title: string, message: string, onConfirm: () => Promise<void>, danger?: boolean) => void;
  onToast: (type: 'success' | 'error' | 'info' | 'warning', title: string) => void;
}

interface DraftLine {
  sku: string;
  name: string;
  name_eng: string;
  weight: number;
  packingCode: string;
}

export const SalesCrmView: React.FC<SalesCrmViewProps> = ({
  activeView,
  data,
  currentUser,
  quickSearch,
  orderMetaMap,
  proposalMetaMap,
  onSaveInquiry,
  onDeletePreContract,
  onConfirmOrder,
  onRequestReprice,
  onConfirmSignedContract,
  onUpsertConsignee,
  onDeleteConsignee,
  onOpenPreview,
  onOpenTimeline,
  onRequestConfirm,
  onToast,
}) => {
  // Quick Capture state
  const [quickCusName, setQuickCusName] = useState('');
  const [quickCountry, setQuickCountry] = useState('');
  const [quickContact, setQuickContact] = useState('');
  const [quickEmail, setQuickEmail] = useState('');
  const [quickPhone, setQuickPhone] = useState('');
  const [quickNote, setQuickNote] = useState('');
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickFilterText, setQuickFilterText] = useState('');
  const [quickFilterCountry, setQuickFilterCountry] = useState('');

  // Full RFQ Modal state
  const [rfqModalOpen, setRfqModalOpen] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<string | undefined>(undefined);
  const [selectedConsigneeId, setSelectedConsigneeId] = useState('');
  const [cusName, setCusName] = useState('');
  const [cusCountry, setCusCountry] = useState('');
  const [cusAddress, setCusAddress] = useState('');
  const [cusTax, setCusTax] = useState('');
  const [cusContact, setCusContact] = useState('');
  const [cusPhone, setCusPhone] = useState('');
  const [cusEmail, setCusEmail] = useState('');
  const [cusFax, setCusFax] = useState('');
  const [desiredDate, setDesiredDate] = useState('');
  const [desiredIncoterm, setDesiredIncoterm] = useState('CIF');
  const [paymentTerm, setPaymentTerm] = useState('T/T 30% Deposit / 70% against B/L copy');
  const [quoteMode, setQuoteMode] = useState<'SINGLE' | 'COMPARISON'>('SINGLE');
  const [usePallet, setUsePallet] = useState(false);
  const [rfqNote, setRfqNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [rfqSaving, setRfqSaving] = useState(false);

  // Contracts Pending Signature filter
  const [contractFilter, setContractFilter] = useState<'ALL' | 'PENDING' | 'SIGNED'>('ALL');

  // Reprice reason modal
  const [repriceOrderId, setRepriceOrderId] = useState<string | null>(null);
  const [repriceReason, setRepriceReason] = useState('');

  // Customer edit modal
  const [cusModalOpen, setCusModalOpen] = useState(false);
  const [cusForm, setCusForm] = useState<ConsigneeDirectory | null>(null);
  const [cusIsEdit, setCusIsEdit] = useState(false);
  const dateInputRef = useRef<HTMLInputElement>(null);

  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    data.schedules.forEach((s) => s.country && set.add(s.country.trim()));
    data.consignees.forEach((c) => c.country && set.add(c.country.trim()));
    return Array.from(set).sort().map((c) => ({ value: c, label: c }));
  }, [data.schedules, data.consignees]);

  const consigneeOptions = useMemo(() => {
    const countryQ = cusCountry.trim().toLowerCase();
    return data.consignees
      .filter((c) => !countryQ || c.country.trim().toLowerCase().includes(countryQ))
      .map((c) => ({
        value: c.consignee_id,
        label: `${c.consignee_name} (${c.consignee_id})`,
        subLabel: `${c.country} · ${c.email || c.phone || ''}`,
      }));
  }, [data.consignees, cusCountry]);

  const productOptions = useMemo(() => {
    return data.products.map((p) => ({
      value: p.sku_code,
      label: `${p.sku_code} – ${p.product_name_vie}`,
      subLabel: `${p.product_name_eng} · $${toNum(p.unit_price).toFixed(2)}/kg`,
    }));
  }, [data.products]);

  const paymentOptions = useMemo(() => {
    const lks = data.lookups.filter((l) => String(l.category).toUpperCase().includes('PAYMENT'));
    const defaults = [
      'T/T 30% Deposit / 70% against B/L copy',
      'T/T 100% in advance',
      'Irrevocable L/C at sight',
      'D/P at sight',
      'D/A 30 days',
    ];
    const list = lks.length > 0 ? lks.map((l) => l.contract_text_eng || l.display_name_vie) : defaults;
    return list.map((v) => ({ value: v, label: v }));
  }, [data.lookups]);

  const openFullRfqModal = (fromInquiry?: InquiryQuotation) => {
    if (fromInquiry) {
      setEditingOrderId(fromInquiry.order_id);
      const cus = data.consignees.find((c) => c.consignee_id === fromInquiry.consignee_id);
      setSelectedConsigneeId(fromInquiry.consignee_id || '');
      setCusName(cus?.consignee_name || fromInquiry.consignee_id || '');
      setCusCountry(cus?.country || '');
      setCusAddress(fromInquiry.address || cus?.address || '');
      setCusTax(cus?.tax || '');
      setCusContact(fromInquiry.contact || cus?.contact_person || '');
      setCusPhone(fromInquiry.phone || cus?.phone || '');
      setCusEmail(fromInquiry.email || cus?.email || '');
      setCusFax(cus?.fax || '');
      setDesiredDate(fromInquiry.desired_delivery_date || '');
      setDesiredIncoterm(fromInquiry.desired_incoterm || 'CIF');
      setPaymentTerm(fromInquiry.proposed_payment_term || cus?.default_payment_term || 'T/T 30% Deposit / 70% against B/L copy');
      setQuoteMode(String(fromInquiry.quotation_mode || '').toUpperCase().includes('COMP') ? 'COMPARISON' : 'SINGLE');
      const parsed = parseOrderItems(fromInquiry, data.products, data.pricingRates);
      setUsePallet(parsed.some((it) => it.palletCode === 'PKG-PLT-YES'));
      setRfqNote(stripItemsTag(fromInquiry.note));
      setLines(
        parsed.length > 0
          ? parsed.map((p) => ({
              sku: p.sku,
              name: p.name,
              name_eng: p.name_eng || p.name,
              weight: p.weight,
              packingCode: p.packingCode || 'PKG-CTN-10K',
            }))
          : [{ sku: data.products[0]?.sku_code || '', name: data.products[0]?.product_name_vie || '', name_eng: data.products[0]?.product_name_eng || '', weight: 10000, packingCode: 'PKG-CTN-10K' }]
      );
    } else {
      setEditingOrderId(undefined);
      setSelectedConsigneeId('');
      setCusName('');
      setCusCountry('');
      setCusAddress('');
      setCusTax('');
      setCusContact('');
      setCusPhone('');
      setCusEmail('');
      setCusFax('');
      setDesiredDate('');
      setDesiredIncoterm('CIF');
      setPaymentTerm('T/T 30% Deposit / 70% against B/L copy');
      setQuoteMode('SINGLE');
      setUsePallet(false);
      setRfqNote('');
      const first = data.products[0];
      setLines([
        {
          sku: first?.sku_code || '',
          name: first?.product_name_vie || '',
          name_eng: first?.product_name_eng || '',
          weight: 10000,
          packingCode: 'PKG-CTN-10K',
        },
      ]);
    }
    setRfqModalOpen(true);
  };

  const handleSelectConsignee = (val: string) => {
    const trimmed = val.trim();
    if (!trimmed) {
      setSelectedConsigneeId('');
      setCusName('');
      return;
    }
    const low = trimmed.toLowerCase();
    const cus = data.consignees.find(
      (c) =>
        c.consignee_id.trim().toLowerCase() === low ||
        c.consignee_name.trim().toLowerCase() === low ||
        `${c.consignee_name} (${c.consignee_id})`.trim().toLowerCase() === low
    );
    if (cus) {
      setSelectedConsigneeId(cus.consignee_id);
      setCusName(cus.consignee_name);
      setCusCountry(cus.country);
      setCusAddress(cus.address);
      setCusTax(normalizePlainText(cus.tax));
      setCusContact(cus.contact_person);
      setCusPhone(normalizePlainText(cus.phone));
      setCusEmail(cus.email);
      setCusFax(normalizePlainText(cus.fax));
      if (cus.default_payment_term) setPaymentTerm(cus.default_payment_term);
    } else {
      setSelectedConsigneeId('');
      setCusName(val);
    }
  };

  const handleSaveQuickCapture = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickCusName.trim()) {
      onToast('warning', 'Vui lòng nhập Tên khách hàng để ghi nhận nhanh.');
      return;
    }
    const cleanQuickName = quickCusName.trim().toLowerCase();
    const cleanQuickEmail = quickEmail.trim().toLowerCase();
    const matchedCus = data.consignees.find(
      (c) =>
        c.consignee_name.trim().toLowerCase() === cleanQuickName ||
        (cleanQuickEmail && c.email.trim().toLowerCase() === cleanQuickEmail)
    );
    setQuickSaving(true);
    try {
      await onSaveInquiry({
        saleRep: currentUser.full_name,
        customerInput: {
          consignee_id: matchedCus?.consignee_id,
          consignee_name: matchedCus?.consignee_name || quickCusName.trim(),
          country: quickCountry.trim() || matchedCus?.country || '',
          address: matchedCus?.address || '',
          tax: matchedCus?.tax || '',
          contact_person: quickContact.trim() || matchedCus?.contact_person || '',
          phone: quickPhone.trim() || matchedCus?.phone || '',
          email: quickEmail.trim() || matchedCus?.email || '',
          fax: matchedCus?.fax || '',
          default_payment_term: matchedCus?.default_payment_term || 'T/T 30/70',
        },
        sku_code: '',
        product_name_vie: '',
        net_weight_kgs: 0,
        desired_delivery_date: '',
        desired_incoterm: 'CIF',
        proposed_payment_term: 'T/T 30/70',
        inquiry_status: WORKFLOW_STATUS.QUICK_CAPTURE,
        note: quickNote.trim(),
        order_items: '[]',
        quotation_mode: 'SINGLE',
      });
      setQuickCusName('');
      setQuickCountry('');
      setQuickContact('');
      setQuickEmail('');
      setQuickPhone('');
      setQuickNote('');
      onToast('success', 'Đã ghi nhận khách hàng nhanh.');
    } catch (err: any) {
      onToast('error', err?.message || 'Lỗi ghi nhận nhanh.');
    } finally {
      setQuickSaving(false);
    }
  };

  const handleSubmitFullRfq = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cusName.trim()) {
      onToast('warning', 'Vui lòng chọn hoặc nhập tên khách hàng.');
      return;
    }
    const validLines = lines.filter((l) => l.sku && toNum(l.weight) > 0);
    if (validLines.length === 0) {
      onToast('warning', 'Vui lòng chọn ít nhất 1 sản phẩm với khối lượng > 0 KG.');
      return;
    }

    const orderItems: OrderItem[] = validLines.map((l) => {
      const prod = data.products.find((p) => p.sku_code === l.sku);
      const packOpts = getPackingOptionsForProduct(prod, data.pricingRates, data.lookups);
      const pk = packOpts.find((o) => o.code === l.packingCode);
      return {
        sku: l.sku,
        name: l.name || prod?.product_name_vie || l.sku,
        name_eng: l.name_eng || prod?.product_name_eng || l.name,
        weight: toNum(l.weight),
        packingCode: l.packingCode,
        packingName: pk?.name || l.packingCode,
        packingExtra: pk?.rate || 0,
        palletCode: usePallet ? 'PKG-PLT-YES' : 'PKG-PLT-NO',
        cartons: 0,
        pallets: 0,
        packingCost: 0,
      };
    });

    const totalWeight = orderItems.reduce((s, it) => s + it.weight, 0);
    const cleanNameLow = cusName.trim().toLowerCase();
    const cleanEmailLow = cusEmail.trim().toLowerCase();
    const cleanTaxLow = cusTax.trim().toLowerCase();
    const resolvedExisting =
      (selectedConsigneeId && data.consignees.find((c) => c.consignee_id === selectedConsigneeId)) ||
      data.consignees.find(
        (c) =>
          c.consignee_name.trim().toLowerCase() === cleanNameLow ||
          (cleanEmailLow && c.email.trim().toLowerCase() === cleanEmailLow) ||
          (cleanTaxLow && normalizePlainText(c.tax).toLowerCase() === cleanTaxLow)
      );
    setRfqSaving(true);
    try {
      await onSaveInquiry({
        existingOrderId: editingOrderId,
        saleRep: currentUser.full_name,
        customerInput: {
          consignee_id: resolvedExisting?.consignee_id || selectedConsigneeId || undefined,
          consignee_name: cusName.trim(),
          country: cusCountry.trim(),
          address: cusAddress.trim(),
          tax: cusTax.trim(),
          contact_person: cusContact.trim(),
          phone: cusPhone.trim(),
          email: cusEmail.trim(),
          fax: cusFax.trim(),
          default_payment_term: paymentTerm,
        },
        sku_code: orderItems.map((i) => i.sku).join(', '),
        product_name_vie: orderItems.map((i) => i.name).join(', '),
        net_weight_kgs: totalWeight,
        desired_delivery_date: desiredDate,
        desired_incoterm: desiredIncoterm,
        proposed_payment_term: paymentTerm,
        inquiry_status: WORKFLOW_STATUS.WAITING_PRICING,
        note: rfqNote.trim(),
        order_items: JSON.stringify(orderItems),
        quotation_mode: quoteMode,
      });
      setRfqModalOpen(false);
      onToast('success', editingOrderId ? `Đã cập nhật RFQ ${editingOrderId} và chuyển XNK.` : 'Đã tạo Yêu cầu Tính giá (RFQ) chuyển sang XNK.');
    } catch (err: any) {
      onToast('error', err?.message || 'Lỗi lưu RFQ.');
    } finally {
      setRfqSaving(false);
    }
  };

  const quickSearchLower = quickSearch.trim().toLowerCase();

  const filteredInquiries = useMemo(() => {
    return data.inquiries
      .filter((i) => {
        if (!quickSearchLower) return true;
        const cus = data.consignees.find((c) => c.consignee_id === i.consignee_id);
        const hay = `${i.order_id} ${i.consignee_id} ${cus?.consignee_name || ''} ${i.sku_code} ${i.product_name_vie} ${i.inquiry_status}`.toLowerCase();
        return hay.includes(quickSearchLower);
      })
      .slice()
      .reverse();
  }, [data.inquiries, data.consignees, quickSearchLower]);

  const quickCaptures = useMemo(() => {
    const fLow = quickFilterText.trim().toLowerCase();
    const cLow = quickFilterCountry.trim().toLowerCase();
    return filteredInquiries
      .filter((i) => isQuickCaptureStatus(i.inquiry_status))
      .filter((i) => {
        const cus = data.consignees.find((c) => c.consignee_id === i.consignee_id);
        if (cLow && !(cus?.country || '').toLowerCase().includes(cLow)) return false;
        if (!fLow) return true;
        const hay = `${i.order_id} ${cus?.consignee_name || ''} ${cus?.country || ''} ${i.contact || cus?.contact_person || ''} ${i.email || cus?.email || ''} ${i.note || ''}`.toLowerCase();
        return hay.includes(fLow);
      });
  }, [filteredInquiries, data.consignees, quickFilterText, quickFilterCountry]);

  const quotationRows = useMemo(() => {
    return filteredInquiries.filter((i) => !isQuickCaptureStatus(i.inquiry_status));
  }, [filteredInquiries]);

  const salesContractsList = useMemo(() => {
    return data.orders
      .filter((ord) => {
        const meta = orderMetaMap[ord.order_id];
        const st = String(ord.fulfillment_status || '').toLowerCase();
        const isPending = !meta?.is_locked && (meta?.sent_to_sales || st.includes('chờ sales') || st.includes('2.'));
        const isSigned = Boolean(meta?.is_locked || st.includes('3.') || st.includes('4.') || st.includes('5.') || st.includes('6.') || st.includes('hoàn tất'));
        if (contractFilter === 'PENDING') return isPending;
        if (contractFilter === 'SIGNED') return isSigned;
        return isPending || isSigned;
      })
      .filter((ord) => {
        if (!quickSearchLower) return true;
        const cus = data.consignees.find((c) => c.consignee_id === ord.consignee_id);
        return `${ord.order_id} ${ord.contract_no} ${cus?.consignee_name || ''}`.toLowerCase().includes(quickSearchLower);
      })
      .slice()
      .reverse();
  }, [data.orders, data.consignees, orderMetaMap, contractFilter, quickSearchLower]);

  if (activeView === 'sales-inquiry') {
    return (
      <div className="space-y-5">
        {/* Quick Capture Top Card */}
        <div className="agri-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="text-sm font-extrabold text-[#fff5d6] flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-[#f4d98a]" />
                Ghi nhận nhanh Thông tin Khách hàng (Chờ tư vấn)
              </h3>
              <p className="text-[11px] text-[#d2ebe0]">Lưu nhanh khách tiềm năng trước khi chuyển thành Yêu cầu Tính giá (Full RFQ)</p>
            </div>
            <button type="button" onClick={() => openFullRfqModal()} className="agri-btn-gold flex items-center gap-1.5">
              <Plus className="w-4 h-4" />
              <span>Tạo Yêu cầu Tính giá (Full RFQ)</span>
            </button>
          </div>

          <form onSubmit={handleSaveQuickCapture} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 items-end">
            <div>
              <label className="block text-[11px] font-bold text-[#fff5d6] mb-1">Tên công ty / Khách *</label>
              <input value={quickCusName} onChange={(e) => setQuickCusName(e.target.value)} className="agri-input text-xs" placeholder="VD: Fresh Asia Trading" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-[#fff5d6] mb-1">Quốc gia</label>
              <SearchableCombo
                value={quickCountry}
                onChange={setQuickCountry}
                options={countryOptions}
                allowCustom
                placeholder="Chọn hoặc nhập Quốc gia..."
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-[#fff5d6] mb-1">Người liên hệ</label>
              <input value={quickContact} onChange={(e) => setQuickContact(e.target.value)} className="agri-input text-xs" placeholder="Mr./Ms." />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-[#fff5d6] mb-1">Email</label>
              <input value={quickEmail} onChange={(e) => setQuickEmail(e.target.value)} className="agri-input text-xs" placeholder="buyer@company.com" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-[#fff5d6] mb-1">Ghi chú nhu cầu</label>
              <input value={quickNote} onChange={(e) => setQuickNote(e.target.value)} className="agri-input text-xs" placeholder="Sản phẩm quan tâm..." />
            </div>
            <button type="submit" disabled={quickSaving} className="agri-btn-primary py-2">
              {quickSaving ? 'Loading...' : 'Lưu Ghi nhận nhanh'}
            </button>
          </form>
        </div>

        {/* Dedicated Quick-Log Table with Filter */}
        <div className="agri-table-wrap">
          <div className="px-4 py-3 bg-[#0f4a33] border-b border-[#186635] flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-extrabold text-[#fff5d6]">
              Bảng Khách hàng Ghi nhận nhanh ({quickCaptures.length})
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={quickFilterText}
                onChange={(e) => setQuickFilterText(e.target.value)}
                placeholder="Lọc tên khách, liên hệ, ghi chú..."
                className="px-2.5 py-1 rounded-lg bg-[#07281c] border border-[#186635] text-xs text-[#fff5d6] placeholder-[#9bccb8]/70 outline-none w-52"
              />
              <input
                value={quickFilterCountry}
                onChange={(e) => setQuickFilterCountry(e.target.value)}
                placeholder="Lọc quốc gia..."
                className="px-2.5 py-1 rounded-lg bg-[#07281c] border border-[#186635] text-xs text-[#fff5d6] placeholder-[#9bccb8]/70 outline-none w-36"
              />
            </div>
          </div>
          <div className="agri-table-scroll">
            <table className="agri-table">
              <thead>
                <tr>
                  <th className="text-center">Mã đơn</th>
                  <th className="text-left">Khách hàng / Quốc gia</th>
                  <th className="text-left">Người liên hệ &amp; Email</th>
                  <th className="text-left">Ghi chú nhu cầu</th>
                  <th className="text-center">Trạng thái</th>
                  <th className="text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {quickCaptures.map((q) => {
                  const cus = data.consignees.find((c) => c.consignee_id === q.consignee_id);
                  return (
                    <tr key={q.order_id}>
                      <td className="text-center">
                        <button type="button" onClick={() => onOpenTimeline(q.order_id)} className="font-mono font-bold hover:underline cursor-pointer">
                          {q.order_id}
                        </button>
                        <div className="text-[10.5px] opacity-80">{q.timestamp?.slice(0, 10)}</div>
                      </td>
                      <td className="text-left">
                        <div className="font-bold">{cus?.consignee_name || q.consignee_id}</div>
                        <div className="text-[11px] opacity-80">{cus?.country || '-'} · Sale: {q.sale_rep}</div>
                      </td>
                      <td className="text-left text-xs">
                        <div>{q.contact || cus?.contact_person || '-'}</div>
                        <div className="text-[11px] opacity-80">{q.email || cus?.email || '-'}</div>
                      </td>
                      <td className="text-left text-xs">{stripItemsTag(q.note) || <span className="opacity-65 italic">Chờ tư vấn</span>}</td>
                      <td className="text-center">
                        <span className="keep-badge-color inline-block px-2 py-0.5 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold">
                          {q.inquiry_status}
                        </span>
                      </td>
                      <td className="text-center">
                        <div className="inline-flex flex-wrap justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => openFullRfqModal(q)}
                            className="keep-btn-style px-2.5 py-1 rounded bg-[#0f4a33] text-[#f4d98a] text-[11px] font-bold cursor-pointer"
                          >
                            Chuyển thành RFQ
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onRequestConfirm(
                                'Xóa ghi nhận nhanh?',
                                `Xác nhận xóa bản ghi ${q.order_id}?`,
                                () => onDeletePreContract(q.order_id),
                                true
                              )
                            }
                            className="keep-btn-style px-2 py-1 rounded bg-[#8c3b3b] text-white text-[11px] font-bold cursor-pointer inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3 h-3" /> Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {quickCaptures.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-6 opacity-75">
                      Chưa có khách hàng ghi nhận nhanh nào phù hợp bộ lọc.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* All Inquiries Table (Full RFQs) */}
        <div className="agri-table-wrap">
          <div className="px-4 py-3 bg-[#0f4a33] border-b border-[#186635] flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-[#fff5d6]">Danh sách Yêu cầu Tính giá (RFQ) ({quotationRows.length})</h3>
          </div>
          <div className="agri-table-scroll">
            <table className="agri-table">
              <thead>
                <tr>
                  <th className="text-center">Mã đơn</th>
                  <th className="text-left">Khách hàng</th>
                  <th className="text-left">Sản phẩm &amp; Đóng gói</th>
                  <th className="text-center">KL Net</th>
                  <th className="text-center">Incoterm / TT</th>
                  <th className="text-center">Trạng thái</th>
                  <th className="text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {quotationRows.map((inq) => {
                  const cus = data.consignees.find((c) => c.consignee_id === inq.consignee_id);
                  const items = parseOrderItems(inq, data.products, data.pricingRates);
                  const canDelete = !isContractCreatedStatus(inq.inquiry_status) && !data.orders.some((o) => o.order_id === inq.order_id && orderMetaMap[o.order_id]?.is_locked);
                  return (
                    <tr key={inq.order_id}>
                      <td className="text-center">
                        <button type="button" onClick={() => onOpenTimeline(inq.order_id)} className="font-mono font-bold hover:underline cursor-pointer">
                          {inq.order_id}
                        </button>
                        <div className="text-[10.5px] opacity-80">{inq.timestamp?.slice(0, 10)}</div>
                      </td>
                      <td className="text-left">
                        <div className="font-bold">{cus?.consignee_name || inq.consignee_id}</div>
                        <div className="text-[11px] opacity-80">{cus?.country || '-'} · Sale: {inq.sale_rep}</div>
                      </td>
                      <td className="text-left">
                        {items.length > 0 ? (
                          <div className="space-y-0.5">
                            {items.map((it, idx) => (
                              <div key={idx} className="text-xs">
                                <span className="font-bold">{it.name}</span>{' '}
                                <span className="font-mono font-bold">({fmtNumber(it.weight)} KG)</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="italic opacity-75">-</span>
                        )}
                      </td>
                      <td className="text-center font-mono font-bold">{fmtNumber(inq.net_weight_kgs)} KG</td>
                      <td className="text-center">
                        <div className="font-mono font-bold">{inq.desired_incoterm}</div>
                        <div className="text-[10.5px] opacity-80 max-w-[160px] mx-auto truncate">{inq.proposed_payment_term}</div>
                      </td>
                      <td className="text-center">
                        <span className="keep-badge-color inline-block px-2 py-0.5 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold">
                          {inq.inquiry_status}
                        </span>
                      </td>
                      <td className="text-center">
                        <div className="inline-flex flex-wrap justify-center gap-1">
                          {canDelete && (
                            <>
                              <button
                                type="button"
                                onClick={() => openFullRfqModal(inq)}
                                className="keep-btn-style px-2 py-1 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold cursor-pointer"
                              >
                                Sửa RFQ
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  onRequestConfirm(
                                    'Hủy & Xóa đơn trước Hợp đồng?',
                                    `Đơn ${inq.order_id} sẽ bị xóa khỏi danh sách yêu cầu, bảng tính giá (nếu có) và cập nhật lại số đơn của khách hàng.`,
                                    () => onDeletePreContract(inq.order_id),
                                    true
                                  )
                                }
                                className="keep-btn-style px-2 py-1 rounded bg-[#8c3b3b] text-white text-[11px] font-bold cursor-pointer"
                              >
                                Hủy
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {quotationRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-6 opacity-75">
                      Chưa có Yêu cầu Tính giá (RFQ) nào.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Full RFQ Modal */}
        {rfqModalOpen && (
          <div className="fixed inset-0 z-50 bg-[#07281c]/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
            <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto text-[#f4f8f5]">
              <div className="px-5 py-3.5 bg-[#0f4a33] border-b-2 border-[#186635] flex items-center justify-between">
                <h3 className="text-base font-extrabold text-[#fff5d6]">
                  {editingOrderId ? `Chuyển đổi / Sửa Yêu cầu Tính giá (${editingOrderId})` : 'Tạo Yêu cầu Tính giá Mới (Full RFQ)'}
                </h3>
                <button type="button" onClick={() => setRfqModalOpen(false)} className="px-2.5 py-1 rounded bg-[#8c3b3b] text-white text-xs font-bold cursor-pointer">
                  Đóng
                </button>
              </div>

              <form onSubmit={handleSubmitFullRfq} className="p-5 space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-bold text-[#fff5d6] mb-1">Lọc theo Quốc gia (Chọn hoặc nhập mới)</label>
                    <SearchableCombo
                      value={cusCountry}
                      onChange={setCusCountry}
                      options={countryOptions}
                      allowCustom
                      placeholder="Chọn hoặc nhập Quốc gia..."
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-bold text-[#fff5d6] mb-1">Chọn Khách hàng có sẵn (tùy chọn)</label>
                    <SearchableCombo
                      value={selectedConsigneeId || cusName}
                      onChange={handleSelectConsignee}
                      options={consigneeOptions}
                      placeholder="Tìm khách hàng cũ hoặc nhập tên mới..."
                      allowCustom
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-[#fff5d6] mb-1">Tên Khách hàng / Công ty *</label>
                    <input
                      value={cusName}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCusName(val);
                        const low = val.trim().toLowerCase();
                        const matched = low
                          ? data.consignees.find((c) => c.consignee_name.trim().toLowerCase() === low)
                          : undefined;
                        if (matched) {
                          setSelectedConsigneeId(matched.consignee_id);
                          if (!cusCountry) setCusCountry(matched.country);
                          if (!cusAddress) setCusAddress(matched.address);
                          if (!cusTax) setCusTax(normalizePlainText(matched.tax));
                          if (!cusContact) setCusContact(matched.contact_person);
                          if (!cusPhone) setCusPhone(normalizePlainText(matched.phone));
                          if (!cusEmail) setCusEmail(matched.email);
                          if (!cusFax) setCusFax(normalizePlainText(matched.fax));
                        } else {
                          setSelectedConsigneeId('');
                        }
                      }}
                      placeholder="Nhập tên khách hàng hoặc công ty mới..."
                      className="agri-input"
                      required
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-[#fff5d6] mb-1">Người liên hệ</label>
                    <input value={cusContact} onChange={(e) => setCusContact(e.target.value)} className="agri-input" />
                  </div>
                  <div>
                    <label className="block font-bold text-[#fff5d6] mb-1">Email</label>
                    <input value={cusEmail} onChange={(e) => setCusEmail(e.target.value)} className="agri-input" />
                  </div>
                  <div>
                    <label className="block font-bold text-[#fff5d6] mb-1">Điện thoại (Plain Text)</label>
                    <input value={cusPhone} onChange={(e) => setCusPhone(e.target.value)} className="agri-input" />
                  </div>
                  <div>
                    <label className="block font-bold text-[#fff5d6] mb-1">Tax ID / Mã số thuế</label>
                    <input value={cusTax} onChange={(e) => setCusTax(e.target.value)} className="agri-input" />
                  </div>
                  <div>
                    <label className="block font-bold text-[#fff5d6] mb-1">Địa chỉ</label>
                    <input value={cusAddress} onChange={(e) => setCusAddress(e.target.value)} className="agri-input" />
                  </div>
                </div>

                {/* Product Lines */}
                <div className="agri-card-inner p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-[#07281c] uppercase text-[11px]">Danh sách Mặt hàng Xuất khẩu</span>
                    <button
                      type="button"
                      onClick={() => {
                        const first = data.products[0];
                        setLines((prev) => [...prev, { sku: first?.sku_code || '', name: first?.product_name_vie || '', name_eng: first?.product_name_eng || '', weight: 5000, packingCode: 'PKG-CTN-10K' }]);
                      }}
                      className="px-2.5 py-1 rounded bg-[#0f4a33] text-[#f4d98a] font-bold text-[11px] cursor-pointer"
                    >
                      + Thêm sản phẩm
                    </button>
                  </div>

                  {lines.map((ln, idx) => {
                    const prod = data.products.find((p) => p.sku_code === ln.sku);
                    const packOpts = getPackingOptionsForProduct(prod, data.pricingRates, data.lookups);
                    return (
                      <div key={idx} className="bg-white/60 p-3 rounded-xl border border-[#186635]/40 space-y-2.5">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-end">
                          <div>
                            <label className="block text-[10.5px] font-bold text-[#07281c] mb-1">Sản phẩm (SKU)</label>
                            <SearchableCombo
                              value={ln.sku}
                              allowCustom={false}
                              options={productOptions}
                              onChange={(sku) => {
                                const p = data.products.find((x) => x.sku_code === sku);
                                setLines((prev) =>
                                  prev.map((row, i) =>
                                    i === idx
                                      ? { ...row, sku, name: p?.product_name_vie || sku, name_eng: p?.product_name_eng || '' }
                                      : row
                                  )
                                );
                              }}
                            />
                          </div>
                          <div>
                            <label className="block text-[10.5px] font-bold text-[#07281c] mb-1">Tên tiếng Anh (In Báo giá)</label>
                            <input
                              value={ln.name_eng}
                              onChange={(e) => setLines((prev) => prev.map((r, i) => (i === idx ? { ...r, name_eng: e.target.value } : r)))}
                              className="agri-input text-xs"
                            />
                          </div>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-2.5 items-end">
                          <div className="w-full sm:w-[72%]">
                            <label className="block text-[10.5px] font-bold text-[#07281c] mb-1">Quy cách đóng gói</label>
                            <select
                              value={ln.packingCode}
                              onChange={(e) => setLines((prev) => prev.map((r, i) => (i === idx ? { ...r, packingCode: e.target.value } : r)))}
                              className="agri-input text-xs"
                            >
                              {packOpts.map((pk) => (
                                <option key={pk.code} value={pk.code}>
                                  {pk.code} – {pk.name} (+${pk.perKgRate.toFixed(2)}/kg)
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="w-full sm:w-[28%] flex items-end gap-1.5">
                            <div className="flex-1 min-w-0">
                              <label className="block text-[10.5px] font-bold text-[#07281c] mb-1">KL (KG)</label>
                              <input
                                type="number"
                                value={ln.weight}
                                onChange={(e) => setLines((prev) => prev.map((r, i) => (i === idx ? { ...r, weight: toNum(e.target.value) } : r)))}
                                className="agri-input text-xs font-mono font-bold"
                              />
                            </div>
                            {lines.length > 1 && (
                              <button
                                type="button"
                                title="Xóa dòng sản phẩm"
                                onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                                className="p-2 rounded-lg bg-[#8c3b3b] text-white cursor-pointer shrink-0"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  <label className="inline-flex items-center gap-2 font-bold text-[#07281c] cursor-pointer pt-1">
                    <input type="checkbox" checked={usePallet} onChange={(e) => setUsePallet(e.target.checked)} className="accent-[#0f4a33]" />
                    <span>Đóng Pallet gỗ ISPM-15 (18 kg · 0.17 CBM/pallet · +5% hao hụt hàng hỗn hợp)</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block font-bold text-[#fff5d6] mb-1">Incoterm mong muốn</label>
                    <select value={desiredIncoterm} onChange={(e) => setDesiredIncoterm(e.target.value)} className="agri-input">
                      {INCOTERMS_2020_MATRIX.map((r) => (
                        <option key={r.code} value={r.code}>{r.code}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-bold text-[#fff5d6] mb-1">Chế độ Báo giá</label>
                    <select value={quoteMode} onChange={(e) => setQuoteMode(e.target.value as 'SINGLE' | 'COMPARISON')} className="agri-input">
                      <option value="SINGLE">Đơn lẻ (1 Incoterm)</option>
                      <option value="COMPARISON">So sánh nhiều ĐK (Tư vấn)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-bold text-[#fff5d6] mb-1">Ngày giao dự kiến</label>
                    <div className="relative flex items-center">
                      <input
                        type="text"
                        value={
                          /^\d{4}-\d{2}-\d{2}$/.test(desiredDate)
                            ? `${desiredDate.slice(8, 10)}/${desiredDate.slice(5, 7)}/${desiredDate.slice(0, 4)}`
                            : desiredDate
                        }
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                          setDesiredDate(dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : e.target.value);
                        }}
                        placeholder="DD/MM/YYYY"
                        className="agri-input pr-8 font-mono"
                      />
                      <input
                        ref={dateInputRef}
                        type="date"
                        tabIndex={-1}
                        value={/^\d{4}-\d{2}-\d{2}$/.test(desiredDate) ? desiredDate : ''}
                        onChange={(e) => setDesiredDate(e.target.value)}
                        className="sr-only"
                        aria-hidden="true"
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        title="Chọn ngày từ lịch"
                        onClick={() => {
                          const el = dateInputRef.current;
                          if (!el) return;
                          if (typeof el.showPicker === 'function') el.showPicker();
                          else el.click();
                        }}
                        className="absolute right-2 p-0.5 text-[#0f4a33] hover:text-[#186635] cursor-pointer"
                      >
                        <Calendar className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block font-bold text-[#fff5d6] mb-1">Thanh toán đề xuất</label>
                    <SearchableCombo value={paymentTerm} onChange={setPaymentTerm} options={paymentOptions} />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-[#fff5d6] mb-1">Ghi chú gửi Phòng XNK</label>
                  <textarea rows={2} value={rfqNote} onChange={(e) => setRfqNote(e.target.value)} className="agri-input" />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setRfqModalOpen(false)} className="px-4 py-2 rounded-lg bg-[#07281c] text-[#fff5d6] font-bold cursor-pointer">
                    Hủy
                  </button>
                  <button type="submit" disabled={rfqSaving} className="agri-btn-gold px-5">
                    {rfqSaving ? 'Loading...' : 'Lưu & Gửi XNK Tính giá'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (activeView === 'sales-quotation') {
    return (
      <div className="space-y-4">
        <div className="agri-table-wrap">
          <div className="px-4 py-3 bg-[#0f4a33] border-b border-[#186635] flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-[#fff5d6]">Quản lý Báo giá Khách hàng ({quotationRows.length})</h3>
          </div>
          <div className="agri-table-scroll">
            <table className="agri-table">
              <thead>
                <tr>
                  <th className="text-center">Số Báo giá / Mã đơn</th>
                  <th className="text-left">Khách hàng</th>
                  <th className="text-left">Sản phẩm · KL</th>
                  <th className="text-center">Incoterm</th>
                  <th className="text-center">Giá chào (USD)</th>
                  <th className="text-center">Trạng thái</th>
                  <th className="text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {quotationRows.map((inq) => {
                  const cus = data.consignees.find((c) => c.consignee_id === inq.consignee_id);
                  const prop = data.proposals.find((p) => p.order_id === inq.order_id);
                  const extra = proposalMetaMap[inq.order_id];
                  const cleanRef = cleanQuoteNoForCustomer(extra?.quotation_no || '', inq.order_id);
                  const readyOrSent = isPricedReadyStatus(inq.inquiry_status) || isSentWaitingCustomerStatus(inq.inquiry_status);
                  const canConfirm = readyOrSent && Boolean(prop);
                  const canDelete = !isContractCreatedStatus(inq.inquiry_status) && !data.orders.some((o) => o.order_id === inq.order_id && orderMetaMap[o.order_id]?.is_locked);
                  return (
                    <tr key={inq.order_id}>
                      <td className="text-center">
                        <div className="font-mono font-bold">{cleanRef}</div>
                        <button type="button" onClick={() => onOpenTimeline(inq.order_id)} className="text-[11px] font-mono hover:underline cursor-pointer">
                          {inq.order_id}
                        </button>
                      </td>
                      <td className="text-left">
                        <div className="font-bold">{cus?.consignee_name || inq.consignee_id}</div>
                        <div className="text-[11px] opacity-80">{cus?.country || '-'} · {inq.email || cus?.email || '-'}</div>
                      </td>
                      <td className="text-left text-xs">
                        {inq.product_name_vie || inq.sku_code} · <span className="font-mono font-bold">{fmtNumber(inq.net_weight_kgs)} KG</span>
                      </td>
                      <td className="text-center font-mono font-bold">{prop?.recommended_incoterm || inq.desired_incoterm}</td>
                      <td className="text-center font-mono font-extrabold">
                        {prop ? fmtUSD(prop.final_selling_price) : <span className="opacity-65 italic">Chờ XNK</span>}
                      </td>
                      <td className="text-center">
                        <span className="keep-badge-color inline-block px-2 py-0.5 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold">
                          {inq.inquiry_status}
                        </span>
                      </td>
                      <td className="text-center">
                        <div className="inline-flex flex-wrap justify-center gap-1">
                          {prop && (
                            <button
                              type="button"
                              onClick={() => onOpenPreview({ kind: 'QUOTATION', orderId: inq.order_id })}
                              className="keep-btn-style px-2.5 py-1 rounded bg-[#f4d98a] text-[#07281c] text-[11px] font-extrabold cursor-pointer"
                            >
                              Xem &amp; Gửi Báo giá
                            </button>
                          )}
                          {isStoredDocumentPath(inq.sent_mail_link) && (
                            <button
                              type="button"
                              onClick={() =>
                                openDocumentWithSignedUrl(inq.sent_mail_link).catch((err: any) =>
                                  onToast('error', err?.message || 'Không thể tải báo giá.')
                                )
                              }
                              className="keep-btn-style px-2 py-1 rounded bg-[#d7eee4] text-[#07281c] border border-[#186635] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <ExternalLink className="w-3 h-3" /> Tải .docx
                            </button>
                          )}
                          {canConfirm && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setRepriceOrderId(inq.order_id);
                                  setRepriceReason('');
                                }}
                                className="keep-btn-style px-2 py-1 rounded bg-[#07281c] text-[#fff5d6] text-[11px] font-bold cursor-pointer"
                              >
                                Tính lại
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  onRequestConfirm(
                                    'Chốt đơn hàng?',
                                    `Xác nhận khách hàng đã đồng ý báo giá ${cleanRef} và chuyển sang Phòng XNK khởi tạo Hợp đồng Ngoại thương?`,
                                    () => onConfirmOrder(inq.order_id)
                                  )
                                }
                                className="keep-btn-style px-2.5 py-1 rounded bg-[#16977f] text-white text-[11px] font-bold cursor-pointer"
                              >
                                Khách Chốt đơn
                              </button>
                            </>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() =>
                                onRequestConfirm(
                                  'Hủy & Xóa đơn trước Hợp đồng?',
                                  `Đơn ${inq.order_id} sẽ bị xóa khỏi danh sách yêu cầu, bảng tính giá (nếu có) và cập nhật lại số đơn của khách hàng.`,
                                  () => onDeletePreContract(inq.order_id),
                                  true
                                )
                              }
                              className="keep-btn-style px-2 py-1 rounded bg-[#8c3b3b] text-white text-[11px] font-bold cursor-pointer"
                            >
                              Hủy đơn
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {quotationRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-8 opacity-75">
                      Chưa có báo giá nào trong danh sách.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {repriceOrderId && (
          <div className="fixed inset-0 z-50 bg-[#07281c]/75 flex items-center justify-center p-4">
            <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl w-full max-w-md p-5 text-[#f4f8f5] space-y-3">
              <h4 className="text-sm font-extrabold text-[#fff5d6] flex items-center gap-1.5">
                <RotateCcw className="w-4 h-4 text-[#f4d98a]" /> Yêu cầu XNK Tính giá lại ({repriceOrderId})
              </h4>
              <textarea
                rows={3}
                value={repriceReason}
                onChange={(e) => setRepriceReason(e.target.value)}
                placeholder="Nhập lý do thương lượng của khách (VD: Khách xin giảm $200, đổi sang FOB...)"
                className="agri-input"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setRepriceOrderId(null)} className="px-3 py-1.5 rounded bg-[#07281c] text-white text-xs font-bold cursor-pointer">
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await onRequestReprice(repriceOrderId, repriceReason.trim() || 'Khách đề nghị điều chỉnh giá');
                    setRepriceOrderId(null);
                  }}
                  className="agri-btn-gold text-xs"
                >
                  Gửi XNK Tính lại
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (activeView === 'sales-contracts') {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex bg-[#07281c] p-1 rounded-xl border border-[#186635]">
            {(['ALL', 'PENDING', 'SIGNED'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setContractFilter(f)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                  contractFilter === f ? 'bg-[#f4d98a] text-[#07281c]' : 'text-[#d2ebe0]'
                }`}
              >
                {f === 'ALL' ? 'Tất cả Hợp đồng' : f === 'PENDING' ? 'Chờ Sales đưa ký' : 'Đã ký & Khóa'}
              </button>
            ))}
          </div>
        </div>

        <div className="agri-table-wrap">
          <div className="px-4 py-3 bg-[#0f4a33] border-b border-[#186635]">
            <h3 className="text-sm font-extrabold text-[#fff5d6]">
              {contractFilter === 'PENDING'
                ? `Hợp đồng Chờ Sales đưa ký (${salesContractsList.length})`
                : contractFilter === 'SIGNED'
                ? `Hợp đồng Đã ký & Khóa (${salesContractsList.length})`
                : `Tất cả Hợp đồng (${salesContractsList.length})`}
            </h3>
          </div>
          <div className="agri-table-scroll">
            <table className="agri-table">
              <thead>
                <tr>
                  <th className="text-center">Số Hợp đồng / Đơn</th>
                  <th className="text-left">Khách hàng</th>
                  <th className="text-left">Sản phẩm · KL</th>
                  <th className="text-center">Incoterm / TT</th>
                  <th className="text-center">Giá trị (USD)</th>
                  <th className="text-center">Trạng thái</th>
                  <th className="text-center">Hồ sơ &amp; Xác nhận</th>
                </tr>
              </thead>
              <tbody>
                {salesContractsList.map((ord) => {
                  const cus = data.consignees.find((c) => c.consignee_id === ord.consignee_id);
                  const meta = orderMetaMap[ord.order_id];
                  const isLocked = Boolean(meta?.is_locked);
                  return (
                    <tr key={ord.order_id}>
                      <td className="text-center">
                        <div className="font-mono font-bold">{ord.contract_no}</div>
                        <button type="button" onClick={() => onOpenTimeline(ord.order_id)} className="text-[11px] font-mono hover:underline cursor-pointer">
                          {ord.order_id}
                        </button>
                      </td>
                      <td className="text-left">
                        <div className="font-bold">{cus?.consignee_name || ord.consignee_id}</div>
                        <div className="text-[11px] opacity-80">{ord.pol} → {ord.pod}</div>
                      </td>
                      <td className="text-left">
                        <div className="font-mono font-bold">{ord.sku_code}</div>
                        <div className="text-[11px] font-mono">{fmtNumber(ord.nw_confirmed_kgs)} KG</div>
                      </td>
                      <td className="text-center">
                        <div className="font-mono font-bold">{ord.applied_incoterm}</div>
                        <div className="text-[11px]">{ord.payment_terms}</div>
                      </td>
                      <td className="text-center font-mono font-extrabold">{fmtUSD(ord.contract_value)}</td>
                      <td className="text-center">
                        <span className={`keep-badge-color inline-block px-2 py-0.5 rounded text-[11px] font-bold ${isLocked ? 'bg-[#0f4a33] text-[#fff5d6]' : 'bg-[#f4d98a] text-[#07281c]'}`}>
                          {isLocked ? `Đã ký (${meta?.signed_date || 'OK'})` : 'Chờ Sales đưa ký'}
                        </span>
                      </td>
                      <td className="text-center">
                        <div className="inline-flex flex-wrap items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => onOpenPreview({ kind: 'CONTRACT', orderId: ord.order_id })}
                            className="keep-btn-style px-2.5 py-1 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" /> Xem hợp đồng
                          </button>
                          {ord.contract_link ? (
                            <button
                              type="button"
                              onClick={() =>
                                openDocumentWithSignedUrl(ord.contract_link).catch((err: any) =>
                                  onToast('error', err?.message || 'Không thể mở file hợp đồng.')
                                )
                              }
                              className="keep-btn-style px-2.5 py-1 rounded bg-[#d7eee4] text-[#07281c] border border-[#186635] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <ExternalLink className="w-3 h-3" /> Mở / Tải File HĐ
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onOpenPreview({ kind: 'CONTRACT', orderId: ord.order_id })}
                              className="keep-btn-style px-2.5 py-1 rounded bg-[#d7eee4] text-[#07281c] border border-[#186635] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <FileText className="w-3 h-3" /> Mở / Tải File HĐ
                            </button>
                          )}
                          {!isLocked && (
                            <button
                              type="button"
                              onClick={() =>
                                onRequestConfirm(
                                  'Xác nhận Khách đã ký Hợp đồng?',
                                  `Hợp đồng ${ord.contract_no} sẽ chuyển sang Mốc 3/6 (Chờ Booking & Đóng hàng) và khóa các điều khoản thương mại.`,
                                  () => onConfirmSignedContract(ord.order_id)
                                )
                              }
                              className="keep-btn-style px-2.5 py-1 rounded bg-[#f4d98a] text-[#07281c] text-[11px] font-extrabold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" /> Xác nhận Khách đã ký HĐ
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {salesContractsList.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-8 opacity-75">
                      {contractFilter === 'PENDING'
                        ? 'Chưa có hợp đồng nào đang chờ Sales đưa ký.'
                        : contractFilter === 'SIGNED'
                        ? 'Chưa có hợp đồng nào đã ký & khóa.'
                        : 'Chưa có hợp đồng nào trong danh sách.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // sales-customers
  const filteredCustomers = data.consignees.filter((c) => {
    if (!quickSearchLower) return true;
    return `${c.consignee_id} ${c.consignee_name} ${c.country} ${c.email} ${c.tax}`.toLowerCase().includes(quickSearchLower);
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            const maxIdx = data.consignees.reduce((m, c) => {
              const match = c.consignee_id.match(/CON-(\d+)/i);
              return match ? Math.max(m, parseInt(match[1], 10)) : m;
            }, 0);
            setCusForm({
              consignee_id: `CON-${String(maxIdx + 1).padStart(3, '0')}`,
              consignee_name: '',
              country: '',
              address: '',
              tax: '',
              contact_person: '',
              phone: '',
              email: '',
              fax: '',
              default_payment_term: 'T/T 30/70',
              customer_type: 'Khách hàng tiềm năng',
              order_count: 0,
              created_date: todayIsoDate(),
            });
            setCusIsEdit(false);
            setCusModalOpen(true);
          }}
          className="agri-btn-gold flex items-center gap-1.5"
        >
          <UserPlus className="w-4 h-4" /> Thêm Khách hàng
        </button>
      </div>

      <div className="agri-table-wrap">
        <div className="px-4 py-3 bg-[#0f4a33] border-b border-[#186635]">
          <h3 className="text-sm font-extrabold text-[#fff5d6]">Danh bạ Khách hàng Quốc tế ({filteredCustomers.length})</h3>
        </div>
        <div className="agri-table-scroll">
          <table className="agri-table">
            <thead>
              <tr>
                <th className="text-center">Mã KH</th>
                <th className="text-left">Tên Khách hàng / Công ty</th>
                <th className="text-center">Quốc gia</th>
                <th className="text-left">Liên hệ / Email / SĐT</th>
                <th className="text-center">Tax ID</th>
                <th className="text-center">Số đơn</th>
                <th className="text-center">Phân loại</th>
                <th className="text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map((c) => (
                <tr key={c.consignee_id}>
                  <td className="text-center font-mono font-bold">{c.consignee_id}</td>
                  <td className="text-left">
                    <div className="font-bold">{c.consignee_name}</div>
                    <div className="text-[11px] opacity-80">{c.address}</div>
                  </td>
                  <td className="text-center font-semibold">{c.country}</td>
                  <td className="text-left text-xs">
                    <div>{c.contact_person} · {c.email}</div>
                    <div className="font-mono text-[11px]">Tel: {normalizePlainText(c.phone)} {c.fax ? `· Fax: ${normalizePlainText(c.fax)}` : ''}</div>
                  </td>
                  <td className="text-center font-mono text-xs">{normalizePlainText(c.tax) || '-'}</td>
                  <td className="text-center font-mono font-extrabold">{toNum(c.order_count)}</td>
                  <td className="text-center">
                    <span className="keep-badge-color inline-block px-2 py-0.5 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold">
                      {c.customer_type || classifyCustomerByCount(c.order_count)}
                    </span>
                  </td>
                  <td className="text-center">
                    <div className="inline-flex flex-wrap justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setCusForm({ ...c });
                          setCusIsEdit(true);
                          setCusModalOpen(true);
                        }}
                        className="keep-btn-style px-2 py-1 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold cursor-pointer"
                      >
                        <Edit3 className="w-3 h-3 inline mr-0.5" /> Sửa
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onRequestConfirm(
                            'Xóa khách hàng?',
                            `Xác nhận xóa khách hàng ${c.consignee_name}?`,
                            () => onDeleteConsignee(c.consignee_id),
                            true
                          )
                        }
                        className="keep-btn-style px-2 py-1 rounded bg-[#8c3b3b] text-white text-[11px] font-bold cursor-pointer"
                      >
                        Xóa
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredCustomers.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-8 opacity-75">
                    Chưa có khách hàng nào trong danh bạ.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {cusModalOpen && cusForm && (
        <div className="fixed inset-0 z-50 bg-[#07281c]/75 flex items-center justify-center p-4">
          <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl w-full max-w-xl p-5 text-[#f4f8f5] space-y-3 text-xs">
            <h4 className="text-base font-extrabold text-[#fff5d6]">{cusIsEdit ? 'Cập nhật Khách hàng' : 'Thêm Khách hàng Mới'}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold mb-1">Mã KH</label>
                <input value={cusForm.consignee_id} disabled={cusIsEdit} onChange={(e) => setCusForm({ ...cusForm, consignee_id: e.target.value })} className="agri-input font-mono" />
              </div>
              <div>
                <label className="block font-bold mb-1">Tên công ty *</label>
                <input value={cusForm.consignee_name} onChange={(e) => setCusForm({ ...cusForm, consignee_name: e.target.value })} className="agri-input" />
              </div>
              <div>
                <label className="block font-bold mb-1">Quốc gia</label>
                <input value={cusForm.country} onChange={(e) => setCusForm({ ...cusForm, country: e.target.value })} className="agri-input" />
              </div>
              <div>
                <label className="block font-bold mb-1">Tax ID</label>
                <input value={cusForm.tax} onChange={(e) => setCusForm({ ...cusForm, tax: e.target.value })} className="agri-input font-mono" />
              </div>
              <div>
                <label className="block font-bold mb-1">Người liên hệ</label>
                <input value={cusForm.contact_person} onChange={(e) => setCusForm({ ...cusForm, contact_person: e.target.value })} className="agri-input" />
              </div>
              <div>
                <label className="block font-bold mb-1">Email</label>
                <input value={cusForm.email} onChange={(e) => setCusForm({ ...cusForm, email: e.target.value })} className="agri-input" />
              </div>
              <div>
                <label className="block font-bold mb-1">SĐT (Plain Text)</label>
                <input value={cusForm.phone} onChange={(e) => setCusForm({ ...cusForm, phone: e.target.value })} className="agri-input font-mono" />
              </div>
              <div>
                <label className="block font-bold mb-1">Fax (Plain Text)</label>
                <input value={cusForm.fax} onChange={(e) => setCusForm({ ...cusForm, fax: e.target.value })} className="agri-input font-mono" />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-bold mb-1">Địa chỉ</label>
                <input value={cusForm.address} onChange={(e) => setCusForm({ ...cusForm, address: e.target.value })} className="agri-input" />
              </div>
              <div>
                <label className="block font-bold mb-1">Thanh toán mặc định</label>
                <input value={cusForm.default_payment_term} onChange={(e) => setCusForm({ ...cusForm, default_payment_term: e.target.value })} className="agri-input" />
              </div>
              <div>
                <label className="block font-bold mb-1">Số đơn baseline</label>
                <input type="number" value={cusForm.order_count} onChange={(e) => setCusForm({ ...cusForm, order_count: toNum(e.target.value) })} className="agri-input font-mono" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setCusModalOpen(false)} className="px-3 py-1.5 rounded bg-[#07281c] text-white font-bold cursor-pointer">Hủy</button>
              <button
                type="button"
                onClick={async () => {
                  if (!cusForm.consignee_name.trim()) {
                    onToast('warning', 'Vui lòng nhập Tên công ty.');
                    return;
                  }
                  await onUpsertConsignee(cusForm, cusIsEdit);
                  setCusModalOpen(false);
                }}
                className="agri-btn-gold"
              >
                Lưu Khách hàng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
