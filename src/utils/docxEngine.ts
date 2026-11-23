import JSZip from 'jszip';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import mammoth from 'mammoth';
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
  ShippingSchedule,
  SystemLookup,
  TemplateManager,
  TemplatePlaceholder,
} from '../types';
import {
  buildCombinedInsuranceClauseEng,
  cleanQuoteNoForCustomer,
  computeOrderPalletSummary,
  computeSilentFobUnitPrices,
  fmtNumber,
  fmtUSD,
  formatCurrency,
  normalizePlainText,
  parseInsuranceCodeString,
  parseOrderItems,
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

export function selectMatchingTemplates(
  templates: TemplateManager[],
  kind: DocumentKind,
  items: OrderItem[],
  products: ProductCatalog[]
): TemplateManager[] {
  const docxTemplates = templates.filter((t) => {
    const status = String(t.status || 'Active').toLowerCase();
    if (status.includes('inactive') || status.includes('khóa') || status.includes('disabled')) return false;
    const path = String(t.google_doc_file_id || '').trim().toLowerCase();
    return path.endsWith('.docx') || path.includes('templates/');
  });

  const keywordsByKind: Record<DocumentKind, string[]> = {
    CONTRACT: ['contract', 'sc', 'hd', 'hợp đồng', 'hop_dong', 'sales_contract'],
    QUOTATION: ['quotation', 'quote', 'qt', 'báo giá', 'bao_gia', 'rfq'],
    INVOICE: ['invoice', 'ci', 'inv', 'hóa đơn'],
    PACKING_LIST: ['packing', 'pl', 'phiếu đóng gói'],
    CO: ['co', 'c/o', 'origin', 'xuất xứ'],
    BL: ['bl', 'b/l', 'bill', 'vận đơn'],
  };

  const productGroups = items
    .map((it) => products.find((p) => p.sku_code.toLowerCase() === it.sku.toLowerCase())?.product_group || '')
    .join(' ')
    .toLowerCase();

  const scoreTemplate = (tpl: TemplateManager): number => {
    const text = `${tpl.template_id} ${tpl.document_name} ${tpl.google_doc_file_id}`.toLowerCase();
    let score = 0;
    const kws = keywordsByKind[kind] || [];
    if (kws.some((k) => text.includes(k))) score += 10;
    if (productGroups.includes('hạt') || productGroups.includes('nut') || productGroups.includes('điều')) {
      if (text.includes('nut') || text.includes('edible')) score += 5;
    }
    if (productGroups.includes('gia vị') || productGroups.includes('spice') || productGroups.includes('tiêu') || productGroups.includes('quế')) {
      if (text.includes('spice')) score += 5;
    }
    if (productGroups.includes('trái') || productGroups.includes('tươi') || productGroups.includes('fruit') || productGroups.includes('lạnh')) {
      if (text.includes('fruit') || text.includes('fresh') || text.includes('reefer')) score += 5;
    }
    return score;
  };

  return docxTemplates
    .map((t) => ({ t, score: scoreTemplate(t) }))
    .filter((x) => x.score > 0 || docxTemplates.length > 0)
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
    // Strip XML tags so split Word runs like <w:t>{{CNE_</w:t><w:t>NAME}}</w:t> are reassembled
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
  source: string;
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
  templatePlaceholders: TemplatePlaceholder[];
  overrideIncoterm?: string;
  overrideSellingPrice?: number;
}

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
  const pod = order?.pod || sch?.pod || 'Destination Port';
  const originIncotermCodes = ['EXW', 'FCA', 'FAS', 'FOB'];
  const incotermPlace = originIncotermCodes.includes(incoterm) ? pol : pod;

  const allocated = computeSilentFobUnitPrices(items, totalSelling, products, pricingRates);
  const pool = computeOrderPalletSummary(items, Boolean(extraMeta?.use_pallet), pricingRates);
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

  const freightValue = toNum(prop?.total_freight_local);
  const freightStr =
    originIncotermCodes.includes(incoterm)
      ? 'Freight Collect'
      : freightValue > 0
      ? `Freight Prepaid (${fmtUSD(freightValue)})`
      : 'Freight Prepaid';

  const payTerm = order?.payment_terms || inq?.proposed_payment_term || cus?.default_payment_term || 'T/T 30/70';
  const coForm = order?.co_form || suggestCoFormCode(pod, cus?.country);
  const quoteNo = cleanQuoteNoForCustomer(extraMeta?.quotation_no || '', inq?.order_id || order?.order_id);
  const totalNw = toNum(order?.nw_confirmed_kgs) || toNum(inq?.net_weight_kgs) || pool.cargoNetKg;
  const totalGw = toNum(prop?.total_gross_weight) || pool.totalGrossWeightKg || totalNw;
  const totalCartons = toNum(prop?.total_cartons) || pool.totalCartons;
  const totalPallets = toNum(prop?.total_pallets) || pool.totalPallets;
  const totalCbm = toNum(prop?.total_cbm) || pool.totalCbm;
  const totAmtWords = numberToEnglishWordsUsd(totalSelling);
  const vesVoy = meta?.ves_voy || (sch?.vessel ? `${sch.vessel}${sch.voyage ? ' / ' + sch.voyage : ''}` : '') || 'TBA';
  const bkNo = meta?.bk_no || meta?.carrier_bk_no || meta?.fwd_bk_no || 'TBA';
  const contSeal = meta?.cont_seal_list || 'TBA';
  const prodNamesEng = allocated.map((a) => `${a.item.name_eng || a.item.name} (${fmtNumber(a.item.weight)} KG)`).join('; ');
  const prodNamesVie = items.map((it) => `${it.name} (${fmtNumber(it.weight)} KG)`).join('; ');
  const avgUnitPrice = totalNw > 0 ? totalSelling / totalNw : toNum(firstProd?.unit_price);

  const itemsTableRows = allocated.map((row, idx) => ({
    NO: String(idx + 1),
    SKU: row.item.sku,
    PROD_NAME_ENG: row.item.name_eng || row.item.name,
    PROD_NAME_VIE: row.item.name,
    PACKING: row.item.packingName || row.item.packingCode,
    QTY_KGS: fmtNumber(row.item.weight),
    CARTONS: fmtNumber(row.item.cartons),
    UNIT_PRICE: fmtUSD(row.unitPricePerKg),
    AMOUNT: fmtUSD(row.lineTotalUsd),
  }));

  const lookupPay = lookups.find(
    (l) => l.code.toLowerCase() === payTerm.toLowerCase() || l.display_name_vie.toLowerCase() === payTerm.toLowerCase()
  );

  // Base semantic dictionary covering standard & common agricultural export template placeholders
  const baseValues: Record<string, string> = {
    ORD_ID: order?.order_id || inq?.order_id || '',
    ORDER_ID: order?.order_id || inq?.order_id || '',
    CTR_NO: order?.contract_no || `SC-${new Date().getFullYear()}/GAE`,
    CONTRACT_NO: order?.contract_no || `SC-${new Date().getFullYear()}/GAE`,
    CTR_DATE: order?.contract_date || todayIsoDate(),
    CONTRACT_DATE: order?.contract_date || todayIsoDate(),
    DOC_DATE: todayIsoDate(),
    QT_NO: quoteNo,
    QUOTE_NO: quoteNo,
    QT_DATE: todayIsoDate(),
    INV_NO: `CI-${(order?.contract_no || order?.order_id || '001').replace(/[^A-Za-z0-9-]/g, '')}`,
    PL_NO: `PL-${(order?.contract_no || order?.order_id || '001').replace(/[^A-Za-z0-9-]/g, '')}`,
    CTR_VAL: formatCurrency(totalSelling),
    CONTRACT_VALUE: formatCurrency(totalSelling),
    TOT_AMT: fmtUSD(totalSelling),
    TOTAL_AMOUNT: fmtUSD(totalSelling),
    TOT_AMT_WORDS: totAmtWords,
    AMOUNT_IN_WORDS: totAmtWords,
    INCOTERM: incoterm,
    APPLIED_INCOTERM: incoterm,
    INCOTERM_PLACE: incotermPlace,
    PAY_TERM: lookupPay?.contract_text_eng || payTerm,
    PAYMENT_TERMS: lookupPay?.contract_text_eng || payTerm,
    POL: pol,
    POD: pod,
    CO_FORM: coForm,
    INS_TERM: insTerm,
    INSURANCE_TERM: insTerm,
    INS_COST: fmtUSD(toNum(prop?.insurance_cost)),
    FREIGHT: freightStr,
    FREIGHT_TERM: freightStr,
    TBA: 'TBA',
    CNE_ID: cus?.consignee_id || order?.consignee_id || inq?.consignee_id || '',
    CNE_NAME: cus?.consignee_name || order?.consignee_id || inq?.consignee_id || '',
    BUYER_NAME: cus?.consignee_name || order?.consignee_id || inq?.consignee_id || '',
    CNE_ADDR: cus?.address || inq?.address || '',
    BUYER_ADDR: cus?.address || inq?.address || '',
    CNE_COUNTRY: cus?.country || '',
    CNE_TAX: normalizePlainText(cus?.tax) || 'N/A',
    BUYER_TAX: normalizePlainText(cus?.tax) || 'N/A',
    CNE_CONTACT: cus?.contact_person || inq?.contact || '',
    CNE_PHONE: normalizePlainText(cus?.phone || inq?.phone) || '',
    CNE_EMAIL: cus?.email || inq?.email || '',
    CNE_FAX: normalizePlainText(cus?.fax) || 'N/A',
    SELLER_NAME: SELLER_CONSTANTS.name,
    SELLER_ADDR: SELLER_CONSTANTS.address,
    SELLER_TAX: SELLER_CONSTANTS.taxId,
    SELLER_TEL: SELLER_CONSTANTS.tel,
    SELLER_EMAIL: SELLER_CONSTANTS.email,
    SELLER_BANK: SELLER_CONSTANTS.bank,
    BANK_INFO: SELLER_CONSTANTS.bank,
    SKU: order?.sku_code || inq?.sku_code || firstProd?.sku_code || '',
    PROD_NAME_ENG: prodNamesEng || firstProd?.product_name_eng || '',
    PROD_NAME_VIE: prodNamesVie || firstProd?.product_name_vie || inq?.product_name_vie || '',
    PRODUCT_DESC: prodNamesEng || firstProd?.product_name_eng || '',
    HS_CODE: normalizePlainText(firstProd?.hs_code) || '0810.90',
    STORAGE_TEMP: firstProd?.storage_temperature || 'Ambient / Dry',
    UNIT_PRICE: avgUnitPrice > 0 ? avgUnitPrice.toFixed(3) : '0.000',
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
    PACKING_DESC: items.map((it) => `${it.name_eng || it.name}: ${it.packingName}`).join('; ') || 'Export Standard Cartons',
    CONT_TYPE: prop?.container_type || firstProd?.container_type || "20'DC",
    CONT_QTY: String(toNum(prop?.container_qty) || 1),
    BK_NO: bkNo,
    VES_VOY: vesVoy,
    CONT_SEAL: contSeal,
    BL_TYPE: meta?.bl_type || 'ORIGINAL',
    ETD: sch?.etd || inq?.desired_delivery_date || 'TBA',
    ETA: sch?.eta || 'TBA',
    DELIVERY_DATE: inq?.desired_delivery_date || sch?.etd || 'TBA',
    SHIPPING_LINE: sch?.shipping_line || meta?.fwd_name || 'TBA',
    STAFF_NAME: order?.in_charge_staff || prop?.xnk_rep || inq?.sale_rep || 'Export Dept.',
    ITEMS_LIST: allocated
      .map(
        (a, idx) =>
          `${idx + 1}. ${a.item.name_eng || a.item.name} — ${fmtNumber(a.item.weight)} KGS (${fmtNumber(a.item.cartons)} CTNS) @ ${fmtUSD(a.unitPricePerKg)}/KG = ${fmtUSD(a.lineTotalUsd)}`
      )
      .join('\n'),
  };

  // Resolve values dynamically from template_placeholders table definitions (source_table + source_column)
  const tableSources: Record<string, Record<string, unknown> | undefined> = {
    order_master: order as unknown as Record<string, unknown>,
    consignee_directory: cus as unknown as Record<string, unknown>,
    product_catalog: firstProd as unknown as Record<string, unknown>,
    pricing_proposal: prop as unknown as Record<string, unknown>,
    inquiry_quotation: inq as unknown as Record<string, unknown>,
    shipping_schedule: sch as unknown as Record<string, unknown>,
  };

  const resolveFromDbRule = (tp: TemplatePlaceholder): string => {
    const keyUpper = tp.placeholder_key.trim().toUpperCase();
    const tbl = String(tp.source_table || '').trim().toLowerCase();
    const col = String(tp.source_column || '').trim();
    const colUpper = col.toUpperCase();

    if (colUpper === 'TOT_AMT_WORDS') return totAmtWords;
    if (colUpper === 'INCOTERM_PLACE') return incotermPlace;
    if (colUpper === 'INS_TERM') return insTerm;
    if (colUpper === 'FREIGHT') return freightStr;
    if (colUpper === 'TBA') return baseValues[keyUpper] || 'TBA';

    if (tbl && tableSources[tbl] && col) {
      const rec = tableSources[tbl];
      const rawVal = rec?.[col] ?? rec?.[col.toLowerCase()];
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

    if (baseValues[keyUpper] !== undefined && baseValues[keyUpper] !== '') {
      return baseValues[keyUpper];
    }

    if (tbl === 'computed' || tbl === 'default' || tbl === 'constant' || tbl === 'manual') {
      return col || 'TBA';
    }

    return col && !col.includes('_') ? col : 'TBA';
  };

  const fields: Record<string, string> = { ...baseValues };
  const descriptorMap = new Map<string, TemplateFieldDescriptor>();

  templatePlaceholders.forEach((tp) => {
    const key = tp.placeholder_key.trim();
    if (!key) return;
    const val = baseValues[key.toUpperCase()] || resolveFromDbRule(tp);
    fields[key] = val;
    if (detectedKeys.length === 0 || detectedKeys.includes(key)) {
      descriptorMap.set(key, {
        key,
        description: tp.description_vie || key,
        source: `${tp.source_table || 'auto'}.${tp.source_column || '-'}`,
        value: val,
      });
    }
  });

  // Guarantee EVERY detected {{KEY}} in the .docx template is populated so ZERO raw {{...}} tags remain
  detectedKeys.forEach((key) => {
    if (fields[key] === undefined || fields[key] === '') {
      const upper = key.toUpperCase();
      fields[key] = baseValues[upper] || 'TBA';
    }
    if (!descriptorMap.has(key)) {
      descriptorMap.set(key, {
        key,
        description: key.replace(/_/g, ' '),
        source: 'Tự động khớp hệ thống',
        value: fields[key],
      });
    }
  });

  // Prioritize detected keys first in UI descriptors, followed by key summary fields
  const orderedDescriptors: TemplateFieldDescriptor[] = [];
  const used = new Set<string>();
  detectedKeys.forEach((k) => {
    const d = descriptorMap.get(k);
    if (d && !used.has(k)) {
      orderedDescriptors.push(d);
      used.add(k);
    }
  });
  descriptorMap.forEach((d, k) => {
    if (!used.has(k)) orderedDescriptors.push(d);
  });

  return {
    fields,
    descriptors: orderedDescriptors,
    itemsTableRows,
  };
}

export async function renderDocxAndPreviewHtml(
  templateBuffer: ArrayBuffer,
  fieldValues: Record<string, string>,
  itemsTableRows?: Array<Record<string, string>>
): Promise<{ docxBytes: Uint8Array; previewHtml: string }> {
  const zip = new PizZip(templateBuffer.slice(0));
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' },
    nullGetter: (part: { value?: string }) => {
      const k = String(part?.value || '').trim();
      return fieldValues[k] ?? fieldValues[k.toUpperCase()] ?? 'TBA';
    },
  });

  doc.render({
    ...fieldValues,
    ITEMS: itemsTableRows || [],
  });

  const outBytes: Uint8Array = doc.getZip().generate({
    type: 'uint8array',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

  const ab = outBytes.buffer.slice(outBytes.byteOffset, outBytes.byteOffset + outBytes.byteLength) as ArrayBuffer;
  const mammothRes = await mammoth.convertToHtml({ arrayBuffer: ab });
  const previewHtml = wrapMammothPreviewHtml(mammothRes.value);

  return { docxBytes: outBytes, previewHtml };
}

export function wrapMammothPreviewHtml(innerHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<style>
  body {
    font-family: 'Be Vietnam Pro', 'Times New Roman', Arial, sans-serif;
    color: #0f172a;
    margin: 0;
    padding: 32px 38px;
    background: #ffffff;
    font-size: 13px;
    line-height: 1.55;
  }
  h1, h2, h3, h4 { color: #0f4a33; margin: 12px 0 6px; }
  p { margin: 5px 0; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; }
  th, td { border: 1px solid #94a3b8; padding: 6px 8px; vertical-align: top; font-size: 12px; }
  th { background: #ecfdf5; color: #0f4a33; font-weight: 700; }
  img { max-width: 140px; height: auto; }
  @media print { body { padding: 12px; } }
</style>
</head>
<body>${innerHtml}</body>
</html>`;
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
      // Preserve first run formatting (<w:rPr>) and place full tagged text inside first <w:t>
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

export function buildHtmlDocxFallback(title: string, htmlBody: string): string {
  const stripped = htmlBody
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title></head><body>${stripped}</body></html>`;
}
