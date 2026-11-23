import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Edit3, Package, Ship, Receipt, FileCode2, ShieldCheck, Sparkles, Upload, FileDown, Loader2 } from 'lucide-react';
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
  extractDocxParagraphBlocks,
  extractPlaceholdersFromDocx,
} from '../utils/docxEngine';
import {
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
  const [usrModal, setUsrModal] = useState<{ open: boolean; isEdit: boolean; form: SysUser | null; initialPassword: string }>({
    open: false,
    isEdit: false,
    form: null,
    initialPassword: '',
  });

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
    const handleSelectDocxFile = async (file: File | null) => {
      setTplFile(file);
      setTplDetectedTags([]);
      if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        const tags = await extractPlaceholdersFromDocx(buf);
        setTplDetectedTags(tags);
        if (tplModal.form) {
          const baseName = file.name.replace(/\.docx$/i, '');
          const autoId = tplModal.form.template_id || `TMP_${baseName.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
          setTplModal({
            ...tplModal,
            form: {
              ...tplModal.form,
              template_id: autoId,
              document_name: tplModal.form.document_name || baseName,
              google_doc_file_id: `templates/${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
              supported_placeholders: tags.length > 0 ? tags.join(', ') : tplModal.form.supported_placeholders,
            },
          });
        }
      } catch (err: any) {
        onToast('error', err?.message || 'File .docx không hợp lệ.');
      }
    };

    const handleUploadTaggedDocx = async () => {
      if (!tplModal.form || !tplFile) return;
      if (!tplModal.form.template_id.trim()) {
        onToast('warning', 'Vui lòng nhập Template ID.');
        return;
      }
      setTplBusy(true);
      try {
        const buf = await tplFile.arrayBuffer();
        const tags = await extractPlaceholdersFromDocx(buf);
        const storagePath = await uploadTemplateDocx(tplFile.name, buf);
        const nextRow: TemplateManager = {
          ...tplModal.form,
          google_doc_file_id: storagePath,
          supported_placeholders: tags.join(', ') || tplModal.form.supported_placeholders,
        };
        await onUpsertTemplate(nextRow, tplModal.isEdit);
        setTplModal({ open: false, isEdit: false, form: null });
        setTplFile(null);
      } catch (err: any) {
        onToast('error', err?.message || 'Lỗi tải phôi lên Storage.');
      } finally {
        setTplBusy(false);
      }
    };

    const handleAiSmartFillAndSave = async () => {
      if (!tplModal.form || !tplFile) {
        onToast('warning', 'Vui lòng chọn file .docx thô cần gắn biến.');
        return;
      }
      if (!tplModal.form.template_id.trim()) {
        onToast('warning', 'Vui lòng nhập Template ID.');
        return;
      }
      setTplBusy(true);
      try {
        const buf = await tplFile.arrayBuffer();
        const blocks = await extractDocxParagraphBlocks(buf);
        if (blocks.length === 0) {
          throw new Error('Không đọc được nội dung văn bản trong file .docx.');
        }

        const resp = await fetch('/api/gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'smart_fill_template',
            documentName: tplModal.form.document_name || tplFile.name,
            targetDepartment: tplModal.form.target_department || 'XNK',
            blocks: blocks.map((b) => ({ id: b.id, text: b.text })),
            existingPlaceholders: data.templatePlaceholders.map((p) => ({
              placeholder_key: p.placeholder_key,
              scope: p.scope,
              source_table: p.source_table,
              source_column: p.source_column,
              description_vie: p.description_vie,
            })),
          }),
        });
        const json = await resp.json();
        if (!resp.ok || !json.success) {
          throw new Error(json.message || 'Lỗi Gemini AI Smart-Fill.');
        }

        const replacements = Array.isArray(json.replacements) ? json.replacements : [];
        const newPlaceholders = (Array.isArray(json.newPlaceholders) ? json.newPlaceholders : []) as TemplatePlaceholder[];
        const taggedBytes = await applyAiTagsToDocx(buf, replacements);
        const abTagged = taggedBytes.buffer.slice(taggedBytes.byteOffset, taggedBytes.byteOffset + taggedBytes.byteLength) as ArrayBuffer;
        const finalTags = await extractPlaceholdersFromDocx(abTagged);

        const storagePath = await uploadTemplateDocx(tplFile.name, taggedBytes);
        const existingKeySet = new Set(data.templatePlaceholders.map((p) => p.placeholder_key.toUpperCase()));
        const trulyNew = newPlaceholders
          .filter((np) => np.placeholder_key && !existingKeySet.has(np.placeholder_key.trim().toUpperCase()))
          .map((np) => ({ ...np, is_auto_created: true }));

        if (trulyNew.length > 0) {
          await upsertTemplatePlaceholders(trulyNew);
        }

        await onUpsertTemplate(
          {
            ...tplModal.form,
            google_doc_file_id: storagePath,
            supported_placeholders: finalTags.join(', '),
          },
          tplModal.isEdit
        );
        if (onRefreshData) await onRefreshData();

        onToast(
          'success',
          `AI đã gắn ${finalTags.length} biến vào phôi (tạo mới ${trulyNew.length} biến vào template_placeholders).`
        );
        setTplModal({ open: false, isEdit: false, form: null });
        setTplFile(null);
      } catch (err: any) {
        onToast('error', err?.message || 'Lỗi AI Smart-Fill.');
      } finally {
        setTplBusy(false);
      }
    };

    return (
      <div className="space-y-5">
        <div className="agri-table-wrap">
          <div className="px-4 py-3 bg-[#0f4a33] border-b border-[#186635] flex items-center justify-between gap-2">
            <h3 className="text-sm font-extrabold text-[#fff5d6] flex items-center gap-2">
              <FileCode2 className="w-4 h-4 text-[#f4d98a]" /> Quản lý Phôi mẫu Chứng từ .docx (template_manager)
            </h3>
            <button
              type="button"
              onClick={() => {
                setTplFile(null);
                setTplDetectedTags([]);
                setTplModal({
                  open: true,
                  isEdit: false,
                  form: {
                    template_id: '',
                    document_name: '',
                    google_doc_file_id: '',
                    target_department: 'XNK',
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
          <div className="agri-table-scroll">
            <table className="agri-table">
              <thead>
                <tr>
                  <th className="text-center">Template ID</th>
                  <th className="text-left">Tên chứng từ</th>
                  <th className="text-center">Phòng ban</th>
                  <th className="text-left">Storage Path (.docx)</th>
                  <th className="text-left">Biến hỗ trợ</th>
                  <th className="text-center">Trạng thái</th>
                  <th className="text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {data.templates.map((t) => (
                  <tr key={t.template_id}>
                    <td className="text-center font-mono font-bold whitespace-nowrap">{t.template_id}</td>
                    <td className="text-left font-bold">{t.document_name}</td>
                    <td className="text-center font-bold">{t.target_department}</td>
                    <td className="text-left font-mono text-xs">{t.google_doc_file_id || '-'}</td>
                    <td className="text-left font-mono text-[10.5px] max-w-xs truncate" title={t.supported_placeholders}>
                      {t.supported_placeholders || '-'}
                    </td>
                    <td className="text-center">
                      <span className="keep-badge-color inline-block px-2 py-0.5 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold">
                        {t.status}
                      </span>
                    </td>
                    <td className="text-center">
                      <div className="inline-flex flex-wrap items-center justify-center gap-1">
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
                          onClick={() => {
                            setTplFile(null);
                            setTplDetectedTags([]);
                            setTplModal({ open: true, isEdit: true, form: { ...t } });
                          }}
                          className="keep-btn-style px-2 py-1 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold cursor-pointer"
                        >
                          Sửa / Thay phôi
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Từ điển biến chuẩn template_placeholders */}
        <div className="agri-table-wrap">
          <div className="px-4 py-3 bg-[#0f4a33] border-b border-[#186635]">
            <h3 className="text-sm font-extrabold text-[#fff5d6]">
              Từ điển Biến Phôi mẫu (template_placeholders · {data.templatePlaceholders.length} biến)
            </h3>
          </div>
          <div className="agri-table-scroll">
            <table className="agri-table">
              <thead>
                <tr>
                  <th>Placeholder Key</th>
                  <th>Phạm vi (Scope)</th>
                  <th>Bảng nguồn</th>
                  <th>Cột / Công thức</th>
                  <th>Mô tả tiếng Việt</th>
                </tr>
              </thead>
              <tbody>
                {data.templatePlaceholders.map((tp) => (
                  <tr key={tp.placeholder_key}>
                    <td className="font-mono font-bold">
                      {`{{${tp.placeholder_key}}}`}
                      {tp.is_auto_created && (
                        <span className="keep-badge-color ml-1.5 px-1.5 py-0.5 rounded bg-[#f4d98a] text-[#07281c] text-[10px] font-extrabold">
                          AI Auto
                        </span>
                      )}
                    </td>
                    <td className="font-mono text-xs">{tp.scope}</td>
                    <td className="font-mono text-xs">{tp.source_table}</td>
                    <td className="font-mono text-xs">{tp.source_column}</td>
                    <td className="text-xs">{tp.description_vie}</td>
                  </tr>
                ))}
                {data.templatePlaceholders.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-6 opacity-75">
                      Chưa có bản ghi trong bảng template_placeholders.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {tplModal.open && tplModal.form && (
          <div className="fixed inset-0 z-50 bg-[#07281c]/75 flex items-center justify-center p-4">
            <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl w-full max-w-xl p-5 text-[#f4f8f5] space-y-3 text-xs">
              <h4 className="text-base font-extrabold text-[#fff5d6]">
                {tplModal.isEdit ? 'Cập nhật Phôi mẫu Chứng từ (.docx)' : 'Thêm Phôi mẫu Chứng từ (.docx)'}
              </h4>

              <div className="agri-card-inner p-3 space-y-2">
                <label className="block font-extrabold text-[#07281c]">
                  Chọn file Word (.docx) từ máy để tải lên Storage hoặc gắn biến tự động bằng AI:
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
                      ? `Phát hiện ${tplDetectedTags.length} biến {{...}} sẵn có: ${tplDetectedTags.slice(0, 8).join(', ')}${tplDetectedTags.length > 8 ? '...' : ''}`
                      : 'Chưa phát hiện thẻ {{...}} — Có thể bấm "Tự gắn biến AI & Lưu phôi" để AI tự động đánh dấu biến chuẩn.'}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-bold mb-1">Template ID *</label>
                  <input
                    disabled={tplModal.isEdit}
                    placeholder="VD: TMP_CONTRACT_EDIBLE_NUTS"
                    value={tplModal.form.template_id}
                    onChange={(e) => setTplModal({ ...tplModal, form: { ...tplModal.form!, template_id: e.target.value } })}
                    className="agri-input font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Phòng ban</label>
                  <select
                    value={tplModal.form.target_department}
                    onChange={(e) => setTplModal({ ...tplModal, form: { ...tplModal.form!, target_department: e.target.value } })}
                    className="agri-input"
                  >
                    <option value="XNK">XNK</option>
                    <option value="SALES">SALES</option>
                    <option value="ALL">ALL</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block font-bold mb-1">Tên chứng từ *</label>
                  <input
                    placeholder="VD: Sales Contract - Edible Nuts (.docx)"
                    value={tplModal.form.document_name}
                    onChange={(e) => setTplModal({ ...tplModal, form: { ...tplModal.form!, document_name: e.target.value } })}
                    className="agri-input"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block font-bold mb-1">Đường dẫn Storage (documents bucket)</label>
                  <input
                    placeholder="templates/TMP_CONTRACT_EDIBLE_NUTS.docx"
                    value={tplModal.form.google_doc_file_id}
                    onChange={(e) => setTplModal({ ...tplModal, form: { ...tplModal.form!, google_doc_file_id: e.target.value } })}
                    className="agri-input font-mono"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block font-bold mb-1">Danh sách biến hỗ trợ</label>
                  <input
                    placeholder="CTR_NO, CNE_NAME, TOT_AMT_WORDS..."
                    value={tplModal.form.supported_placeholders}
                    onChange={(e) => setTplModal({ ...tplModal, form: { ...tplModal.form!, supported_placeholders: e.target.value } })}
                    className="agri-input font-mono"
                  />
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={tplBusy}
                  onClick={() => setTplModal({ open: false, isEdit: false, form: null })}
                  className="px-3 py-1.5 rounded bg-[#07281c] text-white font-bold cursor-pointer"
                >
                  Hủy
                </button>
                {tplFile ? (
                  <>
                    <button
                      type="button"
                      disabled={tplBusy}
                      onClick={() => void handleUploadTaggedDocx()}
                      className="px-3 py-1.5 rounded-lg bg-[#16977f] hover:bg-[#117865] text-white font-bold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      {tplBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      <span>Tải phôi lên Storage &amp; Lưu</span>
                    </button>
                    <button
                      type="button"
                      disabled={tplBusy}
                      onClick={() => void handleAiSmartFillAndSave()}
                      className="agri-btn-gold inline-flex items-center gap-1.5"
                    >
                      {tplBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      <span>Tự gắn biến AI &amp; Lưu phôi</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={tplBusy}
                    onClick={async () => {
                      await onUpsertTemplate(tplModal.form!, tplModal.isEdit);
                      setTplModal({ open: false, isEdit: false, form: null });
                    }}
                    className="agri-btn-gold"
                  >
                    Lưu Metadata Phôi mẫu
                  </button>
                )}
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
            <ShieldCheck className="w-4 h-4 text-[#f4d98a]" /> Tài khoản &amp; Phân quyền Nhân sự (sys_users)
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
                <th className="text-left">Email (Supabase Auth)</th>
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
              {usrModal.isEdit ? `Cập nhật Nhân sự (${usrModal.form.employee_id})` : 'Thêm Nhân sự Mới (sys_users)'}
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
                <label className="block font-bold mb-1">Email Supabase Auth *</label>
                <input type="email" placeholder="name@greenagri-vn.com" value={usrModal.form.email} onChange={(e) => setUsrModal({ ...usrModal, form: { ...usrModal.form!, email: e.target.value } })} className="agri-input" />
              </div>
              {!usrModal.isEdit && (
                <div className="sm:col-span-2">
                  <label className="block font-bold mb-1">Mật khẩu khởi tạo Supabase Auth (tùy chọn, ≥ 6 ký tự)</label>
                  <input
                    type="password"
                    placeholder="Bỏ trống nếu nhân sự đã có tài khoản Auth"
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
