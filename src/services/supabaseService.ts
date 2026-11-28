import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type {
  AppDataState,
  ConsigneeDirectory,
  InquiryQuotation,
  OrderLogisticsMeta,
  OrderMaster,
  PricingProposal,
  PricingRate,
  ProductCatalog,
  ProposalExtraMeta,
  ShippingSchedule,
  SysUser,
  TemplateManager,
  TemplatePlaceholder,
} from '../types';
import {
  classifyCustomerByCount,
  cleanQuoteNoForCustomer,
  COMPLETED_ORDER_STATUS,
  isQuickCaptureStatus,
  normalizePlainText,
  parseLocaleNumber,
  slugifyShippingLine,
  suggestCoFormCode,
  todayIsoDate,
  toNum,
  WORKFLOW_6_STAGES,
  WORKFLOW_STATUS,
} from '../utils/calculations';
import {
  extractWrappedPlaceholderKeys,
  formatPlaceholderListWrapped,
  getVietnamesePlaceholderLabel,
  normalizePlaceholderKey,
  type DocumentKind,
} from '../utils/docxEngine';

const ORDER_META_STORAGE_KEY = 'NSX_ORDER_LOGISTICS_META_V1';
const PROPOSAL_META_STORAGE_KEY = 'NSX_PROPOSAL_EXTRA_META_V1';
const CONSIGNEE_EXTRA_META_KEY = 'NSX_CONSIGNEE_EXTRA_META_V1';
const INQUIRY_EXTRA_META_KEY = 'NSX_INQUIRY_EXTRA_META_V1';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

interface ConsigneeExtraMeta {
  default_pod?: string;
  warehouse_address?: string;
}

interface InquiryExtraMeta {
  pod?: string;
  warehouse_address?: string;
}

