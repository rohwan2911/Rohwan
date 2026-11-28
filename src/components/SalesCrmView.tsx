import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus,
  Zap,
  Trash2,
  Eye,
  ExternalLink,
  CheckCircle2,
  RotateCcw,
  FileText,
  Edit3,
  UserPlus,
  Calendar,
  Languages,
  Loader2,
  X,
  ChevronDown,
  Search,
  Package,
  Check,
  BellRing,
  Copy,
  Mail,
  Send,
  Wallet,
  FileSpreadsheet,
  Download,
} from 'lucide-react';
import type {
  AppDataState,
  ConsigneeDirectory,
  InquiryQuotation,
  OrderItem,
  OrderLogisticsMeta,
  ProposalExtraMeta,
  SysUser,
  ViewId,
} from '../types';
import {
  classifyCustomerByCount,
  cleanQuoteNoForCustomer,
  countriesMatch,
  deduplicatePortName,
  detectCountryFromAddress,
  fmtDecimal,
  fmtNumber,
  fmtUSD,
  formatEditableNumber,
  getPackingOptionsForProduct,
  INCOTERMS_2020_MATRIX,
  isConfirmedStatus,
  isContractCreatedStatus,
  isPricedReadyStatus,
  isQuickCaptureStatus,
  isSentWaitingCustomerStatus,
  normalizeCountryName,
  normalizePlainText,
  parseLocaleNumber,
  parseOrderItems,
  resolvePackingSpec,
  stripItemsTag,
  stripInternalCodesForCustomer,
  todayIsoDate,
  translateVIEtoENGSmart,
  WORKFLOW_STATUS,
} from '../utils/calculations';
import { SearchableCombo } from './SearchableCombo';
import type { PreviewModalTarget } from './Modals';
import { isStoredDocumentPath, openDocumentWithSignedUrl } from '../services/supabaseService';

interface SalesCrmViewProps {
  activeView: Extract<ViewId, 'sales-inquiry' | 'sales-quotation' | 'sales-contracts' | 'sales-customers'>;
  data: AppDataState;
  currentUser: SysUser;
  quickSearch: string;
  orderMetaMap: Record<string, OrderLogisticsMeta>;
  proposalMetaMap: Record<string, ProposalExtraMeta>;
  onSaveInquiry: (params: {
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
  }) => Promise<InquiryQuotation>;
  onDeletePreContract: (orderId: string) => Promise<void>;
  onConfirmOrder: (orderId: string) => Promise<void>;
  onRequestReprice: (orderId: string, reason: string) => Promise<void>;
  onConfirmSignedContract: (orderId: string) => Promise<void>;
  onUpsertConsignee: (row: ConsigneeDirectory, isEdit: boolean) => Promise<void>;
  onDeleteConsignee: (consigneeId: string) => Promise<void>;
  onOpenPreview: (target: PreviewModalTarget) => void;
  onOpenTimeline: (orderId: string) => void;
  onPatchProposalMeta: (orderId: string, patch: Partial<ProposalExtraMeta>) => void;
  onPatchOrderMeta: (orderId: string, patch: Partial<OrderLogisticsMeta>) => void;
  onRequestConfirm: (title: string, message: string, onConfirm: () => Promise<void>, danger?: boolean) => void;
  onToast: (type: 'success' | 'error' | 'info' | 'warning', title: string) => void;
}

interface DraftLine {
  sku: string;
  name: string;
  name_eng: string;
  weightStr: string;
  packingCode: string;
}

type FollowUpAngle = 'GENERAL' | 'INCOTERM_FLEX' | 'SCHEDULE_VALIDITY';

