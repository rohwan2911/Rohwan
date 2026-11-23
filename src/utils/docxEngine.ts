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
  computeSilentFobUnitPrices,
  fmtNumber,
  fmtUSD,
  formatCurrency,
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

  const isMixed = buckets.size >= 2 || items.length >= 2 && buckets.size === 0 && new Set(items.map((i) => i.sku.toLowerCase())).size >= 2;
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

const VIETNAMESE_PLACEHOLDER_LABELS: Record<string, string> = {
  ORD_ID: 'Mã đơn hàng',
  ORDER_ID: 'Mã đơn hàng',
  CTR_NO: 'Số Hợp đồng',
  CONTRACT_NO: 'Số Hợp đồng',
  CTR_DT: 'Ngày ký Hợp đồng',
  CTR_DATE: 'Ngày ký Hợp đồng',
  CONTRACT_DATE: 'Ngày ký Hợp đồng',
  DOC_DATE: 'Ngày lập chứng từ',
  QUOT_NO: 'Số Báo giá',
  QT_NO: 'Số Báo giá',
  QUOTE_NO: 'Số Báo giá',
  QUOT_DT: 'Ngày Báo giá',
  QT_DT: 'Ngày Báo giá',
  QT_DATE: 'Ngày Báo giá',
  QUOTE_DATE: 'Ngày Báo giá',
  VALIDITY: 'Hiệu lực Báo giá',
  QUOT_VALIDITY: 'Hiệu lực Báo giá',
  INV_NO: 'Số Hóa đơn Thương mại',
  PL_NO: 'Số Phiếu Đóng gói',
  SALE_NAME: 'Nhân viên Kinh doanh phụ trách',
  STAFF_NAME: 'Nhân sự phụ trách',
  SELLER_REP: 'Đại diện Bên bán',
  XNK_REP: 'Chuyên viên XNK phụ trách',
  SALE_EMAIL: 'Email Nhân viên phụ trách',
  SALE_TEL: 'Điện thoại Nhân viên phụ trách',
  CNE_ID: 'Mã Khách hàng',
  CNE_NAME: 'Tên Công ty Nhập khẩu',
  CONSIGNEE_NAME: 'Tên Công ty Nhập khẩu',
  CNE_ADDR: 'Địa chỉ Khách hàng',
  BUYER_ADDR: 'Địa chỉ Người mua',
  CNE_COUNTRY: 'Quốc gia Nhập khẩu',
  CNE_TAX: 'Mã số thuế Khách hàng',
  BUYER_TAX: 'Mã số thuế Người mua',
  CNE_TEL: 'Số điện thoại Khách hàng',
  CNE_PHONE: 'Số điện thoại Khách hàng',
  BUYER_TEL: 'Số điện thoại Người mua',
  CNE_EMAIL: 'Email Khách hàng',
  BUYER_EMAIL: 'Email Người mua',
  CNE_FAX: 'Số Fax Khách hàng',
  BUYER_NAME: 'Người liên hệ Bên mua',
  BUYER_REP: 'Đại diện ký Bên mua',
  CNE_CONTACT: 'Người liên hệ Khách hàng',
  BUYER_TITLE: 'Chức danh Đại diện Bên mua',
  SELLER_NAME: 'Tên Công ty Xuất khẩu',
  SELLER_ADDR: 'Địa chỉ Công ty Xuất khẩu',
  SELLER_TAX: 'Mã số thuế Công ty Xuất khẩu',
  SELLER_TEL: 'Điện thoại Công ty Xuất khẩu',
  SELLER_EMAIL: 'Email Công ty Xuất khẩu',
  SELLER_BANK: 'Thông tin Ngân hàng Thụ hưởng',
  BANK_INFO: 'Thông tin Ngân hàng Thụ hưởng',
  POL: 'Cảng bốc hàng (POL)',
  POD: 'Cảng dỡ hàng (POD)',
  POT: 'Cảng chuyển tải (POT)',
  INCOTERM: 'Điều kiện Giao hàng (Incoterms)',
  APPLIED_INCOTERM: 'Điều kiện Giao hàng (Incoterms)',
  INCOTERM_PLACE: 'Địa điểm Giao hàng (Incoterms)',
  INCOTERM_FULL: 'Tên đầy đủ Incoterms 2020',
  INCOTERM_TEXT: 'Điều khoản Incoterms hợp đồng',
  PAY_TERM: 'Điều khoản Thanh toán',
  PAYMENT_TERMS: 'Điều khoản Thanh toán',
  CO_FORM: 'Mẫu Giấy chứng nhận Xuất xứ (C/O)',
  INS_TERM: 'Điều khoản Bảo hiểm Hàng hóa',
  INSURANCE_TERM: 'Điều khoản Bảo hiểm Hàng hóa',
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
  CTR_VAL: 'Tổng Giá trị Hợp đồng',
  CONTRACT_VALUE: 'Tổng Giá trị Hợp đồng',
  TOT_AMT: 'Tổng Thanh toán (USD)',
  TOTAL_AMT: 'Tổng Thanh toán (USD)',
  TOTAL_AMOUNT: 'Tổng Thanh toán (USD)',
  TOT_AMT_WORDS: 'Tổng tiền bằng chữ (Tiếng Anh)',
  TOTAL_AMT_WORDS: 'Tổng tiền bằng chữ (Tiếng Anh)',
  AMOUNT_IN_WORDS: 'Tổng tiền bằng chữ (Tiếng Anh)',
  SKU: 'Mã SKU Sản phẩm',
  PROD_NAME_ENG: 'Tên Sản phẩm (Tiếng Anh)',
  PROD_NAME_VIE: 'Tên Sản phẩm (Tiếng Việt)',
  PRODUCT_DESC: 'Mô tả Hàng hóa',
  HS_CODE: 'Mã HS Code',
  STORAGE_TEMP: 'Nhiệt độ Bảo quản',
  UNIT_PRICE: 'Đơn giá Bình quân (USD/KG)',
  NW_KGS: 'Tổng Khối lượng Tịnh (KG)',
  NET_WEIGHT: 'Tổng Khối lượng Tịnh',
  GW_KGS: 'Tổng Khối lượng Cả bì (KG)',
  GROSS_WEIGHT: 'Tổng Khối lượng Cả bì',
  CARTONS: 'Tổng số Thùng Carton',
  TOTAL_CARTONS: 'Tổng số Thùng Carton',
  PALLETS: 'Tổng số Pallet',
  TOTAL_PALLETS: 'Tổng số Pallet',
  CBM: 'Tổng Thể tích (CBM)',
  TOTAL_CBM: 'Tổng Thể tích (CBM)',
  PACKING_DESC: 'Quy cách Đóng gói',
  CONT_TYPE: 'Loại & Số lượng Container',
  CONT_QTY: 'Số lượng Container',
  BK_NO: 'Số Booking (B/K No.)',
  VES_VOY: 'Tên Tàu / Số Chuyến',
  CONT_SEAL: 'Số Container / Số Seal',
  BL_TYPE: 'Loại Vận đơn (B/L)',
  ETD: 'Ngày Tàu chạy Dự kiến (ETD)',
  ETA: 'Ngày Tàu đến Dự kiến (ETA)',
  DELIVERY_DATE: 'Thời hạn Giao hàng Dự kiến',
  SHIPPING_LINE: 'Hãng tàu / Đơn vị Vận tải',
  ITEMS_LIST: 'Danh sách Chi tiết Sản phẩm',
  ITEM_STT: 'Số thứ tự dòng hàng',
  ITEM_NAME: 'Tên hàng hóa (Tiếng Anh)',
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
  PACKING: 'Quy cách Đóng gói',
  QTY_KGS: 'Khối lượng (KG)',
  AMOUNT: 'Thành tiền (USD)',
  RISK_TRANSFER: 'Điểm Chuyển giao Rủi ro',
  REMARKS: 'Ghi chú bổ sung',
};

