import type {
  ConsigneeDirectory,
  InquiryQuotation,
  OrderItem,
  OrderLogisticsMeta,
  OrderMaster,
  PricingProposal,
  PricingRate,
  ProductCatalog,
  ProposalExtraMeta,
  RoleType,
  ShippingSchedule,
  SystemLookup,
} from '../types';

export function parseLocaleNumber(val: unknown): number {
  if (typeof val === 'number') return Number.isNaN(val) || !Number.isFinite(val) ? 0 : val;
  if (val === null || val === undefined || val === '') return 0;
  let s = String(val).trim();
  if (!s) return 0;

  // Preserve leading minus sign, strip currency symbols, spaces, and non-numeric labels
  const isNegative = /^-/.test(s.replace(/^\s*[$€£¥₫]\s*/, ''));
  s = s.replace(/[^0-9.,]/g, '');
  if (!s) return 0;

  const dotCount = (s.match(/\./g) || []).length;
  const commaCount = (s.match(/,/g) || []).length;

  if (dotCount > 0 && commaCount > 0) {
    // Both separators present: whichever appears last is the decimal separator
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      // Vietnamese / European format: 5.960,00 -> 5960.00
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // US format: 5,960.00 -> 5960.00
      s = s.replace(/,/g, '');
    }
  } else if (commaCount > 0) {
    if (commaCount > 1) {
      // Multiple commas: thousands separators (e.g. 1,234,567)
      s = s.replace(/,/g, '');
    } else {
      // Single comma: Vietnamese decimal separator (e.g. "2,70", "14,037", "0,25")
      s = s.replace(',', '.');
    }
  } else if (dotCount > 0) {
    if (dotCount > 1) {
      // Multiple dots: Vietnamese thousands separators (e.g. "1.250.000")
      s = s.replace(/\./g, '');
    } else if (/^[1-9]\d{0,2}\.\d{3}$/.test(s)) {
      // Single dot with Vietnamese thousands grouping (e.g. "5.960", "27.400", "1.250")
      s = s.replace(/\./g, '');
    }
    // Otherwise keep dot as standard decimal point (e.g. "2.70", "0.125", "16.33")
  }

  const n = Number(isNegative ? `-${s}` : s);
  return Number.isNaN(n) || !Number.isFinite(n) ? 0 : n;
}

export function toNum(val: unknown): number {
  return parseLocaleNumber(val);
}