function formatShortTimestamp(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${min}`;
}

function getElapsedHours(iso?: string): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (Date.now() - t) / (1000 * 60 * 60));
}

export const SalesCrmView: React.FC<SalesCrmViewProps> = ({
  activeView,
  data,
  currentUser,
  quickSearch,
  orderMetaMap,
  proposalMetaMap,
  onSaveInquiry,
  onDeletePreContract,
  onConfirmOrder,
  onRequestReprice,
  onConfirmSignedContract,
  onUpsertConsignee,
  onDeleteConsignee,
  onOpenPreview,
  onOpenTimeline,
  onPatchProposalMeta,
  onPatchOrderMeta,
  onRequestConfirm,
  onToast,
}) => {
  // Quick Capture state
  const [quickCusName, setQuickCusName] = useState('');
  const [quickSelectedConsigneeId, setQuickSelectedConsigneeId] = useState('');
  const [quickCompanySuggestOpen, setQuickCompanySuggestOpen] = useState(false);
  const [quickAddress, setQuickAddress] = useState('');
  const [quickContact, setQuickContact] = useState('');
  const [quickEmail, setQuickEmail] = useState('');
  const [quickNote, setQuickNote] = useState('');
  const [quickSelections, setQuickSelections] = useState<Record<string, string[]>>({});
  const [quickPickerOpen, setQuickPickerOpen] = useState(false);
  const [quickPickerSearch, setQuickPickerSearch] = useState('');
  const [quickPickerStyle, setQuickPickerStyle] = useState<React.CSSProperties>({});
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickFilterText, setQuickFilterText] = useState('');

  // Full RFQ Modal state
  const [rfqModalOpen, setRfqModalOpen] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<string | undefined>(undefined);
  const [selectedQuickLogId, setSelectedQuickLogId] = useState('');
  const [selectedConsigneeId, setSelectedConsigneeId] = useState('');
  const [cusName, setCusName] = useState('');
  const [cusCountry, setCusCountry] = useState('');
  const [cusAddress, setCusAddress] = useState('');
  const [cusTax, setCusTax] = useState('');
  const [cusContact, setCusContact] = useState('');
  const [cusPhone, setCusPhone] = useState('');
  const [cusEmail, setCusEmail] = useState('');
  const [cusFax, setCusFax] = useState('');
  const [cusPod, setCusPod] = useState('');
  const [cusWarehouseAddress, setCusWarehouseAddress] = useState('');
  const [companySuggestOpen, setCompanySuggestOpen] = useState(false);
  const [desiredDate, setDesiredDate] = useState('');
  const [desiredIncoterm, setDesiredIncoterm] = useState('');
  const [paymentTerm, setPaymentTerm] = useState('');
  const [quoteMode, setQuoteMode] = useState<'SINGLE' | 'COMPARISON'>('SINGLE');
  const [usePallet, setUsePallet] = useState(false);
  const [rfqNote, setRfqNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [rfqSaving, setRfqSaving] = useState(false);
  const [translatingLineIdx, setTranslatingLineIdx] = useState<number | null>(null);

  // Contracts Pending Signature filter
  const [contractFilter, setContractFilter] = useState<'ALL' | 'PENDING' | 'SIGNED'>('ALL');

  // Reprice reason modal
  const [repriceOrderId, setRepriceOrderId] = useState<string | null>(null);
  const [repriceReason, setRepriceReason] = useState('');

  // Follow-up Auto-Draft modal (native Web App assistant)
  const [followUpOrderId, setFollowUpOrderId] = useState<string | null>(null);
  const [followUpAngle, setFollowUpAngle] = useState<FollowUpAngle>('GENERAL');
  const [followUpTo, setFollowUpTo] = useState('');
  const [followUpSubject, setFollowUpSubject] = useState('');
  const [followUpBody, setFollowUpBody] = useState('');

  // Deposit (T/T) / L/C Handover modal (Sales -> XNK)
  const [depositOrderId, setDepositOrderId] = useState<string | null>(null);
  const [depositMethod, setDepositMethod] = useState<'T/T' | 'L/C'>('T/T');
  const [depositAmountStr, setDepositAmountStr] = useState('');
  const [depositRef, setDepositRef] = useState('');
  const [depositBank, setDepositBank] = useState('');
  const [depositDate, setDepositDate] = useState('');
  const [depositNote, setDepositNote] = useState('');

  // Customer edit modal
  const [cusModalOpen, setCusModalOpen] = useState(false);
  const [cusForm, setCusForm] = useState<ConsigneeDirectory | null>(null);
  const [cusOrderCountStr, setCusOrderCountStr] = useState('');
  const [cusIsEdit, setCusIsEdit] = useState(false);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const companySuggestRef = useRef<HTMLDivElement>(null);
  const quickCompanySuggestRef = useRef<HTMLDivElement>(null);
  const quickPickerWrapRef = useRef<HTMLDivElement>(null);
  const quickPickerMenuRef = useRef<HTMLDivElement>(null);
  const quickLastAutoNoteRef = useRef<string>('');

  const updateQuickPickerPosition = useCallback(() => {
    const anchor = quickPickerWrapRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    const maxMenuH = 360;
    const spaceBelow = viewportH - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openUpward = spaceBelow < 220 && spaceAbove > spaceBelow;
    const computedMaxH = Math.max(180, Math.min(maxMenuH, openUpward ? spaceAbove : spaceBelow));
    const menuWidth = Math.min(Math.max(rect.width, 360), viewportW - 16);
    const left = Math.min(Math.max(8, rect.left), Math.max(8, viewportW - menuWidth - 8));

    setQuickPickerStyle({
      position: 'fixed',
      left: `${left}px`,
      width: `${menuWidth}px`,
      maxHeight: `${computedMaxH}px`,
      zIndex: 9999,
      ...(openUpward
        ? { bottom: `${Math.max(8, viewportH - rect.top + 4)}px`, top: 'auto' }
        : { top: `${rect.bottom + 4}px`, bottom: 'auto' }),
    });
  }, []);

  useLayoutEffect(() => {
    if (!quickPickerOpen) return;
    updateQuickPickerPosition();
    const onScrollOrResize = () => updateQuickPickerPosition();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [quickPickerOpen, updateQuickPickerPosition]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (companySuggestRef.current && !companySuggestRef.current.contains(target)) {
        setCompanySuggestOpen(false);
      }
      if (quickCompanySuggestRef.current && !quickCompanySuggestRef.current.contains(target)) {
        setQuickCompanySuggestOpen(false);
      }
      if (
        quickPickerOpen &&
        !quickPickerWrapRef.current?.contains(target) &&
        !quickPickerMenuRef.current?.contains(target)
      ) {
        setQuickPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick, true);
    return () => document.removeEventListener('mousedown', onDocClick, true);
  }, [quickPickerOpen]);

  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    data.schedules.forEach((s) => s.country && set.add(s.country.trim()));
    data.consignees.forEach((c) => c.country && set.add(c.country.trim()));
    return Array.from(set).sort().map((c) => ({ value: c, label: c }));
  }, [data.schedules, data.consignees]);

  const knownCountries = useMemo(() => countryOptions.map((c) => c.value), [countryOptions]);

  const podOptions = useMemo(() => {
    const countryFilter = cusCountry.trim();
    const pool = countryFilter
      ? data.schedules.filter((s) => countriesMatch(s.country, countryFilter))
      : data.schedules;
    const map = new Map<string, { value: string; label: string; subLabel?: string }>();
    pool.forEach((s) => {
      const cleanPod = deduplicatePortName(s.pod);
      if (!cleanPod) return;
      const key = cleanPod.toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          value: cleanPod,
          label: cleanPod,
          subLabel: s.country ? s.country.trim() : undefined,
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [data.schedules, cusCountry]);

  const allActiveQuickLogs = useMemo(() => {
    return data.inquiries
      .filter((i) => isQuickCaptureStatus(i.inquiry_status))
      .slice()
      .reverse();
  }, [data.inquiries]);

  const quickLogDropdownOptions = useMemo(() => {
    return allActiveQuickLogs.map((q) => {
      const cus = data.consignees.find((c) => c.consignee_id === q.consignee_id);
      const company = cus?.consignee_name || q.consignee_id || 'Chưa rõ tên';
      const subParts = [q.address || cus?.address, q.contact || cus?.contact_person, q.email || cus?.email].filter(Boolean);
      return {
        value: q.order_id,
        label: `${q.order_id} — ${company}`,
        subLabel: subParts.join(' · ') || undefined,
      };
    });
  }, [allActiveQuickLogs, data.consignees]);

  const quickCompanySuggestions = useMemo(() => {
    const query = quickCusName.trim().toLowerCase();
    if (!query) return [];
    return data.consignees
      .filter((c) => c.consignee_name.trim().toLowerCase().includes(query))
      .slice(0, 8);
  }, [data.consignees, quickCusName]);

  const companySuggestions = useMemo(() => {
    const query = cusName.trim().toLowerCase();
    if (!query) return [];
    return data.consignees
      .filter((c) => c.consignee_name.trim().toLowerCase().includes(query))
      .slice(0, 8);
  }, [data.consignees, cusName]);

  const productOptions = useMemo(() => {
    return data.products.map((p) => ({
      value: p.sku_code,
      label: `${p.sku_code} – ${p.product_name_vie}`,
      subLabel: `${p.product_name_eng} · $${fmtDecimal(p.unit_price, 2)}/kg`,
    }));
  }, [data.products]);

  const formatQuickSelectionsText = useCallback(
    (sel: Record<string, string[]>): string => {
      const entries: string[] = [];
      Object.entries(sel).forEach(([sku, packCodes]) => {
        const prod = data.products.find((p) => p.sku_code === sku);
        const prodLabel = prod?.product_name_vie || sku;
        if (!packCodes || packCodes.length === 0) {
          entries.push(prodLabel);
          return;
        }
        const packOpts = getPackingOptionsForProduct(prod, data.pricingRates, data.lookups);
        packCodes.forEach((code) => {
          const pk = packOpts.find((o) => o.code === code);
          const pkName = pk?.name || resolvePackingSpec(code, data.pricingRates).nameVie || code;
          entries.push(`${prodLabel} - ${pkName}`);
        });
      });
      return entries.join(', ');
    },
    [data.products, data.pricingRates, data.lookups]
  );

  const syncQuickNoteFromSelections = useCallback(
    (nextSel: Record<string, string[]>) => {
      const nextAuto = formatQuickSelectionsText(nextSel);
      const prevAuto = quickLastAutoNoteRef.current;
      setQuickNote((prevNote) => {
        const trimmedPrev = prevNote.trim();
        let extraTail = '';
        if (prevAuto && trimmedPrev.startsWith(prevAuto)) {
          extraTail = trimmedPrev.slice(prevAuto.length).replace(/^[\s,;·-]+/, '').trim();
        } else if (!prevAuto && trimmedPrev) {
          extraTail = trimmedPrev;
        }
        if (nextAuto && extraTail) return `${nextAuto}, ${extraTail}`;
        return nextAuto || extraTail;
      });
      quickLastAutoNoteRef.current = nextAuto;
    },
    [formatQuickSelectionsText]
  );

  const toggleQuickProduct = (sku: string) => {
    setQuickSelections((prev) => {
      const next = { ...prev };
      if (next[sku] !== undefined) {
        delete next[sku];
      } else {
        next[sku] = [];
      }
      syncQuickNoteFromSelections(next);
      return next;
    });
  };

  const toggleQuickPackaging = (sku: string, packingCode: string) => {
    setQuickSelections((prev) => {
      const current = prev[sku] || [];
      const exists = current.includes(packingCode);
      const nextCodes = exists
        ? current.filter((c) => c !== packingCode)
        : [...current, packingCode];
      const next = { ...prev, [sku]: nextCodes };
      syncQuickNoteFromSelections(next);
      return next;
    });
  };

  const buildQuickSelectionOrderItems = useCallback(
    (sel: Record<string, string[]>): OrderItem[] => {
      const result: OrderItem[] = [];
      Object.entries(sel).forEach(([sku, packCodes]) => {
        const prod = data.products.find((p) => p.sku_code === sku);
        if (!prod) return;
        const packOpts = getPackingOptionsForProduct(prod, data.pricingRates, data.lookups);
        if (!packCodes || packCodes.length === 0) {
          result.push({
            sku: prod.sku_code,
            name: prod.product_name_vie,
            name_eng: prod.product_name_eng || prod.product_name_vie,
            weight: 0,
            packingCode: '',
            packingName: '',
            packingExtra: 0,
            palletCode: 'PKG-PLT-NO',
            cartons: 0,
            pallets: 0,
            packingCost: 0,
          });
          return;
        }
        packCodes.forEach((code) => {
          const pk = packOpts.find((o) => o.code === code);
          const spec = resolvePackingSpec(code, data.pricingRates);
          result.push({
            sku: prod.sku_code,
            name: prod.product_name_vie,
            name_eng: prod.product_name_eng || prod.product_name_vie,
            weight: 0,
            packingCode: code,
            packingName: pk?.name || spec.nameVie || code,
            packingExtra: pk?.rate ?? spec.rate ?? 0,
            palletCode: 'PKG-PLT-NO',
            cartons: 0,
            pallets: 0,
            packingCost: 0,
          });
        });
      });
      return result;
    },
    [data.products, data.pricingRates, data.lookups]
  );

  const filteredQuickPickerProducts = useMemo(() => {
    const q = quickPickerSearch.trim().toLowerCase();
    if (!q) return data.products;
    return data.products.filter((p) => {
      if (
        `${p.sku_code} ${p.product_name_vie} ${p.product_name_eng} ${p.product_group}`
          .toLowerCase()
          .includes(q)
      ) {
        return true;
      }
      const packOpts = getPackingOptionsForProduct(p, data.pricingRates, data.lookups);
      return packOpts.some((pk) => `${pk.code} ${pk.name} ${pk.engText}`.toLowerCase().includes(q));
    });
  }, [data.products, data.pricingRates, data.lookups, quickPickerSearch]);

  const paymentOptions = useMemo(() => {
    const lks = data.lookups.filter((l) => String(l.category).toUpperCase().includes('PAYMENT'));
    const defaults = [
      'T/T 30% Deposit / 70% against B/L copy',
      'T/T 100% in advance',
      'Irrevocable L/C at sight',
      'D/P at sight',
      'D/A 30 days',
    ];
    const list = lks.length > 0 ? lks.map((l) => l.contract_text_eng || l.display_name_vie) : defaults;
    return list.map((v) => ({ value: v, label: v }));
  }, [data.lookups]);

  const incotermOptions = useMemo(() => {
    const map = new Map<string, { value: string; label: string; subLabel?: string }>();
    data.incoterms.forEach((h) => {
      const code = String(h.incoterms_code || '').trim().toUpperCase();
      if (!code) return;
      map.set(code, { value: code, label: code, subLabel: h.full_name || h.risk_transfer_point });
    });
    INCOTERMS_2020_MATRIX.forEach((r) => {
      if (!map.has(r.code)) {
        map.set(r.code, { value: r.code, label: r.code, subLabel: r.fullName });
      }
    });
    return Array.from(map.values());
  }, [data.incoterms]);

  const extractDraftLinesFromQuickLead = (lead: InquiryQuotation): DraftLine[] => {
    const rawItems = String(lead.order_items || '').trim();
    if (rawItems.startsWith('[')) {
      try {
        const arr = JSON.parse(rawItems);
        if (Array.isArray(arr) && arr.length > 0) {
          const mapped = arr
            .map((it: Partial<OrderItem>) => {
              const sku = String(it.sku || '').trim();
              const prod = data.products.find((p) => p.sku_code.toLowerCase() === sku.toLowerCase());
              if (!sku && !prod) return null;
              const resolvedSku = prod?.sku_code || sku;
              return {
                sku: resolvedSku,
                name: String(it.name || prod?.product_name_vie || resolvedSku),
                name_eng: String(it.name_eng || prod?.product_name_eng || prod?.product_name_vie || ''),
                weightStr: it.weight && Number(it.weight) > 0 ? formatEditableNumber(it.weight) : '',
                packingCode: String(it.packingCode || '').trim(),
              };
            })
            .filter((x): x is DraftLine => Boolean(x));
          if (mapped.length > 0) return mapped;
        }
      } catch {
        // Fall through to fallback parser
      }
    }

    // Fallback: parse "Product A - Packaging 1, Product B - Packaging 2" from lead.note
    const cleanNote = stripItemsTag(lead.note);
    if (cleanNote) {
      const segments = cleanNote.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
      const fromNote: DraftLine[] = [];
      segments.forEach((seg) => {
        const dashIdx = seg.indexOf(' - ');
        const prodPart = (dashIdx >= 0 ? seg.slice(0, dashIdx) : seg).trim().toLowerCase();
        const packPart = (dashIdx >= 0 ? seg.slice(dashIdx + 3) : '').trim().toLowerCase();
        const prod = data.products.find(
          (p) =>
            p.product_name_vie.trim().toLowerCase() === prodPart ||
            p.product_name_eng.trim().toLowerCase() === prodPart ||
            p.sku_code.trim().toLowerCase() === prodPart
        );
        if (!prod) return;
        let packingCode = '';
        if (packPart) {
          const packOpts = getPackingOptionsForProduct(prod, data.pricingRates, data.lookups);
          const matchedPk = packOpts.find(
            (pk) =>
              pk.name.trim().toLowerCase() === packPart ||
              pk.code.trim().toLowerCase() === packPart ||
              pk.name.trim().toLowerCase().includes(packPart) ||
              packPart.includes(pk.code.trim().toLowerCase())
          );
          if (matchedPk) packingCode = matchedPk.code;
        }
        fromNote.push({
          sku: prod.sku_code,
          name: prod.product_name_vie,
          name_eng: prod.product_name_eng || prod.product_name_vie,
          weightStr: '',
          packingCode,
        });
      });
      if (fromNote.length > 0) return fromNote;
    }

    return [{ sku: '', name: '', name_eng: '', weightStr: '', packingCode: '' }];
  };

  const applyQuickLogLeadToForm = (lead: InquiryQuotation) => {
    const cus = data.consignees.find((c) => c.consignee_id === lead.consignee_id);
    const resolvedAddress = lead.address || cus?.address || '';
    const detectedCountry = detectCountryFromAddress(resolvedAddress, knownCountries);
    const resolvedCountry =
      normalizeCountryName(cus?.country, knownCountries) || detectedCountry || '';

    setSelectedQuickLogId(lead.order_id);
    setSelectedConsigneeId(cus?.consignee_id || lead.consignee_id || '');
    setCusName(cus?.consignee_name || lead.consignee_id || '');
    setCusAddress(resolvedAddress);
    setCusCountry(resolvedCountry);
    setCusTax(normalizePlainText(cus?.tax || ''));
    setCusContact(lead.contact || cus?.contact_person || '');
    setCusPhone(normalizePlainText(lead.phone || cus?.phone || ''));
    setCusEmail(lead.email || cus?.email || '');
    setCusFax(normalizePlainText(cus?.fax || ''));
    setCusPod(deduplicatePortName(lead.pod || cus?.default_pod || ''));
    setCusWarehouseAddress(lead.warehouse_address || cus?.warehouse_address || '');
    setPaymentTerm(lead.proposed_payment_term || cus?.default_payment_term || '');
    setRfqNote(stripItemsTag(lead.note));
    setLines(extractDraftLinesFromQuickLead(lead));
    setCompanySuggestOpen(false);
  };

  const applyExistingConsigneeToForm = (cus: ConsigneeDirectory) => {
    const resolvedAddress = cus.address || '';
    const resolvedCountry =
      normalizeCountryName(cus.country, knownCountries) ||
      detectCountryFromAddress(resolvedAddress, knownCountries) ||
      '';
    setSelectedConsigneeId(cus.consignee_id);
    setCusName(cus.consignee_name);
    setCusCountry(resolvedCountry);
    setCusAddress(resolvedAddress);
    setCusTax(normalizePlainText(cus.tax));
    setCusContact(cus.contact_person || '');
    setCusPhone(normalizePlainText(cus.phone));
    setCusEmail(cus.email || '');
    setCusFax(normalizePlainText(cus.fax));
    setCusPod(deduplicatePortName(cus.default_pod || ''));
    setCusWarehouseAddress(cus.warehouse_address || '');
    if (cus.default_payment_term) setPaymentTerm(cus.default_payment_term);
    setCompanySuggestOpen(false);
  };

  const handleAddressChangeInRfq = (nextAddress: string) => {
    setCusAddress(nextAddress);
    const detected = detectCountryFromAddress(nextAddress, knownCountries);
    if (detected) {
      setCusCountry(detected);
    }
  };

  const handleSelectPodInRfq = (podValue: string) => {
    const clean = deduplicatePortName(podValue);
    setCusPod(clean || podValue);
    if (clean) {
      const matchedSch = data.schedules.find(
        (s) => deduplicatePortName(s.pod).toLowerCase() === clean.toLowerCase()
      );
      if (matchedSch?.country) {
        setCusCountry(normalizeCountryName(matchedSch.country, knownCountries));
      }
    }
  };

  const openFullRfqModal = (fromInquiry?: InquiryQuotation) => {
    setCompanySuggestOpen(false);
    if (fromInquiry && isQuickCaptureStatus(fromInquiry.inquiry_status)) {
      // Converting a Quick-Log lead (INQ-YYYY-XXX) into a brand-new official Full RFQ (ORD-YYYY-XXX)
      setEditingOrderId(undefined);
      setDesiredDate('');
      setDesiredIncoterm('');
      setPaymentTerm('');
      setQuoteMode('SINGLE');
      setUsePallet(false);
      setRfqNote('');
      applyQuickLogLeadToForm(fromInquiry);
    } else if (fromInquiry) {
      // Editing an existing official Full RFQ (ORD-...)
      setEditingOrderId(fromInquiry.order_id);
      setSelectedQuickLogId('');
      const cus = data.consignees.find((c) => c.consignee_id === fromInquiry.consignee_id);
      const resolvedAddress = fromInquiry.address || cus?.address || '';
      const resolvedCountry =
        normalizeCountryName(cus?.country, knownCountries) ||
        detectCountryFromAddress(resolvedAddress, knownCountries) ||
        '';
      setSelectedConsigneeId(fromInquiry.consignee_id || '');
      setCusName(cus?.consignee_name || fromInquiry.consignee_id || '');
      setCusCountry(resolvedCountry);
      setCusAddress(resolvedAddress);
      setCusTax(normalizePlainText(cus?.tax || ''));
      setCusContact(fromInquiry.contact || cus?.contact_person || '');
      setCusPhone(normalizePlainText(fromInquiry.phone || cus?.phone || ''));
      setCusEmail(fromInquiry.email || cus?.email || '');
      setCusFax(normalizePlainText(cus?.fax || ''));
      setCusPod(deduplicatePortName(fromInquiry.pod || cus?.default_pod || ''));
      setCusWarehouseAddress(fromInquiry.warehouse_address || cus?.warehouse_address || '');
      setDesiredDate(fromInquiry.desired_delivery_date || '');
      setDesiredIncoterm(fromInquiry.desired_incoterm || '');
      setPaymentTerm(fromInquiry.proposed_payment_term || cus?.default_payment_term || '');
      setQuoteMode(String(fromInquiry.quotation_mode || '').toUpperCase().includes('COMP') ? 'COMPARISON' : 'SINGLE');
      const parsed = parseOrderItems(fromInquiry, data.products, data.pricingRates);
      setUsePallet(parsed.some((it) => it.palletCode === 'PKG-PLT-YES'));
      setRfqNote(stripItemsTag(fromInquiry.note));
      setLines(
        parsed.length > 0
          ? parsed.map((p) => ({
              sku: p.sku,
              name: p.name,
              name_eng: p.name_eng || p.name,
              weightStr: p.weight > 0 ? formatEditableNumber(p.weight) : '',
              packingCode: p.packingCode || '',
            }))
          : [{ sku: '', name: '', name_eng: '', weightStr: '', packingCode: '' }]
      );
    } else {
      setEditingOrderId(undefined);
      setSelectedQuickLogId('');
      setSelectedConsigneeId('');
      setCusName('');
      setCusCountry('');
      setCusAddress('');
      setCusTax('');
      setCusContact('');
      setCusPhone('');
      setCusEmail('');
      setCusFax('');
      setCusPod('');
      setCusWarehouseAddress('');
      setDesiredDate('');
      setDesiredIncoterm('');
      setPaymentTerm('');
      setQuoteMode('SINGLE');
      setUsePallet(false);
      setRfqNote('');
      setLines([
        {
          sku: '',
          name: '',
          name_eng: '',
          weightStr: '',
          packingCode: '',
        },
      ]);
    }
    setRfqModalOpen(true);
  };

  const handleSaveQuickCapture = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickCusName.trim()) {
      onToast('warning', 'Vui lòng nhập Tên khách hàng để ghi nhận nhanh.');
      return;
    }
    const cleanQuickName = quickCusName.trim().toLowerCase();
    const cleanQuickEmail = quickEmail.trim().toLowerCase();
    const matchedCus =
      (quickSelectedConsigneeId &&
        data.consignees.find((c) => c.consignee_id === quickSelectedConsigneeId)) ||
      data.consignees.find(
        (c) =>
          c.consignee_name.trim().toLowerCase() === cleanQuickName ||
          (cleanQuickEmail && c.email.trim().toLowerCase() === cleanQuickEmail)
      );
    const resolvedAddress = quickAddress.trim() || matchedCus?.address || '';
    const resolvedCountry =
      normalizeCountryName(matchedCus?.country, knownCountries) ||
      detectCountryFromAddress(resolvedAddress, knownCountries) ||
      '';
    const structuredItems = buildQuickSelectionOrderItems(quickSelections);
    const uniqueSkus = Array.from(new Set(structuredItems.map((it) => it.sku).filter(Boolean)));
    const uniqueNames = Array.from(new Set(structuredItems.map((it) => it.name).filter(Boolean)));

    setQuickSaving(true);
    try {
      const saved = await onSaveInquiry({
        saleRep: currentUser.full_name,
        customerInput: {
          consignee_id: matchedCus?.consignee_id,
          consignee_name: matchedCus?.consignee_name || quickCusName.trim(),
          country: resolvedCountry,
          address: resolvedAddress,
          tax: matchedCus?.tax || '',
          contact_person: quickContact.trim() || matchedCus?.contact_person || '',
          phone: matchedCus?.phone || '',
          email: quickEmail.trim() || matchedCus?.email || '',
          fax: matchedCus?.fax || '',
          default_payment_term: matchedCus?.default_payment_term || 'T/T 30/70',
        },
        sku_code: uniqueSkus.join(', '),
        product_name_vie: uniqueNames.join(', '),
        net_weight_kgs: 0,
        desired_delivery_date: '',
        desired_incoterm: 'CIF',
        proposed_payment_term: matchedCus?.default_payment_term || 'T/T 30/70',
        inquiry_status: WORKFLOW_STATUS.QUICK_CAPTURE,
        note: quickNote.trim(),
        order_items: JSON.stringify(structuredItems),
        quotation_mode: 'SINGLE',
      });
      setQuickCusName('');
      setQuickSelectedConsigneeId('');
      setQuickCompanySuggestOpen(false);
      setQuickAddress('');
      setQuickContact('');
      setQuickEmail('');
      setQuickNote('');
      setQuickSelections({});
      quickLastAutoNoteRef.current = '';
      setQuickPickerOpen(false);
      setQuickPickerSearch('');
      onToast('success', `Đã ghi nhận khách hàng nhanh (${saved.order_id}).`);
    } catch (err: any) {
      onToast('error', err?.message || 'Lỗi ghi nhận nhanh.');
    } finally {
      setQuickSaving(false);
    }
  };

  const handleSubmitFullRfq = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cusName.trim()) {
      onToast('warning', 'Vui lòng nhập Tên công ty / Khách hàng.');
      return;
    }
    const validLines = lines.filter((l) => l.sku && parseLocaleNumber(l.weightStr) > 0);
    if (validLines.length === 0) {
      onToast('warning', 'Vui lòng chọn ít nhất 1 sản phẩm với khối lượng > 0 KG.');
      return;
    }

    const orderItems: OrderItem[] = validLines.map((l) => {
      const prod = data.products.find((p) => p.sku_code === l.sku);
      const packOpts = getPackingOptionsForProduct(prod, data.pricingRates, data.lookups);
      const resolvedPackCode = l.packingCode || packOpts[0]?.code || 'PKG-CTN-10K';
      const pk = packOpts.find((o) => o.code === resolvedPackCode);
      return {
        sku: l.sku,
        name: l.name || prod?.product_name_vie || l.sku,
        name_eng: l.name_eng || prod?.product_name_eng || l.name,
        weight: parseLocaleNumber(l.weightStr),
        packingCode: resolvedPackCode,
        packingName: pk?.name || resolvedPackCode,
        packingExtra: pk?.rate || 0,
        palletCode: usePallet ? 'PKG-PLT-YES' : 'PKG-PLT-NO',
        cartons: 0,
        pallets: 0,
        packingCost: 0,
      };
    });

    const totalWeight = orderItems.reduce((s, it) => s + it.weight, 0);
    const cleanNameLow = cusName.trim().toLowerCase();
    const cleanEmailLow = cusEmail.trim().toLowerCase();
    const cleanTaxLow = cusTax.trim().toLowerCase();
    const resolvedExisting =
      (selectedConsigneeId && data.consignees.find((c) => c.consignee_id === selectedConsigneeId)) ||
      data.consignees.find(
        (c) =>
          c.consignee_name.trim().toLowerCase() === cleanNameLow ||
          (cleanEmailLow && c.email.trim().toLowerCase() === cleanEmailLow) ||
          (cleanTaxLow && normalizePlainText(c.tax).toLowerCase() === cleanTaxLow)
      );
    const cleanPod = deduplicatePortName(cusPod);
    const matchedPodSchedule = cleanPod
      ? data.schedules.find((s) => deduplicatePortName(s.pod).toLowerCase() === cleanPod.toLowerCase())
      : undefined;
    const resolvedCountry =
      cusCountry.trim() || matchedPodSchedule?.country?.trim() || resolvedExisting?.country || '';
    const resolvedIncoterm = desiredIncoterm.trim().toUpperCase() || 'CIF';
    const resolvedPayment = paymentTerm.trim() || 'T/T 30% Deposit / 70% against B/L copy';

    setRfqSaving(true);
    try {
      const saved = await onSaveInquiry({
        existingOrderId: editingOrderId,
        sourceQuickLogId: !editingOrderId && selectedQuickLogId ? selectedQuickLogId : undefined,
        saleRep: currentUser.full_name,
        customerInput: {
          consignee_id: resolvedExisting?.consignee_id || selectedConsigneeId || undefined,
          consignee_name: cusName.trim(),
          country: resolvedCountry,
          address: cusAddress.trim(),
          tax: cusTax.trim(),
          contact_person: cusContact.trim(),
          phone: cusPhone.trim(),
          email: cusEmail.trim(),
          fax: cusFax.trim(),
          default_payment_term: resolvedPayment,
          default_pod: cleanPod,
          warehouse_address: cusWarehouseAddress.trim(),
        },
        sku_code: orderItems.map((i) => i.sku).join(', '),
        product_name_vie: orderItems.map((i) => i.name).join(', '),
        net_weight_kgs: totalWeight,
        desired_delivery_date: desiredDate,
        desired_incoterm: resolvedIncoterm,
        proposed_payment_term: resolvedPayment,
        inquiry_status: WORKFLOW_STATUS.WAITING_PRICING,
        note: rfqNote.trim(),
        order_items: JSON.stringify(orderItems),
        quotation_mode: quoteMode,
        pod: cleanPod,
        warehouse_address: cusWarehouseAddress.trim(),
      });
      setRfqModalOpen(false);
      onToast(
        'success',
        editingOrderId
          ? `Đã cập nhật RFQ ${saved.order_id} và chuyển XNK.`
          : `Đã tạo Yêu cầu Tính giá ${saved.order_id} chuyển sang XNK.`
      );
    } catch (err: any) {
      onToast('error', err?.message || 'Lỗi lưu RFQ.');
    } finally {
      setRfqSaving(false);
    }
  };

  const quickSearchLower = quickSearch.trim().toLowerCase();

  const filteredInquiries = useMemo(() => {
    return data.inquiries
      .filter((i) => {
        if (!quickSearchLower) return true;
        const cus = data.consignees.find((c) => c.consignee_id === i.consignee_id);
        const hay = `${i.order_id} ${i.consignee_id} ${cus?.consignee_name || ''} ${i.address || cus?.address || ''} ${i.sku_code} ${i.product_name_vie} ${i.inquiry_status}`.toLowerCase();
        return hay.includes(quickSearchLower);
      })
      .slice()
      .reverse();
  }, [data.inquiries, data.consignees, quickSearchLower]);

  const quickCaptures = useMemo(() => {
    const fLow = quickFilterText.trim().toLowerCase();
    return filteredInquiries
      .filter((i) => isQuickCaptureStatus(i.inquiry_status))
      .filter((i) => {
        if (!fLow) return true;
        const cus = data.consignees.find((c) => c.consignee_id === i.consignee_id);
        const hay = `${i.order_id} ${cus?.consignee_name || ''} ${i.address || cus?.address || ''} ${cus?.country || ''} ${i.contact || cus?.contact_person || ''} ${i.email || cus?.email || ''} ${i.note || ''}`.toLowerCase();
        return hay.includes(fLow);
      });
  }, [filteredInquiries, data.consignees, quickFilterText]);

  const quotationRows = useMemo(() => {
    return filteredInquiries.filter((i) => !isQuickCaptureStatus(i.inquiry_status));
  }, [filteredInquiries]);

  const salesContractsList = useMemo(() => {
    return data.orders
      .filter((ord) => {
        const meta = orderMetaMap[ord.order_id];
        const st = String(ord.fulfillment_status || '').toLowerCase();
        const isPending = !meta?.is_locked && (meta?.sent_to_sales || st.includes('chờ sales') || st.includes('2.'));
        const isSigned = Boolean(meta?.is_locked || st.includes('3.') || st.includes('4.') || st.includes('5.') || st.includes('6.') || st.includes('hoàn tất'));
        if (contractFilter === 'PENDING') return isPending;
        if (contractFilter === 'SIGNED') return isSigned;
        return isPending || isSigned;
      })
      .filter((ord) => {
        if (!quickSearchLower) return true;
        const cus = data.consignees.find((c) => c.consignee_id === ord.consignee_id);
        return `${ord.order_id} ${ord.contract_no} ${cus?.consignee_name || ''}`.toLowerCase().includes(quickSearchLower);
      })
      .slice()
      .reverse();
  }, [data.orders, data.consignees, orderMetaMap, contractFilter, quickSearchLower]);

  if (activeView === 'sales-inquiry') {
    return (
      <div className="space-y-5">
        {/* Quick Capture Top Card */}
        <div className="agri-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="text-sm font-extrabold text-[#fff5d6] flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-[#f4d98a]" />
                Ghi nhận nhanh Thông tin Khách hàng (Chờ tư vấn)
              </h3>
              <p className="text-[11px] text-[#d2ebe0]">Lưu nhanh khách tiềm năng trước khi chuyển thành Yêu cầu Tính giá (Full RFQ)</p>
            </div>
            <button type="button" onClick={() => openFullRfqModal()} className="agri-btn-gold flex items-center gap-1.5">
              <Plus className="w-4 h-4" />
              <span>Tạo Yêu cầu Tính giá (Full RFQ)</span>
            </button>
          </div>

          <form onSubmit={handleSaveQuickCapture} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 items-end">
            <div ref={quickCompanySuggestRef} className="relative">
              <label className="block text-[11px] font-bold text-[#fff5d6] mb-1">Tên công ty / Khách *</label>
              <input
                value={quickCusName}
                onFocus={() => setQuickCompanySuggestOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setQuickCompanySuggestOpen(false);
                }}
                onChange={(e) => {
                  const val = e.target.value;
                  setQuickCusName(val);
                  setQuickCompanySuggestOpen(true);
                  if (quickSelectedConsigneeId) {
                    const linked = data.consignees.find((c) => c.consignee_id === quickSelectedConsigneeId);
                    if (!linked || linked.consignee_name.trim().toLowerCase() !== val.trim().toLowerCase()) {
                      setQuickSelectedConsigneeId('');
                    }
                  }
                }}
                className="agri-input text-xs"
                placeholder="VD: Fresh Asia Trading"
                autoComplete="off"
              />
              {quickCompanySuggestOpen && quickCompanySuggestions.length > 0 && (
                <div className="absolute left-0 right-0 z-50 mt-1 max-h-52 overflow-y-auto rounded-xl bg-[#f5fbf7] border-2 border-[#186635] shadow-2xl text-[#07281c]">
                  <div className="px-2.5 py-1 bg-[#d7eee4] border-b border-[#186635]/30 text-[10px] font-extrabold text-[#0f4a33] uppercase">
                    Gợi ý KH có sẵn ({quickCompanySuggestions.length})
                  </div>
                  {quickCompanySuggestions.map((c) => (
                    <button
                      key={c.consignee_id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setQuickSelectedConsigneeId(c.consignee_id);
                        setQuickCusName(c.consignee_name);
                        setQuickAddress(c.address || '');
                        setQuickContact(c.contact_person || '');
                        setQuickEmail(c.email || '');
                        setQuickCompanySuggestOpen(false);
                      }}
                      className="w-full text-left px-2.5 py-1.5 text-xs border-b border-[#186635]/15 last:border-b-0 hover:bg-[#0f4a33] hover:text-[#fff5d6] cursor-pointer transition-colors"
                    >
                      <div className="font-bold truncate">{c.consignee_name}</div>
                      <div className="text-[10px] opacity-80 truncate">
                        {[c.address || c.country, c.contact_person, c.email].filter(Boolean).join(' · ')}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="block text-[11px] font-bold text-[#fff5d6] mb-1">Địa chỉ</label>
              <input value={quickAddress} onChange={(e) => setQuickAddress(e.target.value)} className="agri-input text-xs" placeholder="VD: 1-2-3 Minato-ku, Tokyo, Japan" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-[#fff5d6] mb-1">Người liên hệ</label>
              <input value={quickContact} onChange={(e) => setQuickContact(e.target.value)} className="agri-input text-xs" placeholder="VD: Mr. Kenji Tanaka" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-[#fff5d6] mb-1">Email</label>
              <input value={quickEmail} onChange={(e) => setQuickEmail(e.target.value)} className="agri-input text-xs" placeholder="VD: buyer@company.com" />
            </div>
            <div ref={quickPickerWrapRef} className="relative">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[11px] font-bold text-[#fff5d6]">Ghi chú nhu cầu</label>
                {Object.keys(quickSelections).length > 0 && (
                  <span className="text-[10px] font-extrabold px-1.5 py-0.2 rounded bg-[#f4d98a] text-[#07281c]">
                    {Object.keys(quickSelections).length} SP
                  </span>
                )}
              </div>
              <div className="relative flex items-center">
                <input
                  value={quickNote}
                  onFocus={() => setQuickPickerOpen(true)}
                  onClick={() => setQuickPickerOpen(true)}
                  onChange={(e) => setQuickNote(e.target.value)}
                  className="agri-input text-xs pr-12"
                  placeholder="VD: Chọn SP, quy cách hoặc ghi chú..."
                  autoComplete="off"
                />
                {quickNote && (
                  <button
                    type="button"
                    tabIndex={-1}
                    title="Xóa ghi chú & lựa chọn"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setQuickNote('');
                      setQuickSelections({});
                      quickLastAutoNoteRef.current = '';
                    }}
                    className="absolute right-6 p-1 text-[#0f4a33] hover:text-[#8c3b3b] cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  tabIndex={-1}
                  title="Mở danh sách Sản phẩm & Quy cách đóng gói"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setQuickPickerOpen((o) => !o);
                  }}
                  className="absolute right-1.5 p-1 text-[#0f4a33] cursor-pointer"
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${quickPickerOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>
            </div>
            <button type="submit" disabled={quickSaving} className="agri-btn-primary py-2">
              {quickSaving ? 'Loading...' : 'Lưu Ghi nhận nhanh'}
            </button>
          </form>

          {quickPickerOpen &&
            typeof document !== 'undefined' &&
            createPortal(
              <div
                ref={quickPickerMenuRef}
                style={quickPickerStyle}
                className="flex flex-col rounded-xl bg-[#f4fbf7] border-2 border-[#0f4a33] shadow-2xl text-[#07281c] overflow-hidden"
              >
                <div className="p-2 bg-[#d7eee4] border-b border-[#186635]/30 space-y-1.5 shrink-0">
                  <div className="flex items-center justify-between text-[11px] font-extrabold text-[#0f4a33]">
                    <span className="inline-flex items-center gap-1">
                      <Package className="w-3.5 h-3.5" /> Chọn Sản phẩm &amp; Quy cách đóng gói
                    </span>
                    <span className="text-[10px] font-bold opacity-80">
                      {Object.keys(quickSelections).length} SP đã chọn
                    </span>
                  </div>
                  <div className="relative flex items-center">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 text-[#0f4a33]/70 pointer-events-none" />
                    <input
                      type="text"
                      value={quickPickerSearch}
                      onChange={(e) => setQuickPickerSearch(e.target.value)}
                      placeholder="VD: Tìm tên sản phẩm, SKU hoặc quy cách..."
                      className="w-full pl-8 pr-7 py-1.5 text-xs rounded-lg bg-white border border-[#186635]/50 text-[#07281c] placeholder:text-[#0b2418]/45 placeholder:italic outline-none focus:border-[#0f4a33]"
                    />
                    {quickPickerSearch && (
                      <button
                        type="button"
                        onClick={() => setQuickPickerSearch('')}
                        className="absolute right-2 text-[#0f4a33] hover:text-[#8c3b3b] cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto overscroll-contain divide-y divide-[#186635]/15">
                  {filteredQuickPickerProducts.map((p) => {
                    const isProdSelected = quickSelections[p.sku_code] !== undefined;
                    const selectedPacks = quickSelections[p.sku_code] || [];
                    const packOpts = getPackingOptionsForProduct(p, data.pricingRates, data.lookups);
                    return (
                      <div key={p.sku_code} className={isProdSelected ? 'bg-[#e6f5ee]' : ''}>
                        <label className="flex items-start gap-2.5 px-3 py-2 cursor-pointer hover:bg-[#d7eee4]/70 transition-colors">
                          <input
                            type="checkbox"
                            checked={isProdSelected}
                            onChange={() => toggleQuickProduct(p.sku_code)}
                            className="mt-0.5 accent-[#0f4a33] w-3.5 h-3.5 cursor-pointer shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold text-[#07281c] leading-snug">
                                {p.product_name_vie}
                              </span>
                              <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#0f4a33]/10 text-[#0f4a33] shrink-0">
                                {p.sku_code}
                              </span>
                            </div>
                            <div className="text-[10.5px] text-[#0f4a33]/80 truncate">
                              {p.product_name_eng}
                              {p.container_type ? ` · ${p.container_type}` : ''}
                            </div>
                          </div>
                        </label>

                        {isProdSelected && (
                          <div className="ml-6 mr-2.5 mb-2 pl-2.5 py-1.5 border-l-2 border-[#16977f] bg-white/80 rounded-r-lg space-y-1">
                            <div className="text-[10px] font-extrabold text-[#0f4a33] uppercase tracking-wide">
                              Quy cách đóng gói cho {p.product_name_vie}:
                            </div>
                            {packOpts.map((pk) => {
                              const pkChecked = selectedPacks.includes(pk.code);
                              return (
                                <label
                                  key={pk.code}
                                  className={`flex items-start gap-2 px-2 py-1 rounded-md cursor-pointer text-[11px] transition-colors ${
                                    pkChecked
                                      ? 'bg-[#0f4a33] text-[#fff5d6] font-bold'
                                      : 'hover:bg-[#d7eee4] text-[#07281c]'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={pkChecked}
                                    onChange={() => toggleQuickPackaging(p.sku_code, pk.code)}
                                    className="mt-0.5 accent-[#f4d98a] w-3.5 h-3.5 cursor-pointer shrink-0"
                                  />
                                  <span className="leading-snug flex-1">
                                    {pk.name}{' '}
                                    <span className={`font-mono text-[10px] ${pkChecked ? 'text-[#f4d98a]' : 'opacity-70'}`}>
                                      ({pk.code})
                                    </span>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {filteredQuickPickerProducts.length === 0 && (
                    <div className="px-3 py-5 text-center text-xs text-[#0f4a33]/70 italic">
                      Không tìm thấy sản phẩm hoặc quy cách phù hợp.
                    </div>
                  )}
                </div>

                <div className="px-3 py-2 bg-[#d7eee4] border-t border-[#186635]/30 flex items-center justify-between gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setQuickSelections({});
                      syncQuickNoteFromSelections({});
                    }}
                    className="px-2.5 py-1 rounded-lg bg-white border border-[#186635]/40 text-[#8c3b3b] text-[11px] font-bold hover:bg-[#fee2e2] cursor-pointer"
                  >
                    Bỏ chọn hết
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuickPickerOpen(false)}
                    className="px-3 py-1 rounded-lg bg-[#0f4a33] text-[#f4d98a] text-[11px] font-extrabold inline-flex items-center gap-1 cursor-pointer hover:bg-[#07281c]"
                  >
                    <Check className="w-3.5 h-3.5" /> Xong
                  </button>
                </div>
              </div>,
              document.body
            )}
        </div>

        {/* Dedicated Quick-Log Table with Filter */}
        <div className="agri-table-wrap">
          <div className="px-4 py-3 bg-[#0f4a33] border-b border-[#186635] flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-extrabold text-[#fff5d6]">
              Bảng Khách hàng Ghi nhận nhanh ({quickCaptures.length})
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={quickFilterText}
                onChange={(e) => setQuickFilterText(e.target.value)}
                placeholder="Lọc mã INQ, tên khách, địa chỉ, liên hệ..."
                className="px-2.5 py-1 rounded-lg bg-[#07281c] border border-[#186635] text-xs text-[#fff5d6] placeholder-[#9bccb8]/70 outline-none w-64"
              />
            </div>
          </div>
          <div className="agri-table-scroll">
            <table className="agri-table">
              <thead>
                <tr>
                  <th className="text-center">Mã ghi nhận</th>
                  <th className="text-left">Khách hàng / Địa chỉ</th>
                  <th className="text-left">Người liên hệ &amp; Email</th>
                  <th className="text-left">Ghi chú nhu cầu</th>
                  <th className="text-center">Trạng thái</th>
                  <th className="text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {quickCaptures.map((q) => {
                  const cus = data.consignees.find((c) => c.consignee_id === q.consignee_id);
                  const displayAddress = q.address || cus?.address || cus?.country || '-';
                  return (
                    <tr key={q.order_id}>
                      <td className="text-center">
                        <button type="button" onClick={() => onOpenTimeline(q.order_id)} className="font-mono font-bold hover:underline cursor-pointer">
                          {q.order_id}
                        </button>
                        <div className="text-[10.5px] opacity-80">{q.timestamp?.slice(0, 10)}</div>
                      </td>
                      <td className="text-left">
                        <div className="font-bold">{cus?.consignee_name || q.consignee_id}</div>
                        <div className="text-[11px] opacity-80">{displayAddress} · Sale: {q.sale_rep}</div>
                      </td>
                      <td className="text-left text-xs">
                        <div>{q.contact || cus?.contact_person || '-'}</div>
                        <div className="text-[11px] opacity-80">{q.email || cus?.email || '-'}</div>
                      </td>
                      <td className="text-left text-xs">{stripItemsTag(q.note) || <span className="opacity-65 italic">Chờ tư vấn</span>}</td>
                      <td className="text-center">
                        <span className="keep-badge-color inline-block px-2 py-0.5 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold">
                          {q.inquiry_status}
                        </span>
                      </td>
                      <td className="text-center">
                        <div className="inline-flex flex-wrap justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => openFullRfqModal(q)}
                            className="keep-btn-style px-2.5 py-1 rounded bg-[#0f4a33] text-[#f4d98a] text-[11px] font-bold cursor-pointer"
                          >
                            Chuyển thành RFQ
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onRequestConfirm(
                                'Xóa ghi nhận nhanh?',
                                `Xác nhận xóa bản ghi ${q.order_id}?`,
                                () => onDeletePreContract(q.order_id),
                                true
                              )
                            }
                            className="keep-btn-style px-2 py-1 rounded bg-[#8c3b3b] text-white text-[11px] font-bold cursor-pointer inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3 h-3" /> Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {quickCaptures.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-6 opacity-75">
                      Chưa có khách hàng ghi nhận nhanh nào phù hợp bộ lọc.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* All Inquiries Table (Full RFQs) */}
        <div className="agri-table-wrap">
          <div className="px-4 py-3 bg-[#0f4a33] border-b border-[#186635] flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-[#fff5d6]">Danh sách Yêu cầu Tính giá (RFQ) ({quotationRows.length})</h3>
          </div>
          <div className="agri-table-scroll">
            <table className="agri-table">
              <thead>
                <tr>
                  <th className="text-center">Mã đơn</th>
                  <th className="text-left">Khách hàng</th>
                  <th className="text-left">Sản phẩm &amp; Đóng gói</th>
                  <th className="text-center">KL Net</th>
                  <th className="text-center">Incoterm / TT</th>
                  <th className="text-center">Trạng thái</th>
                  <th className="text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {quotationRows.map((inq) => {
                  const cus = data.consignees.find((c) => c.consignee_id === inq.consignee_id);
                  const items = parseOrderItems(inq, data.products, data.pricingRates);
                  const canDelete = !isContractCreatedStatus(inq.inquiry_status) && !data.orders.some((o) => o.order_id === inq.order_id && orderMetaMap[o.order_id]?.is_locked);
                  return (
                    <tr key={inq.order_id}>
                      <td className="text-center">
                        <button type="button" onClick={() => onOpenTimeline(inq.order_id)} className="font-mono font-bold hover:underline cursor-pointer">
                          {inq.order_id}
                        </button>
                        <div className="text-[10.5px] opacity-80">{inq.timestamp?.slice(0, 10)}</div>
                      </td>
                      <td className="text-left">
                        <div className="font-bold">{cus?.consignee_name || inq.consignee_id}</div>
                        <div className="text-[11px] opacity-80">
                          {inq.pod ? `POD: ${inq.pod}` : cus?.country || inq.address || cus?.address || '-'} · Sale: {inq.sale_rep}
                        </div>
                      </td>
                      <td className="text-left">
                        {items.length > 0 ? (
                          <div className="space-y-0.5">
                            {items.map((it, idx) => (
                              <div key={idx} className="text-xs">
                                <span className="font-bold">{it.name}</span>{' '}
                                <span className="font-mono font-bold">({fmtNumber(it.weight)} KG)</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="italic opacity-75">-</span>
                        )}
                      </td>
                      <td className="text-center font-mono font-bold">{fmtNumber(inq.net_weight_kgs)} KG</td>
                      <td className="text-center">
                        <div className="font-mono font-bold">{inq.desired_incoterm}</div>
                        <div className="text-[10.5px] opacity-80 max-w-[160px] mx-auto truncate">{inq.proposed_payment_term}</div>
                      </td>
                      <td className="text-center">
                        <span className="keep-badge-color inline-block px-2 py-0.5 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold">
                          {inq.inquiry_status}
                        </span>
                      </td>
                      <td className="text-center">
                        <div className="inline-flex flex-wrap justify-center gap-1">
                          {canDelete && (
                            <>
                              <button
                                type="button"
                                onClick={() => openFullRfqModal(inq)}
                                className="keep-btn-style px-2 py-1 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold cursor-pointer"
                              >
                                Sửa RFQ
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  onRequestConfirm(
                                    'Hủy & Xóa đơn trước Hợp đồng?',
                                    `Đơn ${inq.order_id} sẽ bị xóa khỏi danh sách yêu cầu, bảng tính giá (nếu có) và cập nhật lại số đơn của khách hàng.`,
                                    () => onDeletePreContract(inq.order_id),
                                    true
                                  )
                                }
                                className="keep-btn-style px-2 py-1 rounded bg-[#8c3b3b] text-white text-[11px] font-bold cursor-pointer"
                              >
                                Hủy
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {quotationRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-6 opacity-75">
                      Chưa có Yêu cầu Tính giá (RFQ) nào.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Full RFQ Modal */}
        {rfqModalOpen && (
          <div className="fixed inset-0 z-50 bg-[#07281c]/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
            <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto text-[#f4f8f5]">
              <div className="px-5 py-3.5 bg-[#0f4a33] border-b-2 border-[#186635] flex items-center justify-between">
                <h3 className="text-base font-extrabold text-[#fff5d6]">
                  {editingOrderId
                    ? `Chỉnh sửa Yêu cầu Tính giá (${editingOrderId})`
                    : selectedQuickLogId
                    ? `Tạo Yêu cầu Tính giá Mới (Full RFQ) · Từ ${selectedQuickLogId}`
                    : 'Tạo Yêu cầu Tính giá Mới (Full RFQ)'}
                </h3>
                <button type="button" onClick={() => setRfqModalOpen(false)} className="px-2.5 py-1 rounded bg-[#8c3b3b] text-white text-xs font-bold cursor-pointer">
                  Đóng
                </button>
              </div>

              <form onSubmit={handleSubmitFullRfq} className="p-5 space-y-4 text-xs">
                {/* 1. Optional Quick-Log Lead Selector */}
                {!editingOrderId && (
                  <div className="rounded-xl bg-[#07281c]/35 border border-[#f4d98a]/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <label className="font-extrabold text-[#f4d98a] flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5" />
                        <span>Khách hàng ghi nhận nhanh (Tùy chọn)</span>
                      </label>
                      {selectedQuickLogId && (
                        <button
                          type="button"
                          onClick={() => setSelectedQuickLogId('')}
                          className="px-2 py-0.5 rounded bg-[#07281c] text-[#fff5d6] text-[10.5px] font-bold inline-flex items-center gap-1 cursor-pointer hover:bg-[#0f4a33]"
                        >
                          <X className="w-3 h-3" /> Bỏ liên kết {selectedQuickLogId}
                        </button>
                      )}
                    </div>
                    <SearchableCombo
                      value={selectedQuickLogId}
                      onChange={(leadId) => {
                        if (!leadId) {
                          setSelectedQuickLogId('');
                          return;
                        }
                        const found = allActiveQuickLogs.find((q) => q.order_id === leadId);
                        if (found) {
                          applyQuickLogLeadToForm(found);
                        }
                      }}
                      options={quickLogDropdownOptions}
                      allowCustom={false}
                      placeholder={
                        quickLogDropdownOptions.length > 0
                          ? 'Chọn từ danh sách Ghi nhận nhanh (INQ-...) để tự động điền thông tin...'
                          : 'Chưa có khách hàng ghi nhận nhanh — nhập trực tiếp thông tin bên dưới'
                      }
                    />
                  </div>
                )}

                {/* 2. Always-Editable Customer & Destination Fields + Live Auto-Suggest on Company Name */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div ref={companySuggestRef} className="relative sm:col-span-2 lg:col-span-2">
                    <div className="flex items-center justify-between mb-1">
                      <label className="font-bold text-[#fff5d6]">Tên công ty *</label>
                      {cusName.trim() && (
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            selectedConsigneeId
                              ? 'bg-[#f4d98a] text-[#07281c]'
                              : 'bg-[#07281c]/60 text-[#d2ebe0]'
                          }`}
                        >
                          {selectedConsigneeId ? `KH có sẵn · ${selectedConsigneeId}` : 'Khách hàng mới'}
                        </span>
                      )}
                    </div>
                    <input
                      value={cusName}
                      onFocus={() => setCompanySuggestOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setCompanySuggestOpen(false);
                      }}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCusName(val);
                        setCompanySuggestOpen(true);
                        if (selectedConsigneeId) {
                          const linked = data.consignees.find((c) => c.consignee_id === selectedConsigneeId);
                          if (!linked || linked.consignee_name.trim().toLowerCase() !== val.trim().toLowerCase()) {
                            setSelectedConsigneeId('');
                          }
                        }
                      }}
                      placeholder="VD: Fresh Asia Trading (gõ để tìm KH có sẵn hoặc nhập mới)"
                      className="agri-input"
                      autoComplete="off"
                      required
                    />
                    {companySuggestOpen && companySuggestions.length > 0 && (
                      <div className="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-y-auto rounded-xl bg-[#f5fbf7] border-2 border-[#186635] shadow-2xl text-[#07281c]">
                        <div className="px-2.5 py-1 bg-[#d7eee4] border-b border-[#186635]/30 text-[10px] font-extrabold text-[#0f4a33] uppercase">
                          Gợi ý Khách hàng có sẵn trong Danh bạ ({companySuggestions.length})
                        </div>
                        {companySuggestions.map((c) => (
                          <button
                            key={c.consignee_id}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              applyExistingConsigneeToForm(c);
                            }}
                            className="w-full text-left px-3 py-2 text-xs border-b border-[#186635]/15 last:border-b-0 hover:bg-[#0f4a33] hover:text-[#fff5d6] cursor-pointer transition-colors group"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold truncate">{c.consignee_name}</span>
                              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#0f4a33]/10 text-[#0f4a33] group-hover:bg-[#f4d98a] group-hover:text-[#07281c] shrink-0">
                                {c.consignee_id}
                              </span>
                            </div>
                            <div className="text-[10.5px] opacity-80 truncate mt-0.5">
                              {[c.address || c.country, c.contact_person, c.email, c.default_pod ? `POD: ${c.default_pod}` : '']
                                .filter(Boolean)
                                .join(' · ') || 'Chưa có thông tin bổ sung'}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block font-bold text-[#fff5d6] mb-1">Tax / Mã số thuế</label>
                    <input
                      value={cusTax}
                      placeholder="VD: JP-987654321"
                      onChange={(e) => setCusTax(e.target.value)}
                      className="agri-input font-mono"
                    />
                  </div>

                  <div className="sm:col-span-1 lg:col-span-2">
                    <label className="block font-bold text-[#fff5d6] mb-1">Địa chỉ</label>
                    <input
                      value={cusAddress}
                      placeholder="VD: 1-2-3 Minato-ku, Tokyo, Japan"
                      onChange={(e) => handleAddressChangeInRfq(e.target.value)}
                      className="agri-input"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-[#fff5d6] mb-1">Quốc gia</label>
                    <SearchableCombo
                      value={cusCountry}
                      onChange={(val) => {
                        const normalized = normalizeCountryName(val, knownCountries);
                        setCusCountry(normalized);
                        if (cusPod && normalized) {
                          const matchedPod = data.schedules.find(
                            (s) => deduplicatePortName(s.pod).toLowerCase() === deduplicatePortName(cusPod).toLowerCase()
                          );
                          if (matchedPod && !countriesMatch(matchedPod.country, normalized)) {
                            setCusPod('');
                          }
                        }
                      }}
                      options={countryOptions}
                      allowCustom
                      placeholder="VD: Japan, USA, Germany..."
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-[#fff5d6] mb-1">Người liên hệ</label>
                    <input
                      value={cusContact}
                      placeholder="VD: Mr. Kenji Tanaka"
                      onChange={(e) => setCusContact(e.target.value)}
                      className="agri-input"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-[#fff5d6] mb-1">Số điện thoại</label>
                    <input
                      value={cusPhone}
                      placeholder="VD: +81 3-1234-5678"
                      onChange={(e) => setCusPhone(e.target.value)}
                      className="agri-input font-mono"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-[#fff5d6] mb-1">Email</label>
                    <input
                      value={cusEmail}
                      placeholder="VD: buyer@company.com"
                      onChange={(e) => setCusEmail(e.target.value)}
                      className="agri-input"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-[#fff5d6] mb-1">
                      Cảng đến (POD){cusCountry ? ` · ${cusCountry}` : ''}
                    </label>
                    <SearchableCombo
                      value={cusPod}
                      onChange={handleSelectPodInRfq}
                      options={podOptions}
                      allowCustom
                      placeholder={
                        cusCountry
                          ? `VD: Chọn hoặc nhập cảng tại ${cusCountry}...`
                          : 'VD: Tokyo Port, Los Angeles, Hamburg...'
                      }
                    />
                  </div>

                  <div className="sm:col-span-1 lg:col-span-2">
                    <label className="block font-bold text-[#fff5d6] mb-1">Địa chỉ kho</label>
                    <input
                      value={cusWarehouseAddress}
                      placeholder="VD: Warehouse / Delivery Address (DAP/DPU/DDP)..."
                      onChange={(e) => setCusWarehouseAddress(e.target.value)}
                      className="agri-input"
                    />
                  </div>
                </div>

                {/* Product Lines */}
                <div className="agri-card-inner p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-[#07281c] uppercase text-[11px]">Danh sách Mặt hàng Xuất khẩu</span>
                    <button
                      type="button"
                      onClick={() => {
                        setLines((prev) => [...prev, { sku: '', name: '', name_eng: '', weightStr: '', packingCode: '' }]);
                      }}
                      className="px-2.5 py-1 rounded bg-[#0f4a33] text-[#f4d98a] font-bold text-[11px] cursor-pointer"
                    >
                      + Thêm sản phẩm
                    </button>
                  </div>

                  {lines.map((ln, idx) => {
                    const prod = data.products.find((p) => p.sku_code === ln.sku);
                    const packOpts = getPackingOptionsForProduct(prod, data.pricingRates, data.lookups);
                    return (
                      <div key={idx} className="bg-white/60 p-3 rounded-xl border border-[#186635]/40 space-y-2.5">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-end">
                          <div>
                            <label className="block text-[10.5px] font-bold text-[#07281c] mb-1">Sản phẩm (SKU)</label>
                            <SearchableCombo
                              value={ln.sku}
                              allowCustom={false}
                              options={productOptions}
                              placeholder="Chọn sản phẩm (SKU)..."
                              onChange={(sku) => {
                                const p = data.products.find((x) => x.sku_code === sku);
                                setLines((prev) =>
                                  prev.map((row, i) =>
                                    i === idx
                                      ? { ...row, sku, name: p?.product_name_vie || sku, name_eng: p?.product_name_eng || '' }
                                      : row
                                  )
                                );
                              }}
                            />
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-[10.5px] font-bold text-[#07281c]">Tên tiếng Anh (In Báo giá)</label>
                              <button
                                type="button"
                                disabled={translatingLineIdx === idx || !(ln.name || prod?.product_name_vie)}
                                onClick={async () => {
                                  const srcName = ln.name || prod?.product_name_vie || '';
                                  if (!srcName.trim()) return;
                                  setTranslatingLineIdx(idx);
                                  try {
                                    const eng = await translateVIEtoENGSmart(srcName, 'PRODUCT');
                                    setLines((prev) => prev.map((r, i) => (i === idx ? { ...r, name_eng: eng } : r)));
                                  } catch (err: any) {
                                    onToast('error', err?.message || 'Không thể dịch tên sản phẩm.');
                                  } finally {
                                    setTranslatingLineIdx(null);
                                  }
                                }}
                                className="px-2 py-0.5 rounded bg-[#0f4a33] text-[#f4d98a] text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              >
                                {translatingLineIdx === idx ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Languages className="w-3 h-3" />
                                )}
                                Dịch sang Anh
                              </button>
                            </div>
                            <input
                              value={ln.name_eng}
                              placeholder="VD: Fresh Red Dragon Fruit"
                              onChange={(e) => setLines((prev) => prev.map((r, i) => (i === idx ? { ...r, name_eng: e.target.value } : r)))}
                              className="agri-input text-xs"
                            />
                          </div>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-2.5 items-end">
                          <div className="w-full sm:w-[72%]">
                            <label className="block text-[10.5px] font-bold text-[#07281c] mb-1">Quy cách đóng gói</label>
                            <SearchableCombo
                              value={ln.packingCode}
                              allowCustom={false}
                              options={packOpts.map((pk) => ({
                                value: pk.code,
                                label: `${pk.code} – ${pk.name}`,
                                subLabel: `+$${fmtDecimal(pk.perKgRate, 2)}/kg`,
                              }))}
                              placeholder="Chọn quy cách đóng gói (VD: PKG-CTN-10K)..."
                              onChange={(code) => setLines((prev) => prev.map((r, i) => (i === idx ? { ...r, packingCode: code } : r)))}
                            />
                          </div>
                          <div className="w-full sm:w-[28%] flex items-end gap-1.5">
                            <div className="flex-1 min-w-0">
                              <label className="block text-[10.5px] font-bold text-[#07281c] mb-1">KL (KG)</label>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={ln.weightStr}
                                placeholder="VD: 10,000"
                                onChange={(e) => setLines((prev) => prev.map((r, i) => (i === idx ? { ...r, weightStr: e.target.value } : r)))}
                                className="agri-input text-xs font-mono font-bold"
                              />
                            </div>
                            {lines.length > 1 && (
                              <button
                                type="button"
                                title="Xóa dòng sản phẩm"
                                onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                                className="p-2 rounded-lg bg-[#8c3b3b] text-white cursor-pointer shrink-0"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  <label className="inline-flex items-center gap-2 font-bold text-[#07281c] cursor-pointer pt-1">
                    <input type="checkbox" checked={usePallet} onChange={(e) => setUsePallet(e.target.checked)} className="accent-[#0f4a33]" />
                    <span>Đóng Pallet gỗ ISPM-15 (18 kg · 0.17 CBM/pallet · +5% hao hụt hàng hỗn hợp)</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-bold text-[#fff5d6] mb-1">Incoterm mong muốn</label>
                    <SearchableCombo
                      value={desiredIncoterm}
                      onChange={(v) => setDesiredIncoterm(v.toUpperCase())}
                      options={incotermOptions}
                      allowCustom={false}
                      placeholder="VD: CIF / FOB / CFR..."
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-[#fff5d6] mb-1">Ngày giao dự kiến</label>
                    <div className="relative flex items-center">
                      <input
                        type="text"
                        value={
                          /^\d{4}-\d{2}-\d{2}$/.test(desiredDate)
                            ? `${desiredDate.slice(8, 10)}/${desiredDate.slice(5, 7)}/${desiredDate.slice(0, 4)}`
                            : desiredDate
                        }
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
                          setDesiredDate(dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : e.target.value);
                        }}
                        placeholder="DD/MM/YYYY"
                        className="agri-input pr-8 font-mono"
                      />
                      <input
                        ref={dateInputRef}
                        type="date"
                        tabIndex={-1}
                        value={/^\d{4}-\d{2}-\d{2}$/.test(desiredDate) ? desiredDate : ''}
                        onChange={(e) => setDesiredDate(e.target.value)}
                        className="sr-only"
                        aria-hidden="true"
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        title="Chọn ngày từ lịch"
                        onClick={() => {
                          const el = dateInputRef.current;
                          if (!el) return;
                          if (typeof el.showPicker === 'function') el.showPicker();
                          else el.click();
                        }}
                        className="absolute right-2 p-0.5 text-[#0f4a33] hover:text-[#186635] cursor-pointer"
                      >
                        <Calendar className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block font-bold text-[#fff5d6] mb-1">Thanh toán đề xuất</label>
                    <SearchableCombo
                      value={paymentTerm}
                      onChange={setPaymentTerm}
                      options={paymentOptions}
                      placeholder="VD: T/T 30% Deposit / 70% against B/L copy"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-[#fff5d6] mb-1">Ghi chú gửi Phòng XNK</label>
                  <textarea
                    rows={2}
                    value={rfqNote}
                    placeholder="VD: Yêu cầu chứng nhận kiểm dịch thực vật, đóng thùng 10kg, yêu cầu ETD sớm..."
                    onChange={(e) => setRfqNote(e.target.value)}
                    className="agri-input"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setRfqModalOpen(false)} className="px-4 py-2 rounded-lg bg-[#07281c] text-[#fff5d6] font-bold cursor-pointer">
                    Hủy
                  </button>
                  <button type="submit" disabled={rfqSaving} className="agri-btn-gold px-5">
                    {rfqSaving ? 'Loading...' : 'Lưu & Gửi XNK Tính giá'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  const buildFollowUpDraftForInquiry = (inq: InquiryQuotation, angle: FollowUpAngle) => {
    const cus = data.consignees.find((c) => c.consignee_id === inq.consignee_id);
    const prop = data.proposals.find((p) => p.order_id === inq.order_id);
    const extra = proposalMetaMap[inq.order_id];
    const sch = prop?.schedule_id
      ? data.schedules.find((s) => s.schedule_id === prop.schedule_id)
      : undefined;
    const cleanRef = cleanQuoteNoForCustomer(extra?.quotation_no || '', inq.order_id);
    const items = parseOrderItems(inq, data.products, data.pricingRates);
    const engProducts =
      items
        .map((it) => stripInternalCodesForCustomer(it.name_eng || it.name))
        .filter(Boolean)
        .slice(0, 3)
        .join(', ') || 'Vietnamese Agricultural Products';
    const buyerGreeting = cus?.contact_person || inq.contact || cus?.consignee_name || 'Valued Partner';
    const inc = prop?.recommended_incoterm || inq.desired_incoterm || 'CIF';
    const pod = sch?.pod || inq.pod || 'your destination port';
    const priceStr = prop ? fmtUSD(prop.final_selling_price) : 'our quoted price';
    const subject = `Follow-up: [GREEN AGRI-EXPORTS] Official Quotation – ${engProducts} (${cleanRef})`;

    const angleParagraph =
      angle === 'INCOTERM_FLEX'
        ? `If you prefer comparing alternative trade terms (such as FOB Cat Lai / Da Nang vs. CIF ${pod}) or adjusting the payment structure, we would be happy to prepare an updated option tailored to your logistics plan.`
        : angle === 'SCHEDULE_VALIDITY'
        ? `Please note that our current ocean freight allocation${sch?.etd ? ` (Est. ETD: ${sch.etd})` : ''}${sch?.expiry_date ? ` and carrier rate validity (until ${sch.expiry_date})` : ''} are filling up quickly. Confirming early will help us secure the best vessel space and rate for your shipment.`
        : `Could you kindly share your feedback on the packaging specifications, MOQ / order volume (${fmtNumber(inq.net_weight_kgs)} KG), or preferred shipping schedule? We can also flexibly adjust between FOB and CIF terms if helpful.`;

    const body = [
      `Dear ${buyerGreeting},`,
      '',
      `I hope this message finds you well. I am writing to gently follow up on our Official Quotation ${cleanRef} for ${engProducts} (${fmtNumber(inq.net_weight_kgs)} KG, ${inc} ${pod} – ${priceStr}).`,
      '',
      angleParagraph,
      '',
      `Please let us know if you need product specifications, sample photos, or any clarification prior to order confirmation. We look forward to supporting your upcoming shipment.`,
      '',
      `Best regards,`,
      `${inq.sale_rep || currentUser.full_name || 'Export Sales Team'}`,
      `GREEN AGRICULTURAL PRODUCTS EXPORT CO., LTD`,
    ].join('\n');

    return {
      to: cus?.email || inq.email || '',
      subject,
      body,
    };
  };

  const openFollowUpModal = (inq: InquiryQuotation, angle: FollowUpAngle = 'GENERAL') => {
    const draft = buildFollowUpDraftForInquiry(inq, angle);
    setFollowUpOrderId(inq.order_id);
    setFollowUpAngle(angle);
    setFollowUpTo(draft.to);
    setFollowUpSubject(draft.subject);
    setFollowUpBody(draft.body);
  };

  if (activeView === 'sales-quotation') {
    const followUpCountDue = quotationRows.filter((inq) => {
      const extra = proposalMetaMap[inq.order_id];
      const sendCount =
        typeof extra?.send_count === 'number' && extra.send_count > 0
          ? extra.send_count
          : inq.sent_mail_link
          ? 1
          : 0;
      const isSent = isSentWaitingCustomerStatus(inq.inquiry_status) && sendCount > 0;
      if (!isSent) return false;
      const elapsed = getElapsedHours(extra?.last_sent_at || inq.timestamp);
      return extra?.engagement_status === 'VIEWED' || elapsed >= 24;
    }).length;

    return (
      <div className="space-y-4">
        <div className="agri-table-wrap">
          <div className="px-4 py-3 bg-[#0f4a33] border-b border-[#186635] flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-extrabold text-[#fff5d6]">Quản lý Báo giá Khách hàng ({quotationRows.length})</h3>
            {followUpCountDue > 0 && (
              <span className="keep-badge-color inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#f4d98a] text-[#07281c] text-[11px] font-extrabold">
                <BellRing className="w-3.5 h-3.5 text-[#8c3b3b]" />
                {followUpCountDue} báo giá cần Follow-up
              </span>
            )}
          </div>
          <div className="agri-table-scroll">
            <table className="agri-table">
              <thead>
                <tr>
                  <th className="text-center">Số Báo giá / Mã đơn</th>
                  <th className="text-left">Khách hàng</th>
                  <th className="text-left">Sản phẩm · KL</th>
                  <th className="text-center">Incoterm</th>
                  <th className="text-center">Giá chào (USD)</th>
                  <th className="text-center">Trạng thái &amp; Follow-up</th>
                  <th className="text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {quotationRows.map((inq) => {
                  const cus = data.consignees.find((c) => c.consignee_id === inq.consignee_id);
                  const prop = data.proposals.find((p) => p.order_id === inq.order_id);
                  const extra = proposalMetaMap[inq.order_id];
                  const cleanRef = cleanQuoteNoForCustomer(extra?.quotation_no || '', inq.order_id);
                  const sendCount =
                    typeof extra?.send_count === 'number' && extra.send_count > 0
                      ? extra.send_count
                      : inq.sent_mail_link
                      ? 1
                      : 0;
                  const isSent = isSentWaitingCustomerStatus(inq.inquiry_status) || sendCount > 0;
                  const sentAnchorIso = extra?.last_sent_at || (isSent ? inq.timestamp : '');
                  const elapsedHrs = isSent ? getElapsedHours(sentAnchorIso) : 0;
                  const isViewed = extra?.engagement_status === 'VIEWED';
                  const needsFollowUp =
                    isSentWaitingCustomerStatus(inq.inquiry_status) && (isViewed || elapsedHrs >= 24);
                  const readyOrSent = isPricedReadyStatus(inq.inquiry_status) || isSentWaitingCustomerStatus(inq.inquiry_status);
                  const canConfirm = readyOrSent && Boolean(prop);
                  const canDelete = !isContractCreatedStatus(inq.inquiry_status) && !data.orders.some((o) => o.order_id === inq.order_id && orderMetaMap[o.order_id]?.is_locked);
                  return (
                    <tr key={inq.order_id}>
                      <td className="text-center">
                        <div className="font-mono font-bold">{cleanRef}</div>
                        <button type="button" onClick={() => onOpenTimeline(inq.order_id)} className="text-[11px] font-mono hover:underline cursor-pointer">
                          {inq.order_id}
                        </button>
                        {sendCount > 0 && (
                          <div className="mt-0.5 flex flex-wrap items-center justify-center gap-1">
                            <span className="keep-badge-color inline-block px-1.5 py-0.5 rounded-full bg-[#f4d98a] text-[#07281c] text-[10px] font-extrabold">
                              Lần {sendCount}
                            </span>
                            {extra?.followup_count ? (
                              <span className="keep-badge-color inline-block px-1.5 py-0.5 rounded-full bg-[#16977f] text-white text-[10px] font-bold">
                                FU ×{extra.followup_count}
                              </span>
                            ) : null}
                          </div>
                        )}
                      </td>
                      <td className="text-left">
                        <div className="font-bold">{cus?.consignee_name || inq.consignee_id}</div>
                        <div className="text-[11px] opacity-80">{cus?.country || '-'} · {inq.email || cus?.email || '-'}</div>
                      </td>
                      <td className="text-left text-xs">
                        {inq.product_name_vie || inq.sku_code} · <span className="font-mono font-bold">{fmtNumber(inq.net_weight_kgs)} KG</span>
                      </td>
                      <td className="text-center font-mono font-bold">{prop?.recommended_incoterm || inq.desired_incoterm}</td>
                      <td className="text-center font-mono font-extrabold">
                        {prop ? fmtUSD(prop.final_selling_price) : <span className="opacity-65 italic">Chờ XNK</span>}
                      </td>
                      <td className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className="keep-badge-color inline-block px-2 py-0.5 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold">
                            {inq.inquiry_status}
                          </span>
                          {isSent && !isConfirmedStatus(inq.inquiry_status) && !isContractCreatedStatus(inq.inquiry_status) && (
                            <div className="flex flex-wrap items-center justify-center gap-1">
                              {isViewed && (
                                <span className="keep-badge-color inline-block px-1.5 py-0.5 rounded bg-[#16977f] text-white text-[10px] font-bold">
                                  Khách đã xem báo giá
                                </span>
                              )}
                              {needsFollowUp ? (
                                <span className="keep-badge-color inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#8c3b3b] text-[#fff5d6] text-[10px] font-extrabold">
                                  <BellRing className="w-2.5 h-2.5" />
                                  Cần Follow-up{elapsedHrs >= 48 ? ' (>48h)' : elapsedHrs >= 24 ? ' (>24h)' : ''}
                                </span>
                              ) : (
                                <span className="text-[10px] opacity-80 font-semibold">
                                  Đã gửi — Chờ phản hồi{sentAnchorIso ? ` (${formatShortTimestamp(sentAnchorIso)})` : ''}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="text-center">
                        <div className="inline-flex flex-wrap justify-center gap-1">
                          {prop && (
                            <>
                              <button
                                type="button"
                                title="Xem Phiếu tính giá nội bộ XNK (5 nhóm chi phí, Giá sàn, Hạn cước)"
                                onClick={() => onOpenPreview({ kind: 'QUOTATION', orderId: inq.order_id, initialQuotationTemplate: 'INTERNAL_COSTING_SHEET' })}
                                className="keep-btn-style px-2 py-1 rounded bg-[#07281c] text-[#f4d98a] border border-[#f4d98a]/50 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <FileSpreadsheet className="w-3 h-3" /> Phiếu giá XNK
                              </button>
                              <button
                                type="button"
                                onClick={() => onOpenPreview({ kind: 'QUOTATION', orderId: inq.order_id, initialQuotationTemplate: 'TMP_QUOTATION_01' })}
                                className="keep-btn-style px-2.5 py-1 rounded bg-[#f4d98a] text-[#07281c] text-[11px] font-extrabold cursor-pointer"
                              >
                                {sendCount > 0 ? `Xem & Gửi lại (Lần ${sendCount + 1})` : 'Xem & Gửi Báo giá'}
                              </button>
                            </>
                          )}
                          {isSent && !isConfirmedStatus(inq.inquiry_status) && !isContractCreatedStatus(inq.inquiry_status) && (
                            <>
                              <button
                                type="button"
                                title="Đánh dấu trạng thái khách đã xem báo giá"
                                onClick={() => {
                                  const nextStatus = isViewed ? 'WAITING' : 'VIEWED';
                                  onPatchProposalMeta(inq.order_id, {
                                    engagement_status: nextStatus,
                                    viewed_at: nextStatus === 'VIEWED' ? new Date().toISOString() : undefined,
                                  });
                                  onToast(
                                    'info',
                                    nextStatus === 'VIEWED'
                                      ? `Đã đánh dấu khách đã xem báo giá ${cleanRef}.`
                                      : `Đã chuyển ${cleanRef} về Chờ phản hồi.`
                                  );
                                }}
                                className={`keep-btn-style px-2 py-1 rounded text-[11px] font-bold cursor-pointer ${
                                  isViewed
                                    ? 'bg-[#16977f] text-white'
                                    : 'bg-[#d7eee4] text-[#07281c] border border-[#186635]'
                                }`}
                              >
                                {isViewed ? 'Đã xem ✓' : 'Đánh dấu Đã xem'}
                              </button>
                              <button
                                type="button"
                                onClick={() => openFollowUpModal(inq, 'GENERAL')}
                                className={`keep-btn-style px-2 py-1 rounded text-[11px] font-extrabold inline-flex items-center gap-1 cursor-pointer ${
                                  needsFollowUp
                                    ? 'bg-[#b45309] text-white'
                                    : 'bg-[#0f4a33] text-[#f4d98a]'
                                }`}
                              >
                                <Mail className="w-3 h-3" /> Soạn Follow-up
                              </button>
                            </>
                          )}
                          {isStoredDocumentPath(inq.sent_mail_link) && (
                            <button
                              type="button"
                              onClick={() =>
                                openDocumentWithSignedUrl(inq.sent_mail_link).catch((err: any) =>
                                  onToast('error', err?.message || 'Không thể tải báo giá.')
                                )
                              }
                              className="keep-btn-style px-2 py-1 rounded bg-[#d7eee4] text-[#07281c] border border-[#186635] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <ExternalLink className="w-3 h-3" /> Tải .docx
                            </button>
                          )}
                          {canConfirm && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setRepriceOrderId(inq.order_id);
                                  setRepriceReason('');
                                }}
                                className="keep-btn-style px-2 py-1 rounded bg-[#07281c] text-[#fff5d6] text-[11px] font-bold cursor-pointer"
                              >
                                Tính lại
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  onRequestConfirm(
                                    'Chốt đơn hàng?',
                                    `Xác nhận khách hàng đã đồng ý báo giá ${cleanRef} và chuyển sang Phòng XNK khởi tạo Hợp đồng Ngoại thương?`,
                                    () => onConfirmOrder(inq.order_id)
                                  )
                                }
                                className="keep-btn-style px-2.5 py-1 rounded bg-[#16977f] text-white text-[11px] font-bold cursor-pointer"
                              >
                                Khách Chốt đơn
                              </button>
                            </>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() =>
                                onRequestConfirm(
                                  'Hủy & Xóa đơn trước Hợp đồng?',
                                  `Đơn ${inq.order_id} sẽ bị xóa khỏi danh sách yêu cầu, bảng tính giá (nếu có) và cập nhật lại số đơn của khách hàng.`,
                                  () => onDeletePreContract(inq.order_id),
                                  true
                                )
                              }
                              className="keep-btn-style px-2 py-1 rounded bg-[#8c3b3b] text-white text-[11px] font-bold cursor-pointer"
                            >
                              Hủy đơn
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {quotationRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-8 opacity-75">
                      Chưa có báo giá nào trong danh sách.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Native Follow-Up Auto-Draft Modal */}
        {followUpOrderId && (() => {
          const fuInq = data.inquiries.find((i) => i.order_id === followUpOrderId);
          if (!fuInq) return null;
          const fuExtra = proposalMetaMap[followUpOrderId];
          const fuRef = cleanQuoteNoForCustomer(fuExtra?.quotation_no || '', followUpOrderId);
          return (
            <div className="fixed inset-0 z-50 bg-[#07281c]/75 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden text-[#f4f8f5]">
                <div className="px-5 py-3.5 bg-[#0f4a33] border-b-2 border-[#186635] flex items-start justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-extrabold text-[#fff5d6] flex items-center gap-1.5">
                      <BellRing className="w-4 h-4 text-[#f4d98a]" />
                      Trợ lý Soạn Follow-up Tự động · {fuRef}
                    </h4>
                    <p className="text-[11px] text-[#9bccb8] mt-0.5">
                      Chọn góc độ chăm sóc khách hàng để tạo nhanh nội dung tiếng Anh lịch sự, chuyên nghiệp
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFollowUpOrderId(null)}
                    className="p-1.5 rounded-lg bg-[#8c3b3b] text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-5 space-y-3 text-xs">
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        { id: 'GENERAL', label: 'Bao bì, MOQ & Lịch tàu' },
                        { id: 'INCOTERM_FLEX', label: 'Linh hoạt FOB vs. CIF' },
                        { id: 'SCHEDULE_VALIDITY', label: 'Hạn cước & Chỗ tàu ETD' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          const d = buildFollowUpDraftForInquiry(fuInq, opt.id);
                          setFollowUpAngle(opt.id);
                          setFollowUpSubject(d.subject);
                          setFollowUpBody(d.body);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer border ${
                          followUpAngle === opt.id
                            ? 'bg-[#f4d98a] text-[#07281c] border-[#f4d98a]'
                            : 'bg-[#07281c] text-[#d2ebe0] border-[#186635]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block font-bold text-[#fff5d6] mb-1">Người nhận (To)</label>
                      <input
                        type="email"
                        value={followUpTo}
                        onChange={(e) => setFollowUpTo(e.target.value)}
                        className="agri-input text-xs"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-[#fff5d6] mb-1">Tiêu đề Email</label>
                      <input
                        type="text"
                        value={followUpSubject}
                        onChange={(e) => setFollowUpSubject(e.target.value)}
                        className="agri-input text-xs font-semibold"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-[#fff5d6] mb-1">Nội dung Follow-up (Tiếng Anh)</label>
                    <textarea
                      rows={9}
                      value={followUpBody}
                      onChange={(e) => setFollowUpBody(e.target.value)}
                      className="agri-input text-xs leading-relaxed"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(`Subject: ${followUpSubject}\n\n${followUpBody}`);
                        onToast('success', 'Đã sao chép email Follow-up vào bộ nhớ tạm.');
                      }}
                      className="px-3 py-2 rounded-lg bg-[#0f4a33] border border-[#f4d98a]/50 text-[#fff5d6] font-bold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" /> Copy Email
                    </button>
                    {followUpTo && (
                      <a
                        href={`mailto:${encodeURIComponent(followUpTo)}?subject=${encodeURIComponent(followUpSubject)}&body=${encodeURIComponent(followUpBody)}`}
                        className="px-3 py-2 rounded-lg bg-[#16977f] text-white font-bold inline-flex items-center gap-1.5"
                      >
                        <Mail className="w-3.5 h-3.5" /> Mở Mail
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const prevCount = fuExtra?.followup_count || 0;
                        const nowIso = new Date().toISOString();
                        onPatchProposalMeta(followUpOrderId, {
                          followup_count: prevCount + 1,
                          last_followup_at: nowIso,
                          last_sent_at: nowIso,
                        });
                        onToast('success', `Đã ghi nhận Follow-up lần ${prevCount + 1} cho ${fuRef}.`);
                        setFollowUpOrderId(null);
                      }}
                      className="agri-btn-gold inline-flex items-center gap-1.5"
                    >
                      <Send className="w-3.5 h-3.5" /> Ghi nhận Đã Follow-up
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {repriceOrderId && (
          <div className="fixed inset-0 z-50 bg-[#07281c]/75 flex items-center justify-center p-4">
            <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl w-full max-w-md p-5 text-[#f4f8f5] space-y-3">
              <h4 className="text-sm font-extrabold text-[#fff5d6] flex items-center gap-1.5">
                <RotateCcw className="w-4 h-4 text-[#f4d98a]" /> Yêu cầu XNK Tính giá lại ({repriceOrderId})
              </h4>
              <textarea
                rows={3}
                value={repriceReason}
                onChange={(e) => setRepriceReason(e.target.value)}
                placeholder="Nhập lý do thương lượng của khách (VD: Khách xin giảm $200, đổi sang FOB...)"
                className="agri-input"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setRepriceOrderId(null)} className="px-3 py-1.5 rounded bg-[#07281c] text-white text-xs font-bold cursor-pointer">
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await onRequestReprice(repriceOrderId, repriceReason.trim() || 'Khách đề nghị điều chỉnh giá');
                    setRepriceOrderId(null);
                  }}
                  className="agri-btn-gold text-xs"
                >
                  Gửi XNK Tính lại
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (activeView === 'sales-contracts') {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex bg-[#07281c] p-1 rounded-xl border border-[#186635]">
            {(['ALL', 'PENDING', 'SIGNED'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setContractFilter(f)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                  contractFilter === f ? 'bg-[#f4d98a] text-[#07281c]' : 'text-[#d2ebe0]'
                }`}
              >
                {f === 'ALL' ? 'Tất cả Hợp đồng' : f === 'PENDING' ? 'Chờ Sales đưa ký' : 'Đã ký & Khóa'}
              </button>
            ))}
          </div>
        </div>

        <div className="agri-table-wrap">
          <div className="px-4 py-3 bg-[#0f4a33] border-b border-[#186635]">
            <h3 className="text-sm font-extrabold text-[#fff5d6]">
              {contractFilter === 'PENDING'
                ? `Hợp đồng Chờ Sales đưa ký (${salesContractsList.length})`
                : contractFilter === 'SIGNED'
                ? `Hợp đồng Đã ký & Khóa (${salesContractsList.length})`
                : `Tất cả Hợp đồng (${salesContractsList.length})`}
            </h3>
          </div>
          <div className="agri-table-scroll">
            <table className="agri-table">
              <thead>
                <tr>
                  <th className="text-center">Số Hợp đồng / Đơn</th>
                  <th className="text-left">Khách hàng</th>
                  <th className="text-left">Sản phẩm · KL</th>
                  <th className="text-center">Incoterm / TT</th>
                  <th className="text-center">Giá trị (USD)</th>
                  <th className="text-center">Trạng thái &amp; Cọc / L/C</th>
                  <th className="text-center">Hồ sơ &amp; Xác nhận</th>
                </tr>
              </thead>
              <tbody>
                {salesContractsList.map((ord) => {
                  const cus = data.consignees.find((c) => c.consignee_id === ord.consignee_id);
                  const meta = orderMetaMap[ord.order_id];
                  const isLocked = Boolean(meta?.is_locked);
                  const hasDepositOrLc =
                    meta?.deposit_lc_status === 'RECEIVED_TT' || meta?.deposit_lc_status === 'OPENED_LC';
                  return (
                    <tr key={ord.order_id}>
                      <td className="text-center">
                        <div className="font-mono font-bold">{ord.contract_no}</div>
                        <button type="button" onClick={() => onOpenTimeline(ord.order_id)} className="text-[11px] font-mono hover:underline cursor-pointer">
                          {ord.order_id}
                        </button>
                      </td>
                      <td className="text-left">
                        <div className="font-bold">{cus?.consignee_name || ord.consignee_id}</div>
                        <div className="text-[11px] opacity-80">{ord.pol} → {ord.pod}</div>
                      </td>
                      <td className="text-left">
                        <div className="font-mono font-bold">{ord.sku_code}</div>
                        <div className="text-[11px] font-mono">{fmtNumber(ord.nw_confirmed_kgs)} KG</div>
                      </td>
                      <td className="text-center">
                        <div className="font-mono font-bold">{ord.applied_incoterm}</div>
                        <div className="text-[11px]">{ord.payment_terms}</div>
                      </td>
                      <td className="text-center font-mono font-extrabold">{fmtUSD(ord.contract_value)}</td>
                      <td className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className={`keep-badge-color inline-block px-2 py-0.5 rounded text-[11px] font-bold ${isLocked ? 'bg-[#0f4a33] text-[#fff5d6]' : 'bg-[#f4d98a] text-[#07281c]'}`}>
                            {isLocked ? `Đã ký (${meta?.signed_date || 'OK'})` : 'Chờ Sales đưa ký'}
                          </span>
                          {hasDepositOrLc ? (
                            <span className="keep-badge-color inline-block px-2 py-0.5 rounded bg-[#16977f] text-white text-[10px] font-bold">
                              {meta?.deposit_lc_status === 'OPENED_LC'
                                ? `Đã mở L/C${meta.deposit_lc_ref ? ` · ${meta.deposit_lc_ref}` : ''}`
                                : `Đã cọc T/T${meta?.deposit_amount_usd ? ` · ${fmtUSD(meta.deposit_amount_usd)}` : ''}`}
                            </span>
                          ) : isLocked ? (
                            <span className="text-[10px] opacity-80 italic">Chờ ghi nhận Cọc T/T / L/C</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="text-center">
                        <div className="inline-flex flex-wrap items-center justify-center gap-1.5">
                          {/* Top: View Contract / Bottom: Download Contract */}
                          <div className="flex flex-col gap-1">
                            <button
                              type="button"
                              onClick={() => onOpenPreview({ kind: 'CONTRACT', orderId: ord.order_id })}
                              className="keep-btn-style px-2.5 py-1 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold inline-flex items-center justify-center gap-1 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" /> Xem hợp đồng
                            </button>
                            {ord.contract_link ? (
                              <button
                                type="button"
                                onClick={() =>
                                  openDocumentWithSignedUrl(ord.contract_link).catch((err: any) =>
                                    onToast('error', err?.message || 'Không thể tải file hợp đồng.')
                                  )
                                }
                                className="keep-btn-style px-2.5 py-1 rounded bg-[#d7eee4] text-[#07281c] border border-[#186635] text-[11px] font-bold inline-flex items-center justify-center gap-1 cursor-pointer"
                              >
                                <Download className="w-3 h-3" /> Tải File HĐ
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => onOpenPreview({ kind: 'CONTRACT', orderId: ord.order_id })}
                                className="keep-btn-style px-2.5 py-1 rounded bg-[#d7eee4] text-[#07281c] border border-[#186635] text-[11px] font-bold inline-flex items-center justify-center gap-1 cursor-pointer"
                              >
                                <FileText className="w-3 h-3" /> Tải File HĐ
                              </button>
                            )}
                          </div>

                          <div className="flex flex-col gap-1">
                            <button
                              type="button"
                              onClick={() => onOpenPreview({ kind: 'CONTRACT', orderId: ord.order_id, initialShowEmail: true })}
                              className="keep-btn-style px-2.5 py-1 rounded bg-[#07281c] text-[#f4d98a] text-[11px] font-bold inline-flex items-center justify-center gap-1 cursor-pointer"
                            >
                              <Mail className="w-3 h-3" /> Gửi Khách
                            </button>
                            {!isLocked ? (
                              <button
                                type="button"
                                onClick={() =>
                                  onRequestConfirm(
                                    'Xác nhận Khách đã ký Hợp đồng?',
                                    `Hợp đồng ${ord.contract_no} sẽ chuyển sang Mốc 3/6 (Chờ Booking & Đóng hàng) và khóa các điều khoản thương mại.`,
                                    () => onConfirmSignedContract(ord.order_id)
                                  )
                                }
                                className="keep-btn-style px-2.5 py-1 rounded bg-[#f4d98a] text-[#07281c] text-[11px] font-extrabold inline-flex items-center justify-center gap-1 cursor-pointer"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" /> Khách đã ký HĐ
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  const isLcTerm = String(ord.payment_terms || '').toUpperCase().includes('L/C');
                                  setDepositOrderId(ord.order_id);
                                  setDepositMethod(
                                    meta?.payment_method_type === 'L/C' || (meta?.payment_method_type !== 'T/T' && isLcTerm)
                                      ? 'L/C'
                                      : 'T/T'
                                  );
                                  setDepositAmountStr(
                                    meta?.deposit_amount_usd
                                      ? formatEditableNumber(meta.deposit_amount_usd)
                                      : ord.contract_value
                                      ? formatEditableNumber(Math.round(ord.contract_value * 0.3 * 100) / 100)
                                      : ''
                                  );
                                  setDepositRef(meta?.deposit_lc_ref || '');
                                  setDepositBank(meta?.deposit_lc_bank || '');
                                  setDepositDate(meta?.deposit_lc_date || todayIsoDate());
                                  setDepositNote(meta?.deposit_lc_note || '');
                                }}
                                className={`keep-btn-style px-2.5 py-1 rounded text-[11px] font-extrabold inline-flex items-center justify-center gap-1 cursor-pointer ${
                                  hasDepositOrLc
                                    ? 'bg-[#16977f] text-white'
                                    : 'bg-[#f4d98a] text-[#07281c]'
                                }`}
                              >
                                <Wallet className="w-3.5 h-3.5" />
                                {hasDepositOrLc ? 'Sửa Cọc / L/C' : 'Ghi nhận Cọc T/T / L/C'}
                              </button>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {salesContractsList.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-8 opacity-75">
                      {contractFilter === 'PENDING'
                        ? 'Chưa có hợp đồng nào đang chờ Sales đưa ký.'
                        : contractFilter === 'SIGNED'
                        ? 'Chưa có hợp đồng nào đã ký & khóa.'
                        : 'Chưa có hợp đồng nào trong danh sách.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Deposit (T/T) / L/C Opening Handover Modal */}
        {depositOrderId && (() => {
          const depOrd = data.orders.find((o) => o.order_id === depositOrderId);
          if (!depOrd) return null;
          return (
            <div className="fixed inset-0 z-50 bg-[#07281c]/75 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden text-[#f4f8f5]">
                <div className="px-5 py-3.5 bg-[#0f4a33] border-b-2 border-[#186635] flex items-start justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-extrabold text-[#fff5d6] flex items-center gap-1.5">
                      <Wallet className="w-4 h-4 text-[#f4d98a]" />
                      Ghi nhận Cọc T/T / Mở L/C · {depOrd.contract_no}
                    </h4>
                    <p className="text-[11px] text-[#9bccb8] mt-0.5">
                      Bàn giao thông tin thanh toán ban đầu cho Phòng XNK triển khai đóng hàng &amp; xuất tàu
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDepositOrderId(null)}
                    className="p-1.5 rounded-lg bg-[#8c3b3b] text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-5 space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDepositMethod('T/T')}
                      className={`py-2 rounded-lg font-extrabold border cursor-pointer ${
                        depositMethod === 'T/T'
                          ? 'bg-[#f4d98a] text-[#07281c] border-[#f4d98a]'
                          : 'bg-[#07281c] text-[#d2ebe0] border-[#186635]'
                      }`}
                    >
                      Đặt cọc T/T (Deposit)
                    </button>
                    <button
                      type="button"
                      onClick={() => setDepositMethod('L/C')}
                      className={`py-2 rounded-lg font-extrabold border cursor-pointer ${
                        depositMethod === 'L/C'
                          ? 'bg-[#f4d98a] text-[#07281c] border-[#f4d98a]'
                          : 'bg-[#07281c] text-[#d2ebe0] border-[#186635]'
                      }`}
                    >
                      Mở Thư tín dụng (L/C)
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block font-bold text-[#fff5d6] mb-1">
                        {depositMethod === 'L/C' ? 'Giá trị L/C (USD)' : 'Số tiền cọc T/T (USD)'}
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={depositAmountStr}
                        onChange={(e) => setDepositAmountStr(e.target.value)}
                        placeholder="VD: 6,500.00"
                        className="agri-input font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-[#fff5d6] mb-1">
                        {depositMethod === 'L/C' ? 'Ngày mở L/C' : 'Ngày nhận cọc'}
                      </label>
                      <input
                        type="date"
                        value={depositDate}
                        onChange={(e) => setDepositDate(e.target.value)}
                        className="agri-input font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block font-bold text-[#fff5d6] mb-1">
                        {depositMethod === 'L/C' ? 'Số L/C (L/C No.)' : 'Số tham chiếu (MT103 / Ref)'}
                      </label>
                      <input
                        type="text"
                        value={depositRef}
                        onChange={(e) => setDepositRef(e.target.value)}
                        placeholder={depositMethod === 'L/C' ? 'VD: LC-2026-88991' : 'VD: FT2611280091'}
                        className="agri-input font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-[#fff5d6] mb-1">Ngân hàng phát hành / chuyển</label>
                      <input
                        type="text"
                        value={depositBank}
                        onChange={(e) => setDepositBank(e.target.value)}
                        placeholder="VD: MUFG Bank / Vietcombank"
                        className="agri-input"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-[#fff5d6] mb-1">Ghi chú bàn giao Phòng XNK</label>
                    <textarea
                      rows={2}
                      value={depositNote}
                      onChange={(e) => setDepositNote(e.target.value)}
                      placeholder="VD: Đã nhận đủ 30% T/T vào TK USD Vietcombank Đà Nẵng, đề nghị XNK đặt booking tàu..."
                      className="agri-input"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setDepositOrderId(null)}
                      className="px-3.5 py-2 rounded-lg bg-[#07281c] text-[#fff5d6] font-bold cursor-pointer"
                    >
                      Hủy
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onPatchOrderMeta(depositOrderId, {
                          payment_method_type: depositMethod,
                          deposit_lc_status: depositMethod === 'L/C' ? 'OPENED_LC' : 'RECEIVED_TT',
                          deposit_amount_usd: parseLocaleNumber(depositAmountStr),
                          deposit_lc_ref: depositRef.trim(),
                          deposit_lc_bank: depositBank.trim(),
                          deposit_lc_date: depositDate || todayIsoDate(),
                          deposit_lc_note: depositNote.trim(),
                        });
                        onToast(
                          'success',
                          depositMethod === 'L/C'
                            ? `Đã ghi nhận mở L/C (${depositRef.trim() || depOrd.contract_no}) bàn giao XNK.`
                            : `Đã ghi nhận cọc T/T ${fmtUSD(parseLocaleNumber(depositAmountStr))} bàn giao XNK.`
                        );
                        setDepositOrderId(null);
                      }}
                      className="agri-btn-gold"
                    >
                      Lưu &amp; Bàn giao XNK
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  // sales-customers
  const filteredCustomers = data.consignees.filter((c) => {
    if (!quickSearchLower) return true;
    return `${c.consignee_id} ${c.consignee_name} ${c.country} ${c.email} ${c.tax}`.toLowerCase().includes(quickSearchLower);
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            setCusForm({
              consignee_id: '',
              consignee_name: '',
              country: '',
              address: '',
              tax: '',
              contact_person: '',
              phone: '',
              email: '',
              fax: '',
              default_payment_term: '',
              customer_type: 'Khách hàng tiềm năng',
              order_count: 0,
              created_date: todayIsoDate(),
            });
            setCusOrderCountStr('');
            setCusIsEdit(false);
            setCusModalOpen(true);
          }}
          className="agri-btn-gold flex items-center gap-1.5"
        >
          <UserPlus className="w-4 h-4" /> Thêm Khách hàng
        </button>
      </div>

      <div className="agri-table-wrap">
        <div className="px-4 py-3 bg-[#0f4a33] border-b border-[#186635]">
          <h3 className="text-sm font-extrabold text-[#fff5d6]">Danh bạ Khách hàng Quốc tế ({filteredCustomers.length})</h3>
        </div>
        <div className="agri-table-scroll">
          <table className="agri-table">
            <thead>
              <tr>
                <th className="text-center">Mã KH</th>
                <th className="text-left">Tên Khách hàng / Công ty</th>
                <th className="text-center">Quốc gia</th>
                <th className="text-left">Liên hệ / Email / SĐT</th>
                <th className="text-center">Tax ID</th>
                <th className="text-center">Số đơn</th>
                <th className="text-center">Phân loại</th>
                <th className="text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map((c) => (
                <tr key={c.consignee_id}>
                  <td className="text-center font-mono font-bold">{c.consignee_id}</td>
                  <td className="text-left">
                    <div className="font-bold">{c.consignee_name}</div>
                    <div className="text-[11px] opacity-80">{c.address}</div>
                  </td>
                  <td className="text-center font-semibold">{c.country}</td>
                  <td className="text-left text-xs">
                    <div>{c.contact_person} · {c.email}</div>
                    <div className="font-mono text-[11px]">Tel: {normalizePlainText(c.phone)} {c.fax ? `· Fax: ${normalizePlainText(c.fax)}` : ''}</div>
                  </td>
                  <td className="text-center font-mono text-xs">{normalizePlainText(c.tax) || '-'}</td>
                  <td className="text-center font-mono font-extrabold">{fmtNumber(c.order_count)}</td>
                  <td className="text-center">
                    <span className="keep-badge-color inline-block px-2 py-0.5 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold">
                      {c.customer_type || classifyCustomerByCount(c.order_count)}
                    </span>
                  </td>
                  <td className="text-center">
                    <div className="inline-flex flex-wrap justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setCusForm({ ...c });
                          setCusOrderCountStr(formatEditableNumber(c.order_count));
                          setCusIsEdit(true);
                          setCusModalOpen(true);
                        }}
                        className="keep-btn-style px-2 py-1 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold cursor-pointer"
                      >
                        <Edit3 className="w-3 h-3 inline mr-0.5" /> Sửa
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onRequestConfirm(
                            'Xóa khách hàng?',
                            `Xác nhận xóa khách hàng ${c.consignee_name}?`,
                            () => onDeleteConsignee(c.consignee_id),
                            true
                          )
                        }
                        className="keep-btn-style px-2 py-1 rounded bg-[#8c3b3b] text-white text-[11px] font-bold cursor-pointer"
                      >
                        Xóa
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredCustomers.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-8 opacity-75">
                    Chưa có khách hàng nào trong danh bạ.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {cusModalOpen && cusForm && (
        <div className="fixed inset-0 z-50 bg-[#07281c]/75 flex items-center justify-center p-4">
          <div className="bg-[#547d59] border-2 border-[#186635] rounded-2xl w-full max-w-xl p-5 text-[#f4f8f5] space-y-3 text-xs">
            <h4 className="text-base font-extrabold text-[#fff5d6]">{cusIsEdit ? 'Cập nhật Khách hàng' : 'Thêm Khách hàng Mới'}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold mb-1">Mã KH</label>
                <input
                  value={cusForm.consignee_id}
                  disabled={cusIsEdit}
                  placeholder="VD: CON-001 (để trống tự cấp)"
                  onChange={(e) => setCusForm({ ...cusForm, consignee_id: e.target.value })}
                  className="agri-input font-mono"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Tên công ty *</label>
                <input
                  value={cusForm.consignee_name}
                  placeholder="VD: Fresh Asia Trading Co., Ltd"
                  onChange={(e) => setCusForm({ ...cusForm, consignee_name: e.target.value })}
                  className="agri-input"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Quốc gia</label>
                <SearchableCombo
                  value={cusForm.country}
                  onChange={(v) => setCusForm({ ...cusForm, country: v })}
                  options={countryOptions}
                  allowCustom
                  placeholder="VD: Japan / USA / Germany..."
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Tax ID</label>
                <input
                  value={cusForm.tax}
                  placeholder="VD: JP-987654321"
                  onChange={(e) => setCusForm({ ...cusForm, tax: e.target.value })}
                  className="agri-input font-mono"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Người liên hệ</label>
                <input
                  value={cusForm.contact_person}
                  placeholder="VD: Mr. Kenji Tanaka"
                  onChange={(e) => setCusForm({ ...cusForm, contact_person: e.target.value })}
                  className="agri-input"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Email</label>
                <input
                  value={cusForm.email}
                  placeholder="VD: kenji@freshasia.jp"
                  onChange={(e) => setCusForm({ ...cusForm, email: e.target.value })}
                  className="agri-input"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">SĐT (Plain Text)</label>
                <input
                  value={cusForm.phone}
                  placeholder="VD: +81 3-5555-0199"
                  onChange={(e) => setCusForm({ ...cusForm, phone: e.target.value })}
                  className="agri-input font-mono"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Fax (Plain Text)</label>
                <input
                  value={cusForm.fax}
                  placeholder="VD: +81 3-5555-0198"
                  onChange={(e) => setCusForm({ ...cusForm, fax: e.target.value })}
                  className="agri-input font-mono"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-bold mb-1">Địa chỉ</label>
                <input
                  value={cusForm.address}
                  placeholder="VD: 1-2-3 Minato-ku, Tokyo, Japan"
                  onChange={(e) => {
                    const nextAddr = e.target.value;
                    const detected = detectCountryFromAddress(nextAddr, knownCountries);
                    setCusForm({
                      ...cusForm,
                      address: nextAddr,
                      country: detected || cusForm.country,
                    });
                  }}
                  className="agri-input"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Thanh toán mặc định</label>
                <SearchableCombo
                  value={cusForm.default_payment_term}
                  onChange={(v) => setCusForm({ ...cusForm, default_payment_term: v })}
                  options={paymentOptions}
                  allowCustom
                  placeholder="VD: T/T 30% Deposit / 70% against B/L copy"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Số đơn baseline</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={cusOrderCountStr}
                  placeholder="VD: 0"
                  onChange={(e) => setCusOrderCountStr(e.target.value)}
                  className="agri-input font-mono"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setCusModalOpen(false)} className="px-3 py-1.5 rounded bg-[#07281c] text-white font-bold cursor-pointer">Hủy</button>
              <button
                type="button"
                onClick={async () => {
                  if (!cusForm.consignee_name.trim()) {
                    onToast('warning', 'Vui lòng nhập Tên công ty.');
                    return;
                  }
                  let resolvedId = cusForm.consignee_id.trim();
                  if (!resolvedId) {
                    const maxIdx = data.consignees.reduce((m, c) => {
                      const match = c.consignee_id.match(/CON-(\d+)/i);
                      return match ? Math.max(m, parseInt(match[1], 10)) : m;
                    }, 0);
                    resolvedId = `CON-${String(maxIdx + 1).padStart(3, '0')}`;
                  }
                  const parsedCount = Math.max(0, Math.round(parseLocaleNumber(cusOrderCountStr)));
                  await onUpsertConsignee(
                    {
                      ...cusForm,
                      consignee_id: resolvedId,
                      consignee_name: cusForm.consignee_name.trim(),
                      default_payment_term: cusForm.default_payment_term.trim() || 'T/T 30/70',
                      order_count: parsedCount,
                    },
                    cusIsEdit
                  );
                  setCusModalOpen(false);
                }}
                className="agri-btn-gold"
              >
                Lưu Khách hàng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
