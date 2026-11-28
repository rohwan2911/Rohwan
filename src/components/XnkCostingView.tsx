import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, Send, Calculator, Check, Ship, Layers, ShieldCheck, Save, Eye } from 'lucide-react';
import type {
  AppDataState,
  OrderItem,
  PricingProposal,
  ProposalExtraMeta,
  SysUser,
} from '../types';
import {
  buildCombinedInsuranceClauseEng,
  buildContainerMixState,
  cleanQuoteNoForCustomer,
  computeCustomsSplit,
  computeDomesticTruckingForMix,
  computeInsurancePremiumExact,
  computeItemPackingAndPallet,
  computeLocalChargesForMix,
  computeOrderPalletSummary,
  computeScheduleOceanAndMissing,
  deduplicatePortName,
  fmtDecimal,
  fmtNumber,
  fmtUSD,
  formatDateDDMMYYYY,
  getInsuranceCatalog,
  getPackingOptionsForProduct,
  INCOTERMS_2020_MATRIX,
  isQuickCaptureStatus,
  isReeferProduct,
  isRepriceRequestedStatus,
  isWaitingPricingStatus,
  parseInsuranceCodeString,
  parseLocaleNumber,
  parseOrderItems,
  resolvePackingSpec,
  solveOptimalContainerMix,
  stripItemsTag,
  suggestCoFormCode,
  todayIsoDate,
  toNum,
  WORKFLOW_STATUS,
} from '../utils/calculations';
import { SearchableCombo } from './SearchableCombo';
import type { PreviewModalTarget } from './Modals';

interface XnkCostingViewProps {
  data: AppDataState;
  currentUser: SysUser;
  proposalMetaMap: Record<string, ProposalExtraMeta>;
  onSaveProposal: (proposal: PricingProposal, extraMeta: ProposalExtraMeta, updatedItemsJson: string) => Promise<void>;
  onOpenPreview?: (target: PreviewModalTarget) => void;
  onOpenTimeline: (orderId: string) => void;
  onToast: (type: 'success' | 'error' | 'info' | 'warning', title: string) => void;
}

interface AiChatMessage {
  role: 'user' | 'assistant';
  text: string;
  recommendedIncoterms?: string[];
  bestIncoterm?: string;
  reason?: string;
  recommendedInsuranceCode?: string;
  recommendedInsuranceAddons?: string[];
  insuranceReason?: string;
}

