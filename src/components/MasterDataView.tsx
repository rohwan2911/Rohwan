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
} from 'lucide-react';
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
import { capitalizeWordsPreservingSpaces, computeFreightExpiryStatus, fmtUSD, normalizePlainText, todayIsoDate, toNum } from '../utils/calculations';
import {
  applyAiTagsToDocx,
  DocxParagraphBlock,
  extractDocxParagraphBlocks,
  extractPlaceholdersFromDocx,
  formatTemplateDepartmentLabel,
  getVietnamesePlaceholderLabel,
  normalizeTemplateDepartment,
  parsePlaceholderKeyList,
  resolveCleanVietnameseLabel,
  stripPlaceholderBraces,
  TEMPLATE_DEPARTMENT_OPTIONS,
} from '../utils/docxEngine';
import {
  downloadTemplateDocx,
  openDocumentWithSignedUrl,
  uploadTemplateDocx,
  upsertTemplatePlaceholders,
} from '../services/supabaseService';

interface MasterDataViewProps {
  activeView: Extract<ViewId, 'master-products' | 'xnk-shipping' | 'xnk-rates' | 'admin-templates' | 'admin-users'>;
  data: AppDataState;
  quickSearch: string;
  highlightedId?: string;
  onUpsertProduct: (row: ProductCatalog, isEdit: boolean) => Promise<void>;
  onDeleteProduct: (sku: string) => Promise<void>;
  onUpsertSchedule: (row: ShippingSchedule, isEdit: boolean) => Promise<void>;
  onDeleteSchedule: (scheduleId: string) => Promise<void>;
  onUpsertRate: (row: PricingRate, isEdit: boolean) => Promise<void>;
  onDeleteRate: (feeCode: string) => Promise<void>;
  onUpsertTemplate: (row: TemplateManager, isEdit: boolean) => Promise<void>;
  onRefreshData?: () => Promise<void>;
  onUpsertUser: (row: SysUser, isEdit: boolean, initialPassword?: string) => Promise<void>;
  onRequestConfirm: (title: string, message: string, onConfirm: () => Promise<void>, danger?: boolean) => void;
  onToast: (type: 'success' | 'error' | 'info' | 'warning', title: string) => void;
}

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
  onRefreshData,
  onUpsertUser,
  onRequestConfirm,
  onToast,
}) => {
  const qLower = quickSearch.trim().toLowerCase();

  const [prodModal, setProdModal] = useState<{ open: boolean; isEdit: boolean; form: ProductCatalog | null }>({ open: false, isEdit: false, form: null });
  const [schModal, setSchModal] = useState<{ open: boolean; isEdit: boolean; form: ShippingSchedule | null }>({ open: false, isEdit: false, form: null });
  const [rateCat, setRateCat] = useState<string>('ALL');
  const [rateModal, setRateModal] = useState<{ open: boolean; isEdit: boolean; form: PricingRate | null }>({ open: false, isEdit: false, form: null });
  const [tplModal, setTplModal] = useState<{ open: boolean; isEdit: boolean; form: TemplateManager | null }>({ open: false, isEdit: false, form: null });
  const [tplFile, setTplFile] = useState<File | null>(null);
  const [tplDetectedTags, setTplDetectedTags] = useState<string[]>([]);
  const [tplBusy, setTplBusy] = useState(false);
  const [tplFieldSearch, setTplFieldSearch] = useState('');

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
  const [tagEditorLoadingId, setTagEditorLoadingId] = useState<string | null>(null);
  const [tagBlockSearch, setTagBlockSearch] = useState('');
  const [tagOnlyMarked, setTagOnlyMarked] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const activeCursorRef = useRef<{ blockId: string; start: number; end: number } | null>(null);
  const blockTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const [usrModal, setUsrModal] = useState<{ open: boolean; isEdit: boolean; form: SysUser | null; initialPassword: string }>({
    open: false,
    isEdit: false,
    form: null,
    initialPassword: '',
  });

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

  useEffect(() => {
    if (activeView === 'xnk-shipping' && highlightedId) {
      const target = data.schedules.find((s) => s.schedule_id === highlightedId);
      if (target) setSchModal({ open: true, isEdit: true, form: { ...target } });
    }
  }, [activeView, highlightedId, data.schedules]);

  if (activeView === 'master-products') {
    const list = data.products.filter((p) => !qLower || `${p.sku_code} ${p.product_name_vie} ${p.product_name_eng} ${p.hs_code} ${p.product_group}`.toLowerCase().includes(qLower));
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() =>
              setProdModal({
                open: true,
                isEdit: false,
                form: {
                  product_group: 'Nông sản khô',
                  sku_code: `SKU-${String(data.products.length + 1).padStart(3, '0')}`,
                  product_name_vie: '',
                  product_name_eng: '',
                  unit_price: 2.5,
                  hs_code: '0810.90',
                  container_type: "20'DC / 40'DC",
                  storage_temperature: 'Nhiệt độ thường',
                  image_url: '',
                },
              })
            }
            className="agri-btn-gold flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Thêm Sản phẩm
          </button>
        </div>

        <div className="agri-table-wrap">
          <div className="px-4 py-3 bg-[#0f4a33] border-b border-[#186635]">
            <h3 className="text-sm font-extrabold text-[#fff5d6] flex items-center gap-2">
              <Package className="w-4 h-4 text-[#f4d98a]" /> Danh mục Sản phẩm ({list.length})
            </h3>
          </div>
          <div className="agri-table-scroll">
            <table className="agri-table">
              <thead>
                <tr>
                  <th className="text-center">STT / SKU</th>
                  <th className="text-left">Nhóm hàng</th>
                  <th className="text-left">Tên Tiếng Việt / English</th>
                  <th className="text-center">Giá vốn ($/kg)</th>
                  <th className="text-center">HS Code</th>
                  <th className="text-center">Loại Cont / Nhiệt độ</th>
                  <th className="text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p, idx) => (
                  <tr key={p.sku_code}>
                    <td className="text-center font-mono font-bold whitespace-nowrap">{idx + 1}. {p.sku_code}</td>
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
                        <button type="button" onClick={() => setProdModal({ open: true, isEdit: true, form: { ...p } })} className="keep-btn-style px-2 py-1 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold cursor-pointer"><Edit3 className="w-3 h-3 inline" /> Sửa</button>
                        <button type="button" onClick={() => onRequestConfirm('Xóa sản phẩm?', `Xác nhận xóa ${p.sku_code}?`, () => onDeleteProduct(p.sku_code), true)} className="keep-btn-style px-2 py-1 rounded bg-[#8c3b3b] text-white text-[11px] font-bold cursor-pointer"><Trash2 className="w-3 h-3 inline" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {prodModal.open && prodModal.form && (
          <div className="fixed inset-0 z-50 bg-[#07281c]/75 flex items-center justify-center p-4">
            <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl w-full max-w-xl p-5 text-[#f4f8f5] space-y-3 text-xs">
              <h4 className="text-base font-extrabold text-[#fff5d6]">{prodModal.isEdit ? 'Sửa Sản phẩm' : 'Thêm Sản phẩm Mới'}</h4>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block font-bold mb-1">SKU Code</label><input disabled={prodModal.isEdit} value={prodModal.form.sku_code} onChange={(e) => setProdModal({ ...prodModal, form: { ...prodModal.form!, sku_code: e.target.value } })} className="agri-input font-mono" /></div>
                <div><label className="block font-bold mb-1">Nhóm hàng</label><input value={prodModal.form.product_group} onChange={(e) => setProdModal({ ...prodModal, form: { ...prodModal.form!, product_group: e.target.value } })} className="agri-input" /></div>
                <div><label className="block font-bold mb-1">Tên Tiếng Việt</label><input value={prodModal.form.product_name_vie} onChange={(e) => setProdModal({ ...prodModal, form: { ...prodModal.form!, product_name_vie: e.target.value } })} className="agri-input" /></div>
                <div><label className="block font-bold mb-1">Tên Tiếng Anh</label><input value={prodModal.form.product_name_eng} onChange={(e) => setProdModal({ ...prodModal, form: { ...prodModal.form!, product_name_eng: e.target.value } })} className="agri-input" /></div>
                <div><label className="block font-bold mb-1">Giá vốn (USD/KG)</label><input type="number" step="0.01" value={prodModal.form.unit_price} onChange={(e) => setProdModal({ ...prodModal, form: { ...prodModal.form!, unit_price: toNum(e.target.value) } })} className="agri-input font-mono" /></div>
                <div><label className="block font-bold mb-1">HS Code</label><input value={prodModal.form.hs_code} onChange={(e) => setProdModal({ ...prodModal, form: { ...prodModal.form!, hs_code: e.target.value } })} className="agri-input font-mono" /></div>
                <div><label className="block font-bold mb-1">Loại Container</label><input value={prodModal.form.container_type} onChange={(e) => setProdModal({ ...prodModal, form: { ...prodModal.form!, container_type: e.target.value } })} className="agri-input" /></div>
                <div><label className="block font-bold mb-1">Nhiệt độ bảo quản</label><input value={prodModal.form.storage_temperature} onChange={(e) => setProdModal({ ...prodModal, form: { ...prodModal.form!, storage_temperature: e.target.value } })} className="agri-input" /></div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setProdModal({ open: false, isEdit: false, form: null })} className="px-3 py-1.5 rounded bg-[#07281c] text-white font-bold cursor-pointer">Hủy</button>
                <button type="button" onClick={async () => { await onUpsertProduct(prodModal.form!, prodModal.isEdit); setProdModal({ open: false, isEdit: false, form: null }); }} className="agri-btn-gold">Lưu Sản phẩm</button>
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
            onClick={() =>
              setSchModal({
                open: true,
                isEdit: false,
                form: {
                  schedule_id: `SCH-${String(data.schedules.length + 1).padStart(3, '0')}`,
                  pol: 'Cát Lái (HCMC)',
                  pod: '',
                  country: '',
                  pot: '-',
                  shipping_line: '',
                  vessel: '',
                  voyage: '',
                  etd: todayIsoDate(),
                  eta: todayIsoDate(),
                  rate_20_dc: 0, rate_40_dc: 0, rate_40_hc: 0, rate_20_rf: 0, rate_40_rf: 0, rate_40_rh: 0,
                  baf_fee: 0, lss_fee: 0, pss_fee: 0, b_l_fee: 45, seal_fee: 10,
                  updated_date: todayIsoDate(),
                  expiry_date: todayIsoDate(),
                  thc_20_dry: 135, thc_40_dry: 210, thc_20_reefer: 185, thc_40_reefer: 275, bill_seal_fee_shipment: 55,
                },
              })
            }
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
          <div className="agri-table-scroll">
            <table className="agri-table">
              <thead>
                <tr>
                  <th className="text-center">Mã lịch</th>
                  <th className="text-left">Hãng tàu / Tàu</th>
                  <th className="text-left">Tuyến (POL → POD · Quốc gia)</th>
                  <th className="text-center">ETD / ETA</th>
                  <th className="text-center">20'DC / 40'DC / 40'HC</th>
                  <th className="text-center">20'RF / 40'RF / 40'RH</th>
                  <th className="text-center">Hết hạn</th>
                  <th className="text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => {
                  const exp = computeFreightExpiryStatus(s);
                  return (
                    <tr key={s.schedule_id}>
                      <td className="text-center font-mono font-bold whitespace-nowrap">{s.schedule_id}</td>
                      <td className="text-left">
                        <div className="font-bold">{s.shipping_line}</div>
                        <div className="text-[11px] opacity-80">{s.vessel} / {s.voyage}</div>
                      </td>
                      <td className="text-left">
                        <div className="font-semibold">{s.pol} → {s.pod}</div>
                        <div className="text-[11px]">{s.country} {s.pot && s.pot !== '-' ? `· POT: ${s.pot}` : ''}</div>
                      </td>
                      <td className="text-center font-mono text-xs whitespace-nowrap">{s.etd} → {s.eta}</td>
                      <td className="text-center font-mono text-xs whitespace-nowrap">${s.rate_20_dc} / ${s.rate_40_dc} / ${s.rate_40_hc}</td>
                      <td className="text-center font-mono text-xs whitespace-nowrap">${s.rate_20_rf} / ${s.rate_40_rf} / ${s.rate_40_rh}</td>
                      <td className="text-center font-mono text-xs whitespace-nowrap">
                        {s.expiry_date}
                        <div className="text-[10px] font-bold">{exp.state}</div>
                      </td>
                      <td className="text-center">
                        <div className="inline-flex flex-wrap items-center justify-center gap-1">
                          <button type="button" onClick={() => setSchModal({ open: true, isEdit: true, form: { ...s } })} className="keep-btn-style px-2 py-1 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold cursor-pointer">Sửa</button>
                          <button type="button" onClick={() => onRequestConfirm('Xóa lịch tàu?', `Xác nhận xóa ${s.schedule_id}?`, () => onDeleteSchedule(s.schedule_id), true)} className="keep-btn-style px-2 py-1 rounded bg-[#8c3b3b] text-white text-[11px] font-bold cursor-pointer">Xóa</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {schModal.open && schModal.form && (
          <div className="fixed inset-0 z-50 bg-[#07281c]/75 flex items-center justify-center p-4">
            <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5 text-[#f4f8f5] space-y-3 text-xs">
              <h4 className="text-base font-extrabold text-[#fff5d6]">{schModal.isEdit ? `Sửa Lịch tàu ${schModal.form.schedule_id}` : 'Thêm Lịch tàu Mới'}</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div><label className="block font-bold mb-1">Schedule ID</label><input disabled={schModal.isEdit} value={schModal.form.schedule_id} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, schedule_id: e.target.value } })} className="agri-input font-mono" /></div>
                <div><label className="block font-bold mb-1">Hãng tàu</label><input value={schModal.form.shipping_line} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, shipping_line: e.target.value } })} className="agri-input" /></div>
                <div><label className="block font-bold mb-1">Quốc gia đến</label><input value={schModal.form.country} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, country: e.target.value } })} className="agri-input" /></div>
                <div><label className="block font-bold mb-1">POD</label><input value={schModal.form.pod} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, pod: e.target.value } })} className="agri-input" /></div>
                <div><label className="block font-bold mb-1">POL</label><input value={schModal.form.pol} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, pol: e.target.value } })} className="agri-input" /></div>
                <div><label className="block font-bold mb-1">POT (Chuyển tải)</label><input value={schModal.form.pot} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, pot: e.target.value } })} className="agri-input" /></div>
                <div><label className="block font-bold mb-1">Tàu (Vessel)</label><input value={schModal.form.vessel} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, vessel: e.target.value } })} className="agri-input" /></div>
                <div><label className="block font-bold mb-1">Chuyến (Voyage)</label><input value={schModal.form.voyage} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, voyage: e.target.value } })} className="agri-input font-mono" /></div>
                <div><label className="block font-bold mb-1">ETD</label><input type="date" value={schModal.form.etd} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, etd: e.target.value } })} className="agri-input font-mono" /></div>
                <div><label className="block font-bold mb-1">ETA</label><input type="date" value={schModal.form.eta} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, eta: e.target.value } })} className="agri-input font-mono" /></div>
                <div><label className="block font-bold mb-1">Hết hạn cước</label><input type="date" value={schModal.form.expiry_date} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, expiry_date: e.target.value } })} className="agri-input font-mono" /></div>
                <div><label className="block font-bold mb-1">Bill+Seal / Lô ($)</label><input type="number" value={schModal.form.bill_seal_fee_shipment} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, bill_seal_fee_shipment: toNum(e.target.value) } })} className="agri-input font-mono" /></div>
                <div><label className="block font-bold mb-1">Rate 20'DC ($)</label><input type="number" value={schModal.form.rate_20_dc} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, rate_20_dc: toNum(e.target.value) } })} className="agri-input font-mono" /></div>
                <div><label className="block font-bold mb-1">Rate 40'DC ($)</label><input type="number" value={schModal.form.rate_40_dc} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, rate_40_dc: toNum(e.target.value) } })} className="agri-input font-mono" /></div>
                <div><label className="block font-bold mb-1">Rate 40'HC ($)</label><input type="number" value={schModal.form.rate_40_hc} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, rate_40_hc: toNum(e.target.value) } })} className="agri-input font-mono" /></div>
                <div><label className="block font-bold mb-1">Rate 20'RF ($)</label><input type="number" value={schModal.form.rate_20_rf} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, rate_20_rf: toNum(e.target.value) } })} className="agri-input font-mono" /></div>
                <div><label className="block font-bold mb-1">Rate 40'RF ($)</label><input type="number" value={schModal.form.rate_40_rf} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, rate_40_rf: toNum(e.target.value) } })} className="agri-input font-mono" /></div>
                <div><label className="block font-bold mb-1">Rate 40'RH ($)</label><input type="number" value={schModal.form.rate_40_rh} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, rate_40_rh: toNum(e.target.value) } })} className="agri-input font-mono" /></div>
                <div><label className="block font-bold mb-1">THC 20 Dry</label><input type="number" value={schModal.form.thc_20_dry} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, thc_20_dry: toNum(e.target.value) } })} className="agri-input font-mono" /></div>
                <div><label className="block font-bold mb-1">THC 40 Dry</label><input type="number" value={schModal.form.thc_40_dry} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, thc_40_dry: toNum(e.target.value) } })} className="agri-input font-mono" /></div>
                <div><label className="block font-bold mb-1">THC 20 Reefer</label><input type="number" value={schModal.form.thc_20_reefer} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, thc_20_reefer: toNum(e.target.value) } })} className="agri-input font-mono" /></div>
                <div><label className="block font-bold mb-1">THC 40 Reefer</label><input type="number" value={schModal.form.thc_40_reefer} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, thc_40_reefer: toNum(e.target.value) } })} className="agri-input font-mono" /></div>
                <div><label className="block font-bold mb-1">B/L Fee ($)</label><input type="number" value={schModal.form.b_l_fee} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, b_l_fee: toNum(e.target.value) } })} className="agri-input font-mono" /></div>
                <div><label className="block font-bold mb-1">Seal Fee ($)</label><input type="number" value={schModal.form.seal_fee} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, seal_fee: toNum(e.target.value) } })} className="agri-input font-mono" /></div>
                <div><label className="block font-bold mb-1">BAF ($/cont)</label><input type="number" value={schModal.form.baf_fee} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, baf_fee: toNum(e.target.value) } })} className="agri-input font-mono" /></div>
                <div><label className="block font-bold mb-1">LSS ($/cont)</label><input type="number" value={schModal.form.lss_fee} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, lss_fee: toNum(e.target.value) } })} className="agri-input font-mono" /></div>
                <div><label className="block font-bold mb-1">PSS ($/cont)</label><input type="number" value={schModal.form.pss_fee} onChange={(e) => setSchModal({ ...schModal, form: { ...schModal.form!, pss_fee: toNum(e.target.value) } })} className="agri-input font-mono" /></div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setSchModal({ open: false, isEdit: false, form: null })} className="px-3 py-1.5 rounded bg-[#07281c] text-white font-bold cursor-pointer">Hủy</button>
                <button type="button" onClick={async () => { await onUpsertSchedule(schModal.form!, schModal.isEdit); setSchModal({ open: false, isEdit: false, form: null }); }} className="agri-btn-gold">Lưu Lịch tàu</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (activeView === 'xnk-rates') {
    const categories = ['ALL', 'LOCAL_CHARGE', 'CUSTOMS_FEE', 'INSURANCE', 'PACKING', 'CONTAINER'];
    const list = data.pricingRates.filter((r) => (rateCat === 'ALL' || r.fee_category.toUpperCase() === rateCat) && (!qLower || `${r.fee_code} ${r.fee_name_vie} ${r.fee_category}`.toLowerCase().includes(qLower)));
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1 bg-[#07281c] p-1 rounded-xl border border-[#186635]">
            {categories.map((cat) => (
              <button key={cat} type="button" onClick={() => setRateCat(cat)} className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${rateCat === cat ? 'bg-[#f4d98a] text-[#07281c]' : 'text-[#d2ebe0]'}`}>
                {cat}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              setRateModal({
                open: true,
                isEdit: false,
                form: {
                  fee_category: rateCat === 'ALL' ? 'LOCAL_CHARGE' : rateCat,
                  fee_code: '',
                  scope_or_cont_type: 'ALL',
                  fee_name_vie: '',
                  contract_text_eng: '',
                  unit_basis: 'Container',
                  standard_rate: 0,
                  provider_or_rule: '',
                  note: '',
                  dim_cm: '',
                  net_kg: 0,
                  tare_kg: 0,
                  max_per_pallet: 0,
                },
              })
            }
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
                  <th className="text-center">Đơn giá chuẩn</th>
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
                    <td className="text-center font-mono font-extrabold whitespace-nowrap">{toNum(r.standard_rate).toFixed(2)}</td>
                    <td className="text-center">
                      <div className="inline-flex flex-wrap items-center justify-center gap-1">
                        <button type="button" onClick={() => setRateModal({ open: true, isEdit: true, form: { ...r } })} className="keep-btn-style px-2 py-1 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold cursor-pointer">Sửa</button>
                        <button type="button" onClick={() => onRequestConfirm('Xóa phụ phí?', `Xác nhận xóa ${r.fee_code}?`, () => onDeleteRate(r.fee_code), true)} className="keep-btn-style px-2 py-1 rounded bg-[#8c3b3b] text-white text-[11px] font-bold cursor-pointer">Xóa</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {rateModal.open && rateModal.form && (
          <div className="fixed inset-0 z-50 bg-[#07281c]/75 flex items-center justify-center p-4">
            <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl w-full max-w-xl p-5 text-[#f4f8f5] space-y-3 text-xs">
              <h4 className="text-base font-extrabold text-[#fff5d6]">{rateModal.isEdit ? 'Sửa Biểu phí' : 'Thêm Biểu phí Mới'}</h4>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block font-bold mb-1">Nhóm (Fee_Category)</label><input value={rateModal.form.fee_category} onChange={(e) => setRateModal({ ...rateModal, form: { ...rateModal.form!, fee_category: e.target.value } })} className="agri-input font-mono" /></div>
                <div><label className="block font-bold mb-1">Mã phí (Fee_Code)</label><input disabled={rateModal.isEdit} value={rateModal.form.fee_code} onChange={(e) => setRateModal({ ...rateModal, form: { ...rateModal.form!, fee_code: e.target.value } })} className="agri-input font-mono" /></div>
                <div className="col-span-2"><label className="block font-bold mb-1">Tên Tiếng Việt</label><input value={rateModal.form.fee_name_vie} onChange={(e) => setRateModal({ ...rateModal, form: { ...rateModal.form!, fee_name_vie: e.target.value } })} className="agri-input" /></div>
                <div className="col-span-2"><label className="block font-bold mb-1">Mô tả Hợp đồng (ENG)</label><input value={rateModal.form.contract_text_eng} onChange={(e) => setRateModal({ ...rateModal, form: { ...rateModal.form!, contract_text_eng: e.target.value } })} className="agri-input" /></div>
                <div><label className="block font-bold mb-1">Phạm vi / Cont</label><input value={rateModal.form.scope_or_cont_type} onChange={(e) => setRateModal({ ...rateModal, form: { ...rateModal.form!, scope_or_cont_type: e.target.value } })} className="agri-input" /></div>
                <div><label className="block font-bold mb-1">Đơn vị tính</label><input value={rateModal.form.unit_basis} onChange={(e) => setRateModal({ ...rateModal, form: { ...rateModal.form!, unit_basis: e.target.value } })} className="agri-input" /></div>
                <div><label className="block font-bold mb-1">Mức phí chuẩn</label><input type="number" step="0.01" value={rateModal.form.standard_rate} onChange={(e) => setRateModal({ ...rateModal, form: { ...rateModal.form!, standard_rate: toNum(e.target.value) } })} className="agri-input font-mono font-bold" /></div>
                <div><label className="block font-bold mb-1">Kích thước (Dim CM)</label><input value={rateModal.form.dim_cm} onChange={(e) => setRateModal({ ...rateModal, form: { ...rateModal.form!, dim_cm: e.target.value } })} className="agri-input font-mono" /></div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setRateModal({ open: false, isEdit: false, form: null })} className="px-3 py-1.5 rounded bg-[#07281c] text-white font-bold cursor-pointer">Hủy</button>
                <button type="button" onClick={async () => { await onUpsertRate(rateModal.form!, rateModal.isEdit); setRateModal({ open: false, isEdit: false, form: null }); }} className="agri-btn-gold">Lưu Biểu phí</button>
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

    const handleOpenTagEditorForExistingRow = async (tpl: TemplateManager) => {
      if (!tpl.google_doc_file_id) {
        onToast('warning', 'Mẫu này chưa có tệp .docx. Vui lòng chọn "Sửa / Thay phôi" để tải tệp lên trước.');
        return;
      }
      setTagEditorLoadingId(tpl.template_id);
      try {
        const buf = await downloadTemplateDocx(tpl.google_doc_file_id);
        await openTagReviewModal(tpl, true, buf);
      } catch (err: any) {
        onToast('error', err?.message || 'Không thể tải tệp phôi .docx.');
      } finally {
        setTagEditorLoadingId(null);
      }
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
            tags.length > 0 ? tags.join(', ') : tplModal.form.supported_placeholders,
        };
        setTplModal({
          ...tplModal,
          form: updatedForm,
        });

        // When uploading a raw .docx file without existing tags, automatically launch interactive #-Marker Tag Review Modal
        if (tags.length === 0) {
          await openTagReviewModal(updatedForm, tplModal.isEdit, buf);
        }
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
          supported_placeholders: mergedKeys.join(', '),
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

      const cursor =
        activeCursorRef.current && activeCursorRef.current.blockId === targetId
          ? activeCursorRef.current
          : { blockId: targetId, start: block.text.length, end: block.text.length };

      const before = block.text.slice(0, cursor.start);
      const after = block.text.slice(cursor.end);
      const nextText = `${before}${snippet}${after}`;
      const nextCaret = cursor.start + snippet.length;

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
          supported_placeholders: finalTags.join(', '),
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
      const upper = key.toUpperCase();
      const exists = currentKeys.some((k) => k.toUpperCase() === upper);
      const nextKeys = exists
        ? currentKeys.filter((k) => k.toUpperCase() !== upper)
        : [...currentKeys, key];
      setTplModal({
        ...tplModal,
        form: {
          ...tplModal.form,
          supported_placeholders: nextKeys.join(', '),
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
                  <th className="text-center w-[225px] whitespace-nowrap">THAO TÁC</th>
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
                  const isRowLoading = tagEditorLoadingId === t.template_id;

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
                        <div className="inline-flex items-center justify-center gap-1">
                          {t.google_doc_file_id && (
                            <button
                              type="button"
                              onClick={() =>
                                openDocumentWithSignedUrl(t.google_doc_file_id).catch((err: any) =>
                                  onToast('error', err?.message || 'Không thể tải phôi.')
                                )
                              }
                              className="keep-btn-style px-2 py-1 rounded bg-[#16977f] text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <FileDown className="w-3 h-3" /> Tải
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isRowLoading}
                            onClick={() => void handleOpenTagEditorForExistingRow(t)}
                            className="keep-btn-style px-2 py-1 rounded bg-[#f4d98a] text-[#07281c] text-[11px] font-extrabold inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                          >
                            {isRowLoading ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Sparkles className="w-3 h-3" />
                            )}
                            <span>Tự thêm biến</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setTplFile(null);
                              setTplDetectedTags([]);
                              setTplFieldSearch('');
                              setTplModal({
                                open: true,
                                isEdit: true,
                                form: {
                                  ...t,
                                  target_department: normalizeTemplateDepartment(
                                    t.target_department,
                                    t.template_id,
                                    t.document_name
                                  ),
                                },
                              });
                            }}
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
                        await onUpsertTemplate(
                          {
                            ...tplModal.form!,
                            target_department: normalizeTemplateDepartment(
                              tplModal.form!.target_department,
                              tplModal.form!.template_id,
                              tplModal.form!.document_name
                            ),
                          },
                          tplModal.isEdit
                        );
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
                {/* Left: Extracted Document Blocks */}
                <div className="lg:col-span-8 flex flex-col min-h-0 bg-[#0b3a27] border-r border-[#186635]">
                  <div className="px-3.5 py-2.5 bg-[#07281c] border-b border-[#186635] flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="relative flex-1 min-w-[200px]">
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
                  </div>

                  <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5 max-h-[60vh]">
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
          <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl w-full max-w-lg p-5 text-[#f4f8f5] space-y-3 text-xs">
            <h4 className="text-base font-extrabold text-[#fff5d6]">
              {usrModal.isEdit ? `Cập nhật Nhân sự (${usrModal.form.employee_id})` : 'Thêm Nhân sự Mới'}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block font-bold mb-1">Mã NV</label>
                <input disabled={usrModal.isEdit} placeholder="Mã NV" value={usrModal.form.employee_id} onChange={(e) => setUsrModal({ ...usrModal, form: { ...usrModal.form!, employee_id: e.target.value } })} className="agri-input font-mono" />
              </div>
              <div>
                <label className="block font-bold mb-1">Họ tên *</label>
                <input
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
                <input type="email" placeholder="name@greenagri-vn.com" value={usrModal.form.email} onChange={(e) => setUsrModal({ ...usrModal, form: { ...usrModal.form!, email: e.target.value } })} className="agri-input" />
              </div>
              {!usrModal.isEdit && (
                <div className="sm:col-span-2">
                  <label className="block font-bold mb-1">Mật khẩu khởi tạo (tùy chọn, ≥ 6 ký tự)</label>
                  <input
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
                <select value={usrModal.form.status} onChange={(e) => setUsrModal({ ...usrModal, form: { ...usrModal.form!, status: e.target.value } })} className="agri-input">
                  <option value="Active">Active (Đang hoạt động)</option>
                  <option value="PENDING">PENDING (Chờ duyệt)</option>
                  <option value="Inactive">Inactive (Tạm khóa)</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setUsrModal({ open: false, isEdit: false, form: null, initialPassword: '' })} className="px-3 py-1.5 rounded bg-[#07281c] text-white font-bold cursor-pointer">Hủy</button>
              <button
                type="button"
                onClick={async () => {
                  if (!usrModal.form!.full_name.trim() || !usrModal.form!.email.trim()) {
                    onToast('warning', 'Vui lòng nhập đầy đủ Họ tên và Email.');
                    return;
                  }
                  if (!usrModal.isEdit && usrModal.initialPassword && usrModal.initialPassword.length < 6) {
                    onToast('warning', 'Mật khẩu khởi tạo phải có ít nhất 6 ký tự.');
                    return;
                  }
                  await onUpsertUser(usrModal.form!, usrModal.isEdit, usrModal.initialPassword || undefined);
                  setUsrModal({ open: false, isEdit: false, form: null, initialPassword: '' });
                }}
                className="agri-btn-gold"
              >
                Lưu Nhân sự
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