function readLocalMetaMap<T>(key: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeLocalMetaMap<T>(key: string, map: Record<string, T>) {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {}
}

function saveConsigneeExtraMeta(consigneeId: string, patch: ConsigneeExtraMeta) {
  if (!consigneeId) return;
  const map = readLocalMetaMap<ConsigneeExtraMeta>(CONSIGNEE_EXTRA_META_KEY);
  const prev = map[consigneeId] || {};
  map[consigneeId] = {
    default_pod: patch.default_pod !== undefined ? patch.default_pod : prev.default_pod,
    warehouse_address: patch.warehouse_address !== undefined ? patch.warehouse_address : prev.warehouse_address,
  };
  writeLocalMetaMap(CONSIGNEE_EXTRA_META_KEY, map);
}

function saveInquiryExtraMeta(orderId: string, patch: InquiryExtraMeta) {
  if (!orderId) return;
  const map = readLocalMetaMap<InquiryExtraMeta>(INQUIRY_EXTRA_META_KEY);
  const prev = map[orderId] || {};
  map[orderId] = {
    pod: patch.pod !== undefined ? patch.pod : prev.pod,
    warehouse_address: patch.warehouse_address !== undefined ? patch.warehouse_address : prev.warehouse_address,
  };
  writeLocalMetaMap(INQUIRY_EXTRA_META_KEY, map);
}

function removeInquiryExtraMeta(orderId: string) {
  if (!orderId) return;
  const map = readLocalMetaMap<InquiryExtraMeta>(INQUIRY_EXTRA_META_KEY);
  if (orderId in map) {
    delete map[orderId];
    writeLocalMetaMap(INQUIRY_EXTRA_META_KEY, map);
  }
}

export function readOrderLogisticsMetaMap(): Record<string, OrderLogisticsMeta> {
  try {
    const raw = localStorage.getItem(ORDER_META_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveOrderLogisticsMeta(orderId: string, patch: Partial<OrderLogisticsMeta>): OrderLogisticsMeta {
  const map = readOrderLogisticsMetaMap();
  const prev = map[orderId] || { order_id: orderId };
  const next: OrderLogisticsMeta = { ...prev, ...patch, order_id: orderId };
  map[orderId] = next;
  try {
    localStorage.setItem(ORDER_META_STORAGE_KEY, JSON.stringify(map));
  } catch {}
  return next;
}

export function readProposalExtraMetaMap(): Record<string, ProposalExtraMeta> {
  try {
    const raw = localStorage.getItem(PROPOSAL_META_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveProposalExtraMeta(orderId: string, meta: ProposalExtraMeta) {
  const map = readProposalExtraMetaMap();
  const prev = map[orderId];
  const immutableQuoteNo = cleanQuoteNoForCustomer(prev?.quotation_no || meta.quotation_no || '', orderId);
  map[orderId] = {
    ...prev,
    ...meta,
    order_id: orderId,
    quotation_no: immutableQuoteNo,
    send_count: meta.send_count !== undefined ? meta.send_count : prev?.send_count,
    last_sent_at: meta.last_sent_at !== undefined ? meta.last_sent_at : prev?.last_sent_at,
  };
  try {
    localStorage.setItem(PROPOSAL_META_STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

export function incrementQuotationSendCount(orderId: string, hasPriorSentLink = false): number {
  const map = readProposalExtraMetaMap();
  const prev = map[orderId];
  const baseCount =
    typeof prev?.send_count === 'number' && prev.send_count > 0
      ? prev.send_count
      : hasPriorSentLink
      ? 1
      : 0;
  const nextCount = baseCount + 1;
  const immutableQuoteNo = cleanQuoteNoForCustomer(prev?.quotation_no || '', orderId);
  map[orderId] = {
    ...(prev || {}),
    order_id: orderId,
    quotation_no: immutableQuoteNo,
    floor_price_usd: prev?.floor_price_usd || 0,
    min_margin_pct: prev?.min_margin_pct || 0,
    margin_pct: prev?.margin_pct || 0,
    exw_price: prev?.exw_price || 0,
    fob_price: prev?.fob_price || 0,
    cfr_price: prev?.cfr_price || 0,
    cif_price: prev?.cif_price || 0,
    send_count: nextCount,
    last_sent_at: new Date().toISOString(),
  };
  try {
    localStorage.setItem(PROPOSAL_META_STORAGE_KEY, JSON.stringify(map));
  } catch {}
  return nextCount;
}

function assertConfigured() {
  if (!isSupabaseConfigured) {
    throw new Error('Chưa cấu hình VITE_SUPABASE_URL hoặc VITE_SUPABASE_ANON_KEY.');
  }
}

async function fetchTemplatePlaceholdersSafe(): Promise<TemplatePlaceholder[]> {
  const withAuto = await supabase
    .from('template_placeholders')
    .select('placeholder_key, scope, source_table, source_column, description_vie, is_auto_created')
    .order('placeholder_key', { ascending: true });

  if (!withAuto.error) {
    return (withAuto.data || []).map((row: any) => ({
      ...row,
      placeholder_key: String(row.placeholder_key || '').trim().replace(/^\{+|\}+$/g, '').trim(),
    })) as TemplatePlaceholder[];
  }

  const fallback = await supabase
    .from('template_placeholders')
    .select('placeholder_key, scope, source_table, source_column, description_vie')
    .order('placeholder_key', { ascending: true });

  if (fallback.error) {
    return [];
  }
  return (fallback.data || []).map((row: any) => ({
    ...row,
    placeholder_key: String(row.placeholder_key || '').trim().replace(/^\{+|\}+$/g, '').trim(),
  })) as TemplatePlaceholder[];
}

export async function fetchAllAppData(): Promise<AppDataState> {
  assertConfigured();
  const [
    usersRes,
    consigneesRes,
    productsRes,
    ratesRes,
    schedulesRes,
    incotermsRes,
    lookupsRes,
    templatesRes,
    templatePlaceholdersList,
    inquiriesRes,
    proposalsRes,
    ordersRes,
  ] = await Promise.all([
    supabase.from('sys_users').select('id, employee_id, full_name, department, role, email, status'),
    supabase.from('consignee_directory').select('*'),
    supabase.from('product_catalog').select('product_group, sku_code, product_name_vie, product_name_eng, unit_price, hs_code, container_type, storage_temperature, image_url').order('sku_code', { ascending: true }),
    supabase.from('pricing_rates').select('*'),
    supabase.from('shipping_schedule').select('*'),
    supabase.from('incoterms_handbook').select('incoterms_code, incoterm_group, full_name, transport_mode, contract_text_eng, freight_term, freight_payer, insurance_payer, export_customs, import_customs, risk_transfer_point, activation_condition, risk_benefit_seller, note, practical_notes_vie, seller_cost_scope').order('incoterms_code', { ascending: true }),
    supabase.from('system_lookups').select('category, code, scope, display_name_vie, contract_text_eng, extra_value'),
    supabase.from('template_manager').select('template_id, document_name, google_doc_file_id, target_department, status, supported_placeholders'),
    fetchTemplatePlaceholdersSafe(),
    supabase.from('inquiry_quotation').select('*'),
    supabase.from('pricing_proposal').select('order_id, xnk_rep, schedule_id, container_type, container_qty, total_freight_local, insurance_cost, goods_cost, recommended_incoterm, final_selling_price, booking_date, booking_status, packing_pallet_cost, insurance_code, total_cartons, total_pallets, pallet_fee, total_gross_weight, total_cbm, proposed_incoterms'),
    supabase.from('order_master').select('order_id, contract_no, contract_date, in_charge_staff, consignee_id, sku_code, nw_confirmed_kgs, applied_incoterm, contract_value, payment_terms, pol, pod, fulfillment_status, co_form, contract_link'),
  ]);

  const errors = [
    usersRes.error,
    consigneesRes.error,
    productsRes.error,
    ratesRes.error,
    schedulesRes.error,
    incotermsRes.error,
    lookupsRes.error,
    templatesRes.error,
    inquiriesRes.error,
    proposalsRes.error,
    ordersRes.error,
  ].filter(Boolean);

  if (errors.length > 0) {
    throw new Error(errors[0]?.message || 'Lỗi tải dữ liệu từ Supabase.');
  }

  const consigneeExtraMap = readLocalMetaMap<ConsigneeExtraMeta>(CONSIGNEE_EXTRA_META_KEY);
  const inquiryExtraMap = readLocalMetaMap<InquiryExtraMeta>(INQUIRY_EXTRA_META_KEY);

  const normalizedConsignees = (consigneesRes.data || []).map((c: any) => {
    const extra = consigneeExtraMap[c.consignee_id] || {};
    return {
      ...c,
      order_count: Math.max(0, Math.floor(parseLocaleNumber(c.order_count))),
      default_pod: String(c.default_pod ?? c.pod ?? extra.default_pod ?? '').trim(),
      warehouse_address: String(c.warehouse_address ?? extra.warehouse_address ?? '').trim(),
    };
  }) as ConsigneeDirectory[];

  const normalizedProducts = (productsRes.data || []).map((p: any) => ({
    ...p,
    unit_price: parseLocaleNumber(p.unit_price),
  })) as ProductCatalog[];

  const normalizedRates = (ratesRes.data || []).map((r: any) => ({
    ...r,
    scope_or_cont_type: r.scope_or_cont_type ?? r.scope_or_conttype ?? '',
    standard_rate: parseLocaleNumber(r.standard_rate),
    net_kg: parseLocaleNumber(r.net_kg),
    tare_kg: parseLocaleNumber(r.tare_kg),
    max_per_pallet: parseLocaleNumber(r.max_per_pallet),
  })) as PricingRate[];

  const normalizedSchedules = (schedulesRes.data || []).map((s: any) => ({
    ...s,
    rate_20_dc: parseLocaleNumber(s.rate_20_dc),
    rate_40_dc: parseLocaleNumber(s.rate_40_dc),
    rate_40_hc: parseLocaleNumber(s.rate_40_hc),
    rate_20_rf: parseLocaleNumber(s.rate_20_rf),
    rate_40_rf: parseLocaleNumber(s.rate_40_rf),
    rate_40_rh: parseLocaleNumber(s.rate_40_rh),
    baf_fee: parseLocaleNumber(s.baf_fee),
    lss_fee: parseLocaleNumber(s.lss_fee),
    pss_fee: parseLocaleNumber(s.pss_fee),
    b_l_fee: parseLocaleNumber(s.b_l_fee),
    seal_fee: parseLocaleNumber(s.seal_fee),
    thc_20_dry: parseLocaleNumber(s.thc_20_dry),
    thc_40_dry: parseLocaleNumber(s.thc_40_dry),
    thc_20_reefer: parseLocaleNumber(s.thc_20_reefer),
    thc_40_reefer: parseLocaleNumber(s.thc_40_reefer),
    bill_seal_fee_shipment: parseLocaleNumber(s.bill_seal_fee_shipment),
    logo_url: typeof s.logo_url === 'string' ? s.logo_url.trim() : '',
  })) as ShippingSchedule[];

  const normalizedInquiries = (inquiriesRes.data || []).map((i: any) => {
    const extra = inquiryExtraMap[i.order_id] || {};
    return {
      ...i,
      net_weight_kgs: parseLocaleNumber(i.net_weight_kgs),
      pod: String(i.pod ?? extra.pod ?? '').trim(),
      warehouse_address: String(i.warehouse_address ?? extra.warehouse_address ?? '').trim(),
    };
  }) as InquiryQuotation[];

  const normalizedProposals = (proposalsRes.data || []).map((p: any) => ({
    ...p,
    container_qty: parseLocaleNumber(p.container_qty),
    total_freight_local: parseLocaleNumber(p.total_freight_local),
    insurance_cost: parseLocaleNumber(p.insurance_cost),
    goods_cost: parseLocaleNumber(p.goods_cost),
    final_selling_price: parseLocaleNumber(p.final_selling_price),
    packing_pallet_cost: parseLocaleNumber(p.packing_pallet_cost),
    total_cartons: parseLocaleNumber(p.total_cartons),
    total_pallets: parseLocaleNumber(p.total_pallets),
    pallet_fee: parseLocaleNumber(p.pallet_fee),
    total_gross_weight: parseLocaleNumber(p.total_gross_weight),
    total_cbm: parseLocaleNumber(p.total_cbm),
  })) as PricingProposal[];

  const normalizedOrders = (ordersRes.data || []).map((o: any) => ({
    ...o,
    nw_confirmed_kgs: parseLocaleNumber(o.nw_confirmed_kgs),
    contract_value: parseLocaleNumber(o.contract_value),
  })) as OrderMaster[];

  return {
    users: (usersRes.data || []) as SysUser[],
    consignees: normalizedConsignees,
    products: normalizedProducts,
    pricingRates: normalizedRates,
    schedules: normalizedSchedules,
    incoterms: (incotermsRes.data || []) as AppDataState['incoterms'],
    lookups: (lookupsRes.data || []) as AppDataState['lookups'],
    templates: (templatesRes.data || []) as TemplateManager[],
    templatePlaceholders: templatePlaceholdersList,
    inquiries: normalizedInquiries,
    proposals: normalizedProposals,
    orders: normalizedOrders,
  };
}

// ==========================================
// SUPABASE STORAGE: PRIVATE "documents" BUCKET
// ==========================================
export async function downloadTemplateDocx(storagePath: string): Promise<ArrayBuffer> {
  assertConfigured();
  const clean = String(storagePath || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/^documents\//i, '')
    .replace(/^\/+/, '');
  if (!clean) throw new Error('Đường dẫn phôi mẫu trống.');

  const primary = await supabase.storage.from('documents').download(clean);
  if (!primary.error && primary.data) {
    return primary.data.arrayBuffer();
  }

  if (!clean.startsWith('templates/')) {
    const fallback = await supabase.storage.from('documents').download(`templates/${clean}`);
    if (!fallback.error && fallback.data) {
      return fallback.data.arrayBuffer();
    }
  }

  throw new Error(primary.error?.message || `Không thể tải phôi mẫu ${clean} từ Storage.`);
}

export async function uploadTemplateDocx(
  templateIdOrPath: string,
  data: Uint8Array | Blob | ArrayBuffer
): Promise<string> {
  assertConfigured();
  const raw = String(templateIdOrPath || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/^documents\//i, '')
    .replace(/^preview_templates\//i, 'templates/')
    .replace(/^templates\//i, '');
  const baseName = raw.replace(/\.docx$/i, '').replace(/[^a-zA-Z0-9._-]/g, '_') || `TMP_${Date.now()}`;
  const path = `templates/${baseName}.docx`;
  const part: ArrayBuffer =
    data instanceof Uint8Array
      ? (data.slice().buffer as ArrayBuffer)
      : (data as ArrayBuffer);
  const blob = data instanceof Blob ? data : new Blob([part], { type: DOCX_MIME });

  const { error } = await supabase.storage.from('documents').upload(path, blob, {
    upsert: true,
    contentType: DOCX_MIME,
  });
  if (error) throw new Error(`Lỗi tải phôi mẫu: ${error.message}`);
  return path;
}

export async function uploadGeneratedOrderDocx(
  orderId: string,
  kind: DocumentKind,
  fileName: string,
  data: Uint8Array | Blob | ArrayBuffer
): Promise<string> {
  assertConfigured();
  const cleanOrderId = String(orderId || 'MISC').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeFile = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const finalFile = safeFile.toLowerCase().endsWith('.docx') ? safeFile : `${safeFile}.docx`;
  const folder =
    kind === 'CONTRACT'
      ? 'contracts'
      : kind === 'QUOTATION'
      ? `quotations/${cleanOrderId}`
      : `orders/${cleanOrderId}`;
  const path = `${folder}/${finalFile}`;

  if (path.startsWith('templates/')) {
    throw new Error('Không được phép ghi đè thư mục phôi gốc templates/.');
  }

  const part: ArrayBuffer =
    data instanceof Uint8Array
      ? (data.slice().buffer as ArrayBuffer)
      : (data as ArrayBuffer);
  const blob = data instanceof Blob ? data : new Blob([part], { type: DOCX_MIME });
  const { error } = await supabase.storage.from('documents').upload(path, blob, {
    upsert: true,
    contentType: DOCX_MIME,
  });
  if (error) throw new Error(`Lỗi lưu chứng từ lên Storage: ${error.message}`);
  return path;
}

export async function getSignedDocumentUrl(storagePathOrUrl: string, expiresInSeconds = 3600): Promise<string> {
  assertConfigured();
  const raw = String(storagePathOrUrl || '').trim();
  if (!raw) throw new Error('Không có đường dẫn chứng từ.');
  if (/^https?:\/\//i.test(raw)) return raw;
  const clean = raw.replace(/^\/+/, '');
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(clean, expiresInSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'Không thể tạo liên kết tải chứng từ.');
  }
  return data.signedUrl;
}

export async function openDocumentWithSignedUrl(storagePathOrUrl: string, downloadFileName?: string): Promise<void> {
  const url = await getSignedDocumentUrl(storagePathOrUrl, 3600);
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  if (downloadFileName) a.download = downloadFileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function isStoredDocumentPath(val?: string): boolean {
  const s = String(val || '').trim();
  if (!s) return false;
  return /^https?:\/\//i.test(s) || /^(orders|quotations|contracts|templates)\//i.test(s) || /\.docx$/i.test(s);
}

export async function saveGeneratedDocumentRecord(
  orderId: string,
  kind: DocumentKind,
  storagePath: string,
  markQuotationSent = false
): Promise<void> {
  assertConfigured();
  if (kind === 'CONTRACT') {
    const { error } = await supabase
      .from('order_master')
      .update({ contract_link: storagePath })
      .eq('order_id', orderId);
    if (error) throw new Error(`Lỗi lưu đường dẫn Hợp đồng: ${error.message}`);
    return;
  }

  if (kind === 'QUOTATION') {
    const patch: Partial<InquiryQuotation> = { sent_mail_link: storagePath };
    if (markQuotationSent) {
      patch.inquiry_status = WORKFLOW_STATUS.SENT_WAITING_CUST;
    }
    const { error } = await supabase
      .from('inquiry_quotation')
      .update(patch)
      .eq('order_id', orderId);
    if (error) throw new Error(`Lỗi lưu đường dẫn Báo giá: ${error.message}`);
    return;
  }

  const metaPatch: Partial<OrderLogisticsMeta> = {};
  if (kind === 'INVOICE') metaPatch.invoice_link = storagePath;
  if (kind === 'PACKING_LIST') metaPatch.packing_list_link = storagePath;
  if (kind === 'CO') metaPatch.co_link = storagePath;
  if (kind === 'BL') metaPatch.bl_link = storagePath;
  saveOrderLogisticsMeta(orderId, metaPatch);
}

export async function upsertTemplatePlaceholders(rows: TemplatePlaceholder[]): Promise<void> {
  assertConfigured();
  if (!rows || rows.length === 0) return;

  const cleanRows = rows.map((r) => ({
    placeholder_key: String(r.placeholder_key || '').trim().replace(/^\{+|\}+$/g, '').toUpperCase(),
    scope: String(r.scope || 'ALL').trim(),
    source_table: String(r.source_table || 'computed').trim(),
    source_column: String(r.source_column || '').trim().toUpperCase() === 'TBA' ? '' : String(r.source_column || '').trim(),
    description_vie: String(r.description_vie || '').trim(),
    is_auto_created: r.is_auto_created ?? true,
  })).filter((r) => r.placeholder_key);

  if (cleanRows.length === 0) return;

  const res = await supabase
    .from('template_placeholders')
    .upsert(cleanRows, { onConflict: 'placeholder_key' });

  if (res.error) {
    // Fallback without is_auto_created if the column isn't defined
    const stripped = cleanRows.map(({ is_auto_created: _ignored, ...rest }) => rest);
    const fb = await supabase
      .from('template_placeholders')
      .upsert(stripped, { onConflict: 'placeholder_key' });
    if (fb.error) {
      throw new Error(`Lỗi lưu template_placeholders: ${fb.error.message}`);
    }
  }
}

export async function resolveOrUpsertConsigneeForInquiry(
  existingList: ConsigneeDirectory[],
  input: {
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
    default_pod?: string;
    warehouse_address?: string;
  },
  incrementOrderCount: boolean
): Promise<ConsigneeDirectory> {
  assertConfigured();
  const cleanTax = normalizePlainText(input.tax).toLowerCase();
  const cleanEmail = normalizePlainText(input.email).toLowerCase();
  const cleanName = normalizePlainText(input.consignee_name).toLowerCase();
  const cleanCid = normalizePlainText(input.consignee_id).toLowerCase();

  const existing = existingList.find((c) => {
    if (cleanCid && c.consignee_id.trim().toLowerCase() === cleanCid) return true;
    if (cleanTax && normalizePlainText(c.tax).toLowerCase() === cleanTax) return true;
    if (cleanEmail && normalizePlainText(c.email).toLowerCase() === cleanEmail) return true;
    if (cleanName && normalizePlainText(c.consignee_name).toLowerCase() === cleanName) return true;
    return false;
  });

  if (existing) {
    const baseline = Math.max(0, Math.floor(toNum(existing.order_count)));
    const nextCount = incrementOrderCount ? baseline + 1 : baseline;
    const basePayload = {
      consignee_id: existing.consignee_id,
      consignee_name: input.consignee_name || existing.consignee_name,
      country: input.country || existing.country,
      address: input.address || existing.address,
      tax: normalizePlainText(input.tax || existing.tax),
      contact_person: input.contact_person || existing.contact_person,
      phone: normalizePlainText(input.phone || existing.phone),
      email: input.email || existing.email,
      fax: normalizePlainText(input.fax || existing.fax),
      default_payment_term: input.default_payment_term || existing.default_payment_term,
      order_count: nextCount,
      customer_type: classifyCustomerByCount(nextCount),
      created_date: existing.created_date || todayIsoDate(),
    };
    const nextPod = (input.default_pod ?? '').trim() || existing.default_pod || '';
    const nextWh = (input.warehouse_address ?? '').trim() || existing.warehouse_address || '';
    saveConsigneeExtraMeta(existing.consignee_id, { default_pod: nextPod, warehouse_address: nextWh });

    const withExtra = { ...basePayload, default_pod: nextPod, warehouse_address: nextWh };
    const primary = await supabase
      .from('consignee_directory')
      .update(withExtra)
      .eq('consignee_id', existing.consignee_id);
    if (primary.error) {
      if (/(default_pod|warehouse_address|column|schema cache)/i.test(primary.error.message || '')) {
        const fb = await supabase
          .from('consignee_directory')
          .update(basePayload)
          .eq('consignee_id', existing.consignee_id);
        if (fb.error) throw new Error(`Lỗi cập nhật khách hàng: ${fb.error.message}`);
      } else {
        throw new Error(`Lỗi cập nhật khách hàng: ${primary.error.message}`);
      }
    }
    return { ...basePayload, default_pod: nextPod, warehouse_address: nextWh };
  }

  const maxIdx = existingList.reduce((max, c) => {
    const m = String(c.consignee_id || '').match(/CON-(\d+)/i);
    return m ? Math.max(max, parseInt(m[1], 10)) : max;
  }, 0);
  const newId = `CON-${String(maxIdx + 1).padStart(3, '0')}`;
  const initCount = incrementOrderCount ? 1 : 0;
  const baseRow = {
    consignee_id: newId,
    consignee_name: input.consignee_name,
    country: input.country,
    address: input.address,
    tax: normalizePlainText(input.tax),
    contact_person: input.contact_person,
    phone: normalizePlainText(input.phone),
    email: input.email,
    fax: normalizePlainText(input.fax),
    default_payment_term: input.default_payment_term,
    customer_type: classifyCustomerByCount(initCount),
    order_count: initCount,
    created_date: todayIsoDate(),
  };
  const nextPod = (input.default_pod ?? '').trim();
  const nextWh = (input.warehouse_address ?? '').trim();
  saveConsigneeExtraMeta(newId, { default_pod: nextPod, warehouse_address: nextWh });

  const withExtra = { ...baseRow, default_pod: nextPod, warehouse_address: nextWh };
  const primary = await supabase.from('consignee_directory').insert(withExtra);
  if (primary.error) {
    if (/(default_pod|warehouse_address|column|schema cache)/i.test(primary.error.message || '')) {
      const fb = await supabase.from('consignee_directory').insert(baseRow);
      if (fb.error) throw new Error(`Lỗi tạo khách hàng mới: ${fb.error.message}`);
    } else {
      throw new Error(`Lỗi tạo khách hàng mới: ${primary.error.message}`);
    }
  }
  return { ...baseRow, default_pod: nextPod, warehouse_address: nextWh };
}

export async function saveInquiryRecord(
  state: AppDataState,
  params: {
    existingOrderId?: string;
    sourceQuickLogId?: string;
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
      default_pod?: string;
      warehouse_address?: string;
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
    pod?: string;
    warehouse_address?: string;
  }
): Promise<InquiryQuotation> {
  assertConfigured();
  const existingInq = params.existingOrderId
    ? state.inquiries.find((i) => i.order_id === params.existingOrderId)
    : undefined;
  const sourceQuickInq = params.sourceQuickLogId
    ? state.inquiries.find((i) => i.order_id === params.sourceQuickLogId)
    : undefined;
  const isQuickCapture = isQuickCaptureStatus(params.inquiry_status);
  const wasQuickCapture = existingInq
    ? isQuickCaptureStatus(existingInq.inquiry_status)
    : Boolean(sourceQuickInq && isQuickCaptureStatus(sourceQuickInq.inquiry_status));
  const shouldIncrementOrderCount = !isQuickCapture && (!existingInq || wasQuickCapture);

  const resolvedPod = (params.pod ?? params.customerInput.default_pod ?? '').trim();
  const resolvedWarehouse = (params.warehouse_address ?? params.customerInput.warehouse_address ?? '').trim();

  const consignee = await resolveOrUpsertConsigneeForInquiry(
    state.consignees,
    {
      ...params.customerInput,
      default_pod: resolvedPod || params.customerInput.default_pod,
      warehouse_address: resolvedWarehouse || params.customerInput.warehouse_address,
    },
    shouldIncrementOrderCount
  );

  const now = new Date();
  const yyyy = String(now.getFullYear());

  let orderId = '';
  let isUpdateInPlace = false;
  let quickLogIdToRetire = '';

  if (isQuickCapture) {
    if (existingInq && /^INQ-/i.test(existingInq.order_id)) {
      orderId = existingInq.order_id;
      isUpdateInPlace = true;
    } else {
      const inqRegex = new RegExp(`^INQ-${yyyy}-(\\d+)$`, 'i');
      const maxInqSeq = state.inquiries.reduce((max, item) => {
        const m = String(item.order_id || '').match(inqRegex);
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 0);
      let nextSeq = maxInqSeq + 1;
      orderId = `INQ-${yyyy}-${String(nextSeq).padStart(3, '0')}`;
      while (state.inquiries.some((i) => i.order_id === orderId)) {
        nextSeq += 1;
        orderId = `INQ-${yyyy}-${String(nextSeq).padStart(3, '0')}`;
      }
    }
  } else {
    // Official Full RFQ -> MUST use official ORD-YYYY-XXX ID (never reuse INQ-YYYY-XXX)
    if (existingInq && !wasQuickCapture && /^ORD-/i.test(existingInq.order_id)) {
      orderId = existingInq.order_id;
      isUpdateInPlace = true;
    } else {
      const ordRegex = new RegExp(`^ORD-${yyyy}-(\\d+)$`, 'i');
      const allOfficialIds = [
        ...state.inquiries.map((i) => i.order_id),
        ...state.orders.map((o) => o.order_id),
      ];
      const maxOrdSeq = allOfficialIds.reduce((max, id) => {
        const m = String(id || '').match(ordRegex);
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 0);
      let nextSeq = maxOrdSeq + 1;
      orderId = `ORD-${yyyy}-${String(nextSeq).padStart(3, '0')}`;
      while (allOfficialIds.includes(orderId)) {
        nextSeq += 1;
        orderId = `ORD-${yyyy}-${String(nextSeq).padStart(3, '0')}`;
      }
      if (params.sourceQuickLogId) {
        quickLogIdToRetire = params.sourceQuickLogId;
      } else if (existingInq && wasQuickCapture) {
        quickLogIdToRetire = existingInq.order_id;
      }
    }
  }

  const baseRow = {
    order_id: orderId,
    timestamp: (isUpdateInPlace ? existingInq?.timestamp : undefined) || now.toISOString().replace('T', ' ').slice(0, 19),
    sale_rep: params.saleRep,
    consignee_id: consignee.consignee_id,
    address: params.customerInput.address || consignee.address,
    contact: params.customerInput.contact_person || consignee.contact_person,
    email: params.customerInput.email || consignee.email,
    phone: normalizePlainText(params.customerInput.phone || consignee.phone),
    sku_code: params.sku_code,
    product_name_vie: params.product_name_vie,
    net_weight_kgs: toNum(params.net_weight_kgs),
    desired_delivery_date: params.desired_delivery_date,
    desired_incoterm: params.desired_incoterm,
    proposed_payment_term: params.proposed_payment_term,
    inquiry_status: params.inquiry_status,
    note: params.note,
    order_items: params.order_items,
    quotation_mode: params.quotation_mode,
    customer_confirm_note: (isUpdateInPlace ? existingInq?.customer_confirm_note : '') || '',
    sent_mail_link: (isUpdateInPlace ? existingInq?.sent_mail_link : '') || '',
  };

  saveInquiryExtraMeta(orderId, { pod: resolvedPod, warehouse_address: resolvedWarehouse });
  const rowWithExtra = { ...baseRow, pod: resolvedPod, warehouse_address: resolvedWarehouse };

  if (isUpdateInPlace) {
    const primary = await supabase.from('inquiry_quotation').update(rowWithExtra).eq('order_id', orderId);
    if (primary.error) {
      if (/(pod|warehouse_address|column|schema cache)/i.test(primary.error.message || '')) {
        const fb = await supabase.from('inquiry_quotation').update(baseRow).eq('order_id', orderId);
        if (fb.error) throw new Error(`Lỗi cập nhật RFQ: ${fb.error.message}`);
      } else {
        throw new Error(`Lỗi cập nhật RFQ: ${primary.error.message}`);
      }
    }
  } else {
    const primary = await supabase.from('inquiry_quotation').insert(rowWithExtra);
    if (primary.error) {
      if (/(pod|warehouse_address|column|schema cache)/i.test(primary.error.message || '')) {
        const fb = await supabase.from('inquiry_quotation').insert(baseRow);
        if (fb.error) throw new Error(`Lỗi lưu RFQ mới: ${fb.error.message}`);
      } else {
        throw new Error(`Lỗi lưu RFQ mới: ${primary.error.message}`);
      }
    }
    if (quickLogIdToRetire && quickLogIdToRetire !== orderId) {
      await supabase.from('inquiry_quotation').delete().eq('order_id', quickLogIdToRetire);
      removeInquiryExtraMeta(quickLogIdToRetire);
    }
  }
  return { ...baseRow, pod: resolvedPod, warehouse_address: resolvedWarehouse };
}

export async function deletePreContractOrder(state: AppDataState, orderId: string): Promise<void> {
  assertConfigured();
  const order = state.orders.find((o) => o.order_id === orderId);
  const meta = readOrderLogisticsMetaMap()[orderId];
  if (order && (meta?.is_locked || String(order.fulfillment_status || '').toLowerCase().includes('3.') || String(order.fulfillment_status || '').toLowerCase().includes('hoàn tất'))) {
    throw new Error('Không thể xóa đơn hàng đã ký hợp đồng.');
  }

  const inq = state.inquiries.find((i) => i.order_id === orderId);
  if (order) {
    await supabase.from('order_master').delete().eq('order_id', orderId);
  }
  await supabase.from('pricing_proposal').delete().eq('order_id', orderId);
  const { error } = await supabase.from('inquiry_quotation').delete().eq('order_id', orderId);
  if (error) throw new Error(`Lỗi xóa yêu cầu báo giá: ${error.message}`);
  removeInquiryExtraMeta(orderId);

  const wasQuickCapture = inq ? isQuickCaptureStatus(inq.inquiry_status) : false;
  if (inq?.consignee_id && !wasQuickCapture) {
    const cus = state.consignees.find((c) => c.consignee_id === inq.consignee_id);
    if (cus) {
      const nextCount = Math.max(0, Math.floor(toNum(cus.order_count)) - 1);
      if (nextCount === 0 && toNum(cus.order_count) <= 1) {
        const otherInq = state.inquiries.some((i) => i.order_id !== orderId && i.consignee_id === cus.consignee_id);
        if (!otherInq) {
          await supabase.from('consignee_directory').delete().eq('consignee_id', cus.consignee_id);
          return;
        }
      }
      await supabase
        .from('consignee_directory')
        .update({ order_count: nextCount, customer_type: classifyCustomerByCount(nextCount) })
        .eq('consignee_id', cus.consignee_id);
    }
  }
}

export async function savePricingProposalRecord(
  state: AppDataState,
  proposal: PricingProposal,
  extraMeta: ProposalExtraMeta,
  updatedOrderItemsJson?: string
): Promise<void> {
  assertConfigured();
  const existing = state.proposals.find((p) => p.order_id === proposal.order_id);
  const cleanRow: PricingProposal = {
    order_id: proposal.order_id,
    xnk_rep: proposal.xnk_rep,
    schedule_id: proposal.schedule_id,
    container_type: proposal.container_type,
    container_qty: toNum(proposal.container_qty),
    total_freight_local: toNum(proposal.total_freight_local),
    insurance_cost: toNum(proposal.insurance_cost),
    goods_cost: toNum(proposal.goods_cost),
    recommended_incoterm: proposal.recommended_incoterm,
    final_selling_price: toNum(proposal.final_selling_price),
    booking_date: proposal.booking_date || todayIsoDate(),
    booking_status: WORKFLOW_STATUS.PRICED_READY,
    packing_pallet_cost: toNum(proposal.packing_pallet_cost),
    insurance_code: proposal.insurance_code,
    total_cartons: toNum(proposal.total_cartons),
    total_pallets: toNum(proposal.total_pallets),
    pallet_fee: toNum(proposal.pallet_fee),
    total_gross_weight: toNum(proposal.total_gross_weight),
    total_cbm: toNum(proposal.total_cbm),
    proposed_incoterms: proposal.proposed_incoterms,
  };

  if (existing) {
    const { error } = await supabase.from('pricing_proposal').update(cleanRow).eq('order_id', cleanRow.order_id);
    if (error) throw new Error(`Lỗi cập nhật phương án giá: ${error.message}`);
  } else {
    const { error } = await supabase.from('pricing_proposal').insert(cleanRow);
    if (error) throw new Error(`Lỗi lưu phương án giá: ${error.message}`);
  }

  saveProposalExtraMeta(cleanRow.order_id, extraMeta);

  const inqPatch: Partial<InquiryQuotation> = {
    inquiry_status: WORKFLOW_STATUS.PRICED_READY,
  };
  if (updatedOrderItemsJson) inqPatch.order_items = updatedOrderItemsJson;
  const { error: inqErr } = await supabase.from('inquiry_quotation').update(inqPatch).eq('order_id', cleanRow.order_id);
  if (inqErr) throw new Error(`Lỗi đồng bộ trạng thái RFQ: ${inqErr.message}`);
}

export async function updateQuotationWorkflow(
  orderId: string,
  patch: Partial<InquiryQuotation>,
  proposalPricePatch?: Partial<PricingProposal>
): Promise<void> {
  assertConfigured();
  const { error } = await supabase.from('inquiry_quotation').update(patch).eq('order_id', orderId);
  if (error) throw new Error(`Lỗi cập nhật báo giá: ${error.message}`);
  if (proposalPricePatch) {
    const { error: pErr } = await supabase.from('pricing_proposal').update(proposalPricePatch).eq('order_id', orderId);
    if (pErr) throw new Error(`Lỗi đồng bộ giá đề xuất: ${pErr.message}`);
  }
}

export async function createOrOverwriteContractDraft(
  state: AppDataState,
  orderId: string,
  staffName: string
): Promise<OrderMaster> {
  assertConfigured();
  const inq = state.inquiries.find((i) => i.order_id === orderId);
  if (!inq) throw new Error(`Không tìm thấy đơn ${orderId}`);
  const prop = state.proposals.find((p) => p.order_id === orderId);
  const sch = prop ? state.schedules.find((s) => s.schedule_id === prop.schedule_id) : undefined;
  const cus = state.consignees.find((c) => c.consignee_id === inq.consignee_id);
  const existing = state.orders.find((o) => o.order_id === orderId);

  const yr = new Date().getFullYear();
  let contractNo = existing?.contract_no || '';
  if (!contractNo) {
    const seq = state.orders.length + 1;
    contractNo = `SC-${yr}-${String(seq).padStart(3, '0')}/GAE`;
  }

  const row: OrderMaster = {
    order_id: orderId,
    contract_no: contractNo,
    contract_date: existing?.contract_date || todayIsoDate(),
    in_charge_staff: staffName,
    consignee_id: inq.consignee_id,
    sku_code: inq.sku_code,
    nw_confirmed_kgs: toNum(inq.net_weight_kgs),
    applied_incoterm: prop?.recommended_incoterm || inq.desired_incoterm || 'CIF',
    contract_value: toNum(prop?.final_selling_price) || 0,
    payment_terms: inq.proposed_payment_term || cus?.default_payment_term || 'T/T 30/70',
    pol: sch?.pol || existing?.pol || 'Cát Lái (HCMC)',
    pod: sch?.pod || existing?.pod || '',
    fulfillment_status: existing?.fulfillment_status || WORKFLOW_6_STAGES[1],
    co_form: existing?.co_form || suggestCoFormCode(sch?.pod, cus?.country),
    contract_link: existing?.contract_link || '',
  };

  if (existing) {
    const { error } = await supabase.from('order_master').update(row).eq('order_id', orderId);
    if (error) throw new Error(`Lỗi cập nhật hợp đồng: ${error.message}`);
  } else {
    const { error } = await supabase.from('order_master').insert(row);
    if (error) throw new Error(`Lỗi khởi tạo hợp đồng: ${error.message}`);
  }

  saveOrderLogisticsMeta(orderId, {
    exact_fulfillment_status: row.fulfillment_status,
    ves_voy: sch ? `${sch.vessel || ''} / ${sch.voyage || ''}`.replace(/^\s*\/\s*$/, '') : '',
  });
  return row;
}

export async function updateOrderMasterRecord(order: OrderMaster, metaPatch?: Partial<OrderLogisticsMeta>): Promise<void> {
  assertConfigured();
  const cleanRow: OrderMaster = {
    order_id: order.order_id,
    contract_no: order.contract_no,
    contract_date: order.contract_date,
    in_charge_staff: order.in_charge_staff,
    consignee_id: order.consignee_id,
    sku_code: order.sku_code,
    nw_confirmed_kgs: toNum(order.nw_confirmed_kgs),
    applied_incoterm: order.applied_incoterm,
    contract_value: toNum(order.contract_value),
    payment_terms: order.payment_terms,
    pol: order.pol,
    pod: order.pod,
    fulfillment_status: order.fulfillment_status,
    co_form: order.co_form,
    contract_link: order.contract_link,
  };
  const { error } = await supabase.from('order_master').update(cleanRow).eq('order_id', cleanRow.order_id);
  if (error) throw new Error(`Lỗi cập nhật hợp đồng: ${error.message}`);
  if (metaPatch) {
    saveOrderLogisticsMeta(cleanRow.order_id, metaPatch);
  }
}

export async function sendContractToSalesForSigning(order: OrderMaster): Promise<void> {
  assertConfigured();
  const nextStatus = WORKFLOW_STATUS.CONTRACT_PENDING_SALES;
  await updateOrderMasterRecord(
    { ...order, fulfillment_status: nextStatus },
    { sent_to_sales: true, exact_fulfillment_status: WORKFLOW_6_STAGES[1] }
  );
  await supabase.from('inquiry_quotation').update({ inquiry_status: nextStatus }).eq('order_id', order.order_id);
}

export async function confirmBuyerSignedContract(order: OrderMaster): Promise<void> {
  assertConfigured();
  const stage3 = WORKFLOW_6_STAGES[2];
  await updateOrderMasterRecord(
    { ...order, fulfillment_status: stage3 },
    { is_locked: true, signed_date: todayIsoDate(), sent_to_sales: false, exact_fulfillment_status: stage3 }
  );
  await supabase.from('inquiry_quotation').update({ inquiry_status: WORKFLOW_STATUS.CONTRACT_CREATED }).eq('order_id', order.order_id);
}

export async function advanceContractMilestone(order: OrderMaster, nextStatus: string): Promise<void> {
  assertConfigured();
  await updateOrderMasterRecord(
    { ...order, fulfillment_status: nextStatus },
    { exact_fulfillment_status: nextStatus, is_locked: true }
  );
  if (nextStatus === COMPLETED_ORDER_STATUS) {
    await supabase.from('inquiry_quotation').update({ inquiry_status: COMPLETED_ORDER_STATUS }).eq('order_id', order.order_id);
  }
}

export async function upsertConsigneeDirect(row: ConsigneeDirectory, isEdit: boolean): Promise<void> {
  assertConfigured();
  const clean: ConsigneeDirectory = {
    consignee_id: row.consignee_id,
    consignee_name: row.consignee_name,
    country: row.country,
    address: row.address,
    tax: normalizePlainText(row.tax),
    contact_person: row.contact_person,
    phone: normalizePlainText(row.phone),
    email: row.email,
    fax: normalizePlainText(row.fax),
    default_payment_term: row.default_payment_term,
    order_count: Math.max(0, Math.floor(toNum(row.order_count))),
    customer_type: classifyCustomerByCount(toNum(row.order_count)),
    created_date: row.created_date || todayIsoDate(),
  };
  const { error } = isEdit
    ? await supabase.from('consignee_directory').update(clean).eq('consignee_id', clean.consignee_id)
    : await supabase.from('consignee_directory').insert(clean);
  if (error) throw new Error(`Lỗi lưu khách hàng: ${error.message}`);
}

export async function deleteConsigneeDirect(consigneeId: string): Promise<void> {
  assertConfigured();
  const { error } = await supabase.from('consignee_directory').delete().eq('consignee_id', consigneeId);
  if (error) throw new Error(`Lỗi xóa khách hàng: ${error.message}`);
}

export async function upsertProductDirect(row: ProductCatalog, isEdit: boolean): Promise<void> {
  assertConfigured();
  const clean: ProductCatalog = {
    product_group: row.product_group,
    sku_code: row.sku_code,
    product_name_vie: row.product_name_vie,
    product_name_eng: row.product_name_eng,
    unit_price: toNum(row.unit_price),
    hs_code: normalizePlainText(row.hs_code),
    container_type: row.container_type,
    storage_temperature: row.storage_temperature,
    image_url: row.image_url,
  };
  const { error } = isEdit
    ? await supabase.from('product_catalog').update(clean).eq('sku_code', clean.sku_code)
    : await supabase.from('product_catalog').insert(clean);
  if (error) throw new Error(`Lỗi lưu sản phẩm: ${error.message}`);
}

export async function deleteProductDirect(skuCode: string): Promise<void> {
  assertConfigured();
  const { error } = await supabase.from('product_catalog').delete().eq('sku_code', skuCode);
  if (error) throw new Error(`Lỗi xóa sản phẩm: ${error.message}`);
}

export async function uploadShippingLineLogo(shippingLine: string, file: File): Promise<string> {
  assertConfigured();
  const slug = slugifyShippingLine(shippingLine);
  if (!slug) {
    throw new Error('Vui lòng nhập tên Hãng tàu trước khi tải logo.');
  }
  const path = `shipping-lines/${slug}.png`;
  const { error } = await supabase.storage.from('images').upload(path, file, {
    upsert: true,
    contentType: file.type || 'image/png',
  });
  if (error) {
    throw new Error(`Không thể tải logo hãng tàu lên Storage: ${error.message}`);
  }
  const { data } = supabase.storage.from('images').getPublicUrl(path);
  if (!data?.publicUrl) {
    throw new Error('Không lấy được đường dẫn công khai của logo hãng tàu.');
  }
  return data.publicUrl;
}

export async function upsertScheduleDirect(row: ShippingSchedule, isEdit: boolean): Promise<void> {
  assertConfigured();
  const clean: ShippingSchedule = {
    schedule_id: row.schedule_id,
    pol: row.pol,
    pod: row.pod,
    country: row.country,
    pot: row.pot,
    shipping_line: row.shipping_line,
    vessel: row.vessel,
    voyage: row.voyage,
    etd: row.etd,
    eta: row.eta,
    rate_20_dc: toNum(row.rate_20_dc),
    rate_40_dc: toNum(row.rate_40_dc),
    rate_40_hc: toNum(row.rate_40_hc),
    rate_20_rf: toNum(row.rate_20_rf),
    rate_40_rf: toNum(row.rate_40_rf),
    rate_40_rh: toNum(row.rate_40_rh),
    baf_fee: toNum(row.baf_fee),
    lss_fee: toNum(row.lss_fee),
    pss_fee: toNum(row.pss_fee),
    b_l_fee: toNum(row.b_l_fee),
    seal_fee: toNum(row.seal_fee),
    updated_date: todayIsoDate(),
    expiry_date: row.expiry_date,
    thc_20_dry: toNum(row.thc_20_dry),
    thc_40_dry: toNum(row.thc_40_dry),
    thc_20_reefer: toNum(row.thc_20_reefer),
    thc_40_reefer: toNum(row.thc_40_reefer),
    bill_seal_fee_shipment: toNum(row.bill_seal_fee_shipment),
    logo_url: String(row.logo_url || '').trim(),
  };
  const primary = isEdit
    ? await supabase.from('shipping_schedule').update(clean).eq('schedule_id', clean.schedule_id)
    : await supabase.from('shipping_schedule').insert(clean);

  if (primary.error && /logo_url/i.test(primary.error.message || '')) {
    const { logo_url: _ignored, ...withoutLogo } = clean;
    const fb = isEdit
      ? await supabase.from('shipping_schedule').update(withoutLogo).eq('schedule_id', clean.schedule_id)
      : await supabase.from('shipping_schedule').insert(withoutLogo);
    if (fb.error) throw new Error(`Lỗi lưu lịch tàu: ${fb.error.message}`);
    return;
  }

  if (primary.error) throw new Error(`Lỗi lưu lịch tàu: ${primary.error.message}`);
}

export async function deleteScheduleDirect(scheduleId: string): Promise<void> {
  assertConfigured();
  const { error } = await supabase.from('shipping_schedule').delete().eq('schedule_id', scheduleId);
  if (error) throw new Error(`Lỗi xóa lịch tàu: ${error.message}`);
}

export async function upsertPricingRateDirect(row: PricingRate, isEdit: boolean): Promise<void> {
  assertConfigured();
  const clean: PricingRate = {
    fee_category: row.fee_category,
    fee_code: row.fee_code,
    scope_or_cont_type: row.scope_or_cont_type,
    fee_name_vie: row.fee_name_vie,
    contract_text_eng: row.contract_text_eng,
    unit_basis: row.unit_basis,
    standard_rate: toNum(row.standard_rate),
    provider_or_rule: row.provider_or_rule,
    note: row.note,
    dim_cm: row.dim_cm,
    net_kg: toNum(row.net_kg),
    tare_kg: toNum(row.tare_kg),
    max_per_pallet: toNum(row.max_per_pallet),
  };
  const primary = isEdit
    ? await supabase.from('pricing_rates').update(clean).eq('fee_code', clean.fee_code)
    : await supabase.from('pricing_rates').insert(clean);

  if (primary.error && /scope_or_cont_type/i.test(primary.error.message)) {
    const { scope_or_cont_type, ...rest } = clean;
    const altPayload = { ...rest, scope_or_conttype: scope_or_cont_type };
    const fb = isEdit
      ? await supabase.from('pricing_rates').update(altPayload).eq('fee_code', clean.fee_code)
      : await supabase.from('pricing_rates').insert(altPayload);
    if (fb.error) throw new Error(`Lỗi lưu phụ phí: ${fb.error.message}`);
    return;
  }

  if (primary.error) throw new Error(`Lỗi lưu phụ phí: ${primary.error.message}`);
}

export async function deletePricingRateDirect(feeCode: string): Promise<void> {
  assertConfigured();
  const { error } = await supabase.from('pricing_rates').delete().eq('fee_code', feeCode);
  if (error) throw new Error(`Lỗi xóa phụ phí: ${error.message}`);
}

function inferScopeFromTemplate(row: TemplateManager): string {
  const txt = `${row.template_id} ${row.document_name}`.toUpperCase();
  if (txt.includes('QUOT') || txt.includes('BÁO GIÁ')) return 'QUOTATION';
  if (txt.includes('CONTRACT') || txt.includes('HỢP ĐỒNG') || txt.includes('SC')) return 'CONTRACT';
  if (txt.includes('INVOICE') || txt.includes('CI')) return 'INVOICE';
  if (txt.includes('PACKING') || txt.includes('PL')) return 'PACKING_LIST';
  if (txt.includes('CO') || txt.includes('ORIGIN')) return 'CO';
  if (txt.includes('BL') || txt.includes('BILL')) return 'BL';
  return 'ALL';
}

export async function upsertTemplateDirect(row: TemplateManager, isEdit: boolean): Promise<void> {
  assertConfigured();
  const wrappedPlaceholders = formatPlaceholderListWrapped(row.supported_placeholders);
  const clean: TemplateManager = {
    template_id: row.template_id.trim(),
    document_name: row.document_name.trim(),
    google_doc_file_id: row.google_doc_file_id.trim(),
    target_department: row.target_department.trim(),
    status: row.status.trim() || 'Active',
    supported_placeholders: wrappedPlaceholders,
  };
  const { error } = isEdit
    ? await supabase.from('template_manager').update(clean).eq('template_id', clean.template_id)
    : await supabase.from('template_manager').upsert(clean, { onConflict: 'template_id' });
  if (error) throw new Error(`Lỗi lưu biểu mẫu: ${error.message}`);

  // Auto-sync any missing {{PLACEHOLDER}} keys to public.template_placeholders
  const extractedKeys = extractWrappedPlaceholderKeys(wrappedPlaceholders);
  if (extractedKeys.length > 0) {
    try {
      const existing = await fetchTemplatePlaceholdersSafe();
      const existingSet = new Set(
        existing.map((p) => normalizePlaceholderKey(p.placeholder_key)).filter(Boolean)
      );
      const scope = inferScopeFromTemplate(clean);
      const missingRows: TemplatePlaceholder[] = extractedKeys
        .filter((k) => !existingSet.has(k))
        .map((k) => ({
          placeholder_key: k,
          scope,
          source_table: 'computed',
          source_column: k.toLowerCase(),
          description_vie: getVietnamesePlaceholderLabel(k, existing),
          is_auto_created: true,
        }));
      if (missingRows.length > 0) {
        await upsertTemplatePlaceholders(missingRows);
      }
    } catch {
      // Non-fatal: template itself is already saved
    }
  }
}

export async function upsertSysUserDirect(row: SysUser, isEdit: boolean): Promise<void> {
  assertConfigured();
  const clean = {
    employee_id: row.employee_id.trim(),
    full_name: row.full_name.trim(),
    department: row.department.trim(),
    role: row.role.trim(),
    email: row.email.trim().toLowerCase(),
    status: row.status.trim(),
  };
  const { error } = isEdit
    ? await supabase.from('sys_users').update(clean).eq('employee_id', clean.employee_id)
    : await supabase.from('sys_users').upsert(clean, { onConflict: 'employee_id' });
  if (error) throw new Error(`Lỗi lưu tài khoản: ${error.message}`);
}
