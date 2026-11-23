import React, { useEffect, useMemo, useRef, useState } from 'react';
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
} from 'lucide-react';
import type {
  AppDataState,
  OrderLogisticsMeta,
  ProposalExtraMeta,
} from '../types';
import {
  buildCombinedInsuranceClauseEng,
  cleanQuoteNoForCustomer,
  computeFloorPriceScaled,
  computeSellingPriceScaled,
  computeSilentFobUnitPrices,
  fmtNumber,
  fmtUSD,
  formatCurrency,
  INCOTERMS_2020_MATRIX,
  parseInsuranceCodeString,
  parseOrderItems,
  stripInternalCodesForCustomer,
  toNum,
  WORKFLOW_6_STAGES,
  getOrderStage6Number,
} from '../utils/calculations';
import {
  buildExportEmailHtml,
  buildQuotationEmailHtml,
  buildQuotationEmailSubject,
  generateContractDocHtml,
  generateExportDocumentHtml,
  generateQuotationDocHtml,
} from '../utils/documentHtml';
import {
  buildTemplateFieldContext,
  extractPlaceholdersFromDocx,
  numberToEnglishWordsUsd,
  renderDocxAndPreviewHtml,
  selectMatchingTemplates,
  TemplateFieldDescriptor,
  wrapMammothPreviewHtml,
} from '../utils/docxEngine';
import {
  downloadTemplateDocx,
  saveGeneratedDocumentRecord,
  uploadGeneratedOrderDocx,
} from '../services/supabaseService';

export interface PreviewModalTarget {
  kind: 'QUOTATION' | 'CONTRACT' | 'INVOICE' | 'PACKING_LIST' | 'CO' | 'BL';
  orderId: string;
}

interface DocumentPreviewModalProps {
  target: PreviewModalTarget | null;
  data: AppDataState;
  orderMetaMap: Record<string, OrderLogisticsMeta>;
  proposalMetaMap: Record<string, ProposalExtraMeta>;
  allowQuickAdjust: boolean;
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
  orderMetaMap,
  proposalMetaMap,
  allowQuickAdjust,
  onClose,
  onConfirmQuickAdjust,
  onMarkQuotationSent,
  onRequestRepriceFromModal,
  onDocumentSaved,
  onToast,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const editableRef = useRef<HTMLDivElement>(null);

