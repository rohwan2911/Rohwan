import React, { useEffect, useMemo, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';
import {
  X,
  Printer,
  Mail,
  SlidersHorizontal,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Send,
  Loader2,
  FileDown,
  Save,
  PenLine,
  ListChecks,
  ZoomIn,
} from 'lucide-react';
import type {
  AppDataState,
  OrderLogisticsMeta,
  ProposalExtraMeta,
  SysUser,
} from '../types';
import {
  buildCombinedInsuranceClauseEng,
  cleanQuoteNoForCustomer,
  computeFloorPriceScaled,
  computeSellingPriceScaled,
  computeSilentFobUnitPrices,
  fmtDecimal,
  fmtNumber,
  fmtUSD,
  formatCurrency,
  getOrderStage6Number,
  INCOTERMS_2020_MATRIX,
  parseInsuranceCodeString,
  parseOrderItems,
  resolvePackingSpec,
  stripInternalCodesForCustomer,
  toNum,
  WORKFLOW_6_STAGES,
} from '../utils/calculations';
import {
  buildExportEmailHtml,
  buildQuotationEmailHtml,
  buildQuotationEmailSubject,
} from '../utils/documentHtml';
import {
  buildTemplateFieldContext,
  extractPlaceholdersFromDocx,
  numberToEnglishWordsUsd,
  renderPopulatedDocxBytes,
  selectMatchingTemplates,
  TemplateFieldDescriptor,
} from '../utils/docxEngine';
import {
  downloadTemplateDocx,
  saveGeneratedDocumentRecord,
  uploadGeneratedOrderDocx,
} from '../services/supabaseService';

export interface PreviewModalTarget {
  kind: 'QUOTATION' | 'CONTRACT' | 'INVOICE' | 'PACKING_LIST' | 'CO' | 'BL';
  orderId: string;
  initialQuotationTemplate?: 'TMP_QUOTATION_01' | 'INTERNAL_COSTING_SHEET';
}

type PreviewZoomPreset = 'FIT' | '75' | '85' | '100';
type QuotationTemplateKind = 'TMP_QUOTATION_01' | 'INTERNAL_COSTING_SHEET';

const INTERNAL_ONLY_FIELD_PATTERN =
  /(GOODS_COST|MARGIN|FLOOR|INTERNAL|PROFIT|SELF_TRUCK|FWD_|PACKING_COST|PALLET_FEE|LOCAL_CHARGE)/i;

interface DocumentPreviewModalProps {
  target: PreviewModalTarget | null;
  data: AppDataState;
  currentUser?: SysUser;
  orderMetaMap: Record<string, OrderLogisticsMeta>;
  proposalMetaMap: Record<string, ProposalExtraMeta>;
  allowQuickAdjust: boolean;
  allowInternalView?: boolean;
  onClose: () => void;
  onConfirmQuickAdjust?: (orderId: string, newIncoterm: string, newPrice: number, templateMode: 'STANDARD' | 'COMPARISON') => Promise<void>;
  onMarkQuotationSent?: (orderId: string, linkOrSubject: string) => Promise<void>;
  onRequestRepriceFromModal?: (orderId: string, reason: string) => Promise<void>;
  onDocumentSaved?: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info' | 'warning', title: string) => void;
}

export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({
  target,
  data,
  currentUser,
  orderMetaMap,
  proposalMetaMap,
  allowQuickAdjust,
  allowInternalView = false,
  onClose,
  onConfirmQuickAdjust,
  onMarkQuotationSent,
  onRequestRepriceFromModal,
  onDocumentSaved,
  onToast,
}) => {
  const docxBodyRef = useRef<HTMLDivElement>(null);
  const internalSheetRef = useRef<HTMLDivElement>(null);
  const docxStyleRef = useRef<HTMLDivElement>(null);
  const printFrameRef = useRef<HTMLIFrameElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);

  const [quotationTemplateKind, setQuotationTemplateKind] = useState<QuotationTemplateKind>('TMP_QUOTATION_01');
  const [adjIncoterm, setAdjIncoterm] = useState('CIF');
  const [adjPrice, setAdjPrice] = useState('');
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBodyHtml, setEmailBodyHtml] = useState('');
  const [showEmailPane, setShowEmailPane] = useState(false);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [templateBuffer, setTemplateBuffer] = useState<ArrayBuffer | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [descriptors, setDescriptors] = useState<TemplateFieldDescriptor[]>([]);
  const [itemsRows, setItemsRows] = useState<Array<Record<string, string>>>([]);
  const [comparisonRows, setComparisonRows] = useState<Array<Record<string, string>>>([]);
  const [renderedDocxBytes, setRenderedDocxBytes] = useState<Uint8Array | null>(null);
  const [loadError, setLoadError] = useState<string>('');

  const [showFieldEditor, setShowFieldEditor] = useState(false);
  const [directEditMode, setDirectEditMode] = useState(false);
  const [zoomPreset, setZoomPreset] = useState<PreviewZoomPreset>('FIT');
  const [previewFrameWidth, setPreviewFrameWidth] = useState<number>(960);
  const [naturalDocSize, setNaturalDocSize] = useState<{ width: number; height: number }>({
    width: 820,
    height: 1120,
  });

  const [docLoading, setDocLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const ctx = useMemo(() => {
    if (!target) return null;
    const targetIdLow = target.orderId.trim().toLowerCase();
    const inq = data.inquiries.find((i) => i.order_id.trim().toLowerCase() === targetIdLow);
    const prop = data.proposals.find((p) => p.order_id.trim().toLowerCase() === targetIdLow);
    const extraMeta = proposalMetaMap[target.orderId];
    const order = data.orders.find((o) => o.order_id.trim().toLowerCase() === targetIdLow);
    const meta = orderMetaMap[target.orderId];
    const cusId = (order?.consignee_id || inq?.consignee_id || '').trim().toLowerCase();
    const cus = cusId
      ? data.consignees.find((c) => c.consignee_id.trim().toLowerCase() === cusId)
      : undefined;
    const schId = String(prop?.schedule_id || '').trim().toLowerCase();
    const sch = schId
      ? data.schedules.find((s) => s.schedule_id.trim().toLowerCase() === schId)
      : undefined;
    const items = inq
      ? parseOrderItems(inq, data.products, data.pricingRates)
      : order
      ? parseOrderItems(
          { sku_code: order.sku_code, net_weight_kgs: order.nw_confirmed_kgs, product_name_vie: order.sku_code },
          data.products,
          data.pricingRates
        )
      : [];
    return { inq, prop, extraMeta, order, meta, cus, sch, items };
  }, [target, data, orderMetaMap, proposalMetaMap]);

  const matchingTemplates = useMemo(() => {
    if (!target || !ctx) return [];
    return selectMatchingTemplates(data.templates, target.kind, ctx.items, data.products);
  }, [target, ctx, data.templates, data.products]);

  const isInternalCostingView =
    target?.kind === 'QUOTATION' && allowInternalView && quotationTemplateKind === 'INTERNAL_COSTING_SHEET';

  // Initialize metadata & auto-pick active .docx template whenever target changes
  useEffect(() => {
    if (!target || !ctx) return;
    if (target.kind === 'QUOTATION' && ctx.inq) {
      const nextKind: QuotationTemplateKind =
        allowInternalView && target.initialQuotationTemplate === 'INTERNAL_COSTING_SHEET'
          ? 'INTERNAL_COSTING_SHEET'
          : 'TMP_QUOTATION_01';
      setQuotationTemplateKind(nextKind);
      const inc = ctx.prop?.recommended_incoterm || ctx.inq.desired_incoterm || 'CIF';
      const price = toNum(ctx.prop?.final_selling_price);
      setAdjIncoterm(inc);
      setAdjPrice(price > 0 ? fmtDecimal(price, 2) : '');
      setEmailTo(ctx.cus?.email || ctx.inq.email || '');
      setEmailSubject(buildQuotationEmailSubject(ctx.inq, ctx.prop, ctx.extraMeta, data.products));
      setEmailBodyHtml(buildQuotationEmailHtml(ctx.inq, ctx.cus, ctx.prop, ctx.extraMeta, ctx.sch, data.products, inc, price));
    } else if (ctx.order) {
      setQuotationTemplateKind('TMP_QUOTATION_01');
      setEmailTo(ctx.cus?.email || ctx.inq?.email || '');
      const rawLabel = target.kind === 'CONTRACT' ? `Sales Contract ${ctx.order.contract_no}` : `${target.kind} – ${ctx.order.contract_no}`;
      const label = stripInternalCodesForCustomer(rawLabel) || rawLabel;
      setEmailSubject(`[GREEN AGRI-EXPORTS] ${label}`);
      setEmailBodyHtml(buildExportEmailHtml(label, ctx.order, ctx.cus));
    }

    setShowEmailPane(false);
    setShowFieldEditor(false);
    setDirectEditMode(false);
    setZoomPreset('FIT');
    setLoadError('');
    setRenderedDocxBytes(null);
    setTemplateBuffer(null);

    let bestTpl = '';
    if (ctx.meta?.template_id && matchingTemplates.some((t) => t.template_id === ctx.meta?.template_id)) {
      bestTpl = ctx.meta.template_id;
    } else {
      bestTpl = matchingTemplates[0]?.template_id || '';
    }
    setSelectedTemplateId(bestTpl);
  }, [target?.orderId, target?.kind, target?.initialQuotationTemplate, allowInternalView]);

  // Download & populate selected .docx template from Supabase Storage "documents" bucket
  useEffect(() => {
    if (!target || !ctx) return;
    const tpl = matchingTemplates.find((t) => t.template_id === selectedTemplateId) || matchingTemplates[0];
    if (!tpl || !tpl.google_doc_file_id) {
      setTemplateBuffer(null);
      setRenderedDocxBytes(null);
      setLoadError('Chưa có mẫu chứng từ phù hợp được kích hoạt cho loại hồ sơ này.');
      const built = buildTemplateFieldContext(
        {
          kind: target.kind,
          order: ctx.order,
          meta: ctx.meta,
          inq: ctx.inq,
          prop: ctx.prop,
          extraMeta: ctx.extraMeta,
          cus: ctx.cus,
          sch: ctx.sch,
          products: data.products,
          pricingRates: data.pricingRates,
          lookups: data.lookups,
          incoterms: data.incoterms,
          users: data.users,
          currentUser,
          templatePlaceholders: data.templatePlaceholders,
          overrideIncoterm: target.kind === 'QUOTATION' ? adjIncoterm : undefined,
          overrideSellingPrice: target.kind === 'QUOTATION' && toNum(adjPrice) > 0 ? toNum(adjPrice) : undefined,
        },
        []
      );
      setFieldValues(built.fields);
      setDescriptors(built.descriptors);
      setItemsRows(built.itemsTableRows);
      setComparisonRows(built.comparisonRows);
      setDocLoading(false);
      return;
    }

    let cancelled = false;
    setDocLoading(true);
    setLoadError('');

    (async () => {
      try {
        const buf = await downloadTemplateDocx(tpl.google_doc_file_id);
        if (cancelled) return;
        const keys = await extractPlaceholdersFromDocx(buf);
        if (cancelled) return;

        const built = buildTemplateFieldContext(
          {
            kind: target.kind,
            order: ctx.order,
            meta: ctx.meta,
            inq: ctx.inq,
            prop: ctx.prop,
            extraMeta: ctx.extraMeta,
            cus: ctx.cus,
            sch: ctx.sch,
            products: data.products,
            pricingRates: data.pricingRates,
            lookups: data.lookups,
            incoterms: data.incoterms,
            users: data.users,
            currentUser,
            templatePlaceholders: data.templatePlaceholders,
            overrideIncoterm: target.kind === 'QUOTATION' ? adjIncoterm : undefined,
            overrideSellingPrice: target.kind === 'QUOTATION' && toNum(adjPrice) > 0 ? toNum(adjPrice) : undefined,
          },
          keys
        );

        const docxBytes = await renderPopulatedDocxBytes(
          buf,
          built.fields,
          built.itemsTableRows,
          built.comparisonRows
        );
        if (cancelled) return;

        setTemplateBuffer(buf);
        setFieldValues(built.fields);
        setDescriptors(built.descriptors);
        setItemsRows(built.itemsTableRows);
        setComparisonRows(built.comparisonRows);
        setRenderedDocxBytes(docxBytes);
      } catch (err: any) {
        if (cancelled) return;
        setTemplateBuffer(null);
        setRenderedDocxBytes(null);
        setLoadError(err?.message || 'Không thể tải và hiển thị mẫu chứng từ.');
      } finally {
        if (!cancelled) setDocLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [target?.orderId, target?.kind, selectedTemplateId]);

  // Render exact .docx layout via docx-preview whenever renderedDocxBytes updates
  useEffect(() => {
    if (!renderedDocxBytes || !docxBodyRef.current || docLoading) return;
    let cancelled = false;
    const bodyEl = docxBodyRef.current;
    const styleEl = docxStyleRef.current || undefined;
    bodyEl.innerHTML = '';
    if (styleEl) styleEl.innerHTML = '';

    const ab = renderedDocxBytes.buffer.slice(
      renderedDocxBytes.byteOffset,
      renderedDocxBytes.byteOffset + renderedDocxBytes.byteLength
    ) as ArrayBuffer;

    renderAsync(ab, bodyEl, styleEl, {
      className: 'docx-preview-page',
      inWrapper: true,
      hideWrapperOnPrint: false,
      ignoreWidth: false,
      ignoreHeight: false,
      ignoreFonts: false,
      breakPages: true,
      useBase64URL: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
    })
      .then(() => {
        if (cancelled || !docxBodyRef.current) return;
        docxBodyRef.current.contentEditable = directEditMode ? 'true' : 'false';
        const measureDoc = () => {
          const el = docxBodyRef.current;
          if (!el) return;
          const pageEl = el.querySelector('.docx-preview-page') as HTMLElement | null;
          const w = Math.max(pageEl?.offsetWidth || 0, el.scrollWidth || 0, 794);
          const h = Math.max(el.scrollHeight || 0, pageEl?.offsetHeight || 0, 560);
          setNaturalDocSize({ width: w, height: h });
        };
        requestAnimationFrame(measureDoc);
        window.setTimeout(measureDoc, 120);
      })
      .catch(() => {
        // Ignore transient unmount during render
      });

    return () => {
      cancelled = true;
    };
  }, [renderedDocxBytes, docLoading]);

  useEffect(() => {
    const el = previewScrollRef.current;
    if (!el) return;
    const updateWidth = () => {
      if (el.clientWidth > 0) setPreviewFrameWidth(el.clientWidth);
    };
    updateWidth();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateWidth);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [target?.orderId, target?.kind, showFieldEditor, showEmailPane]);

  const effectiveZoomScale = useMemo(() => {
    if (zoomPreset === '75') return 0.75;
    if (zoomPreset === '85') return 0.85;
    if (zoomPreset === '100') return 1;
    const availW = Math.max(320, previewFrameWidth - 36);
    const docW = Math.max(600, naturalDocSize.width);
    const fitRatio = availW / docW;
    // Default Fit overview: ~75-85% on desktop viewports, or narrower if pane is tight
    const maxDesktopFit = previewFrameWidth >= 640 ? 0.82 : 0.96;
    return Math.round(Math.min(maxDesktopFit, Math.max(0.42, fitRatio)) * 100) / 100;
  }, [zoomPreset, previewFrameWidth, naturalDocSize.width]);

  useEffect(() => {
    if (docxBodyRef.current) {
      docxBodyRef.current.contentEditable = directEditMode ? 'true' : 'false';
    }
  }, [directEditMode]);

  const floorForSelectedInc = useMemo(() => {
    if (!ctx?.prop) return 0;
    return computeFloorPriceScaled(ctx.prop, ctx.extraMeta, adjIncoterm);
  }, [ctx, adjIncoterm]);

  const numericAdjPrice = toNum(adjPrice);
  const isBelowFloor = floorForSelectedInc > 0 && numericAdjPrice > 0 && numericAdjPrice < floorForSelectedInc;

  const applyBatchFieldsAndRerender = async (
    patch: Record<string, string>,
    overrideItemsRows?: Array<Record<string, string>>,
    overrideCompRows?: Array<Record<string, string>>
  ) => {
    const updated = { ...fieldValues, ...patch };
    const nextRows = overrideItemsRows || itemsRows;
    const nextCompRows = overrideCompRows || comparisonRows;
    setFieldValues(updated);
    if (overrideItemsRows) setItemsRows(overrideItemsRows);
    if (overrideCompRows) setComparisonRows(overrideCompRows);
    setDescriptors((prev) =>
      prev.map((d) => {
        const v = patch[d.key] ?? patch[d.key.toUpperCase()];
        return v !== undefined ? { ...d, value: v } : d;
      })
    );
    if (templateBuffer) {
      try {
        const bytes = await renderPopulatedDocxBytes(templateBuffer, updated, nextRows, nextCompRows);
        setRenderedDocxBytes(bytes);
      } catch {
        // Ignore transient render error while typing
      }
    }
  };

  // Re-render .docx live when user edits any field in CHỈNH DỮ LIỆU
  const handleFieldValueChange = async (key: string, nextVal: string) => {
    const upper = key.toUpperCase();
    const patch: Record<string, string> = {
      [key]: nextVal,
      [upper]: nextVal,
    };

    // Keep synced alias pairs consistent when user edits in sidebar
    if (upper === 'CTR_DT' || upper === 'CTR_DATE' || upper === 'CONTRACT_DATE') {
      patch.CTR_DT = nextVal;
      patch.CTR_DATE = nextVal;
      patch.CONTRACT_DATE = nextVal;
    } else if (upper === 'CTR_NO' || upper === 'CONTRACT_NO') {
      patch.CTR_NO = nextVal;
      patch.CONTRACT_NO = nextVal;
    } else if (upper === 'QUOT_NO' || upper === 'QT_NO' || upper === 'QUOTE_NO') {
      patch.QUOT_NO = nextVal;
      patch.QT_NO = nextVal;
      patch.QUOTE_NO = nextVal;
    } else if (upper === 'QUOT_DT' || upper === 'QT_DT' || upper === 'QT_DATE' || upper === 'QUOTE_DATE') {
      patch.QUOT_DT = nextVal;
      patch.QT_DT = nextVal;
      patch.QT_DATE = nextVal;
      patch.QUOTE_DATE = nextVal;
    } else if (upper === 'CNE_TEL' || upper === 'CNE_PHONE' || upper === 'BUYER_TEL') {
      patch.CNE_TEL = nextVal;
      patch.CNE_PHONE = nextVal;
      patch.BUYER_TEL = nextVal;
    } else if (upper === 'BUYER_NAME' || upper === 'BUYER_REP' || upper === 'CNE_CONTACT') {
      patch[upper] = nextVal;
    } else if (upper === 'TOTAL_AMT' || upper === 'TOT_AMT' || upper === 'TOTAL_AMOUNT' || upper === 'CTR_VAL') {
      patch.TOTAL_AMT = nextVal;
      patch.TOT_AMT = nextVal;
      patch.TOTAL_AMOUNT = nextVal;
      const numVal = toNum(nextVal);
      if (numVal > 0) {
        const words = numberToEnglishWordsUsd(numVal);
        patch.TOTAL_AMT_WORDS = words;
        patch.TOT_AMT_WORDS = words;
        patch.AMOUNT_IN_WORDS = words;
        if (upper !== 'CTR_VAL') patch.CTR_VAL = formatCurrency(numVal);
      }
    }

    let nextRows: Array<Record<string, string>> | undefined;
    if (itemsRows.length > 0 && itemsRows[0][upper] !== undefined) {
      nextRows = itemsRows.map((r, i) => (i === 0 ? { ...r, [upper]: nextVal } : r));
    }

    await applyBatchFieldsAndRerender(patch, nextRows);
  };

  if (!target || !ctx) return null;

  const cleanQuoteNo = cleanQuoteNoForCustomer(ctx.extraMeta?.quotation_no || '', target.orderId);
  const sendCount =
    typeof ctx.extraMeta?.send_count === 'number' && ctx.extraMeta.send_count > 0
      ? ctx.extraMeta.send_count
      : ctx.inq?.sent_mail_link
      ? 1
      : 0;

  const cleanQuoteTitle =
    target.kind === 'QUOTATION'
      ? isInternalCostingView
        ? `INTERNAL_COSTING_SHEET · ${target.orderId} (${cleanQuoteNo})`
        : `Báo giá ${cleanQuoteNo}`
      : `${target.kind} · ${ctx.order?.contract_no || target.orderId}`;

  const rawFileBase =
    target.kind === 'QUOTATION'
      ? isInternalCostingView
        ? `INTERNAL_COSTING_SHEET_${target.orderId}`
        : `Official_Quotation_${cleanQuoteNo}`
      : target.kind === 'CONTRACT' && ctx.order?.contract_no
      ? stripInternalCodesForCustomer(ctx.order.contract_no) || ctx.order.contract_no
      : stripInternalCodesForCustomer(cleanQuoteTitle) || cleanQuoteTitle;

  const safeDocFileName = `${rawFileBase
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')}.docx`;

  const handlePrint = () => {
    const bodyHtml = isInternalCostingView
      ? internalSheetRef.current?.innerHTML || ''
      : docxBodyRef.current?.innerHTML || '';
    const styleHtml = isInternalCostingView
      ? `<style>body{font-family:Inter,Arial,sans-serif;color:#0b2418;padding:18px;font-size:12px;} table{width:100%;border-collapse:collapse;margin-top:8px;} th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;} th{background:#0f4a33;color:#fff;} .num{text-align:right;font-family:monospace;}</style>`
      : docxStyleRef.current?.innerHTML || '';
    const frame = printFrameRef.current;
    if (!frame || !bodyHtml) return;
    const doc = frame.contentDocument || frame.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${cleanQuoteTitle}</title>${styleHtml}<style>@media print { body { margin: 0; background: #fff; } .docx-preview-page-wrapper { background: #fff !important; padding: 0 !important; box-shadow: none !important; } }</style></head><body>${bodyHtml}</body></html>`);
    doc.close();
    window.setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    }, 180);
  };

  const handleDownloadDocx = () => {
    if (!renderedDocxBytes) {
      onToast('warning', 'Chứng từ chưa sẵn sàng để tải xuống.');
      return;
    }
    const blob = new Blob([renderedDocxBytes.slice().buffer], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeDocFileName;
    a.click();
    URL.revokeObjectURL(url);
    onToast('success', `Đã tải xuống file Word (${safeDocFileName}).`);
  };

  const handleSaveGeneratedToStorage = async (markSent = false): Promise<string | null> => {
    if (!renderedDocxBytes) {
      onToast('warning', 'Chưa có chứng từ để lưu.');
      return null;
    }
    const storagePath = await uploadGeneratedOrderDocx(target.orderId, target.kind, safeDocFileName, renderedDocxBytes);
    await saveGeneratedDocumentRecord(target.orderId, target.kind, storagePath, markSent);
    if (onDocumentSaved) await onDocumentSaved();
    return storagePath;
  };

  const buildRecalculatedFieldsForIncoterm = (nextInc: string, sellingVal: number) => {
    const pol = ctx.order?.pol || ctx.sch?.pol || 'Cat Lai Port, Ho Chi Minh City, Vietnam';
    const pod = ctx.order?.pod || ctx.sch?.pod || 'Destination Port';
    const originCodes = ['EXW', 'FCA', 'FAS', 'FOB'];
    const incUpper = nextInc.toUpperCase();
    const incPlace = originCodes.includes(incUpper) ? pol : pod;
    const insParsed = parseInsuranceCodeString(ctx.prop?.insurance_code || 'INS-NONE', data.pricingRates);
    const insTerm =
      incUpper === 'CIF' || incUpper === 'CIP'
        ? buildCombinedInsuranceClauseEng(
            insParsed.baseCode === 'INS-NONE' ? (incUpper === 'CIP' ? 'INS-ICC-A' : 'INS-ICC-C') : insParsed.baseCode,
            insParsed.addonCodes,
            incUpper,
            data.pricingRates
          )
        : 'To be covered by Buyer';

    const freightCost = ['CFR', 'CPT', 'CIF', 'CIP', 'DAP', 'DPU', 'DDP'].includes(incUpper)
      ? Math.max(
          0,
          (ctx.extraMeta?.cfr_price && ctx.extraMeta?.fob_price
            ? ctx.extraMeta.cfr_price - ctx.extraMeta.fob_price
            : toNum(ctx.prop?.total_freight_local))
        )
      : 0;
    const insCost = incUpper === 'CIF' || incUpper === 'CIP' ? toNum(ctx.prop?.insurance_cost) : 0;
    const destCost = ['DAP', 'DPU', 'DDP'].includes(incUpper)
      ? toNum(ctx.extraMeta?.dest_extra) + (incUpper === 'DDP' ? toNum(ctx.extraMeta?.import_duty_usd) : 0)
      : 0;
    const extras = freightCost + insCost + destCost;
    const subtotalAmt = extras > 0 && extras < sellingVal ? Math.round((sellingVal - extras) * 100) / 100 : sellingVal;

    const freightStr = originCodes.includes(incUpper)
      ? 'Freight Collect'
      : freightCost > 0
      ? `Freight Prepaid (${fmtUSD(freightCost)})`
      : 'Freight Prepaid';
    const valFmt = formatCurrency(sellingVal);
    const usdFmt = fmtUSD(sellingVal);
    const words = numberToEnglishWordsUsd(sellingVal);
    const totalNw = toNum(ctx.order?.nw_confirmed_kgs) || toNum(ctx.inq?.net_weight_kgs) || 0;
    const avgUnit = totalNw > 0 ? `$${fmtDecimal(subtotalAmt / totalNw, 3)}` : fieldValues.UNIT_PRICE || '$0.000';

    const itemTarget = target.kind === 'QUOTATION' ? subtotalAmt : sellingVal;
    const allocated = computeSilentFobUnitPrices(ctx.items, itemTarget, data.products, data.pricingRates);
    const nextItemsRows = allocated.map((row, idx) => {
      const prod = data.products.find((p) => p.sku_code.toLowerCase() === row.item.sku.toLowerCase());
      const packSpec = resolvePackingSpec(row.item.packingCode, data.pricingRates);
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
        ITEM_HS: prod?.hs_code || '0810.90',
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

    return {
      patch: {
        INCOTERM: incUpper,
        APPLIED_INCOTERM: incUpper,
        INCOTERM_PLACE: incPlace,
        SUBTOTAL_AMT: fmtUSD(subtotalAmt),
        SUBTOTAL: fmtUSD(subtotalAmt),
        FREIGHT_AMT: fmtUSD(freightCost),
        OCEAN_FREIGHT: fmtUSD(freightCost),
        INS_AMT: fmtUSD(insCost),
        INSURANCE_AMT: fmtUSD(insCost),
        INS_COST: fmtUSD(insCost),
        DEST_AMT: fmtUSD(destCost),
        DEST_CHARGES: fmtUSD(destCost),
        CTR_VAL: valFmt,
        CONTRACT_VALUE: valFmt,
        TOT_AMT: usdFmt,
        TOTAL_AMT: usdFmt,
        TOTAL_AMOUNT: usdFmt,
        TOT_AMT_WORDS: words,
        TOTAL_AMT_WORDS: words,
        AMOUNT_IN_WORDS: words,
        INS_TERM: insTerm,
        INSURANCE_TERM: insTerm,
        FREIGHT: freightStr,
        FREIGHT_TERM: freightStr,
        UNIT_PRICE: avgUnit,
      },
      nextItemsRows,
    };
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#07281c]/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
      <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden text-[#f4f8f5]">
        <div className="px-4 py-3 bg-[#0f4a33] border-b-2 border-[#186635] space-y-2.5">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: '16px',
            }}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm sm:text-base font-extrabold text-[#fff5d6] leading-snug break-words">
                  {cleanQuoteTitle}
                </h3>
                {target.kind === 'QUOTATION' && sendCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-[#f4d98a] text-[#07281c] text-[10.5px] font-extrabold">
                    Đã gửi · Lần {sendCount}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#9bccb8] mt-0.5 truncate">
                Khách hàng: {ctx.cus?.consignee_name || ctx.inq?.consignee_id || ctx.order?.consignee_id}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              title="Đóng"
              aria-label="Đóng"
              className="shrink-0 p-1.5 rounded-lg bg-[#8c3b3b] text-white hover:bg-[#6e2b2b] cursor-pointer transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {target.kind === 'QUOTATION' && allowInternalView && (
              <div className="flex items-center bg-[#07281c] rounded-lg p-0.5 border border-[#f4d98a]/50">
                <button
                  type="button"
                  onClick={() => setQuotationTemplateKind('TMP_QUOTATION_01')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold cursor-pointer ${
                    quotationTemplateKind === 'TMP_QUOTATION_01'
                      ? 'bg-[#f4d98a] text-[#07281c]'
                      : 'text-[#d2ebe0]'
                  }`}
                >
                  TMP_QUOTATION_01 · Báo giá Khách
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQuotationTemplateKind('INTERNAL_COSTING_SHEET');
                    setShowEmailPane(false);
                    setShowFieldEditor(false);
                    setDirectEditMode(false);
                  }}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold cursor-pointer ${
                    quotationTemplateKind === 'INTERNAL_COSTING_SHEET'
                      ? 'bg-[#f4d98a] text-[#07281c]'
                      : 'text-[#d2ebe0]'
                  }`}
                >
                  INTERNAL_COSTING_SHEET · Nội bộ
                </button>
              </div>
            )}

            {target.kind !== 'QUOTATION' && matchingTemplates.length > 1 && (
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg bg-[#07281c] border border-[#f4d98a]/60 text-[#fff5d6] text-xs font-bold max-w-[240px]"
              >
                {matchingTemplates.map((t) => (
                  <option key={t.template_id} value={t.template_id}>
                    {t.document_name}
                  </option>
                ))}
              </select>
            )}

            {!isInternalCostingView && (
              <>
                <button
                  type="button"
                  onClick={() => setShowFieldEditor((s) => !s)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer border ${
                    showFieldEditor ? 'bg-[#f4d98a] text-[#07281c] border-[#f4d98a]' : 'bg-[#07281c] text-[#fff5d6] border-[#186635]'
                  }`}
                >
                  <ListChecks className="w-3.5 h-3.5" />
                  <span>Chỉnh dữ liệu</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDirectEditMode((s) => !s)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer border ${
                    directEditMode ? 'bg-[#f4d98a] text-[#07281c] border-[#f4d98a]' : 'bg-[#07281c] text-[#fff5d6] border-[#186635]'
                  }`}
                >
                  <PenLine className="w-3.5 h-3.5" />
                  <span>{directEditMode ? 'Xong sửa văn bản' : 'Sửa nội dung'}</span>
                </button>

                <button
                  type="button"
                  disabled={busy || !renderedDocxBytes}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const savedPath = await handleSaveGeneratedToStorage(false);
                      if (savedPath) {
                        onToast('success', 'Đã lưu chứng từ vào hồ sơ đơn hàng.');
                      }
                    } catch (err: any) {
                      onToast('error', err?.message || 'Lỗi lưu chứng từ.');
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#16977f] hover:bg-[#117865] disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Lưu chứng từ</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowEmailPane((s) => !s)}
                  className="px-3 py-1.5 rounded-lg bg-[#0f4a33] border border-[#f4d98a]/60 hover:bg-[#07281c] text-[#fff5d6] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>{showEmailPane ? 'Ẩn Email' : 'Soạn Email'}</span>
                </button>
              </>
            )}

            <button
              type="button"
              disabled={!isInternalCostingView && !renderedDocxBytes}
              onClick={handlePrint}
              className="px-3 py-1.5 rounded-lg bg-[#f4d98a] text-[#07281c] text-xs font-extrabold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>In / PDF</span>
            </button>

            {!isInternalCostingView && (
              <button
                type="button"
                disabled={!renderedDocxBytes}
                onClick={handleDownloadDocx}
                className="px-2.5 py-1.5 rounded-lg bg-[#07281c] text-[#fff5d6] border border-[#186635] text-xs font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <FileDown className="w-3.5 h-3.5" />
                <span>Tải .docx</span>
              </button>
            )}
          </div>
        </div>

        {target.kind === 'QUOTATION' && !isInternalCostingView && allowQuickAdjust && ctx.prop && (
          <div className="px-4 py-2.5 bg-[#07281c] border-b border-[#186635] flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1 font-bold text-[#f4d98a]">
                <SlidersHorizontal className="w-3.5 h-3.5" /> Điều chỉnh nhanh Sales:
              </span>
              <select
                value={adjIncoterm}
                onChange={(e) => {
                  const nextInc = e.target.value;
                  const nextPrice = computeSellingPriceScaled(ctx.prop, ctx.extraMeta, nextInc);
                  setAdjIncoterm(nextInc);
                  setAdjPrice(nextPrice > 0 ? fmtDecimal(nextPrice, 2) : '');
                  if (ctx.inq && ctx.prop) {
                    setEmailBodyHtml(buildQuotationEmailHtml(ctx.inq, ctx.cus, ctx.prop, ctx.extraMeta, ctx.sch, data.products, nextInc, nextPrice));
                  }
                  const { patch, nextItemsRows } = buildRecalculatedFieldsForIncoterm(nextInc, nextPrice);
                  void applyBatchFieldsAndRerender(patch, nextItemsRows);
                }}
                className="px-2 py-1 rounded-lg bg-[#0f4a33] border border-[#f4d98a]/60 text-[#fff5d6] font-mono font-bold text-xs"
              >
                {INCOTERMS_2020_MATRIX.map((r) => (
                  <option key={r.code} value={r.code}>{r.code} — {r.fullName}</option>
                ))}
              </select>
              <div className="flex items-center gap-1.5">
                <span className="text-[#9bccb8]">Giá chào (USD):</span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="VD: 2,160.00"
                  value={adjPrice}
                  onChange={(e) => {
                    setAdjPrice(e.target.value);
                    const val = toNum(e.target.value);
                    if (ctx.inq && ctx.prop) {
                      setEmailBodyHtml(buildQuotationEmailHtml(ctx.inq, ctx.cus, ctx.prop, ctx.extraMeta, ctx.sch, data.products, adjIncoterm, val));
                    }
                    if (val > 0) {
                      const { patch, nextItemsRows } = buildRecalculatedFieldsForIncoterm(adjIncoterm, val);
                      void applyBatchFieldsAndRerender(patch, nextItemsRows);
                    }
                  }}
                  className="w-28 px-2 py-1 rounded-lg bg-[#d7eee4] text-[#07281c] font-mono font-bold text-xs"
                />
              </div>
              <span className="text-[11px] text-[#9bccb8]">
                Giá sàn XNK ({adjIncoterm}): <strong className="text-[#f4d98a] font-mono">{fmtUSD(floorForSelectedInc)}</strong>
              </span>
            </div>

            <div className="flex items-center gap-2">
              {isBelowFloor ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (!onRequestRepriceFromModal) return;
                    setBusy(true);
                    try {
                      await onRequestRepriceFromModal(target.orderId, `Sales đề nghị giảm giá xuống ${fmtUSD(numericAdjPrice)} (${adjIncoterm}), thấp hơn giá sàn ${fmtUSD(floorForSelectedInc)}.`);
                      onClose();
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="px-3 py-1 rounded-lg bg-[#8c3b3b] hover:bg-[#6e2b2b] text-white font-bold flex items-center gap-1 cursor-pointer"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Dưới sàn — Gửi XNK Tính lại</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (!onConfirmQuickAdjust) return;
                    setBusy(true);
                    try {
                      await onConfirmQuickAdjust(target.orderId, adjIncoterm, numericAdjPrice, 'STANDARD');
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="px-3 py-1 rounded-lg bg-[#16977f] hover:bg-[#0f4a33] text-white font-bold cursor-pointer"
                >
                  Lưu điều chỉnh lên Báo giá
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12">
          {showFieldEditor && !isInternalCostingView && (
            <div className="lg:col-span-4 bg-[#0b3a27] border-r-2 border-[#186635] p-3.5 overflow-y-auto space-y-2.5 max-h-[600px]">
              <div className="text-xs font-extrabold text-[#f4d98a] uppercase tracking-wider">
                CHỈNH DỮ LIỆU
              </div>
              {descriptors
                .filter((d) =>
                  target.kind === 'QUOTATION'
                    ? !INTERNAL_ONLY_FIELD_PATTERN.test(d.key)
                    : true
                )
                .map((d) => (
                <div key={d.key} className="space-y-1">
                  <label className="block text-[11px] font-bold text-[#fff5d6]">
                    {d.description}
                  </label>
                  <input
                    type="text"
                    value={fieldValues[d.key] ?? d.value ?? ''}
                    onChange={(e) => void handleFieldValueChange(d.key, e.target.value)}
                    className="agri-input text-xs py-1"
                  />
                </div>
              ))}
              {descriptors.length === 0 && (
                <div className="text-xs text-[#9bccb8] italic py-4">
                  Chưa có trường dữ liệu có thể chỉnh sửa.
                </div>
              )}
            </div>
          )}

          <div
            ref={previewScrollRef}
            className={`${
              showFieldEditor && showEmailPane && !isInternalCostingView
                ? 'lg:col-span-4'
                : (showFieldEditor || showEmailPane) && !isInternalCostingView
                ? 'lg:col-span-8'
                : 'lg:col-span-12'
            } relative bg-[#cbd5d1] min-h-[480px] max-h-[600px] overflow-auto flex flex-col`}
          >
            <div ref={docxStyleRef} className="hidden" />
            <iframe ref={printFrameRef} title="print-docx" className="hidden" />

            <div className="sticky top-0 z-20 px-3 py-1.5 bg-[#0b3a27]/95 backdrop-blur-sm border-b border-[#186635] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#fff5d6] shrink-0">
              <span className="inline-flex items-center gap-1.5 font-bold text-[#9bccb8]">
                <ZoomIn className="w-3.5 h-3.5 text-[#f4d98a]" />
                <span>Thu phóng xem tổng quan:</span>
                <span className="font-mono text-[#f4d98a] font-extrabold">
                  {Math.round(effectiveZoomScale * 100)}%
                </span>
              </span>
              <div className="inline-flex items-center bg-[#07281c] rounded-lg p-0.5 border border-[#186635]">
                {(
                  [
                    { id: 'FIT', label: 'Fit' },
                    { id: '75', label: '75%' },
                    { id: '85', label: '85%' },
                    { id: '100', label: '100%' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setZoomPreset(opt.id)}
                    className={`px-2.5 py-0.5 rounded-md text-[11px] font-bold cursor-pointer transition-colors ${
                      zoomPreset === opt.id
                        ? 'bg-[#f4d98a] text-[#07281c]'
                        : 'text-[#d2ebe0] hover:text-[#fff5d6]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {isInternalCostingView ? (
              <div className="p-3 sm:p-4 flex-1">
                <div
                  style={{
                    width: `${Math.round(820 * effectiveZoomScale)}px`,
                    margin: '0 auto',
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      width: '820px',
                      transform: `scale(${effectiveZoomScale})`,
                      transformOrigin: 'top left',
                    }}
                  >
                    <div
                      ref={internalSheetRef}
                      className="bg-white text-[#0b2418] rounded-xl shadow-xl border-2 border-[#186635] p-6 space-y-5 text-xs"
                    >
                      <div className="flex items-start justify-between border-b-2 border-[#0f4a33] pb-3">
                        <div>
                          <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#8c3b3b]">
                            TÀI LIỆU NỘI BỘ · CHỈ DÀNH CHO PHÒNG XNK &amp; BAN GIÁM ĐỐC (KHÔNG GỬI KHÁCH)
                          </div>
                          <h2 className="text-lg font-black text-[#0f4a33] mt-0.5">
                            INTERNAL_COSTING_SHEET — PHIẾU TÍNH GIÁ &amp; SO SÁNH PHƯƠNG ÁN
                          </h2>
                          <div className="text-[11px] text-slate-600 mt-0.5">
                            Đơn hàng: <strong className="font-mono text-[#07281c]">{target.orderId}</strong> · Số Báo giá:{' '}
                            <strong className="font-mono text-[#07281c]">{cleanQuoteNo}</strong> · NV XNK:{' '}
                            <strong>{ctx.prop?.xnk_rep || '-'}</strong>
                          </div>
                        </div>
                        <div className="text-right text-[11px]">
                          <div className="font-bold text-[#0f4a33]">GREEN AGRI-EXPORTS CO., LTD</div>
                          <div>Ngày lập: {ctx.prop?.booking_date || '-'}</div>
                          {sendCount > 0 && (
                            <div className="font-bold text-[#8c3b3b]">Đã gửi khách: Lần {sendCount}</div>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 bg-[#f4fbf7] border border-[#186635]/30 rounded-lg p-3">
                        <div>
                          <div><strong>Khách hàng:</strong> {ctx.cus?.consignee_name || ctx.inq?.consignee_id || '-'}</div>
                          <div><strong>Quốc gia / POD:</strong> {ctx.cus?.country || '-'} · {ctx.sch?.pod || ctx.inq?.pod || '-'}</div>
                          <div><strong>Tuyến &amp; Lịch tàu:</strong> {ctx.prop?.schedule_id || '-'} · {ctx.sch?.shipping_line || '-'}</div>
                        </div>
                        <div>
                          <div><strong>Container:</strong> {ctx.prop?.container_type || '-'} ({ctx.prop?.container_qty || 0} cont)</div>
                          <div><strong>Đóng gói:</strong> {fmtNumber(ctx.prop?.total_cartons || 0)} thùng · {fmtNumber(ctx.prop?.total_pallets || 0)} pallet · {fmtNumber(ctx.prop?.total_cbm || 0)} CBM</div>
                          <div><strong>Khối lượng:</strong> NW {fmtNumber(ctx.inq?.net_weight_kgs || 0)} KG · GW {fmtNumber(ctx.prop?.total_gross_weight || 0)} KG</div>
                        </div>
                      </div>

                      <div>
                        <h4 className="font-extrabold text-[#0f4a33] uppercase text-[11px] mb-1.5">
                          1. Cơ cấu Giá vốn, Bao bì, Biên lợi nhuận &amp; Giá sàn
                        </h4>
                        <table className="w-full border-collapse text-xs">
                          <thead>
                            <tr className="bg-[#0f4a33] text-[#fff5d6]">
                              <th className="p-2 text-left border border-[#186635]">Hạng mục chi phí / chỉ tiêu</th>
                              <th className="p-2 text-right border border-[#186635]">Giá trị (USD)</th>
                              <th className="p-2 text-left border border-[#186635]">Ghi chú nội bộ</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td className="p-2 border border-slate-300 font-semibold">Giá vốn hàng hóa (Base Goods Cost)</td>
                              <td className="p-2 border border-slate-300 text-right font-mono font-bold">{fmtUSD(ctx.prop?.goods_cost || 0)}</td>
                              <td className="p-2 border border-slate-300">Phân bổ ẩn vào Đơn giá FOB trên Báo giá khách</td>
                            </tr>
                            <tr className="bg-slate-50">
                              <td className="p-2 border border-slate-300 font-semibold">Chi phí Bao bì &amp; Pallet (Packing + Pallet)</td>
                              <td className="p-2 border border-slate-300 text-right font-mono">{fmtUSD(ctx.prop?.packing_pallet_cost || 0)}</td>
                              <td className="p-2 border border-slate-300">Pallet fee: {fmtUSD(ctx.prop?.pallet_fee || 0)}</td>
                            </tr>
                            <tr>
                              <td className="p-2 border border-slate-300 font-semibold">Cước biển + Local Charges + Hải quan</td>
                              <td className="p-2 border border-slate-300 text-right font-mono">{fmtUSD(ctx.prop?.total_freight_local || 0)}</td>
                              <td className="p-2 border border-slate-300">Phương án thực hiện: {ctx.extraMeta?.freight_exec_option || 'SELF'}</td>
                            </tr>
                            <tr className="bg-slate-50">
                              <td className="p-2 border border-slate-300 font-semibold">Bảo hiểm hàng hải ({ctx.prop?.insurance_code || 'INS-NONE'})</td>
                              <td className="p-2 border border-slate-300 text-right font-mono">{fmtUSD(ctx.prop?.insurance_cost || 0)}</td>
                              <td className="p-2 border border-slate-300">Áp dụng cho CIF / CIP</td>
                            </tr>
                            <tr>
                              <td className="p-2 border border-slate-300 font-semibold">Biên lợi nhuận mục tiêu / tối thiểu</td>
                              <td className="p-2 border border-slate-300 text-right font-mono font-bold text-[#0f4a33]">
                                {fmtDecimal(ctx.extraMeta?.margin_pct || 0, 1)}% (Min {fmtDecimal(ctx.extraMeta?.min_margin_pct || 0, 1)}%)
                              </td>
                              <td className="p-2 border border-slate-300">Lợi nhuận nội bộ dự kiến: {fmtUSD(ctx.extraMeta?.internal_profit_usd || 0)}</td>
                            </tr>
                            <tr className="bg-[#fff5d6]">
                              <td className="p-2 border border-slate-300 font-extrabold">Giá sàn tối thiểu (Floor Price)</td>
                              <td className="p-2 border border-slate-300 text-right font-mono font-extrabold text-[#8c3b3b]">{fmtUSD(ctx.extraMeta?.floor_price_usd || 0)}</td>
                              <td className="p-2 border border-slate-300">Sales không được chào thấp hơn mức sàn</td>
                            </tr>
                            <tr className="bg-[#d7eee4]">
                              <td className="p-2 border border-slate-300 font-extrabold">Giá chào đề xuất ({ctx.prop?.recommended_incoterm || 'CIF'})</td>
                              <td className="p-2 border border-slate-300 text-right font-mono font-extrabold text-[#0f4a33]">{fmtUSD(ctx.prop?.final_selling_price || 0)}</td>
                              <td className="p-2 border border-slate-300">Khớp tổng thanh toán trên TMP_QUOTATION_01</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <h4 className="font-extrabold text-[#0f4a33] uppercase text-[11px] mb-1.5">
                            2. So sánh Phương án Thực hiện (Self vs. Hybrid vs. FWD)
                          </h4>
                          <table className="w-full border-collapse text-xs">
                            <tbody>
                              <tr>
                                <td className="p-1.5 border border-slate-300">Phương án đang chọn</td>
                                <td className="p-1.5 border border-slate-300 text-right font-mono font-bold">{ctx.extraMeta?.freight_exec_option || 'SELF'}</td>
                              </tr>
                              <tr className="bg-slate-50">
                                <td className="p-1.5 border border-slate-300">Trucking tự chạy (Self)</td>
                                <td className="p-1.5 border border-slate-300 text-right font-mono">{fmtUSD(ctx.extraMeta?.self_trucking || 0)}</td>
                              </tr>
                              <tr>
                                <td className="p-1.5 border border-slate-300">FWD Ocean / Trucking</td>
                                <td className="p-1.5 border border-slate-300 text-right font-mono">{fmtUSD(ctx.extraMeta?.fwd_ocean || 0)} / {fmtUSD(ctx.extraMeta?.fwd_trucking || 0)}</td>
                              </tr>
                              <tr className="bg-slate-50">
                                <td className="p-1.5 border border-slate-300">FWD Hải quan / Giấy phép</td>
                                <td className="p-1.5 border border-slate-300 text-right font-mono">{fmtUSD(ctx.extraMeta?.fwd_customs || 0)} / {fmtUSD(ctx.extraMeta?.fwd_permits || 0)}</td>
                              </tr>
                              <tr>
                                <td className="p-1.5 border border-slate-300 font-bold">Tổng chi phí nội bộ / Thu khách</td>
                                <td className="p-1.5 border border-slate-300 text-right font-mono font-bold">
                                  {fmtUSD(ctx.extraMeta?.internal_cost_usd || 0)} / {fmtUSD(ctx.extraMeta?.buyer_charge_usd || 0)}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>

                        <div>
                          <h4 className="font-extrabold text-[#0f4a33] uppercase text-[11px] mb-1.5">
                            3. Bảng so sánh Incoterms 2020 (Giá chào vs. Giá sàn)
                          </h4>
                          <table className="w-full border-collapse text-xs">
                            <thead>
                              <tr className="bg-[#0f4a33] text-[#fff5d6]">
                                <th className="p-1.5 text-left border border-[#186635]">Incoterm</th>
                                <th className="p-1.5 text-right border border-[#186635]">Giá sàn</th>
                                <th className="p-1.5 text-right border border-[#186635]">Giá chào</th>
                              </tr>
                            </thead>
                            <tbody>
                              {['EXW', 'FOB', 'CFR', 'CIF', 'CIP', 'DAP', 'DDP'].map((code) => (
                                <tr key={code} className={code === ctx.prop?.recommended_incoterm ? 'bg-[#fff5d6] font-bold' : ''}>
                                  <td className="p-1.5 border border-slate-300 font-mono font-bold">{code}</td>
                                  <td className="p-1.5 border border-slate-300 text-right font-mono">{fmtUSD(computeFloorPriceScaled(ctx.prop, ctx.extraMeta, code))}</td>
                                  <td className="p-1.5 border border-slate-300 text-right font-mono">{fmtUSD(computeSellingPriceScaled(ctx.prop, ctx.extraMeta, code))}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : docLoading ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2.5 bg-[#d7eee4] text-[#07281c] min-h-[440px]">
                <Loader2 className="w-6 h-6 animate-spin text-[#0f4a33]" />
                <span className="text-xs font-bold">Loading...</span>
              </div>
            ) : loadError && !renderedDocxBytes ? (
              <div className="flex flex-col items-center justify-center flex-1 min-h-[440px] p-6 text-center text-[#07281c] bg-[#d7eee4]">
                <AlertTriangle className="w-7 h-7 text-[#8c3b3b] mb-2" />
                <div className="text-xs font-bold max-w-md">{loadError}</div>
              </div>
            ) : (
              <div className="p-3 sm:p-4 flex-1">
                <div
                  style={{
                    width: `${Math.round(naturalDocSize.width * effectiveZoomScale)}px`,
                    minHeight: `${Math.round(naturalDocSize.height * effectiveZoomScale)}px`,
                    margin: '0 auto',
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      width: `${naturalDocSize.width}px`,
                      transform: `scale(${effectiveZoomScale})`,
                      transformOrigin: 'top left',
                    }}
                  >
                    <div
                      ref={docxBodyRef}
                      className="w-full min-h-[460px] outline-none"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {showEmailPane && !isInternalCostingView && (
            <div className="lg:col-span-4 bg-[#0b3a27] border-l-2 border-[#186635] p-4 flex flex-col gap-3 overflow-y-auto max-h-[600px]">
              <div className="text-xs font-extrabold text-[#f4d98a] uppercase tracking-wider">
                Email Gửi Khách Hàng (Chuẩn Quốc Tế)
              </div>
              <div>
                <label className="block text-[11px] text-[#9bccb8] mb-1">Người nhận (To)</label>
                <input
                  type="email"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  className="agri-input text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#9bccb8] mb-1">Tiêu đề Email</label>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="agri-input text-xs font-semibold"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[11px] text-[#9bccb8] mb-1">Xem trước nội dung Email</label>
                <div
                  className="bg-white text-slate-900 p-3 rounded-xl border border-[#186635] text-xs leading-relaxed max-h-60 overflow-y-auto"
                  dangerouslySetInnerHTML={{ __html: emailBodyHtml }}
                />
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    const plain = emailBodyHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
                    navigator.clipboard?.writeText(`Subject: ${emailSubject}\n\n${plain}`);
                    onToast('success', 'Đã sao chép tiêu đề & nội dung email vào bộ nhớ tạm.');
                  }}
                  className="px-3 py-2 rounded-lg bg-[#0f4a33] border border-[#f4d98a]/50 text-[#fff5d6] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" /> Copy Email
                </button>
                {target.kind === 'QUOTATION' && onMarkQuotationSent && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        let storedPath = '';
                        if (renderedDocxBytes) {
                          storedPath = (await handleSaveGeneratedToStorage(true)) || '';
                        }
                        await onMarkQuotationSent(target.orderId, storedPath || emailSubject);
                        onClose();
                      } catch (err: any) {
                        onToast('error', err?.message || 'Lỗi gửi báo giá.');
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="flex-1 agri-btn-gold flex items-center justify-center gap-1.5 text-xs"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Xác nhận Đã gửi Báo giá (Lần {sendCount + 1})</span>
                  </button>
                )}
                {target.kind !== 'QUOTATION' && renderedDocxBytes && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const saved = await handleSaveGeneratedToStorage(false);
                        if (saved) {
                          const plain = emailBodyHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
                          navigator.clipboard?.writeText(`Subject: ${emailSubject}\n\n${plain}`);
                          onToast('success', 'Đã lưu chứng từ vào hồ sơ và sao chép nội dung email.');
                        }
                      } catch (err: any) {
                        onToast('error', err?.message || 'Lỗi lưu chứng từ.');
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="flex-1 agri-btn-gold flex items-center justify-center gap-1.5 text-xs"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Lưu chứng từ &amp; Copy Email</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface OrderTimelineModalProps {
  orderId: string | null;
  data: AppDataState;
  orderMetaMap: Record<string, OrderLogisticsMeta>;
  proposalMetaMap: Record<string, ProposalExtraMeta>;
  onClose: () => void;
}

export const OrderTimelineModal: React.FC<OrderTimelineModalProps> = ({
  orderId,
  data,
  orderMetaMap,
  proposalMetaMap,
  onClose,
}) => {
  if (!orderId) return null;
  const inq = data.inquiries.find((i) => i.order_id === orderId);
  const prop = data.proposals.find((p) => p.order_id === orderId);
  const extra = proposalMetaMap[orderId];
  const order = data.orders.find((o) => o.order_id === orderId);
  const meta = orderMetaMap[orderId];
  const cusId = order?.consignee_id || inq?.consignee_id || '';
  const cus = data.consignees.find((c) => c.consignee_id === cusId);
  const items = inq ? parseOrderItems(inq, data.products, data.pricingRates) : [];
  const stageNum = order ? getOrderStage6Number(order, meta) : prop ? 1 : 1;

  return (
    <div className="fixed inset-0 z-50 bg-[#07281c]/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] overflow-y-auto text-[#f4f8f5]">
        <div className="px-5 py-3.5 bg-[#0f4a33] border-b-2 border-[#186635] flex items-center justify-between">
          <div>
            <div className="text-xs font-mono text-[#f4d98a] font-bold">{orderId} {order ? `· ${order.contract_no}` : ''}</div>
            <h3 className="text-base font-extrabold text-[#fff5d6]">
              Hồ sơ Vòng đời Đơn hàng · {cus?.consignee_name || cusId}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg bg-[#8c3b3b] text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            {WORKFLOW_6_STAGES.map((st, idx) => {
              const num = idx + 1;
              const done = stageNum > num || stageNum >= 7;
              const current = stageNum === num;
              return (
                <div
                  key={st}
                  className={`p-2 rounded-xl border text-center ${
                    done
                      ? 'bg-[#0f4a33] border-[#16977f] text-[#fff5d6]'
                      : current
                      ? 'bg-[#f4d98a] border-[#186635] text-[#07281c] font-bold'
                      : 'bg-[#07281c]/40 border-[#186635] text-[#9bccb8]'
                  }`}
                >
                  <div className="flex justify-center mb-1">
                    {done ? <CheckCircle2 className="w-4 h-4 text-[#16977f]" /> : <Clock className="w-4 h-4" />}
                  </div>
                  <div className="text-[10.5px] leading-tight">{st}</div>
                </div>
              );
            })}
          </div>

          <div className="agri-card-inner p-3.5 space-y-2">
            <div className="font-extrabold text-[#07281c] uppercase text-[11px]">1. Yêu cầu Báo giá (Sales CRM)</div>
            {inq ? (
              <div className="grid grid-cols-2 gap-2">
                <div><strong>Sale phụ trách:</strong> {inq.sale_rep}</div>
                <div><strong>Trạng thái:</strong> {inq.inquiry_status}</div>
                <div><strong>Điều kiện mong muốn:</strong> {inq.desired_incoterm} · {inq.proposed_payment_term}</div>
                <div><strong>Tổng Net Weight:</strong> {fmtNumber(inq.net_weight_kgs)} KG</div>
                <div className="col-span-2">
                  <strong>Sản phẩm:</strong>{' '}
                  {items.map((it) => `${it.name} (${fmtNumber(it.weight)} KG)`).join('; ') || inq.product_name_vie}
                </div>
              </div>
            ) : (
              <div className="italic opacity-75">Không có bản ghi Inquiry.</div>
            )}
          </div>

          <div className="agri-card-inner p-3.5 space-y-2">
            <div className="font-extrabold text-[#07281c] uppercase text-[11px]">2. Phương án Tính giá (XNK)</div>
            {prop ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div><strong>Số báo giá:</strong> {extra?.quotation_no || `QT-${orderId}`}</div>
                <div><strong>Nhân viên XNK:</strong> {prop.xnk_rep}</div>
                <div><strong>Lịch tàu:</strong> {prop.schedule_id || '-'}</div>
                <div><strong>Container:</strong> {prop.container_type} ({prop.container_qty} cont)</div>
                <div><strong>Giá vốn hàng:</strong> {fmtUSD(prop.goods_cost)}</div>
                <div><strong>Giá chốt ({prop.recommended_incoterm}):</strong> <span className="font-bold text-[#0f4a33]">{fmtUSD(prop.final_selling_price)}</span></div>
              </div>
            ) : (
              <div className="italic opacity-75">XNK chưa lập phương án tính giá.</div>
            )}
          </div>

          <div className="agri-card-inner p-3.5 space-y-2">
            <div className="font-extrabold text-[#07281c] uppercase text-[11px]">3. Hợp đồng Ngoại thương &amp; Vận hành</div>
            {order ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div><strong>Số Hợp đồng:</strong> {order.contract_no}</div>
                <div><strong>Ngày HĐ:</strong> {order.contract_date}</div>
                <div><strong>Giá trị HĐ:</strong> <span className="font-bold">{fmtUSD(order.contract_value)}</span></div>
                <div><strong>Tuyến cảng:</strong> {order.pol} → {order.pod}</div>
                <div><strong>C/O Form:</strong> {order.co_form || '-'}</div>
                <div><strong>Booking No.:</strong> {meta?.bk_no || 'Chưa cập nhật'}</div>
                <div><strong>Tàu / Chuyến:</strong> {meta?.ves_voy || '-'}</div>
                <div><strong>Cont / Seal:</strong> {meta?.cont_seal_list || '-'}</div>
                <div><strong>Khóa ký:</strong> {meta?.is_locked ? `Đã ký (${meta.signed_date || 'OK'})` : 'Chờ ký'}</div>
              </div>
            ) : (
              <div className="italic opacity-75">Chưa khởi tạo Hợp đồng Ngoại thương.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel = 'Xác nhận',
  danger = false,
  onCancel,
  onConfirm,
}) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] bg-[#07281c]/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl shadow-2xl w-full max-w-md p-5 text-[#f4f8f5]">
        <h4 className="text-base font-extrabold text-[#fff5d6] mb-2">{title}</h4>
        <p className="text-xs text-[#e2f2eb] leading-relaxed mb-5">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-[#07281c] text-[#fff5d6] text-xs font-bold border border-[#186635] cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-xs font-extrabold cursor-pointer ${
              danger ? 'bg-[#8c3b3b] hover:bg-[#6e2b2b] text-white' : 'agri-btn-gold'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
