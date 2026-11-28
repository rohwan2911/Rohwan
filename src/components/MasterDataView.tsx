import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Edit3,
  Package,
  Ship,
  Receipt,
  FileCode2,
  ShieldCheck,
  Sparkles,
  Upload,
  FileDown,
  Loader2,
  X,
  Search,
  Wand2,
  Save,
  Hash,
  Check,
  Tag,
  Image as ImageIcon,
  Eye,
  FileText,
  Languages,
  Lock,
} from 'lucide-react';
import { renderAsync } from 'docx-preview';
import { SearchableCombo } from './SearchableCombo';
import type {
  AppDataState,
  PricingRate,
  ProductCatalog,
  ShippingSchedule,
  SysUser,
  TemplateManager,
  TemplatePlaceholder,
  ViewId,
} from '../types';
import {
  capitalizeWordsPreservingSpaces,
  computeFreightExpiryStatus,
  deduplicatePortName,
  fmtDecimal,
  fmtNumber,
  fmtUSD,
  formatDateDDMMYYYY,
  formatEditableNumber,
  getShippingLineLogoUrl,
  getShippingLineMonogram,
  normalizePlainText,
  parseLocaleNumber,
  todayIsoDate,
  toNum,
  translateVIEtoENGSmart,
} from '../utils/calculations';
import {
  applyAiTagsToDocx,
  DocxParagraphBlock,
  extractDocxParagraphBlocks,
  extractPlaceholdersFromDocx,
  formatPlaceholderListWrapped,
  formatTemplateDepartmentLabel,
  getVietnamesePlaceholderLabel,
  normalizePlaceholderKey,
  normalizePlaceholderTag,
  normalizeTemplateDepartment,
  parsePlaceholderKeyList,
  resolveCleanVietnameseLabel,
  stripPlaceholderBraces,
  TEMPLATE_DEPARTMENT_OPTIONS,
} from '../utils/docxEngine';
import {
  downloadTemplateDocx,
  openDocumentWithSignedUrl,
  uploadShippingLineLogo,
  uploadTemplateDocx,
  upsertTemplatePlaceholders,
} from '../services/supabaseService';

interface MasterDataViewProps {
  activeView: Extract<ViewId, 'master-products' | 'xnk-shipping' | 'xnk-rates' | 'admin-templates' | 'admin-users'>;
  data: AppDataState;
  quickSearch: string;
  highlightedId?: string;
  onUpsertProduct: (row: ProductCatalog, isEdit: boolean, silent?: boolean) => Promise<void>;
  onDeleteProduct: (sku: string) => Promise<void>;
  onUpsertSchedule: (row: ShippingSchedule, isEdit: boolean, silent?: boolean) => Promise<void>;
  onDeleteSchedule: (scheduleId: string) => Promise<void>;
  onUpsertRate: (row: PricingRate, isEdit: boolean, silent?: boolean) => Promise<void>;
  onDeleteRate: (feeCode: string) => Promise<void>;
  onUpsertTemplate: (row: TemplateManager, isEdit: boolean) => Promise<void>;
  onDeleteTemplate: (row: TemplateManager) => Promise<void>;
  onRefreshData?: () => Promise<void>;
  onUpsertUser: (row: SysUser, isEdit: boolean, initialPassword?: string) => Promise<void>;
  onRequestConfirm: (title: string, message: string, onConfirm: () => Promise<void>, danger?: boolean) => void;
  onToast: (type: 'success' | 'error' | 'info' | 'warning', title: string) => void;
}

interface ProductDraft {
  product_group: string;
  sku_code: string;
  product_name_vie: string;
  product_name_eng: string;
  unit_price: string;
  hs_code: string;
  container_type: string;
  storage_temperature: string;
  image_url: string;
}

interface ScheduleDraft {
  schedule_id: string;
  pol: string;
  pod: string;
  country: string;
  pot: string;
  shipping_line: string;
  vessel: string;
  voyage: string;
  etd: string;
  eta: string;
  rate_20_dc: string;
  rate_40_dc: string;
  rate_40_hc: string;
  rate_20_rf: string;
  rate_40_rf: string;
  rate_40_rh: string;
  baf_fee: string;
  lss_fee: string;
  pss_fee: string;
  b_l_fee: string;
  seal_fee: string;
  updated_date: string;
  expiry_date: string;
  thc_20_dry: string;
  thc_40_dry: string;
  thc_20_reefer: string;
  thc_40_reefer: string;
  bill_seal_fee_shipment: string;
  logo_url: string;
}

interface RateDraft {
  fee_category: string;
  fee_code: string;
  scope_or_cont_type: string;
  fee_name_vie: string;
  contract_text_eng: string;
  unit_basis: string;
  standard_rate: string;
  provider_or_rule: string;
  note: string;
  dim_cm: string;
  net_kg: string;
  tare_kg: string;
  max_per_pallet: string;
}

const RATE_CATEGORY_OPTIONS = ['CUSTOMS_FEE', 'INSURANCE', 'PACKING', 'CONTAINER'] as const;

const createBlankProductDraft = (lockedGroup: string): ProductDraft => ({
  product_group: lockedGroup,
  sku_code: '',
  product_name_vie: '',
  product_name_eng: '',
  unit_price: '',
  hs_code: '',
  container_type: '',
  storage_temperature: '',
  image_url: '',
});

const productToDraft = (p: ProductCatalog): ProductDraft => ({
  product_group: p.product_group || '',
  sku_code: p.sku_code || '',
  product_name_vie: p.product_name_vie || '',
  product_name_eng: p.product_name_eng || '',
  unit_price: formatEditableNumber(p.unit_price),
  hs_code: normalizePlainText(p.hs_code),
  container_type: p.container_type || '',
  storage_temperature: p.storage_temperature || '',
  image_url: p.image_url || '',
});

const createBlankScheduleDraft = (): ScheduleDraft => ({
  schedule_id: '',
  pol: '',
  pod: '',
  country: '',
  pot: '',
  shipping_line: '',
  vessel: '',
  voyage: '',
  etd: '',
  eta: '',
  rate_20_dc: '',
  rate_40_dc: '',
  rate_40_hc: '',
  rate_20_rf: '',
  rate_40_rf: '',
  rate_40_rh: '',
  baf_fee: '',
  lss_fee: '',
  pss_fee: '',
  b_l_fee: '',
  seal_fee: '',
  updated_date: todayIsoDate(),
  expiry_date: '',
  thc_20_dry: '',
  thc_40_dry: '',
  thc_20_reefer: '',
  thc_40_reefer: '',
  bill_seal_fee_shipment: '',
  logo_url: '',
});

const scheduleToDraft = (s: ShippingSchedule): ScheduleDraft => ({
  schedule_id: s.schedule_id || '',
  pol: s.pol || '',
  pod: s.pod || '',
  country: s.country || '',
  pot: s.pot || '',
  shipping_line: s.shipping_line || '',
  vessel: s.vessel || '',
  voyage: s.voyage || '',
  etd: s.etd || '',
  eta: s.eta || '',
  rate_20_dc: formatEditableNumber(s.rate_20_dc),
  rate_40_dc: formatEditableNumber(s.rate_40_dc),
  rate_40_hc: formatEditableNumber(s.rate_40_hc),
  rate_20_rf: formatEditableNumber(s.rate_20_rf),
  rate_40_rf: formatEditableNumber(s.rate_40_rf),
  rate_40_rh: formatEditableNumber(s.rate_40_rh),
  baf_fee: formatEditableNumber(s.baf_fee),
  lss_fee: formatEditableNumber(s.lss_fee),
  pss_fee: formatEditableNumber(s.pss_fee),
  b_l_fee: formatEditableNumber(s.b_l_fee),
  seal_fee: formatEditableNumber(s.seal_fee),
  updated_date: s.updated_date || todayIsoDate(),
  expiry_date: s.expiry_date || '',
  thc_20_dry: formatEditableNumber(s.thc_20_dry),
  thc_40_dry: formatEditableNumber(s.thc_40_dry),
  thc_20_reefer: formatEditableNumber(s.thc_20_reefer),
  thc_40_reefer: formatEditableNumber(s.thc_40_reefer),
  bill_seal_fee_shipment: formatEditableNumber(s.bill_seal_fee_shipment),
  logo_url: s.logo_url || '',
});

const createBlankRateDraft = (lockedCategory: string): RateDraft => ({
  fee_category: lockedCategory,
  fee_code: '',
  scope_or_cont_type: '',
  fee_name_vie: '',
  contract_text_eng: '',
  unit_basis: '',
  standard_rate: '',
  provider_or_rule: '',
  note: '',
  dim_cm: '',
  net_kg: '',
  tare_kg: '',
  max_per_pallet: '',
});

const rateToDraft = (r: PricingRate): RateDraft => ({
  fee_category: r.fee_category || '',
  fee_code: r.fee_code || '',
  scope_or_cont_type: r.scope_or_cont_type || '',
  fee_name_vie: r.fee_name_vie || '',
  contract_text_eng: r.contract_text_eng || '',
  unit_basis: r.unit_basis || '',
  standard_rate: formatEditableNumber(r.standard_rate),
  provider_or_rule: r.provider_or_rule || '',
  note: r.note || '',
  dim_cm: r.dim_cm || '',
  net_kg: formatEditableNumber(r.net_kg),
  tare_kg: formatEditableNumber(r.tare_kg),
  max_per_pallet: formatEditableNumber(r.max_per_pallet),
});