  const [templateMode, setTemplateMode] = useState<'STANDARD' | 'COMPARISON'>('STANDARD');
  const [adjIncoterm, setAdjIncoterm] = useState('CIF');
  const [adjPrice, setAdjPrice] = useState('');
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBodyHtml, setEmailBodyHtml] = useState('');
  const [showEmailPane, setShowEmailPane] = useState(false);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [templateBuffer, setTemplateBuffer] = useState<ArrayBuffer | null>(null);
  const [detectedKeys, setDetectedKeys] = useState<string[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [descriptors, setDescriptors] = useState<TemplateFieldDescriptor[]>([]);
  const [itemsRows, setItemsRows] = useState<Array<Record<string, string>>>([]);
  const [renderedDocxBytes, setRenderedDocxBytes] = useState<Uint8Array | null>(null);
  const [docxPreviewHtml, setDocxPreviewHtml] = useState<string>('');

  const [showFieldEditor, setShowFieldEditor] = useState(false);
  const [directEditMode, setDirectEditMode] = useState(false);
  const [customBodyHtml, setCustomBodyHtml] = useState<string>('');

  const [docLoading, setDocLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const ctx = useMemo(() => {
    if (!target) return null;
    const inq = data.inquiries.find((i) => i.order_id === target.orderId);
    const prop = data.proposals.find((p) => p.order_id === target.orderId);
    const extraMeta = proposalMetaMap[target.orderId];
    const order = data.orders.find((o) => o.order_id === target.orderId);
    const meta = orderMetaMap[target.orderId];
    const cusId = order?.consignee_id || inq?.consignee_id || '';
    const cus = data.consignees.find((c) => c.consignee_id === cusId);
    const sch = prop ? data.schedules.find((s) => s.schedule_id === prop.schedule_id) : undefined;
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

  // Initialize metadata & pick default .docx template whenever target changes
  useEffect(() => {
    if (!target || !ctx) return;
    if (target.kind === 'QUOTATION' && ctx.inq) {
      const mode =
        String(ctx.inq.quotation_mode || '').toUpperCase().includes('COMP') ||
        (ctx.prop?.proposed_incoterms || '').split(',').filter(Boolean).length >= 2
          ? 'COMPARISON'
          : 'STANDARD';
      setTemplateMode(mode);
      const inc = ctx.prop?.recommended_incoterm || ctx.inq.desired_incoterm || 'CIF';
      const price = toNum(ctx.prop?.final_selling_price);
      setAdjIncoterm(inc);
      setAdjPrice(price > 0 ? price.toFixed(2) : '');
      setEmailTo(ctx.cus?.email || ctx.inq.email || '');
      setEmailSubject(buildQuotationEmailSubject(ctx.inq, ctx.prop, ctx.extraMeta, data.products));
      setEmailBodyHtml(buildQuotationEmailHtml(ctx.inq, ctx.cus, ctx.prop, ctx.extraMeta, ctx.sch, data.products, inc, price));
    } else if (ctx.order) {
      setEmailTo(ctx.cus?.email || ctx.inq?.email || '');
      const rawLabel = target.kind === 'CONTRACT' ? `Sales Contract ${ctx.order.contract_no}` : `${target.kind} – ${ctx.order.contract_no}`;
      const label = stripInternalCodesForCustomer(rawLabel) || rawLabel;
      setEmailSubject(`[GREEN AGRI-EXPORTS] ${label}`);
      setEmailBodyHtml(buildExportEmailHtml(label, ctx.order, ctx.cus));
    }

    setShowEmailPane(false);
    setShowFieldEditor(false);
    setDirectEditMode(false);
    setCustomBodyHtml('');
    setDocxPreviewHtml('');
    setRenderedDocxBytes(null);
    setTemplateBuffer(null);

    let bestTpl = '';
    if (ctx.meta?.template_id && matchingTemplates.some((t) => t.template_id === ctx.meta?.template_id)) {
      bestTpl = ctx.meta.template_id;
    } else if (target.kind === 'QUOTATION' && matchingTemplates.length > 0) {
      const wantComp =
        String(ctx.inq?.quotation_mode || '').toUpperCase().includes('COMP') ||
        (ctx.prop?.proposed_incoterms || '').split(',').filter(Boolean).length >= 2;
      const compTpl = matchingTemplates.find((t) =>
        /tuvan|comp|so_sanh/i.test(`${t.template_id} ${t.document_name} ${t.google_doc_file_id}`)
      );
      const stdTpl = matchingTemplates.find(
        (t) =>
          !/tuvan|comp|so_sanh/i.test(`${t.template_id} ${t.document_name} ${t.google_doc_file_id}`) &&
          /01|standard|chuan/i.test(`${t.template_id} ${t.document_name} ${t.google_doc_file_id}`)
      ) || matchingTemplates.find((t) => !/tuvan|comp|so_sanh/i.test(`${t.template_id} ${t.document_name} ${t.google_doc_file_id}`));
      bestTpl = (wantComp ? compTpl : stdTpl)?.template_id || matchingTemplates[0]?.template_id || '';
    } else {
      bestTpl = matchingTemplates[0]?.template_id || '';
    }
    setSelectedTemplateId(bestTpl);
  }, [target?.orderId, target?.kind]);

  // Download & render selected .docx template from Supabase Storage "documents" bucket
  useEffect(() => {
    if (!target || !ctx) return;
    const tpl = matchingTemplates.find((t) => t.template_id === selectedTemplateId);
    if (!tpl || !tpl.google_doc_file_id) {
      setTemplateBuffer(null);
      setRenderedDocxBytes(null);
      setDocxPreviewHtml('');
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
          templatePlaceholders: data.templatePlaceholders,
          overrideIncoterm: target.kind === 'QUOTATION' ? adjIncoterm : undefined,
          overrideSellingPrice: target.kind === 'QUOTATION' && toNum(adjPrice) > 0 ? toNum(adjPrice) : undefined,
        },
        []
      );
      setDetectedKeys([]);
      setFieldValues(built.fields);
      setDescriptors(built.descriptors);
      setItemsRows(built.itemsTableRows);
      setDocLoading(false);
      return;
    }

    let cancelled = false;
    setDocLoading(true);

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
            templatePlaceholders: data.templatePlaceholders,
            overrideIncoterm: target.kind === 'QUOTATION' ? adjIncoterm : undefined,
            overrideSellingPrice: target.kind === 'QUOTATION' && toNum(adjPrice) > 0 ? toNum(adjPrice) : undefined,
          },
          keys
        );

        const rendered = await renderDocxAndPreviewHtml(buf, built.fields, built.itemsTableRows);
        if (cancelled) return;

        setTemplateBuffer(buf);
        setDetectedKeys(keys);
        setFieldValues(built.fields);
        setDescriptors(built.descriptors);
        setItemsRows(built.itemsTableRows);
        setRenderedDocxBytes(rendered.docxBytes);
        setDocxPreviewHtml(rendered.previewHtml);
        setCustomBodyHtml('');
      } catch {
        if (cancelled) return;
        setTemplateBuffer(null);
        setRenderedDocxBytes(null);
        setDocxPreviewHtml('');
      } finally {
        if (!cancelled) setDocLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [target?.orderId, target?.kind, selectedTemplateId]);

  const floorForSelectedInc = useMemo(() => {
    if (!ctx?.prop) return 0;
    return computeFloorPriceScaled(ctx.prop, ctx.extraMeta, adjIncoterm);
  }, [ctx, adjIncoterm]);

  const numericAdjPrice = toNum(adjPrice);
  const isBelowFloor = floorForSelectedInc > 0 && numericAdjPrice > 0 && numericAdjPrice < floorForSelectedInc;

  const fallbackHtml = useMemo(() => {
    if (!target || !ctx) return '';
    if (target.kind === 'QUOTATION' && ctx.inq) {
      return generateQuotationDocHtml({
        inq: ctx.inq,
        prop: ctx.prop,
        extraMeta: ctx.extraMeta,
        cus: ctx.cus,
        sch: ctx.sch,
        products: data.products,
        pricingRates: data.pricingRates,
        templateMode,
        overrideIncoterm: adjIncoterm,
        overrideSellingPrice: numericAdjPrice > 0 ? numericAdjPrice : undefined,
      });
    }
    if (target.kind === 'CONTRACT' && ctx.order) {
      return generateContractDocHtml({
        order: ctx.order,
        meta: ctx.meta,
        inq: ctx.inq,
        cus: ctx.cus,
        products: data.products,
        pricingRates: data.pricingRates,
      });
    }
    if (ctx.order && (target.kind === 'INVOICE' || target.kind === 'PACKING_LIST' || target.kind === 'CO' || target.kind === 'BL')) {
      return generateExportDocumentHtml(target.kind, {
        order: ctx.order,
        meta: ctx.meta,
        inq: ctx.inq,
        cus: ctx.cus,
        prop: ctx.prop,
        products: data.products,
        pricingRates: data.pricingRates,
      });
    }
    return '';
  }, [target, ctx, data.products, data.pricingRates, templateMode, adjIncoterm, numericAdjPrice]);

  const activeDocHtml = useMemo(() => {
    if (customBodyHtml) {
      return wrapMammothPreviewHtml(customBodyHtml);
    }
    return docxPreviewHtml || fallbackHtml;
  }, [customBodyHtml, docxPreviewHtml, fallbackHtml]);

  const editableInnerHtml = useMemo(() => {
    if (customBodyHtml) return customBodyHtml;
    const m = (docxPreviewHtml || fallbackHtml).match(/<body[^>]*>([\s\S]*)<\/body>/i);
    return m ? m[1] : (docxPreviewHtml || fallbackHtml);
  }, [customBodyHtml, docxPreviewHtml, fallbackHtml]);

  const applyBatchFieldsAndRerender = async (
    patch: Record<string, string>,
    overrideItemsRows?: Array<Record<string, string>>
  ) => {
    const updated = { ...fieldValues, ...patch };
    const nextRows = overrideItemsRows || itemsRows;
    setFieldValues(updated);
    if (overrideItemsRows) setItemsRows(overrideItemsRows);
    setDescriptors((prev) => prev.map((d) => (patch[d.key] !== undefined ? { ...d, value: patch[d.key] } : d)));
    if (templateBuffer) {
      try {
        const rendered = await renderDocxAndPreviewHtml(templateBuffer, updated, nextRows);
        setRenderedDocxBytes(rendered.docxBytes);
        setDocxPreviewHtml(rendered.previewHtml);
        setCustomBodyHtml('');
      } catch {
        // Ignore transient render error while editing
      }
    }
  };

  // Re-render .docx live when user edits fieldValues
  const handleFieldValueChange = async (key: string, nextVal: string) => {
    await applyBatchFieldsAndRerender({ [key]: nextVal });
  };

  if (!target || !ctx) return null;

  const cleanQuoteTitle =
    target.kind === 'QUOTATION'
      ? `Báo giá ${cleanQuoteNoForCustomer(ctx.extraMeta?.quotation_no || '', target.orderId)}`
      : `${target.kind} · ${ctx.order?.contract_no || target.orderId}`;

  const safeDocFileName = `${cleanQuoteTitle
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')}.docx`;

  const flushDirectEditHtml = (): string | null => {
    if (directEditMode && editableRef.current) {
      const edited = editableRef.current.innerHTML;
      setCustomBodyHtml(edited);
      setDirectEditMode(false);
      return edited;
    }
    return null;
  };

  const handlePrint = () => {
    const flushed = flushDirectEditHtml();
    if (flushed !== null) {
      window.setTimeout(() => iframeRef.current?.contentWindow?.print(), 140);
      return;
    }
    iframeRef.current?.contentWindow?.print();
  };

  const handleDownloadDocxOrHtml = () => {
    const flushed = flushDirectEditHtml();
    if (renderedDocxBytes && flushed === null && !customBodyHtml) {
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
      return;
    }
    const htmlToDownload = flushed !== null ? wrapMammothPreviewHtml(flushed) : activeDocHtml;
    const blob = new Blob([htmlToDownload], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeDocFileName.replace(/\.docx$/i, '.html');
    a.click();
    URL.revokeObjectURL(url);
    onToast('success', 'Đã tải xuống file chứng từ.');
  };

  const handleSaveGeneratedToStorage = async (markSent = false): Promise<string | null> => {
    flushDirectEditHtml();
    if (!renderedDocxBytes) {
      onToast('info', 'Chưa có phôi .docx được gắn cho loại chứng từ này. Bạn có thể thêm phôi .docx tại mục Quản lý Phôi mẫu.');
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
    const freightValue = toNum(ctx.prop?.total_freight_local);
    const freightStr = originCodes.includes(incUpper)
      ? 'Freight Collect'
      : freightValue > 0
      ? `Freight Prepaid (${fmtUSD(freightValue)})`
      : 'Freight Prepaid';
    const valFmt = formatCurrency(sellingVal);
    const usdFmt = fmtUSD(sellingVal);
    const words = numberToEnglishWordsUsd(sellingVal);
    const totalNw = toNum(ctx.order?.nw_confirmed_kgs) || toNum(ctx.inq?.net_weight_kgs) || 0;
    const avgUnit = totalNw > 0 ? (sellingVal / totalNw).toFixed(3) : fieldValues.UNIT_PRICE || '0.000';

    const allocated = computeSilentFobUnitPrices(ctx.items, sellingVal, data.products, data.pricingRates);
    const nextItemsRows = allocated.map((row, idx) => ({
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

    return {
      patch: {
        INCOTERM: incUpper,
        APPLIED_INCOTERM: incUpper,
        INCOTERM_PLACE: incPlace,
        CTR_VAL: valFmt,
        CONTRACT_VALUE: valFmt,
        TOT_AMT: usdFmt,
        TOTAL_AMOUNT: usdFmt,
        TOT_AMT_WORDS: words,
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
        <div className="px-4 py-3 bg-[#0f4a33] border-b-2 border-[#186635] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm sm:text-base font-extrabold text-[#fff5d6]">{cleanQuoteTitle}</h3>
            <p className="text-[11px] text-[#9bccb8]">
              Khách hàng: {ctx.cus?.consignee_name || ctx.inq?.consignee_id || ctx.order?.consignee_id}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {matchingTemplates.length > 0 && (
              <select
                value={selectedTemplateId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setSelectedTemplateId(nextId);
                  if (target.kind === 'QUOTATION' && nextId) {
                    const tpl = matchingTemplates.find((t) => t.template_id === nextId);
                    if (tpl) {
                      const txt = `${tpl.template_id} ${tpl.document_name} ${tpl.google_doc_file_id}`;
                      setTemplateMode(/tuvan|comp|so_sanh/i.test(txt) ? 'COMPARISON' : 'STANDARD');
                    }
                  }
                }}
                className="px-2.5 py-1.5 rounded-lg bg-[#07281c] border border-[#f4d98a]/60 text-[#fff5d6] text-xs font-bold max-w-[220px]"
              >
                {matchingTemplates.map((t) => (
                  <option key={t.template_id} value={t.template_id}>
                    Phôi .docx: {t.document_name}
                  </option>
                ))}
                <option value="">Mẫu HTML Chuẩn hệ thống</option>
              </select>
            )}

            {target.kind === 'QUOTATION' && (
              <div className="flex items-center bg-[#07281c] rounded-lg p-0.5 border border-[#186635]">
                <button
                  type="button"
                  onClick={() => {
                    setTemplateMode('STANDARD');
                    if (matchingTemplates.length > 0 && selectedTemplateId !== '') {
                      const stdTpl =
                        matchingTemplates.find(
                          (t) =>
                            !/tuvan|comp|so_sanh/i.test(`${t.template_id} ${t.document_name} ${t.google_doc_file_id}`) &&
                            /01|standard|chuan/i.test(`${t.template_id} ${t.document_name} ${t.google_doc_file_id}`)
                        ) ||
                        matchingTemplates.find((t) => !/tuvan|comp|so_sanh/i.test(`${t.template_id} ${t.document_name} ${t.google_doc_file_id}`));
                      if (stdTpl) setSelectedTemplateId(stdTpl.template_id);
                    }
                  }}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold cursor-pointer ${templateMode === 'STANDARD' ? 'bg-[#f4d98a] text-[#07281c]' : 'text-[#d2ebe0]'}`}
                >
                  Mẫu Chuẩn
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTemplateMode('COMPARISON');
                    if (matchingTemplates.length > 0 && selectedTemplateId !== '') {
                      const compTpl = matchingTemplates.find((t) =>
                        /tuvan|comp|so_sanh/i.test(`${t.template_id} ${t.document_name} ${t.google_doc_file_id}`)
                      );
                      if (compTpl) setSelectedTemplateId(compTpl.template_id);
                    }
                  }}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold cursor-pointer ${templateMode === 'COMPARISON' ? 'bg-[#f4d98a] text-[#07281c]' : 'text-[#d2ebe0]'}`}
                >
                  Mẫu So sánh ĐK
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowFieldEditor((s) => !s)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer border ${
                showFieldEditor ? 'bg-[#f4d98a] text-[#07281c] border-[#f4d98a]' : 'bg-[#07281c] text-[#fff5d6] border-[#186635]'
              }`}
            >
              <ListChecks className="w-3.5 h-3.5" />
              <span>Chỉnh trường ({descriptors.length})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (directEditMode && editableRef.current) {
                  setCustomBodyHtml(editableRef.current.innerHTML);
                }
                setDirectEditMode((s) => !s);
              }}
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
                    onToast('success', 'Đã lưu chứng từ (.docx) vào hồ sơ đơn hàng.');
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

            <button
              type="button"
              onClick={handlePrint}
              className="px-3 py-1.5 rounded-lg bg-[#f4d98a] text-[#07281c] text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>In / PDF</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadDocxOrHtml}
              className="px-2.5 py-1.5 rounded-lg bg-[#07281c] text-[#fff5d6] border border-[#186635] text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>{renderedDocxBytes ? 'Tải .docx' : 'Tải File'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-[#8c3b3b] text-white hover:bg-[#6e2b2b] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {target.kind === 'QUOTATION' && allowQuickAdjust && ctx.prop && (
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
                  setAdjPrice(nextPrice > 0 ? nextPrice.toFixed(2) : '');
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
                  type="number"
                  step="0.01"
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
                      await onConfirmQuickAdjust(target.orderId, adjIncoterm, numericAdjPrice, templateMode);
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
          {showFieldEditor && (
            <div className="lg:col-span-4 bg-[#0b3a27] border-r-2 border-[#186635] p-3.5 overflow-y-auto space-y-2.5 max-h-[600px]">
              <div className="text-xs font-extrabold text-[#f4d98a] uppercase tracking-wider">
                Chỉnh sửa Trường dữ liệu ({detectedKeys.length > 0 ? `${detectedKeys.length} biến trong phôi` : 'Chuẩn'})
              </div>
              {descriptors.map((d) => (
                <div key={d.key} className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono font-bold text-[#fff5d6]">{`{{${d.key}}}`}</span>
                    <span className="text-[#9bccb8] truncate max-w-[140px]" title={d.description}>{d.description}</span>
                  </div>
                  <input
                    type="text"
                    value={fieldValues[d.key] ?? d.value ?? ''}
                    onChange={(e) => void handleFieldValueChange(d.key, e.target.value)}
                    className="agri-input text-xs py-1"
                  />
                </div>
              ))}
            </div>
          )}

          <div
            className={`${
              showFieldEditor && showEmailPane
                ? 'lg:col-span-4'
                : showFieldEditor || showEmailPane
                ? 'lg:col-span-8'
                : 'lg:col-span-12'
            } relative bg-white min-h-[460px] overflow-hidden`}
          >
            {docLoading ? (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2.5 bg-[#d7eee4] text-[#07281c]">
                <Loader2 className="w-6 h-6 animate-spin text-[#0f4a33]" />
                <span className="text-xs font-bold">Đang tải chứng từ...</span>
              </div>
            ) : directEditMode ? (
              <div
                ref={editableRef}
                contentEditable
                suppressContentEditableWarning
                dangerouslySetInnerHTML={{ __html: editableInnerHtml }}
                className="w-full h-full min-h-[520px] max-h-[600px] overflow-y-auto p-8 text-slate-900 bg-white outline-none text-[13px] leading-relaxed"
              />
            ) : (
              <iframe ref={iframeRef} title={cleanQuoteTitle} srcDoc={activeDocHtml} className="w-full h-full min-h-[520px] border-0" />
            )}
          </div>

          {showEmailPane && (
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
                <label className="block text-[11px] text-[#9bccb8] mb-1">Tiêu đề Email (Không chứa mã nội bộ)</label>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="agri-input text-xs font-semibold"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[11px] text-[#9bccb8] mb-1">Xem trước nội dung Email HTML</label>
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
                    <span>Xác nhận Đã gửi Báo giá cho Khách</span>
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
