import JSZip from 'jszip';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import type {
  ConsigneeDirectory,
  IncotermsHandbook,
  InquiryQuotation,
  OrderItem,
  OrderLogisticsMeta,
  OrderMaster,
  PricingProposal,
  PricingRate,
  ProductCatalog,
  ProposalExtraMeta,
  ShippingSchedule,
  SystemLookup,
  SysUser,
  TemplateManager,
  TemplatePlaceholder,
} from '../types';
import {
  buildCombinedInsuranceClauseEng,
  buildContainerMixState,
  cleanQuoteNoForCustomer,
  computeOrderPalletSummary,
  computeScheduleOceanAndMissing,
  computeSellingPriceScaled,
  computeSilentFobUnitPrices,
  fmtNumber,
  fmtUSD,
  formatCurrency,
  INCOTERMS_2020_MATRIX,
  normalizePlainText,
  parseInsuranceCodeString,
  parseOrderItems,
  resolvePackingSpec,
  solveOptimalContainerMix,
  suggestCoFormCode,
  todayIsoDate,
  toNum,
} from './calculations';

export type DocumentKind = 'QUOTATION' | 'CONTRACT' | 'INVOICE' | 'PACKING_LIST' | 'CO' | 'BL';

export type CanonicalTemplateDepartment =
  | 'Kinh doanh (Sale)'
  | 'Xuất nhập khẩu (XNK)'
  | 'Dùng chung (Sale & XNK)';

export const TEMPLATE_DEPARTMENT_OPTIONS: CanonicalTemplateDepartment[] = [
  'Kinh doanh (Sale)',
  'Xuất nhập khẩu (XNK)',
  'Dùng chung (Sale & XNK)',
];

export function stripPlaceholderBraces(raw: string | null | undefined): string {
  return String(raw || '')
    .trim()
    .replace(/^\{+/, '')
    .replace(/\}+$/, '')
    .trim();
}

export function parsePlaceholderKeyList(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  String(raw || '')
    .split(/[,;\n]+/)
    .forEach((part) => {
      const key = stripPlaceholderBraces(part);
      if (!key) return;
      const upper = key.toUpperCase();
      if (seen.has(upper)) return;
      seen.add(upper);
      out.push(key);
    });
  return out;
}

export function normalizeTemplateDepartment(
  dept?: string | null,
  templateId?: string,
  documentName?: string
): CanonicalTemplateDepartment {
  const raw = String(dept || '').trim().toLowerCase();
  const hasSale = /\b(sale|sales|kinh doanh|kd|crm)\b/.test(raw);
  const hasXnk = /\b(xnk|xuất nhập khẩu|xuat nhap khau|logistics|export|import)\b/.test(raw);
  const hasAll = /\b(all|both|shared|dùng chung|dung chung|chung)\b/.test(raw);

  if (hasAll || (hasSale && hasXnk)) return 'Dùng chung (Sale & XNK)';
  if (hasSale) return 'Kinh doanh (Sale)';
  if (hasXnk) return 'Xuất nhập khẩu (XNK)';

  const metaText = `${templateId || ''} ${documentName || ''}`.toLowerCase();
  if (/tmp_quotation|quotation|quote|báo giá|bao gia|rfq/.test(metaText)) {
    return 'Kinh doanh (Sale)';
  }
  return 'Xuất nhập khẩu (XNK)';
}

export function formatTemplateDepartmentLabel(
  dept?: string | null,
  templateId?: string,
  documentName?: string
): CanonicalTemplateDepartment {
  return normalizeTemplateDepartment(dept, templateId, documentName);
}

const SELLER_CONSTANTS = {
  name: 'GREEN AGRI-EXPORTS CO., LTD',
  address: '128 Cong Hoa Street, Ward 4, Tan Binh District, Ho Chi Minh City, Vietnam',
  taxId: '0315892416',
  tel: '+84 28 3811 6688',
  email: 'export@greenagri-vn.com',
  rep: 'Nguyen Hoang Minh',
  repTitle: 'Export Director',
  bank: 'Joint Stock Commercial Bank for Foreign Trade of Vietnam (Vietcombank) - Ho Chi Minh City Branch · SWIFT: BFTVVNVX · USD Account: 0071370894125',
};

const ONES = [
  '', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
  'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN',
];
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];

function chunkBelow1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rem = n % 100;
  if (h > 0) parts.push(`${ONES[h]} HUNDRED`);
  if (rem > 0) {
    if (rem < 20) parts.push(ONES[rem]);
    else {
      const t = Math.floor(rem / 10);
      const o = rem % 10;
      parts.push(o > 0 ? `${TENS[t]}-${ONES[o]}` : TENS[t]);
    }
  }
  return parts.join(' ');
}

export function numberToEnglishWordsUsd(amount: number): string {
  const safe = Math.max(0, Math.round(toNum(amount) * 100) / 100);
  const whole = Math.floor(safe);
  const cents = Math.round((safe - whole) * 100);

  if (whole === 0 && cents === 0) return 'US DOLLARS ZERO ONLY';

  const scales = ['', 'THOUSAND', 'MILLION', 'BILLION'];
  let n = whole;
  let scaleIdx = 0;
  const words: string[] = [];

  while (n > 0 && scaleIdx < scales.length) {
    const chunk = n % 1000;
    if (chunk > 0) {
      const cWords = chunkBelow1000(chunk);
      words.unshift(scales[scaleIdx] ? `${cWords} ${scales[scaleIdx]}` : cWords);
    }
    n = Math.floor(n / 1000);
    scaleIdx++;
  }

  const dollarPart = words.length > 0 ? `US DOLLARS ${words.join(' ')}` : 'US DOLLARS ZERO';
  if (cents > 0) {
    return `${dollarPart} AND CENTS ${chunkBelow1000(cents)} ONLY`;
  }
  return `${dollarPart} ONLY`;
}

function sanitizeNoTba(val: string | null | undefined, fallback = ''): string {
  const s = String(val ?? '').trim();
  if (!s || /^tba$/i.test(s) || /^tbd$/i.test(s) || /^n\/a$/i.test(s)) return fallback;
  return s;
}

type ProductBucket = 'NUTS' | 'SPICES' | 'FRESH_FROZEN' | 'OTHER';

function classifyProductBucket(prod?: ProductCatalog, fallbackName?: string): ProductBucket {
  const grp = `${prod?.product_group || ''} ${prod?.product_name_vie || ''} ${prod?.product_name_eng || ''} ${fallbackName || ''} ${prod?.storage_temperature || ''}`.toLowerCase();
  if (/hạt|nut|edible|điều|cashew|macca|macadamia|hạnh nhân|óc chó/.test(grp)) return 'NUTS';
  if (/gia vị|spice|dried|tiêu|pepper|quế|cinnamon|hồi|star anise|gừng|ginger|nghệ|turmeric|ớt|chili/.test(grp)) return 'SPICES';
  if (/trái|tươi|đông|lạnh|fresh|frozen|fruit|reefer|rf|iqf|thanh long|dragon|xoài|mango|sầu riêng|durian|chôm chôm/.test(grp)) return 'FRESH_FROZEN';
  return 'OTHER';
}