export function fmtDecimal(value: unknown, decimals = 2): string {
  const n = parseLocaleNumber(value);
  return n.toLocaleString('vi-VN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatCurrency(value: unknown): string {
  return fmtDecimal(value, 2);
}

export function fmtUSD(num: unknown): string {
  return '$' + formatCurrency(num);
}

export function fmtNumber(num: unknown, maxDecimals = 3): string {
  return parseLocaleNumber(num).toLocaleString('vi-VN', {
    maximumFractionDigits: maxDecimals,
  });
}

export function formatEditableNumber(val: unknown, decimals?: number): string {
  if (val === null || val === undefined || val === '') return '';
  const n = parseLocaleNumber(val);
  if (decimals !== undefined) {
    return n.toLocaleString('vi-VN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  return n.toLocaleString('vi-VN', { maximumFractionDigits: 4 });
}

export function normalizePlainText(val: unknown): string {
  return String(val ?? '').replace(/^'/, '').trim();
}

export function capitalizeWordsPreservingSpaces(val: string): string {
  return String(val || '').replace(/(^|\s)(\S)/g, (_, space, ch) => `${space}${ch.toLocaleUpperCase('vi-VN')}`);
}

export function todayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function cleanUpperAscii(val?: string): string {
  return String(val || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase();
}

export function normalizeRole(roleOrDept?: string, deptFallback?: string): RoleType {
  const first = cleanUpperAscii(roleOrDept);
  const second = cleanUpperAscii(deptFallback);
  const hasAdminKeyword = (s: string) =>
    s.includes('ADMIN') || s.includes('QUAN TRI') || s.includes('QUAN LY') || s.includes('GIAM DOC');
  const hasXnkKeyword = (s: string) =>
    s.includes('XNK') || s.includes('LOGISTIC') || s.includes('XUAT NHAP KHAU') || s.includes('CHUNG TU') || s.includes('CUOC');
  const hasSalesKeyword = (s: string) =>
    s.includes('SALE') || s.includes('KINH DOANH');

  if (deptFallback !== undefined) {
    if (hasAdminKeyword(first) || hasAdminKeyword(second)) return 'ADMIN';
    if (hasXnkKeyword(second)) return 'XNK';
    if (hasSalesKeyword(second)) return 'SALES';
    if (first.includes('MANAGER')) return 'ADMIN';
    if (hasXnkKeyword(first)) return 'XNK';
    return 'SALES';
  }

  if (!first) return 'SALES';
  if (hasAdminKeyword(first) || first.includes('MANAGER')) return 'ADMIN';
  if (hasXnkKeyword(first)) return 'XNK';
  return 'SALES';
}

export function translateDepartment(dept?: string): string {
  const r = normalizeRole(dept);
  if (r === 'ADMIN') return 'Quản trị viên';
  if (r === 'XNK') return 'Xuất nhập khẩu';
  return 'Kinh doanh';
}

export const WORKFLOW_STATUS = {
  QUICK_CAPTURE: 'Mới tiếp nhận - Chờ tư vấn',
  WAITING_PRICING: 'Chờ XNK tính giá',
  PRICED_READY: 'Đã có giá - Chờ báo khách',
  SENT_WAITING_CUST: 'Đã gửi báo giá - Chờ phản hồi',
  REPRICE_REQUESTED: 'Yêu cầu tính giá lại',
  CONFIRMED_ORDER: 'Khách đã chốt đơn',
  CONTRACT_PENDING_SALES: 'Chờ Sales đưa ký',
  CONTRACT_SIGNED: 'Đã ký HĐ & Cọc',
  CONTRACT_CREATED: 'Đã lập hợp đồng',
} as const;

export const WORKFLOW_6_STAGES = [
  '1. Chờ báo giá (RFQ)',
  '2. Chờ ký HĐ & Cọc',
  '3. Chờ Booking & Đóng hàng',
  '4. Đang làm chứng từ & HQ',
  '5. Đang vận chuyển (On Board)',
  '6. Chờ thanh toán',
] as const;

export const COMPLETED_ORDER_STATUS = 'Hoàn tất quyết toán';

export function normalizeWorkflowStatus(status?: string): string {
  const s = String(status || '').trim();
  if (!s) return WORKFLOW_STATUS.WAITING_PRICING;
  const low = s.toLowerCase();
  if (low.includes('tiếp nhận') || low.includes('tư vấn') || low.includes('quick')) return WORKFLOW_STATUS.QUICK_CAPTURE;
  if (low.includes('tính giá lại') || low.includes('reprice')) return WORKFLOW_STATUS.REPRICE_REQUESTED;
  if (low.includes('mới tạo') || low.includes('chờ tính giá') || low.includes('chờ xnk') || low.includes('waiting') || low === 'new') return WORKFLOW_STATUS.WAITING_PRICING;
  if (low.includes('đã có giá') || low.includes('chờ báo khách') || low.includes('priced')) return WORKFLOW_STATUS.PRICED_READY;
  if (low.includes('chờ sales đưa ký') || low.includes('pending signature')) return WORKFLOW_STATUS.CONTRACT_PENDING_SALES;
  if ((low.includes('đã gửi') && !low.includes('sales')) || low.includes('chờ phản hồi') || low.includes('sent')) return WORKFLOW_STATUS.SENT_WAITING_CUST;
  if (low.includes('chốt đơn') || low.includes('đã chốt') || low.includes('chờ ký') || low.includes('confirmed')) return WORKFLOW_STATUS.CONFIRMED_ORDER;
  if (low.includes('đã lập hợp đồng') || low.includes('hợp đồng')) return WORKFLOW_STATUS.CONTRACT_CREATED;
  return s;
}

export function isQuickCaptureStatus(s?: string): boolean {
  return normalizeWorkflowStatus(s) === WORKFLOW_STATUS.QUICK_CAPTURE;
}
export function isWaitingPricingStatus(s?: string): boolean {
  const n = normalizeWorkflowStatus(s);
  return n === WORKFLOW_STATUS.WAITING_PRICING || n === WORKFLOW_STATUS.REPRICE_REQUESTED;
}
export function isRepriceRequestedStatus(s?: string): boolean {
  return normalizeWorkflowStatus(s) === WORKFLOW_STATUS.REPRICE_REQUESTED;
}
export function isPricedReadyStatus(s?: string): boolean {
  return normalizeWorkflowStatus(s) === WORKFLOW_STATUS.PRICED_READY;
}
export function isSentWaitingCustomerStatus(s?: string): boolean {
  return normalizeWorkflowStatus(s) === WORKFLOW_STATUS.SENT_WAITING_CUST;
}
export function isConfirmedStatus(s?: string): boolean {
  return normalizeWorkflowStatus(s) === WORKFLOW_STATUS.CONFIRMED_ORDER;
}
export function isContractCreatedStatus(s?: string): boolean {
  return normalizeWorkflowStatus(s) === WORKFLOW_STATUS.CONTRACT_CREATED;
}

export function getEffectiveFulfillmentStatus(order: OrderMaster, meta?: OrderLogisticsMeta): string {
  return String(meta?.exact_fulfillment_status || order.fulfillment_status || '').trim();
}

export function getOrderStage6Number(order: OrderMaster, meta?: OrderLogisticsMeta): number {
  const st = getEffectiveFulfillmentStatus(order, meta).toLowerCase();
  if (st.includes('hoàn tất') || st.includes('quyết toán') || st.includes('completed')) return 7;
  if (st.includes('6.') || st.includes('chờ thanh toán')) return 6;
  if (st.includes('5.') || st.includes('vận chuyển') || st.includes('on board')) return 5;
  if (st.includes('4.') || st.includes('chứng từ') || st.includes('hq') || st.includes('b/l')) return 4;
  if (st.includes('3.') || st.includes('booking') || st.includes('đóng hàng') || meta?.is_locked) return 3;
  if (st.includes('2.') || st.includes('chờ ký') || st.includes('chờ sales') || st.includes('nháp')) return 2;
  return 2;
}

export function getNextContractMilestone(stageNum: number): { nextStatus: string; label: string } | null {
  if (stageNum <= 2) return { nextStatus: WORKFLOW_6_STAGES[2], label: 'Mốc 3: Booking & Đóng hàng' };
  if (stageNum === 3) return { nextStatus: WORKFLOW_6_STAGES[3], label: 'Mốc 4: Chứng từ & HQ' };
  if (stageNum === 4) return { nextStatus: WORKFLOW_6_STAGES[4], label: 'Mốc 5: Tàu chạy (On Board)' };
  if (stageNum === 5) return { nextStatus: WORKFLOW_6_STAGES[5], label: 'Mốc 6: Chờ thanh toán' };
  if (stageNum === 6) return { nextStatus: COMPLETED_ORDER_STATUS, label: 'Hoàn tất quyết toán' };
  return null;
}

export function stripInternalCodesForCustomer(text: string): string {
  return String(text || '')
    .replace(/\bTMP_[A-Z0-9_]+\b/gi, '')
    .replace(/\b(?:QT-)?ORD-\d{6,}(?:-\d+)?\b/gi, '')
    .replace(/[-_](?:V|R)\d+\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function cleanQuoteNoForCustomer(quoteNo: string, orderId?: string): string {
  const s = String(quoteNo || '').trim();
  if (!s) return orderId ? `QT-${String(orderId).replace(/^ORD-/i, '')}` : 'QUOTATION';
  return s
    .replace(/^QT-ORD-/i, 'QT-')
    .replace(/-(?:V|R)\d+$/i, '');
}

export function classifyCustomerByCount(count: number): string {
  const n = Math.max(0, Math.floor(toNum(count)));
  if (n === 0) return 'Khách hàng tiềm năng';
  if (n === 1) return 'Khách hàng mới';
  return 'Khách hàng cũ';
}

export const DEFAULT_PACKING_AND_CONTAINER_RATES: Array<Partial<PricingRate>> = [
  { fee_category: 'PACKING', fee_code: 'PKG-JAR-250', scope_or_cont_type: 'ALL', fee_name_vie: 'Hũ PET 250g + Thùng Carton (24 hũ / 6kg)', contract_text_eng: '250g PET Jars in 6kg Export Carton (24 Jars)', unit_basis: 'Carton', standard_rate: 0.42, provider_or_rule: '6', note: 'Hàng gia vị đóng hũ PET 250g', dim_cm: '36x28x22', net_kg: 6, tare_kg: 0.9, max_per_pallet: 60 },
  { fee_category: 'PACKING', fee_code: 'PKG-JAR-500', scope_or_cont_type: 'ALL', fee_name_vie: 'Hũ PET 500g + Thùng Carton (12 hũ / 6kg)', contract_text_eng: '500g PET Jars in 6kg Export Carton (12 Jars)', unit_basis: 'Carton', standard_rate: 0.36, provider_or_rule: '6', note: 'Hàng gia vị đóng hũ PET 500g', dim_cm: '38x28x24', net_kg: 6, tare_kg: 0.85, max_per_pallet: 55 },
  { fee_category: 'PACKING', fee_code: 'PKG-ZIP-250', scope_or_cont_type: 'ALL', fee_name_vie: 'Túi Zipper Kraft 250g + Thùng (20 túi / 5kg)', contract_text_eng: '250g Kraft Zipper Pouches in 5kg Carton (20 Pouches)', unit_basis: 'Carton', standard_rate: 0.32, provider_or_rule: '5', note: 'Bao bì bán lẻ hạt/gia vị', dim_cm: '36x26x22', net_kg: 5, tare_kg: 0.65, max_per_pallet: 64 },
  { fee_category: 'PACKING', fee_code: 'PKG-ZIP-500', scope_or_cont_type: 'ALL', fee_name_vie: 'Túi Zipper Kraft 500g + Thùng (10 túi / 5kg)', contract_text_eng: '500g Kraft Zipper Pouches in 5kg Carton (10 Pouches)', unit_basis: 'Carton', standard_rate: 0.28, provider_or_rule: '5', note: 'Bao bì bán lẻ 500g', dim_cm: '36x28x24', net_kg: 5, tare_kg: 0.6, max_per_pallet: 60 },
  { fee_category: 'PACKING', fee_code: 'PKG-VAC-1K', scope_or_cont_type: 'ALL', fee_name_vie: 'Túi Hút Chân Không 1kg + Thùng 10kg (10 túi)', contract_text_eng: 'Vacuum PE Bag 1kg in 10kg Carton (10 Bags)', unit_basis: 'Carton', standard_rate: 0.24, provider_or_rule: '10', note: 'Hạt điều/tiêu hút chân không', dim_cm: '40x30x25', net_kg: 10, tare_kg: 0.8, max_per_pallet: 50 },
  { fee_category: 'PACKING', fee_code: 'PKG-CTN-5K', scope_or_cont_type: 'ALL', fee_name_vie: 'Thùng Carton 5 lớp lót túi PE 5kg', contract_text_eng: '5kg 5-Ply Corrugated Carton with PE Liner', unit_basis: 'Carton', standard_rate: 0.19, provider_or_rule: '5', note: 'Thùng khô tiêu chuẩn 5kg', dim_cm: '38x28x20', net_kg: 5, tare_kg: 0.55, max_per_pallet: 64 },
  { fee_category: 'PACKING', fee_code: 'PKG-CTN-10K', scope_or_cont_type: 'ALL', fee_name_vie: 'Thùng Carton 5 lớp lót túi PE 10kg', contract_text_eng: '10kg 5-Ply Corrugated Carton with PE Liner', unit_basis: 'Carton', standard_rate: 0.25, provider_or_rule: '10', note: 'Thùng tiêu chuẩn 10kg', dim_cm: '42x32x26', net_kg: 10, tare_kg: 0.85, max_per_pallet: 48 },
  { fee_category: 'PACKING', fee_code: 'PKG-IQF-1K', scope_or_cont_type: 'REEFER', fee_name_vie: 'Túi PE cấp đông IQF 1kg + Thùng chống ẩm 10kg', contract_text_eng: '1kg IQF PE Bags in 10kg Moisture-Proof Carton', unit_basis: 'Carton', standard_rate: 0.34, provider_or_rule: '10', note: 'Hàng cấp đông container lạnh', dim_cm: '40x30x26', net_kg: 10, tare_kg: 0.95, max_per_pallet: 45 },
  { fee_category: 'PACKING', fee_code: 'PKG-IQF-5K', scope_or_cont_type: 'REEFER', fee_name_vie: 'Bao PE khối IQF 5kg + Thùng chống ẩm 15kg', contract_text_eng: '5kg IQF Block Bags in 15kg Waxed Carton', unit_basis: 'Carton', standard_rate: 0.31, provider_or_rule: '15', note: 'Hàng cấp đông bulk 15kg', dim_cm: '45x32x28', net_kg: 15, tare_kg: 1.15, max_per_pallet: 40 },
  { fee_category: 'PACKING', fee_code: 'PKG-PLT-YES', scope_or_cont_type: 'ALL', fee_name_vie: 'Pallet Nhựa / Gỗ Hun Trùng ISPM-15 (Đế pallet + Quấn màng PE)', contract_text_eng: 'Heat-Treated ISPM-15 Export Pallet with Stretch Film', unit_basis: 'Pallet', standard_rate: 18, provider_or_rule: '50 thùng/pallet', note: 'Tải trọng Pallet + màng quấn 18kg · 0.17 CBM/pallet', dim_cm: '120x100x14.17', net_kg: 0, tare_kg: 18, max_per_pallet: 50 },
  { fee_category: 'PACKING', fee_code: 'PKG-PLT-NO', scope_or_cont_type: 'ALL', fee_name_vie: 'Không dùng Pallet (Xếp sàn container - Floor Load)', contract_text_eng: 'Loose Floor-Loaded in Container (No Pallet)', unit_basis: 'Pallet', standard_rate: 0, provider_or_rule: 'Xếp rời tối ưu thể tích', note: 'Không phát sinh phí & bì pallet', dim_cm: '0x0x0', net_kg: 0, tare_kg: 0, max_per_pallet: 0 },
  { fee_category: 'CONTAINER', fee_code: 'CONT-20GP', scope_or_cont_type: "20'DC", fee_name_vie: "Container 20' Khô tiêu chuẩn (20'DC / 20GP)", contract_text_eng: '20ft General Purpose Dry Container', unit_basis: 'Container', standard_rate: 0, provider_or_rule: 'Max 28.200 KG / 28 CBM / 10 Pallet', dim_cm: '589x235x239', net_kg: 28200, tare_kg: 28, max_per_pallet: 10 },
  { fee_category: 'CONTAINER', fee_code: 'CONT-40GP', scope_or_cont_type: "40'DC", fee_name_vie: "Container 40' Khô tiêu chuẩn (40'DC / 40GP)", contract_text_eng: '40ft General Purpose Dry Container', unit_basis: 'Container', standard_rate: 0, provider_or_rule: 'Max 26.700 KG / 58 CBM / 20 Pallet', dim_cm: '1203x235x239', net_kg: 26700, tare_kg: 58, max_per_pallet: 20 },
  { fee_category: 'CONTAINER', fee_code: 'CONT-40HC', scope_or_cont_type: "40'HC", fee_name_vie: "Container 40' Khô Cao (40'HC)", contract_text_eng: '40ft High-Cube Dry Container', unit_basis: 'Container', standard_rate: 0, provider_or_rule: 'Max 26.500 KG / 67 CBM / 21 Pallet', dim_cm: '1203x235x269', net_kg: 26500, tare_kg: 67, max_per_pallet: 21 },
  { fee_category: 'CONTAINER', fee_code: 'CONT-20RF', scope_or_cont_type: "20'RF", fee_name_vie: "Container 20' Lạnh (20'RF)", contract_text_eng: '20ft Reefer Container', unit_basis: 'Container', standard_rate: 0, provider_or_rule: 'Max 27.400 KG / 24 CBM / 9 Pallet', dim_cm: '544x229x227', net_kg: 27400, tare_kg: 24, max_per_pallet: 9 },
  { fee_category: 'CONTAINER', fee_code: 'CONT-40RF', scope_or_cont_type: "40'RF", fee_name_vie: "Container 40' Lạnh Tiêu Chuẩn (40'RF)", contract_text_eng: '40ft Standard Reefer Container', unit_basis: 'Container', standard_rate: 0, provider_or_rule: 'Max 29.300 KG / 51 CBM / 20 Pallet', dim_cm: '1156x229x250', net_kg: 29300, tare_kg: 51, max_per_pallet: 20 },
  { fee_category: 'CONTAINER', fee_code: 'CONT-40RH', scope_or_cont_type: "40'RH", fee_name_vie: "Container 40' Lạnh Cao (40'RH)", contract_text_eng: '40ft High-Cube Reefer Container', unit_basis: 'Container', standard_rate: 0, provider_or_rule: 'Max 29.000 KG / 59 CBM / 20 Pallet', dim_cm: '1158x229x255', net_kg: 29000, tare_kg: 59, max_per_pallet: 20 },
];

export interface InsuranceCatalogItem {
  fee_code: string;
  scope_or_cont_type: string;
  unit_basis: string;
  fee_name_vie: string;
  contract_text_eng: string;
  standard_rate: number;
  provider_or_rule: string;
  isAddon: boolean;
}

export const DEFAULT_INSURANCE_CATALOG: InsuranceCatalogItem[] = [
  { fee_code: 'INS-NONE', scope_or_cont_type: 'ALL', unit_basis: '%_CIF_110', fee_name_vie: 'Không mua bảo hiểm (Người mua tự chịu)', contract_text_eng: 'Insurance excluded (to be covered by Buyer)', standard_rate: 0, provider_or_rule: 'Không phát sinh phí bảo hiểm', isAddon: false },
  { fee_code: 'INS-ICC-C', scope_or_cont_type: 'DC', unit_basis: '%_CIF_110', fee_name_vie: 'Bảo hiểm điều kiện C (ICC C - Tối thiểu)', contract_text_eng: 'Institute Cargo Clauses (C) 110% CIF', standard_rate: 0.08, provider_or_rule: 'Mức tối thiểu CIF (Hàng khô)', isAddon: false },
  { fee_code: 'INS-ICC-B', scope_or_cont_type: 'DC', unit_basis: '%_CIF_110', fee_name_vie: 'Bảo hiểm điều kiện B (ICC B - Trung bình)', contract_text_eng: 'Institute Cargo Clauses (B) 110% CIF', standard_rate: 0.18, provider_or_rule: 'Mức mở rộng trung bình (Hàng khô)', isAddon: false },
  { fee_code: 'INS-ICC-A', scope_or_cont_type: 'DC', unit_basis: '%_CIF_110', fee_name_vie: 'Bảo hiểm mọi rủi ro (ICC A - All Risks)', contract_text_eng: 'Institute Cargo Clauses (A) 110% CIF', standard_rate: 0.25, provider_or_rule: 'Bắt buộc cho CIP / Hàng giá trị cao', isAddon: false },
  { fee_code: 'INS-FRZ-A', scope_or_cont_type: 'RF', unit_basis: '%_CIF_110', fee_name_vie: 'Bảo hiểm hàng đông lạnh (Frozen Food Clauses A)', contract_text_eng: 'Institute Frozen Food Clauses (A) 110% CIF', standard_rate: 0.35, provider_or_rule: 'Khuyến nghị bắt buộc cho Container Lạnh (RF)', isAddon: false },
  { fee_code: 'INS-EXT-SWH', scope_or_cont_type: 'ADD-ON', unit_basis: '%_CIF_110', fee_name_vie: 'Điều khoản mở rộng: Rủi ro hấp hơi, nóng ẩm', contract_text_eng: 'incl. Sweating & Heating Clause', standard_rate: 0.05, provider_or_rule: 'Phù hợp nông sản khô đi đường biển dài ngày', isAddon: true },
  { fee_code: 'INS-EXT-WAR', scope_or_cont_type: 'ADD-ON', unit_basis: '%_CIF_110', fee_name_vie: 'Điều khoản mở rộng: Chiến tranh & Đình công', contract_text_eng: 'incl. War & Strikes Clauses', standard_rate: 0.03, provider_or_rule: 'Tuyến qua vùng rủi ro địa chính trị', isAddon: true },
  { fee_code: 'INS-EXT-TPND', scope_or_cont_type: 'ADD-ON', unit_basis: '%_CIF_110', fee_name_vie: 'Điều khoản mở rộng: Trộm cắp & Nước ngọt', contract_text_eng: 'incl. TPND & Fresh Water Damage Clauses', standard_rate: 0.04, provider_or_rule: 'Hàng đóng bao / giá trị cao dễ hư hại nước ngọt', isAddon: true },
];

export interface IncotermMatrixRule {
  code: string;
  freightOwner: 'BUYER' | 'SELLER';
  insOwner: 'NONE' | 'OPTIONAL' | 'MIN_C' | 'MAX_A';
  riskGroup: 'ORIGIN' | 'PORT_ORIGIN' | 'DESTINATION';
  freightLabel: string;
  insLabel: string;
  riskLabel: string;
  includeLocal: boolean;
  includeFreight: boolean;
  includeIns: boolean;
  includeDest: boolean;
  fullName: string;
}

export const INCOTERMS_2020_MATRIX: IncotermMatrixRule[] = [
  { code: 'EXW', freightOwner: 'BUYER', insOwner: 'NONE', riskGroup: 'ORIGIN', freightLabel: 'Người mua trả', insLabel: 'Không bắt buộc', riskLabel: 'Tại xưởng người bán', includeLocal: false, includeFreight: false, includeIns: false, includeDest: false, fullName: 'Ex Works' },
  { code: 'FCA', freightOwner: 'BUYER', insOwner: 'NONE', riskGroup: 'ORIGIN', freightLabel: 'Người mua trả', insLabel: 'Không bắt buộc', riskLabel: 'Giao cho người chuyên chở', includeLocal: true, includeFreight: false, includeIns: false, includeDest: false, fullName: 'Free Carrier' },
  { code: 'FAS', freightOwner: 'BUYER', insOwner: 'NONE', riskGroup: 'PORT_ORIGIN', freightLabel: 'Người mua trả', insLabel: 'Không bắt buộc', riskLabel: 'Dọc mạn tàu cảng đi', includeLocal: true, includeFreight: false, includeIns: false, includeDest: false, fullName: 'Free Alongside Ship' },
  { code: 'FOB', freightOwner: 'BUYER', insOwner: 'NONE', riskGroup: 'PORT_ORIGIN', freightLabel: 'Người mua trả', insLabel: 'Không bắt buộc', riskLabel: 'Xếp lên tàu cảng đi', includeLocal: true, includeFreight: false, includeIns: false, includeDest: false, fullName: 'Free On Board' },
  { code: 'CFR', freightOwner: 'SELLER', insOwner: 'NONE', riskGroup: 'PORT_ORIGIN', freightLabel: 'Người bán trả', insLabel: 'Người mua tự mua', riskLabel: 'Xếp lên tàu cảng đi', includeLocal: true, includeFreight: true, includeIns: false, includeDest: false, fullName: 'Cost and Freight' },
  { code: 'CIF', freightOwner: 'SELLER', insOwner: 'MIN_C', riskGroup: 'PORT_ORIGIN', freightLabel: 'Người bán trả', insLabel: 'Người bán (tối thiểu ICC C)', riskLabel: 'Xếp lên tàu cảng đi', includeLocal: true, includeFreight: true, includeIns: true, includeDest: false, fullName: 'Cost, Insurance & Freight' },
  { code: 'CPT', freightOwner: 'SELLER', insOwner: 'NONE', riskGroup: 'ORIGIN', freightLabel: 'Người bán trả', insLabel: 'Người mua tự mua', riskLabel: 'Giao người chuyên chở đầu tiên', includeLocal: true, includeFreight: true, includeIns: false, includeDest: false, fullName: 'Carriage Paid To' },
  { code: 'CIP', freightOwner: 'SELLER', insOwner: 'MAX_A', riskGroup: 'ORIGIN', freightLabel: 'Người bán trả', insLabel: 'Người bán (bắt buộc ICC A)', riskLabel: 'Giao người chuyên chở đầu tiên', includeLocal: true, includeFreight: true, includeIns: true, includeDest: false, fullName: 'Carriage & Insurance Paid To' },
  { code: 'DAP', freightOwner: 'SELLER', insOwner: 'OPTIONAL', riskGroup: 'DESTINATION', freightLabel: 'Người bán trả', insLabel: 'Bảo vệ người bán (tùy chọn)', riskLabel: 'Tại nơi đến (chưa dỡ hàng)', includeLocal: true, includeFreight: true, includeIns: false, includeDest: true, fullName: 'Delivered at Place' },
  { code: 'DPU', freightOwner: 'SELLER', insOwner: 'OPTIONAL', riskGroup: 'DESTINATION', freightLabel: 'Người bán trả', insLabel: 'Bảo vệ người bán (tùy chọn)', riskLabel: 'Tại nơi đến (đã dỡ hàng)', includeLocal: true, includeFreight: true, includeIns: false, includeDest: true, fullName: 'Delivered at Place Unloaded' },
  { code: 'DDP', freightOwner: 'SELLER', insOwner: 'OPTIONAL', riskGroup: 'DESTINATION', freightLabel: 'Người bán trả', insLabel: 'Bảo vệ người bán (tùy chọn)', riskLabel: 'Tại nơi đến (đã thông quan NK)', includeLocal: true, includeFreight: true, includeIns: false, includeDest: true, fullName: 'Delivered Duty Paid' },
];

export function parseDimCmToCbm(dimCm?: string): number {
  const m = String(dimCm || '')
    .trim()
    .match(/(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)/i);
  if (!m) return 0;
  const l = parseLocaleNumber(m[1]), w = parseLocaleNumber(m[2]), h = parseLocaleNumber(m[3]);
  return l > 0 && w > 0 && h > 0 ? (l * w * h) / 1000000 : 0;
}

export function isReeferProduct(prod?: ProductCatalog | null, fallbackName?: string): boolean {
  const storage = String(prod?.container_type || prod?.storage_temperature || '').toLowerCase();
  const nm = String(fallbackName || prod?.product_name_vie || '').toLowerCase();
  if (storage.includes('khô') || storage.includes('dc') || storage.includes('gp') || storage.includes('thường')) return false;
  if (storage.includes('lạnh') || storage.includes('rf') || storage.includes('rh') || storage.includes('tươi') || storage.includes('đông')) return true;
  return nm.includes('thanh long') || nm.includes('xoài') || nm.includes('sầu riêng') || nm.includes('chôm chôm') || nm.includes('cấp đông') || nm.includes('tươi');
}

export function resolvePackingSpec(packingCode: string, pricingRates: PricingRate[]) {
  const rawCode = String(packingCode || '').trim().toUpperCase();
  const code = rawCode === 'PKG-POUCH-1K' ? 'PKG-VAC-1K' : rawCode;
  const row = pricingRates.find((r) => String(r.fee_category).toUpperCase() === 'PACKING' && (String(r.fee_code).toUpperCase() === rawCode || String(r.fee_code).toUpperCase() === code));
  let def = DEFAULT_PACKING_AND_CONTAINER_RATES.find((d) => d.fee_category === 'PACKING' && (d.fee_code === code || d.fee_code === rawCode));
  if (!row && !def) {
    def = DEFAULT_PACKING_AND_CONTAINER_RATES.find((d) => d.fee_code === 'PKG-CTN-10K');
  }
  const dimCm = String(row?.dim_cm || def?.dim_cm || '40x30x25').trim();
  const cbmPerCarton = parseDimCmToCbm(dimCm) || 0.03;
  let netKg = toNum(row?.net_kg);
  if (netKg <= 0 && def?.net_kg) netKg = def.net_kg;
  if (netKg <= 0 && row) netKg = toNum(row.provider_or_rule);
  if (netKg <= 0) netKg = 10;
  const tareKg = toNum(row?.tare_kg) > 0 ? toNum(row?.tare_kg) : (def?.tare_kg || 0.8);
  const maxPerPallet = toNum(row?.max_per_pallet) > 0 ? toNum(row?.max_per_pallet) : (def?.max_per_pallet || 50);
  const rate = toNum(row?.standard_rate) > 0 ? toNum(row?.standard_rate) : (def?.standard_rate || 0);
  const unitBasis = String(row?.unit_basis || def?.unit_basis || 'Carton');
  const nameVie = String(row?.fee_name_vie || def?.fee_name_vie || code || 'Thùng xuất khẩu');
  const engText = String(row?.contract_text_eng || def?.contract_text_eng || nameVie);
  return { code: code || 'PKG-CTN-10K', dimCm, cbmPerCarton, netKgPerCarton: netKg, tareKgPerCarton: tareKg, maxPerPallet, rate, unitBasis, nameVie, engText };
}

export function getPackingOptionsForProduct(prod: ProductCatalog | null | undefined, pricingRates: PricingRate[], lookups: SystemLookup[]) {
  const isCold = isReeferProduct(prod);
  const pkgRates = pricingRates.filter((r) => String(r.fee_category).toUpperCase() === 'PACKING' && !String(r.fee_code).toUpperCase().startsWith('PKG-PLT'));
  const source = pkgRates.length > 0 ? pkgRates : DEFAULT_PACKING_AND_CONTAINER_RATES.filter((d) => d.fee_category === 'PACKING' && !String(d.fee_code).startsWith('PKG-PLT'));
  const filtered = source.filter((r) => {
    const scope = String(r.scope_or_cont_type || 'ALL').toUpperCase();
    if (scope === 'ALL' || !scope) return true;
    return isCold ? scope.includes('REEFER') || scope.includes('RF') : !scope.includes('REEFER');
  });
  return (filtered.length > 0 ? filtered : source).map((r) => {
    const rate = toNum(r.standard_rate);
    const kg = toNum(r.net_kg) || 10;
    const perKg = String(r.unit_basis || '').toLowerCase().includes('kg') ? rate : Math.round((rate / Math.max(1, kg)) * 1000) / 1000;
    const lk = lookups.find((l) => String(l.category).toUpperCase() === 'PACKING' && String(l.code).toUpperCase() === String(r.fee_code).toUpperCase());
    return {
      code: String(r.fee_code || ''),
      name: String(r.fee_name_vie || lk?.display_name_vie || r.fee_code || ''),
      engText: String(r.contract_text_eng || lk?.contract_text_eng || r.fee_name_vie || ''),
      rate: rate,
      perKgRate: perKg,
    };
  });
}

export function computeItemPackingAndPallet(weight: number, packingCode: string, packingExtra: number, pricingRates: PricingRate[]) {
  const w = Math.max(0, toNum(weight));
  const spec = resolvePackingSpec(packingCode, pricingRates);
  const kgPerCtn = Math.max(0.5, spec.netKgPerCarton || 10);
  const cartons = w > 0 ? Math.ceil(w / kgPerCtn) : 0;
  const tareKg = Math.round(cartons * spec.tareKgPerCarton * 100) / 100;
  const grossWeightKg = Math.round((w + tareKg) * 100) / 100;
  const cbm = Math.round(cartons * spec.cbmPerCarton * 1000) / 1000;
  const rate = spec.rate > 0 ? spec.rate : Math.max(0, toNum(packingExtra));
  const unitLower = spec.unitBasis.toLowerCase();
  const packingCost = rate > 0
    ? (unitLower.includes('kg') ? Math.round(w * rate * 100) / 100 : Math.round(cartons * rate * 100) / 100)
    : 0;
  return { cartons, maxPerPallet: spec.maxPerPallet, tareKg, grossWeightKg, cbm, packingCost };
}

export function computeOrderPalletSummary(items: OrderItem[], usePallet: boolean, pricingRates: PricingRate[], rateOverride?: number) {
  const pltSpec = resolvePackingSpec('PKG-PLT-YES', pricingRates);
  const pltTareEach = pltSpec.tareKgPerCarton > 0 ? pltSpec.tareKgPerCarton : 18;
  const pltBaseCbmEach = parseDimCmToCbm(pltSpec.dimCm) || 0.17;
  let totalCartons = 0;
  let rawPalletFractions = 0;
  let skuPackingCost = 0;
  let cargoNetKg = 0;
  let packingTareKg = 0;
  let cargoCbm = 0;
  const distinctPackSpecs = new Set<string>();
  const distinctSkus = new Set<string>();

  items.forEach((it) => {
    const w = Math.max(0, toNum(it.weight));
    const spec = resolvePackingSpec(it.packingCode, pricingRates);
    const c = computeItemPackingAndPallet(w, it.packingCode, it.packingExtra, pricingRates);
    const maxPlt = c.maxPerPallet > 0 ? c.maxPerPallet : 50;
    if (usePallet && c.cartons > 0) {
      rawPalletFractions += c.cartons / maxPlt;
    }
    if (c.cartons > 0 && spec.code) {
      distinctPackSpecs.add(spec.code.toUpperCase());
    }
    if (w > 0 && it.sku) {
      distinctSkus.add(it.sku.trim().toUpperCase());
    }
    totalCartons += c.cartons;
    skuPackingCost += c.packingCost;
    cargoNetKg += w;
    packingTareKg += c.tareKg;
    cargoCbm += c.cbm;
  });

  const hasMixedPacking = distinctPackSpecs.size >= 2 || distinctSkus.size >= 2;
  const lossFactor = hasMixedPacking ? 1.05 : 1.0;
  const totalPallets = usePallet && rawPalletFractions > 0 ? Math.ceil(rawPalletFractions * lossFactor) : 0;
  const stdPltRate = pltSpec.rate > 0 ? pltSpec.rate : 18;
  const palletRate = rateOverride !== undefined && rateOverride >= 0 ? rateOverride : stdPltRate;
  const palletTareKg = Math.round(totalPallets * pltTareEach * 100) / 100;
  const palletCbm = Math.round(totalPallets * pltBaseCbmEach * 1000) / 1000;
  const totalGrossWeightKg = Math.round((cargoNetKg + packingTareKg + palletTareKg) * 100) / 100;
  const totalCbm = Math.round((cargoCbm + palletCbm) * 1000) / 1000;
  const palletFee = Math.round(totalPallets * palletRate * 100) / 100;
  skuPackingCost = Math.round(skuPackingCost * 100) / 100;

  return {
    cargoNetKg: Math.round(cargoNetKg * 100) / 100,
    packingTareKg: Math.round(packingTareKg * 100) / 100,
    palletTareKg,
    totalGrossWeightKg,
    cargoCbm: Math.round(cargoCbm * 1000) / 1000,
    palletCbm,
    totalCbm,
    totalCartons,
    totalPallets,
    palletLossApplied: hasMixedPacking,
    palletRate,
    palletFee,
    skuPackingCost,
    totalPackingPalletCost: Math.round((skuPackingCost + palletFee) * 100) / 100,
  };
}

export function resolveContainerSpecs(pricingRates: PricingRate[]) {
  const contRates = pricingRates.filter((r) => String(r.fee_category).toUpperCase() === 'CONTAINER');
  const one = (feeCode: string, shortCode: string, defKg: number, defCbm: number, defPlt: number) => {
    const row = contRates.find((r) => {
      const fc = String(r.fee_code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const sc = String(r.scope_or_cont_type || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const targetFc = feeCode.replace(/[^A-Z0-9]/g, '');
      const targetSc = shortCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
      return fc === targetFc || sc === targetSc || fc.endsWith(targetSc);
    });

    // Normalize payload KG: guard against metric tons or Vietnamese dot-thousands parsed as float (e.g. 27.4 -> 27,400 KG)
    let rawKg = parseLocaleNumber(row?.net_kg);
    if (rawKg > 0 && rawKg < 100) {
      rawKg = Math.round(rawKg * 1000);
    }
    const maxPayloadKg = rawKg >= 5000 && rawKg <= 40000 ? rawKg : defKg;

    // Normalize usable CBM: guard against unreasonable values
    const rawCbm = parseLocaleNumber(row?.tare_kg);
    const usableCbm = rawCbm >= 10 && rawCbm <= 100 ? rawCbm : defCbm;

    const rawPlt = parseLocaleNumber(row?.max_per_pallet);
    const maxPallets = rawPlt >= 4 && rawPlt <= 40 ? Math.floor(rawPlt) : defPlt;

    return {
      code: shortCode,
      maxPayloadKg,
      usableCbm,
      maxPallets,
    };
  };
  return {
    '20DC': one('CONT-20GP', '20DC', 28200, 28, 10),
    '40DC': one('CONT-40GP', '40DC', 26700, 58, 20),
    '40HC': one('CONT-40HC', '40HC', 26500, 67, 21),
    "20'RF": one('CONT-20RF', "20'RF", 27400, 24, 9),
    "40'RF": one('CONT-40RF', "40'RF", 29300, 51, 20),
    "40'RH": one('CONT-40RH', "40'RH", 29000, 59, 20),
  };
}

function solveSingleStreamMix(
  grossKg: number,
  cbm: number,
  pallets: number,
  usePallet: boolean,
  c20: { maxPayloadKg: number; usableCbm: number; maxPallets: number },
  c40: { maxPayloadKg: number; usableCbm: number; maxPallets: number },
  c40hc: { maxPayloadKg: number; usableCbm: number; maxPallets: number }
) {
  if (grossKg <= 0 && cbm <= 0 && (!usePallet || pallets <= 0)) {
    return { shipMode: 'NONE' as const, q20: 0, q40: 0, q40hc: 0, fillPct20: 0 };
  }
  const pltNeed = usePallet ? pallets : 0;
  const fillW = grossKg / Math.max(1, c20.maxPayloadKg);
  const fillV = cbm / Math.max(1, c20.usableCbm);
  const fillP = usePallet && c20.maxPallets > 0 ? pltNeed / c20.maxPallets : 0;
  const maxFill20 = Math.max(fillW, fillV, fillP);
  const fillPct20 = Math.round(maxFill20 * 100);

  if (maxFill20 < 0.55) {
    return { shipMode: 'LCL' as const, q20: 0, q40: 0, q40hc: 0, fillPct20 };
  }
  if (grossKg <= c20.maxPayloadKg && cbm <= c20.usableCbm && (!usePallet || pltNeed <= c20.maxPallets)) {
    return { shipMode: 'FCL' as const, q20: 1, q40: 0, q40hc: 0, fillPct20 };
  }

  const big = c40hc || c40;
  const limit40H = Math.max(1, Math.ceil(grossKg / Math.max(1, big.maxPayloadKg)), Math.ceil(cbm / Math.max(1, big.usableCbm)), usePallet ? Math.ceil(pltNeed / Math.max(1, big.maxPallets)) : 0);
  const limit40 = Math.max(1, Math.ceil(grossKg / Math.max(1, c40.maxPayloadKg)), Math.ceil(cbm / Math.max(1, c40.usableCbm)), usePallet ? Math.ceil(pltNeed / Math.max(1, c40.maxPallets)) : 0);

  let best = { q20: 0, q40: 0, q40hc: limit40H, score: limit40H * 1.76, totalConts: limit40H };
  for (let n40hc = 0; n40hc <= limit40H; n40hc++) {
    for (let n40 = 0; n40 <= limit40; n40++) {
      const remKg = Math.max(0, grossKg - n40hc * big.maxPayloadKg - n40 * c40.maxPayloadKg);
      const remCbm = Math.max(0, cbm - n40hc * big.usableCbm - n40 * c40.usableCbm);
      const remPlt = usePallet ? Math.max(0, pltNeed - n40hc * big.maxPallets - n40 * c40.maxPallets) : 0;
      const n20 = (remKg > 0 || remCbm > 0 || remPlt > 0)
        ? Math.max(
            remKg > 0 ? Math.ceil(remKg / Math.max(1, c20.maxPayloadKg)) : 0,
            remCbm > 0 ? Math.ceil(remCbm / Math.max(1, c20.usableCbm)) : 0,
            usePallet && remPlt > 0 ? Math.ceil(remPlt / Math.max(1, c20.maxPallets)) : 0
          )
        : 0;
      const totCont = n40hc + n40 + n20;
      if (totCont === 0) continue;
      const score = n40hc * 1.76 + n40 * 1.72 + n20 * 1.0;
      if (score < best.score - 0.0001 || (Math.abs(score - best.score) <= 0.0001 && (totCont < best.totalConts || (totCont === best.totalConts && n40hc > best.q40hc)))) {
        best = { q20: n20, q40: n40, q40hc: n40hc, score, totalConts: totCont };
      }
    }
  }
  return { shipMode: 'FCL' as const, q20: best.q20, q40: best.q40, q40hc: best.q40hc, fillPct20 };
}

export function solveOptimalContainerMix(items: OrderItem[], usePallet: boolean, products: ProductCatalog[], pricingRates: PricingRate[]) {
  const dryItems: OrderItem[] = [];
  const rfItems: OrderItem[] = [];
  items.forEach((it) => {
    const prod = products.find((p) => p.sku_code.trim().toLowerCase() === it.sku.trim().toLowerCase());
    if (isReeferProduct(prod, it.name)) rfItems.push(it);
    else dryItems.push(it);
  });
  const drySum = computeOrderPalletSummary(dryItems, usePallet, pricingRates);
  const rfSum = computeOrderPalletSummary(rfItems, usePallet, pricingRates);
  const specs = resolveContainerSpecs(pricingRates);
  const dryMix = solveSingleStreamMix(drySum.totalGrossWeightKg, drySum.totalCbm, drySum.totalPallets, usePallet, specs['20DC'], specs['40DC'], specs['40HC']);
  const rfMix = solveSingleStreamMix(rfSum.totalGrossWeightKg, rfSum.totalCbm, rfSum.totalPallets, usePallet, specs["20'RF"], specs["40'RF"], specs["40'RH"]);
  return {
    qty20DC: dryMix.q20,
    qty40DC: dryMix.q40,
    qty40HC: dryMix.q40hc,
    qty20RF: rfMix.q20,
    qty40RF: rfMix.q40,
    qty40RH: rfMix.q40hc,
    dryMode: dryMix.shipMode,
    reeferMode: rfMix.shipMode,
    dryFillPct20: dryMix.fillPct20,
    reeferFillPct20: rfMix.fillPct20,
  };
}

export interface ContainerMixState {
  q20dc: number;
  q40dc: number;
  q40hc: number;
  q20rf: number;
  q40rf: number;
  q40rh: number;
  dry: number;
  reefer: number;
  total: number;
  dryMode: 'FCL' | 'LCL' | 'NONE';
  reeferMode: 'FCL' | 'LCL' | 'NONE';
  hasLcl: boolean;
  lclDryWeightKg: number;
  lclDryCbm: number;
  lclDryWm: number;
  lclRfWeightKg: number;
  lclRfCbm: number;
  lclRfWm: number;
  lclWeightKg: number;
  lclCbm: number;
  lclWm: number;
  lclBasis: 'WM' | 'CBM' | 'TON';
  lclRate: number;
  lclFreight: number;
  summaryStr: string;
}

export function buildContainerMixState(
  qtys: { q20dc: number; q40dc: number; q40hc: number; q20rf: number; q40rf: number; q40rh: number },
  items: OrderItem[],
  usePallet: boolean,
  lclBasis: 'WM' | 'CBM' | 'TON',
  lclRate: number,
  products: ProductCatalog[],
  pricingRates: PricingRate[]
): ContainerMixState {
  const q20dc = Math.max(0, Math.floor(qtys.q20dc));
  const q40dc = Math.max(0, Math.floor(qtys.q40dc));
  const q40hc = Math.max(0, Math.floor(qtys.q40hc));
  const q20rf = Math.max(0, Math.floor(qtys.q20rf));
  const q40rf = Math.max(0, Math.floor(qtys.q40rf));
  const q40rh = Math.max(0, Math.floor(qtys.q40rh));
  const dry = q20dc + q40dc + q40hc;
  const reefer = q20rf + q40rf + q40rh;
  const total = dry + reefer;

  const dryItems = items.filter((it) => {
    const p = products.find((x) => x.sku_code.toLowerCase() === it.sku.toLowerCase());
    return !isReeferProduct(p, it.name);
  });
  const rfItems = items.filter((it) => {
    const p = products.find((x) => x.sku_code.toLowerCase() === it.sku.toLowerCase());
    return isReeferProduct(p, it.name);
  });
  const drySum = computeOrderPalletSummary(dryItems, usePallet, pricingRates);
  const rfSum = computeOrderPalletSummary(rfItems, usePallet, pricingRates);
  const hasDryCargo = dryItems.length > 0 && (drySum.totalGrossWeightKg > 0 || drySum.totalCbm > 0);
  const hasReeferCargo = rfItems.length > 0 && (rfSum.totalGrossWeightKg > 0 || rfSum.totalCbm > 0);

  const dryMode: 'FCL' | 'LCL' | 'NONE' = hasDryCargo ? (dry > 0 ? 'FCL' : 'LCL') : (dry > 0 ? 'FCL' : 'NONE');
  const reeferMode: 'FCL' | 'LCL' | 'NONE' = hasReeferCargo ? (reefer > 0 ? 'FCL' : 'LCL') : (reefer > 0 ? 'FCL' : 'NONE');
  const hasLcl = dryMode === 'LCL' || reeferMode === 'LCL';

  const lclDryWeightKg = dryMode === 'LCL' ? drySum.totalGrossWeightKg : 0;
  const lclDryCbm = dryMode === 'LCL' ? drySum.totalCbm : 0;
  const lclRfWeightKg = reeferMode === 'LCL' ? rfSum.totalGrossWeightKg : 0;
  const lclRfCbm = reeferMode === 'LCL' ? rfSum.totalCbm : 0;
  const lclDryWm = Math.max(lclDryWeightKg / 1000, lclDryCbm);
  const lclRfWm = Math.max(lclRfWeightKg / 1000, lclRfCbm);
  const lclWeightKg = lclDryWeightKg + lclRfWeightKg;
  const lclCbm = lclDryCbm + lclRfCbm;
  const lclWm = lclDryWm + lclRfWm;
  const lclUnits =
    lclBasis === 'WM' ? lclWm : lclBasis === 'TON' ? lclWeightKg / 1000 : lclCbm;
  const lclFreight = hasLcl ? Math.round(lclUnits * lclRate * 100) / 100 : 0;

  const parts: string[] = [];
  if (q20dc > 0) parts.push(`${q20dc} x 20'DC`);
  if (q40dc > 0) parts.push(`${q40dc} x 40'DC`);
  if (q40hc > 0) parts.push(`${q40hc} x 40'HC`);
  if (q20rf > 0) parts.push(`${q20rf} x 20'RF`);
  if (q40rf > 0) parts.push(`${q40rf} x 40'RF`);
  if (q40rh > 0) parts.push(`${q40rh} x 40'RH`);
  if (dryMode === 'LCL') parts.push('LCL (Khô)');
  if (reeferMode === 'LCL') parts.push('LCL (Lạnh)');

  return {
    q20dc, q40dc, q40hc, q20rf, q40rf, q40rh,
    dry, reefer, total, dryMode, reeferMode, hasLcl,
    lclDryWeightKg: Math.round(lclDryWeightKg * 100) / 100,
    lclDryCbm: Math.round(lclDryCbm * 1000) / 1000,
    lclDryWm: Math.round(lclDryWm * 1000) / 1000,
    lclRfWeightKg: Math.round(lclRfWeightKg * 100) / 100,
    lclRfCbm: Math.round(lclRfCbm * 1000) / 1000,
    lclRfWm: Math.round(lclRfWm * 1000) / 1000,
    lclWeightKg: Math.round(lclWeightKg * 100) / 100,
    lclCbm: Math.round(lclCbm * 1000) / 1000,
    lclWm: Math.round(lclWm * 1000) / 1000,
    lclBasis, lclRate, lclFreight,
    summaryStr: parts.join(' + '),
  };
}

export function computeScheduleOceanAndMissing(sch: ShippingSchedule | null | undefined, mix: ContainerMixState) {
  if (!sch) {
    const fallbackLcl = Math.round(toNum(mix.lclFreight) * 100) / 100;
    return { ocean: fallbackLcl, fclOcean: 0, lclOcean: fallbackLcl, surcharge: 0, missing: [] as string[] };
  }
  const r20dc = toNum(sch.rate_20_dc);
  const r40dc = toNum(sch.rate_40_dc);
  const r40hc = toNum(sch.rate_40_hc) || (r40dc > 0 ? Math.round(r40dc * 1.05) : 0);
  const r20rf = toNum(sch.rate_20_rf);
  const r40rf = toNum(sch.rate_40_rf);
  const r40rh = toNum(sch.rate_40_rh) || (r40rf > 0 ? Math.round(r40rf * 1.05) : 0);

  const missing: string[] = [];
  if (mix.q20dc > 0 && r20dc <= 0) missing.push("20'DC");
  if (mix.q40dc > 0 && r40dc <= 0) missing.push("40'DC");
  if (mix.q40hc > 0 && r40hc <= 0) missing.push("40'HC");
  if (mix.q20rf > 0 && r20rf <= 0) missing.push("20'RF");
  if (mix.q40rf > 0 && r40rf <= 0) missing.push("40'RF");
  if (mix.q40rh > 0 && r40rh <= 0) missing.push("40'RH");

  const thc20d = toNum(sch.thc_20_dry);
  const thc40d = toNum(sch.thc_40_dry);
  const thc20r = toNum(sch.thc_20_reefer);
  const thc40r = toNum(sch.thc_40_reefer);
  const billSealShipment = toNum(sch.bill_seal_fee_shipment);
  const blFee = toNum(sch.b_l_fee);
  const sealFee = toNum(sch.seal_fee);
  const perContFuelPeak = toNum(sch.baf_fee) + toNum(sch.lss_fee) + toNum(sch.pss_fee);

  const dry40Count = mix.q40dc + mix.q40hc;
  const rf40Count = mix.q40rf + mix.q40rh;

  const fclOcean = mix.q20dc * r20dc + mix.q40dc * r40dc + mix.q40hc * r40hc + mix.q20rf * r20rf + mix.q40rf * r40rf + mix.q40rh * r40rh;
  let fclSurcharge = 0;
  if (mix.total > 0) {
    const fclThc = mix.q20dc * thc20d + dry40Count * thc40d + mix.q20rf * thc20r + rf40Count * thc40r;
    const docSealFee = billSealShipment > 0 ? billSealShipment : blFee + sealFee * mix.total;
    fclSurcharge = fclThc + docSealFee + perContFuelPeak * mix.total;
  }

  let lclOcean = 0;
  let lclSurcharge = 0;
  if (mix.hasLcl) {
    if (mix.lclDryWm > 0) {
      const base20Dry = r20dc > 0 ? r20dc : (r40dc > 0 ? r40dc * 0.65 : (r40hc > 0 ? r40hc * 0.6 : 0));
      const dryUnitWm = base20Dry > 0 ? base20Dry / 28 : mix.lclRate;
      if (dryUnitWm <= 0) missing.push('LCL Khô');
      lclOcean += dryUnitWm * mix.lclDryWm;
      const dryThcBase = thc20d > 0 ? thc20d : thc40d * 0.65;
      lclSurcharge += (mix.lclDryWm / 28) * (dryThcBase + perContFuelPeak);
    }
    if (mix.lclRfWm > 0) {
      const base20Rf = r20rf > 0 ? r20rf : (r40rf > 0 ? r40rf * 0.65 : (r40rh > 0 ? r40rh * 0.6 : r20dc * 1.45));
      const rfUnitWm = base20Rf > 0 ? base20Rf / 24 : mix.lclRate;
      if (rfUnitWm <= 0) missing.push('LCL Lạnh');
      lclOcean += rfUnitWm * mix.lclRfWm;
      const rfThcBase = thc20r > 0 ? thc20r : (thc40r > 0 ? thc40r * 0.65 : thc20d);
      lclSurcharge += (mix.lclRfWm / 24) * (rfThcBase + perContFuelPeak);
    }
    if (mix.total === 0) {
      lclSurcharge += billSealShipment > 0 ? billSealShipment : blFee;
    }
  }

  return {
    ocean: Math.round((fclOcean + lclOcean) * 100) / 100,
    fclOcean: Math.round(fclOcean * 100) / 100,
    lclOcean: Math.round(lclOcean * 100) / 100,
    surcharge: Math.round((fclSurcharge + lclSurcharge) * 100) / 100,
    missing,
  };
}

export function computeLocalChargesForMix(mix: ContainerMixState, pricingRates: PricingRate[]): number {
  if (mix.total === 0 && !mix.hasLcl) return 0;
  let total = 0;
  pricingRates
    .filter((r) => String(r.fee_category).toUpperCase() === 'LOCAL_CHARGE')
    .forEach((lc) => {
      const code = String(lc.fee_code || '').toUpperCase();
      const appCont = String(lc.scope_or_cont_type || '').toUpperCase().replace(/'/g, '');
      const unit = String(lc.unit_basis || '').toLowerCase();
      const fee = toNum(lc.standard_rate);
      if (!unit.includes('cont')) {
        total += fee;
      } else if (mix.total === 0) {
        // LCL doesn't pay per-FCL container local charges
      } else if (code.includes('REEFER-PLUG') || code.includes('PLUG') || code.includes('PTI')) {
        total += fee * mix.reefer;
      } else if (appCont === '20DC' || appCont === '20GP') {
        total += fee * mix.q20dc;
      } else if (appCont === '40DC' || appCont === '40GP') {
        total += fee * mix.q40dc;
      } else if (appCont === '40HC') {
        total += fee * mix.q40hc;
      } else if (appCont === '20RF') {
        total += fee * mix.q20rf;
      } else if (appCont === '40RF') {
        total += fee * mix.q40rf;
      } else if (appCont === '40RH') {
        total += fee * mix.q40rh;
      } else if (appCont === 'RF' || appCont === 'REEFER') {
        total += fee * mix.reefer;
      } else if (appCont === 'DC' || appCont === 'DRY') {
        total += fee * mix.dry;
      } else {
        total += fee * mix.total;
      }
    });
  return Math.round(total * 100) / 100;
}

export function computeDomesticTruckingForMix(mix: ContainerMixState, pricingRates: PricingRate[]): number {
  if (mix.total === 0 && !mix.hasLcl) return 0;
  const truckRows = pricingRates.filter((r) => {
    const cat = String(r.fee_category || '').toUpperCase();
    const code = String(r.fee_code || '').toUpperCase();
    const name = String(r.fee_name_vie || '').toLowerCase();
    return cat.includes('TRUCK') || cat.includes('INLAND') || cat.includes('DOMESTIC') || code.startsWith('TRK') || name.includes('trucking') || name.includes('vận tải nội địa') || name.includes('kéo cont');
  });
  if (truckRows.length === 0) return 0;

  let matchedTotal = 0;
  let usedContMatch = false;
  const cnt20 = mix.q20dc + mix.q20rf;
  const cnt40 = mix.q40dc + mix.q40hc + mix.q40rf + mix.q40rh;

  truckRows.forEach((tr) => {
    const scope = String(tr.scope_or_cont_type || '').toUpperCase().replace(/'/g, '');
    const unit = String(tr.unit_basis || '').toLowerCase();
    const fee = toNum(tr.standard_rate);
    if (fee <= 0) return;

    if (scope.includes('LCL') && mix.hasLcl && mix.total === 0) {
      matchedTotal += unit.includes('cbm') || unit.includes('w/m') ? fee * Math.max(1, mix.lclWm) : fee;
      usedContMatch = true;
    } else if (mix.total > 0) {
      if (scope === '20DC' || scope === '20GP' || scope === '20') {
        matchedTotal += fee * mix.q20dc;
        usedContMatch = true;
      } else if (scope === '40DC' || scope === '40GP' || scope === '40HC' || scope === '40') {
        matchedTotal += fee * (scope === '40HC' ? mix.q40hc : scope.startsWith('40D') ? mix.q40dc : (mix.q40dc + mix.q40hc));
        usedContMatch = true;
      } else if (scope === '20RF') {
        matchedTotal += fee * mix.q20rf;
        usedContMatch = true;
      } else if (scope === '40RF' || scope === '40RH') {
        matchedTotal += fee * (scope === '40RH' ? mix.q40rh : mix.q40rf);
        usedContMatch = true;
      } else if (scope.includes('20') && cnt20 > 0) {
        matchedTotal += fee * cnt20;
        usedContMatch = true;
      } else if (scope.includes('40') && cnt40 > 0) {
        matchedTotal += fee * cnt40;
        usedContMatch = true;
      }
    }
  });

  if (!usedContMatch) {
    const general = truckRows.find((tr) => {
      const sc = String(tr.scope_or_cont_type || '').toUpperCase();
      return !sc || sc === 'ALL' || sc === 'SHIPMENT';
    }) || truckRows[0];
    if (general) {
      const unit = String(general.unit_basis || '').toLowerCase();
      const fee = toNum(general.standard_rate);
      matchedTotal = unit.includes('cont') && mix.total > 0 ? fee * mix.total : fee;
    }
  }
  return Math.round(matchedTotal * 100) / 100;
}

export function computeCustomsSplit(pricingRates: PricingRate[]) {
  let customsExportUsd = 0;
  let permitsUsd = 0;
  pricingRates
    .filter((r) => String(r.fee_category).toUpperCase() === 'CUSTOMS_FEE')
    .forEach((cf) => {
      const name = String(cf.fee_name_vie || cf.fee_code || '').toLowerCase();
      const fee = toNum(cf.standard_rate);
      if (/kiểm dịch|phytosanitary|hun trùng|fumigation|c\/o|chứng nhận/i.test(name)) {
        permitsUsd += fee;
      } else {
        customsExportUsd += fee;
      }
    });
  return {
    customsExportUsd: Math.round(customsExportUsd * 100) / 100,
    permitsUsd: Math.round(permitsUsd * 100) / 100,
    customsTotal: Math.round((customsExportUsd + permitsUsd) * 100) / 100,
  };
}

export function getInsuranceCatalog(pricingRates: PricingRate[]): {
  all: InsuranceCatalogItem[];
  byCode: Record<string, InsuranceCatalogItem>;
  basePolicies: InsuranceCatalogItem[];
  addons: InsuranceCatalogItem[];
} {
  const map: Record<string, InsuranceCatalogItem> = {};
  const order: string[] = [];
  DEFAULT_INSURANCE_CATALOG.forEach((d) => {
    map[d.fee_code] = { ...d };
    order.push(d.fee_code);
  });
  pricingRates.forEach((r) => {
    if (String(r.fee_category).toUpperCase() !== 'INSURANCE') return;
    const code = String(r.fee_code || '').trim().toUpperCase();
    if (!code) return;
    const base = map[code];
    const rate = code === 'INS-NONE' ? 0 : Math.max(0, toNum(r.standard_rate));
    const scope = String(r.scope_or_cont_type || base?.scope_or_cont_type || 'ALL');
    const vie = String(r.fee_name_vie || base?.fee_name_vie || code);
    const isAddon = code.startsWith('INS-EXT') || scope.toUpperCase().includes('ADD') || vie.toLowerCase().includes('mở rộng');
    if (!map[code]) order.push(code);
    map[code] = {
      fee_code: code,
      scope_or_cont_type: scope,
      unit_basis: String(r.unit_basis || base?.unit_basis || '%_CIF_110'),
      fee_name_vie: vie,
      contract_text_eng: String(r.contract_text_eng || base?.contract_text_eng || vie),
      standard_rate: rate,
      provider_or_rule: String(r.provider_or_rule || r.note || base?.provider_or_rule || ''),
      isAddon,
    };
  });
  const all = order.map((c) => map[c]);
  return {
    all,
    byCode: map,
    basePolicies: all.filter((x) => !x.isAddon),
    addons: all.filter((x) => x.isAddon),
  };
}

export function parseInsuranceCodeString(rawVal: string, pricingRates: PricingRate[]) {
  const cat = getInsuranceCatalog(pricingRates);
  const tokens = String(rawVal || '').split(/[+,;]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
  let baseCode = '';
  let addonCodes: string[] = [];
  tokens.forEach((tok) => {
    const item = cat.byCode[tok];
    if ((item && item.isAddon) || tok.startsWith('INS-EXT')) {
      if (!addonCodes.includes(tok)) addonCodes.push(tok);
    } else if (!baseCode) {
      baseCode = tok;
    }
  });
  if (!baseCode) baseCode = 'INS-NONE';
  if (baseCode === 'INS-NONE') addonCodes = [];
  return { baseCode, addonCodes };
}

export function buildCombinedInsuranceClauseEng(baseCode: string, addonCodes: string[], incotermCode: string, pricingRates: PricingRate[]): string {
  const cat = getInsuranceCatalog(pricingRates);
  const bCode = String(baseCode || 'INS-NONE').toUpperCase();
  if (!bCode || bCode === 'INS-NONE') return '';
  const baseItem = cat.byCode[bCode];
  let baseText = String(baseItem?.contract_text_eng || baseItem?.fee_name_vie || bCode)
    .replace(/\(\s*\+?\s*\d+(?:\.\d+)?\s*%\s*\)/g, '')
    .trim();
  if (incotermCode.toUpperCase() === 'CIP' && /\b110%\s*CIF\b/i.test(baseText)) {
    baseText = baseText.replace(/\b110%\s*CIF\b/gi, '110% CIP');
  }
  const addonTexts: string[] = [];
  addonCodes.forEach((ac) => {
    const aItem = cat.byCode[ac.toUpperCase()];
    if (!aItem) return;
    const txt = String(aItem.contract_text_eng || aItem.fee_name_vie || ac).replace(/^incl\.?\s*/i, '').trim();
    if (txt && !addonTexts.includes(txt)) addonTexts.push(txt);
  });
  return addonTexts.length > 0 ? `${baseText} incl. ${addonTexts.join('; ')}` : baseText;
}

export function computeInsurancePremiumExact(cfValue: number, ratePct: number): number {
  const r = Math.max(0, ratePct) / 100;
  if (r <= 0 || r >= 1 || cfValue <= 0) return 0;
  const v = (cfValue * 1.1) / (1 - r);
  return Math.round(r * v * 100) / 100;
}

export function parseOrderItems(inq?: Partial<InquiryQuotation> | null, products: ProductCatalog[] = [], pricingRates: PricingRate[] = []): OrderItem[] {
  if (!inq) return [];
  const raw = String(inq.order_items || '').trim();
  let parsed: Array<Partial<OrderItem>> = [];
  if (raw) {
    if (raw.startsWith('[')) {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) parsed = arr;
      } catch {}
    } else {
      raw.split(/\r?\n|;/).map((s) => s.trim()).filter(Boolean).forEach((ln) => {
        const cols = ln.split(':');
        if (cols[0]?.trim()) {
          parsed.push({ sku: cols[0].trim(), weight: toNum(cols[1]), packingCode: (cols[2] || '').trim() });
        }
      });
    }
  }
  if (parsed.length === 0) {
    const note = String(inq.note || '');
    const m = note.match(/\[ITEMS:([^\]]+)\]/);
    if (m && m[1]) {
      m[1].split(';').forEach((seg) => {
        const parts = seg.split('|');
        if (parts[0]?.trim()) {
          parsed.push({
            sku: parts[0].trim(),
            name: (parts[1] || parts[0]).trim(),
            weight: toNum(parts[2]),
            packingCode: (parts[3] || '').trim(),
            packingName: (parts[4] || '').trim(),
            packingExtra: toNum(parts[5]),
            palletCode: (parts[6] || 'PKG-PLT-NO').trim(),
            cartons: toNum(parts[7]),
            pallets: toNum(parts[8]),
            packingCost: toNum(parts[9]),
          });
        }
      });
    }
  }
  if (parsed.length === 0 && (inq.sku_code || inq.product_name_vie)) {
    const skus = String(inq.sku_code || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (skus.length > 1) {
      const avgW = Math.round((toNum(inq.net_weight_kgs) / skus.length) * 100) / 100;
      parsed = skus.map((s) => ({ sku: s, weight: avgW }));
    } else {
      parsed = [{ sku: inq.sku_code || '', name: inq.product_name_vie || inq.sku_code || '', weight: toNum(inq.net_weight_kgs) }];
    }
  }

  return parsed
    .map((it) => {
      const sku = String(it.sku || '').trim();
      const prod = products.find((p) => p.sku_code.toLowerCase() === sku.toLowerCase());
      const pCode = String(it.packingCode || 'PKG-CTN-10K').trim() === 'PKG-POUCH-1K' ? 'PKG-VAC-1K' : String(it.packingCode || 'PKG-CTN-10K').trim();
      const spec = resolvePackingSpec(pCode, pricingRates);
      const w = toNum(it.weight);
      const calc = computeItemPackingAndPallet(w, pCode, toNum(it.packingExtra), pricingRates);
      return {
        sku,
        name: String(it.name || prod?.product_name_vie || sku || '-').trim(),
        name_eng: String(it.name_eng || prod?.product_name_eng || prod?.product_name_vie || sku).trim(),
        weight: w,
        packingCode: pCode,
        packingName: String(it.packingName || spec.nameVie).trim(),
        packingExtra: toNum(it.packingExtra) || spec.rate,
        palletCode: String(it.palletCode || 'PKG-PLT-NO').trim(),
        cartons: toNum(it.cartons) || calc.cartons,
        pallets: toNum(it.pallets),
        tareKg: calc.tareKg,
        grossWeightKg: calc.grossWeightKg,
        cbm: calc.cbm,
        packingCost: toNum(it.packingCost) || calc.packingCost,
      };
    })
    .filter((x) => x.sku || (x.name && x.name !== '-'));
}

export function stripItemsTag(note?: string): string {
  return String(note || '').replace(/\[ITEMS:[^\]]+\]/g, '').trim();
}

export function suggestCoFormCode(pod?: string, country?: string): string {
  const c = `${pod || ''} ${country || ''}`.toLowerCase();
  if (/thái lan|thailand|indonesia|malaysia|singapore|philippines|laos|cambodia|myanmar|brunei|asean|laem chabang|port klang|jakarta|manila/.test(c)) return 'Form D';
  if (/trung quốc|china|shanghai|ningbo|shenzhen|qingdao|xiamen|guangzhou|shekou|hong kong/.test(c)) return 'Form E';
  if (/hàn quốc|korea|busan|pusan|incheon|seoul/.test(c)) return 'Form AK';
  if (/nhật bản|japan|tokyo|yokohama|osaka|kobe|nagoya/.test(c)) return 'Form AJ';
  if (/đức|germany|hamburg|pháp|france|hà lan|netherlands|rotterdam|bỉ|belgium|antwerp|ý|italy|tây ban nha|spain|eu|europe/.test(c)) return 'EUR.1';
  if (/úc|australia|sydney|melbourne|brisbane|new zealand|auckland/.test(c)) return 'Form AANZ';
  if (/ấn độ|india|nhava sheva|chennai|mumbai/.test(c)) return 'Form AI';
  return 'Form B';
}

export function computeFreightExpiryStatus(sch: ShippingSchedule) {
  const etdMs = sch.etd ? new Date(sch.etd).getTime() : NaN;
  const etaMs = sch.eta ? new Date(sch.eta).getTime() : NaN;
  const transitDays = !Number.isNaN(etdMs) && !Number.isNaN(etaMs)
    ? Math.max(1, Math.round((etaMs - etdMs) / (1000 * 60 * 60 * 24)))
    : 14;
  let baseThreshold = 7;
  if (transitDays <= 7) baseThreshold = 4;
  else if (transitDays <= 18) baseThreshold = 7;
  else if (transitDays <= 30) baseThreshold = 10;
  else baseThreshold = 14;

  const hasPot = Boolean(String(sch.pot || '').trim() && String(sch.pot).trim() !== '-');
  const hasReefer = toNum(sch.rate_20_rf) > 0 || toNum(sch.rate_40_rf) > 0 || toNum(sch.rate_40_rh) > 0;
  const threshold = baseThreshold + (hasPot || hasReefer ? 2 : 0);

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const expDate = sch.expiry_date ? new Date(sch.expiry_date) : null;
  if (!expDate || Number.isNaN(expDate.getTime())) {
    return { transitDays, threshold, daysLeft: null as number | null, state: 'UNKNOWN' as const };
  }
  expDate.setHours(0, 0, 0, 0);
  const daysLeft = Math.round((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const state = daysLeft < 0 ? ('EXPIRED' as const) : daysLeft <= threshold ? ('EXPIRING' as const) : ('VALID' as const);
  return { transitDays, threshold, daysLeft, state };
}

export function formatCutoffCountdown(cutoffStr?: string) {
  const raw = String(cutoffStr || '').trim();
  if (!raw) return null;
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const dt = new Date(normalized);
  if (Number.isNaN(dt.getTime())) {
    return { label: raw, tone: 'neutral' as const, diffMs: 999999999 };
  }
  const diffMs = dt.getTime() - Date.now();
  if (diffMs < 0) {
    const hrsAgo = Math.abs(Math.round(diffMs / 3600000));
    return { label: `Quá hạn (${hrsAgo}h)`, tone: 'danger' as const, diffMs };
  }
  const totalHours = Math.floor(diffMs / 3600000);
  if (totalHours <= 24) {
    return { label: `Còn ${Math.max(1, totalHours)} giờ`, tone: 'danger' as const, diffMs };
  }
  const days = Math.ceil(diffMs / 86400000);
  if (days <= 3) {
    return { label: `Còn ${days} ngày`, tone: 'warning' as const, diffMs };
  }
  return { label: `Còn ${days} ngày`, tone: 'success' as const, diffMs };
}

export function computeSilentFobUnitPrices(
  items: OrderItem[],
  targetTotalUsd: number,
  products: ProductCatalog[],
  pricingRates: PricingRate[]
): Array<{ item: OrderItem; unitPricePerKg: number; lineTotalUsd: number }> {
  if (items.length === 0) return [];
  const rawLines = items.map((it) => {
    const prod = products.find((p) => p.sku_code.toLowerCase() === it.sku.toLowerCase());
    const baseCostKg = toNum(prod?.unit_price) > 0 ? toNum(prod?.unit_price) : 1.5;
    const spec = resolvePackingSpec(it.packingCode, pricingRates);
    const packPerKg = spec.rate > 0 ? (spec.unitBasis.toLowerCase().includes('kg') ? spec.rate : spec.rate / Math.max(1, spec.netKgPerCarton)) : 0;
    const rawLineCost = Math.max(0.01, (baseCostKg + packPerKg) * Math.max(1, toNum(it.weight)));
    return { item: it, rawLineCost };
  });
  const totalRaw = rawLines.reduce((s, r) => s + r.rawLineCost, 0) || 1;
  const allocated = rawLines.map((r) => {
    const share = r.rawLineCost / totalRaw;
    const lineTotal = Math.round(targetTotalUsd * share * 100) / 100;
    const w = Math.max(1, toNum(r.item.weight));
    const unitPrice = Math.round((lineTotal / w) * 1000) / 1000;
    return { item: r.item, unitPricePerKg: unitPrice, lineTotalUsd: lineTotal };
  });
  const sumLines = allocated.reduce((s, a) => s + a.lineTotalUsd, 0);
  if (allocated.length > 0 && Math.abs(targetTotalUsd - sumLines) > 0.005) {
    const diff = Math.round((targetTotalUsd - sumLines) * 100) / 100;
    const last = allocated[allocated.length - 1];
    last.lineTotalUsd = Math.round((last.lineTotalUsd + diff) * 100) / 100;
    last.unitPricePerKg = Math.round((last.lineTotalUsd / Math.max(1, toNum(last.item.weight))) * 1000) / 1000;
  }
  return allocated;
}

export function computeSellingPriceScaled(
  prop: PricingProposal | undefined,
  extraMeta: ProposalExtraMeta | undefined,
  targetIncoterm: string
): number {
  if (!prop) return 0;
  const baseSelling = toNum(prop.final_selling_price) || 0;
  const inc = targetIncoterm.toUpperCase();
  if (inc === String(prop.recommended_incoterm || '').toUpperCase() && baseSelling > 0) {
    return Math.round(baseSelling * 100) / 100;
  }
  const exw = toNum(extraMeta?.exw_price);
  const fob = toNum(extraMeta?.fob_price);
  const cfr = toNum(extraMeta?.cfr_price);
  const cif = toNum(extraMeta?.cif_price);
  const dest = toNum(extraMeta?.dest_extra);
  const duty = inc === 'DDP' ? toNum(extraMeta?.import_duty_usd) : 0;
  if (inc === 'EXW' && exw > 0) return Math.round(exw * 100) / 100;
  if ((inc === 'FOB' || inc === 'FCA' || inc === 'FAS') && fob > 0) return Math.round(fob * 100) / 100;
  if ((inc === 'CFR' || inc === 'CPT') && cfr > 0) return Math.round(cfr * 100) / 100;
  if (inc === 'CIF' && cif > 0) return Math.round(cif * 100) / 100;
  if (inc === 'CIP') {
    const baseCfr = cfr > 0 ? cfr : baseSelling;
    if (baseCfr > 0) {
      return Math.round((baseCfr + computeInsurancePremiumExact(baseCfr, 0.25)) * 100) / 100;
    }
  }
  if (inc === 'DAP' || inc === 'DPU' || inc === 'DDP') {
    const baseD = cfr > 0 ? cfr : (cif > 0 ? cif : baseSelling);
    if (baseD > 0) return Math.round((baseD + dest + duty) * 100) / 100;
  }
  return Math.round(baseSelling * 100) / 100;
}

export function computeFloorPriceScaled(
  prop: PricingProposal | undefined,
  extraMeta: ProposalExtraMeta | undefined,
  targetIncoterm: string
): number {
  if (!prop) return 0;
  const baseSelling = toNum(prop.final_selling_price) || 1;
  const baseFloor = extraMeta?.floor_price_usd && extraMeta.floor_price_usd > 0 ? extraMeta.floor_price_usd : baseSelling * 0.95;
  const inc = targetIncoterm.toUpperCase();
  if (inc === String(prop.recommended_incoterm || '').toUpperCase()) return Math.round(baseFloor * 100) / 100;
  const targetSell = computeSellingPriceScaled(prop, extraMeta, inc) || baseSelling;
  const ratio = baseFloor / baseSelling;
  return Math.round(targetSell * ratio * 100) / 100;
}

// ==========================================
// VIETNAMESE-TO-ENGLISH INTERNATIONAL TRADE & LOGISTICS TRANSLATION
// ==========================================
const EXACT_LOGISTICS_GLOSSARY: Array<{ keys: string[]; eng: string }> = [
  // Marine Insurance & Extended Clauses
  { keys: ['dieu khoan mo rong rui ro hap hoi nong am', 'rui ro hap hoi nong am', 'dieu khoan mo rong hap hoi nong am', 'hap hoi nong am'], eng: 'incl. Sweating & Heating Clause' },
  { keys: ['bao hiem hang dong lanh', 'bao hiem hang dong lanh frozen food clauses a', 'bao hiem hang lanh', 'bao hiem thuc pham dong lanh'], eng: 'Institute Frozen Food Clauses (A)' },
  { keys: ['bao hiem moi rui ro', 'bao hiem moi rui ro icc a', 'bao hiem moi rui ro icc a all risks', 'bao hiem dieu kien a'], eng: 'Institute Cargo Clauses (A) - All Risks' },
  { keys: ['bao hiem dieu kien b', 'bao hiem dieu kien b icc b', 'bao hiem dieu kien b icc b trung binh'], eng: 'Institute Cargo Clauses (B)' },
  { keys: ['bao hiem dieu kien c', 'bao hiem dieu kien c icc c', 'bao hiem dieu kien c icc c toi thieu'], eng: 'Institute Cargo Clauses (C)' },
  { keys: ['dieu khoan mo rong chien tranh dinh cong', 'chien tranh dinh cong', 'rui ro chien tranh va dinh cong'], eng: 'incl. War & Strikes Clauses' },
  { keys: ['dieu khoan mo rong trom cap nuoc ngot', 'trom cap nuoc ngot', 'trom cap va hu hai nuoc ngot'], eng: 'incl. TPND & Fresh Water Damage Clauses' },
  { keys: ['khong mua bao hiem', 'khong mua bao hiem nguoi mua tu chiu'], eng: 'Insurance excluded (to be covered by Buyer)' },
  { keys: ['bao hiem hong may lanh', 'rui ro hu hong thiet bi lanh'], eng: 'incl. Refrigeration Breakdown Clause (24 Hours)' },
  { keys: ['bao hiem hang hoa duong bien'], eng: 'Marine Cargo Insurance' },

  // Local Charges & Port / Shipping Fees
  { keys: ['phi xep do tai cang', 'phi xep do container tai cang', 'phi thc'], eng: 'Terminal Handling Charge (THC)' },
  { keys: ['phi chung tu van don', 'phi van don', 'phi lam bill'], eng: 'Bill of Lading (B/L) Documentation Fee' },
  { keys: ['phi chi niem phong', 'phi seal', 'phi niem phong container'], eng: 'Container Seal Fee' },
  { keys: ['phi van don va chi', 'phi bill va seal'], eng: 'Bill of Lading & Seal Fee' },
  { keys: ['phi dien giao hang', 'phi telex release'], eng: 'Telex Release / Surrender B/L Fee' },
  { keys: ['phi khai bao trong luong', 'phi can vgm', 'phi vgm'], eng: 'Verified Gross Mass (VGM) Filing Fee' },
  { keys: ['phi cam dien container lanh', 'phi cam dien cont lanh', 'phi chay dien container lanh'], eng: 'Reefer Container Plug-in & Monitoring Charge' },
  { keys: ['phi kiem tra container lanh truoc dong hang', 'phi pti'], eng: 'Pre-Trip Inspection (PTI) Fee for Reefer Container' },
  { keys: ['phi ha bai', 'phi nang ha container', 'phi lift on lift off'], eng: 'Container Lift-On / Lift-Off (LO/LO) Charge' },
  { keys: ['phi van tai noi dia', 'phi keo container', 'phi trucking noi dia', 'cuoc van tai duong bo'], eng: 'Domestic Inland Trucking / Container Haulage' },
  { keys: ['phi gom hang le', 'phi kho cfs'], eng: 'Container Freight Station (CFS) Handling Charge' },
  { keys: ['phi xu ly chung tu', 'phi handling'], eng: 'Documentation & Handling Fee' },
  { keys: ['phi can bang container', 'phi cic'], eng: 'Container Imbalance Charge (CIC)' },
  { keys: ['phu phi nhien lieu', 'phu phi xang dau', 'phi baf'], eng: 'Bunker Adjustment Factor (BAF)' },
  { keys: ['phu phi nhien lieu luu huynh thap', 'phi lss'], eng: 'Low Sulphur Fuel Surcharge (LSS)' },
  { keys: ['phu phi mua cao diem', 'phi pss'], eng: 'Peak Season Surcharge (PSS)' },
  { keys: ['phu phi nhien lieu khan cap', 'phi ebs'], eng: 'Emergency Bunker Surcharge (EBS)' },
  { keys: ['phi khai bao an ninh', 'phi ams', 'phi ens'], eng: 'Advance Manifest / Security Filing Fee (AMS/ENS)' },
  { keys: ['phi luu bai', 'phi luu container tai bai'], eng: 'Container Demurrage Charge' },
  { keys: ['phi luu vo container'], eng: 'Container Detention Charge' },
  { keys: ['phi lenh giao hang', 'phi do'], eng: 'Delivery Order (D/O) Fee' },
  { keys: ['phi ve sinh container'], eng: 'Container Cleaning Fee' },

  // Customs & Export Permits
  { keys: ['phi khai bao hai quan', 'phi thu tuc hai quan', 'phi hai quan xuat khau', 'thong quan xuat khau'], eng: 'Export Customs Clearance Fee' },
  { keys: ['phi kiem dich thuc vat', 'kiem dich thuc vat', 'giay kiem dich thuc vat'], eng: 'Phytosanitary Inspection & Certificate Fee' },
  { keys: ['phi hun trung', 'hun trung container', 'chung thu hun trung'], eng: 'Fumigation Service & Certificate Fee' },
  { keys: ['phi chung nhan xuat xu', 'phi xin co', 'phi cap co', 'giay chung nhan xuat xu'], eng: 'Certificate of Origin (C/O) Issuance Fee' },
  { keys: ['phi kiem tra chat luong', 'chung thu y te', 'giay chung nhan ve sinh an toan thuc pham'], eng: 'Health & Food Safety Certificate Fee' },
  { keys: ['phi chieu xa', 'xu ly chieu xa'], eng: 'Irradiation Quarantine Treatment Fee' },
  { keys: ['phi xu ly hoi nuoc nong', 'xu ly vht'], eng: 'Vapor Heat Treatment (VHT) Fee' },
  { keys: ['phi giam dinh hang hoa', 'phi giam dinh sgs'], eng: 'Pre-Shipment Cargo Inspection Fee' },

  // Packaging & Containers
  { keys: ['khong dung pallet', 'khong dung pallet xep san container', 'xep san container'], eng: 'Loose Floor-Loaded in Container (No Pallet)' },
  { keys: ['pallet go hun trung ispm 15', 'pallet nhua go hun trung ispm 15', 'pallet go xuat khau'], eng: 'Heat-Treated ISPM-15 Export Pallet with Stretch Film' },
  { keys: ['thung carton 5 lop lot tui pe 10kg'], eng: '10kg 5-Ply Corrugated Export Carton with PE Liner' },
  { keys: ['thung carton 5 lop lot tui pe 5kg'], eng: '5kg 5-Ply Corrugated Export Carton with PE Liner' },
  { keys: ['tui hut chan khong 1kg thung 10kg'], eng: '1kg Vacuum PE Bags in 10kg Export Carton' },
  { keys: ['tui pe cap dong iqf 1kg thung chong am 10kg'], eng: '1kg IQF PE Bags in 10kg Moisture-Proof Carton' },
  { keys: ['bao pe khoi iqf 5kg thung chong am 15kg'], eng: '5kg IQF Block Bags in 15kg Waxed Export Carton' },
  { keys: ['container 20 kho tieu chuan'], eng: '20ft General Purpose Dry Container (20\'DC)' },
  { keys: ['container 40 kho tieu chuan'], eng: '40ft General Purpose Dry Container (40\'DC)' },
  { keys: ['container 40 kho cao'], eng: '40ft High-Cube Dry Container (40\'HC)' },
  { keys: ['container 20 lanh'], eng: '20ft Reefer Container (20\'RF)' },
  { keys: ['container 40 lanh tieu chuan'], eng: '40ft Standard Reefer Container (40\'RF)' },
  { keys: ['container 40 lanh cao'], eng: '40ft High-Cube Reefer Container (40\'RH)' },

  // Vietnamese Agricultural Export Products
  { keys: ['thanh long ruot do', 'thanh long ruot do tuoi'], eng: 'Fresh Red Flesh Dragon Fruit' },
  { keys: ['thanh long ruot trang', 'thanh long ruot trang tuoi'], eng: 'Fresh White Flesh Dragon Fruit' },
  { keys: ['sau rieng tuoi', 'sau rieng ri6 tuoi'], eng: 'Fresh Ri6 Durian' },
  { keys: ['sau rieng monthong tuoi'], eng: 'Fresh Monthong Durian' },
  { keys: ['sau rieng cap dong nguyen trai'], eng: 'Frozen Whole Durian (IQF)' },
  { keys: ['sau rieng cap dong tach mui', 'com sau rieng cap dong', 'sau rieng dong lanh'], eng: 'Frozen Durian Pulp / Segments (IQF)' },
  { keys: ['xoai cat chu', 'xoai cat chu tuoi'], eng: 'Fresh Cat Chu Mango' },
  { keys: ['xoai cat hoa loc', 'xoai cat hoa loc tuoi'], eng: 'Fresh Cat Hoa Loc Mango' },
  { keys: ['xoai keo', 'xoai keo tuoi'], eng: 'Fresh Keo Mango' },
  { keys: ['xoai say deo'], eng: 'Soft Dried Mango Slices' },
  { keys: ['hat dieu w320', 'nhan hat dieu w320'], eng: 'Cashew Nut Kernels W320' },
  { keys: ['hat dieu w240', 'nhan hat dieu w240'], eng: 'Cashew Nut Kernels W240' },
  { keys: ['hat dieu rang muoi'], eng: 'Roasted Salted Cashew Nuts' },
  { keys: ['tieu den', 'ho tieu den', 'tieu den nguyen hat'], eng: 'Vietnam Black Peppercorns (FAQ / ASTA)' },
  { keys: ['tieu trang', 'ho tieu trang', 'tieu so'], eng: 'Vietnam White Peppercorns (Double Washed)' },
  { keys: ['ca phe robusta', 'ca phe nhan robusta'], eng: 'Vietnam Robusta Green Coffee Beans' },
  { keys: ['ca phe arabica', 'ca phe nhan arabica'], eng: 'Vietnam Arabica Green Coffee Beans' },
  { keys: ['gao st25', 'gao thom st25'], eng: 'Vietnam ST25 Fragrant Long Grain White Rice' },
  { keys: ['gao jasmine', 'gao thom jasmine'], eng: 'Vietnam Jasmine Fragrant Rice (5% Broken)' },
  { keys: ['dua tuoi', 'dua tuoi got kim cuong', 'dua xiem tuoi'], eng: 'Fresh Diamond-Cut Young Coconut' },
  { keys: ['buoi da xanh', 'buoi da xanh tuoi'], eng: 'Fresh Green Skin Pomelo' },
  { keys: ['chanh leo', 'chanh day', 'chanh leo tuoi'], eng: 'Fresh Passion Fruit' },
  { keys: ['chanh leo cap dong', 'dich chanh leo cap dong'], eng: 'Frozen Passion Fruit Pulp' },
  { keys: ['vai thieu', 'vai thieu tuoi'], eng: 'Fresh Lychee' },
  { keys: ['nhan long', 'nhan tuoi'], eng: 'Fresh Longan' },
  { keys: ['chom chom', 'chom chom tuoi'], eng: 'Fresh Rambutan' },
  { keys: ['mit say', 'mit say gion'], eng: 'Vacuum-Fried Crispy Jackfruit Chips' },
  { keys: ['chuoi tuoi', 'chuoi gia nam my'], eng: 'Fresh Cavendish Bananas' },
  { keys: ['que ong', 'que thanh', 'que viet nam'], eng: 'Vietnam Cassia Cinnamon Sticks / Tubes' },
  { keys: ['hoa hoi', 'hoi kho'], eng: 'Vietnam Dried Star Anise' },
  { keys: ['gung tuoi'], eng: 'Fresh Washed Ginger' },
  { keys: ['ot tuoi', 'ot chi thien tuoi'], eng: 'Fresh Red Bird\'s Eye Chili' },
  { keys: ['ot cap dong'], eng: 'Frozen Red Chili (IQF)' },
  { keys: ['khoai lang tim', 'khoai lang nhat'], eng: 'Fresh Japanese Purple Sweet Potato' },
  { keys: ['mang cut', 'mang cut tuoi'], eng: 'Fresh Mangosteen' },
  { keys: ['bo tuoi', 'bo booth'], eng: 'Fresh Avocado' },
  { keys: ['chanh khong hat', 'chanh khong hat tuoi'], eng: 'Fresh Seedless Lime' },
];

const PHRASE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/điều khoản mở rộng\s*:?\s*/gi, 'incl. '],
  [/rủi ro hấp hơi[,\s]+nóng ẩm/gi, 'Sweating & Heating Clause'],
  [/hấp hơi[,\s]+nóng ẩm/gi, 'Sweating & Heating'],
  [/chiến tranh\s*(?:&|và)\s*đình công/gi, 'War & Strikes Clauses'],
  [/trộm cắp\s*(?:&|và)\s*nước ngọt/gi, 'TPND & Fresh Water Damage Clauses'],
  [/bảo hiểm hàng đông lạnh/gi, 'Institute Frozen Food Clauses (A)'],
  [/bảo hiểm mọi rủi ro/gi, 'Institute Cargo Clauses (A) - All Risks'],
  [/bảo hiểm điều kiện\s*a/gi, 'Institute Cargo Clauses (A)'],
  [/bảo hiểm điều kiện\s*b/gi, 'Institute Cargo Clauses (B)'],
  [/bảo hiểm điều kiện\s*c/gi, 'Institute Cargo Clauses (C)'],
  [/không mua bảo hiểm/gi, 'Insurance Excluded'],
  [/người mua tự chịu/gi, 'Covered by Buyer'],
  [/kiểm dịch thực vật/gi, 'Phytosanitary Inspection'],
  [/khai báo hải quan/gi, 'Customs Declaration'],
  [/thủ tục hải quan/gi, 'Customs Clearance'],
  [/chứng nhận xuất xứ/gi, 'Certificate of Origin (C/O)'],
  [/hun trùng/gi, 'Fumigation'],
  [/chiếu xạ/gi, 'Irradiation Treatment'],
  [/vận tải nội địa/gi, 'Domestic Inland Trucking'],
  [/kéo container|kéo cont/gi, 'Container Haulage'],
  [/cắm điện container lạnh|cắm điện cont lạnh/gi, 'Reefer Plug-in & Monitoring'],
  [/xếp dỡ tại cảng/gi, 'Terminal Handling Charge (THC)'],
  [/chứng từ vận đơn|vận đơn/gi, 'Bill of Lading (B/L)'],
  [/niêm phong|chì container/gi, 'Container Seal'],
  [/hũ pet/gi, 'PET Jars'],
  [/túi zipper kraft/gi, 'Kraft Zipper Pouches'],
  [/túi hút chân không/gi, 'Vacuum PE Bags'],
  [/túi pe cấp đông iqf/gi, 'IQF PE Bags'],
  [/bao pe khối iqf/gi, 'IQF Block PE Bags'],
  [/thùng carton 5 lớp lót túi pe/gi, '5-Ply Corrugated Carton with PE Liner'],
  [/thùng chống ẩm/gi, 'Moisture-Proof Export Carton'],
  [/thùng carton/gi, 'Export Carton'],
  [/pallet gỗ hun trùng/gi, 'Heat-Treated Export Pallet'],
  [/pallet nhựa/gi, 'Plastic Export Pallet'],
  [/quấn màng pe/gi, 'Stretch Film Wrapped'],
  [/xếp sàn container/gi, 'Floor-Loaded in Container'],
  [/không dùng pallet/gi, 'No Pallet'],
  [/container lạnh cao/gi, 'High-Cube Reefer Container'],
  [/container lạnh tiêu chuẩn|container lạnh/gi, 'Reefer Container'],
  [/container khô cao/gi, 'High-Cube Dry Container'],
  [/container khô tiêu chuẩn|container khô/gi, 'Dry Container'],
  [/thanh long ruột đỏ/gi, 'Red Flesh Dragon Fruit'],
  [/thanh long ruột trắng/gi, 'White Flesh Dragon Fruit'],
  [/thanh long/gi, 'Dragon Fruit'],
  [/sầu riêng tách múi/gi, 'Durian Pulp Segments'],
  [/sầu riêng nguyên trái/gi, 'Whole Durian'],
  [/sầu riêng/gi, 'Durian'],
  [/xoài cát chu/gi, 'Cat Chu Mango'],
  [/xoài cát hòa lộc/gi, 'Cat Hoa Loc Mango'],
  [/xoài keo/gi, 'Keo Mango'],
  [/xoài/gi, 'Mango'],
  [/hạt điều rang muối/gi, 'Roasted Salted Cashew Nuts'],
  [/nhân hạt điều|hạt điều/gi, 'Cashew Nut Kernels'],
  [/tiêu đen/gi, 'Black Pepper'],
  [/tiêu trắng|tiêu sọ/gi, 'White Pepper'],
  [/cà phê nhân/gi, 'Green Coffee Beans'],
  [/cà phê/gi, 'Coffee'],
  [/chanh leo|chanh dây/gi, 'Passion Fruit'],
  [/chôm chôm/gi, 'Rambutan'],
  [/vải thiều/gi, 'Lychee'],
  [/nhãn lồng|nhãn/gi, 'Longan'],
  [/bưởi da xanh/gi, 'Green Skin Pomelo'],
  [/dừa tươi|dừa xiêm/gi, 'Fresh Young Coconut'],
  [/măng cụt/gi, 'Mangosteen'],
  [/chanh không hạt/gi, 'Seedless Lime'],
  [/mít sấy dẻo/gi, 'Soft Dried Jackfruit'],
  [/mít sấy giòn|mít sấy/gi, 'Crispy Dried Jackfruit'],
  [/khoai lang tím/gi, 'Purple Sweet Potato'],
  [/khoai lang/gi, 'Sweet Potato'],
  [/gạo thơm/gi, 'Fragrant Rice'],
  [/gạo/gi, 'Rice'],
  [/hoa hồi/gi, 'Star Anise'],
  [/quế ống|quế thanh|quế/gi, 'Cassia Cinnamon'],
  [/gừng/gi, 'Ginger'],
  [/nghệ/gi, 'Turmeric'],
  [/ớt chỉ thiên|ớt/gi, 'Red Chili'],
  [/chuối/gi, 'Banana'],
  [/dứa|thơm|khóm/gi, 'Pineapple'],
  [/cấp đông|đông lạnh/gi, 'Frozen (IQF)'],
  [/sấy dẻo/gi, 'Soft Dried'],
  [/sấy khô|sấy giòn/gi, 'Dried'],
  [/tươi/gi, 'Fresh'],
  [/xuất khẩu/gi, 'Export'],
  [/nhập khẩu/gi, 'Import'],
  [/phụ phí/gi, 'Surcharge'],
  [/phí /gi, 'Fee '],
  [/cước biển/gi, 'Ocean Freight'],
  [/bảo hiểm/gi, 'Insurance'],
  [/nông sản khô/gi, 'Dried Agricultural Products'],
  [/nông sản tươi/gi, 'Fresh Agricultural Produce'],
  [/trái cây tươi/gi, 'Fresh Tropical Fruits'],
  [/gia vị/gi, 'Spices'],
  [/hũ/gi, 'Jars'],
  [/túi/gi, 'Bags'],
  [/thùng/gi, 'Cartons'],
  [/bao/gi, 'Sacks'],
  [/lô hàng/gi, 'Shipment'],
  [/tiêu chuẩn/gi, 'Standard'],
  [/tối thiểu/gi, 'Minimum'],
  [/trung bình/gi, 'Medium'],
  [/và/gi, '&'],
];

function normalizeVieLookupKey(text: string): string {
  return String(text || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasVietnameseResidual(text: string): boolean {
  const s = String(text || '');
  if (/[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(s)) {
    return true;
  }
  return /\b(cua|cho|trong|tai|theo|voi|hoac|khong|hang|loai|phi|dieu|khoan|rui|ro|mo|rong|bao|hiem|nong|san)\b/i.test(s);
}

export function translateVIEtoENG(
  vieText: string,
  _context?: 'RATE' | 'PRODUCT' | 'INSURANCE' | 'PACKING' | 'CONTAINER' | 'GENERAL'
): string {
  const raw = String(vieText || '').trim();
  if (!raw) return '';

  const key = normalizeVieLookupKey(raw);
  const exact = EXACT_LOGISTICS_GLOSSARY.find((item) => item.keys.includes(key));
  if (exact) return exact.eng;

  // Also check exact match after stripping parenthetical notes
  const withoutParens = normalizeVieLookupKey(raw.replace(/\([^)]*\)/g, ' '));
  if (withoutParens) {
    const exactBase = EXACT_LOGISTICS_GLOSSARY.find((item) => item.keys.includes(withoutParens));
    if (exactBase) return exactBase.eng;
  }

  let out = raw;
  for (const [pattern, replacement] of PHRASE_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }

  out = out
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:)])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/^Fee\s+(.+)$/i, '$1 Fee')
    .replace(/Fee\s+Fee/gi, 'Fee')
    .trim();

  // Capitalize first letter unless starting with "incl."
  if (out && !/^incl\./i.test(out)) {
    out = out.charAt(0).toUpperCase() + out.slice(1);
  }
  return out;
}

export async function translateVIEtoENGSmart(
  vieText: string,
  context: 'RATE' | 'PRODUCT' | 'INSURANCE' | 'PACKING' | 'CONTAINER' | 'GENERAL' = 'GENERAL'
): Promise<string> {
  const raw = String(vieText || '').trim();
  if (!raw) return '';

  // 1. Instant exact glossary match
  const key = normalizeVieLookupKey(raw);
  const exact = EXACT_LOGISTICS_GLOSSARY.find((item) => item.keys.includes(key));
  if (exact) return exact.eng;

  // 2. Deterministic phrase translation; if zero Vietnamese residual remains, return immediately
  const localTranslated = translateVIEtoENG(raw, context);
  if (localTranslated && !hasVietnameseResidual(localTranslated)) {
    return localTranslated;
  }

  // 3. Server-side Gemini trade-logistics translation for novel/custom Vietnamese phrases
  try {
    const resp = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'translate_logistics',
        text: raw,
        context,
      }),
    });
    if (resp.ok) {
      const json = await resp.json();
      const translated = String(json?.translatedText || '').trim();
      if (translated && !hasVietnameseResidual(translated)) {
        return translated;
      }
    }
  } catch {
    // Fall through to deterministic cleanup below
  }

  return localTranslated;
}