function resolveCleanVietnameseLabel(key: string, tp?: TemplatePlaceholder): string {
  const upper = key.trim().toUpperCase();
  const dbDesc = String(tp?.description_vie || '').trim();
  if (dbDesc && dbDesc.toUpperCase() !== upper && dbDesc.toUpperCase() !== upper.replace(/_/g, ' ')) {
    return dbDesc;
  }
  if (VIETNAMESE_PLACEHOLDER_LABELS[upper]) {
    return VIETNAMESE_PLACEHOLDER_LABELS[upper];
  }
  return 'Thông tin chứng từ';
}

const LOOP_ITEM_KEYS = new Set([
  'NO', 'SKU', 'PROD_NAME_ENG', 'PROD_NAME_VIE', 'PACKING', 'QTY_KGS', 'CARTONS', 'UNIT_PRICE', 'AMOUNT',
  'ITEM_STT', 'ITEM_NAME', 'ITEM_SKU', 'ITEM_UNIT', 'ITEM_PRICE', 'ITEM_QTY', 'ITEM_AMT', 'ITEM_PACK',
  'ITEM_DESC', 'ITEM_HS', 'ITEM_CARTONS', 'ITEM_NW', 'ITEM_GW',
]);

export function buildTemplateFieldContext(
  input: PlaceholderContextInput,
  detectedKeys: string[]
): {
  fields: Record<string, string>;
  descriptors: TemplateFieldDescriptor[];
  itemsTableRows: Array<Record<string, string>>;
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
  ).toUpperCase();

  const pol = order?.pol || sch?.pol || 'Cat Lai Port, Ho Chi Minh City, Vietnam';
  const pod =
    order?.pod ||
    sch?.pod ||
    (cus?.country ? `Main Port, ${cus.country}` : 'Destination Port');
  const originIncotermCodes = ['EXW', 'FCA', 'FAS', 'FOB'];
  const incotermPlace = originIncotermCodes.includes(incoterm) ? pol : pod;

  const usePalletFlag = extraMeta?.use_pallet ?? (toNum(prop?.total_pallets) > 0);
  const pool = computeOrderPalletSummary(items, usePalletFlag, pricingRates);

  // Calculate Ocean Freight, Marine Insurance, Destination Charges & FOB Subtotal
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
    ? Math.round((toNum(extraMeta?.dest_extra) + (incoterm === 'DDP' ? toNum(extraMeta?.import_duty_usd) : 0)) * 100) / 100
    : 0;

  const rawExtras = freightCost + insCost + destCost;
  const subtotalAmt =
    rawExtras > 0 && rawExtras < totalSelling
      ? Math.round((totalSelling - rawExtras) * 100) / 100
      : totalSelling;

  const detectedUpper = new Set(detectedKeys.map((k) => k.toUpperCase()));
  const hasSeparateSubtotalInDoc =
    kind === 'QUOTATION' ||
    detectedUpper.has('SUBTOTAL_AMT') ||
    detectedUpper.has('SUBTOTAL') ||
    detectedUpper.has('FREIGHT_AMT') ||
    detectedUpper.has('OCEAN_FREIGHT');

  const itemAllocationTarget = hasSeparateSubtotalInDoc ? subtotalAmt : totalSelling;
  const allocated = computeSilentFobUnitPrices(items, itemAllocationTarget, products, pricingRates);

  const firstProd = items[0]
    ? products.find((p) => p.sku_code.toLowerCase() === items[0].sku.toLowerCase())
    : products.find((p) => p.sku_code.toLowerCase() === String(order?.sku_code || inq?.sku_code || '').toLowerCase());

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

  const payTerm = order?.payment_terms || inq?.proposed_payment_term || cus?.default_payment_term || 'T/T 30/70';
  const lookupPay = lookups.find(
    (l) => l.code.toLowerCase() === payTerm.toLowerCase() || l.display_name_vie.toLowerCase() === payTerm.toLowerCase()
  );
  const payTermEng = lookupPay?.contract_text_eng || payTerm;

  const hbInc = incoterms.find((h) => String(h.incoterms_code || '').toUpperCase() === incoterm);

  const coForm = order?.co_form || suggestCoFormCode(pod, cus?.country);
  const quoteNo = cleanQuoteNoForCustomer(extraMeta?.quotation_no || '', inq?.order_id || order?.order_id);
  const quoteDate = inq?.timestamp ? String(inq.timestamp).slice(0, 10) : todayIsoDate();
  const contractNo =
    order?.contract_no ||
    (order?.order_id || inq?.order_id
      ? `SC-${new Date().getFullYear()}-${String(order?.order_id || inq?.order_id).replace(/^ORD-/i, '')}/GAE`
      : `SC-${new Date().getFullYear()}/GAE`);
  const contractDate = order?.contract_date || todayIsoDate();

  const staffDisplay = order?.in_charge_staff || inq?.sale_rep || prop?.xnk_rep || currentUser?.full_name || SELLER_CONSTANTS.rep;
  const matchedUser =
    users.find(
      (u) =>
        u.full_name.trim().toLowerCase() === String(inq?.sale_rep || staffDisplay).trim().toLowerCase() ||
        u.employee_id.trim().toLowerCase() === String(inq?.sale_rep || staffDisplay).trim().toLowerCase()
    ) || currentUser;

  const totalNw = toNum(order?.nw_confirmed_kgs) || toNum(inq?.net_weight_kgs) || pool.cargoNetKg;
  const totalGw = toNum(prop?.total_gross_weight) || pool.totalGrossWeightKg || totalNw;
  const totalCartons = toNum(prop?.total_cartons) || pool.totalCartons;
  const totalPallets = toNum(prop?.total_pallets) || pool.totalPallets;
  const totalCbm = toNum(prop?.total_cbm) || pool.totalCbm;
  const totAmtWords = numberToEnglishWordsUsd(totalSelling);
  const vesVoy = meta?.ves_voy || (sch?.vessel ? `${sch.vessel}${sch.voyage ? ' / ' + sch.voyage : ''}` : '') || 'To be advised';
  const bkNo = meta?.bk_no || meta?.carrier_bk_no || meta?.fwd_bk_no || 'To be advised';
  const contSeal = meta?.cont_seal_list || prop?.container_type || 'To be advised';
  const prodNamesEng = allocated.map((a) => `${a.item.name_eng || a.item.name} (${fmtNumber(a.item.weight)} KG)`).join('; ');
  const prodNamesVie = items.map((it) => `${it.name} (${fmtNumber(it.weight)} KG)`).join('; ');
  const avgUnitPrice = totalNw > 0 ? itemAllocationTarget / totalNw : toNum(firstProd?.unit_price);

  const itemsTableRows = allocated.map((row, idx) => {
    const prod = products.find((p) => p.sku_code.toLowerCase() === row.item.sku.toLowerCase());
    const packSpec = resolvePackingSpec(row.item.packingCode, pricingRates);
    const packEng = packSpec.engText || row.item.packingName || row.item.packingCode;
    return {
      NO: String(idx + 1),
      ITEM_STT: String(idx + 1),
      SKU: row.item.sku,
      ITEM_SKU: row.item.sku,
      PROD_NAME_ENG: row.item.name_eng || row.item.name,
      PROD_NAME_VIE: row.item.name,
      ITEM_NAME: row.item.name_eng || row.item.name,
      ITEM_DESC: row.item.name_eng || row.item.name,
      ITEM_HS: normalizePlainText(prod?.hs_code) || '0810.90',
      PACKING: packEng,
      ITEM_PACK: packEng,
      ITEM_UNIT: 'KGS',
      QTY_KGS: fmtNumber(row.item.weight),
      ITEM_QTY: fmtNumber(row.item.weight),
      ITEM_NW: fmtNumber(row.item.weight),
      ITEM_GW: fmtNumber(row.item.grossWeightKg || row.item.weight),
      CARTONS: fmtNumber(row.item.cartons),
      ITEM_CARTONS: fmtNumber(row.item.cartons),
      UNIT_PRICE: fmtUSD(row.unitPricePerKg),
      ITEM_PRICE: fmtUSD(row.unitPricePerKg),
      AMOUNT: fmtUSD(row.lineTotalUsd),
      ITEM_AMT: fmtUSD(row.lineTotalUsd),
    };
  });

  const buyerCompany = cus?.consignee_name || order?.consignee_id || inq?.consignee_id || '';
  const buyerContact = cus?.contact_person || inq?.contact || buyerCompany;
  const buyerAddr = cus?.address || inq?.address || '';
  const buyerTel = normalizePlainText(cus?.phone || inq?.phone) || '-';
  const buyerEmail = cus?.email || inq?.email || '';
  const buyerTax = normalizePlainText(cus?.tax) || '-';

  const baseValues: Record<string, string> = {
    ORD_ID: order?.order_id || inq?.order_id || '',
    ORDER_ID: order?.order_id || inq?.order_id || '',
    CTR_NO: contractNo,
    CONTRACT_NO: contractNo,
    CTR_DT: contractDate,
    CTR_DATE: contractDate,
    CONTRACT_DATE: contractDate,
    DOC_DATE: todayIsoDate(),
    QUOT_NO: quoteNo,
    QT_NO: quoteNo,
    QUOTE_NO: quoteNo,
    QUOT_DT: quoteDate,
    QT_DT: quoteDate,
    QT_DATE: quoteDate,
    QUOTE_DATE: quoteDate,
    VALIDITY: '07 calendar days from issue date',
    QUOT_VALIDITY: '07 calendar days from issue date',
    INV_NO: `CI-${(order?.contract_no || order?.order_id || '001').replace(/[^A-Za-z0-9-]/g, '')}`,
    PL_NO: `PL-${(order?.contract_no || order?.order_id || '001').replace(/[^A-Za-z0-9-]/g, '')}`,
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
    INCOTERM: incoterm,
    APPLIED_INCOTERM: incoterm,
    INCOTERM_PLACE: incotermPlace,
    INCOTERM_FULL: hbInc?.full_name || `${incoterm} (Incoterms 2020)`,
    INCOTERM_TEXT: hbInc?.contract_text_eng || `${incoterm} ${incotermPlace} (Incoterms 2020)`,
    RISK_TRANSFER: hbInc?.risk_transfer_point || incotermPlace,
    PAY_TERM: payTermEng,
    PAYMENT_TERMS: payTermEng,
    POL: pol,
    POD: pod,
    POT: sch?.pot && sch.pot !== '-' ? sch.pot : 'Direct',
    CO_FORM: coForm,
    INS_TERM: insTerm,
    INSURANCE_TERM: insTerm,
    FREIGHT: freightStr,
    FREIGHT_TERM: freightStr,
    CNE_ID: cus?.consignee_id || order?.consignee_id || inq?.consignee_id || '',
    CNE_NAME: buyerCompany,
    CONSIGNEE_NAME: buyerCompany,
    CNE_ADDR: buyerAddr,
    BUYER_ADDR: buyerAddr,
    CNE_COUNTRY: cus?.country || sch?.country || '',
    CNE_TAX: buyerTax,
    BUYER_TAX: buyerTax,
    CNE_CONTACT: buyerContact,
    CNE_TEL: buyerTel,
    CNE_PHONE: buyerTel,
    BUYER_TEL: buyerTel,
    CNE_EMAIL: buyerEmail,
    BUYER_EMAIL: buyerEmail,
    CNE_FAX: normalizePlainText(cus?.fax) || '-',
    BUYER_NAME: buyerContact,
    BUYER_REP: buyerContact,
    BUYER_TITLE: 'Authorized Representative',
    SELLER_NAME: SELLER_CONSTANTS.name,
    SELLER_ADDR: SELLER_CONSTANTS.address,
    SELLER_TAX: SELLER_CONSTANTS.taxId,
    SELLER_TEL: SELLER_CONSTANTS.tel,
    SELLER_EMAIL: SELLER_CONSTANTS.email,
    SELLER_REP: SELLER_CONSTANTS.rep,
    SELLER_BANK: SELLER_CONSTANTS.bank,
    BANK_INFO: SELLER_CONSTANTS.bank,
    SALE_NAME: staffDisplay,
    STAFF_NAME: staffDisplay,
    XNK_REP: prop?.xnk_rep || staffDisplay,
    SALE_EMAIL: matchedUser?.email || SELLER_CONSTANTS.email,
    SALE_TEL: SELLER_CONSTANTS.tel,
    SKU: order?.sku_code || inq?.sku_code || firstProd?.sku_code || '',
    PROD_NAME_ENG: prodNamesEng || firstProd?.product_name_eng || '',
    PROD_NAME_VIE: prodNamesVie || firstProd?.product_name_vie || inq?.product_name_vie || '',
    PRODUCT_DESC: prodNamesEng || firstProd?.product_name_eng || '',
    HS_CODE: normalizePlainText(firstProd?.hs_code) || '0810.90',
    STORAGE_TEMP: firstProd?.storage_temperature || 'Ambient / Dry',
    UNIT_PRICE: avgUnitPrice > 0 ? `$${avgUnitPrice.toFixed(3)}` : '$0.000',
    NW_KGS: fmtNumber(totalNw),
    NET_WEIGHT: `${fmtNumber(totalNw)} KGS`,
    GW_KGS: fmtNumber(totalGw),
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
    CONT_TYPE: prop?.container_type || firstProd?.container_type || "20'DC",
    CONT_QTY: String(toNum(prop?.container_qty) || 1),
    BK_NO: bkNo,
    VES_VOY: vesVoy,
    CONT_SEAL: contSeal,
    BL_TYPE: meta?.bl_type || 'ORIGINAL',
    ETD: sch?.etd || inq?.desired_delivery_date || 'As scheduled',
    ETA: sch?.eta || 'As scheduled',
    DELIVERY_DATE: inq?.desired_delivery_date || sch?.etd || 'Within 15 days after deposit',
    SHIPPING_LINE: sch?.shipping_line || meta?.fwd_name || 'To be confirmed',
    REMARKS: inq?.note ? inq.note.replace(/\[ITEMS:[^\]]+\]/g, '').trim() || '-' : '-',
    ITEMS_LIST: allocated
      .map(
        (a, idx) =>
          `${idx + 1}. ${a.item.name_eng || a.item.name} — ${fmtNumber(a.item.weight)} KGS (${fmtNumber(a.item.cartons)} CTNS) @ ${fmtUSD(a.unitPricePerKg)}/KG = ${fmtUSD(a.lineTotalUsd)}`
      )
      .join('\n'),
    // Flat / First-row fallbacks for templates without {{#ITEMS}} loop tags
    NO: itemsTableRows[0]?.NO || '1',
    ITEM_STT: itemsTableRows[0]?.ITEM_STT || '1',
    ITEM_NAME: itemsTableRows.map((r) => r.ITEM_NAME).join('\n') || firstProd?.product_name_eng || '',
    ITEM_SKU: itemsTableRows.map((r) => r.ITEM_SKU).join(', ') || firstProd?.sku_code || '',
    ITEM_UNIT: 'KGS',
    ITEM_PRICE: itemsTableRows[0]?.ITEM_PRICE || fmtUSD(avgUnitPrice),
    ITEM_QTY: itemsTableRows[0]?.ITEM_QTY || fmtNumber(totalNw),
    ITEM_AMT: itemsTableRows[0]?.ITEM_AMT || fmtUSD(itemAllocationTarget),
    ITEM_PACK: itemsTableRows.map((r) => r.ITEM_PACK).join('; ') || 'Export Standard Cartons',
    ITEM_HS: itemsTableRows[0]?.ITEM_HS || normalizePlainText(firstProd?.hs_code) || '0810.90',
    ITEM_CARTONS: itemsTableRows[0]?.ITEM_CARTONS || fmtNumber(totalCartons),
    ITEM_NW: itemsTableRows[0]?.ITEM_NW || fmtNumber(totalNw),
    ITEM_GW: itemsTableRows[0]?.ITEM_GW || fmtNumber(totalGw),
    PACKING: itemsTableRows[0]?.PACKING || 'Export Standard Cartons',
    QTY_KGS: itemsTableRows[0]?.QTY_KGS || fmtNumber(totalNw),
    AMOUNT: itemsTableRows[0]?.AMOUNT || fmtUSD(itemAllocationTarget),
  };

  // Also map across all source tables from template_placeholders
  const tableSources: Record<string, Array<Record<string, unknown> | undefined>> = {
    order_master: [order as unknown as Record<string, unknown>, inq as unknown as Record<string, unknown>, prop as unknown as Record<string, unknown>],
    inquiry_quotation: [inq as unknown as Record<string, unknown>, order as unknown as Record<string, unknown>],
    pricing_proposal: [prop as unknown as Record<string, unknown>, extraMeta as unknown as Record<string, unknown>],
    consignee_directory: [cus as unknown as Record<string, unknown>, inq as unknown as Record<string, unknown>],
    product_catalog: [firstProd as unknown as Record<string, unknown>],
    shipping_schedule: [sch as unknown as Record<string, unknown>],
    incoterms_handbook: [hbInc as unknown as Record<string, unknown>],
    sys_users: [matchedUser as unknown as Record<string, unknown>, currentUser as unknown as Record<string, unknown>],
  };

  const resolveFromDbRule = (tp: TemplatePlaceholder): string => {
    const keyUpper = tp.placeholder_key.trim().toUpperCase();
    if (baseValues[keyUpper] !== undefined && baseValues[keyUpper] !== '') {
      return baseValues[keyUpper];
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
        const rawVal = rec[col] ?? rec[col.toLowerCase()];
        if (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '') {
          if (typeof rawVal === 'number') {
            if (col.includes('value') || col.includes('price') || col.includes('cost')) {
              return formatCurrency(rawVal);
            }
            return fmtNumber(rawVal);
          }
          return normalizePlainText(rawVal);
        }
      }
    }

    if (tbl === 'system_lookups' && col) {
      const lk = lookups.find(
        (l) => l.code.toLowerCase() === col.toLowerCase() || l.category.toLowerCase() === col.toLowerCase()
      );
      if (lk?.contract_text_eng) return lk.contract_text_eng;
      if (lk?.display_name_vie) return lk.display_name_vie;
    }

    if (tbl === 'pricing_rates' && col) {
      const pr = pricingRates.find((r) => r.fee_code.toLowerCase() === col.toLowerCase());
      if (pr?.contract_text_eng) return pr.contract_text_eng;
      if (pr?.standard_rate) return formatCurrency(pr.standard_rate);
    }

    if ((tbl === 'computed' || tbl === 'default' || tbl === 'constant' || tbl === 'manual') && col && col.toUpperCase() !== 'TBA') {
      return col;
    }

    return '';
  };

  const fields: Record<string, string> = { ...baseValues };
  const tpByKey = new Map<string, TemplatePlaceholder>();
  templatePlaceholders.forEach((tp) => {
    const k = tp.placeholder_key.trim();
    if (!k) return;
    tpByKey.set(k.toUpperCase(), tp);
    const val = baseValues[k.toUpperCase()] ?? resolveFromDbRule(tp);
    fields[k] = val;
    fields[k.toUpperCase()] = val;
  });

  detectedKeys.forEach((key) => {
    const upper = key.toUpperCase();
    if (fields[key] === undefined) {
      fields[key] = baseValues[upper] ?? '';
    }
  });

  const descriptorMap = new Map<string, TemplateFieldDescriptor>();
  const targetKeys = detectedKeys.length > 0 ? detectedKeys : templatePlaceholders.map((t) => t.placeholder_key.trim()).filter(Boolean);

  targetKeys.forEach((key) => {
    const upper = key.toUpperCase();
    if (itemsTableRows.length > 1 && LOOP_ITEM_KEYS.has(upper)) {
      // Multi-line table items are driven dynamically by itemsTableRows; keep scalar header/totals editable
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
  };
}

export async function renderPopulatedDocxBytes(
  templateBuffer: ArrayBuffer,
  fieldValues: Record<string, string>,
  itemsTableRows?: Array<Record<string, string>>
): Promise<Uint8Array> {
  const zip = new PizZip(templateBuffer.slice(0));
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' },
    nullGetter: (part: { value?: string }) => {
      const k = String(part?.value || '').trim();
      return fieldValues[k] ?? fieldValues[k.toUpperCase()] ?? '';
    },
  });

  const rows = itemsTableRows || [];
  doc.render({
    ...fieldValues,
    ITEMS: rows,
    ORDER_ITEMS: rows,
    GOODS: rows,
    LINES: rows,
    PRODUCTS: rows,
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
}

export async function extractDocxParagraphBlocks(buffer: ArrayBuffer): Promise<DocxParagraphBlock[]> {
  const zip = await JSZip.loadAsync(buffer);
  const xmlFiles = Object.keys(zip.files).filter(
    (name) => /^word\/(document|header\d+|footer\d+)\.xml$/i.test(name)
  );
  const parser = new DOMParser();
  const blocks: DocxParagraphBlock[] = [];

  for (const xmlFile of xmlFiles) {
    const xmlStr = await zip.files[xmlFile].async('string');
    const xmlDoc = parser.parseFromString(xmlStr, 'application/xml');
    const paragraphs = Array.from(xmlDoc.getElementsByTagName('w:p'));
    paragraphs.forEach((p, idx) => {
      const tNodes = Array.from(p.getElementsByTagName('w:t'));
      const text = tNodes.map((n) => n.textContent || '').join('').trim();
      if (text) {
        blocks.push({
          id: `${xmlFile}::${idx}`,
          xmlFile,
          indexInFile: idx,
          text,
        });
      }
    });
  }

  return blocks;
}

export async function applyAiTagsToDocx(
  buffer: ArrayBuffer,
  replacements: Array<{ blockId: string; taggedText: string }>
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(buffer);
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
    const fileEntry = zip.files[xmlFile];
    if (!fileEntry) continue;
    const xmlStr = await fileEntry.async('string');
    const xmlDoc = parser.parseFromString(xmlStr, 'application/xml');
    const paragraphs = Array.from(xmlDoc.getElementsByTagName('w:p'));

    items.forEach(({ indexInFile, taggedText }) => {
      const p = paragraphs[indexInFile];
      if (!p) return;
      const tNodes = Array.from(p.getElementsByTagName('w:t'));
      if (tNodes.length === 0) return;
      tNodes[0].setAttribute('xml:space', 'preserve');
      tNodes[0].textContent = taggedText;
      for (let i = 1; i < tNodes.length; i++) {
        tNodes[i].textContent = '';
      }
    });

    zip.file(xmlFile, serializer.serializeToString(xmlDoc));
  }

  return zip.generateAsync({
    type: 'uint8array',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