export function selectMatchingTemplates(
  templates: TemplateManager[],
  kind: DocumentKind,
  items: OrderItem[],
  products: ProductCatalog[]
): TemplateManager[] {
  const activeDocxTemplates = templates.filter((t) => {
    const status = String(t.status || '').trim().toLowerCase();
    if (status !== 'active') return false;
    const path = String(t.google_doc_file_id || '').trim().toLowerCase();
    return Boolean(path) && (path.endsWith('.docx') || path.includes('templates/'));
  });

  const keywordsByKind: Record<DocumentKind, string[]> = {
    CONTRACT: ['contract', 'sc', 'hợp đồng', 'hop_dong', 'sales_contract', 'tmp_contract'],
    QUOTATION: ['quotation', 'quote', 'qt', 'báo giá', 'bao_gia', 'rfq', 'tmp_quotation'],
    INVOICE: ['invoice', 'ci', 'inv', 'hóa đơn', 'tmp_invoice'],
    PACKING_LIST: ['packing', 'pl', 'phiếu đóng gói', 'tmp_packing'],
    CO: ['co', 'c/o', 'origin', 'xuất xứ', 'tmp_co'],
    BL: ['bl', 'b/l', 'bill', 'vận đơn', 'tmp_bl'],
  };

  const kindFiltered = activeDocxTemplates.filter((t) => {
    const text = `${t.template_id} ${t.document_name} ${t.google_doc_file_id}`.toLowerCase();
    const kws = keywordsByKind[kind] || [];
    if (kind === 'CO') {
      return /\b(co|c\/o|origin)\b|tmp_co|xuất xứ/.test(text) && !text.includes('contract');
    }
    if (kind === 'BL') {
      return /\b(bl|b\/l|bill)\b|tmp_bl|vận đơn/.test(text);
    }
    return kws.some((k) => text.includes(k));
  });

  const candidates = kindFiltered;
  if (candidates.length === 0) return [];

  const buckets = new Set<ProductBucket>();
  items.forEach((it) => {
    const prod = products.find((p) => p.sku_code.trim().toLowerCase() === it.sku.trim().toLowerCase());
    const b = classifyProductBucket(prod, it.name);
    if (b !== 'OTHER') buckets.add(b);
  });

  const isMixed =
    buckets.size >= 2 ||
    (items.length >= 2 && buckets.size === 0 && new Set(items.map((i) => i.sku.toLowerCase())).size >= 2);
  const soleBucket = buckets.size === 1 ? Array.from(buckets)[0] : null;

  const scoreTemplate = (tpl: TemplateManager): number => {
    const text = `${tpl.template_id} ${tpl.document_name} ${tpl.google_doc_file_id}`.toLowerCase();
    let score = 10;

    if (kind === 'CONTRACT') {
      if (isMixed) {
        if (text.includes('mixed') || text.includes('cargo')) score += 50;
      } else if (soleBucket === 'NUTS') {
        if (text.includes('nut') || text.includes('edible')) score += 50;
      } else if (soleBucket === 'SPICES') {
        if (text.includes('spice') || text.includes('dried')) score += 50;
      } else if (soleBucket === 'FRESH_FROZEN') {
        if (text.includes('fresh') || text.includes('frozen') || text.includes('fruit')) score += 50;
      }
      if (!isMixed && text.includes('mixed')) score -= 5;
    }

    return score;
  };

  return candidates
    .map((t) => ({ t, score: scoreTemplate(t) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.t);
}

export async function extractPlaceholdersFromDocx(arrayBuffer: ArrayBuffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const xmlFiles = Object.keys(zip.files).filter(
    (name) => /^word\/(document|header\d+|footer\d+)\.xml$/i.test(name)
  );
  const keys = new Set<string>();

  for (const name of xmlFiles) {
    const xmlStr = await zip.files[name].async('string');
    const plain = xmlStr.replace(/<[^>]+>/g, '');
    const regex = /\{\{\s*([#/]?[A-Za-z0-9_.-]+)\s*\}\}/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(plain)) !== null) {
      const raw = match[1].trim();
      if (!raw || raw.startsWith('#') || raw.startsWith('/')) continue;
      keys.add(raw);
    }
  }

  return Array.from(keys);
}

export interface TemplateFieldDescriptor {
  key: string;
  description: string;
  value: string;
}

export interface PlaceholderContextInput {
  kind: DocumentKind;
  order?: OrderMaster;
  meta?: OrderLogisticsMeta;
  inq?: InquiryQuotation;
  prop?: PricingProposal;
  extraMeta?: ProposalExtraMeta;
  cus?: ConsigneeDirectory;
  sch?: ShippingSchedule;
  products: ProductCatalog[];
  pricingRates: PricingRate[];
  lookups: SystemLookup[];
  incoterms?: IncotermsHandbook[];
  users?: SysUser[];
  currentUser?: SysUser;
  templatePlaceholders: TemplatePlaceholder[];
  overrideIncoterm?: string;
  overrideSellingPrice?: number;
}

export const VIETNAMESE_PLACEHOLDER_LABELS: Record<string, string> = {
  ORD_ID: 'Mã đơn hàng',
  ORDER_ID: 'Mã đơn hàng',
  CTR_NO: 'Số Hợp đồng',
  CONTRACT_NO: 'Số Hợp đồng',
  CTR_DT: 'Ngày ký Hợp đồng',
  CTR_DATE: 'Ngày ký Hợp đồng',
  CONTRACT_DATE: 'Ngày ký Hợp đồng',
  DOC_DATE: 'Ngày lập chứng từ',
  ISSUE_DATE: 'Ngày phát hành chứng từ',
  QUOT_NO: 'Số Báo giá',
  QT_NO: 'Số Báo giá',
  QUOTE_NO: 'Số Báo giá',
  QUOTATION_NO: 'Số Báo giá',
  QUOT_DT: 'Ngày Báo giá',
  QT_DT: 'Ngày Báo giá',
  QT_DATE: 'Ngày Báo giá',
  QUOTE_DATE: 'Ngày Báo giá',
  QUOTATION_DATE: 'Ngày Báo giá',
  VALIDITY: 'Hiệu lực Báo giá',
  QUOT_VALIDITY: 'Hiệu lực Báo giá',
  VALID_UNTIL: 'Hiệu lực đến ngày',
  INV_NO: 'Số Hóa đơn Thương mại',
  INVOICE_NO: 'Số Hóa đơn Thương mại',
  INV_DT: 'Ngày Hóa đơn Thương mại',
  INVOICE_DATE: 'Ngày Hóa đơn Thương mại',
  PL_NO: 'Số Phiếu Đóng gói',
  PACKING_LIST_NO: 'Số Phiếu Đóng gói',
  PL_DT: 'Ngày Phiếu Đóng gói',
  BL_NO: 'Số Vận đơn (B/L No.)',
  CO_NO: 'Số Giấy chứng nhận Xuất xứ (C/O)',
  SALE_NAME: 'Nhân viên Kinh doanh phụ trách',
  SALES_REP: 'Nhân viên Kinh doanh phụ trách',
  STAFF_NAME: 'Nhân sự phụ trách',
  SELLER_REP: 'Đại diện Bên bán',
  SELLER_TITLE: 'Chức danh Đại diện Bên bán',
  XNK_REP: 'Chuyên viên XNK phụ trách',
  SALE_EMAIL: 'Email Nhân viên phụ trách',
  SALE_TEL: 'Điện thoại Nhân viên phụ trách',
  CNE_ID: 'Mã Khách hàng',
  CNE_NAME: 'Tên Công ty Nhập khẩu',
  CONSIGNEE_NAME: 'Tên Công ty Nhập khẩu',
  BUYER_COMPANY: 'Tên Công ty Người mua',
  CNE_ADDR: 'Địa chỉ Khách hàng',
  CONSIGNEE_ADDR: 'Địa chỉ Khách hàng',
  BUYER_ADDR: 'Địa chỉ Người mua',
  CNE_COUNTRY: 'Quốc gia Nhập khẩu',
  DESTINATION_COUNTRY: 'Quốc gia Nhập khẩu',
  CNE_TAX: 'Mã số thuế Khách hàng',
  BUYER_TAX: 'Mã số thuế Người mua',
  CNE_TEL: 'Số điện thoại Khách hàng',
  CNE_PHONE: 'Số điện thoại Khách hàng',
  BUYER_TEL: 'Số điện thoại Người mua',
  BUYER_PHONE: 'Số điện thoại Người mua',
  CNE_EMAIL: 'Email Khách hàng',
  BUYER_EMAIL: 'Email Người mua',
  CNE_FAX: 'Số Fax Khách hàng',
  BUYER_NAME: 'Người liên hệ Bên mua',
  BUYER_REP: 'Đại diện ký Bên mua',
  CNE_CONTACT: 'Người liên hệ Khách hàng',
  BUYER_TITLE: 'Chức danh Đại diện Bên mua',
  NOTIFY_PARTY: 'Bên nhận thông báo (Notify Party)',
  SELLER_NAME: 'Tên Công ty Xuất khẩu',
  SHIPPER_NAME: 'Tên Công ty Xuất khẩu',
  SELLER_ADDR: 'Địa chỉ Công ty Xuất khẩu',
  SHIPPER_ADDR: 'Địa chỉ Công ty Xuất khẩu',
  SELLER_TAX: 'Mã số thuế Công ty Xuất khẩu',
  SELLER_TEL: 'Điện thoại Công ty Xuất khẩu',
  SELLER_EMAIL: 'Email Công ty Xuất khẩu',
  SELLER_BANK: 'Thông tin Ngân hàng Thụ hưởng',
  BANK_INFO: 'Thông tin Ngân hàng Thụ hưởng',
  POL: 'Cảng bốc hàng (POL)',
  PORT_OF_LOADING: 'Cảng bốc hàng (POL)',
  POD: 'Cảng dỡ hàng (POD)',
  PORT_OF_DISCHARGE: 'Cảng dỡ hàng (POD)',
  POT: 'Cảng chuyển tải (POT)',
  PORT_OF_TRANSSHIPMENT: 'Cảng chuyển tải (POT)',
  ORIGIN: 'Xuất xứ Hàng hóa',
  COUNTRY_OF_ORIGIN: 'Quốc gia Xuất xứ',
  INCOTERM: 'Điều kiện Giao hàng (Incoterms)',
  APPLIED_INCOTERM: 'Điều kiện Giao hàng (Incoterms)',
  INCOTERM_PLACE: 'Địa điểm Giao hàng (Incoterms)',
  INCOTERM_FULL: 'Tên đầy đủ Incoterms 2020',
  INCOTERM_TEXT: 'Điều khoản Incoterms hợp đồng',
  PROPOSED_INCOTERMS: 'Các điều kiện Incoterms tư vấn',
  PAY_TERM: 'Điều khoản Thanh toán',
  PAYMENT_TERM: 'Điều khoản Thanh toán',
  PAYMENT_TERMS: 'Điều khoản Thanh toán',
  CO_FORM: 'Mẫu Giấy chứng nhận Xuất xứ (C/O)',
  INS_TERM: 'Điều khoản Bảo hiểm Hàng hóa',
  INSURANCE_TERM: 'Điều khoản Bảo hiểm Hàng hóa',
  INS_CLAUSE: 'Điều khoản Bảo hiểm Hàng hóa',
  INS_COST: 'Phí Bảo hiểm (USD)',
  INS_AMT: 'Phí Bảo hiểm (USD)',
  INSURANCE_AMT: 'Phí Bảo hiểm (USD)',
  FREIGHT: 'Điều khoản Cước tàu',
  FREIGHT_TERM: 'Điều khoản Cước tàu',
  FREIGHT_AMT: 'Cước Vận chuyển Quốc tế (USD)',
  OCEAN_FREIGHT: 'Cước Vận tải Biển (USD)',
  DEST_AMT: 'Chi phí Tại cảng/nơi đến (USD)',
  DEST_CHARGES: 'Chi phí Tại cảng/nơi đến (USD)',
  SUBTOTAL_AMT: 'Tạm tính Giá trị Hàng (FOB)',
  SUBTOTAL: 'Tạm tính Giá trị Hàng (FOB)',
  CURRENCY: 'Đơn vị Tiền tệ',
  CTR_VAL: 'Tổng Giá trị Hợp đồng',
  CONTRACT_VALUE: 'Tổng Giá trị Hợp đồng',
  TOT_AMT: 'Tổng Thanh toán (USD)',
  TOTAL_AMT: 'Tổng Thanh toán (USD)',
  TOTAL_AMOUNT: 'Tổng Thanh toán (USD)',
  TOT_AMT_WORDS: 'Tổng tiền bằng chữ (Tiếng Anh)',
  TOTAL_AMT_WORDS: 'Tổng tiền bằng chữ (Tiếng Anh)',
  AMOUNT_IN_WORDS: 'Tổng tiền bằng chữ (Tiếng Anh)',
  EXW_PRICE: 'Giá chào điều kiện EXW',
  FCA_PRICE: 'Giá chào điều kiện FCA',
  FOB_PRICE: 'Giá chào điều kiện FOB',
  CFR_PRICE: 'Giá chào điều kiện CFR',
  CIF_PRICE: 'Giá chào điều kiện CIF',
  CPT_PRICE: 'Giá chào điều kiện CPT',
  CIP_PRICE: 'Giá chào điều kiện CIP',
  DAP_PRICE: 'Giá chào điều kiện DAP',
  DPU_PRICE: 'Giá chào điều kiện DPU',
  DDP_PRICE: 'Giá chào điều kiện DDP',
  OPT1_INCOTERM: 'Phương án 1 - Điều kiện Incoterms',
  OPT1_PRICE: 'Phương án 1 - Giá chào (USD)',
  OPT1_DESC: 'Phương án 1 - Mô tả điều kiện',
  OPT2_INCOTERM: 'Phương án 2 - Điều kiện Incoterms',
  OPT2_PRICE: 'Phương án 2 - Giá chào (USD)',
  OPT2_DESC: 'Phương án 2 - Mô tả điều kiện',
  OPT3_INCOTERM: 'Phương án 3 - Điều kiện Incoterms',
  OPT3_PRICE: 'Phương án 3 - Giá chào (USD)',
  OPT3_DESC: 'Phương án 3 - Mô tả điều kiện',
  OPT4_INCOTERM: 'Phương án 4 - Điều kiện Incoterms',
  OPT4_PRICE: 'Phương án 4 - Giá chào (USD)',
  OPT4_DESC: 'Phương án 4 - Mô tả điều kiện',
  SKU: 'Mã SKU Sản phẩm',
  PROD_NAME_ENG: 'Tên Sản phẩm (Tiếng Anh)',
  PROD_NAME_VIE: 'Tên Sản phẩm (Tiếng Việt)',
  PRODUCT_DESC: 'Mô tả Hàng hóa',
  GOODS_DESC: 'Mô tả Hàng hóa',
  HS_CODE: 'Mã HS Code',
  STORAGE_TEMP: 'Nhiệt độ Bảo quản',
  UNIT_PRICE: 'Đơn giá Bình quân (USD/KG)',
  NW_KGS: 'Tổng Khối lượng Tịnh (KG)',
  NET_WEIGHT: 'Tổng Khối lượng Tịnh',
  TOTAL_NW: 'Tổng Khối lượng Tịnh (KG)',
  GW_KGS: 'Tổng Khối lượng Cả bì (KG)',
  GROSS_WEIGHT: 'Tổng Khối lượng Cả bì',
  TOTAL_GW: 'Tổng Khối lượng Cả bì (KG)',
  CARTONS: 'Tổng số Thùng Carton',
  TOTAL_CARTONS: 'Tổng số Thùng Carton',
  PALLETS: 'Tổng số Pallet',
  TOTAL_PALLETS: 'Tổng số Pallet',
  CBM: 'Tổng Thể tích (CBM)',
  TOTAL_CBM: 'Tổng Thể tích (CBM)',
  PACKING_DESC: 'Quy cách Đóng gói',
  SHIPPING_MARKS: 'Ký mã hiệu Vận chuyển (Shipping Marks)',
  MARKS: 'Ký mã hiệu Vận chuyển',
  CONT_TYPE: 'Loại & Số lượng Container',
  CONTAINER_TYPE: 'Loại & Số lượng Container',
  CONT_QTY: 'Số lượng Container',
  BK_NO: 'Số Booking (B/K No.)',
  BOOKING_NO: 'Số Booking (B/K No.)',
  VES_VOY: 'Tên Tàu / Số Chuyến',
  VESSEL: 'Tên Tàu',
  VOYAGE: 'Số Chuyến Tàu',
  CONT_SEAL: 'Số Container / Số Seal',
  BL_TYPE: 'Loại Vận đơn (B/L)',
  ETD: 'Ngày Tàu chạy Dự kiến (ETD)',
  ETA: 'Ngày Tàu đến Dự kiến (ETA)',
  TRANSIT_TIME: 'Thời gian Vận chuyển Dự kiến',
  SI_CUTOFF: 'Hạn nộp SI (SI Cut-off)',
  VGM_CUTOFF: 'Hạn nộp VGM (VGM Cut-off)',
  CY_CUTOFF: 'Hạn hạ bãi Container (CY Cut-off)',
  CUT_OFF: 'Thời hạn Cắt máng (Cut-off)',
  DELIVERY_DATE: 'Thời hạn Giao hàng Dự kiến',
  SHIPMENT_TIME: 'Thời gian Giao hàng',
  SHIPPING_LINE: 'Hãng tàu / Đơn vị Vận tải',
  CARRIER: 'Hãng tàu / Đơn vị Vận tải',
  FORWARDER: 'Đơn vị Giao nhận (Forwarder)',
  ITEMS_LIST: 'Danh sách Chi tiết Sản phẩm',
  ITEM_STT: 'Số thứ tự dòng hàng',
  ITEM_NAME: 'Tên hàng hóa (Tiếng Anh)',
  ITEM_DESC: 'Mô tả dòng hàng',
  ITEM_SKU: 'Mã sản phẩm',
  ITEM_UNIT: 'Đơn vị tính',
  ITEM_PRICE: 'Đơn giá sản phẩm (USD)',
  ITEM_QTY: 'Số lượng / Khối lượng',
  ITEM_AMT: 'Thành tiền dòng hàng (USD)',
  ITEM_PACK: 'Quy cách đóng gói dòng hàng',
  ITEM_HS: 'Mã HS dòng hàng',
  ITEM_CARTONS: 'Số thùng dòng hàng',
  ITEM_NW: 'Khối lượng tịnh dòng hàng (KG)',
  ITEM_GW: 'Khối lượng cả bì dòng hàng (KG)',
  NO: 'Số thứ tự',
  STT: 'Số thứ tự',
  PACKING: 'Quy cách Đóng gói',
  QTY_KGS: 'Khối lượng (KG)',
  QTY: 'Số lượng / Khối lượng',
  AMOUNT: 'Thành tiền (USD)',
  RISK_TRANSFER: 'Điểm Chuyển giao Rủi ro',
  REMARKS: 'Ghi chú bổ sung',
  NOTES: 'Ghi chú bổ sung',
};

function sanitizeVietnameseDescription(rawDesc: string, keyUpper: string): string {
  const cleaned = rawDesc
    .replace(/\{\{\s*[A-Za-z0-9_.-]+\s*\}\}/g, '')
    .replace(/\(\s*[A-Z0-9_]{3,}\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-:–—]+|[\s\-:–—]+$/g, '')
    .trim();

  if (!cleaned) return '';
  if (cleaned.toUpperCase() === keyUpper || cleaned.toUpperCase() === keyUpper.replace(/_/g, ' ')) {
    return '';
  }
  if (/^[A-Z0-9_.\s]+$/.test(cleaned)) {
    return '';
  }
  return cleaned;
}

export function resolveCleanVietnameseLabel(key: string, tp?: TemplatePlaceholder): string {
  const cleanKey = stripPlaceholderBraces(key);
  const upper = cleanKey.toUpperCase();

  const dbDesc = sanitizeVietnameseDescription(String(tp?.description_vie || ''), upper);
  if (dbDesc) return dbDesc;

  if (VIETNAMESE_PLACEHOLDER_LABELS[upper]) {
    return VIETNAMESE_PLACEHOLDER_LABELS[upper];
  }

  // Indexed item pattern e.g. ITEM_1_NAME
  const itemIdxMatch = upper.match(/^ITEM_(\d+)_([A-Z_]+)$/);
  if (itemIdxMatch) {
    const idx = itemIdxMatch[1];
    const suffix = itemIdxMatch[2];
    const baseLabel = VIETNAMESE_PLACEHOLDER_LABELS[`ITEM_${suffix}`];
    if (baseLabel) return `${baseLabel} (Dòng ${idx})`;
  }

  return 'Thông tin chứng từ';
}

export function getVietnamesePlaceholderLabel(
  key: string,
  templatePlaceholders: TemplatePlaceholder[]
): string {
  const cleanKey = stripPlaceholderBraces(key);
  const upper = cleanKey.toUpperCase();
  const tp = templatePlaceholders.find(
    (p) => stripPlaceholderBraces(p.placeholder_key).toUpperCase() === upper
  );
  return resolveCleanVietnameseLabel(cleanKey, tp);
}

const LOOP_ITEM_KEYS = new Set([
  'NO', 'STT', 'SKU', 'PROD_NAME_ENG', 'PROD_NAME_VIE', 'PACKING', 'QTY_KGS', 'QTY', 'CARTONS', 'UNIT_PRICE', 'AMOUNT',
  'ITEM_STT', 'ITEM_NAME', 'ITEM_SKU', 'ITEM_UNIT', 'ITEM_PRICE', 'ITEM_QTY', 'ITEM_AMT', 'ITEM_PACK',
  'ITEM_DESC', 'ITEM_HS', 'ITEM_CARTONS', 'ITEM_NW', 'ITEM_GW',
]);

function computeTransitDaysLabel(etd?: string, eta?: string): string {
  if (!etd || !eta) return 'As per carrier schedule';
  const d1 = new Date(etd).getTime();
  const d2 = new Date(eta).getTime();
  if (Number.isNaN(d1) || Number.isNaN(d2) || d2 < d1) return 'As per carrier schedule';
  const days = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
  return days > 0 ? `${days} days` : 'Direct / Same-day';
}

export function buildTemplateFieldContext(
  input: PlaceholderContextInput,
  detectedKeys: string[]
): {
  fields: Record<string, string>;
  descriptors: TemplateFieldDescriptor[];
  itemsTableRows: Array<Record<string, string>>;
  comparisonRows: Array<Record<string, string>>;
} {
  const {
    kind,
    order,
    meta,
    inq,
    prop,
    extraMeta,
    cus,
    sch,
    products,
    pricingRates,
    lookups,
    incoterms = [],
    users = [],
    currentUser,
    templatePlaceholders,
    overrideIncoterm,
    overrideSellingPrice,
  } = input;

  const items = inq
    ? parseOrderItems(inq, products, pricingRates)
    : order
    ? parseOrderItems(
        {
          sku_code: order.sku_code,
          net_weight_kgs: order.nw_confirmed_kgs,
          product_name_vie: order.sku_code,
        },
        products,
        pricingRates
      )
    : [];

  const totalSelling =
    overrideSellingPrice && overrideSellingPrice > 0
      ? overrideSellingPrice
      : toNum(order?.contract_value) || toNum(prop?.final_selling_price) || 0;

  const incoterm = (
    overrideIncoterm ||
    order?.applied_incoterm ||
    prop?.recommended_incoterm ||
    inq?.desired_incoterm ||
    'CIF'
  ).trim().toUpperCase();

  const pol = sanitizeNoTba(order?.pol || sch?.pol, 'Cat Lai Port, Ho Chi Minh City, Vietnam');
  const pod = sanitizeNoTba(
    order?.pod || sch?.pod,
    cus?.country ? `Main Port, ${cus.country}` : 'Destination Port'
  );
  const pot = sanitizeNoTba(sch?.pot && sch.pot !== '-' ? sch.pot : '', 'Direct');
  const originIncotermCodes = ['EXW', 'FCA', 'FAS', 'FOB'];
  const incotermPlace = originIncotermCodes.includes(incoterm) ? pol : pod;

  const usePalletFlag = extraMeta?.use_pallet ?? toNum(prop?.total_pallets) > 0;
  const pool = computeOrderPalletSummary(items, usePalletFlag, pricingRates);

  let schOceanSurcharge = 0;
  if (prop || sch) {
    const optMix = solveOptimalContainerMix(items, usePalletFlag, products, pricingRates);
    const mixState = buildContainerMixState(
      {
        q20dc: optMix.qty20DC,
        q40dc: optMix.qty40DC,
        q40hc: optMix.qty40HC,
        q20rf: optMix.qty20RF,
        q40rf: optMix.qty40RF,
        q40rh: optMix.qty40RH,
      },
      items,
      usePalletFlag,
      extraMeta?.lcl_basis || 'WM',
      extraMeta?.lcl_rate || 65,
      products,
      pricingRates
    );
    const oceanRes = computeScheduleOceanAndMissing(sch, mixState);
    schOceanSurcharge = oceanRes.ocean + oceanRes.surcharge;
  }

  const requiresSellerFreight = ['CFR', 'CPT', 'CIF', 'CIP', 'DAP', 'DPU', 'DDP'].includes(incoterm);
  const requiresSellerIns = incoterm === 'CIF' || incoterm === 'CIP';
  const requiresSellerDest = ['DAP', 'DPU', 'DDP'].includes(incoterm);

  const freightCost = requiresSellerFreight
    ? Math.round(
        (schOceanSurcharge > 0
          ? schOceanSurcharge
          : extraMeta?.cfr_price && extraMeta?.fob_price
          ? Math.max(0, extraMeta.cfr_price - extraMeta.fob_price)
          : toNum(prop?.total_freight_local)) * 100
      ) / 100
    : 0;

  const insCost = requiresSellerIns
    ? Math.round(
        (toNum(prop?.insurance_cost) > 0
          ? toNum(prop?.insurance_cost)
          : extraMeta?.cif_price && extraMeta?.cfr_price
          ? Math.max(0, extraMeta.cif_price - extraMeta.cfr_price)
          : 0) * 100
      ) / 100
    : 0;

  const destCost = requiresSellerDest
    ? Math.round(
        (toNum(extraMeta?.dest_extra) + (incoterm === 'DDP' ? toNum(extraMeta?.import_duty_usd) : 0)) * 100
      ) / 100
    : 0;

  const rawExtras = freightCost + insCost + destCost;
  const subtotalAmt =
    rawExtras > 0 && rawExtras < totalSelling
      ? Math.round((totalSelling - rawExtras) * 100) / 100
      : totalSelling;

  const detectedUpper = new Set(detectedKeys.map((k) => stripPlaceholderBraces(k).toUpperCase()));
  const hasSeparateSubtotalInDoc =
    kind === 'QUOTATION' ||
    detectedUpper.has('SUBTOTAL_AMT') ||
    detectedUpper.has('SUBTOTAL') ||
    detectedUpper.has('FREIGHT_AMT') ||
    detectedUpper.has('OCEAN_FREIGHT');

  const itemAllocationTarget = hasSeparateSubtotalInDoc ? subtotalAmt : totalSelling;
  const allocated = computeSilentFobUnitPrices(items, itemAllocationTarget, products, pricingRates);

  const firstProd = items[0]
    ? products.find((p) => p.sku_code.trim().toLowerCase() === items[0].sku.trim().toLowerCase())
    : products.find(
        (p) =>
          p.sku_code.trim().toLowerCase() ===
          String(order?.sku_code || inq?.sku_code || '').trim().toLowerCase()
      );

  const insParsed = parseInsuranceCodeString(prop?.insurance_code || 'INS-NONE', pricingRates);
  const insTerm =
    incoterm === 'CIF' || incoterm === 'CIP'
      ? buildCombinedInsuranceClauseEng(
          insParsed.baseCode === 'INS-NONE' ? (incoterm === 'CIP' ? 'INS-ICC-A' : 'INS-ICC-C') : insParsed.baseCode,
          insParsed.addonCodes,
          incoterm,
          pricingRates
        )
      : 'To be covered by Buyer';

  const freightStr = originIncotermCodes.includes(incoterm)
    ? 'Freight Collect'
    : freightCost > 0
    ? `Freight Prepaid (${fmtUSD(freightCost)})`
    : 'Freight Prepaid';

  const payTerm = sanitizeNoTba(
    order?.payment_terms || inq?.proposed_payment_term || cus?.default_payment_term,
    'T/T 30/70'
  );
  const lookupPay = lookups.find(
    (l) =>
      l.code.trim().toLowerCase() === payTerm.toLowerCase() ||
      l.display_name_vie.trim().toLowerCase() === payTerm.toLowerCase()
  );
  const payTermEng = sanitizeNoTba(lookupPay?.contract_text_eng, payTerm);

  const hbInc = incoterms.find((h) => String(h.incoterms_code || '').trim().toUpperCase() === incoterm);

  const coForm = sanitizeNoTba(order?.co_form, suggestCoFormCode(pod, cus?.country));
  const orderId = sanitizeNoTba(order?.order_id || inq?.order_id || prop?.order_id, '');
  const quoteNo = cleanQuoteNoForCustomer(extraMeta?.quotation_no || '', orderId);
  const quoteDate = inq?.timestamp ? String(inq.timestamp).slice(0, 10) : todayIsoDate();
  const contractNo = sanitizeNoTba(
    order?.contract_no,
    orderId
      ? `SC-${new Date().getFullYear()}-${String(orderId).replace(/^ORD-/i, '')}/GAE`
      : `SC-${new Date().getFullYear()}/GAE`
  );
  const contractDate = sanitizeNoTba(order?.contract_date, todayIsoDate());

  // Resolve Sales Rep & XNK Rep cleanly from sys_users (matching employee_id, email, or full_name)
  const findSysUser = (rawRef?: string | null): SysUser | undefined => {
    const ref = String(rawRef || '').trim().toLowerCase();
    if (!ref) return undefined;
    return users.find(
      (u) =>
        u.employee_id.trim().toLowerCase() === ref ||
        u.full_name.trim().toLowerCase() === ref ||
        u.email.trim().toLowerCase() === ref
    );
  };

  const saleUser =
    findSysUser(inq?.sale_rep) ||
    findSysUser(order?.in_charge_staff) ||
    (currentUser && String(currentUser.department || '').toUpperCase().includes('SALE') ? currentUser : undefined) ||
    findSysUser(prop?.xnk_rep) ||
    currentUser;
  const xnkUser = findSysUser(prop?.xnk_rep) || findSysUser(order?.in_charge_staff) || currentUser;

  const saleDisplay = sanitizeNoTba(
    saleUser?.full_name || inq?.sale_rep || order?.in_charge_staff || currentUser?.full_name,
    SELLER_CONSTANTS.rep
  );
  const xnkDisplay = sanitizeNoTba(
    xnkUser?.full_name || prop?.xnk_rep || order?.in_charge_staff || saleDisplay,
    SELLER_CONSTANTS.rep
  );

  const totalNw = toNum(order?.nw_confirmed_kgs) || toNum(inq?.net_weight_kgs) || pool.cargoNetKg;
  const totalGw = toNum(prop?.total_gross_weight) || pool.totalGrossWeightKg || totalNw;
  const totalCartons = toNum(prop?.total_cartons) || pool.totalCartons;
  const totalPallets = toNum(prop?.total_pallets) || pool.totalPallets;
  const totalCbm = toNum(prop?.total_cbm) || pool.totalCbm;
  const totAmtWords = numberToEnglishWordsUsd(totalSelling);

  const vesselName = sanitizeNoTba(sch?.vessel, '');
  const voyageNo = sanitizeNoTba(sch?.voyage, '');
  const vesVoy = sanitizeNoTba(
    meta?.ves_voy || (vesselName ? `${vesselName}${voyageNo ? ' / ' + voyageNo : ''}` : ''),
    'As per carrier booking confirmation'
  );
  const bkNo = sanitizeNoTba(
    meta?.bk_no || meta?.carrier_bk_no || meta?.fwd_bk_no,
    'Upon shipment confirmation'
  );
  const contSeal = sanitizeNoTba(
    meta?.cont_seal_list || prop?.container_type,
    firstProd?.container_type || "20'DC"
  );
  const shippingLine = sanitizeNoTba(sch?.shipping_line || meta?.fwd_name, 'Main International Carrier');
  const etdVal = sanitizeNoTba(sch?.etd || inq?.desired_delivery_date, 'Within 15 days after deposit');
  const etaVal = sanitizeNoTba(sch?.eta, 'As per carrier schedule');
  const transitTime = computeTransitDaysLabel(sch?.etd, sch?.eta);

  const prodNamesEng = allocated.map((a) => `${a.item.name_eng || a.item.name} (${fmtNumber(a.item.weight)} KG)`).join('; ');
  const prodNamesVie = items.map((it) => `${it.name} (${fmtNumber(it.weight)} KG)`).join('; ');
  const avgUnitPrice = totalNw > 0 ? itemAllocationTarget / totalNw : toNum(firstProd?.unit_price);

  const itemsTableRows = allocated.map((row, idx) => {
    const prod = products.find((p) => p.sku_code.trim().toLowerCase() === row.item.sku.trim().toLowerCase());
    const packSpec = resolvePackingSpec(row.item.packingCode, pricingRates);
    const packEng = sanitizeNoTba(packSpec.engText || row.item.packingName || row.item.packingCode, 'Export Standard Cartons');
    const hsCode = sanitizeNoTba(normalizePlainText(prod?.hs_code), '0810.90');
    return {
      NO: String(idx + 1),
      STT: String(idx + 1),
      ITEM_STT: String(idx + 1),
      SKU: row.item.sku,
      ITEM_SKU: row.item.sku,
      PROD_NAME_ENG: row.item.name_eng || row.item.name,
      PROD_NAME_VIE: row.item.name,
      ITEM_NAME: row.item.name_eng || row.item.name,
      ITEM_DESC: row.item.name_eng || row.item.name,
      HS_CODE: hsCode,
      ITEM_HS: hsCode,
      PACKING: packEng,
      ITEM_PACK: packEng,
      UNIT: 'KGS',
      ITEM_UNIT: 'KGS',
      QTY: fmtNumber(row.item.weight),
      QTY_KGS: fmtNumber(row.item.weight),
      ITEM_QTY: fmtNumber(row.item.weight),
      NW_KGS: fmtNumber(row.item.weight),
      ITEM_NW: fmtNumber(row.item.weight),
      GW_KGS: fmtNumber(row.item.grossWeightKg || row.item.weight),
      ITEM_GW: fmtNumber(row.item.grossWeightKg || row.item.weight),
      CARTONS: fmtNumber(row.item.cartons),
      ITEM_CARTONS: fmtNumber(row.item.cartons),
      UNIT_PRICE: fmtUSD(row.unitPricePerKg),
      ITEM_PRICE: fmtUSD(row.unitPricePerKg),
      AMOUNT: fmtUSD(row.lineTotalUsd),
      ITEM_AMT: fmtUSD(row.lineTotalUsd),
      ORIGIN: 'Vietnam',
      STORAGE_TEMP: sanitizeNoTba(prod?.storage_temperature, 'Ambient / Dry'),
    };
  });

  // Incoterm Comparison / Advisory options
  const proposedIncList = String(prop?.proposed_incoterms || incoterm)
    .split(/[,;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const compCodes = proposedIncList.length > 0 ? proposedIncList : [incoterm];
  const comparisonRows = compCodes.map((code, idx) => {
    const scaled = prop ? computeSellingPriceScaled(prop, extraMeta, code) : totalSelling;
    const priceVal = scaled > 0 ? scaled : totalSelling;
    const hb = incoterms.find((h) => String(h.incoterms_code || '').trim().toUpperCase() === code);
    const mat = INCOTERMS_2020_MATRIX.find((m) => m.code === code);
    const place = originIncotermCodes.includes(code) ? pol : pod;
    return {
      NO: String(idx + 1),
      OPT_STT: String(idx + 1),
      INCOTERM: code,
      OPT_INCOTERM: code,
      INCOTERM_FULL: hb?.full_name || mat?.fullName || `${code} (Incoterms 2020)`,
      INCOTERM_PLACE: place,
      PRICE: fmtUSD(priceVal),
      OPT_PRICE: fmtUSD(priceVal),
      UNIT_PRICE: totalNw > 0 ? `$${(priceVal / totalNw).toFixed(3)}/KG` : fmtUSD(priceVal),
      RISK_TRANSFER: hb?.risk_transfer_point || place,
      DESC: hb?.contract_text_eng || `${code} ${place} (Incoterms 2020)`,
    };
  });

  const calcIncotermUsd = (code: string): string => {
    if (!prop) return fmtUSD(totalSelling);
    const val = computeSellingPriceScaled(prop, extraMeta, code);
    return fmtUSD(val > 0 ? val : totalSelling);
  };

  const buyerCompany = sanitizeNoTba(cus?.consignee_name || order?.consignee_id || inq?.consignee_id, '');
  const buyerContact = sanitizeNoTba(cus?.contact_person || inq?.contact, buyerCompany);
  const buyerAddr = sanitizeNoTba(cus?.address || inq?.address, '');
  const buyerTel = sanitizeNoTba(normalizePlainText(cus?.phone || inq?.phone), '-');
  const buyerEmail = sanitizeNoTba(cus?.email || inq?.email, '');
  const buyerTax = sanitizeNoTba(normalizePlainText(cus?.tax), '-');
  const buyerFax = sanitizeNoTba(normalizePlainText(cus?.fax), '-');
  const buyerCountry = sanitizeNoTba(cus?.country || sch?.country, '');

  const shippingMarks = `${buyerCompany || 'CONSIGNEE'} / ${pod} / MADE IN VIETNAM / ${contractNo}`;

  const baseValues: Record<string, string> = {
    ORD_ID: orderId,
    ORDER_ID: orderId,
    CTR_NO: contractNo,
    CONTRACT_NO: contractNo,
    CTR_DT: contractDate,
    CTR_DATE: contractDate,
    CONTRACT_DATE: contractDate,
    DOC_DATE: todayIsoDate(),
    ISSUE_DATE: todayIsoDate(),
    QUOT_NO: quoteNo,
    QT_NO: quoteNo,
    QUOTE_NO: quoteNo,
    QUOTATION_NO: quoteNo,
    QUOT_DT: quoteDate,
    QT_DT: quoteDate,
    QT_DATE: quoteDate,
    QUOTE_DATE: quoteDate,
    QUOTATION_DATE: quoteDate,
    VALIDITY: '07 calendar days from issue date',
    QUOT_VALIDITY: '07 calendar days from issue date',
    VALID_UNTIL: '07 calendar days from issue date',
    INV_NO: `CI-${(order?.contract_no || orderId || '001').replace(/[^A-Za-z0-9-]/g, '')}`,
    INVOICE_NO: `CI-${(order?.contract_no || orderId || '001').replace(/[^A-Za-z0-9-]/g, '')}`,
    INV_DT: todayIsoDate(),
    INVOICE_DATE: todayIsoDate(),
    PL_NO: `PL-${(order?.contract_no || orderId || '001').replace(/[^A-Za-z0-9-]/g, '')}`,
    PACKING_LIST_NO: `PL-${(order?.contract_no || orderId || '001').replace(/[^A-Za-z0-9-]/g, '')}`,
    PL_DT: todayIsoDate(),
    BL_NO: bkNo,
    CO_NO: `CO-${(order?.contract_no || orderId || '001').replace(/[^A-Za-z0-9-]/g, '')}`,
    CURRENCY: 'USD',
    CTR_VAL: formatCurrency(totalSelling),
    CONTRACT_VALUE: formatCurrency(totalSelling),
    SUBTOTAL_AMT: fmtUSD(subtotalAmt),
    SUBTOTAL: fmtUSD(subtotalAmt),
    FREIGHT_AMT: fmtUSD(freightCost),
    OCEAN_FREIGHT: fmtUSD(freightCost),
    INS_AMT: fmtUSD(insCost),
    INSURANCE_AMT: fmtUSD(insCost),
    INS_COST: fmtUSD(insCost),
    DEST_AMT: fmtUSD(destCost),
    DEST_CHARGES: fmtUSD(destCost),
    TOT_AMT: fmtUSD(totalSelling),
    TOTAL_AMT: fmtUSD(totalSelling),
    TOTAL_AMOUNT: fmtUSD(totalSelling),
    TOT_AMT_WORDS: totAmtWords,
    TOTAL_AMT_WORDS: totAmtWords,
    AMOUNT_IN_WORDS: totAmtWords,
    EXW_PRICE: calcIncotermUsd('EXW'),
    FCA_PRICE: calcIncotermUsd('FCA'),
    FOB_PRICE: calcIncotermUsd('FOB'),
    CFR_PRICE: calcIncotermUsd('CFR'),
    CIF_PRICE: calcIncotermUsd('CIF'),
    CPT_PRICE: calcIncotermUsd('CPT'),
    CIP_PRICE: calcIncotermUsd('CIP'),
    DAP_PRICE: calcIncotermUsd('DAP'),
    DPU_PRICE: calcIncotermUsd('DPU'),
    DDP_PRICE: calcIncotermUsd('DDP'),
    INCOTERM: incoterm,
    APPLIED_INCOTERM: incoterm,
    INCOTERM_PLACE: incotermPlace,
    INCOTERM_FULL: hbInc?.full_name || `${incoterm} (Incoterms 2020)`,
    INCOTERM_TEXT: hbInc?.contract_text_eng || `${incoterm} ${incotermPlace} (Incoterms 2020)`,
    PROPOSED_INCOTERMS: compCodes.join(', '),
    RISK_TRANSFER: sanitizeNoTba(hbInc?.risk_transfer_point, incotermPlace),
    PAY_TERM: payTermEng,
    PAYMENT_TERM: payTermEng,
    PAYMENT_TERMS: payTermEng,
    POL: pol,
    PORT_OF_LOADING: pol,
    POD: pod,
    PORT_OF_DISCHARGE: pod,
    POT: pot,
    PORT_OF_TRANSSHIPMENT: pot,
    ORIGIN: 'Vietnam',
    COUNTRY_OF_ORIGIN: 'Vietnam',
    CO_FORM: coForm,
    INS_TERM: insTerm,
    INSURANCE_TERM: insTerm,
    INS_CLAUSE: insTerm,
    FREIGHT: freightStr,
    FREIGHT_TERM: freightStr,
    CNE_ID: sanitizeNoTba(cus?.consignee_id || order?.consignee_id || inq?.consignee_id, ''),
    CNE_NAME: buyerCompany,
    CONSIGNEE_NAME: buyerCompany,
    BUYER_COMPANY: buyerCompany,
    CNE_ADDR: buyerAddr,
    CONSIGNEE_ADDR: buyerAddr,
    BUYER_ADDR: buyerAddr,
    CNE_COUNTRY: buyerCountry,
    DESTINATION_COUNTRY: buyerCountry,
    CNE_TAX: buyerTax,
    BUYER_TAX: buyerTax,
    CNE_CONTACT: buyerContact,
    CNE_TEL: buyerTel,
    CNE_PHONE: buyerTel,
    BUYER_TEL: buyerTel,
    BUYER_PHONE: buyerTel,
    CNE_EMAIL: buyerEmail,
    BUYER_EMAIL: buyerEmail,
    CNE_FAX: buyerFax,
    BUYER_NAME: buyerContact,
    BUYER_REP: buyerContact,
    BUYER_TITLE: 'Authorized Representative',
    NOTIFY_PARTY: buyerCompany ? `${buyerCompany}${buyerAddr ? ' - ' + buyerAddr : ''}` : 'Same as Consignee',
    SELLER_NAME: SELLER_CONSTANTS.name,
    SHIPPER_NAME: SELLER_CONSTANTS.name,
    SELLER_ADDR: SELLER_CONSTANTS.address,
    SHIPPER_ADDR: SELLER_CONSTANTS.address,
    SELLER_TAX: SELLER_CONSTANTS.taxId,
    SELLER_TEL: SELLER_CONSTANTS.tel,
    SELLER_EMAIL: SELLER_CONSTANTS.email,
    SELLER_REP: SELLER_CONSTANTS.rep,
    SELLER_TITLE: SELLER_CONSTANTS.repTitle,
    SELLER_BANK: SELLER_CONSTANTS.bank,
    BANK_INFO: SELLER_CONSTANTS.bank,
    SALE_NAME: saleDisplay,
    SALES_REP: saleDisplay,
    STAFF_NAME: saleDisplay,
    XNK_REP: xnkDisplay,
    SALE_EMAIL: sanitizeNoTba(saleUser?.email, SELLER_CONSTANTS.email),
    SALE_TEL: SELLER_CONSTANTS.tel,
    SKU: sanitizeNoTba(order?.sku_code || inq?.sku_code || firstProd?.sku_code, ''),
    PROD_NAME_ENG: sanitizeNoTba(prodNamesEng || firstProd?.product_name_eng, ''),
    PROD_NAME_VIE: sanitizeNoTba(prodNamesVie || firstProd?.product_name_vie || inq?.product_name_vie, ''),
    PRODUCT_DESC: sanitizeNoTba(prodNamesEng || firstProd?.product_name_eng, ''),
    GOODS_DESC: sanitizeNoTba(prodNamesEng || firstProd?.product_name_eng, ''),
    HS_CODE: sanitizeNoTba(normalizePlainText(firstProd?.hs_code), '0810.90'),
    STORAGE_TEMP: sanitizeNoTba(firstProd?.storage_temperature, 'Ambient / Dry'),
    UNIT_PRICE: avgUnitPrice > 0 ? `$${avgUnitPrice.toFixed(3)}` : '$0.000',
    NW_KGS: fmtNumber(totalNw),
    TOTAL_NW: fmtNumber(totalNw),
    NET_WEIGHT: `${fmtNumber(totalNw)} KGS`,
    GW_KGS: fmtNumber(totalGw),
    TOTAL_GW: fmtNumber(totalGw),
    GROSS_WEIGHT: `${fmtNumber(totalGw)} KGS`,
    CARTONS: fmtNumber(totalCartons),
    TOTAL_CARTONS: fmtNumber(totalCartons),
    PALLETS: fmtNumber(totalPallets),
    TOTAL_PALLETS: fmtNumber(totalPallets),
    CBM: totalCbm.toFixed(3),
    TOTAL_CBM: totalCbm.toFixed(3),
    PACKING_DESC:
      items.map((it) => `${it.name_eng || it.name}: ${resolvePackingSpec(it.packingCode, pricingRates).engText}`).join('; ') ||
      'Export Standard Cartons',
    SHIPPING_MARKS: shippingMarks,
    MARKS: shippingMarks,
    CONT_TYPE: sanitizeNoTba(prop?.container_type || firstProd?.container_type, "20'DC"),
    CONTAINER_TYPE: sanitizeNoTba(prop?.container_type || firstProd?.container_type, "20'DC"),
    CONT_QTY: String(toNum(prop?.container_qty) || 1),
    BK_NO: bkNo,
    BOOKING_NO: bkNo,
    VES_VOY: vesVoy,
    VESSEL: vesselName || vesVoy,
    VOYAGE: voyageNo || '-',
    CONT_SEAL: contSeal,
    BL_TYPE: sanitizeNoTba(meta?.bl_type, 'ORIGINAL'),
    ETD: etdVal,
    ETA: etaVal,
    TRANSIT_TIME: transitTime,
    SI_CUTOFF: sanitizeNoTba(meta?.si_cutoff, '48 hours prior to ETD'),
    VGM_CUTOFF: sanitizeNoTba(meta?.vgm_cutoff, '24 hours prior to ETD'),
    CY_CUTOFF: sanitizeNoTba(meta?.cy_cutoff, '24 hours prior to ETD'),
    CUT_OFF: sanitizeNoTba(meta?.cy_cutoff || meta?.si_cutoff, '24-48 hours prior to ETD'),
    DELIVERY_DATE: sanitizeNoTba(inq?.desired_delivery_date || sch?.etd, 'Within 15 days after deposit'),
    SHIPMENT_TIME: sanitizeNoTba(inq?.desired_delivery_date || sch?.etd, 'Within 15 days after deposit'),
    SHIPPING_LINE: shippingLine,
    CARRIER: shippingLine,
    FORWARDER: sanitizeNoTba(meta?.fwd_name || sch?.shipping_line, 'Designated Carrier / Forwarder'),
    REMARKS: inq?.note ? inq.note.replace(/\[ITEMS:[^\]]+\]/g, '').trim() || '-' : '-',
    NOTES: inq?.note ? inq.note.replace(/\[ITEMS:[^\]]+\]/g, '').trim() || '-' : '-',
    ITEMS_LIST: allocated
      .map(
        (a, idx) =>
          `${idx + 1}. ${a.item.name_eng || a.item.name} — ${fmtNumber(a.item.weight)} KGS (${fmtNumber(a.item.cartons)} CTNS) @ ${fmtUSD(a.unitPricePerKg)}/KG = ${fmtUSD(a.lineTotalUsd)}`
      )
      .join('\n'),
    // Flat / First-row fallbacks for single-item templates without {{#ITEMS}} loop tags
    NO: itemsTableRows[0]?.NO || '1',
    STT: itemsTableRows[0]?.STT || '1',
    ITEM_STT: itemsTableRows[0]?.ITEM_STT || '1',
    ITEM_NAME: itemsTableRows.map((r) => r.ITEM_NAME).join('\n') || firstProd?.product_name_eng || '',
    ITEM_DESC: itemsTableRows.map((r) => r.ITEM_DESC).join('\n') || firstProd?.product_name_eng || '',
    ITEM_SKU: itemsTableRows.map((r) => r.ITEM_SKU).join(', ') || firstProd?.sku_code || '',
    ITEM_UNIT: 'KGS',
    ITEM_PRICE: itemsTableRows[0]?.ITEM_PRICE || fmtUSD(avgUnitPrice),
    ITEM_QTY: itemsTableRows[0]?.ITEM_QTY || fmtNumber(totalNw),
    ITEM_AMT: itemsTableRows[0]?.ITEM_AMT || fmtUSD(itemAllocationTarget),
    ITEM_PACK: itemsTableRows.map((r) => r.ITEM_PACK).join('; ') || 'Export Standard Cartons',
    ITEM_HS: itemsTableRows[0]?.ITEM_HS || sanitizeNoTba(normalizePlainText(firstProd?.hs_code), '0810.90'),
    ITEM_CARTONS: itemsTableRows[0]?.ITEM_CARTONS || fmtNumber(totalCartons),
    ITEM_NW: itemsTableRows[0]?.ITEM_NW || fmtNumber(totalNw),
    ITEM_GW: itemsTableRows[0]?.ITEM_GW || fmtNumber(totalGw),
    PACKING: itemsTableRows[0]?.PACKING || 'Export Standard Cartons',
    QTY: itemsTableRows[0]?.QTY || fmtNumber(totalNw),
    QTY_KGS: itemsTableRows[0]?.QTY_KGS || fmtNumber(totalNw),
    AMOUNT: itemsTableRows[0]?.AMOUNT || fmtUSD(itemAllocationTarget),
  };

  // Indexed comparison option fields OPT1_* .. OPT4_*
  comparisonRows.slice(0, 4).forEach((opt, idx) => {
    const n = idx + 1;
    baseValues[`OPT${n}_INCOTERM`] = opt.INCOTERM;
    baseValues[`OPT${n}_PRICE`] = opt.PRICE;
    baseValues[`OPT${n}_DESC`] = opt.DESC;
    baseValues[`OPT${n}_RISK`] = opt.RISK_TRANSFER;
    baseValues[`OPT${n}_UNIT_PRICE`] = opt.UNIT_PRICE;
  });

  // Indexed item keys ITEM_1_* .. ITEM_10_* for fixed-row tables
  for (let i = 0; i < 10; i++) {
    const n = i + 1;
    const row = itemsTableRows[i];
    baseValues[`ITEM_${n}_STT`] = row ? row.ITEM_STT : '';
    baseValues[`ITEM_${n}_SKU`] = row ? row.ITEM_SKU : '';
    baseValues[`ITEM_${n}_NAME`] = row ? row.ITEM_NAME : '';
    baseValues[`ITEM_${n}_DESC`] = row ? row.ITEM_DESC : '';
    baseValues[`ITEM_${n}_PACK`] = row ? row.ITEM_PACK : '';
    baseValues[`ITEM_${n}_UNIT`] = row ? row.ITEM_UNIT : '';
    baseValues[`ITEM_${n}_QTY`] = row ? row.ITEM_QTY : '';
    baseValues[`ITEM_${n}_NW`] = row ? row.ITEM_NW : '';
    baseValues[`ITEM_${n}_GW`] = row ? row.ITEM_GW : '';
    baseValues[`ITEM_${n}_CARTONS`] = row ? row.ITEM_CARTONS : '';
    baseValues[`ITEM_${n}_PRICE`] = row ? row.ITEM_PRICE : '';
    baseValues[`ITEM_${n}_AMT`] = row ? row.ITEM_AMT : '';
    baseValues[`ITEM_${n}_HS`] = row ? row.ITEM_HS : '';
  }

  // Complete 9-table source lookup for template_placeholders rules
  const tableSources: Record<string, Array<Record<string, unknown> | undefined>> = {
    order_master: [
      order as unknown as Record<string, unknown>,
      meta as unknown as Record<string, unknown>,
      inq as unknown as Record<string, unknown>,
      prop as unknown as Record<string, unknown>,
    ],
    inquiry_quotation: [
      inq as unknown as Record<string, unknown>,
      order as unknown as Record<string, unknown>,
    ],
    pricing_proposal: [
      prop as unknown as Record<string, unknown>,
      extraMeta as unknown as Record<string, unknown>,
    ],
    consignee_directory: [
      cus as unknown as Record<string, unknown>,
      inq as unknown as Record<string, unknown>,
    ],
    product_catalog: [firstProd as unknown as Record<string, unknown>],
    shipping_schedule: [sch as unknown as Record<string, unknown>],
    incoterms_handbook: [hbInc as unknown as Record<string, unknown>],
    sys_users: [
      saleUser as unknown as Record<string, unknown>,
      xnkUser as unknown as Record<string, unknown>,
      currentUser as unknown as Record<string, unknown>,
    ],
  };

  const resolveFromDbRule = (tp: TemplatePlaceholder): string => {
    const keyUpper = stripPlaceholderBraces(tp.placeholder_key).toUpperCase();
    if (baseValues[keyUpper] !== undefined && baseValues[keyUpper] !== '') {
      return sanitizeNoTba(baseValues[keyUpper], '');
    }

    const tbl = String(tp.source_table || '').trim().toLowerCase();
    const col = String(tp.source_column || '').trim();
    const colUpper = col.toUpperCase();

    if (colUpper === 'TOT_AMT_WORDS' || colUpper === 'TOTAL_AMT_WORDS') return totAmtWords;
    if (colUpper === 'INCOTERM_PLACE') return incotermPlace;
    if (colUpper === 'INS_TERM') return insTerm;
    if (colUpper === 'FREIGHT') return freightStr;

    if (tbl && tableSources[tbl] && col) {
      for (const rec of tableSources[tbl]) {
        if (!rec) continue;
        const directVal = rec[col] ?? rec[col.toLowerCase()];
        const matchedKey =
          directVal !== undefined
            ? null
            : Object.keys(rec).find((rk) => rk.toLowerCase() === col.toLowerCase());
        const rawVal = directVal !== undefined ? directVal : matchedKey ? rec[matchedKey] : undefined;
        if (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '') {
          if (typeof rawVal === 'number') {
            if (col.toLowerCase().includes('value') || col.toLowerCase().includes('price') || col.toLowerCase().includes('cost')) {
              return formatCurrency(rawVal);
            }
            return fmtNumber(rawVal);
          }
          const cleaned = sanitizeNoTba(normalizePlainText(rawVal), '');
          if (cleaned) return cleaned;
        }
      }
    }

    if (tbl === 'system_lookups' && col) {
      const lk = lookups.find(
        (l) => l.code.trim().toLowerCase() === col.toLowerCase() || l.category.trim().toLowerCase() === col.toLowerCase()
      );
      if (lk?.contract_text_eng) return sanitizeNoTba(lk.contract_text_eng, '');
      if (lk?.display_name_vie) return sanitizeNoTba(lk.display_name_vie, '');
    }

    if (tbl === 'pricing_rates' && col) {
      const pr = pricingRates.find((r) => r.fee_code.trim().toLowerCase() === col.toLowerCase());
      if (pr?.contract_text_eng) return sanitizeNoTba(pr.contract_text_eng, '');
      if (pr?.standard_rate) return formatCurrency(pr.standard_rate);
    }

    if (
      (tbl === 'computed' || tbl === 'default' || tbl === 'constant' || tbl === 'manual') &&
      col &&
      !/^tba$/i.test(col) &&
      !/^tbd$/i.test(col)
    ) {
      return col;
    }

    return '';
  };

  const fields: Record<string, string> = {};
  Object.entries(baseValues).forEach(([k, v]) => {
    fields[k] = sanitizeNoTba(v, '');
  });

  const tpByKey = new Map<string, TemplatePlaceholder>();
  templatePlaceholders.forEach((tp) => {
    const k = stripPlaceholderBraces(tp.placeholder_key);
    if (!k) return;
    const upper = k.toUpperCase();
    tpByKey.set(upper, { ...tp, placeholder_key: k });
    const val = sanitizeNoTba(
      baseValues[upper] !== undefined && baseValues[upper] !== '' ? baseValues[upper] : resolveFromDbRule(tp),
      ''
    );
    fields[k] = val;
    fields[upper] = val;
  });

  detectedKeys.forEach((rawKey) => {
    const key = stripPlaceholderBraces(rawKey);
    const upper = key.toUpperCase();
    if (fields[key] === undefined) {
      fields[key] = sanitizeNoTba(fields[upper] ?? baseValues[upper] ?? '', '');
    }
  });

  const descriptorMap = new Map<string, TemplateFieldDescriptor>();
  const targetKeys =
    detectedKeys.length > 0
      ? detectedKeys.map(stripPlaceholderBraces).filter(Boolean)
      : templatePlaceholders.map((t) => stripPlaceholderBraces(t.placeholder_key)).filter(Boolean);

  targetKeys.forEach((key) => {
    const upper = key.toUpperCase();
    if (itemsTableRows.length > 1 && LOOP_ITEM_KEYS.has(upper)) {
      return;
    }
    const tp = tpByKey.get(upper);
    descriptorMap.set(key, {
      key,
      description: resolveCleanVietnameseLabel(key, tp),
      value: fields[key] ?? fields[upper] ?? '',
    });
  });

  return {
    fields,
    descriptors: Array.from(descriptorMap.values()),
    itemsTableRows,
    comparisonRows,
  };
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

interface PizZipWithFileApi {
  file(path: string): { asText(): string } | null;
  file(path: string, data: string): PizZip;
}

function autoWrapDynamicItemRowInZip(zip: PizZip, hasRows: boolean): void {
  if (!hasRows) return;
  const zipApi = zip as unknown as PizZipWithFileApi;
  const docFile = zipApi.file('word/document.xml');
  if (!docFile) return;
  const xmlStr = docFile.asText();

  // Skip if template already defines an explicit loop tag for items
  if (/\{\{\s*#\s*(ITEMS|ORDER_ITEMS|GOODS|LINES|PRODUCTS)\s*\}\}/i.test(xmlStr)) {
    return;
  }

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlStr, 'application/xml');
  if (xmlDoc.getElementsByTagName('parsererror').length > 0) return;

  const rows = Array.from(xmlDoc.getElementsByTagName('w:tr'));
  let modified = false;

  for (const tr of rows) {
    const rowPlain = Array.from(tr.getElementsByTagName('w:t'))
      .map((n) => n.textContent || '')
      .join('');
    const tagMatches = Array.from(rowPlain.matchAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g)).map((m) =>
      m[1].trim().toUpperCase()
    );
    if (tagMatches.length < 2) continue;

    const itemTagsInRow = tagMatches.filter((t) => LOOP_ITEM_KEYS.has(t));
    const hasCoreItemTag = itemTagsInRow.some((t) =>
      ['ITEM_NAME', 'ITEM_DESC', 'PROD_NAME_ENG', 'PROD_NAME_VIE', 'ITEM_SKU', 'ITEM_PRICE', 'ITEM_AMT', 'ITEM_QTY'].includes(t)
    );
    if (!hasCoreItemTag || itemTagsInRow.length < 2) continue;

    const cells = Array.from(tr.getElementsByTagName('w:tc'));
    if (cells.length === 0) continue;
    const firstCellT = cells[0].getElementsByTagName('w:t')[0];
    const lastCellTs = cells[cells.length - 1].getElementsByTagName('w:t');
    const lastCellT = lastCellTs[lastCellTs.length - 1];
    if (!firstCellT || !lastCellT) continue;

    firstCellT.setAttribute('xml:space', 'preserve');
    firstCellT.textContent = `{{#ITEMS}}${firstCellT.textContent || ''}`;
    lastCellT.setAttribute('xml:space', 'preserve');
    lastCellT.textContent = `${lastCellT.textContent || ''}{{/ITEMS}}`;
    modified = true;
    break;
  }

  if (modified) {
    const serializer = new XMLSerializer();
    zipApi.file('word/document.xml', serializer.serializeToString(xmlDoc));
  }
}

export async function renderPopulatedDocxBytes(
  templateBuffer: ArrayBuffer,
  fieldValues: Record<string, string>,
  itemsTableRows?: Array<Record<string, string>>,
  comparisonRows?: Array<Record<string, string>>
): Promise<Uint8Array> {
  const zip = new PizZip(templateBuffer.slice(0));
  const rows = itemsTableRows || [];
  const compRows = comparisonRows || [];

  try {
    autoWrapDynamicItemRowInZip(zip, rows.length > 0);
  } catch {
    // Keep original XML if auto-wrapping encounters malformed XML
  }

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' },
    nullGetter: (part: { value?: string }) => {
      const k = stripPlaceholderBraces(part?.value || '');
      const val = fieldValues[k] ?? fieldValues[k.toUpperCase()] ?? '';
      return sanitizeNoTba(val, '');
    },
  });

  doc.render({
    ...fieldValues,
    ITEMS: rows,
    ORDER_ITEMS: rows,
    GOODS: rows,
    LINES: rows,
    PRODUCTS: rows,
    OPTIONS: compRows,
    COMPARISON: compRows,
    COMPARISON_ROWS: compRows,
    INCOTERM_OPTIONS: compRows,
  });

  return doc.getZip().generate({
    type: 'uint8array',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

export interface DocxParagraphBlock {
  id: string;
  xmlFile: string;
  indexInFile: number;
  text: string;
  originalText: string;
  isTableCell?: boolean;
  contextHint?: string;
}

function getParagraphText(p: Element): string {
  return Array.from(p.getElementsByTagName('w:t'))
    .map((n) => n.textContent || '')
    .join('');
}

function findAncestorTag(el: Element | null, tagName: string): Element | null {
  let cur: Node | null = el?.parentNode || null;
  while (cur) {
    if (cur.nodeType === 1 && (cur as Element).tagName === tagName) {
      return cur as Element;
    }
    cur = cur.parentNode;
  }
  return null;
}

export async function extractDocxParagraphBlocks(buffer: ArrayBuffer): Promise<DocxParagraphBlock[]> {
  const zip = new PizZip(buffer.slice(0));
  const zipApi = zip as unknown as PizZipWithFileApi & { files: Record<string, unknown> };
  const xmlFiles = Object.keys(zipApi.files || {}).filter(
    (name) => /^word\/(document|header\d+|footer\d+)\.xml$/i.test(name)
  );
  const parser = new DOMParser();
  const blocks: DocxParagraphBlock[] = [];

  for (const xmlFile of xmlFiles) {
    const fileEntry = zipApi.file(xmlFile);
    if (!fileEntry) continue;
    const xmlStr = fileEntry.asText();
    const xmlDoc = parser.parseFromString(xmlStr, 'application/xml');
    const paragraphs = Array.from(xmlDoc.getElementsByTagName('w:p'));

    paragraphs.forEach((p, idx) => {
      const text = getParagraphText(p).trim();
      const tc = findAncestorTag(p, 'w:tc');
      const isTableCell = Boolean(tc);

      if (text) {
        let contextHint = '';
        if (tc) {
          const tr = findAncestorTag(tc, 'w:tr');
          if (tr) {
            const cells = Array.from(tr.children).filter((c) => c.tagName === 'w:tc');
            const cIdx = cells.indexOf(tc);
            if (cIdx > 0) {
              const prevText = Array.from(cells[cIdx - 1].getElementsByTagName('w:t'))
                .map((n) => n.textContent || '')
                .join('')
                .trim();
              if (prevText) contextHint = prevText;
            }
          }
        }
        blocks.push({
          id: `${xmlFile}::${idx}`,
          xmlFile,
          indexInFile: idx,
          text,
          originalText: text,
          isTableCell,
          contextHint: contextHint || undefined,
        });
        return;
      }

      // Include empty first paragraph inside a table cell if another cell in the same row has text (e.g. "Contract No.: | [empty]")
      if (tc) {
        const cellParagraphs = Array.from(tc.children).filter((c) => c.tagName === 'w:p');
        if (cellParagraphs[0] === p) {
          const tr = findAncestorTag(tc, 'w:tr');
          if (tr) {
            const cells = Array.from(tr.children).filter((c) => c.tagName === 'w:tc');
            const cIdx = cells.indexOf(tc);
            const siblingTexts = cells
              .map((cell, ci) =>
                ci === cIdx
                  ? ''
                  : Array.from(cell.getElementsByTagName('w:t'))
                      .map((n) => n.textContent || '')
                      .join('')
                      .trim()
              )
              .filter(Boolean);
            if (siblingTexts.length > 0) {
              const prevHint =
                cIdx > 0
                  ? Array.from(cells[cIdx - 1].getElementsByTagName('w:t'))
                      .map((n) => n.textContent || '')
                      .join('')
                      .trim()
                  : '';
              blocks.push({
                id: `${xmlFile}::${idx}`,
                xmlFile,
                indexInFile: idx,
                text: '',
                originalText: '',
                isTableCell: true,
                contextHint: prevHint || siblingTexts[0],
              });
            }
          }
        }
      }
    });
  }

  return blocks;
}

export async function applyAiTagsToDocx(
  buffer: ArrayBuffer,
  replacements: Array<{ blockId: string; taggedText: string }>
): Promise<Uint8Array> {
  const zip = new PizZip(buffer.slice(0));
  const zipApi = zip as unknown as PizZipWithFileApi;
  const byFile = new Map<string, Array<{ indexInFile: number; taggedText: string }>>();

  replacements.forEach((r) => {
    const sep = r.blockId.lastIndexOf('::');
    if (sep <= 0) return;
    const xmlFile = r.blockId.slice(0, sep);
    const idx = parseInt(r.blockId.slice(sep + 2), 10);
    if (Number.isNaN(idx)) return;
    const arr = byFile.get(xmlFile) || [];
    arr.push({ indexInFile: idx, taggedText: r.taggedText });
    byFile.set(xmlFile, arr);
  });

  const parser = new DOMParser();
  const serializer = new XMLSerializer();

  for (const [xmlFile, items] of byFile.entries()) {
    const fileEntry = zipApi.file(xmlFile);
    if (!fileEntry) continue;
    const xmlStr = fileEntry.asText();
    const xmlDoc = parser.parseFromString(xmlStr, 'application/xml');
    const paragraphs = Array.from(xmlDoc.getElementsByTagName('w:p'));

    items.forEach(({ indexInFile, taggedText }) => {
      const p = paragraphs[indexInFile];
      if (!p) return;
      const tNodes = Array.from(p.getElementsByTagName('w:t'));
      if (tNodes.length === 0) {
        if (!taggedText) return;
        const rEl = xmlDoc.createElementNS(W_NS, 'w:r');
        // Preserve default run formatting declared on <w:pPr><w:rPr>
        const pPr = Array.from(p.children).find((c) => c.tagName === 'w:pPr');
        const pRPr = pPr ? Array.from(pPr.children).find((c) => c.tagName === 'w:rPr') : undefined;
        if (pRPr) {
          rEl.appendChild(pRPr.cloneNode(true));
        }
        const tEl = xmlDoc.createElementNS(W_NS, 'w:t');
        tEl.setAttribute('xml:space', 'preserve');
        tEl.textContent = taggedText;
        rEl.appendChild(tEl);
        p.appendChild(rEl);
        return;
      }
      tNodes[0].setAttribute('xml:space', 'preserve');
      tNodes[0].textContent = taggedText;
      for (let i = 1; i < tNodes.length; i++) {
        tNodes[i].textContent = '';
      }
    });

    zipApi.file(xmlFile, serializer.serializeToString(xmlDoc));
  }

  return zip.generate({
    type: 'uint8array',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