const ProductThumbnail: React.FC<{ url?: string; alt: string; sizeClass?: string }> = ({
  url,
  alt,
  sizeClass = 'w-12 h-12',
}) => {
  const [failed, setFailed] = useState(false);
  const trimmed = String(url || '').trim();

  useEffect(() => {
    setFailed(false);
  }, [trimmed]);

  if (!trimmed || failed) {
    return (
      <div
        className={`${sizeClass} rounded-lg bg-[#d7eee4] border border-[#186635]/40 flex items-center justify-center text-[#0f4a33]/65 mx-auto shrink-0`}
        title="Chưa có hình ảnh"
      >
        <ImageIcon className="w-5 h-5" />
      </div>
    );
  }

  return (
    <img
      src={trimmed}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${sizeClass} rounded-lg object-cover border border-[#186635]/50 bg-white mx-auto shrink-0 shadow-sm`}
    />
  );
};

const ShippingLineLogoBadge: React.FC<{
  shippingLine: string;
  logoUrl?: string;
  cacheBust?: number;
  onStatusChange?: (status: 'loading' | 'loaded' | 'missing') => void;
}> = ({ shippingLine, logoUrl, cacheBust = 0, onStatusChange }) => {
  const [failed, setFailed] = useState(false);
  const resolvedBase = getShippingLineLogoUrl(shippingLine, logoUrl);
  const finalSrc = resolvedBase
    ? cacheBust > 0
      ? `${resolvedBase}${resolvedBase.includes('?') ? '&' : '?'}v=${cacheBust}`
      : resolvedBase
    : '';
  const monogram = getShippingLineMonogram(shippingLine);

  useEffect(() => {
    setFailed(false);
    if (!finalSrc) {
      onStatusChange?.('missing');
    } else {
      onStatusChange?.('loading');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalSrc]);

  return (
    <div
      className="keep-hover-color w-9 h-9 bg-white rounded-lg p-1 border border-emerald-900/15 flex items-center justify-center overflow-hidden shrink-0 shadow-sm mx-auto"
      title={shippingLine || 'Logo hãng tàu'}
    >
      {finalSrc && !failed ? (
        <img
          src={finalSrc}
          alt={shippingLine || 'Shipping Line'}
          loading="lazy"
          onLoad={() => onStatusChange?.('loaded')}
          onError={() => {
            setFailed(true);
            onStatusChange?.('missing');
          }}
          className="w-full h-full object-contain"
        />
      ) : (
        <span className="keep-hover-color text-[11px] font-extrabold text-[#0f4a33] leading-none tracking-tight select-none">
          {monogram}
        </span>
      )}
    </div>
  );
};

export const MasterDataView: React.FC<MasterDataViewProps> = ({
  activeView,
  data,
  quickSearch,
  highlightedId,
  onUpsertProduct,
  onDeleteProduct,
  onUpsertSchedule,
  onDeleteSchedule,
  onUpsertRate,
  onDeleteRate,
  onUpsertTemplate,
  onDeleteTemplate,
  onRefreshData,
  onUpsertUser,
  onRequestConfirm,
  onToast,
}) => {
  const qLower = quickSearch.trim().toLowerCase();

  const [prodGroup, setProdGroup] = useState<string>('ALL');
  const [prodModal, setProdModal] = useState<{
    open: boolean;
    isEdit: boolean;
    lockedGroup: string;
    rows: ProductDraft[];
  }>({ open: false, isEdit: false, lockedGroup: '', rows: [] });
  const [prodSaving, setProdSaving] = useState(false);

  const [schModal, setSchModal] = useState<{
    open: boolean;
    isEdit: boolean;
    rows: ScheduleDraft[];
  }>({ open: false, isEdit: false, rows: [] });
  const [schSaving, setSchSaving] = useState(false);
  const [schLogoStatusMap, setSchLogoStatusMap] = useState<Record<number, 'loading' | 'loaded' | 'missing'>>({});
  const [schLogoUploadingIdx, setSchLogoUploadingIdx] = useState<number | null>(null);
  const [schLogoCacheBust, setSchLogoCacheBust] = useState<number>(0);

  const [rateCat, setRateCat] = useState<string>('ALL');
  const [rateModal, setRateModal] = useState<{
    open: boolean;
    isEdit: boolean;
    lockedCategory: string;
    rows: RateDraft[];
  }>({ open: false, isEdit: false, lockedCategory: '', rows: [] });
  const [rateSaving, setRateSaving] = useState(false);

  // Loading state per row for VIE -> ENG translation button
  const [translatingKey, setTranslatingKey] = useState<string | null>(null);

  const [tplModal, setTplModal] = useState<{ open: boolean; isEdit: boolean; form: TemplateManager | null }>({ open: false, isEdit: false, form: null });
  const [tplFile, setTplFile] = useState<File | null>(null);
  const [tplDetectedTags, setTplDetectedTags] = useState<string[]>([]);
  const [tplBusy, setTplBusy] = useState(false);
  const [tplFieldSearch, setTplFieldSearch] = useState('');
  const [tplCustomKeyInput, setTplCustomKeyInput] = useState('');

  // Interactive #-Marker Smart-Fill & Manual Tag Review Modal state
  const [tagEditor, setTagEditor] = useState<{
    open: boolean;
    isEdit: boolean;
    templateForm: TemplateManager;
    buffer: ArrayBuffer;
    blocks: DocxParagraphBlock[];
    pendingNewPlaceholders: TemplatePlaceholder[];
    updatedBlockIds: string[];
  } | null>(null);
  const [tagEditorBusy, setTagEditorBusy] = useState(false);
  const [tagBlockSearch, setTagBlockSearch] = useState('');
  const [tagOnlyMarked, setTagOnlyMarked] = useState(false);
  const [tagEditorTab, setTagEditorTab] = useState<'edit' | 'preview'>('edit');
  const [pickerSearch, setPickerSearch] = useState('');
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const activeCursorRef = useRef<{ blockId: string; start: number; end: number } | null>(null);
  const blockTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const docxLayoutPreviewRef = useRef<HTMLDivElement | null>(null);
  const [docxPreviewLoading, setDocxPreviewLoading] = useState(false);

  const [usrModal, setUsrModal] = useState<{ open: boolean; isEdit: boolean; form: SysUser | null; initialPassword: string }>({
    open: false,
    isEdit: false,
    form: null,
    initialPassword: '',
  });
  const [usrSaving, setUsrSaving] = useState(false);

  const normalizedPlaceholders = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ key: string; label: string; scope: string; tp: TemplatePlaceholder }> = [];
    data.templatePlaceholders.forEach((tp) => {
      const key = stripPlaceholderBraces(tp.placeholder_key);
      if (!key) return;
      const upper = key.toUpperCase();
      if (seen.has(upper)) return;
      seen.add(upper);
      list.push({
        key,
        label: resolveCleanVietnameseLabel(key, tp),
        scope: tp.scope || 'COMMON',
        tp: { ...tp, placeholder_key: key },
      });
    });
    return list;
  }, [data.templatePlaceholders]);

  const productGroupTabs = useMemo(() => {
    const set = new Set<string>();
    data.products.forEach((p) => {
      const g = (p.product_group || '').trim();
      if (g) set.add(g);
    });
    return ['ALL', ...Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'))];
  }, [data.products]);

  const productGroupOptions = useMemo(() => {
    return productGroupTabs
      .filter((g) => g !== 'ALL')
      .map((g) => ({ value: g, label: g }));
  }, [productGroupTabs]);

  const scheduleCountryOptions = useMemo(() => {
    const set = new Set<string>();
    data.schedules.forEach((s) => s.country && set.add(s.country.trim()));
    data.consignees.forEach((c) => c.country && set.add(c.country.trim()));
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }, [data.schedules, data.consignees]);

  const schedulePolOptions = useMemo(() => {
    const set = new Set<string>(['Cát Lái (HCMC)', 'Hải Phòng', 'Đà Nẵng', 'Cái Mép - Thị Vải']);
    data.schedules.forEach((s) => s.pol && set.add(deduplicatePortName(s.pol)));
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }, [data.schedules]);

  const scheduleShippingLineOptions = useMemo(() => {
    const set = new Set<string>();
    data.schedules.forEach((s) => {
      const name = String(s.shipping_line || '').trim();
      if (name) set.add(name);
    });
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }, [data.schedules]);

  const getPodOptionsForCountry = (country: string) => {
    const countryLow = (country || '').trim().toLowerCase();
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
    return Array.from(map.values());
  };

  useEffect(() => {
    if (activeView === 'xnk-shipping' && highlightedId) {
      const target = data.schedules.find((s) => s.schedule_id === highlightedId);
      if (target) setSchModal({ open: true, isEdit: true, rows: [scheduleToDraft(target)] });
    }
  }, [activeView, highlightedId, data.schedules]);

  useEffect(() => {
    if (!tagEditor?.open || tagEditorTab !== 'preview') return;
    let cancelled = false;
    const renderPreview = async () => {
      const container = docxLayoutPreviewRef.current;
      if (!container) return;
      setDocxPreviewLoading(true);
      try {
        const changedReplacements = tagEditor.blocks
          .filter((b) => b.text !== b.originalText)
          .map((b) => ({ blockId: b.id, taggedText: b.text }));
        const bytes = await applyAiTagsToDocx(tagEditor.buffer, changedReplacements);
        if (cancelled || !docxLayoutPreviewRef.current) return;
        docxLayoutPreviewRef.current.innerHTML = '';
        await renderAsync(bytes, docxLayoutPreviewRef.current, undefined, {
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
        });
      } catch {
        // Ignore transient preview errors
      } finally {
        if (!cancelled) setDocxPreviewLoading(false);
      }
    };
    void renderPreview();
    return () => {
      cancelled = true;
    };
  }, [tagEditor, tagEditorTab]);

  if (activeView === 'master-products') {
    const list = data.products.filter((p) => {
      if (prodGroup !== 'ALL' && (p.product_group || '').trim() !== prodGroup) return false;
      if (!qLower) return true;
      return `${p.sku_code} ${p.product_name_vie} ${p.product_name_eng} ${p.hs_code} ${p.product_group}`.toLowerCase().includes(qLower);
    });

    const handleTranslateProductRow = async (idx: number) => {
      const row = prodModal.rows[idx];
      if (!row || !row.product_name_vie.trim()) {
        onToast('warning', 'Vui lòng nhập Tên Tiếng Việt trước khi dịch.');
        return;
      }
      const key = `prod-${idx}`;
      setTranslatingKey(key);
      try {
        const eng = await translateVIEtoENGSmart(row.product_name_vie, 'PRODUCT');
        setProdModal((prev) => ({
          ...prev,
          rows: prev.rows.map((r, i) => (i === idx ? { ...r, product_name_eng: eng } : r)),
        }));
      } catch (err: any) {
        onToast('error', err?.message || 'Không thể dịch tên sản phẩm.');
      } finally {
        setTranslatingKey(null);
      }
    };

    const handleSaveProducts = async () => {
      const activeRows = prodModal.rows.filter(
        (r) => r.sku_code.trim() || r.product_name_vie.trim() || r.product_name_eng.trim()
      );
      if (activeRows.length === 0) {
        onToast('warning', 'Vui lòng nhập ít nhất 1 sản phẩm (SKU & Tên Tiếng Việt).');
        return;
      }
      for (let i = 0; i < activeRows.length; i++) {
        const r = activeRows[i];
        if (!r.sku_code.trim()) {
          onToast('warning', `Dòng ${i + 1}: Vui lòng nhập mã SKU.`);
          return;
        }
        if (!r.product_name_vie.trim()) {
          onToast('warning', `Dòng ${i + 1} (${r.sku_code}): Vui lòng nhập Tên Tiếng Việt.`);
          return;
        }
      }
      setProdSaving(true);
      try {
        const isBulk = !prodModal.isEdit;
        for (const r of activeRows) {
          const payload: ProductCatalog = {
            product_group: (prodModal.lockedGroup || r.product_group).trim(),
            sku_code: r.sku_code.trim(),
            product_name_vie: r.product_name_vie.trim(),
            product_name_eng: r.product_name_eng.trim(),
            unit_price: parseLocaleNumber(r.unit_price),
            hs_code: r.hs_code.trim(),
            container_type: r.container_type.trim(),
            storage_temperature: r.storage_temperature.trim(),
            image_url: r.image_url.trim(),
          };
          await onUpsertProduct(payload, prodModal.isEdit, isBulk);
        }
        if (isBulk) {
          onToast(
            'success',
            activeRows.length > 1 ? `Đã thêm thành công ${activeRows.length} sản phẩm mới.` : 'Đã thêm sản phẩm mới.'
          );
          await onRefreshData?.();
        }
        setProdModal({ open: false, isEdit: false, lockedGroup: '', rows: [] });
      } catch (err: any) {
        onToast('error', err?.message || 'Lưu sản phẩm thất bại.');
      } finally {
        setProdSaving(false);
      }
    };

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1 bg-[#07281c] p-1 rounded-xl border border-[#186635]">
            {productGroupTabs.map((grp) => (
              <button
                key={grp}
                type="button"
                onClick={() => setProdGroup(grp)}
                className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                  prodGroup === grp ? 'bg-[#f4d98a] text-[#07281c]' : 'text-[#d2ebe0]'
                }`}
              >
                {grp === 'ALL' ? 'ALL' : grp}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              const locked = prodGroup === 'ALL' ? '' : prodGroup;
              setProdModal({
                open: true,
                isEdit: false,
                lockedGroup: locked,
                rows: [createBlankProductDraft(locked)],
              });
            }}
            className="agri-btn-gold flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Thêm Sản phẩm
          </button>
        </div>

        <div className="agri-table-wrap">
          <div className="px-4 py-3 bg-[#0f4a33] border-b border-[#186635]">
            <h3 className="text-sm font-extrabold text-[#fff5d6] flex items-center gap-2">
              <Package className="w-4 h-4 text-[#f4d98a]" /> Danh mục Sản phẩm Nông sản Xuất khẩu ({list.length})
            </h3>
          </div>
          <div className="agri-table-scroll">
            <table className="agri-table">
              <thead>
                <tr>
                  <th className="text-center whitespace-nowrap w-[76px]">HÌNH ẢNH</th>
                  <th className="text-center whitespace-nowrap">SKU</th>
                  <th className="text-left">NHÓM HÀNG</th>
                  <th className="text-left">TÊN TIẾNG VIỆT / ENGLISH</th>
                  <th className="text-center whitespace-nowrap">GIÁ VỐN (USD/KG)</th>
                  <th className="text-center whitespace-nowrap">HS CODE</th>
                  <th className="text-center">LOẠI CONT / NHIỆT ĐỘ</th>
                  <th className="text-center">THAO TÁC</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.sku_code}>
                    <td className="text-center">
                      <ProductThumbnail url={p.image_url} alt={p.product_name_vie || p.sku_code} />
                    </td>
                    <td className="text-center font-mono font-bold whitespace-nowrap">{p.sku_code}</td>
                    <td className="text-left">{p.product_group}</td>
                    <td className="text-left">
                      <div className="font-bold">{p.product_name_vie}</div>
                      <div className="text-[11px] opacity-80">{p.product_name_eng}</div>
                    </td>
                    <td className="text-center font-mono font-bold whitespace-nowrap">{fmtUSD(p.unit_price)}</td>
                    <td className="text-center font-mono whitespace-nowrap">{normalizePlainText(p.hs_code)}</td>
                    <td className="text-center text-xs">{p.container_type} · {p.storage_temperature}</td>
                    <td className="text-center">
                      <div className="inline-flex flex-wrap items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setProdModal({
                              open: true,
                              isEdit: true,
                              lockedGroup: '',
                              rows: [productToDraft(p)],
                            })
                          }
                          className="keep-btn-style px-2 py-1 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold cursor-pointer"
                        >
                          <Edit3 className="w-3 h-3 inline" /> Sửa
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onRequestConfirm('Xóa sản phẩm?', `Xác nhận xóa ${p.sku_code}?`, () => onDeleteProduct(p.sku_code), true)
                          }
                          className="keep-btn-style px-2 py-1 rounded bg-[#8c3b3b] text-white text-[11px] font-bold cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3 inline" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {prodModal.open && prodModal.rows.length > 0 && (
          <div className="fixed inset-0 z-50 bg-[#07281c]/75 flex items-center justify-center p-4">
            <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5 text-[#f4f8f5] space-y-3.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-base font-extrabold text-[#fff5d6]">
                    {prodModal.isEdit ? 'Sửa Sản phẩm' : `Thêm Sản phẩm Mới (${prodModal.rows.length} dòng)`}
                  </h4>
                  {!prodModal.isEdit && prodModal.lockedGroup && (
                    <p className="text-[11px] text-[#f4d98a] flex items-center gap-1 mt-0.5">
                      <Lock className="w-3 h-3" /> Đang thêm trực tiếp vào nhóm hàng cố định: <strong>{prodModal.lockedGroup}</strong>
                    </p>
                  )}
                </div>
                {!prodModal.isEdit && (
                  <button
                    type="button"
                    onClick={() =>
                      setProdModal((prev) => ({
                        ...prev,
                        rows: [...prev.rows, createBlankProductDraft(prev.lockedGroup)],
                      }))
                    }
                    className="px-3 py-1.5 rounded-lg bg-[#0f4a33] border border-[#f4d98a]/70 text-[#f4d98a] font-bold flex items-center gap-1 cursor-pointer hover:bg-[#135c3f]"
                  >
                    <Plus className="w-3.5 h-3.5" /> Thêm dòng mới
                  </button>
                )}
              </div>

              <div className="space-y-3">
                {prodModal.rows.map((row, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl bg-[#07281c]/30 border border-[#186635] p-3.5 space-y-2.5"
                  >
                    {!prodModal.isEdit && (
                      <div className="flex items-center justify-between border-b border-white/15 pb-1.5">
                        <span className="font-extrabold text-[#f4d98a]">Dòng #{idx + 1}</span>
                        {prodModal.rows.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setProdModal((prev) => ({
                                ...prev,
                                rows: prev.rows.filter((_, i) => i !== idx),
                              }))
                            }
                            className="px-2 py-0.5 rounded bg-[#8c3b3b] text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" /> Xóa dòng
                          </button>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-bold mb-1">SKU Code *</label>
                        <input
                          disabled={prodModal.isEdit}
                          value={row.sku_code}
                          placeholder="VD: SKU-001"
                          onChange={(e) =>
                            setProdModal((prev) => ({
                              ...prev,
                              rows: prev.rows.map((r, i) => (i === idx ? { ...r, sku_code: e.target.value } : r)),
                            }))
                          }
                          className="agri-input font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1 flex items-center gap-1">
                          Nhóm hàng
                          {!prodModal.isEdit && prodModal.lockedGroup && <Lock className="w-3 h-3 text-[#f4d98a]" />}
                        </label>
                        {!prodModal.isEdit && prodModal.lockedGroup ? (
                          <input
                            disabled
                            value={prodModal.lockedGroup}
                            className="agri-input opacity-80 cursor-not-allowed font-semibold"
                          />
                        ) : (
                          <SearchableCombo
                            value={row.product_group}
                            onChange={(v) =>
                              setProdModal((prev) => ({
                                ...prev,
                                rows: prev.rows.map((r, i) => (i === idx ? { ...r, product_group: v } : r)),
                              }))
                            }
                            options={productGroupOptions}
                            allowCustom
                            placeholder="VD: Nông sản khô / Trái cây tươi"
                          />
                        )}
                      </div>

                      <div>
                        <label className="block font-bold mb-1">Tên Tiếng Việt *</label>
                        <input
                          value={row.product_name_vie}
                          placeholder="VD: Thanh long ruột đỏ"
                          onChange={(e) =>
                            setProdModal((prev) => ({
                              ...prev,
                              rows: prev.rows.map((r, i) => (i === idx ? { ...r, product_name_vie: e.target.value } : r)),
                            }))
                          }
                          className="agri-input"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="font-bold">Tên Tiếng Anh</label>
                          <button
                            type="button"
                            disabled={translatingKey === `prod-${idx}` || !row.product_name_vie.trim()}
                            onClick={() => handleTranslateProductRow(idx)}
                            className="px-2 py-0.5 rounded bg-[#0f4a33] text-[#f4d98a] border border-[#f4d98a]/50 text-[10.5px] font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          >
                            {translatingKey === `prod-${idx}` ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Languages className="w-3 h-3" />
                            )}
                            Dịch sang Anh
                          </button>
                        </div>
                        <input
                          value={row.product_name_eng}
                          placeholder="VD: Fresh Red Dragon Fruit"
                          onChange={(e) =>
                            setProdModal((prev) => ({
                              ...prev,
                              rows: prev.rows.map((r, i) => (i === idx ? { ...r, product_name_eng: e.target.value } : r)),
                            }))
                          }
                          className="agri-input"
                        />
                      </div>

                      <div>
                        <label className="block font-bold mb-1">Giá vốn (USD/KG)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.unit_price}
                          placeholder="VD: 2.50"
                          onChange={(e) =>
                            setProdModal((prev) => ({
                              ...prev,
                              rows: prev.rows.map((r, i) => (i === idx ? { ...r, unit_price: e.target.value } : r)),
                            }))
                          }
                          className="agri-input font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">HS Code</label>
                        <input
                          value={row.hs_code}
                          placeholder="VD: 0810.90"
                          onChange={(e) =>
                            setProdModal((prev) => ({
                              ...prev,
                              rows: prev.rows.map((r, i) => (i === idx ? { ...r, hs_code: e.target.value } : r)),
                            }))
                          }
                          className="agri-input font-mono"
                        />
                      </div>

                      <div>
                        <label className="block font-bold mb-1">Loại Container</label>
                        <input
                          value={row.container_type}
                          placeholder="VD: 20'RF / 40'RH hoặc 20'DC"
                          onChange={(e) =>
                            setProdModal((prev) => ({
                              ...prev,
                              rows: prev.rows.map((r, i) => (i === idx ? { ...r, container_type: e.target.value } : r)),
                            }))
                          }
                          className="agri-input"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">Nhiệt độ bảo quản</label>
                        <input
                          value={row.storage_temperature}
                          placeholder="VD: +2°C đến +4°C / Nhiệt độ thường"
                          onChange={(e) =>
                            setProdModal((prev) => ({
                              ...prev,
                              rows: prev.rows.map((r, i) => (i === idx ? { ...r, storage_temperature: e.target.value } : r)),
                            }))
                          }
                          className="agri-input"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block font-bold mb-1">Đường dẫn Hình ảnh Sản phẩm (image_url)</label>
                        <div className="flex items-center gap-3">
                          <ProductThumbnail
                            url={row.image_url}
                            alt={row.product_name_vie || row.sku_code}
                            sizeClass="w-10 h-10"
                          />
                          <input
                            type="url"
                            placeholder="VD: https://example.com/product.jpg"
                            value={row.image_url}
                            onChange={(e) =>
                              setProdModal((prev) => ({
                                ...prev,
                                rows: prev.rows.map((r, i) => (i === idx ? { ...r, image_url: e.target.value } : r)),
                              }))
                            }
                            className="agri-input flex-1"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setProdModal({ open: false, isEdit: false, lockedGroup: '', rows: [] })}
                  className="px-3 py-1.5 rounded bg-[#07281c] text-white font-bold cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  disabled={prodSaving}
                  onClick={handleSaveProducts}
                  className="agri-btn-gold inline-flex items-center gap-1.5"
                >
                  {prodSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {prodModal.isEdit ? 'Lưu Sản phẩm' : `Lưu ${prodModal.rows.length} Sản phẩm`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (activeView === 'xnk-shipping') {
    const list = data.schedules.filter((s) => !qLower || `${s.schedule_id} ${s.pol} ${s.pod} ${s.country} ${s.shipping_line}`.toLowerCase().includes(qLower));
    const expiredSchedules = data.schedules.filter((s) => computeFreightExpiryStatus(s).state === 'EXPIRED');

    const handleSaveSchedules = async () => {
      const activeRows = schModal.rows
        .map((r, origIdx) => ({ r, origIdx }))
        .filter(
          ({ r }) => r.schedule_id.trim() || r.shipping_line.trim() || r.pod.trim() || r.country.trim()
        );
      if (activeRows.length === 0) {
        onToast('warning', 'Vui lòng nhập ít nhất 1 tuyến lịch tàu.');
        return;
      }
      setSchSaving(true);
      try {
        const isBulk = !schModal.isEdit;
        let nextSeq = data.schedules.reduce((m, s) => {
          const match = s.schedule_id.match(/SCH-(\d+)/i);
          return match ? Math.max(m, parseInt(match[1], 10)) : m;
        }, data.schedules.length);

        for (let i = 0; i < activeRows.length; i++) {
          const { r, origIdx } = activeRows[i];
          let sid = r.schedule_id.trim();
          if (!sid) {
            nextSeq += 1;
            sid = `SCH-${String(nextSeq).padStart(3, '0')}`;
          }
          const resolvedLogoUrl =
            r.logo_url.trim() ||
            (r.shipping_line.trim() && schLogoStatusMap[origIdx] === 'loaded'
              ? getShippingLineLogoUrl(r.shipping_line)
              : '');
          const payload: ShippingSchedule = {
            schedule_id: sid,
            pol: r.pol.trim(),
            pod: r.pod.trim(),
            country: r.country.trim(),
            pot: r.pot.trim() || '-',
            shipping_line: r.shipping_line.trim(),
            vessel: r.vessel.trim(),
            voyage: r.voyage.trim(),
            etd: r.etd || todayIsoDate(),
            eta: r.eta || todayIsoDate(),
            rate_20_dc: parseLocaleNumber(r.rate_20_dc),
            rate_40_dc: parseLocaleNumber(r.rate_40_dc),
            rate_40_hc: parseLocaleNumber(r.rate_40_hc),
            rate_20_rf: parseLocaleNumber(r.rate_20_rf),
            rate_40_rf: parseLocaleNumber(r.rate_40_rf),
            rate_40_rh: parseLocaleNumber(r.rate_40_rh),
            baf_fee: parseLocaleNumber(r.baf_fee),
            lss_fee: parseLocaleNumber(r.lss_fee),
            pss_fee: parseLocaleNumber(r.pss_fee),
            b_l_fee: parseLocaleNumber(r.b_l_fee),
            seal_fee: parseLocaleNumber(r.seal_fee),
            updated_date: r.updated_date || todayIsoDate(),
            expiry_date: r.expiry_date || todayIsoDate(),
            thc_20_dry: parseLocaleNumber(r.thc_20_dry),
            thc_40_dry: parseLocaleNumber(r.thc_40_dry),
            thc_20_reefer: parseLocaleNumber(r.thc_20_reefer),
            thc_40_reefer: parseLocaleNumber(r.thc_40_reefer),
            bill_seal_fee_shipment: parseLocaleNumber(r.bill_seal_fee_shipment),
            logo_url: resolvedLogoUrl,
          };
          await onUpsertSchedule(payload, schModal.isEdit, isBulk);
        }
        if (isBulk) {
          onToast(
            'success',
            activeRows.length > 1 ? `Đã thêm thành công ${activeRows.length} lịch tàu mới.` : 'Đã lưu lịch tàu mới.'
          );
          await onRefreshData?.();
        }
        setSchModal({ open: false, isEdit: false, rows: [] });
        setSchLogoStatusMap({});
      } catch (err: any) {
        onToast('error', err?.message || 'Lưu lịch tàu thất bại.');
      } finally {
        setSchSaving(false);
      }
    };

    const updateSchRow = (idx: number, patch: Partial<ScheduleDraft>) => {
      setSchModal((prev) => ({
        ...prev,
        rows: prev.rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
      }));
    };

    const handleUploadCarrierLogo = async (idx: number, shippingLineName: string, file: File | null) => {
      if (!file) return;
      const cleanName = shippingLineName.trim();
      if (!cleanName) {
        onToast('warning', 'Vui lòng nhập tên Hãng tàu trước khi tải logo.');
        return;
      }
      setSchLogoUploadingIdx(idx);
      try {
        const publicUrl = await uploadShippingLineLogo(cleanName, file);
        updateSchRow(idx, { logo_url: publicUrl });
        setSchLogoCacheBust(Date.now());
        setSchLogoStatusMap((prev) => ({ ...prev, [idx]: 'loaded' }));
        onToast('success', `Đã tải lên logo hãng tàu ${cleanName} thành công.`);
      } catch (err: any) {
        onToast('error', err?.message || 'Tải logo hãng tàu thất bại.');
      } finally {
        setSchLogoUploadingIdx(null);
      }
    };

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap justify-between gap-2">
          {expiredSchedules.length > 0 && (
            <button
              type="button"
              onClick={() =>
                onRequestConfirm(
                  'Xóa lịch tàu hết hạn?',
                  `Xác nhận xóa ${expiredSchedules.length} tuyến tàu đã quá expiry_date?`,
                  async () => {
                    for (const s of expiredSchedules) {
                      await onDeleteSchedule(s.schedule_id);
                    }
                    onToast('success', `Đã dọn ${expiredSchedules.length} lịch tàu hết hạn.`);
                  },
                  true
                )
              }
              className="px-3 py-2 rounded-lg bg-[#8c3b3b] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" /> Xóa {expiredSchedules.length} lịch hết hạn
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setSchLogoStatusMap({});
              setSchModal({
                open: true,
                isEdit: false,
                rows: [createBlankScheduleDraft()],
              });
            }}
            className="agri-btn-gold flex items-center gap-1.5 ml-auto"
          >
            <Plus className="w-4 h-4" /> Thêm Lịch tàu &amp; Cước
          </button>
        </div>

        <div className="agri-table-wrap">
          <div className="px-4 py-3 bg-[#0f4a33] border-b border-[#186635]">
            <h3 className="text-sm font-extrabold text-[#fff5d6] flex items-center gap-2">
              <Ship className="w-4 h-4 text-[#f4d98a]" /> Lịch tàu &amp; Biểu cước 6 loại Cont ({list.length})
            </h3>
          </div>
          <div className="agri-table-scroll" style={{ maxHeight: '64vh', overflowY: 'auto' }}>
            <table className="agri-table">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="text-center">MÃ LỊCH</th>
                  <th className="text-center w-[64px]">LOGO</th>
                  <th className="text-left">HÃNG TÀU / TÀU</th>
                  <th className="text-left">TUYẾN (POL → POD · QUỐC GIA)</th>
                  <th className="text-left">ETD / ETA</th>
                  <th className="text-left">20'DC / 40'DC / 40'HC (USD)</th>
                  <th className="text-left">20'RF / 40'RF / 40'RH (USD)</th>
                  <th className="text-left">PHỤ PHÍ TÀU (USD)</th>
                  <th className="text-center">HẾT HẠN</th>
                  <th className="text-center">THAO TÁC</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => {
                  const exp = computeFreightExpiryStatus(s);
                  const expiryColorClass =
                    exp.state === 'EXPIRED'
                      ? 'text-red-700 font-bold group-hover:text-red-300'
                      : exp.state === 'EXPIRING'
                      ? 'text-amber-700 font-bold group-hover:text-yellow-300'
                      : 'text-emerald-950 font-semibold group-hover:text-white';
                  const thcDryTxt =
                    s.thc_20_dry > 0 || s.thc_40_dry > 0
                      ? `THC Khô: ${fmtUSD(s.thc_20_dry)} / ${fmtUSD(s.thc_40_dry)}`
                      : '';
                  const thcRfTxt =
                    s.thc_20_reefer > 0 || s.thc_40_reefer > 0
                      ? `THC Lạnh: ${fmtUSD(s.thc_20_reefer)} / ${fmtUSD(s.thc_40_reefer)}`
                      : '';
                  const fuelParts = [
                    s.baf_fee > 0 ? `BAF ${fmtUSD(s.baf_fee)}` : '',
                    s.lss_fee > 0 ? `LSS ${fmtUSD(s.lss_fee)}` : '',
                    s.pss_fee > 0 ? `PSS ${fmtUSD(s.pss_fee)}` : '',
                  ].filter(Boolean);
                  const docSealVal =
                    s.bill_seal_fee_shipment > 0
                      ? s.bill_seal_fee_shipment
                      : s.b_l_fee + s.seal_fee;
                  return (
                    <tr key={s.schedule_id} className="group">
                      <td className="py-2.5 text-center font-mono font-bold whitespace-nowrap">{s.schedule_id}</td>
                      <td className="py-2.5 text-center">
                        <ShippingLineLogoBadge
                          shippingLine={s.shipping_line}
                          logoUrl={s.logo_url}
                          cacheBust={schLogoCacheBust}
                        />
                      </td>
                      <td className="py-2.5 text-left">
                        <div className="font-bold">{s.shipping_line}</div>
                        <div className="text-[11px] opacity-80">{s.vessel} / {s.voyage}</div>
                      </td>
                      <td className="py-2.5 text-left">
                        <div className="font-semibold">
                          {deduplicatePortName(s.pol)} → {deduplicatePortName(s.pod)}
                        </div>
                        <div className="text-[11px]">{s.country} {s.pot && s.pot !== '-' ? `· POT: ${s.pot}` : ''}</div>
                      </td>
                      <td className="py-2.5 text-left font-mono text-xs whitespace-nowrap leading-5">
                        <div>ETD: {formatDateDDMMYYYY(s.etd)}</div>
                        <div>ETA: {formatDateDDMMYYYY(s.eta)}</div>
                      </td>
                      <td className="py-2.5 text-left font-mono text-xs whitespace-nowrap leading-5">
                        <div>20'DC: {fmtUSD(s.rate_20_dc)}</div>
                        <div>40'DC: {fmtUSD(s.rate_40_dc)}</div>
                        <div>40'HC: {fmtUSD(s.rate_40_hc)}</div>
                      </td>
                      <td className="py-2.5 text-left font-mono text-xs whitespace-nowrap leading-5">
                        <div>20'RF: {fmtUSD(s.rate_20_rf)}</div>
                        <div>40'RF: {fmtUSD(s.rate_40_rf)}</div>
                        <div>40'RH: {fmtUSD(s.rate_40_rh)}</div>
                      </td>
                      <td className="py-2.5 text-left font-mono text-[11px] whitespace-nowrap leading-4 space-y-0.5">
                        {thcDryTxt && <div>{thcDryTxt}</div>}
                        {thcRfTxt && <div>{thcRfTxt}</div>}
                        {fuelParts.length > 0 && <div>{fuelParts.join(' · ')}</div>}
                        {docSealVal > 0 && (
                          <div>
                            B/L+Seal: {fmtUSD(docSealVal)}
                            {s.bill_seal_fee_shipment <= 0 && (s.b_l_fee > 0 || s.seal_fee > 0)
                              ? ` (${fmtUSD(s.b_l_fee)}+${fmtUSD(s.seal_fee)})`
                              : ''}
                          </div>
                        )}
                        {!thcDryTxt && !thcRfTxt && fuelParts.length === 0 && docSealVal <= 0 && (
                          <span className="opacity-60 italic">Chưa nhập phụ phí</span>
                        )}
                      </td>
                      <td className="py-2.5 keep-hover-color text-center whitespace-nowrap">
                        <span className={`keep-hover-color font-mono text-xs ${expiryColorClass}`}>
                          {formatDateDDMMYYYY(s.expiry_date)}
                        </span>
                      </td>
                      <td className="py-2.5 text-center">
                        <div className="inline-flex flex-wrap items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setSchLogoStatusMap({});
                              setSchModal({ open: true, isEdit: true, rows: [scheduleToDraft(s)] });
                            }}
                            className="keep-btn-style px-2 py-1 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold cursor-pointer"
                          >
                            Sửa
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onRequestConfirm('Xóa lịch tàu?', `Xác nhận xóa ${s.schedule_id}?`, () => onDeleteSchedule(s.schedule_id), true)
                            }
                            className="keep-btn-style px-2 py-1 rounded bg-[#8c3b3b] text-white text-[11px] font-bold cursor-pointer"
                          >
                            Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {schModal.open && schModal.rows.length > 0 && (
          <div className="fixed inset-0 z-50 bg-[#07281c]/75 flex items-center justify-center p-4">
            <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-5 text-[#f4f8f5] space-y-3.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-base font-extrabold text-[#fff5d6]">
                  {schModal.isEdit
                    ? `Sửa Lịch tàu ${schModal.rows[0].schedule_id}`
                    : `Thêm Lịch tàu & Cước Mới (${schModal.rows.length} dòng)`}
                </h4>
                {!schModal.isEdit && (
                  <button
                    type="button"
                    onClick={() =>
                      setSchModal((prev) => ({
                        ...prev,
                        rows: [...prev.rows, createBlankScheduleDraft()],
                      }))
                    }
                    className="px-3 py-1.5 rounded-lg bg-[#0f4a33] border border-[#f4d98a]/70 text-[#f4d98a] font-bold flex items-center gap-1 cursor-pointer hover:bg-[#135c3f]"
                  >
                    <Plus className="w-3.5 h-3.5" /> Thêm dòng mới
                  </button>
                )}
              </div>

              <div className="space-y-3.5">
                {schModal.rows.map((row, idx) => (
                  <div key={idx} className="rounded-xl bg-[#07281c]/30 border border-[#186635] p-3.5 space-y-2.5">
                    {!schModal.isEdit && (
                      <div className="flex items-center justify-between border-b border-white/15 pb-1.5">
                        <span className="font-extrabold text-[#f4d98a]">Tuyến #{idx + 1}</span>
                        {schModal.rows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              setSchLogoStatusMap({});
                              setSchModal((prev) => ({
                                ...prev,
                                rows: prev.rows.filter((_, i) => i !== idx),
                              }));
                            }}
                            className="px-2 py-0.5 rounded bg-[#8c3b3b] text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" /> Xóa dòng
                          </button>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <div>
                        <label className="block font-bold mb-1">Schedule ID</label>
                        <input
                          disabled={schModal.isEdit}
                          value={row.schedule_id}
                          placeholder="VD: SCH-001 (để trống tự cấp)"
                          onChange={(e) => updateSchRow(idx, { schedule_id: e.target.value })}
                          className="agri-input font-mono"
                        />
                      </div>
                      <div className="col-span-2 sm:col-span-2">
                        <label className="block font-bold mb-1">Hãng tàu &amp; Logo tự động</label>
                        <div className="flex items-center gap-2">
                          <ShippingLineLogoBadge
                            shippingLine={row.shipping_line}
                            logoUrl={row.logo_url}
                            cacheBust={schLogoCacheBust}
                            onStatusChange={(st) => {
                              setSchLogoStatusMap((prev) => (prev[idx] === st ? prev : { ...prev, [idx]: st }));
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <SearchableCombo
                              value={row.shipping_line}
                              onChange={(val) => {
                                const matchedExisting = data.schedules.find(
                                  (s) => s.shipping_line.trim().toLowerCase() === val.trim().toLowerCase() && s.logo_url
                                );
                                updateSchRow(idx, {
                                  shipping_line: val,
                                  logo_url: matchedExisting?.logo_url || '',
                                });
                              }}
                              options={scheduleShippingLineOptions}
                              allowCustom
                              placeholder="VD: Maersk / ONE / CMA CGM"
                            />
                          </div>
                          {row.shipping_line.trim() && schLogoStatusMap[idx] === 'missing' && (
                            <label
                              className="px-2.5 py-2 rounded-lg bg-[#f4d98a] text-[#07281c] border border-[#186635] font-bold text-[11px] inline-flex items-center gap-1 cursor-pointer hover:brightness-105 shrink-0 whitespace-nowrap"
                              title="Chưa có logo trong Storage — chọn ảnh để tải lên tự động"
                            >
                              {schLogoUploadingIdx === idx ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Upload className="w-3.5 h-3.5" />
                              )}
                              <span>{schLogoUploadingIdx === idx ? 'Đang tải...' : 'Tải logo'}</span>
                              <input
                                type="file"
                                accept="image/*"
                                disabled={schLogoUploadingIdx === idx}
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0] || null;
                                  void handleUploadCarrierLogo(idx, row.shipping_line, f);
                                  e.target.value = '';
                                }}
                              />
                            </label>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="block font-bold mb-1">Quốc gia đến</label>
                        <SearchableCombo
                          value={row.country}
                          onChange={(v) => updateSchRow(idx, { country: v })}
                          options={scheduleCountryOptions}
                          allowCustom
                          placeholder="VD: Japan / USA / Germany"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">POD</label>
                        <SearchableCombo
                          value={row.pod}
                          onChange={(v) => updateSchRow(idx, { pod: v })}
                          options={getPodOptionsForCountry(row.country)}
                          allowCustom
                          placeholder="VD: Tokyo / Rotterdam"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">POL</label>
                        <SearchableCombo
                          value={row.pol}
                          onChange={(v) => updateSchRow(idx, { pol: v })}
                          options={schedulePolOptions}
                          allowCustom
                          placeholder="VD: Cát Lái (HCMC)"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">POT (Chuyển tải)</label>
                        <input
                          value={row.pot}
                          placeholder="VD: Singapore (hoặc -)"
                          onChange={(e) => updateSchRow(idx, { pot: e.target.value })}
                          className="agri-input"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">Tàu (Vessel)</label>
                        <input
                          value={row.vessel}
                          placeholder="VD: MV ONE HARMONY"
                          onChange={(e) => updateSchRow(idx, { vessel: e.target.value })}
                          className="agri-input"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">Chuyến (Voyage)</label>
                        <input
                          value={row.voyage}
                          placeholder="VD: 045E"
                          onChange={(e) => updateSchRow(idx, { voyage: e.target.value })}
                          className="agri-input font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">ETD</label>
                        <input
                          type="date"
                          value={row.etd}
                          onChange={(e) => updateSchRow(idx, { etd: e.target.value })}
                          className="agri-input font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">ETA</label>
                        <input
                          type="date"
                          value={row.eta}
                          onChange={(e) => updateSchRow(idx, { eta: e.target.value })}
                          className="agri-input font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">Hết hạn cước</label>
                        <input
                          type="date"
                          value={row.expiry_date}
                          onChange={(e) => updateSchRow(idx, { expiry_date: e.target.value })}
                          className="agri-input font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">Bill+Seal / Lô ($)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.bill_seal_fee_shipment}
                          placeholder="VD: 55.00"
                          onChange={(e) => updateSchRow(idx, { bill_seal_fee_shipment: e.target.value })}
                          className="agri-input font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">Rate 20'DC ($)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.rate_20_dc}
                          placeholder="VD: 1,200.00"
                          onChange={(e) => updateSchRow(idx, { rate_20_dc: e.target.value })}
                          className="agri-input font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">Rate 40'DC ($)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.rate_40_dc}
                          placeholder="VD: 2,100.00"
                          onChange={(e) => updateSchRow(idx, { rate_40_dc: e.target.value })}
                          className="agri-input font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">Rate 40'HC ($)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.rate_40_hc}
                          placeholder="VD: 2,250.00"
                          onChange={(e) => updateSchRow(idx, { rate_40_hc: e.target.value })}
                          className="agri-input font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">Rate 20'RF ($)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.rate_20_rf}
                          placeholder="VD: 1,850.00"
                          onChange={(e) => updateSchRow(idx, { rate_20_rf: e.target.value })}
                          className="agri-input font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">Rate 40'RF ($)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.rate_40_rf}
                          placeholder="VD: 3,100.00"
                          onChange={(e) => updateSchRow(idx, { rate_40_rf: e.target.value })}
                          className="agri-input font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">Rate 40'RH ($)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.rate_40_rh}
                          placeholder="VD: 3,300.00"
                          onChange={(e) => updateSchRow(idx, { rate_40_rh: e.target.value })}
                          className="agri-input font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">THC 20 Dry ($)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.thc_20_dry}
                          placeholder="VD: 135.00"
                          onChange={(e) => updateSchRow(idx, { thc_20_dry: e.target.value })}
                          className="agri-input font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">THC 40 Dry ($)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.thc_40_dry}
                          placeholder="VD: 210.00"
                          onChange={(e) => updateSchRow(idx, { thc_40_dry: e.target.value })}
                          className="agri-input font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">THC 20 Reefer ($)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.thc_20_reefer}
                          placeholder="VD: 185.00"
                          onChange={(e) => updateSchRow(idx, { thc_20_reefer: e.target.value })}
                          className="agri-input font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">THC 40 Reefer ($)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.thc_40_reefer}
                          placeholder="VD: 275.00"
                          onChange={(e) => updateSchRow(idx, { thc_40_reefer: e.target.value })}
                          className="agri-input font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">B/L Fee ($)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.b_l_fee}
                          placeholder="VD: 45.00"
                          onChange={(e) => updateSchRow(idx, { b_l_fee: e.target.value })}
                          className="agri-input font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">Seal Fee ($)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.seal_fee}
                          placeholder="VD: 10.00"
                          onChange={(e) => updateSchRow(idx, { seal_fee: e.target.value })}
                          className="agri-input font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">BAF ($/cont)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.baf_fee}
                          placeholder="VD: 150.00"
                          onChange={(e) => updateSchRow(idx, { baf_fee: e.target.value })}
                          className="agri-input font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">LSS ($/cont)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.lss_fee}
                          placeholder="VD: 40.00"
                          onChange={(e) => updateSchRow(idx, { lss_fee: e.target.value })}
                          className="agri-input font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-bold mb-1">PSS ($/cont)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.pss_fee}
                          placeholder="VD: 100.00"
                          onChange={(e) => updateSchRow(idx, { pss_fee: e.target.value })}
                          className="agri-input font-mono"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSchModal({ open: false, isEdit: false, rows: [] })}
                  className="px-3 py-1.5 rounded bg-[#07281c] text-white font-bold cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  disabled={schSaving}
                  onClick={handleSaveSchedules}
                  className="agri-btn-gold inline-flex items-center gap-1.5"
                >
                  {schSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {schModal.isEdit ? 'Lưu Lịch tàu' : `Lưu ${schModal.rows.length} Lịch tàu`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (activeView === 'xnk-rates') {
    const categories = ['ALL', ...RATE_CATEGORY_OPTIONS];
    const list = data.pricingRates.filter(
      (r) =>
        (rateCat === 'ALL' || r.fee_category.toUpperCase() === rateCat) &&
        (!qLower || `${r.fee_code} ${r.fee_name_vie} ${r.contract_text_eng} ${r.fee_category}`.toLowerCase().includes(qLower))
    );

    const updateRateRow = (idx: number, patch: Partial<RateDraft>) => {
      setRateModal((prev) => ({
        ...prev,
        rows: prev.rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
      }));
    };

    const handleTranslateRateRow = async (idx: number) => {
      const row = rateModal.rows[idx];
      if (!row || !row.fee_name_vie.trim()) {
        onToast('warning', 'Vui lòng nhập Tên Tiếng Việt trước khi dịch.');
        return;
      }
      const catUpper = (rateModal.lockedCategory || row.fee_category || '').toUpperCase();
      const ctx =
        catUpper === 'INSURANCE'
          ? 'INSURANCE'
          : catUpper === 'PACKING'
          ? 'PACKING'
          : catUpper === 'CONTAINER'
          ? 'CONTAINER'
          : 'RATE';
      const key = `rate-${idx}`;
      setTranslatingKey(key);
      try {
        const eng = await translateVIEtoENGSmart(row.fee_name_vie, ctx);
        updateRateRow(idx, { contract_text_eng: eng });
      } catch (err: any) {
        onToast('error', err?.message || 'Không thể dịch mô tả biểu phí.');
      } finally {
        setTranslatingKey(null);
      }
    };

    const handleSaveRates = async () => {
      const activeRows = rateModal.rows.filter(
        (r) => r.fee_code.trim() || r.fee_name_vie.trim() || r.contract_text_eng.trim()
      );
      if (activeRows.length === 0) {
        onToast('warning', 'Vui lòng nhập ít nhất 1 dòng biểu phí.');
        return;
      }
      for (let i = 0; i < activeRows.length; i++) {
        const r = activeRows[i];
        const cat = (rateModal.lockedCategory || r.fee_category).trim();
        if (!cat) {
          onToast('warning', `Dòng ${i + 1}: Vui lòng chọn Nhóm phí (Fee_Category).`);
          return;
        }
        if (!r.fee_code.trim()) {
          onToast('warning', `Dòng ${i + 1}: Vui lòng nhập Mã phí (Fee_Code).`);
          return;
        }
      }
      setRateSaving(true);
      try {
        const isBulk = !rateModal.isEdit;
        for (const r of activeRows) {
          const payload: PricingRate = {
            fee_category: (rateModal.lockedCategory || r.fee_category).trim().toUpperCase(),
            fee_code: r.fee_code.trim(),
            scope_or_cont_type: r.scope_or_cont_type.trim(),
            fee_name_vie: r.fee_name_vie.trim(),
            contract_text_eng: r.contract_text_eng.trim(),
            unit_basis: r.unit_basis.trim(),
            standard_rate: parseLocaleNumber(r.standard_rate),
            provider_or_rule: r.provider_or_rule.trim(),
            note: r.note.trim(),
            dim_cm: r.dim_cm.trim(),
            net_kg: parseLocaleNumber(r.net_kg),
            tare_kg: parseLocaleNumber(r.tare_kg),
            max_per_pallet: parseLocaleNumber(r.max_per_pallet),
          };
          await onUpsertRate(payload, rateModal.isEdit, isBulk);
        }
        if (isBulk) {
          onToast(
            'success',
            activeRows.length > 1 ? `Đã thêm thành công ${activeRows.length} biểu phí mới.` : 'Đã lưu biểu phí mới.'
          );
          await onRefreshData?.();
        }
        setRateModal({ open: false, isEdit: false, lockedCategory: '', rows: [] });
      } catch (err: any) {
        onToast('error', err?.message || 'Lưu biểu phí thất bại.');
      } finally {
        setRateSaving(false);
      }
    };

    const getPlaceholdersForCategory = (catRaw: string) => {
      const cat = catRaw.toUpperCase();
      if (cat === 'INSURANCE') {
        return {
          code: 'VD: INS-FROZEN-A',
          vie: 'VD: Bảo hiểm hàng đông lạnh',
          eng: 'VD: Institute Frozen Food Clauses (A)',
          scope: 'VD: REEFER / ALL / ADD-ON',
          unit: 'VD: %_CIF_110',
          rate: 'VD: 0.35',
          dim: 'VD: -',
        };
      }
      if (cat === 'PACKING') {
        return {
          code: 'VD: PKG-CTN-10K',
          vie: 'VD: Thùng Carton 10kg (5 lớp)',
          eng: 'VD: 10kg 5-Ply Corrugated Carton',
          scope: 'VD: ALL / REEFER',
          unit: 'VD: Carton / Bag / Pallet',
          rate: 'VD: 0.85',
          dim: 'VD: 40x30x25',
        };
      }
      if (cat === 'CONTAINER') {
        return {
          code: 'VD: CONT-20RF',
          vie: 'VD: Container Lạnh 20 feet',
          eng: "VD: 20' Reefer Container (20'RF)",
          scope: "VD: 20'RF",
          unit: 'VD: Container',
          rate: 'VD: 0.00',
          dim: 'VD: 545x229x227',
        };
      }
      if (cat === 'CUSTOMS_FEE') {
        return {
          code: 'VD: CUS-PHYTO',
          vie: 'VD: Chứng nhận Kiểm dịch Thực vật',
          eng: 'VD: Phytosanitary Certificate',
          scope: 'VD: ALL',
          unit: 'VD: Shipment / Set',
          rate: 'VD: 35.00',
          dim: 'VD: -',
        };
      }
      return {
        code: 'VD: THC-20DC',
        vie: 'VD: Phụ phí Xếp dỡ tại Cảng (THC)',
        eng: 'VD: Terminal Handling Charge (THC)',
        scope: "VD: 20'DC / ALL",
        unit: 'VD: Container / Shipment',
        rate: 'VD: 135.00',
        dim: 'VD: 40x30x25',
      };
    };

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1 bg-[#07281c] p-1 rounded-xl border border-[#186635]">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setRateCat(cat)}
                className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                  rateCat === cat ? 'bg-[#f4d98a] text-[#07281c]' : 'text-[#d2ebe0]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              const locked = rateCat === 'ALL' ? '' : rateCat;
              setRateModal({
                open: true,
                isEdit: false,
                lockedCategory: locked,
                rows: [createBlankRateDraft(locked)],
              });
            }}
            className="agri-btn-gold flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Thêm Phụ phí / Quy cách
          </button>
        </div>

        <div className="agri-table-wrap">
          <div className="px-4 py-3 bg-[#0f4a33] border-b border-[#186635]">
            <h3 className="text-sm font-extrabold text-[#fff5d6] flex items-center gap-2">
              <Receipt className="w-4 h-4 text-[#f4d98a]" /> Bảng giá Phụ phí, Bao bì, Bảo hiểm &amp; Container ({list.length})
            </h3>
          </div>
          <div className="agri-table-scroll">
            <table className="agri-table">
              <thead>
                <tr>
                  <th className="text-center">Nhóm</th>
                  <th className="text-center">Mã phí</th>
                  <th className="text-left">Tên Tiếng Việt / ENG</th>
                  <th className="text-center">Phạm vi / ĐVT</th>
                  <th className="text-center">Đơn giá chuẩn (USD)</th>
                  <th className="text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.fee_code}>
                    <td className="text-center font-mono text-xs font-bold whitespace-nowrap">{r.fee_category}</td>
                    <td className="text-center font-mono font-bold whitespace-nowrap">{r.fee_code}</td>
                    <td className="text-left">
                      <div className="font-bold">{r.fee_name_vie}</div>
                      <div className="text-[11px] opacity-80">{r.contract_text_eng}</div>
                    </td>
                    <td className="text-center text-xs">{r.scope_or_cont_type} · {r.unit_basis}</td>
                    <td className="text-center font-mono font-extrabold whitespace-nowrap">{fmtDecimal(r.standard_rate, 2)}</td>
                    <td className="text-center">
                      <div className="inline-flex flex-wrap items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setRateModal({
                              open: true,
                              isEdit: true,
                              lockedCategory: '',
                              rows: [rateToDraft(r)],
                            })
                          }
                          className="keep-btn-style px-2 py-1 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold cursor-pointer"
                        >
                          Sửa
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onRequestConfirm('Xóa phụ phí?', `Xác nhận xóa ${r.fee_code}?`, () => onDeleteRate(r.fee_code), true)
                          }
                          className="keep-btn-style px-2 py-1 rounded bg-[#8c3b3b] text-white text-[11px] font-bold cursor-pointer"
                        >
                          Xóa
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {rateModal.open && rateModal.rows.length > 0 && (
          <div className="fixed inset-0 z-50 bg-[#07281c]/75 flex items-center justify-center p-4">
            <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5 text-[#f4f8f5] space-y-3.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-base font-extrabold text-[#fff5d6]">
                    {rateModal.isEdit ? 'Sửa Biểu phí' : `Thêm Biểu phí Mới (${rateModal.rows.length} dòng)`}
                  </h4>
                  {!rateModal.isEdit && rateModal.lockedCategory && (
                    <p className="text-[11px] text-[#f4d98a] flex items-center gap-1 mt-0.5">
                      <Lock className="w-3 h-3" /> Đang thêm cố định vào nhóm: <strong>{rateModal.lockedCategory}</strong>
                    </p>
                  )}
                </div>
                {!rateModal.isEdit && (
                  <button
                    type="button"
                    onClick={() =>
                      setRateModal((prev) => ({
                        ...prev,
                        rows: [...prev.rows, createBlankRateDraft(prev.lockedCategory)],
                      }))
                    }
                    className="px-3 py-1.5 rounded-lg bg-[#0f4a33] border border-[#f4d98a]/70 text-[#f4d98a] font-bold flex items-center gap-1 cursor-pointer hover:bg-[#135c3f]"
                  >
                    <Plus className="w-3.5 h-3.5" /> Thêm dòng mới
                  </button>
                )}
              </div>

              <div className="space-y-3">
                {rateModal.rows.map((row, idx) => {
                  const activeCat = rateModal.lockedCategory || row.fee_category;
                  const ph = getPlaceholdersForCategory(activeCat);
                  return (
                    <div key={idx} className="rounded-xl bg-[#07281c]/30 border border-[#186635] p-3.5 space-y-2.5">
                      {!rateModal.isEdit && (
                        <div className="flex items-center justify-between border-b border-white/15 pb-1.5">
                          <span className="font-extrabold text-[#f4d98a]">Dòng #{idx + 1}</span>
                          {rateModal.rows.length > 1 && (
                            <button
                              type="button"
                              onClick={() =>
                                setRateModal((prev) => ({
                                  ...prev,
                                  rows: prev.rows.filter((_, i) => i !== idx),
                                }))
                              }
                              className="px-2 py-0.5 rounded bg-[#8c3b3b] text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" /> Xóa dòng
                            </button>
                          )}
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block font-bold mb-1 flex items-center gap-1">
                            Nhóm (Fee_Category) *
                            {!rateModal.isEdit && rateModal.lockedCategory && <Lock className="w-3 h-3 text-[#f4d98a]" />}
                          </label>
                          <select
                            disabled={!rateModal.isEdit && Boolean(rateModal.lockedCategory)}
                            value={activeCat}
                            onChange={(e) => updateRateRow(idx, { fee_category: e.target.value })}
                            className={`agri-input font-mono ${
                              !rateModal.isEdit && rateModal.lockedCategory ? 'opacity-80 cursor-not-allowed font-bold' : ''
                            }`}
                          >
                            <option value="">-- Chọn nhóm phí --</option>
                            {RATE_CATEGORY_OPTIONS.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block font-bold mb-1">Mã phí (Fee_Code) *</label>
                          <input
                            disabled={rateModal.isEdit}
                            value={row.fee_code}
                            placeholder={ph.code}
                            onChange={(e) => updateRateRow(idx, { fee_code: e.target.value })}
                            className="agri-input font-mono"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block font-bold mb-1">Tên Tiếng Việt</label>
                          <input
                            value={row.fee_name_vie}
                            placeholder={ph.vie}
                            onChange={(e) => updateRateRow(idx, { fee_name_vie: e.target.value })}
                            className="agri-input"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <div className="flex items-center justify-between mb-1">
                            <label className="font-bold">Mô tả Hợp đồng (ENG)</label>
                            <button
                              type="button"
                              disabled={translatingKey === `rate-${idx}` || !row.fee_name_vie.trim()}
                              onClick={() => handleTranslateRateRow(idx)}
                              className="px-2 py-0.5 rounded bg-[#0f4a33] text-[#f4d98a] border border-[#f4d98a]/50 text-[10.5px] font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            >
                              {translatingKey === `rate-${idx}` ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Languages className="w-3 h-3" />
                              )}
                              Dịch sang Anh
                            </button>
                          </div>
                          <input
                            value={row.contract_text_eng}
                            placeholder={ph.eng}
                            onChange={(e) => updateRateRow(idx, { contract_text_eng: e.target.value })}
                            className="agri-input"
                          />
                        </div>

                        <div>
                          <label className="block font-bold mb-1">Phạm vi / Cont</label>
                          <input
                            value={row.scope_or_cont_type}
                            placeholder={ph.scope}
                            onChange={(e) => updateRateRow(idx, { scope_or_cont_type: e.target.value })}
                            className="agri-input"
                          />
                        </div>
                        <div>
                          <label className="block font-bold mb-1">Đơn vị tính</label>
                          <input
                            value={row.unit_basis}
                            placeholder={ph.unit}
                            onChange={(e) => updateRateRow(idx, { unit_basis: e.target.value })}
                            className="agri-input"
                          />
                        </div>

                        <div>
                          <label className="block font-bold mb-1">Mức phí chuẩn</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={row.standard_rate}
                            placeholder={ph.rate}
                            onChange={(e) => updateRateRow(idx, { standard_rate: e.target.value })}
                            className="agri-input font-mono font-bold"
                          />
                        </div>
                        <div>
                          <label className="block font-bold mb-1">Kích thước (Dim CM)</label>
                          <input
                            value={row.dim_cm}
                            placeholder={ph.dim}
                            onChange={(e) => updateRateRow(idx, { dim_cm: e.target.value })}
                            className="agri-input font-mono"
                          />
                        </div>

                        <div>
                          <label className="block font-bold mb-1">
                            {activeCat.toUpperCase() === 'CONTAINER' ? 'Tải trọng tối đa (KG)' : 'Net Weight (KG)'}
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={row.net_kg}
                            placeholder={activeCat.toUpperCase() === 'CONTAINER' ? 'VD: 27,400' : 'VD: 10.00'}
                            onChange={(e) => updateRateRow(idx, { net_kg: e.target.value })}
                            className="agri-input font-mono"
                          />
                        </div>
                        <div>
                          <label className="block font-bold mb-1">
                            {activeCat.toUpperCase() === 'CONTAINER' ? 'Thể tích tối đa (CBM)' : 'Tare Weight (KG)'}
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={row.tare_kg}
                            placeholder={activeCat.toUpperCase() === 'CONTAINER' ? 'VD: 24.00' : 'VD: 0.85'}
                            onChange={(e) => updateRateRow(idx, { tare_kg: e.target.value })}
                            className="agri-input font-mono"
                          />
                        </div>

                        <div>
                          <label className="block font-bold mb-1">Max kiện / Pallet</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={row.max_per_pallet}
                            placeholder="VD: 50"
                            onChange={(e) => updateRateRow(idx, { max_per_pallet: e.target.value })}
                            className="agri-input font-mono"
                          />
                        </div>
                        <div>
                          <label className="block font-bold mb-1">Nhà cung cấp / Quy tắc</label>
                          <input
                            value={row.provider_or_rule}
                            placeholder="VD: PVI / Bảo Việt / Hãng tàu"
                            onChange={(e) => updateRateRow(idx, { provider_or_rule: e.target.value })}
                            className="agri-input"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block font-bold mb-1">Ghi chú</label>
                          <input
                            value={row.note}
                            placeholder="VD: Điều khoản mở rộng: Rủi ro hấp hơi, nóng ẩm..."
                            onChange={(e) => updateRateRow(idx, { note: e.target.value })}
                            className="agri-input"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRateModal({ open: false, isEdit: false, lockedCategory: '', rows: [] })}
                  className="px-3 py-1.5 rounded bg-[#07281c] text-white font-bold cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  disabled={rateSaving}
                  onClick={handleSaveRates}
                  className="agri-btn-gold inline-flex items-center gap-1.5"
                >
                  {rateSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {rateModal.isEdit ? 'Lưu Biểu phí' : `Lưu ${rateModal.rows.length} Biểu phí`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (activeView === 'admin-templates') {
    const openTagReviewModal = async (
      templateForm: TemplateManager,
      isEdit: boolean,
      buffer: ArrayBuffer
    ) => {
      const blocks = await extractDocxParagraphBlocks(buffer);
      if (blocks.length === 0) {
        onToast('warning', 'Không đọc được nội dung văn bản trong tệp .docx này.');
        return;
      }
      setTagBlockSearch('');
      setTagOnlyMarked(false);
      setTagEditorTab('edit');
      setPickerSearch('');
      setActiveBlockId(blocks[0]?.id || null);
      activeCursorRef.current = null;
      setTagEditor({
        open: true,
        isEdit,
        templateForm: {
          ...templateForm,
          target_department: normalizeTemplateDepartment(
            templateForm.target_department,
            templateForm.template_id,
            templateForm.document_name
          ),
        },
        buffer,
        blocks,
        pendingNewPlaceholders: [],
        updatedBlockIds: [],
      });
    };

    const handleSelectDocxFile = async (file: File | null) => {
      setTplFile(file);
      setTplDetectedTags([]);
      if (!file || !tplModal.form) return;
      try {
        const buf = await file.arrayBuffer();
        const tags = await extractPlaceholdersFromDocx(buf);
        setTplDetectedTags(tags);

        const baseName = file.name.replace(/\.docx$/i, '');
        const cleanAutoId =
          tplModal.form.template_id.trim() ||
          `TMP_${baseName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
        const nextDept = normalizeTemplateDepartment(
          tplModal.form.target_department,
          cleanAutoId,
          tplModal.form.document_name || baseName
        );
        const updatedForm: TemplateManager = {
          ...tplModal.form,
          template_id: cleanAutoId,
          document_name: tplModal.form.document_name || baseName,
          target_department: nextDept,
          google_doc_file_id: `templates/${cleanAutoId}.docx`,
          supported_placeholders:
            tags.length > 0
              ? formatPlaceholderListWrapped(tags)
              : formatPlaceholderListWrapped(tplModal.form.supported_placeholders),
        };
        setTplModal({
          ...tplModal,
          form: updatedForm,
        });

        // Always open interactive #-Marker Template Variable Review Editor immediately whenever a .docx file is selected
        await openTagReviewModal(updatedForm, tplModal.isEdit, buf);
      } catch (err: any) {
        onToast('error', err?.message || 'Tệp .docx không hợp lệ.');
      }
    };

    const handleUploadTaggedDocx = async () => {
      if (!tplModal.form || !tplFile) return;
      const cleanId = tplModal.form.template_id.trim();
      if (!cleanId) {
        onToast('warning', 'Vui lòng nhập Template ID.');
        return;
      }
      setTplBusy(true);
      try {
        const buf = await tplFile.arrayBuffer();
        const tags = await extractPlaceholdersFromDocx(buf);
        const storagePath = await uploadTemplateDocx(cleanId, buf);
        const mergedKeys = parsePlaceholderKeyList(
          [...tags, ...parsePlaceholderKeyList(tplModal.form.supported_placeholders)].join(', ')
        );
        const nextRow: TemplateManager = {
          ...tplModal.form,
          template_id: cleanId,
          target_department: normalizeTemplateDepartment(
            tplModal.form.target_department,
            cleanId,
            tplModal.form.document_name
          ),
          google_doc_file_id: storagePath,
          supported_placeholders: formatPlaceholderListWrapped(mergedKeys),
        };
        await onUpsertTemplate(nextRow, tplModal.isEdit);
        setTplModal({ open: false, isEdit: false, form: null });
        setTplFile(null);
      } catch (err: any) {
        onToast('error', err?.message || 'Lỗi tải phôi .docx.');
      } finally {
        setTplBusy(false);
      }
    };

    const handleOpenTagEditorFromModal = async () => {
      if (!tplModal.form) return;
      if (!tplModal.form.template_id.trim()) {
        onToast('warning', 'Vui lòng nhập Template ID trước khi mở trình gắn biến.');
        return;
      }
      setTplBusy(true);
      try {
        let buf: ArrayBuffer;
        if (tplFile) {
          buf = await tplFile.arrayBuffer();
        } else if (tplModal.form.google_doc_file_id) {
          buf = await downloadTemplateDocx(tplModal.form.google_doc_file_id);
        } else {
          onToast('warning', 'Vui lòng chọn tệp .docx trước khi gắn biến.');
          return;
        }
        await openTagReviewModal(tplModal.form, tplModal.isEdit, buf);
      } catch (err: any) {
        onToast('error', err?.message || 'Không thể mở tệp phôi để gắn biến.');
      } finally {
        setTplBusy(false);
      }
    };

    const handleUpdateTagBlockText = (blockId: string, nextText: string) => {
      setTagEditor((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          blocks: prev.blocks.map((b) => (b.id === blockId ? { ...b, text: nextText } : b)),
        };
      });
    };

    const handleInsertSnippetAtCursor = (snippet: string, explicitBlockId?: string) => {
      if (!tagEditor) return;
      const targetId = explicitBlockId || activeBlockId || tagEditor.blocks[0]?.id;
      if (!targetId) return;

      const block = tagEditor.blocks.find((b) => b.id === targetId);
      if (!block) return;

      const normalizedSnippet =
        /^\{\{[^}]+\}\}$/.test(snippet.trim()) || /^[A-Za-z0-9_.\-\s]+$/.test(snippet.trim())
          ? normalizePlaceholderTag(snippet) || snippet
          : snippet;

      const cursor =
        activeCursorRef.current && activeCursorRef.current.blockId === targetId
          ? activeCursorRef.current
          : { blockId: targetId, start: block.text.length, end: block.text.length };

      const before = block.text.slice(0, cursor.start);
      const after = block.text.slice(cursor.end);
      const nextText = `${before}${normalizedSnippet}${after}`;
      const nextCaret = cursor.start + normalizedSnippet.length;

      handleUpdateTagBlockText(targetId, nextText);
      setActiveBlockId(targetId);
      activeCursorRef.current = { blockId: targetId, start: nextCaret, end: nextCaret };

      window.requestAnimationFrame(() => {
        const el = blockTextareaRefs.current[targetId];
        if (el) {
          el.focus();
          el.setSelectionRange(nextCaret, nextCaret);
        }
      });
    };

    const handleRemoveTagFromBlock = (blockId: string, tagKey: string) => {
      if (!tagEditor) return;
      const block = tagEditor.blocks.find((b) => b.id === blockId);
      if (!block) return;
      const escaped = tagKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const nextText = block.text
        .replace(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'g'), '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      handleUpdateTagBlockText(blockId, nextText);
    };

    const handleSmartFillHashMarkers = async () => {
      if (!tagEditor) return;
      const markedIndices: number[] = [];
      tagEditor.blocks.forEach((b, idx) => {
        if (b.text.includes('#')) markedIndices.push(idx);
      });

      if (markedIndices.length === 0) {
        onToast(
          'warning',
          'Vui lòng điền ít nhất một dấu # vào vị trí cần gán dữ liệu trong văn bản trước khi bấm Tự động nhận diện.'
        );
        return;
      }

      setTagEditorBusy(true);
      try {
        const markedBlocksPayload = markedIndices.map((idx) => {
          const b = tagEditor.blocks[idx];
          const prevBlock = idx > 0 ? tagEditor.blocks[idx - 1] : undefined;
          const nextBlock = idx < tagEditor.blocks.length - 1 ? tagEditor.blocks[idx + 1] : undefined;
          const prevContext = [b.contextHint, prevBlock?.text].filter(Boolean).join(' | ');
          return {
            id: b.id,
            text: b.text,
            prevText: prevContext,
            nextText: nextBlock?.text || '',
          };
        });

        const resp = await fetch('/api/gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'smart_fill_hash_markers',
            documentName: tagEditor.templateForm.document_name || tagEditor.templateForm.template_id,
            targetDepartment: tagEditor.templateForm.target_department,
            markedBlocks: markedBlocksPayload,
            existingPlaceholders: data.templatePlaceholders.map((p) => ({
              placeholder_key: stripPlaceholderBraces(p.placeholder_key),
              scope: p.scope,
              source_table: p.source_table,
              source_column: p.source_column,
              description_vie: p.description_vie,
            })),
          }),
        });
        const json = await resp.json();
        if (!resp.ok || !json.success) {
          throw new Error(json.message || 'Không thể tự động nhận diện biến cho các dấu #.');
        }

        const replacements = (Array.isArray(json.replacements) ? json.replacements : []) as Array<{
          blockId: string;
          taggedText: string;
        }>;
        const replacementMap = new Map<string, string>();
        replacements.forEach((r) => {
          if (r.blockId && typeof r.taggedText === 'string') {
            replacementMap.set(r.blockId, r.taggedText);
          }
        });

        const returnedNew = (Array.isArray(json.newPlaceholders) ? json.newPlaceholders : []) as TemplatePlaceholder[];
        const cleanNew = returnedNew
          .map((np) => ({
            ...np,
            placeholder_key: stripPlaceholderBraces(np.placeholder_key),
            is_auto_created: true,
          }))
          .filter((np) => Boolean(np.placeholder_key));

        setTagEditor((prev) => {
          if (!prev) return prev;
          const existingNewKeys = new Set(prev.pendingNewPlaceholders.map((p) => p.placeholder_key.toUpperCase()));
          const mergedNew = [
            ...prev.pendingNewPlaceholders,
            ...cleanNew.filter((np) => !existingNewKeys.has(np.placeholder_key.toUpperCase())),
          ];
          return {
            ...prev,
            blocks: prev.blocks.map((b) =>
              replacementMap.has(b.id) ? { ...b, text: replacementMap.get(b.id)! } : b
            ),
            pendingNewPlaceholders: mergedNew,
            updatedBlockIds: Array.from(replacementMap.keys()),
          };
        });

        onToast(
          'success',
          `Đã nhận diện & điền biến cho ${replacementMap.size} vị trí dấu #. Vui lòng kiểm tra lại và bấm Lưu phôi.`
        );
      } catch (err: any) {
        onToast('error', err?.message || 'Lỗi tự động nhận diện dấu #.');
      } finally {
        setTagEditorBusy(false);
      }
    };

    const handleSaveReviewedDocx = async () => {
      if (!tagEditor) return;
      const cleanId = tagEditor.templateForm.template_id.trim();
      if (!cleanId) {
        onToast('warning', 'Vui lòng nhập Template ID trước khi lưu phôi.');
        return;
      }

      setTagEditorBusy(true);
      try {
        const changedReplacements = tagEditor.blocks
          .filter((b) => b.text !== b.originalText)
          .map((b) => ({ blockId: b.id, taggedText: b.text }));

        const taggedBytes = await applyAiTagsToDocx(tagEditor.buffer, changedReplacements);
        const abTagged = taggedBytes.buffer.slice(
          taggedBytes.byteOffset,
          taggedBytes.byteOffset + taggedBytes.byteLength
        ) as ArrayBuffer;
        const finalTags = await extractPlaceholdersFromDocx(abTagged);

        const storagePath = await uploadTemplateDocx(cleanId, taggedBytes);

        const existingKeySet = new Set(
          data.templatePlaceholders.map((p) => stripPlaceholderBraces(p.placeholder_key).toUpperCase())
        );
        const trulyNew = tagEditor.pendingNewPlaceholders.filter(
          (np) => np.placeholder_key && !existingKeySet.has(np.placeholder_key.toUpperCase())
        );
        if (trulyNew.length > 0) {
          await upsertTemplatePlaceholders(trulyNew);
        }

        const nextTemplateRow: TemplateManager = {
          ...tagEditor.templateForm,
          template_id: cleanId,
          target_department: normalizeTemplateDepartment(
            tagEditor.templateForm.target_department,
            cleanId,
            tagEditor.templateForm.document_name
          ),
          google_doc_file_id: storagePath,
          supported_placeholders: formatPlaceholderListWrapped(finalTags),
        };

        await onUpsertTemplate(nextTemplateRow, tagEditor.isEdit);
        if (onRefreshData) await onRefreshData();

        onToast(
          'success',
          `Đã lưu phôi ${cleanId} thành công (${finalTags.length} trường dữ liệu đã gắn).`
        );
        setTagEditor(null);
        setTplModal({ open: false, isEdit: false, form: null });
        setTplFile(null);
      } catch (err: any) {
        onToast('error', err?.message || 'Lỗi lưu phôi .docx.');
      } finally {
        setTagEditorBusy(false);
      }
    };

    const toggleModalPlaceholder = (key: string) => {
      if (!tplModal.form) return;
      const currentKeys = parsePlaceholderKeyList(tplModal.form.supported_placeholders);
      const upper = normalizePlaceholderKey(key);
      if (!upper) return;
      const exists = currentKeys.some((k) => k.toUpperCase() === upper);
      const nextKeys = exists
        ? currentKeys.filter((k) => k.toUpperCase() !== upper)
        : [...currentKeys, upper];
      setTplModal({
        ...tplModal,
        form: {
          ...tplModal.form,
          supported_placeholders: formatPlaceholderListWrapped(nextKeys),
        },
      });
    };

    const modalSelectedKeySet = new Set(
      parsePlaceholderKeyList(tplModal.form?.supported_placeholders).map((k) => k.toUpperCase())
    );

    const modalSelectableFields = (() => {
      const base = [...normalizedPlaceholders];
      const existingUpper = new Set(base.map((x) => x.key.toUpperCase()));
      parsePlaceholderKeyList(tplModal.form?.supported_placeholders).forEach((k) => {
        if (!existingUpper.has(k.toUpperCase())) {
          existingUpper.add(k.toUpperCase());
          base.push({
            key: k,
            label: getVietnamesePlaceholderLabel(k, data.templatePlaceholders),
            scope: 'CUSTOM',
            tp: {
              placeholder_key: k,
              scope: 'CUSTOM',
              source_table: 'manual',
              source_column: '',
              description_vie: getVietnamesePlaceholderLabel(k, data.templatePlaceholders),
            },
          });
        }
      });
      const q = tplFieldSearch.trim().toLowerCase();
      return base.filter((item) => !q || item.label.toLowerCase().includes(q));
    })();

    const tagEditorPickerItems = (() => {
      const merged = [...normalizedPlaceholders];
      const seen = new Set(merged.map((x) => x.key.toUpperCase()));
      (tagEditor?.pendingNewPlaceholders || []).forEach((np) => {
        const k = stripPlaceholderBraces(np.placeholder_key);
        if (!k || seen.has(k.toUpperCase())) return;
        seen.add(k.toUpperCase());
        merged.unshift({
          key: k,
          label: resolveCleanVietnameseLabel(k, np),
          scope: np.scope || 'NEW',
          tp: np,
        });
      });
      const q = pickerSearch.trim().toLowerCase();
      return merged.filter(
        (item) => !q || item.label.toLowerCase().includes(q) || item.key.toLowerCase().includes(q)
      );
    })();

    const allTagEditorPlaceholders = [
      ...data.templatePlaceholders,
      ...(tagEditor?.pendingNewPlaceholders || []),
    ];

    const filteredTagBlocks = (tagEditor?.blocks || []).filter((b) => {
      const hasHash = b.text.includes('#');
      const hasVar = /\{\{\s*[A-Za-z0-9_.-]+\s*\}\}/.test(b.text);
      if (tagOnlyMarked && !hasHash && !hasVar) return false;
      const q = tagBlockSearch.trim().toLowerCase();
      if (!q) return true;
      return (
        b.text.toLowerCase().includes(q) ||
        String(b.contextHint || '').toLowerCase().includes(q)
      );
    });

    const totalHashCount = (tagEditor?.blocks || []).reduce(
      (sum, b) => sum + (b.text.match(/#/g)?.length || 0),
      0
    );

    const filteredTemplates = data.templates.filter(
      (t) =>
        !qLower ||
        `${t.template_id} ${t.document_name} ${formatTemplateDepartmentLabel(t.target_department, t.template_id, t.document_name)} ${t.google_doc_file_id}`
          .toLowerCase()
          .includes(qLower)
    );

    return (
      <div className="space-y-5">
        <div className="agri-table-wrap">
          <div className="px-4 py-3 bg-[#0f4a33] border-b border-[#186635] flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-extrabold text-[#fff5d6] flex items-center gap-2">
              <FileCode2 className="w-4 h-4 text-[#f4d98a]" /> Quản lý Phôi mẫu Chứng từ (.docx)
            </h3>
            <button
              type="button"
              onClick={() => {
                setTplFile(null);
                setTplDetectedTags([]);
                setTplFieldSearch('');
                setTplModal({
                  open: true,
                  isEdit: false,
                  form: {
                    template_id: '',
                    document_name: '',
                    google_doc_file_id: '',
                    target_department: 'Xuất nhập khẩu (XNK)',
                    status: 'Active',
                    supported_placeholders: '',
                  },
                });
              }}
              className="agri-btn-gold text-xs"
            >
              + Thêm / Tải lên Phôi .docx
            </button>
          </div>

          <div className="w-full overflow-x-auto">
            <table className="agri-table w-full min-w-[1140px]">
              <thead>
                <tr>
                  <th className="text-left w-[160px] whitespace-nowrap">TEMPLATE ID</th>
                  <th className="text-left w-[195px]">TÊN CHỨNG TỪ</th>
                  <th className="text-center w-[155px] whitespace-nowrap">PHÒNG BAN</th>
                  <th className="text-left w-[205px]">STORAGE PATH</th>
                  <th className="text-left w-[240px]">BIẾN HỖ TRỢ</th>
                  <th className="text-center w-[95px] whitespace-nowrap">TRẠNG THÁI</th>
                  <th className="text-center w-[155px] whitespace-nowrap">THAO TÁC</th>
                </tr>
              </thead>
              <tbody>
                {filteredTemplates.map((t) => {
                  const deptLabel = formatTemplateDepartmentLabel(
                    t.target_department,
                    t.template_id,
                    t.document_name
                  );
                  const isSaleDept = deptLabel === 'Kinh doanh (Sale)';
                  const keys = parsePlaceholderKeyList(t.supported_placeholders);
                  const vieLabels = Array.from(
                    new Set(keys.map((k) => getVietnamesePlaceholderLabel(k, data.templatePlaceholders)))
                  );
                  const previewLabels = vieLabels.slice(0, 3);
                  const extraCount = Math.max(0, vieLabels.length - previewLabels.length);

                  return (
                    <tr key={t.template_id}>
                      <td className="text-left font-mono font-bold text-xs whitespace-nowrap">
                        {t.template_id}
                      </td>
                      <td className="text-left font-bold text-xs leading-snug">
                        {t.document_name}
                      </td>
                      <td className="text-center whitespace-nowrap">
                        <span
                          className={`keep-badge-color inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                            isSaleDept
                              ? 'bg-[#f4d98a] text-[#07281c]'
                              : 'bg-[#0f4a33] text-[#fff5d6]'
                          }`}
                        >
                          {deptLabel}
                        </span>
                      </td>
                      <td className="text-left font-mono text-[11px] break-all leading-snug">
                        {t.google_doc_file_id || '-'}
                      </td>
                      <td className="text-left text-[11px] leading-snug" title={vieLabels.join(', ')}>
                        {vieLabels.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {previewLabels.map((lbl) => (
                              <span
                                key={lbl}
                                className="inline-block px-1.5 py-0.5 rounded bg-[#0f4a33]/15 border border-[#0f4a33]/25 text-[#07281c] text-[10.5px] font-semibold"
                              >
                                {lbl}
                              </span>
                            ))}
                            {extraCount > 0 && (
                              <span className="inline-block px-1.5 py-0.5 rounded bg-[#07281c] text-[#f4d98a] text-[10.5px] font-bold">
                                +{extraCount} trường
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="opacity-65 italic">Chưa gắn trường dữ liệu</span>
                        )}
                      </td>
                      <td className="text-center whitespace-nowrap">
                        <span
                          className={`keep-badge-color inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                            String(t.status || '').toLowerCase() === 'active'
                              ? 'bg-[#0f4a33] text-[#fff5d6]'
                              : 'bg-[#8c3b3b] text-white'
                          }`}
                        >
                          {t.status}
                        </span>
                      </td>
                      <td className="text-center whitespace-nowrap">
                        <div className="inline-flex items-center justify-center gap-1.5">
                          {t.google_doc_file_id && (
                            <button
                              type="button"
                              onClick={() =>
                                openDocumentWithSignedUrl(t.google_doc_file_id).catch((err: any) =>
                                  onToast('error', err?.message || 'Không thể tải phôi.')
                                )
                              }
                              className="keep-btn-style px-2.5 py-1 rounded bg-[#16977f] text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <FileDown className="w-3 h-3" /> Tải
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              onRequestConfirm(
                                'Xác nhận xóa phôi mẫu?',
                                'Bạn có chắc chắn muốn xóa phôi mẫu này? Thao tác này sẽ xóa cả tệp .docx trên hệ thống.',
                                () => onDeleteTemplate(t),
                                true
                              )
                            }
                            className="keep-btn-style px-2.5 py-1 rounded bg-[#8c3b3b] text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" /> Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Add / Edit Template Modal */}
        {tplModal.open && tplModal.form && (
          <div className="fixed inset-0 z-50 bg-[#07281c]/75 flex items-center justify-center p-4">
            <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 text-[#f4f8f5] space-y-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-base font-extrabold text-[#fff5d6]">
                  {tplModal.isEdit ? 'Cập nhật Phôi mẫu Chứng từ (.docx)' : 'Thêm Phôi mẫu Chứng từ (.docx)'}
                </h4>
                <button
                  type="button"
                  onClick={() => setTplModal({ open: false, isEdit: false, form: null })}
                  className="p-1 rounded-lg bg-[#07281c] text-[#fff5d6] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="agri-card-inner p-3 space-y-2">
                <label className="block font-extrabold text-[#07281c]">
                  Chọn tệp Word (.docx) từ máy tính để tải lên hoặc mở trình đánh dấu biến (#):
                </label>
                <input
                  type="file"
                  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(e) => void handleSelectDocxFile(e.target.files?.[0] || null)}
                  className="block w-full text-xs text-[#07281c] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-[#0f4a33] file:text-[#fff5d6] file:font-bold cursor-pointer"
                />
                {tplFile && (
                  <div className="text-[11px] font-semibold text-[#0f4a33]">
                    {tplDetectedTags.length > 0
                      ? `Đã đọc tệp "${tplFile.name}" (${tplDetectedTags.length} trường dữ liệu đã có sẵn trong phôi).`
                      : `Tệp "${tplFile.name}" chưa có trường gán dữ liệu — đã sẵn sàng mở trình gắn biến bằng dấu #`}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-bold mb-1">Template ID *</label>
                  <input
                    disabled={tplModal.isEdit}
                    placeholder="VD: TMP_CONTRACT_EDIBLE_NUTS"
                    value={tplModal.form.template_id}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setTplModal({
                        ...tplModal,
                        form: {
                          ...tplModal.form!,
                          template_id: nextId,
                          google_doc_file_id: nextId.trim() ? `templates/${nextId.trim()}.docx` : '',
                        },
                      });
                    }}
                    className="agri-input font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Phòng ban</label>
                  <select
                    value={normalizeTemplateDepartment(
                      tplModal.form.target_department,
                      tplModal.form.template_id,
                      tplModal.form.document_name
                    )}
                    onChange={(e) =>
                      setTplModal({
                        ...tplModal,
                        form: { ...tplModal.form!, target_department: e.target.value },
                      })
                    }
                    className="agri-input font-bold"
                  >
                    {TEMPLATE_DEPARTMENT_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-bold mb-1">Tên chứng từ *</label>
                  <input
                    placeholder="VD: Báo giá Chuẩn (Quotation)"
                    value={tplModal.form.document_name}
                    onChange={(e) =>
                      setTplModal({
                        ...tplModal,
                        form: { ...tplModal.form!, document_name: e.target.value },
                      })
                    }
                    className="agri-input"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Đường dẫn tệp mẫu (.docx)</label>
                  <input
                    placeholder="templates/TMP_QUOTATION_01.docx"
                    value={tplModal.form.google_doc_file_id}
                    onChange={(e) =>
                      setTplModal({
                        ...tplModal,
                        form: { ...tplModal.form!, google_doc_file_id: e.target.value },
                      })
                    }
                    className="agri-input font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Trạng thái</label>
                  <select
                    value={tplModal.form.status || 'Active'}
                    onChange={(e) =>
                      setTplModal({
                        ...tplModal,
                        form: { ...tplModal.form!, status: e.target.value },
                      })
                    }
                    className="agri-input font-bold"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>

                <div className="sm:col-span-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="block font-bold">
                      Trường dữ liệu hỗ trợ ({modalSelectedKeySet.size} trường đã chọn)
                    </label>
                    <div className="relative w-52">
                      <Search className="w-3.5 h-3.5 text-[#0f4a33] absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        placeholder="Tìm trường tiếng Việt..."
                        value={tplFieldSearch}
                        onChange={(e) => setTplFieldSearch(e.target.value)}
                        className="agri-input pl-7 py-1 text-[11px]"
                      />
                    </div>
                  </div>
                  <div className="bg-[#0b3a27] border border-[#186635] rounded-xl p-2.5 max-h-44 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {modalSelectableFields.map((field) => {
                      const checked = modalSelectedKeySet.has(field.key.toUpperCase());
                      return (
                        <label
                          key={field.key}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
                            checked
                              ? 'bg-[#0f4a33] border border-[#f4d98a]/70 text-[#fff5d6]'
                              : 'bg-[#07281c]/60 border border-transparent text-[#d2ebe0] hover:bg-[#0f4a33]/60'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleModalPlaceholder(field.key)}
                            className="accent-[#f4d98a] rounded cursor-pointer shrink-0"
                          />
                          <span className="text-[11px] font-semibold leading-tight">
                            {field.label}
                          </span>
                        </label>
                      );
                    })}
                    {modalSelectableFields.length === 0 && (
                      <div className="col-span-2 text-center py-4 text-[#9bccb8] italic">
                        Không tìm thấy trường dữ liệu phù hợp.
                      </div>
                    )}
                  </div>

                  <div className="pt-1.5 space-y-1">
                    <label className="block text-[11px] font-bold text-[#f4d98a]">
                      Thêm / Chỉnh sửa biến tùy chỉnh (tự động bọc chuẩn &#123;&#123;UPPER_SNAKE_CASE&#125;&#125;)
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        placeholder="VD: buyer_bank, port_of_discharge..."
                        value={tplCustomKeyInput}
                        onChange={(e) => setTplCustomKeyInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (!tplCustomKeyInput.trim()) return;
                            const merged = formatPlaceholderListWrapped([
                              ...parsePlaceholderKeyList(tplModal.form!.supported_placeholders),
                              ...parsePlaceholderKeyList(tplCustomKeyInput),
                            ]);
                            setTplModal({
                              ...tplModal,
                              form: { ...tplModal.form!, supported_placeholders: merged },
                            });
                            setTplCustomKeyInput('');
                          }
                        }}
                        className="agri-input font-mono text-[11px] py-1 flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!tplCustomKeyInput.trim()) return;
                          const merged = formatPlaceholderListWrapped([
                            ...parsePlaceholderKeyList(tplModal.form!.supported_placeholders),
                            ...parsePlaceholderKeyList(tplCustomKeyInput),
                          ]);
                          setTplModal({
                            ...tplModal,
                            form: { ...tplModal.form!, supported_placeholders: merged },
                          });
                          setTplCustomKeyInput('');
                        }}
                        className="px-2.5 py-1 rounded-lg bg-[#0f4a33] border border-[#f4d98a]/60 text-[#f4d98a] text-[11px] font-bold cursor-pointer shrink-0"
                      >
                        + Thêm biến
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="Danh sách biến {{KEY}} đã chọn..."
                      value={tplModal.form.supported_placeholders}
                      onChange={(e) =>
                        setTplModal({
                          ...tplModal,
                          form: { ...tplModal.form!, supported_placeholders: e.target.value },
                        })
                      }
                      onBlur={(e) =>
                        setTplModal({
                          ...tplModal,
                          form: {
                            ...tplModal.form!,
                            supported_placeholders: formatPlaceholderListWrapped(e.target.value),
                          },
                        })
                      }
                      className="agri-input font-mono text-[11px] py-1"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#186635]/60">
                <button
                  type="button"
                  disabled={tplBusy || (!tplFile && !tplModal.form.google_doc_file_id)}
                  onClick={() => void handleOpenTagEditorFromModal()}
                  className="px-3 py-1.5 rounded-lg bg-[#f4d98a] text-[#07281c] font-extrabold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {tplBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  <span>Tự thêm biến</span>
                </button>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={tplBusy}
                    onClick={() => setTplModal({ open: false, isEdit: false, form: null })}
                    className="px-3 py-1.5 rounded bg-[#07281c] text-white font-bold cursor-pointer"
                  >
                    Hủy
                  </button>
                  {tplFile ? (
                    <button
                      type="button"
                      disabled={tplBusy}
                      onClick={() => void handleUploadTaggedDocx()}
                      className="px-3 py-1.5 rounded-lg bg-[#16977f] hover:bg-[#117865] text-white font-bold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      {tplBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      <span>Tải tệp &amp; Lưu phôi</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={tplBusy}
                      onClick={async () => {
                        if (!tplModal.form!.template_id.trim()) {
                          onToast('warning', 'Vui lòng nhập Template ID.');
                          return;
                        }
                        const mergedKeys = formatPlaceholderListWrapped([
                          ...parsePlaceholderKeyList(tplModal.form!.supported_placeholders),
                          ...parsePlaceholderKeyList(tplCustomKeyInput),
                        ]);
                        await onUpsertTemplate(
                          {
                            ...tplModal.form!,
                            target_department: normalizeTemplateDepartment(
                              tplModal.form!.target_department,
                              tplModal.form!.template_id,
                              tplModal.form!.document_name
                            ),
                            supported_placeholders: mergedKeys,
                          },
                          tplModal.isEdit
                        );
                        setTplCustomKeyInput('');
                        setTplModal({ open: false, isEdit: false, form: null });
                      }}
                      className="agri-btn-gold"
                    >
                      Lưu Phôi mẫu
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Interactive #-Marker AI Smart-Fill & Manual Tag Review Modal */}
        {tagEditor && tagEditor.open && (
          <div className="fixed inset-0 z-[60] bg-[#07281c]/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
            <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden text-[#f4f8f5]">
              {/* Header */}
              <div className="px-4 py-3 bg-[#0f4a33] border-b-2 border-[#186635] flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm sm:text-base font-extrabold text-[#fff5d6] flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#f4d98a]" />
                    <span>Trình Gắn &amp; Chỉnh sửa Trường Dữ liệu Phôi .docx</span>
                  </h4>
                  <p className="text-[11px] text-[#9bccb8]">
                    {tagEditor.templateForm.template_id} · {tagEditor.templateForm.document_name || 'Phôi chứng từ mới'} ·{' '}
                    {tagEditor.templateForm.target_department}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={tagEditorBusy}
                    onClick={() => void handleSmartFillHashMarkers()}
                    className="agri-btn-gold text-xs inline-flex items-center gap-1.5 disabled:opacity-60"
                  >
                    {tagEditorBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="w-3.5 h-3.5" />
                    )}
                    <span>Tự động nhận diện &amp; Điền biến</span>
                  </button>

                  <button
                    type="button"
                    disabled={tagEditorBusy}
                    onClick={() => void handleSaveReviewedDocx()}
                    className="px-3 py-1.5 rounded-lg bg-[#16977f] hover:bg-[#117865] text-white text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    {tagEditorBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    <span>Lưu phôi .docx</span>
                  </button>

                  <button
                    type="button"
                    disabled={tagEditorBusy}
                    onClick={() => setTagEditor(null)}
                    className="p-1.5 rounded-lg bg-[#8c3b3b] text-white hover:bg-[#6e2b2b] cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Inline Template Metadata Strip */}
              <div className="px-4 py-2 bg-[#0b3a27] border-b border-[#186635] grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-[#9bccb8] mb-0.5">Template ID *</label>
                  <input
                    disabled={tagEditor.isEdit}
                    value={tagEditor.templateForm.template_id}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setTagEditor((prev) =>
                        prev
                          ? {
                              ...prev,
                              templateForm: {
                                ...prev.templateForm,
                                template_id: nextId,
                                google_doc_file_id: nextId.trim() ? `templates/${nextId.trim()}.docx` : '',
                              },
                            }
                          : prev
                      );
                    }}
                    placeholder="VD: TMP_CONTRACT_01"
                    className="agri-input py-1 text-xs font-mono disabled:opacity-70"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#9bccb8] mb-0.5">Tên chứng từ</label>
                  <input
                    value={tagEditor.templateForm.document_name}
                    onChange={(e) =>
                      setTagEditor((prev) =>
                        prev
                          ? {
                              ...prev,
                              templateForm: { ...prev.templateForm, document_name: e.target.value },
                            }
                          : prev
                      )
                    }
                    placeholder="VD: Hợp đồng Xuất khẩu"
                    className="agri-input py-1 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#9bccb8] mb-0.5">Phòng ban</label>
                  <select
                    value={normalizeTemplateDepartment(
                      tagEditor.templateForm.target_department,
                      tagEditor.templateForm.template_id,
                      tagEditor.templateForm.document_name
                    )}
                    onChange={(e) =>
                      setTagEditor((prev) =>
                        prev
                          ? {
                              ...prev,
                              templateForm: { ...prev.templateForm, target_department: e.target.value },
                            }
                          : prev
                      )
                    }
                    className="agri-input py-1 text-xs font-bold"
                  >
                    {TEMPLATE_DEPARTMENT_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Mandatory Instruction Banner */}
              <div className="px-4 py-2.5 bg-[#f4d98a] text-[#07281c] border-b border-[#186635] flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#0f4a33] text-[#f4d98a] font-extrabold text-xs shrink-0">
                    #
                  </span>
                  <div>
                    <div className="text-xs sm:text-sm font-extrabold">
                      Điền # vào chỗ cần điền trường gán dữ liệu
                    </div>
                    <div className="text-[11px] font-medium opacity-90">
                      Gõ trực tiếp ký tự <strong>#</strong> vào các dòng bên dưới, bấm <strong>&quot;Tự động nhận diện &amp; Điền biến&quot;</strong>, hoặc chỉnh sửa / chèn nhanh trường từ danh sách bên phải trước khi lưu.
                    </div>
                  </div>
                </div>
                <div className="inline-flex items-center gap-2 text-xs font-extrabold">
                  <span className="px-2.5 py-1 rounded-lg bg-[#0f4a33] text-[#fff5d6]">
                    Đang đánh dấu: {totalHashCount} dấu #
                  </span>
                </div>
              </div>

              {/* Main 2-column Workspace */}
              <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12">
                {/* Left: Extracted Document Blocks OR Live Word Layout Preview */}
                <div className="lg:col-span-8 flex flex-col min-h-0 bg-[#0b3a27] border-r border-[#186635]">
                  <div className="px-3.5 py-2 bg-[#07281c] border-b border-[#186635] flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="inline-flex rounded-lg bg-[#0b3a27] p-0.5 border border-[#186635]">
                      <button
                        type="button"
                        onClick={() => setTagEditorTab('edit')}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer ${
                          tagEditorTab === 'edit' ? 'bg-[#f4d98a] text-[#07281c]' : 'text-[#d2ebe0]'
                        }`}
                      >
                        <FileText className="w-3 h-3" /> Soạn thảo &amp; Gắn biến (#)
                      </button>
                      <button
                        type="button"
                        onClick={() => setTagEditorTab('preview')}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer ${
                          tagEditorTab === 'preview' ? 'bg-[#f4d98a] text-[#07281c]' : 'text-[#d2ebe0]'
                        }`}
                      >
                        <Eye className="w-3 h-3" /> Xem trước bố cục (.docx)
                      </button>
                    </div>
                    {tagEditorTab === 'edit' && (
                      <>
                        <div className="relative flex-1 min-w-[180px]">
                          <Search className="w-3.5 h-3.5 text-[#0f4a33] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            type="text"
                            placeholder="Lọc nhanh đoạn văn bản trong phôi..."
                            value={tagBlockSearch}
                            onChange={(e) => setTagBlockSearch(e.target.value)}
                            className="agri-input pl-8 py-1 text-xs"
                          />
                        </div>
                        <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#fff5d6] cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={tagOnlyMarked}
                            onChange={(e) => setTagOnlyMarked(e.target.checked)}
                            className="accent-[#f4d98a] cursor-pointer"
                          />
                          <span>Chỉ hiện dòng có # hoặc biến</span>
                        </label>
                      </>
                    )}
                  </div>

                  {tagEditorTab === 'preview' ? (
                    <div className="flex-1 overflow-auto p-4 bg-[#e8f0ec] max-h-[56vh] relative">
                      {docxPreviewLoading && (
                        <div className="flex items-center justify-center gap-2 py-8 text-xs font-bold text-[#0f4a33]">
                          <Loader2 className="w-4 h-4 animate-spin" /> Loading...
                        </div>
                      )}
                      <div ref={docxLayoutPreviewRef} className="min-h-[300px]" />
                    </div>
                  ) : (
                  <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5 max-h-[56vh]">
                    {filteredTagBlocks.map((block) => {
                      const isActive = activeBlockId === block.id;
                      const isUpdated = tagEditor.updatedBlockIds.includes(block.id);
                      const hasHash = block.text.includes('#');
                      const tagsInBlock = Array.from(
                        new Set(
                          Array.from(block.text.matchAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g)).map(
                            (m) => m[1].trim()
                          )
                        )
                      );

                      return (
                        <div
                          key={block.id}
                          className={`rounded-xl p-2.5 border transition-colors ${
                            isActive
                              ? 'bg-[#0f4a33] border-[#f4d98a]'
                              : isUpdated
                              ? 'bg-[#0f4a33]/80 border-[#16977f]'
                              : hasHash
                              ? 'bg-[#0f4a33]/70 border-[#f4d98a]/60'
                              : 'bg-[#07281c]/70 border-[#186635]'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                            <div className="flex items-center gap-1.5 text-[10.5px] text-[#9bccb8] font-semibold">
                              {block.isTableCell && (
                                <span className="px-1.5 py-0.5 rounded bg-[#07281c] text-[#f4d98a] font-bold">
                                  Ô bảng
                                </span>
                              )}
                              {block.contextHint && (
                                <span className="truncate max-w-[340px]" title={block.contextHint}>
                                  Cạnh: &quot;{block.contextHint}&quot;
                                </span>
                              )}
                              {isUpdated && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#16977f] text-white font-bold">
                                  <Check className="w-3 h-3" /> Đã điền biến
                                </span>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() => handleInsertSnippetAtCursor('#', block.id)}
                              className="px-2 py-0.5 rounded bg-[#f4d98a]/20 hover:bg-[#f4d98a] text-[#f4d98a] hover:text-[#07281c] text-[10.5px] font-extrabold inline-flex items-center gap-0.5 cursor-pointer transition-colors"
                            >
                              <Hash className="w-3 h-3" /> Chèn #
                            </button>
                          </div>

                          <textarea
                            ref={(el) => {
                              blockTextareaRefs.current[block.id] = el;
                            }}
                            rows={Math.min(4, Math.max(1, Math.ceil((block.text.length || 1) / 88)))}
                            value={block.text}
                            placeholder="Nhập # tại đây để đánh dấu vị trí điền dữ liệu..."
                            onFocus={(e) => {
                              setActiveBlockId(block.id);
                              activeCursorRef.current = {
                                blockId: block.id,
                                start: e.currentTarget.selectionStart ?? block.text.length,
                                end: e.currentTarget.selectionEnd ?? block.text.length,
                              };
                            }}
                            onClick={(e) => {
                              setActiveBlockId(block.id);
                              activeCursorRef.current = {
                                blockId: block.id,
                                start: e.currentTarget.selectionStart ?? block.text.length,
                                end: e.currentTarget.selectionEnd ?? block.text.length,
                              };
                            }}
                            onKeyUp={(e) => {
                              activeCursorRef.current = {
                                blockId: block.id,
                                start: e.currentTarget.selectionStart ?? block.text.length,
                                end: e.currentTarget.selectionEnd ?? block.text.length,
                              };
                            }}
                            onChange={(e) => {
                              const nextVal = e.target.value;
                              activeCursorRef.current = {
                                blockId: block.id,
                                start: e.target.selectionStart ?? nextVal.length,
                                end: e.target.selectionEnd ?? nextVal.length,
                              };
                              handleUpdateTagBlockText(block.id, nextVal);
                            }}
                            className="w-full rounded-lg bg-[#d7eee4] text-[#07281c] px-2.5 py-1.5 text-xs font-medium leading-relaxed border border-[#186635] focus:outline-none focus:ring-2 focus:ring-[#f4d98a]"
                          />

                          {tagsInBlock.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                              {tagsInBlock.map((tagKey) => (
                                <span
                                  key={tagKey}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#07281c] border border-[#f4d98a]/50 text-[#fff5d6] text-[10.5px] font-semibold"
                                >
                                  <Tag className="w-2.5 h-2.5 text-[#f4d98a]" />
                                  <span>{getVietnamesePlaceholderLabel(tagKey, allTagEditorPlaceholders)}</span>
                                  <button
                                    type="button"
                                    title="Xóa biến này khỏi đoạn văn"
                                    onClick={() => handleRemoveTagFromBlock(block.id, tagKey)}
                                    className="ml-0.5 text-[#f4d98a] hover:text-red-300 cursor-pointer"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {filteredTagBlocks.length === 0 && (
                      <div className="text-center py-8 text-xs text-[#9bccb8] italic">
                        Không có đoạn văn bản nào khớp bộ lọc.
                      </div>
                    )}
                  </div>
                  )}
                </div>

                {/* Right: Quick-Insert Vietnamese Variable Picker */}
                <div className="lg:col-span-4 flex flex-col min-h-0 bg-[#07281c]">
                  <div className="p-3 border-b border-[#186635] space-y-2">
                    <div className="text-xs font-extrabold text-[#f4d98a] uppercase tracking-wider">
                      Chèn nhanh Trường Dữ liệu
                    </div>
                    <p className="text-[11px] text-[#9bccb8]">
                      Chọn dòng bên trái, sau đó bấm vào trường tiếng Việt bên dưới để chèn trực tiếp vào vị trí con trỏ.
                    </p>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-[#0f4a33] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        placeholder="Tìm trường dữ liệu..."
                        value={pickerSearch}
                        onChange={(e) => setPickerSearch(e.target.value)}
                        className="agri-input pl-8 py-1 text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5 max-h-[60vh]">
                    {tagEditorPickerItems.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => handleInsertSnippetAtCursor(`{{${item.key}}}`)}
                        className="w-full text-left px-2.5 py-2 rounded-lg bg-[#0f4a33]/80 hover:bg-[#16977f] border border-[#186635] text-[#fff5d6] transition-colors cursor-pointer flex items-center justify-between gap-2"
                      >
                        <span className="text-xs font-semibold leading-snug">{item.label}</span>
                        <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-[#07281c] text-[#f4d98a] shrink-0">
                          + Chèn
                        </span>
                      </button>
                    ))}
                    {tagEditorPickerItems.length === 0 && (
                      <div className="text-center py-6 text-xs text-[#9bccb8] italic">
                        Không tìm thấy trường phù hợp.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // admin-users
  return (
    <div className="space-y-4">
      <div className="agri-table-wrap">
        <div className="px-4 py-3 bg-[#0f4a33] border-b border-[#186635] flex items-center justify-between gap-2">
          <h3 className="text-sm font-extrabold text-[#fff5d6] flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#f4d98a]" /> Tài khoản &amp; Phân quyền Nhân sự
          </h3>
          <button
            type="button"
            onClick={() =>
              setUsrModal({
                open: true,
                isEdit: false,
                initialPassword: '',
                form: {
                  employee_id: `EMP-${String(data.users.length + 1).padStart(3, '0')}`,
                  full_name: '',
                  department: 'SALES',
                  role: 'Sale',
                  email: '',
                  status: 'Active',
                },
              })
            }
            className="agri-btn-gold text-xs"
          >
            + Thêm Nhân sự
          </button>
        </div>
        <div className="agri-table-scroll">
          <table className="agri-table">
            <thead>
              <tr>
                <th className="text-center">Mã NV</th>
                <th className="text-left">Họ tên</th>
                <th className="text-center">Phòng ban</th>
                <th className="text-center">Vai trò</th>
                <th className="text-left">Email đăng nhập</th>
                <th className="text-center">Trạng thái</th>
                <th className="text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => {
                const stLow = String(u.status || '').trim().toLowerCase();
                const isPending = stLow === 'pending' || stLow.includes('chờ');
                const isInactive = stLow.includes('inactive') || stLow.includes('khóa') || stLow.includes('disabled');
                return (
                  <tr key={u.employee_id}>
                    <td className="text-center font-mono font-bold whitespace-nowrap">{u.employee_id}</td>
                    <td className="text-left font-bold">{u.full_name}</td>
                    <td className="text-center font-bold whitespace-nowrap">{u.department}</td>
                    <td className="text-center whitespace-nowrap">{u.role}</td>
                    <td className="text-left font-mono text-xs">{u.email}</td>
                    <td className="text-center whitespace-nowrap">
                      <span
                        className={`keep-badge-color inline-block px-2 py-0.5 rounded text-[11px] font-extrabold ${
                          isPending
                            ? 'bg-[#f4d98a] text-[#07281c]'
                            : isInactive
                            ? 'bg-[#8c3b3b] text-white'
                            : 'bg-[#0f4a33] text-[#fff5d6]'
                        }`}
                      >
                        {u.status}
                      </span>
                    </td>
                    <td className="text-center">
                      <div className="inline-flex flex-wrap items-center justify-center gap-1">
                        {(isPending || isInactive) && (
                          <button
                            type="button"
                            onClick={() => void onUpsertUser({ ...u, status: 'Active' }, true)}
                            className="keep-btn-style px-2 py-1 rounded bg-[#16977f] text-white text-[11px] font-bold cursor-pointer"
                          >
                            Duyệt
                          </button>
                        )}
                        {!isInactive && !isPending && (
                          <button
                            type="button"
                            onClick={() =>
                              onRequestConfirm(
                                'Khóa tài khoản?',
                                `Xác nhận tạm khóa quyền truy cập của ${u.full_name} (${u.email})?`,
                                () => onUpsertUser({ ...u, status: 'Inactive' }, true),
                                true
                              )
                            }
                            className="keep-btn-style px-2 py-1 rounded bg-[#8c3b3b] text-white text-[11px] font-bold cursor-pointer"
                          >
                            Khóa
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setUsrModal({ open: true, isEdit: true, form: { ...u }, initialPassword: '' })}
                          className="keep-btn-style px-2 py-1 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold cursor-pointer"
                        >
                          Sửa
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {usrModal.open && usrModal.form && (
        <div className="fixed inset-0 z-50 bg-[#07281c]/75 flex items-center justify-center p-4">
          <div className="relative bg-[#547d59] border-2 border-[#186635] rounded-2xl w-full max-w-lg p-5 text-[#f4f8f5] space-y-3 text-xs overflow-hidden">
            {usrSaving && (
              <div className="absolute inset-0 z-30 bg-[#07281c]/85 backdrop-blur-sm flex flex-col items-center justify-center gap-3 p-6 text-center">
                <div className="p-3.5 rounded-2xl bg-[#0f4a33] border-2 border-[#f4d98a]/70 shadow-2xl flex flex-col items-center gap-2.5">
                  <Loader2 className="w-8 h-8 animate-spin text-[#f4d98a]" />
                  <div className="text-sm font-extrabold text-[#fff5d6]">
                    {usrModal.isEdit ? 'Đang cập nhật thông tin nhân sự...' : 'Đang tạo tài khoản nhân sự...'}
                  </div>
                  <div className="text-[11px] text-[#9bccb8]">
                    Vui lòng chờ hệ thống đồng bộ tài khoản...
                  </div>
                </div>
              </div>
            )}
            <h4 className="text-base font-extrabold text-[#fff5d6]">
              {usrModal.isEdit ? `Cập nhật Nhân sự (${usrModal.form.employee_id})` : 'Thêm Nhân sự Mới'}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block font-bold mb-1">Mã NV</label>
                <input disabled={usrModal.isEdit || usrSaving} placeholder="Mã NV" value={usrModal.form.employee_id} onChange={(e) => setUsrModal({ ...usrModal, form: { ...usrModal.form!, employee_id: e.target.value } })} className="agri-input font-mono" />
              </div>
              <div>
                <label className="block font-bold mb-1">Họ tên *</label>
                <input
                  disabled={usrSaving}
                  placeholder="Họ tên"
                  value={usrModal.form.full_name}
                  onChange={(e) => {
                    const el = e.currentTarget;
                    const start = el.selectionStart;
                    const end = el.selectionEnd;
                    const formatted = capitalizeWordsPreservingSpaces(el.value);
                    setUsrModal({ ...usrModal, form: { ...usrModal.form!, full_name: formatted } });
                    if (start !== null && end !== null) {
                      window.requestAnimationFrame(() => {
                        if (document.activeElement === el) {
                          el.setSelectionRange(start, end);
                        }
                      });
                    }
                  }}
                  className="agri-input"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-bold mb-1">Email đăng nhập *</label>
                <input disabled={usrSaving} type="email" placeholder="name@greenagri-vn.com" value={usrModal.form.email} onChange={(e) => setUsrModal({ ...usrModal, form: { ...usrModal.form!, email: e.target.value } })} className="agri-input" />
              </div>
              {!usrModal.isEdit && (
                <div className="sm:col-span-2">
                  <label className="block font-bold mb-1">Mật khẩu khởi tạo (tùy chọn, ≥ 6 ký tự)</label>
                  <input
                    disabled={usrSaving}
                    type="password"
                    placeholder="Bỏ trống nếu nhân sự đã có tài khoản"
                    value={usrModal.initialPassword}
                    onChange={(e) => setUsrModal({ ...usrModal, initialPassword: e.target.value })}
                    className="agri-input"
                  />
                </div>
              )}
              <div>
                <label className="block font-bold mb-1">Phòng ban</label>
                <select
                  disabled={usrSaving}
                  value={usrModal.form.department}
                  onChange={(e) => {
                    const dept = e.target.value;
                    const syncedRole = !usrModal.isEdit
                      ? dept === 'ADMIN'
                        ? 'Admin'
                        : dept === 'XNK'
                        ? 'XNK'
                        : 'Sale'
                      : usrModal.form!.role;
                    setUsrModal({ ...usrModal, form: { ...usrModal.form!, department: dept, role: syncedRole } });
                  }}
                  className="agri-input"
                >
                  <option value="SALES">SALES</option>
                  <option value="XNK">XNK</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </div>
              <div>
                <label className="block font-bold mb-1">Vai trò</label>
                <select
                  disabled={usrSaving}
                  value={usrModal.form.role}
                  onChange={(e) => setUsrModal({ ...usrModal, form: { ...usrModal.form!, role: e.target.value } })}
                  className="agri-input"
                >
                  <option value="Sale">Sale</option>
                  <option value="XNK">XNK</option>
                  <option value="Admin">Admin</option>
                  {!['Sale', 'XNK', 'Admin'].includes(usrModal.form.role) && usrModal.form.role && (
                    <option value={usrModal.form.role}>{usrModal.form.role}</option>
                  )}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block font-bold mb-1">Trạng thái</label>
                <select disabled={usrSaving} value={usrModal.form.status} onChange={(e) => setUsrModal({ ...usrModal, form: { ...usrModal.form!, status: e.target.value } })} className="agri-input">
                  <option value="Active">Active (Đang hoạt động)</option>
                  <option value="PENDING">PENDING (Chờ duyệt)</option>
                  <option value="Inactive">Inactive (Tạm khóa)</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={usrSaving}
                onClick={() => setUsrModal({ open: false, isEdit: false, form: null, initialPassword: '' })}
                className="px-3 py-1.5 rounded bg-[#07281c] text-white font-bold cursor-pointer disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={usrSaving}
                onClick={async () => {
                  if (!usrModal.form!.full_name.trim() || !usrModal.form!.email.trim()) {
                    onToast('warning', 'Vui lòng nhập đầy đủ Họ tên và Email.');
                    return;
                  }
                  if (!usrModal.isEdit && usrModal.initialPassword && usrModal.initialPassword.length < 6) {
                    onToast('warning', 'Mật khẩu khởi tạo phải có ít nhất 6 ký tự.');
                    return;
                  }
                  setUsrSaving(true);
                  try {
                    await onUpsertUser(usrModal.form!, usrModal.isEdit, usrModal.initialPassword || undefined);
                    setUsrModal({ open: false, isEdit: false, form: null, initialPassword: '' });
                  } catch (err: any) {
                    onToast('error', err?.message || 'Lỗi lưu tài khoản nhân sự.');
                  } finally {
                    setUsrSaving(false);
                  }
                }}
                className="agri-btn-gold inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {usrSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Lưu Nhân sự</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