export const XnkCostingView: React.FC<XnkCostingViewProps> = ({
  data,
  currentUser,
  proposalMetaMap,
  onSaveProposal,
  onOpenPreview,
  onOpenTimeline,
  onToast,
}) => {
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [itemsState, setItemsState] = useState<OrderItem[]>([]);
  const [usePallet, setUsePallet] = useState(false);
  const [palletRate, setPalletRate] = useState('18.00');
  const [packingManualCost, setPackingManualCost] = useState<string>('');

  // 6 ISO Containers + LCL
  const [q20dc, setQ20dc] = useState(0);
  const [q40dc, setQ40dc] = useState(0);
  const [q40hc, setQ40hc] = useState(0);
  const [q20rf, setQ20rf] = useState(0);
  const [q40rf, setQ40rf] = useState(0);
  const [q40rh, setQ40rh] = useState(0);
  const [lclBasis, setLclBasis] = useState<'WM' | 'CBM' | 'TON'>('WM');
  const [lclRateStr, setLclRateStr] = useState('65.00');
  const lclRate = parseLocaleNumber(lclRateStr);

  // Route & Schedule
  const [countryFilter, setCountryFilter] = useState('');
  const [podFilter, setPodFilter] = useState('');
  const [selectedScheduleId, setSelectedScheduleId] = useState('');

  // Incoterms 2020 selection
  const [proposedIncoterms, setProposedIncoterms] = useState<string[]>(['CIF']);
  const [recIncoterm, setRecIncoterm] = useState('CIF');

  // Gemini AI Advisor
  const [aiMessages, setAiMessages] = useState<AiChatMessage[]>([]);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiBestTerm, setAiBestTerm] = useState('');
  const [aiBestReason, setAiBestReason] = useState('');

  // Khung 4 Pricing & Insurance
  const [marginPctStr, setMarginPctStr] = useState('12');
  const [minMarginPctStr, setMinMarginPctStr] = useState('5');
  const marginPct = parseLocaleNumber(marginPctStr);
  const minMarginPct = parseLocaleNumber(minMarginPctStr);
  const [manualFloorPrice, setManualFloorPrice] = useState('');
  const [includeFreight, setIncludeFreight] = useState(true);
  const [includeInsurance, setIncludeInsurance] = useState(true);
  const [insBaseCode, setInsBaseCode] = useState('INS-ICC-A');
  const [insAddons, setInsAddons] = useState<string[]>([]);
  const [manualInsurance, setManualInsurance] = useState('');
  const [destExtraStr, setDestExtraStr] = useState('');
  const [importDutyStr, setImportDutyStr] = useState('');
  const destExtra = parseLocaleNumber(destExtraStr);
  const importDutyUsd = parseLocaleNumber(importDutyStr);
  const [calcNote, setCalcNote] = useState('');

  // Parallel Self vs FWD Comparison Matrix
  const [showFwdCompare, setShowFwdCompare] = useState(true);
  const [execOption, setExecOption] = useState<'SELF' | 'HYBRID' | 'FWD_ALL'>('SELF');
  const [selfOceanChecked, setSelfOceanChecked] = useState(true);
  const [fwdOceanStr, setFwdOceanStr] = useState('');
  const [selfTruckChecked, setSelfTruckChecked] = useState(true);
  const [selfTruckRateStr, setSelfTruckRateStr] = useState('');
  const [fwdTruckStr, setFwdTruckStr] = useState('');
  const [selfCustomsChecked, setSelfCustomsChecked] = useState(true);
  const [fwdCustomsStr, setFwdCustomsStr] = useState('');
  const [selfPermitsChecked, setSelfPermitsChecked] = useState(true);
  const [fwdPermitsStr, setFwdPermitsStr] = useState('');
  const fwdOcean = parseLocaleNumber(fwdOceanStr);
  const selfTruckRate = parseLocaleNumber(selfTruckRateStr);
  const fwdTruck = parseLocaleNumber(fwdTruckStr);
  const fwdCustoms = parseLocaleNumber(fwdCustomsStr);
  const fwdPermits = parseLocaleNumber(fwdPermitsStr);
  const [saving, setSaving] = useState(false);

  const insuranceCatalog = useMemo(() => getInsuranceCatalog(data.pricingRates), [data.pricingRates]);

  const orderOptions = useMemo(() => {
    const officialInquiries = data.inquiries.filter((i) => !isQuickCaptureStatus(i.inquiry_status));
    const prioritized = officialInquiries.slice().reverse().sort((a, b) => {
      const aUrgent = isWaitingPricingStatus(a.inquiry_status) || isRepriceRequestedStatus(a.inquiry_status) ? 0 : 1;
      const bUrgent = isWaitingPricingStatus(b.inquiry_status) || isRepriceRequestedStatus(b.inquiry_status) ? 0 : 1;
      return aUrgent - bUrgent;
    });
    return prioritized.map((i) => {
      const cus = data.consignees.find((c) => c.consignee_id === i.consignee_id);
      return {
        value: i.order_id,
        label: `${i.order_id} · ${cus?.consignee_name || i.consignee_id}`,
        subLabel: `${i.inquiry_status} · ${fmtNumber(i.net_weight_kgs)} KG`,
      };
    });
  }, [data.inquiries, data.consignees]);

  const selectedInq = useMemo(() => data.inquiries.find((i) => i.order_id === selectedOrderId), [data.inquiries, selectedOrderId]);
  const selectedCus = useMemo(() => (selectedInq ? data.consignees.find((c) => c.consignee_id === selectedInq.consignee_id) : undefined), [data.consignees, selectedInq]);

  const loadOrderIntoCalculator = (orderId: string) => {
    setSelectedOrderId(orderId);
    setAiMessages([]);
    setAiBestTerm('');
    setAiBestReason('');
    setManualFloorPrice('');
    setManualInsurance('');
    setPackingManualCost('');

    const inq = data.inquiries.find((i) => i.order_id === orderId);
    if (!inq) {
      setSelectedScheduleId('');
      setItemsState([]);
      return;
    }
    const cus = data.consignees.find((c) => c.consignee_id === inq.consignee_id);
    const existingProp = data.proposals.find((p) => p.order_id === orderId);
    const existingMeta = proposalMetaMap[orderId];
    const parsed = parseOrderItems(inq, data.products, data.pricingRates);
    setItemsState(parsed);

    const pal = existingMeta?.use_pallet ?? (existingProp ? toNum(existingProp.total_pallets) > 0 : parsed.some((it) => it.palletCode === 'PKG-PLT-YES'));
    setUsePallet(pal);
    const stdPlt = resolvePackingSpec('PKG-PLT-YES', data.pricingRates).rate || 18;
    const savedPltRate =
      existingProp && toNum(existingProp.total_pallets) > 0 && toNum(existingProp.pallet_fee) > 0
        ? toNum(existingProp.pallet_fee) / toNum(existingProp.total_pallets)
        : stdPlt;
    setPalletRate(fmtDecimal(savedPltRate, 2));
    const inqPodClean = deduplicatePortName(inq.pod || cus?.default_pod || '');
    const matchedPodSch = inqPodClean
      ? data.schedules.find((s) => deduplicatePortName(s.pod).toLowerCase() === inqPodClean.toLowerCase())
      : undefined;
    setCountryFilter(cus?.country || matchedPodSch?.country || '');
    setPodFilter(inqPodClean);

    const optMix = solveOptimalContainerMix(parsed, pal, data.products, data.pricingRates);
    let nextQ20dc = optMix.qty20DC;
    let nextQ40dc = optMix.qty40DC;
    let nextQ40hc = optMix.qty40HC;
    let nextQ20rf = optMix.qty20RF;
    let nextQ40rf = optMix.qty40RF;
    let nextQ40rh = optMix.qty40RH;

    if (existingProp?.container_type) {
      const ctStr = existingProp.container_type;
      const matchQty = (typeRegex: RegExp) => {
        const m = ctStr.match(new RegExp(`(\\d+)\\s*x\\s*${typeRegex.source}`, 'i'));
        return m ? parseInt(m[1], 10) : 0;
      };
      const parsed20dc = matchQty(/20['’]?\s*DC/);
      const parsed40dc = matchQty(/40['’]?\s*DC/);
      const parsed40hc = matchQty(/40['’]?\s*HC/);
      const parsed20rf = matchQty(/20['’]?\s*RF/);
      const parsed40rf = matchQty(/40['’]?\s*RF/);
      const parsed40rh = matchQty(/40['’]?\s*RH/);
      const sumParsed = parsed20dc + parsed40dc + parsed40hc + parsed20rf + parsed40rf + parsed40rh;
      if (sumParsed > 0) {
        nextQ20dc = parsed20dc;
        nextQ40dc = parsed40dc;
        nextQ40hc = parsed40hc;
        nextQ20rf = parsed20rf;
        nextQ40rf = parsed40rf;
        nextQ40rh = parsed40rh;
      } else if (ctStr.toUpperCase().includes('LCL')) {
        nextQ20dc = 0;
        nextQ40dc = 0;
        nextQ40hc = 0;
        nextQ20rf = 0;
        nextQ40rf = 0;
        nextQ40rh = 0;
      }
    }

    setQ20dc(nextQ20dc);
    setQ40dc(nextQ40dc);
    setQ40hc(nextQ40hc);
    setQ20rf(nextQ20rf);
    setQ40rf(nextQ40rf);
    setQ40rh(nextQ40rh);

    setSelectedScheduleId(existingProp?.schedule_id || '');
    setLclBasis(existingMeta?.lcl_basis === 'TON' ? 'TON' : existingMeta?.lcl_basis === 'CBM' ? 'CBM' : 'WM');
    setLclRateStr(fmtDecimal(existingMeta?.lcl_rate && existingMeta.lcl_rate > 0 ? existingMeta.lcl_rate : 65, 2));
    setMarginPctStr(fmtNumber(existingMeta?.margin_pct !== undefined ? existingMeta.margin_pct : 12, 2));
    setMinMarginPctStr(fmtNumber(existingMeta?.min_margin_pct !== undefined ? existingMeta.min_margin_pct : 5, 2));
    setDestExtraStr(existingMeta?.dest_extra ? fmtDecimal(existingMeta.dest_extra, 2) : '');
    setImportDutyStr(existingMeta?.import_duty_usd ? fmtDecimal(existingMeta.import_duty_usd, 2) : '');
    setCalcNote(existingMeta?.note || '');

    const initMix = buildContainerMixState(
      { q20dc: nextQ20dc, q40dc: nextQ40dc, q40hc: nextQ40hc, q20rf: nextQ20rf, q40rf: nextQ40rf, q40rh: nextQ40rh },
      parsed,
      pal,
      'WM',
      65,
      data.products,
      data.pricingRates
    );
    const defaultTruck = computeDomesticTruckingForMix(initMix, data.pricingRates);
    const hasLclAuto =
      (nextQ20dc + nextQ40dc + nextQ40hc + nextQ20rf + nextQ40rf + nextQ40rh === 0 && parsed.length > 0) ||
      optMix.dryMode === 'LCL' ||
      optMix.reeferMode === 'LCL';
    const savedExec = existingMeta?.freight_exec_option || (hasLclAuto ? 'FWD_ALL' : 'SELF');
    setExecOption(savedExec);
    setShowFwdCompare(true);
    setFwdOceanStr(toNum(existingMeta?.fwd_ocean) > 0 ? fmtDecimal(existingMeta?.fwd_ocean, 2) : '');
    setFwdTruckStr(toNum(existingMeta?.fwd_trucking) > 0 ? fmtDecimal(existingMeta?.fwd_trucking, 2) : '');
    setFwdCustomsStr(toNum(existingMeta?.fwd_customs) > 0 ? fmtDecimal(existingMeta?.fwd_customs, 2) : '');
    setFwdPermitsStr(toNum(existingMeta?.fwd_permits) > 0 ? fmtDecimal(existingMeta?.fwd_permits, 2) : '');
    const savedSelfTruck = existingMeta?.self_trucking !== undefined ? toNum(existingMeta.self_trucking) : defaultTruck;
    setSelfTruckRateStr(savedSelfTruck > 0 ? fmtDecimal(savedSelfTruck, 2) : '');
    setSelfTruckChecked(true);
    setSelfOceanChecked(!hasLclAuto);
    setSelfCustomsChecked(true);
    setSelfPermitsChecked(true);

    const desired = (existingProp?.recommended_incoterm || inq.desired_incoterm || 'CIF').toUpperCase();
    const savedTerms = existingProp?.proposed_incoterms
      ? existingProp.proposed_incoterms.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean)
      : [];
    const isComp = String(inq.quotation_mode || '').toUpperCase().includes('COMP');
    const initTerms = savedTerms.length > 0 ? savedTerms : [desired];
    if (!initTerms.includes(desired)) initTerms.unshift(desired);
    if (isComp && savedTerms.length === 0) {
      ['FOB', 'CIF', 'CIP'].forEach((t) => {
        if (!initTerms.includes(t) && initTerms.length < 3) initTerms.push(t);
      });
    }
    setProposedIncoterms(initTerms);
    setRecIncoterm(desired);
    const rule = INCOTERMS_2020_MATRIX.find((r) => r.code === desired);
    if (rule) {
      setIncludeFreight(rule.includeFreight);
      setIncludeInsurance(rule.includeIns);
      if (existingProp?.insurance_code) {
        const parsedIns = parseInsuranceCodeString(existingProp.insurance_code, data.pricingRates);
        setInsBaseCode(parsedIns.baseCode);
        setInsAddons(parsedIns.addonCodes);
      } else {
        setInsBaseCode(rule.includeIns ? (desired === 'CIP' ? 'INS-ICC-A' : 'INS-ICC-C') : 'INS-NONE');
        setInsAddons([]);
      }
    }
  };

  const palletPool = useMemo(() => {
    return computeOrderPalletSummary(itemsState, usePallet, data.pricingRates, toNum(palletRate));
  }, [itemsState, usePallet, data.pricingRates, palletRate]);

  const effectivePackingCost = packingManualCost !== '' ? toNum(packingManualCost) : palletPool.totalPackingPalletCost;

  const mix = useMemo(() => {
    return buildContainerMixState(
      { q20dc, q40dc, q40hc, q20rf, q40rf, q40rh },
      itemsState,
      usePallet,
      lclBasis,
      lclRate,
      data.products,
      data.pricingRates
    );
  }, [q20dc, q40dc, q40hc, q20rf, q40rf, q40rh, itemsState, usePallet, lclBasis, lclRate, data.products, data.pricingRates]);

  const activeSch = useMemo(() => data.schedules.find((s) => s.schedule_id === selectedScheduleId), [data.schedules, selectedScheduleId]);

  const scheduleEvaluations = useMemo(() => {
    const cLow = countryFilter.trim().toLowerCase();
    const pClean = deduplicatePortName(podFilter).toLowerCase();
    const list = data.schedules.filter((s) => {
      if (cLow && s.country.trim().toLowerCase() !== cLow) return false;
      if (pClean && deduplicatePortName(s.pod).toLowerCase() !== pClean) return false;
      return true;
    });
    const hasCold = itemsState.some((it) => isReeferProduct(data.products.find((p) => p.sku_code === it.sku), it.name)) || mix.reefer > 0;
    const leadDays = hasCold ? 7 : 5;
    const earliest = new Date();
    earliest.setHours(0, 0, 0, 0);
    earliest.setDate(earliest.getDate() + leadDays);

    const evalMix =
      mix.total > 0 || mix.hasLcl
        ? mix
        : buildContainerMixState(
            { q20dc: hasCold ? 0 : 1, q40dc: 0, q40hc: 0, q20rf: hasCold ? 1 : 0, q40rf: 0, q40rh: 0 },
            itemsState,
            usePallet,
            lclBasis,
            lclRate,
            data.products,
            data.pricingRates
          );

    const evals = list.map((s) => {
      const res = computeScheduleOceanAndMissing(s, evalMix);
      const etd = s.etd ? new Date(s.etd) : null;
      const eta = s.eta ? new Date(s.eta) : null;
      const isTooTight = Boolean(etd && !Number.isNaN(etd.getTime()) && etd.getTime() < earliest.getTime());
      const transitDays = etd && eta && !Number.isNaN(etd.getTime()) && !Number.isNaN(eta.getTime())
        ? Math.max(1, Math.round((eta.getTime() - etd.getTime()) / 86400000))
        : 999;
      return { s, res, hasMissing: res.missing.length > 0, isTooTight, transitDays, totalCost: res.ocean + res.surcharge, leadDays };
    });

    const feasible = evals.filter((e) => !e.isTooTight && !e.hasMissing && e.totalCost > 0);
    let cheapestId = '';
    let fastestId = '';
    let optimalId = '';
    if (feasible.length > 0) {
      const minCost = Math.min(...feasible.map((e) => e.totalCost));
      const maxCost = Math.max(...feasible.map((e) => e.totalCost));
      const minTransit = Math.min(...feasible.map((e) => e.transitDays));
      const maxTransit = Math.max(...feasible.map((e) => e.transitDays));
      let bestScore = Infinity;
      feasible.forEach((e) => {
        if (e.totalCost === minCost && !cheapestId) cheapestId = e.s.schedule_id;
        if (e.transitDays === minTransit && !fastestId) fastestId = e.s.schedule_id;
        const cNorm = maxCost > minCost ? (e.totalCost - minCost) / (maxCost - minCost) : 0;
        const tNorm = maxTransit > minTransit ? (e.transitDays - minTransit) / (maxTransit - minTransit) : 0;
        const sc = 0.6 * cNorm + 0.4 * tNorm;
        if (sc < bestScore) {
          bestScore = sc;
          optimalId = e.s.schedule_id;
        }
      });
    }
    return { evals, cheapestId, fastestId, optimalId };
  }, [data.schedules, data.products, countryFilter, podFilter, itemsState, mix]);

  const countryOptions = useMemo(() => {
    const s = new Set<string>();
    data.schedules.forEach((x) => x.country && s.add(x.country.trim()));
    return Array.from(s).sort().map((v) => ({ value: v, label: v }));
  }, [data.schedules]);

  const podOptions = useMemo(() => {
    const s = new Set<string>();
    data.schedules
      .filter((x) => !countryFilter || x.country.trim().toLowerCase() === countryFilter.trim().toLowerCase())
      .forEach((x) => {
        const cleanPod = deduplicatePortName(x.pod);
        if (cleanPod) s.add(cleanPod);
      });
    return Array.from(s).sort().map((v) => ({ value: v, label: v }));
  }, [data.schedules, countryFilter]);

  const insuranceBaseOptions = useMemo(() => {
    return insuranceCatalog.basePolicies.map((p) => ({
      value: p.fee_code,
      label: `${p.fee_code} · ${p.fee_name_vie}`,
      subLabel: `Tỷ lệ phí: ${fmtDecimal(p.standard_rate, 2)}%`,
    }));
  }, [insuranceCatalog.basePolicies]);

  // Core Cost Components
  const goodsCost = useMemo(() => {
    return itemsState.reduce((sum, it) => {
      const prod = data.products.find((p) => p.sku_code.toLowerCase() === it.sku.toLowerCase());
      return sum + toNum(it.weight) * toNum(prod?.unit_price);
    }, 0);
  }, [itemsState, data.products]);

  const schOceanRes = useMemo(() => computeScheduleOceanAndMissing(activeSch, mix), [activeSch, mix]);
  const fullLocalTotal = useMemo(() => computeLocalChargesForMix(mix, data.pricingRates), [mix, data.pricingRates]);
  const defaultTruckRate = useMemo(() => computeDomesticTruckingForMix(mix, data.pricingRates), [mix, data.pricingRates]);
  const customsSplit = useMemo(() => computeCustomsSplit(data.pricingRates), [data.pricingRates]);

  const selectedInsRatePct = useMemo(() => {
    if (insBaseCode === 'INS-NONE') return 0;
    const baseRate = toNum(insuranceCatalog.byCode[insBaseCode]?.standard_rate);
    const addonRate = insAddons.reduce((s, ac) => s + toNum(insuranceCatalog.byCode[ac]?.standard_rate), 0);
    return Math.round((baseRate + addonRate) * 10000) / 10000;
  }, [insBaseCode, insAddons, insuranceCatalog]);

  const insCombinedCode = useMemo(() => {
    if (insBaseCode === 'INS-NONE') return 'INS-NONE';
    return insAddons.length > 0 ? `${insBaseCode} + ${insAddons.join(' + ')}` : insBaseCode;
  }, [insBaseCode, insAddons]);

  const insClauseEng = useMemo(
    () => buildCombinedInsuranceClauseEng(insBaseCode, insAddons, recIncoterm, data.pricingRates),
    [insBaseCode, insAddons, recIncoterm, data.pricingRates]
  );

  // Final Calculations for Khung 4 (Exact Incoterms 2020, Insurance 110% & Selected Self/Hybrid/FWD Costs)
  const costing = useMemo(() => {
    const goodsAndPack = goodsCost + effectivePackingCost;
    const exwSell = Math.round(goodsAndPack * (1 + marginPct / 100) * 100) / 100;

    const schOcean = schOceanRes.ocean;
    const schSurcharge = schOceanRes.surcharge;
    const selfOceanBase = schOcean + schSurcharge;
    const effSelfTruckVal = selfTruckRate > 0 ? selfTruckRate : defaultTruckRate;
    const selfCustomsVal = customsSplit.customsExportUsd;
    const selfPermitsVal = customsSplit.permitsUsd;

    const effFwdOcean = fwdOcean > 0 ? fwdOcean : selfOceanBase + (mix.hasLcl ? 0 : fullLocalTotal);
    const effFwdTruck = fwdTruck > 0 ? fwdTruck : effSelfTruckVal;
    const effFwdCustoms = fwdCustoms > 0 ? fwdCustoms : selfCustomsVal;
    const effFwdPermits = fwdPermits > 0 ? fwdPermits : selfPermitsVal;

    const selfOceanTotal = mix.hasLcl ? null : Math.round((selfOceanBase + fullLocalTotal) * 100) / 100;
    const selfTotal =
      selfOceanTotal !== null
        ? Math.round((selfOceanTotal + effSelfTruckVal + selfCustomsVal + selfPermitsVal) * 100) / 100
        : null;
    const fwdAllTotal = Math.round((effFwdOcean + effFwdTruck + effFwdCustoms + effFwdPermits) * 100) / 100;

    const hybridOcean = selfOceanChecked && selfOceanTotal !== null ? selfOceanTotal : effFwdOcean;
    const hybridTruck = selfTruckChecked ? effSelfTruckVal : effFwdTruck;
    const hybridCustoms = selfCustomsChecked ? selfCustomsVal : effFwdCustoms;
    const hybridPermits = selfPermitsChecked ? selfPermitsVal : effFwdPermits;
    const hybridTotal = Math.round((hybridOcean + hybridTruck + hybridCustoms + hybridPermits) * 100) / 100;

    // Feed selected execution option into active costing components
    const activeTrucking =
      execOption === 'SELF'
        ? effSelfTruckVal
        : execOption === 'FWD_ALL'
        ? effFwdTruck
        : hybridTruck;
    const activeCustoms =
      execOption === 'SELF'
        ? selfCustomsVal + selfPermitsVal
        : execOption === 'FWD_ALL'
        ? effFwdCustoms + effFwdPermits
        : hybridCustoms + hybridPermits;
    const useFwdOceanLine =
      (execOption === 'FWD_ALL' && fwdOcean > 0) ||
      (execOption === 'HYBRID' && (!selfOceanChecked || mix.hasLcl) && fwdOcean > 0) ||
      (mix.hasLcl && fwdOcean > 0 && selfOceanBase === 0);
    const activeLocal = useFwdOceanLine ? 0 : fullLocalTotal;
    const activeOcean = useFwdOceanLine ? fwdOcean : schOcean;
    const activeSurcharge = useFwdOceanLine ? 0 : schSurcharge;

    const originCharges = activeTrucking + activeLocal + activeCustoms;
    const fobSell = Math.round((exwSell + originCharges) * 100) / 100;

    const freightF = activeOcean + activeSurcharge;
    const cfrSell = Math.round((fobSell + freightF) * 100) / 100;

    const defaultCifPct = toNum(insuranceCatalog.byCode['INS-ICC-C']?.standard_rate) || 0.12;
    const defaultCipPct = toNum(insuranceCatalog.byCode['INS-ICC-A']?.standard_rate) || 0.25;
    const defaultFrzPct = toNum(insuranceCatalog.byCode['INS-FRZ-A']?.standard_rate) || 0.35;
    const isColdCargo = mix.reefer > 0 || itemsState.some((it) => isReeferProduct(data.products.find((p) => p.sku_code === it.sku), it.name));
    const cifRatePct =
      recIncoterm === 'CIF' && selectedInsRatePct > 0
        ? selectedInsRatePct
        : isColdCargo
        ? defaultFrzPct
        : defaultCifPct;
    const cipRatePct =
      recIncoterm === 'CIP' && selectedInsRatePct > 0
        ? selectedInsRatePct
        : isColdCargo
        ? defaultFrzPct
        : defaultCipPct;
    const insCif = computeInsurancePremiumExact(cfrSell, cifRatePct);
    const insCip = computeInsurancePremiumExact(cfrSell, cipRatePct);
    const cifSell = Math.round((cfrSell + insCif) * 100) / 100;

    const isExw = recIncoterm === 'EXW';
    const isFobGroup = recIncoterm === 'FCA' || recIncoterm === 'FAS' || recIncoterm === 'FOB';
    const isCfrGroup = recIncoterm === 'CFR' || recIncoterm === 'CPT';
    const isCif = recIncoterm === 'CIF';
    const isCip = recIncoterm === 'CIP';
    const isDestGroup = recIncoterm === 'DAP' || recIncoterm === 'DPU' || recIncoterm === 'DDP';

    const effTrucking = isExw ? 0 : activeTrucking;
    const localTotal = isExw ? 0 : activeLocal;
    const customsTotal = isExw ? 0 : activeCustoms;
    const effOcean = !isExw && !isFobGroup && includeFreight ? activeOcean : 0;
    const effSurcharge = !isExw && !isFobGroup && includeFreight ? activeSurcharge : 0;
    const effDest = isDestGroup
      ? toNum(destExtra) + (recIncoterm === 'DDP' ? toNum(importDutyUsd) : 0)
      : 0;

    let effInsurance = 0;
    if (isCif && includeInsurance) {
      effInsurance = manualInsurance !== '' ? toNum(manualInsurance) : insCif;
    } else if (isCip && includeInsurance) {
      effInsurance = manualInsurance !== '' ? toNum(manualInsurance) : insCip;
    } else if (isDestGroup && includeInsurance) {
      const ratePct = selectedInsRatePct > 0 ? selectedInsRatePct : defaultCifPct;
      effInsurance = manualInsurance !== '' ? toNum(manualInsurance) : computeInsurancePremiumExact(cfrSell, ratePct);
    } else if (isExw || isFobGroup || isCfrGroup || !includeInsurance) {
      effInsurance = 0;
    }

    const totalFreightLocal = effTrucking + localTotal + customsTotal + effOcean + effSurcharge + effDest;
    const finalSelling = isExw
      ? exwSell
      : isFobGroup
      ? fobSell
      : Math.round((fobSell + effOcean + effSurcharge + effDest + effInsurance) * 100) / 100;

    const totalInputCost = Math.round(
      (goodsCost + effectivePackingCost + effTrucking + localTotal + customsTotal + effOcean + effSurcharge + effInsurance + effDest) * 100
    ) / 100;
    const marginUsd = Math.round((finalSelling - totalInputCost) * 100) / 100;

    const computedFloor = Math.round(
      (goodsAndPack * (1 + minMarginPct / 100) +
        (isExw ? 0 : originCharges) +
        effOcean +
        effSurcharge +
        effDest +
        effInsurance) *
        100
    ) / 100;
    const floorPrice = manualFloorPrice !== '' ? toNum(manualFloorPrice) : computedFloor;

    const internalCost = execOption === 'SELF' && selfTotal !== null ? selfTotal : execOption === 'HYBRID' ? hybridTotal : fwdAllTotal;
    const buyerCharge = Math.round(totalFreightLocal * 100) / 100;
    const internalProfit = Math.round((buyerCharge - internalCost) * 100) / 100;

    return {
      effTrucking,
      effOcean,
      effSurcharge,
      localTotal,
      customsTotal,
      effDest,
      totalFreightLocal,
      effInsurance,
      totalInputCost,
      marginUsd,
      finalSelling,
      floorPrice,
      computedFloor,
      exwSell,
      fobSell,
      cfrSell,
      cifSell,
      effSelfTruckVal,
      selfOceanTotal,
      selfTotal,
      hybridTotal,
      fwdAllTotal,
      internalCost,
      buyerCharge,
      internalProfit,
    };
  }, [
    goodsCost, effectivePackingCost, marginPct, selfTruckChecked, selfTruckRate, defaultTruckRate,
    fwdTruck, fullLocalTotal, customsSplit, schOceanRes, mix.hasLcl, mix.reefer, itemsState, data.products, fwdOcean,
    insuranceCatalog, recIncoterm, selectedInsRatePct, includeFreight, destExtra, importDutyUsd,
    includeInsurance, manualInsurance, minMarginPct, manualFloorPrice, fwdCustoms, fwdPermits,
    selfOceanChecked, selfCustomsChecked, selfPermitsChecked, execOption,
  ]);

  const applyIncotermToKhung4 = (code: string) => {
    setRecIncoterm(code);
    const rule = INCOTERMS_2020_MATRIX.find((r) => r.code === code);
    const isCold = mix.reefer > 0 || itemsState.some((it) => isReeferProduct(data.products.find((p) => p.sku_code === it.sku), it.name));
    if (rule) {
      setIncludeFreight(rule.includeFreight);
      setIncludeInsurance(rule.includeIns);
      setManualInsurance('');
      if (!rule.includeIns) {
        setInsBaseCode('INS-NONE');
        setInsAddons([]);
      } else {
        if (isCold && insuranceCatalog.byCode['INS-FRZ-A']) {
          setInsBaseCode('INS-FRZ-A');
          setInsAddons([]);
        } else if (code === 'CIP') {
          setInsBaseCode('INS-ICC-A');
          setInsAddons([]);
        } else {
          setInsBaseCode('INS-ICC-C');
          setInsAddons(insuranceCatalog.byCode['INS-EXT-SWH'] ? ['INS-EXT-SWH'] : []);
        }
      }
    }
  };

  const handleAskAi = async (autoApply: boolean) => {
    if (!selectedOrderId) {
      onToast('warning', 'Vui lòng chọn đơn hàng ở Khung 1 trước khi gọi AI.');
      return;
    }
    if (!autoApply && !aiQuestion.trim()) return;

    const userText = aiQuestion.trim() || `Phân tích đơn ${selectedOrderId} (${selectedCus?.consignee_name || ''} · ${countryFilter || '-'}) và đề xuất đồng thời Incoterms 2020 + gói Bảo hiểm tối ưu.`;
    const nextHistory = [...aiMessages, { role: 'user' as const, text: userText }];
    setAiMessages(nextHistory);
    if (!autoApply) setAiQuestion('');
    setAiLoading(true);

    try {
      const resp = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: selectedOrderId,
          question: aiQuestion.trim(),
          chatHistory: aiMessages.map((m) => ({ role: m.role, text: m.text })),
          insuranceRates: insuranceCatalog.all,
          incotermsHandbook: data.incoterms,
          orderContext: {
            Order_ID: selectedOrderId,
            Customer: selectedCus?.consignee_name || selectedInq?.consignee_id,
            Country: countryFilter || selectedCus?.country || '',
            POD: podFilter || activeSch?.pod || '',
            Container_Mix: mix.summaryStr,
            Items: itemsState.map((i) => `${i.name} (${i.weight} KG)`),
            Payment_Terms: selectedInq?.proposed_payment_term || '',
            Requested_Incoterm: selectedInq?.desired_incoterm || '',
            Goods_And_Packing_USD: Math.round((goodsCost + effectivePackingCost) * 100) / 100,
            Ocean_Freight_And_Surcharge_USD: Math.round((schOceanRes.ocean + schOceanRes.surcharge) * 100) / 100,
          },
        }),
      });
      const json = await resp.json();
      if (!resp.ok || json.success === false) {
        throw new Error(json.message || 'Không thể kết nối Gemini AI.');
      }
      const recTerms: string[] = Array.isArray(json.recommendedIncoterms) ? json.recommendedIncoterms.map((x: string) => x.toUpperCase()) : [];
      const best = String(json.bestIncoterm || recTerms[0] || '').toUpperCase();
      const recIns = String(json.recommendedInsuranceCode || '').toUpperCase();
      const recAddons: string[] = Array.isArray(json.recommendedInsuranceAddons) ? json.recommendedInsuranceAddons.map((x: string) => x.toUpperCase()) : [];

      if (best) setAiBestTerm(best);
      if (json.reason) setAiBestReason(json.reason);

      setAiMessages([
        ...nextHistory,
        {
          role: 'assistant',
          text: json.replyText || 'Đã hoàn tất phân tích.',
          recommendedIncoterms: recTerms,
          bestIncoterm: best,
          reason: json.reason,
          recommendedInsuranceCode: recIns,
          recommendedInsuranceAddons: recAddons,
          insuranceReason: json.insuranceReason,
        },
      ]);

      if (autoApply && recTerms.length > 0) {
        setProposedIncoterms(recTerms);
        if (best) applyIncotermToKhung4(best);
        if (recIns && (best === 'CIF' || best === 'CIP' || !best)) {
          setInsBaseCode(recIns);
          setInsAddons(recAddons);
        }
      }
    } catch (err: any) {
      onToast('error', err?.message || 'Lỗi gọi Gemini AI.');
    } finally {
      setAiLoading(false);
    }
  };

  // Khung 3 comparison rows (synchronized with Khung 4 exact Incoterms 2020 formulas)
  const comparisonRows = useMemo(() => {
    const iccCRate = toNum(insuranceCatalog.byCode['INS-ICC-C']?.standard_rate) || 0.08;
    const iccARate = toNum(insuranceCatalog.byCode['INS-ICC-A']?.standard_rate) || 0.25;
    const goodsPack = goodsCost + effectivePackingCost;
    const originFees = (selfTruckChecked ? costing.effSelfTruckVal : fwdTruck) + fullLocalTotal + customsSplit.customsTotal;
    const freightF = (schOceanRes.ocean + schOceanRes.surcharge) > 0
      ? (schOceanRes.ocean + schOceanRes.surcharge)
      : (mix.hasLcl && fwdOcean > 0 ? fwdOcean : 0);

    return INCOTERMS_2020_MATRIX.filter((r) => proposedIncoterms.includes(r.code)).map((row) => {
      const exwVal = Math.round(goodsPack * (1 + marginPct / 100) * 100) / 100;
      const localAndCustoms = row.includeLocal ? originFees : 0;
      const freight = row.includeFreight ? freightF : 0;
      const dest = row.includeDest ? toNum(destExtra) + (row.code === 'DDP' ? toNum(importDutyUsd) : 0) : 0;
      const appliedFees = Math.round((localAndCustoms + freight + dest) * 100) / 100;
      let ins = 0;
      let insLabel = '';
      if (row.code === 'CIF') {
        ins = computeInsurancePremiumExact(exwVal + localAndCustoms + freight, iccCRate);
        insLabel = `ICC C (${fmtDecimal(iccCRate, 2)}%)`;
      } else if (row.code === 'CIP') {
        ins = computeInsurancePremiumExact(exwVal + localAndCustoms + freight, iccARate);
        insLabel = `ICC A (${fmtDecimal(iccARate, 2)}%)`;
      }
      const total = Math.round((exwVal + appliedFees + ins) * 100) / 100;
      return { row, exwVal, appliedFees, ins, insLabel, total };
    });
  }, [
    proposedIncoterms, insuranceCatalog, goodsCost, effectivePackingCost, marginPct,
    selfTruckChecked, costing.effSelfTruckVal, fwdTruck, fullLocalTotal, customsSplit,
    schOceanRes, mix.hasLcl, fwdOcean, destExtra, importDutyUsd,
  ]);

  const optimalCode = useMemo(() => {
    if (aiBestTerm && proposedIncoterms.includes(aiBestTerm)) return aiBestTerm;
    if (proposedIncoterms.includes('CIP') && mix.reefer > 0) return 'CIP';
    if (proposedIncoterms.includes('CIF')) return 'CIF';
    return proposedIncoterms[0] || recIncoterm;
  }, [aiBestTerm, proposedIncoterms, mix.reefer, recIncoterm]);

  const handleSave = async () => {
    if (!selectedOrderId) {
      onToast('warning', 'Vui lòng chọn Mã đơn hàng ở Khung 1.');
      return;
    }
    if (mix.total <= 0 && !mix.hasLcl) {
      onToast('warning', 'Vui lòng nhập ít nhất 1 container hoặc hàng lẻ LCL.');
      return;
    }
    setSaving(true);
    try {
      const syncedProposed = proposedIncoterms.includes(recIncoterm) ? proposedIncoterms : [recIncoterm, ...proposedIncoterms];
      const proposal: PricingProposal = {
        order_id: selectedOrderId,
        xnk_rep: currentUser.full_name,
        schedule_id: selectedScheduleId,
        container_type: mix.summaryStr || (mix.hasLcl ? 'LCL (Forwarder)' : ''),
        container_qty: mix.total,
        total_freight_local: Math.round(costing.totalFreightLocal * 100) / 100,
        insurance_cost: Math.round(costing.effInsurance * 100) / 100,
        goods_cost: Math.round(goodsCost * 100) / 100,
        recommended_incoterm: recIncoterm,
        final_selling_price: Math.round(costing.finalSelling * 100) / 100,
        booking_date: todayIsoDate(),
        booking_status: WORKFLOW_STATUS.PRICED_READY,
        packing_pallet_cost: Math.round(effectivePackingCost * 100) / 100,
        insurance_code: insCombinedCode,
        total_cartons: palletPool.totalCartons,
        total_pallets: palletPool.totalPallets,
        pallet_fee: palletPool.palletFee,
        total_gross_weight: palletPool.totalGrossWeightKg,
        total_cbm: palletPool.totalCbm,
        proposed_incoterms: syncedProposed.join(', '),
      };
      const extraMeta: ProposalExtraMeta = {
        order_id: selectedOrderId,
        quotation_no: cleanQuoteNoForCustomer(
          proposalMetaMap[selectedOrderId]?.quotation_no || '',
          selectedOrderId
        ),
        floor_price_usd: Math.round(costing.floorPrice * 100) / 100,
        min_margin_pct: minMarginPct,
        margin_pct: marginPct,
        exw_price: costing.exwSell,
        fob_price: costing.fobSell,
        cfr_price: costing.cfrSell,
        cif_price: costing.cifSell,
        dest_extra: destExtra,
        import_duty_usd: importDutyUsd,
        freight_exec_option: execOption,
        self_trucking: costing.effSelfTruckVal,
        fwd_ocean: fwdOcean,
        fwd_trucking: fwdTruck,
        fwd_customs: fwdCustoms,
        fwd_permits: fwdPermits,
        internal_cost_usd: costing.internalCost,
        buyer_charge_usd: costing.buyerCharge,
        internal_profit_usd: costing.internalProfit,
        use_pallet: usePallet,
        lcl_basis: lclBasis,
        lcl_rate: lclRate,
        note: calcNote,
      };
      await onSaveProposal(proposal, extraMeta, JSON.stringify(itemsState));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* KHUNG 1: Order + Packing + 6 ISO Container Mix */}
      <div className="agri-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-extrabold text-[#fff5d6] flex items-center gap-2">
              <Calculator className="w-4 h-4 text-[#f4d98a]" /> Khung 1 · Hồ sơ Đơn hàng, Đóng gói &amp; Phân bổ 6 Loại Container (FCL / LCL)
            </h3>
            <p className="text-[11px] text-[#d2ebe0]">Tự động tối ưu &lt; 55% cont 20' sang LCL hoặc phân bổ tổ hợp 20'DC / 40'DC / 40'HC / 20'RF / 40'RF / 40'RH</p>
          </div>
          <div className="w-80">
            <SearchableCombo
              value={selectedOrderId}
              onChange={loadOrderIntoCalculator}
              options={orderOptions}
              allowCustom={false}
              placeholder="-- Chọn Mã đơn hàng (RFQ) --"
            />
          </div>
        </div>

        {selectedInq && (
          <div className="agri-card-inner p-4 space-y-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#186635]/30 pb-3">
              <div>
                <div className="font-extrabold text-sm text-[#07281c]">{selectedCus?.consignee_name || selectedInq.consignee_id}</div>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  {selectedCus?.country && <span className="px-2 py-0.5 rounded bg-[#0f4a33] text-[#fff5d6] font-bold">{selectedCus.country}</span>}
                  <span className="px-2 py-0.5 rounded bg-[#f4d98a] text-[#07281c] font-bold">
                    C/O gợi ý: {suggestCoFormCode('', selectedCus?.country)}
                  </span>
                  <span className="font-mono font-bold">Yêu cầu: {selectedInq.desired_incoterm} · {selectedInq.proposed_payment_term}</span>
                </div>
              </div>
              <div className="text-right font-mono">
                <div>Tổng Net: <strong className="text-sm">{fmtNumber(selectedInq.net_weight_kgs)} KG</strong></div>
                <div className="text-[11px]">Ghi chú: {stripItemsTag(selectedInq.note) || '-'}</div>
              </div>
            </div>

            {/* Tầng 1: Items Packing Breakdown */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border border-[#186635]/40 rounded-lg">
                <thead className="bg-[#547d59] text-[#fff5d6] text-[11px]">
                  <tr>
                    <th className="p-2 text-center">SKU</th>
                    <th className="p-2 text-left">Sản phẩm</th>
                    <th className="p-2 text-left min-w-[240px]">Quy cách đóng gói</th>
                    <th className="p-2 text-center">KL / Số thùng</th>
                    <th className="p-2 text-center">Giá vốn / Bao bì</th>
                    <th className="p-2 text-center">Thành tiền hàng</th>
                  </tr>
                </thead>
                <tbody>
                  {itemsState.map((it, idx) => {
                    const prod = data.products.find((p) => p.sku_code.toLowerCase() === it.sku.toLowerCase());
                    const unitCost = toNum(prod?.unit_price);
                    const packOpts = getPackingOptionsForProduct(prod, data.pricingRates, data.lookups);
                    const packComboOptions = packOpts.map((pk) => ({
                      value: pk.code,
                      label: `${pk.code} – ${pk.name}`,
                      subLabel: `+$${fmtDecimal(pk.perKgRate, 2)}/kg`,
                    }));
                    const calc = computeItemPackingAndPallet(it.weight, it.packingCode, it.packingExtra, data.pricingRates);
                    return (
                      <tr key={idx} className="border-t border-[#186635]/30 bg-white/60">
                        <td className="p-2 text-center font-mono font-bold">{it.sku}</td>
                        <td className="p-2 text-left font-semibold">{it.name}</td>
                        <td className="p-2 text-left">
                          <SearchableCombo
                            value={it.packingCode}
                            options={packComboOptions}
                            allowCustom={false}
                            placeholder="Chọn quy cách đóng gói..."
                            onChange={(code) => {
                              const spec = resolvePackingSpec(code, data.pricingRates);
                              setItemsState((prev) => prev.map((r, i) => (i === idx ? { ...r, packingCode: code, packingName: spec.nameVie, packingExtra: spec.rate } : r)));
                              setPackingManualCost('');
                            }}
                          />
                        </td>
                        <td className="p-2 text-center font-mono">{fmtNumber(it.weight)} KG · {fmtNumber(calc.cartons)} th</td>
                        <td className="p-2 text-center font-mono">{fmtUSD(unitCost)} · BB: {fmtUSD(calc.packingCost)}</td>
                        <td className="p-2 text-center font-mono font-bold">{fmtUSD(it.weight * unitCost)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Tầng 2: Pallet Pool + 6 Containers */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center bg-white/50 p-3 rounded-xl border border-[#186635]/40">
              <div className="lg:col-span-5 space-y-2">
                <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
                  <input type="checkbox" checked={usePallet} onChange={(e) => { setUsePallet(e.target.checked); setPackingManualCost(''); }} className="accent-[#0f4a33]" />
                  <span>Đóng Pallet gỗ ISPM-15 (18 kg · 0.17 CBM/pallet)</span>
                </label>
                <div className="flex flex-wrap gap-3 text-[11px] font-mono">
                  <span>Thùng: <strong>{fmtNumber(palletPool.totalCartons)}</strong></span>
                  <span>Pallet: <strong>{fmtNumber(palletPool.totalPallets)}</strong></span>
                  <span>GW: <strong>{fmtDecimal(palletPool.totalGrossWeightKg, 2)} KG</strong></span>
                  <span>CBM: <strong>{fmtDecimal(palletPool.totalCbm, 3)}</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px]">Phí/Pallet ($):</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="VD: 18.00"
                    value={palletRate}
                    onChange={(e) => { setPalletRate(e.target.value); setPackingManualCost(''); }}
                    className="w-20 px-2 py-0.5 rounded border border-[#186635] font-mono"
                  />
                  <span className="text-[11px]">Tổng Bao bì &amp; Pallet ($):</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder={fmtDecimal(palletPool.totalPackingPalletCost, 2)}
                    value={packingManualCost !== '' ? packingManualCost : fmtDecimal(palletPool.totalPackingPalletCost, 2)}
                    onChange={(e) => setPackingManualCost(e.target.value)}
                    className="w-24 px-2 py-0.5 rounded border border-[#186635] font-mono font-bold"
                  />
                </div>
              </div>

              <div className="lg:col-span-7 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-[#07281c]">Phân bổ 6 Loại Container ISO</span>
                  <button
                    type="button"
                    onClick={() => {
                      const opt = solveOptimalContainerMix(itemsState, usePallet, data.products, data.pricingRates);
                      setQ20dc(opt.qty20DC); setQ40dc(opt.qty40DC); setQ40hc(opt.qty40HC);
                      setQ20rf(opt.qty20RF); setQ40rf(opt.qty40RF); setQ40rh(opt.qty40RH);
                      onToast('info', 'Đã tính lại tổ hợp Container tối ưu (<55% cont 20\' -> LCL).');
                    }}
                    className="px-2.5 py-1 rounded bg-[#0f4a33] text-[#f4d98a] font-bold text-[11px] cursor-pointer"
                  >
                    Tối ưu tự động
                  </button>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {[
                    ["20'DC", q20dc, setQ20dc],
                    ["40'DC", q40dc, setQ40dc],
                    ["40'HC", q40hc, setQ40hc],
                    ["20'RF", q20rf, setQ20rf],
                    ["40'RF", q40rf, setQ40rf],
                    ["40'RH", q40rh, setQ40rh],
                  ].map(([lbl, val, setter]) => (
                    <div key={lbl as string} className="bg-[#d7eee4] p-1.5 rounded-lg border border-[#186635] text-center">
                      <div className="text-[10px] font-extrabold text-[#0f4a33]">{lbl as string}</div>
                      <input
                        type="number"
                        min={0}
                        value={val as number}
                        onChange={(e) => (setter as React.Dispatch<React.SetStateAction<number>>)(Math.max(0, Math.floor(toNum(e.target.value))))}
                        className="w-full text-center font-mono font-extrabold text-sm bg-transparent outline-none"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="px-2 py-0.5 rounded bg-[#0f4a33] text-[#f4d98a] font-bold">
                    {mix.summaryStr || 'Chưa phân bổ container'}
                  </span>
                  {mix.hasLcl && (
                    <div className="flex flex-wrap items-center gap-2 bg-[#f4d98a] text-[#07281c] px-2.5 py-1 rounded-lg font-bold">
                      <span>LCL (&lt;55% cont 20'): {fmtDecimal(mix.lclCbm, 2)} CBM · {fmtDecimal(mix.lclWeightKg / 1000, 2)} Tấn · W/M: {fmtDecimal(mix.lclWm, 2)}</span>
                      <select value={lclBasis} onChange={(e) => setLclBasis(e.target.value as 'WM' | 'CBM' | 'TON')} className="px-1.5 py-0.5 rounded bg-white">
                        <option value="WM">Theo W/M (max Tấn, CBM)</option>
                        <option value="CBM">Theo CBM</option>
                        <option value="TON">Theo Tấn</option>
                      </select>
                      <input type="text" inputMode="decimal" placeholder="VD: 65.00" value={lclRateStr} onChange={(e) => setLclRateStr(e.target.value)} className="w-16 px-1 rounded bg-white font-mono" />
                      <span>$/đv</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* KHUNG 2: Route & Shipping Schedule Comparator */}
      <div className="agri-card p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-extrabold text-[#fff5d6] flex items-center gap-2">
            <Ship className="w-4 h-4 text-[#f4d98a]" /> Khung 2 · So sánh &amp; Chọn Lịch Tàu ({selectedScheduleId || 'Chưa chọn'})
          </h3>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <div className="w-44">
              <SearchableCombo
                value={countryFilter}
                onChange={(nextCountry) => {
                  setCountryFilter(nextCountry);
                  if (podFilter && nextCountry) {
                    const stillValid = data.schedules.some(
                      (s) =>
                        s.country.trim().toLowerCase() === nextCountry.trim().toLowerCase() &&
                        deduplicatePortName(s.pod).toLowerCase() === deduplicatePortName(podFilter).toLowerCase()
                    );
                    if (!stillValid) setPodFilter('');
                  }
                }}
                options={countryOptions}
                placeholder="Lọc Quốc gia..."
              />
            </div>
            <div className="w-52">
              <SearchableCombo
                value={podFilter}
                onChange={setPodFilter}
                options={podOptions}
                placeholder="Lọc Cảng đến (POD)..."
              />
            </div>
          </div>
        </div>
        <div className="agri-table-wrap">
          <div
            className="agri-table-scroll"
            style={{ maxHeight: '280px', overflowY: 'auto' }}
          >
            <table className="agri-table">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="text-center">Chọn</th>
                  <th className="text-center">Mã lịch</th>
                  <th className="text-left">Hãng tàu</th>
                  <th className="text-left">Tuyến (POL → POD)</th>
                  <th className="text-center">ETD / ETA</th>
                  <th className="text-center">Cước biển (USD)</th>
                  <th className="text-center">Phụ phí tàu (USD)</th>
                </tr>
              </thead>
              <tbody>
                {scheduleEvaluations.evals.map((ev) => {
                  const sid = ev.s.schedule_id;
                  const active = selectedScheduleId === sid;
                  return (
                    <tr
                      key={sid}
                      onClick={() => setSelectedScheduleId(active ? '' : sid)}
                      className={`cursor-pointer ${active ? '!bg-[#2d583f] !text-white' : ''}`}
                    >
                      <td className="text-center"><input type="radio" checked={active} readOnly className="accent-[#0f4a33]" /></td>
                      <td className="text-center font-mono font-bold whitespace-nowrap">{sid}</td>
                      <td className="text-left">
                        <div className="font-bold">{ev.s.shipping_line}</div>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {ev.isTooTight && <span className="keep-badge-color px-1.5 py-0.5 rounded bg-[#8c3b3b] text-white text-[10px]">Sát ngày (&lt;{ev.leadDays}d)</span>}
                          {!ev.isTooTight && sid === scheduleEvaluations.optimalId && <span className="keep-badge-color px-1.5 py-0.5 rounded bg-[#f4d98a] text-[#07281c] text-[10px] font-bold">★ Tối ưu</span>}
                          {!ev.isTooTight && sid === scheduleEvaluations.cheapestId && <span className="keep-badge-color px-1.5 py-0.5 rounded bg-[#0f4a33] text-white text-[10px]">Cước thấp nhất</span>}
                          {!ev.isTooTight && sid === scheduleEvaluations.fastestId && <span className="keep-badge-color px-1.5 py-0.5 rounded bg-[#16977f] text-white text-[10px]">Nhanh nhất ({ev.transitDays}d)</span>}
                          {ev.hasMissing && <span className="keep-badge-color px-1.5 py-0.5 rounded bg-[#8c3b3b] text-white text-[10px]">Thiếu giá: {ev.res.missing.join(', ')}</span>}
                        </div>
                      </td>
                      <td className="text-left">
                        {deduplicatePortName(ev.s.pol)} → {deduplicatePortName(ev.s.pod)}
                      </td>
                      <td className="text-center font-mono text-xs whitespace-nowrap">
                        <div>ETD: {formatDateDDMMYYYY(ev.s.etd)}</div>
                        <div>ETA: {formatDateDDMMYYYY(ev.s.eta)}</div>
                      </td>
                      <td className="text-center font-mono font-bold whitespace-nowrap">{fmtUSD(ev.res.ocean)}</td>
                      <td className="text-center font-mono whitespace-nowrap">{fmtUSD(ev.res.surcharge)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Gemini AI Advisor + Incoterms 3-Criteria Filter + Khung 3 */}
      <div className="agri-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-extrabold text-[#fff5d6] flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#f4d98a]" /> Trợ lý AI Gemini (Incoterms 2020 &amp; Bảo hiểm) + Khung 3 So sánh ĐK
          </h3>
          <button type="button" disabled={aiLoading} onClick={() => handleAskAi(true)} className="agri-btn-gold flex items-center gap-1.5">
            <Sparkles className="w-4 h-4" />
            <span>{aiLoading ? 'Loading...' : 'Phân tích đơn hàng bằng AI'}</span>
          </button>
        </div>

        {/* AI Chat Box */}
        <div className="bg-[#07281c] border border-[#186635] rounded-xl p-3 space-y-2.5">
          <div className="max-h-52 overflow-y-auto space-y-2 text-xs">
            {aiMessages.length === 0 ? (
              <div className="text-[#9bccb8] italic text-center py-2">
                Chọn đơn hàng rồi bấm "Phân tích đơn hàng bằng AI" để Gemini đề xuất cặp Incoterms 2020 + Bảo hiểm hàng hóa tối ưu.
              </div>
            ) : (
              aiMessages.map((m, idx) => (
                <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[90%] p-2.5 rounded-xl ${m.role === 'user' ? 'bg-[#16977f] text-white' : 'bg-[#aed6c6] text-[#07281c]'}`}>
                    <div className="whitespace-pre-line">{m.text}</div>
                    {m.role === 'assistant' && m.recommendedIncoterms && m.recommendedIncoterms.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-[#186635]/30 flex flex-wrap items-center gap-1.5">
                        {m.recommendedIncoterms.map((c) => (
                          <span key={c} className={`px-2 py-0.5 rounded font-mono font-bold text-[11px] ${c === m.bestIncoterm ? 'bg-[#f4d98a] text-[#07281c]' : 'bg-[#0f4a33] text-white'}`}>
                            {c === m.bestIncoterm ? `★ ${c}` : c}
                          </span>
                        ))}
                        {m.recommendedInsuranceCode && (
                          <span className="px-2 py-0.5 rounded bg-[#0f4a33] text-[#f4d98a] font-mono font-bold text-[11px]">
                            BH: {m.recommendedInsuranceCode}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <input
              value={aiQuestion}
              onChange={(e) => setAiQuestion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAskAi(false)}
              placeholder="Hỏi thêm Trợ lý AI về điều kiện giao hàng hoặc rủi ro bảo hiểm..."
              className="agri-input text-xs flex-1"
            />
            <button type="button" disabled={aiLoading} onClick={() => handleAskAi(false)} className="agri-btn-primary px-3 flex items-center gap-1">
              <Send className="w-3.5 h-3.5" /> Hỏi AI
            </button>
          </div>
        </div>

        {/* 11 Incoterms 2020 Checkboxes (Single Horizontal Row) */}
        <div className="agri-card-inner p-3.5 space-y-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-extrabold text-[#07281c] uppercase text-[11px]">
              Chọn Điều kiện Incoterms 2020 cần tính / so sánh
            </span>
            {aiBestTerm && (
              <span className="px-2 py-0.5 rounded bg-[#0f4a33] text-[#f4d98a] font-mono font-bold text-[11px]">
                ★ AI Khuyến nghị: {aiBestTerm}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {INCOTERMS_2020_MATRIX.map((r) => {
              const checked = proposedIncoterms.includes(r.code);
              return (
                <label
                  key={r.code}
                  title={`${r.code} — ${r.fullName}`}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border-[1.5px] font-mono font-bold cursor-pointer ${
                    checked ? 'bg-[#0f4a33] border-[#f4d98a] text-[#fff5d6]' : 'bg-[#d7eee4] border-[#186635] text-[#07281c]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const next = checked
                        ? proposedIncoterms.filter((x) => x !== r.code)
                        : [...proposedIncoterms, r.code];
                      setProposedIncoterms(next.length > 0 ? next : [r.code]);
                    }}
                    className="accent-[#f4d98a]"
                  />
                  <span>{r.code}</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Khung 3 Multi-Incoterm Comparison Table (when >=2 selected) */}
        {comparisonRows.length >= 2 && (
          <div className="agri-table-wrap">
            <div className="px-4 py-2.5 bg-[#0f4a33] border-b border-[#186635] flex items-center justify-between text-xs">
              <span className="font-extrabold text-[#fff5d6]">
                Khung 3 · So sánh {comparisonRows.length} Điều kiện Incoterms ({aiBestReason || `Đề xuất tối ưu: ${optimalCode}`})
              </span>
            </div>
            <div className="agri-table-scroll">
              <table className="agri-table">
                <thead>
                  <tr>
                    <th className="text-center">ĐK</th>
                    <th className="text-left">Cước chính</th>
                    <th className="text-left">Bảo hiểm</th>
                    <th className="text-left">Điểm chuyển rủi ro</th>
                    <th className="text-center">Giá EXW (USD)</th>
                    <th className="text-center">Phí áp dụng (USD)</th>
                    <th className="text-center">Bảo hiểm (USD)</th>
                    <th className="text-center">Giá chào dự kiến (USD)</th>
                    <th className="text-center">Áp dụng K4</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonRows.map((item) => {
                    const isOpt = item.row.code === optimalCode;
                    const isCur = item.row.code === recIncoterm;
                    return (
                      <tr key={item.row.code} className={isOpt ? '!bg-[#f4d98a]/40' : ''}>
                        <td className="text-center font-mono font-bold">{item.row.code} {isOpt && '★'}</td>
                        <td className="text-left">{item.row.freightLabel}</td>
                        <td className="text-left">{item.row.insLabel}</td>
                        <td className="text-left">{item.row.riskLabel}</td>
                        <td className="text-center font-mono">{fmtUSD(item.exwVal)}</td>
                        <td className="text-center font-mono">{fmtUSD(item.appliedFees)}</td>
                        <td className="text-center font-mono">{fmtUSD(item.ins)} {item.insLabel && <div className="text-[10px]">{item.insLabel}</div>}</td>
                        <td className="text-center font-mono font-extrabold">{fmtUSD(item.total)}</td>
                        <td className="text-center">
                          <button
                            type="button"
                            onClick={() => applyIncotermToKhung4(item.row.code)}
                            className={`keep-btn-style px-2.5 py-1 rounded text-[11px] font-bold cursor-pointer ${isCur ? 'bg-[#0f4a33] text-[#f4d98a]' : 'bg-[#d7eee4] text-[#07281c] border border-[#186635]'}`}
                          >
                            {isCur ? 'Đang chọn' : 'Áp dụng'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* KHUNG 4: Final Costing + Insurance Formula + 2-Way Self vs FWD Matrix */}
      <div className="agri-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-extrabold text-[#fff5d6] flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#f4d98a]" /> Khung 4 · Chốt Giá Bán, Bảo hiểm &amp; So sánh Nội bộ Tự làm vs Forwarder
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {proposedIncoterms.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => applyIncotermToKhung4(c)}
                className={`px-2.5 py-1 rounded-md font-mono text-xs font-extrabold cursor-pointer ${
                  recIncoterm === c ? 'bg-[#f4d98a] text-[#07281c]' : 'bg-[#07281c] text-[#fff5d6] border border-[#186635]'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs">
          <div className="lg:col-span-7 agri-card-inner p-4 space-y-3">
            {/* Compact Margin / Floor Inputs (+ Conditional Group D Destination / Duty Inputs) */}
            <div className={`grid gap-2.5 items-end ${
              recIncoterm === 'DDP'
                ? 'grid-cols-2 sm:grid-cols-5'
                : ['DAP', 'DPU'].includes(recIncoterm)
                ? 'grid-cols-2 sm:grid-cols-4'
                : 'grid-cols-3'
            }`}>
              <div className="flex flex-col justify-end h-full">
                <label className="text-[11px] leading-tight font-bold mb-1.5 min-h-[26px] flex items-end">
                  Biên LN mục tiêu (%)
                </label>
                <input type="text" inputMode="decimal" placeholder="VD: 12" value={marginPctStr} onChange={(e) => setMarginPctStr(e.target.value)} className="agri-input font-mono font-bold" />
              </div>
              <div className="flex flex-col justify-end h-full">
                <label className="text-[11px] leading-tight font-bold mb-1.5 min-h-[26px] flex items-end">
                  Biên LN sàn (%)
                </label>
                <input type="text" inputMode="decimal" placeholder="VD: 5" value={minMarginPctStr} onChange={(e) => setMinMarginPctStr(e.target.value)} className="agri-input font-mono" />
              </div>
              <div className="flex flex-col justify-end h-full">
                <label className="text-[11px] leading-tight font-bold mb-1.5 min-h-[26px] flex items-end">
                  Giá Sàn Floor ($)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder={fmtDecimal(costing.computedFloor, 2)}
                  value={manualFloorPrice !== '' ? manualFloorPrice : fmtDecimal(costing.computedFloor, 2)}
                  onChange={(e) => setManualFloorPrice(e.target.value)}
                  className="agri-input font-mono font-bold"
                />
              </div>
              {['DAP', 'DPU', 'DDP'].includes(recIncoterm) && (
                <div className="flex flex-col justify-end h-full">
                  <label className="text-[11px] leading-tight font-bold mb-1.5 min-h-[26px] flex items-end">
                    {recIncoterm === 'DPU' ? 'Phí Đích & Dỡ hàng (DPU $)' : `Phí Đích (${recIncoterm} $)`}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="VD: 450.00"
                    value={destExtraStr}
                    onChange={(e) => setDestExtraStr(e.target.value)}
                    className="agri-input font-mono"
                  />
                </div>
              )}
              {recIncoterm === 'DDP' && (
                <div className="flex flex-col justify-end h-full">
                  <label className="text-[11px] leading-tight font-bold mb-1.5 min-h-[26px] flex items-end">
                    Thuế NK (DDP $)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="VD: 320.00"
                    value={importDutyStr}
                    onChange={(e) => setImportDutyStr(e.target.value)}
                    className="agri-input font-mono"
                  />
                </div>
              )}
            </div>

            {/* 2-Row Insurance Selector + Extension Checkboxes */}
            <div className="p-3 rounded-xl bg-white/60 border border-[#186635]/40 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-extrabold text-[#07281c] flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[#0f4a33]" /> Bảo hiểm 110% · V = (C+F)×1.1 / (1-R) · R = {fmtDecimal(selectedInsRatePct, 2)}%
                </span>
                <label className="inline-flex items-center gap-1.5 font-bold cursor-pointer">
                  <input type="checkbox" checked={includeInsurance} onChange={(e) => setIncludeInsurance(e.target.checked)} className="accent-[#0f4a33]" />
                  <span>Tính vào giá bán</span>
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="sm:col-span-2">
                  <SearchableCombo
                    value={insBaseCode}
                    onChange={(code) => {
                      setInsBaseCode(code);
                      setManualInsurance('');
                      setIncludeInsurance(code !== 'INS-NONE');
                    }}
                    options={insuranceBaseOptions}
                    allowCustom={false}
                    placeholder="Chọn gói Bảo hiểm..."
                  />
                </div>
                <div>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder={fmtDecimal(costing.effInsurance, 2)}
                    value={manualInsurance !== '' ? manualInsurance : fmtDecimal(costing.effInsurance, 2)}
                    onChange={(e) => setManualInsurance(e.target.value)}
                    className="agri-input font-mono font-bold"
                    title="Phí bảo hiểm thực tế (USD)"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {insuranceCatalog.addons.map((a) => {
                  const checked = insAddons.includes(a.fee_code);
                  return (
                    <label key={a.fee_code} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] cursor-pointer ${insBaseCode === 'INS-NONE' ? 'opacity-50' : ''} ${checked ? 'bg-[#0f4a33] text-[#fff5d6] border-[#186635]' : 'bg-[#d7eee4] border-[#186635]'}`}>
                      <input
                        type="checkbox"
                        disabled={insBaseCode === 'INS-NONE'}
                        checked={checked}
                        onChange={() => {
                          setManualInsurance('');
                          setInsAddons((prev) => (checked ? prev.filter((x) => x !== a.fee_code) : [...prev, a.fee_code]));
                        }}
                      />
                      <span className="font-mono font-bold">{a.fee_code}</span> (+{fmtDecimal(a.standard_rate, 2)}%)
                    </label>
                  );
                })}
              </div>
              {insClauseEng && <div className="text-[11px] text-[#0f4a33] font-semibold">Điều khoản HĐ: {insClauseEng}</div>}
            </div>

            {/* Conditional Self vs FWD Comparison (Hidden by default for FCL with toggle; auto-expanded for LCL) */}
            <div className="p-3 rounded-xl bg-white/60 border border-[#186635]/40 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-[#07281c]">
                    So sánh Tự làm vs. Forwarder
                  </span>
                  <span className="px-2 py-0.5 rounded bg-[#0f4a33] text-[#f4d98a] font-bold text-[10.5px]">
                    {execOption === 'SELF'
                      ? '1. Tự làm 100%'
                      : execOption === 'HYBRID'
                      ? '2. Kết hợp tối ưu'
                      : '3. FWD trọn gói'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFwdCompare((v) => !v)}
                  className="px-2.5 py-1 rounded-lg bg-[#0f4a33] text-[#f4d98a] text-[11px] font-bold cursor-pointer hover:bg-[#07281c]"
                >
                  {showFwdCompare ? 'Ẩn bảng so sánh FWD' : 'Mở bảng so sánh FWD'}
                </button>
              </div>

              {showFwdCompare && (
                <div className="space-y-2.5 pt-1">
                  <table className="w-full text-xs border border-[#186635]/40">
                    <thead className="bg-[#547d59] text-[#fff5d6]">
                      <tr>
                        <th className="p-1.5 text-left">Hạng mục</th>
                        <th className="p-1.5 text-center">Công ty Tự làm</th>
                        <th className="p-1.5 text-center">Phí Tự làm (USD)</th>
                        <th className="p-1.5 text-center">Thuê ngoài FWD (USD)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-[#186635]/30">
                        <td className="p-1.5 text-left font-semibold">1. Cước biển &amp; Local/CFS</td>
                        <td className="p-1.5 text-center">
                          <input
                            type="checkbox"
                            disabled={mix.hasLcl}
                            checked={selfOceanChecked && !mix.hasLcl}
                            onChange={(e) => {
                              setSelfOceanChecked(e.target.checked);
                              setExecOption('HYBRID');
                            }}
                          />
                        </td>
                        <td className="p-1.5 text-center font-mono font-semibold">
                          {mix.hasLcl ? 'LCL→FWD' : fmtUSD(costing.selfOceanTotal || 0)}
                        </td>
                        <td className="p-1.5 text-center">
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="VD: 1,200.00"
                            value={fwdOceanStr}
                            onChange={(e) => setFwdOceanStr(e.target.value)}
                            className="w-24 px-1.5 py-0.5 rounded border border-[#186635] text-center font-mono"
                          />
                        </td>
                      </tr>
                      <tr className="border-t border-[#186635]/30">
                        <td className="p-1.5 text-left font-semibold">2. Trucking nội địa</td>
                        <td className="p-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={selfTruckChecked}
                            onChange={(e) => {
                              setSelfTruckChecked(e.target.checked);
                              setExecOption('HYBRID');
                              if (e.target.checked && selfTruckRate === 0 && defaultTruckRate > 0) {
                                setSelfTruckRateStr(fmtDecimal(defaultTruckRate, 2));
                              }
                            }}
                          />
                        </td>
                        <td className="p-1.5 text-center">
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder={defaultTruckRate > 0 ? fmtDecimal(defaultTruckRate, 2) : 'VD: 180.00'}
                            value={selfTruckRateStr !== '' ? selfTruckRateStr : (defaultTruckRate > 0 ? fmtDecimal(defaultTruckRate, 2) : '')}
                            onChange={(e) => setSelfTruckRateStr(e.target.value)}
                            className="w-24 px-1.5 py-0.5 rounded border border-[#186635] text-center font-mono"
                          />
                        </td>
                        <td className="p-1.5 text-center">
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="VD: 200.00"
                            value={fwdTruckStr}
                            onChange={(e) => setFwdTruckStr(e.target.value)}
                            className="w-24 px-1.5 py-0.5 rounded border border-[#186635] text-center font-mono"
                          />
                        </td>
                      </tr>
                      <tr className="border-t border-[#186635]/30">
                        <td className="p-1.5 text-left font-semibold">3. Hải quan Xuất khẩu</td>
                        <td className="p-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={selfCustomsChecked}
                            onChange={(e) => {
                              setSelfCustomsChecked(e.target.checked);
                              setExecOption('HYBRID');
                            }}
                          />
                        </td>
                        <td className="p-1.5 text-center font-mono font-semibold">{fmtUSD(customsSplit.customsExportUsd)}</td>
                        <td className="p-1.5 text-center">
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="VD: 120.00"
                            value={fwdCustomsStr}
                            onChange={(e) => setFwdCustomsStr(e.target.value)}
                            className="w-24 px-1.5 py-0.5 rounded border border-[#186635] text-center font-mono"
                          />
                        </td>
                      </tr>
                      <tr className="border-t border-[#186635]/30">
                        <td className="p-1.5 text-left font-semibold">4. Giấy phép (Kiểm dịch/C/O/Hun trùng)</td>
                        <td className="p-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={selfPermitsChecked}
                            onChange={(e) => {
                              setSelfPermitsChecked(e.target.checked);
                              setExecOption('HYBRID');
                            }}
                          />
                        </td>
                        <td className="p-1.5 text-center font-mono font-semibold">{fmtUSD(customsSplit.permitsUsd)}</td>
                        <td className="p-1.5 text-center">
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="VD: 150.00"
                            value={fwdPermitsStr}
                            onChange={(e) => setFwdPermitsStr(e.target.value)}
                            className="w-24 px-1.5 py-0.5 rounded border border-[#186635] text-center font-mono"
                          />
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {/* 3 Distinct Option Cards with Real Totals */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button
                      type="button"
                      disabled={mix.hasLcl}
                      onClick={() => {
                        setExecOption('SELF');
                        setSelfOceanChecked(true);
                        setSelfTruckChecked(true);
                        setSelfCustomsChecked(true);
                        setSelfPermitsChecked(true);
                      }}
                      className={`p-2 rounded-lg border text-left transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                        execOption === 'SELF' && !mix.hasLcl
                          ? 'bg-[#0f4a33] text-[#fff5d6] border-[#f4d98a]'
                          : 'bg-[#d7eee4] text-[#07281c] border-[#186635]/50'
                      }`}
                    >
                      <div className="text-[10.5px] font-extrabold">1. Tự làm 100%</div>
                      <div className="font-mono font-black text-xs mt-0.5">
                        {mix.hasLcl ? 'LCL → Thuê FWD' : fmtUSD(costing.selfTotal || 0)}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setExecOption('HYBRID')}
                      className={`p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                        execOption === 'HYBRID'
                          ? 'bg-[#0f4a33] text-[#fff5d6] border-[#f4d98a]'
                          : 'bg-[#d7eee4] text-[#07281c] border-[#186635]/50'
                      }`}
                    >
                      <div className="text-[10.5px] font-extrabold">2. Kết hợp tối ưu</div>
                      <div className="font-mono font-black text-xs mt-0.5">{fmtUSD(costing.hybridTotal)}</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setExecOption('FWD_ALL');
                        setSelfOceanChecked(false);
                        setSelfTruckChecked(false);
                        setSelfCustomsChecked(false);
                        setSelfPermitsChecked(false);
                      }}
                      className={`p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                        execOption === 'FWD_ALL'
                          ? 'bg-[#0f4a33] text-[#fff5d6] border-[#f4d98a]'
                          : 'bg-[#d7eee4] text-[#07281c] border-[#186635]/50'
                      }`}
                    >
                      <div className="text-[10.5px] font-extrabold">3. FWD trọn gói</div>
                      <div className="font-mono font-black text-xs mt-0.5">{fmtUSD(costing.fwdAllTotal)}</div>
                    </button>
                  </div>
                  <div className="text-[11px] font-mono font-bold text-[#07281c] flex justify-between">
                    <span>Chi phí Logistics nội bộ: {fmtUSD(costing.internalCost)}</span>
                    <span>Chênh lệch cước: {fmtUSD(costing.internalProfit)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: TỔNG HỢP CẤU TRÚC GIÁ NỘI BỘ (USD) (Exact Cent Reconciliation) */}
          <div className="lg:col-span-5 dash-xnk-dark p-4 flex flex-col justify-between space-y-3">
            <div className="space-y-1.5 text-xs">
              <div className="text-[11px] font-extrabold uppercase text-[#f4d98a] tracking-wide mb-2">
                TỔNG HỢP CẤU TRÚC GIÁ NỘI BỘ (USD) · {recIncoterm}
              </div>
              <div className="flex justify-between">
                <span>1. Giá vốn hàng hóa:</span>
                <span className="font-mono font-bold">{fmtUSD(goodsCost)}</span>
              </div>
              <div className="flex justify-between">
                <span>2. Bao bì &amp; Pallet:</span>
                <span className="font-mono font-bold">{fmtUSD(effectivePackingCost)}</span>
              </div>
              <div className="flex justify-between">
                <span>3. Logistics đầu xuất (Truck + Local + HQ/C/O):</span>
                <span className="font-mono">{fmtUSD(costing.effTrucking + costing.localTotal + costing.customsTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>4. Cước vận tải quốc tế (Ocean + Phụ phí):</span>
                <span className="font-mono">{fmtUSD(costing.effOcean + costing.effSurcharge)}</span>
              </div>
              <div className="flex justify-between">
                <span>5. Phí bảo hiểm 110%:</span>
                <span className="font-mono">{fmtUSD(costing.effInsurance)}</span>
              </div>
              {['DAP', 'DPU', 'DDP'].includes(recIncoterm) && (
                <div className="flex justify-between">
                  <span>6. Phí đích &amp; Thuế NK ({recIncoterm}):</span>
                  <span className="font-mono">{fmtUSD(costing.effDest)}</span>
                </div>
              )}

              <div className="border-t border-white/20 pt-1.5 flex justify-between font-bold text-[#d2ebe0]">
                <span>= TỔNG CHI PHÍ ĐẦU VÀO (TOTAL COST):</span>
                <span className="font-mono">{fmtUSD(costing.totalInputCost)}</span>
              </div>
              <div className="flex justify-between text-[#9bccb8]">
                <span>+ Biên lợi nhuận mục tiêu ({fmtDecimal(marginPct, 1)}%):</span>
                <span className="font-mono font-bold text-[#f4d98a]">+{fmtUSD(costing.marginUsd)}</span>
              </div>

              <div className="border-t border-white/25 pt-2 flex justify-between text-base font-extrabold text-[#f4d98a]">
                <span>= GIÁ BÁN ĐỀ XUẤT (USD):</span>
                <span className="font-mono">{fmtUSD(costing.finalSelling)}</span>
              </div>
              <div className="flex justify-between text-[11px] text-[#9bccb8]">
                <span>Đơn giá bình quân ($/KG):</span>
                <span className="font-mono font-bold text-white">
                  {selectedInq && selectedInq.net_weight_kgs > 0
                    ? `$${fmtDecimal(costing.finalSelling / selectedInq.net_weight_kgs, 3)} / KG`
                    : '$0.000 / KG'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-1.5 text-center text-[10.5px] font-mono">
              <div className="p-1.5 rounded bg-white/10"><div className="text-[#9bccb8]">EXW</div><div className="font-bold">{fmtUSD(costing.exwSell)}</div></div>
              <div className="p-1.5 rounded bg-white/10"><div className="text-[#9bccb8]">FOB</div><div className="font-bold">{fmtUSD(costing.fobSell)}</div></div>
              <div className="p-1.5 rounded bg-white/10"><div className="text-[#9bccb8]">CFR</div><div className="font-bold">{fmtUSD(costing.cfrSell)}</div></div>
              <div className="p-1.5 rounded bg-white/10"><div className="text-[#9bccb8]">CIF</div><div className="font-bold">{fmtUSD(costing.cifSell)}</div></div>
            </div>

            <input
              value={calcNote}
              onChange={(e) => setCalcNote(e.target.value)}
              placeholder="Ghi chú phương án giá gửi Sales..."
              className="w-full px-3 py-1.5 rounded-lg bg-[#0b3324] border border-[#186635] text-xs text-white outline-none"
            />

            <button
              type="button"
              disabled={saving || !selectedOrderId}
              onClick={handleSave}
              className="w-full agri-btn-gold py-2.5 flex items-center justify-center gap-2 text-xs disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'Loading...' : 'Lưu & Gửi Báo giá cho Kinh doanh'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Saved Proposals Table */}
      <div className="agri-table-wrap">
        <div className="px-4 py-3 bg-[#0f4a33] border-b border-[#186635]">
          <h3 className="text-sm font-extrabold text-[#fff5d6]">Lịch sử Phương án Tính giá đã lập ({data.proposals.length})</h3>
        </div>
        <div className="agri-table-scroll">
          <table className="agri-table">
            <thead>
              <tr>
                <th className="text-center">Số Báo giá / Đơn</th>
                <th className="text-left">NV XNK</th>
                <th className="text-left">Tuyến / Container</th>
                <th className="text-center">Giá vốn (USD)</th>
                <th className="text-center">Cước + BB + BH (USD)</th>
                <th className="text-center">Incoterm</th>
                <th className="text-center">Giá chào chốt (USD)</th>
                <th className="text-center">Trạng thái &amp; Chứng từ</th>
              </tr>
            </thead>
            <tbody>
              {data.proposals.slice().reverse().map((p) => {
                const extra = proposalMetaMap[p.order_id];
                const inq = data.inquiries.find((i) => i.order_id === p.order_id);
                const cleanQuoteNo = cleanQuoteNoForCustomer(extra?.quotation_no || '', p.order_id);
                const sendCount =
                  typeof extra?.send_count === 'number' && extra.send_count > 0
                    ? extra.send_count
                    : inq?.sent_mail_link
                    ? 1
                    : 0;
                return (
                  <tr key={p.order_id}>
                    <td className="text-center">
                      <div className="font-mono font-bold">{cleanQuoteNo}</div>
                      <button type="button" onClick={() => onOpenTimeline(p.order_id)} className="font-mono text-[11px] hover:underline cursor-pointer">
                        {p.order_id}
                      </button>
                      {sendCount > 0 && (
                        <div className="mt-0.5">
                          <span className="keep-badge-color inline-block px-1.5 py-0.5 rounded-full bg-[#f4d98a] text-[#07281c] text-[10px] font-extrabold">
                            Lần {sendCount}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="text-left">
                      <div className="font-semibold">{p.xnk_rep}</div>
                      <div className="font-mono text-[11px] opacity-80">{p.booking_date}</div>
                    </td>
                    <td className="text-left">
                      <div className="font-mono font-bold">{p.schedule_id || '-'}</div>
                      <div className="text-[11px]">{p.container_type}</div>
                    </td>
                    <td className="text-center font-mono font-bold">{fmtUSD(p.goods_cost)}</td>
                    <td className="text-left font-mono text-[11px] whitespace-nowrap">
                      <div className="flex justify-between gap-2">
                        <span className="opacity-75">Cước:</span>
                        <span className="font-bold">{fmtUSD(p.total_freight_local)}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="opacity-75">BB:</span>
                        <span>{fmtUSD(p.packing_pallet_cost)}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="opacity-75">BH:</span>
                        <span>{fmtUSD(p.insurance_cost)}</span>
                      </div>
                    </td>
                    <td className="text-center font-mono font-bold">{p.recommended_incoterm}</td>
                    <td className="text-center font-mono font-extrabold">{fmtUSD(p.final_selling_price)}</td>
                    <td className="text-center space-y-1">
                      <div>
                        <span className="keep-badge-color inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold">
                          <Check className="w-3 h-3" /> {p.booking_status}
                        </span>
                      </div>
                      {onOpenPreview && (
                        <div className="inline-flex flex-wrap justify-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              onOpenPreview({
                                kind: 'QUOTATION',
                                orderId: p.order_id,
                                initialQuotationTemplate: 'INTERNAL_COSTING_SHEET',
                              })
                            }
                            className="keep-btn-style px-2 py-0.5 rounded bg-[#07281c] text-[#f4d98a] text-[10.5px] font-bold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Eye className="w-3 h-3" /> Nội bộ
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onOpenPreview({
                                kind: 'QUOTATION',
                                orderId: p.order_id,
                                initialQuotationTemplate: 'TMP_QUOTATION_01',
                              })
                            }
                            className="keep-btn-style px-2 py-0.5 rounded bg-[#f4d98a] text-[#07281c] text-[10.5px] font-extrabold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Eye className="w-3 h-3" /> Báo giá
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {data.proposals.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-8 opacity-75">
                    Chưa có phương án tính giá nào được lập.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
