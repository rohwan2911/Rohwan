import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, Send, Calculator, Check, Ship, Layers, ShieldCheck, Save } from 'lucide-react';
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
  computeCustomsSplit,
  computeInsurancePremiumExact,
  computeItemPackingAndPallet,
  computeLocalChargesForMix,
  computeOrderPalletSummary,
  computeScheduleOceanAndMissing,
  fmtNumber,
  fmtUSD,
  getInsuranceCatalog,
  getPackingOptionsForProduct,
  INCOTERMS_2020_MATRIX,
  isReeferProduct,
  isRepriceRequestedStatus,
  isWaitingPricingStatus,
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

interface XnkCostingViewProps {
  data: AppDataState;
  currentUser: SysUser;
  proposalMetaMap: Record<string, ProposalExtraMeta>;
  onSaveProposal: (proposal: PricingProposal, extraMeta: ProposalExtraMeta, updatedItemsJson: string) => Promise<void>;
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
  const [lclBasis, setLclBasis] = useState<'CBM' | 'TON'>('CBM');
  const [lclRate, setLclRate] = useState(65);

  // Route & Schedule
  const [countryFilter, setCountryFilter] = useState('');
  const [podFilter, setPodFilter] = useState('');
  const [selectedScheduleId, setSelectedScheduleId] = useState('');

  // Incoterms & 3-criteria Filter
  const [proposedIncoterms, setProposedIncoterms] = useState<string[]>(['CIF']);
  const [recIncoterm, setRecIncoterm] = useState('CIF');
  const [filterFreight, setFilterFreight] = useState('');
  const [filterIns, setFilterIns] = useState('');
  const [filterRisk, setFilterRisk] = useState('');

  // Gemini AI Advisor
  const [aiMessages, setAiMessages] = useState<AiChatMessage[]>([]);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiBestTerm, setAiBestTerm] = useState('');
  const [aiBestReason, setAiBestReason] = useState('');

  // Khung 4 Pricing & Insurance
  const [marginPct, setMarginPct] = useState(12);
  const [minMarginPct, setMinMarginPct] = useState(5);
  const [manualFloorPrice, setManualFloorPrice] = useState('');
  const [includeFreight, setIncludeFreight] = useState(true);
  const [includeInsurance, setIncludeInsurance] = useState(true);
  const [insBaseCode, setInsBaseCode] = useState('INS-ICC-A');
  const [insAddons, setInsAddons] = useState<string[]>([]);
  const [manualInsurance, setManualInsurance] = useState('');
  const [destExtra, setDestExtra] = useState(0);
  const [calcNote, setCalcNote] = useState('');

  // 2-Way Cross-Locked Self vs FWD Matrix
  const [showFwdCompare, setShowFwdCompare] = useState(false);
  const [execOption, setExecOption] = useState<'SELF' | 'HYBRID' | 'FWD_ALL'>('SELF');
  const [selfOceanChecked, setSelfOceanChecked] = useState(true);
  const [fwdOcean, setFwdOcean] = useState(0);
  const [selfTruckChecked, setSelfTruckChecked] = useState(false);
  const [selfTruckRate, setSelfTruckRate] = useState(0);
  const [fwdTruck, setFwdTruck] = useState(0);
  const [selfCustomsChecked, setSelfCustomsChecked] = useState(true);
  const [fwdCustoms, setFwdCustoms] = useState(0);
  const [selfPermitsChecked, setSelfPermitsChecked] = useState(true);
  const [fwdPermits, setFwdPermits] = useState(0);
  const [saving, setSaving] = useState(false);

  const insuranceCatalog = useMemo(() => getInsuranceCatalog(data.pricingRates), [data.pricingRates]);

  const orderOptions = useMemo(() => {
    return data.inquiries
      .filter((i) => isWaitingPricingStatus(i.inquiry_status) || isRepriceRequestedStatus(i.inquiry_status) || data.proposals.some((p) => p.order_id === i.order_id))
      .slice()
      .reverse()
      .map((i) => {
        const cus = data.consignees.find((c) => c.consignee_id === i.consignee_id);
        return {
          value: i.order_id,
          label: `${i.order_id} · ${cus?.consignee_name || i.consignee_id}`,
          subLabel: `${i.inquiry_status} · ${fmtNumber(i.net_weight_kgs)} KG`,
        };
      });
  }, [data.inquiries, data.consignees, data.proposals]);

  const selectedInq = useMemo(() => data.inquiries.find((i) => i.order_id === selectedOrderId), [data.inquiries, selectedOrderId]);
  const selectedCus = useMemo(() => (selectedInq ? data.consignees.find((c) => c.consignee_id === selectedInq.consignee_id) : undefined), [data.consignees, selectedInq]);

  const loadOrderIntoCalculator = (orderId: string) => {
    setSelectedOrderId(orderId);
    setSelectedScheduleId('');
    setAiMessages([]);
    setAiBestTerm('');
    setAiBestReason('');
    setManualFloorPrice('');
    setManualInsurance('');
    setPackingManualCost('');

    const inq = data.inquiries.find((i) => i.order_id === orderId);
    if (!inq) {
      setItemsState([]);
      return;
    }
    const cus = data.consignees.find((c) => c.consignee_id === inq.consignee_id);
    const parsed = parseOrderItems(inq, data.products, data.pricingRates);
    setItemsState(parsed);

    const pal = parsed.some((it) => it.palletCode === 'PKG-PLT-YES');
    setUsePallet(pal);
    const stdPlt = resolvePackingSpec('PKG-PLT-YES', data.pricingRates).rate || 18;
    setPalletRate(stdPlt.toFixed(2));
    setCountryFilter(cus?.country || '');
    setPodFilter('');

    const optMix = solveOptimalContainerMix(parsed, pal, data.products, data.pricingRates);
    setQ20dc(optMix.qty20DC);
    setQ40dc(optMix.qty40DC);
    setQ40hc(optMix.qty40HC);
    setQ20rf(optMix.qty20RF);
    setQ40rf(optMix.qty40RF);
    setQ40rh(optMix.qty40RH);

    const hasLclAuto = optMix.dryMode === 'LCL' || optMix.reeferMode === 'LCL';
    setShowFwdCompare(hasLclAuto);
    setExecOption(hasLclAuto ? 'FWD_ALL' : 'SELF');
    if (hasLclAuto) {
      setSelfOceanChecked(false);
    } else {
      setSelfOceanChecked(true);
      setFwdOcean(0);
    }

    const desired = (inq.desired_incoterm || 'CIF').toUpperCase();
    const isComp = String(inq.quotation_mode || '').toUpperCase().includes('COMP');
    const initTerms = [desired];
    if (isComp) {
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
      setInsBaseCode(rule.includeIns ? (desired === 'CIP' ? 'INS-ICC-A' : 'INS-ICC-C') : 'INS-NONE');
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
    const pExact = podFilter.trim();
    const list = data.schedules.filter((s) => {
      if (cLow && s.country.trim().toLowerCase() !== cLow) return false;
      if (pExact && s.pod.trim() !== pExact) return false;
      return true;
    });
    const hasCold = itemsState.some((it) => isReeferProduct(data.products.find((p) => p.sku_code === it.sku), it.name)) || mix.reefer > 0;
    const leadDays = hasCold ? 7 : 5;
    const earliest = new Date();
    earliest.setHours(0, 0, 0, 0);
    earliest.setDate(earliest.getDate() + leadDays);

    const evals = list.map((s) => {
      const res = computeScheduleOceanAndMissing(s, mix);
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
      .forEach((x) => x.pod && s.add(x.pod.trim()));
    return Array.from(s).sort().map((v) => ({ value: v, label: v }));
  }, [data.schedules, countryFilter]);

  // Core Cost Components
  const goodsCost = useMemo(() => {
    return itemsState.reduce((sum, it) => {
      const prod = data.products.find((p) => p.sku_code.toLowerCase() === it.sku.toLowerCase());
      return sum + toNum(it.weight) * toNum(prod?.unit_price);
    }, 0);
  }, [itemsState, data.products]);

  const schOceanRes = useMemo(() => computeScheduleOceanAndMissing(activeSch, mix), [activeSch, mix]);
  const fullLocalTotal = useMemo(() => computeLocalChargesForMix(mix, data.pricingRates), [mix, data.pricingRates]);
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

  // Final Calculations for Khung 4
  const costing = useMemo(() => {
    const effOcean = includeFreight ? schOceanRes.ocean : 0;
    const effSurcharge = includeFreight ? schOceanRes.surcharge : 0;
    const isExw = recIncoterm === 'EXW';
    const localTotal = isExw ? 0 : fullLocalTotal;
    const customsTotal = isExw ? 0 : customsSplit.customsTotal;
    const isDest = recIncoterm === 'DAP' || recIncoterm === 'DPU' || recIncoterm === 'DDP';
    const effDest = isDest ? toNum(destExtra) : 0;
    const totalFreightLocal = effOcean + effSurcharge + localTotal + customsTotal + effDest;

    const exwSell = (goodsCost + effectivePackingCost) * (1 + marginPct / 100);
    const fobSell = (goodsCost + effectivePackingCost + fullLocalTotal + customsSplit.customsTotal) * (1 + marginPct / 100);
    const cfrSell = (goodsCost + effectivePackingCost + fullLocalTotal + customsSplit.customsTotal + schOceanRes.ocean + schOceanRes.surcharge) * (1 + marginPct / 100);
    const cifInsExact = computeInsurancePremiumExact(cfrSell, recIncoterm === 'CIF' ? (selectedInsRatePct || 0.08) : 0.08);
    const cifSell = cfrSell + cifInsExact;

    const cPlusF = goodsCost + effectivePackingCost + totalFreightLocal;
    const autoIns = includeInsurance ? computeInsurancePremiumExact(cPlusF * (1 + marginPct / 100), selectedInsRatePct) : 0;
    const effInsurance = includeInsurance ? (manualInsurance !== '' ? toNum(manualInsurance) : autoIns) : 0;

    const baseCost = goodsCost + effectivePackingCost + totalFreightLocal + effInsurance;
    const finalSelling = baseCost * (1 + marginPct / 100);
    const computedFloor = baseCost * (1 + minMarginPct / 100);
    const floorPrice = manualFloorPrice !== '' ? toNum(manualFloorPrice) : computedFloor;

    // Self vs FWD Comparison
    const selfOceanTotal = mix.hasLcl ? null : effOcean + effSurcharge + localTotal;
    const effFwdOcean = fwdOcean > 0 ? fwdOcean : effOcean + effSurcharge + (mix.hasLcl ? 0 : localTotal);
    const effFwdCustoms = fwdCustoms > 0 ? fwdCustoms : customsSplit.customsExportUsd;
    const effFwdPermits = fwdPermits > 0 ? fwdPermits : customsSplit.permitsUsd;
    const fwdAllTotal = effFwdOcean + fwdTruck + effFwdCustoms + effFwdPermits;
    const bestTruck = selfTruckRate > 0 && fwdTruck > 0 ? Math.min(selfTruckRate, fwdTruck) : (fwdTruck > 0 ? fwdTruck : selfTruckRate);
    const hybridTotal = Math.min(selfOceanTotal ?? effFwdOcean, effFwdOcean) + bestTruck + customsSplit.customsExportUsd + customsSplit.permitsUsd;
    const selfTotal = selfOceanTotal !== null ? selfOceanTotal + customsSplit.customsExportUsd + customsSplit.permitsUsd + selfTruckRate : null;
    const internalCost = execOption === 'SELF' && selfTotal !== null ? selfTotal : execOption === 'HYBRID' ? hybridTotal : fwdAllTotal;
    const buyerCharge = totalFreightLocal;
    const internalProfit = Math.round((buyerCharge - internalCost) * 100) / 100;

    return {
      effOcean, effSurcharge, localTotal, customsTotal, effDest, totalFreightLocal,
      effInsurance, finalSelling, floorPrice, computedFloor,
      exwSell: Math.round(exwSell * 100) / 100,
      fobSell: Math.round(fobSell * 100) / 100,
      cfrSell: Math.round(cfrSell * 100) / 100,
      cifSell: Math.round(cifSell * 100) / 100,
      selfTotal, hybridTotal, fwdAllTotal, internalCost, buyerCharge, internalProfit,
    };
  }, [
    includeFreight, schOceanRes, recIncoterm, fullLocalTotal, customsSplit, destExtra,
    goodsCost, effectivePackingCost, marginPct, selectedInsRatePct, includeInsurance,
    manualInsurance, minMarginPct, manualFloorPrice, mix.hasLcl, fwdOcean, fwdCustoms,
    fwdPermits, fwdTruck, selfTruckRate, execOption,
  ]);

  const applyIncotermToKhung4 = (code: string) => {
    setRecIncoterm(code);
    const rule = INCOTERMS_2020_MATRIX.find((r) => r.code === code);
    if (rule) {
      setIncludeFreight(rule.includeFreight);
      setIncludeInsurance(rule.includeIns);
      if (!rule.includeIns) {
        setInsBaseCode('INS-NONE');
        setInsAddons([]);
      } else if (insBaseCode === 'INS-NONE') {
        setInsBaseCode(code === 'CIP' ? 'INS-ICC-A' : 'INS-ICC-C');
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

  // Khung 3 comparison rows
  const comparisonRows = useMemo(() => {
    const iccARate = toNum(insuranceCatalog.byCode['INS-ICC-A']?.standard_rate) || 0.25;
    const goodsPack = goodsCost + effectivePackingCost;
    return INCOTERMS_2020_MATRIX.filter((r) => proposedIncoterms.includes(r.code)).map((row) => {
      const exwVal = Math.round(goodsPack * (1 + marginPct / 100) * 100) / 100;
      const localAndCustoms = row.includeLocal ? fullLocalTotal + customsSplit.customsTotal : 0;
      const freight = row.includeFreight ? schOceanRes.ocean + schOceanRes.surcharge : 0;
      const dest = row.includeDest ? destExtra : 0;
      const appliedFees = Math.round((localAndCustoms + freight + dest) * 100) / 100;
      let ins = 0;
      let insLabel = '';
      if (row.code === 'CIF') {
        ins = computeInsurancePremiumExact(exwVal + appliedFees, 0.08);
        insLabel = 'ICC C (0.08%)';
      } else if (row.code === 'CIP') {
        ins = computeInsurancePremiumExact(exwVal + appliedFees, iccARate);
        insLabel = `ICC A (${iccARate.toFixed(2)}%)`;
      }
      const total = Math.round((exwVal + appliedFees + ins) * 100) / 100;
      return { row, exwVal, appliedFees, ins, insLabel, total };
    });
  }, [proposedIncoterms, insuranceCatalog, goodsCost, effectivePackingCost, marginPct, fullLocalTotal, customsSplit, schOceanRes, destExtra]);

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
        quotation_no: `QT-${selectedOrderId}`,
        floor_price_usd: Math.round(costing.floorPrice * 100) / 100,
        min_margin_pct: minMarginPct,
        margin_pct: marginPct,
        exw_price: costing.exwSell,
        fob_price: costing.fobSell,
        cfr_price: costing.cfrSell,
        cif_price: costing.cifSell,
        dest_extra: destExtra,
        freight_exec_option: execOption,
        self_trucking: selfTruckRate,
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
              <table className="w-full text-left border border-[#186635]/40 rounded-lg overflow-hidden">
                <thead className="bg-[#547d59] text-[#fff5d6] text-[11px]">
                  <tr>
                    <th className="p-2 text-center">SKU</th>
                    <th className="p-2 text-left">Sản phẩm</th>
                    <th className="p-2 text-left">Quy cách đóng gói</th>
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
                    const calc = computeItemPackingAndPallet(it.weight, it.packingCode, it.packingExtra, data.pricingRates);
                    return (
                      <tr key={idx} className="border-t border-[#186635]/30 bg-white/60">
                        <td className="p-2 text-center font-mono font-bold">{it.sku}</td>
                        <td className="p-2 text-left font-semibold">{it.name}</td>
                        <td className="p-2 text-left">
                          <select
                            value={it.packingCode}
                            onChange={(e) => {
                              const code = e.target.value;
                              const spec = resolvePackingSpec(code, data.pricingRates);
                              setItemsState((prev) => prev.map((r, i) => (i === idx ? { ...r, packingCode: code, packingName: spec.nameVie, packingExtra: spec.rate } : r)));
                              setPackingManualCost('');
                            }}
                            className="px-2 py-1 rounded border border-[#186635] bg-[#d7eee4] text-xs font-semibold"
                          >
                            {packOpts.map((pk) => (
                              <option key={pk.code} value={pk.code}>
                                {pk.code} – {pk.name} (+${pk.perKgRate.toFixed(2)}/kg)
                              </option>
                            ))}
                          </select>
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
                  <span>GW: <strong>{fmtNumber(palletPool.totalGrossWeightKg)} KG</strong></span>
                  <span>CBM: <strong>{palletPool.totalCbm.toFixed(3)}</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px]">Phí/Pallet ($):</span>
                  <input type="number" step="0.5" value={palletRate} onChange={(e) => { setPalletRate(e.target.value); setPackingManualCost(''); }} className="w-20 px-2 py-0.5 rounded border border-[#186635] font-mono" />
                  <span className="text-[11px]">Tổng Bao bì &amp; Pallet ($):</span>
                  <input
                    type="number"
                    step="0.01"
                    value={packingManualCost !== '' ? packingManualCost : palletPool.totalPackingPalletCost.toFixed(2)}
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
                    <div className="flex items-center gap-2 bg-[#f4d98a] text-[#07281c] px-2.5 py-1 rounded-lg font-bold">
                      <span>LCL (&lt;55% cont 20'): {mix.lclCbm.toFixed(2)} CBM · {(mix.lclWeightKg / 1000).toFixed(2)} Tấn</span>
                      <select value={lclBasis} onChange={(e) => setLclBasis(e.target.value as 'CBM' | 'TON')} className="px-1 rounded bg-white">
                        <option value="CBM">Theo CBM</option>
                        <option value="TON">Theo Tấn</option>
                      </select>
                      <input type="number" value={lclRate} onChange={(e) => setLclRate(toNum(e.target.value))} className="w-16 px-1 rounded bg-white font-mono" />
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
            <div className="w-48"><SearchableCombo value={countryFilter} onChange={setCountryFilter} options={countryOptions} placeholder="Lọc Quốc gia..." /></div>
            <div className="w-52"><SearchableCombo value={podFilter} onChange={setPodFilter} options={podOptions} placeholder="Lọc Cảng đến (POD)..." /></div>
          </div>
        </div>
        <div className="agri-table-wrap">
          <div className="agri-table-scroll max-h-64">
            <table className="agri-table">
              <thead>
                <tr>
                  <th className="text-center">Chọn</th>
                  <th className="text-center">Mã lịch</th>
                  <th className="text-left">Hãng tàu</th>
                  <th className="text-left">Tuyến (POL → POD)</th>
                  <th className="text-center">ETD / ETA</th>
                  <th className="text-center">Cước biển</th>
                  <th className="text-center">Phụ phí tàu</th>
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
                      <td className="text-center font-mono font-bold">{sid}</td>
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
                      <td className="text-left">{ev.s.pol} → {ev.s.pod}</td>
                      <td className="text-center font-mono text-xs">{ev.s.etd} / {ev.s.eta}</td>
                      <td className="text-center font-mono font-bold">{fmtUSD(ev.res.ocean)}</td>
                      <td className="text-center font-mono">{fmtUSD(ev.res.surcharge)}</td>
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
            <span>{aiLoading ? 'AI đang phân tích...' : 'Phân tích đơn hàng bằng AI'}</span>
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

        {/* 3-Criteria Filter + 11 Checkboxes */}
        <div className="agri-card-inner p-3.5 space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select value={filterFreight} onChange={(e) => setFilterFreight(e.target.value)} className="agri-input text-xs">
              <option value="">-- Lọc 1: Ai trả cước chính --</option>
              <option value="BUYER">Người mua trả cước (EXW, FCA, FAS, FOB)</option>
              <option value="SELLER">Người bán trả cước (CFR, CIF, CPT, CIP, DAP, DPU, DDP)</option>
            </select>
            <select value={filterIns} onChange={(e) => setFilterIns(e.target.value)} className="agri-input text-xs">
              <option value="">-- Lọc 2: Trách nhiệm Bảo hiểm --</option>
              <option value="NONE">Không bắt buộc mua BH</option>
              <option value="MIN_C">Tối thiểu ICC (C) - CIF</option>
              <option value="MAX_A">Mọi rủi ro ICC (A) - CIP</option>
              <option value="OPTIONAL">Tùy chọn bảo vệ (DAP/DPU/DDP)</option>
            </select>
            <select value={filterRisk} onChange={(e) => setFilterRisk(e.target.value)} className="agri-input text-xs">
              <option value="">-- Lọc 3: Điểm chuyển rủi ro --</option>
              <option value="ORIGIN">Tại xưởng / Nơi đi (EXW, FCA, CPT, CIP)</option>
              <option value="PORT_ORIGIN">Tại cảng đi (FAS, FOB, CFR, CIF)</option>
              <option value="DESTINATION">Tại cảng/nơi đến (DAP, DPU, DDP)</option>
            </select>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {INCOTERMS_2020_MATRIX.filter((r) => {
              if (filterFreight && r.freightOwner !== filterFreight) return false;
              if (filterIns && r.insOwner !== filterIns) return false;
              if (filterRisk && r.riskGroup !== filterRisk) return false;
              return true;
            }).map((r) => {
              const checked = proposedIncoterms.includes(r.code);
              return (
                <label
                  key={r.code}
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
                    <th className="text-center">Giá EXW</th>
                    <th className="text-center">Phí áp dụng</th>
                    <th className="text-center">Bảo hiểm</th>
                    <th className="text-center">Giá chào dự kiến</th>
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block font-bold mb-1">Biên LN mục tiêu (%)</label>
                <input type="number" step="0.5" value={marginPct} onChange={(e) => setMarginPct(toNum(e.target.value))} className="agri-input font-mono font-bold" />
              </div>
              <div>
                <label className="block font-bold mb-1">Biên LN sàn (%)</label>
                <input type="number" step="0.5" value={minMarginPct} onChange={(e) => setMinMarginPct(toNum(e.target.value))} className="agri-input font-mono" />
              </div>
              <div>
                <label className="block font-bold mb-1">Giá Sàn Floor ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={manualFloorPrice !== '' ? manualFloorPrice : costing.computedFloor.toFixed(2)}
                  onChange={(e) => setManualFloorPrice(e.target.value)}
                  className="agri-input font-mono font-bold"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Phí Đích DAP/DPU/DDP</label>
                <input
                  type="number"
                  step="1"
                  disabled={!['DAP', 'DPU', 'DDP'].includes(recIncoterm)}
                  value={destExtra}
                  onChange={(e) => setDestExtra(toNum(e.target.value))}
                  className="agri-input font-mono disabled:opacity-50"
                />
              </div>
            </div>

            {/* Insurance Selector + Formula V = (C+F)*1.1 / (1-R) */}
            <div className="p-3 rounded-xl bg-white/60 border border-[#186635]/40 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-extrabold text-[#07281c] flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[#0f4a33]" /> Bảo hiểm V = (C+F)×1.1 / (1-R) · R = {selectedInsRatePct.toFixed(2)}%
                </span>
                <label className="inline-flex items-center gap-1.5 font-bold cursor-pointer">
                  <input type="checkbox" checked={includeInsurance} onChange={(e) => setIncludeInsurance(e.target.checked)} className="accent-[#0f4a33]" />
                  <span>Tính vào giá bán</span>
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="sm:col-span-2">
                  <select value={insBaseCode} onChange={(e) => { setInsBaseCode(e.target.value); setManualInsurance(''); setIncludeInsurance(e.target.value !== 'INS-NONE'); }} className="agri-input text-xs">
                    {insuranceCatalog.basePolicies.map((p) => (
                      <option key={p.fee_code} value={p.fee_code}>
                        {p.fee_code} · {p.fee_name_vie} ({p.standard_rate.toFixed(2)}%)
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <input
                    type="number"
                    step="0.01"
                    value={manualInsurance !== '' ? manualInsurance : costing.effInsurance.toFixed(2)}
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
                      <span className="font-mono font-bold">{a.fee_code}</span> (+{a.standard_rate.toFixed(2)}%)
                    </label>
                  );
                })}
              </div>
              {insClauseEng && <div className="text-[11px] text-[#0f4a33] font-semibold">Điều khoản HĐ: {insClauseEng}</div>}
            </div>

            {/* 2-Way Cross-Locked Self vs FWD Matrix */}
            <div className="p-3 rounded-xl bg-white/60 border border-[#186635]/40 space-y-2">
              <div className="flex items-center justify-between">
                <label className="inline-flex items-center gap-2 font-extrabold text-[#07281c] cursor-pointer">
                  <input type="checkbox" checked={showFwdCompare} onChange={(e) => setShowFwdCompare(e.target.checked)} className="accent-[#0f4a33]" />
                  <span>So sánh Nội bộ Tự làm (Self) vs Forwarder (FWD) (Khóa chéo 2 chiều)</span>
                </label>
                <span className="px-2 py-0.5 rounded bg-[#0f4a33] text-[#f4d98a] font-mono font-bold">
                  Lựa chọn: {execOption}
                </span>
              </div>

              {showFwdCompare && (
                <div className="space-y-2 pt-1">
                  <table className="w-full text-xs border border-[#186635]/40">
                    <thead className="bg-[#547d59] text-[#fff5d6]">
                      <tr>
                        <th className="p-1.5 text-left">Hạng mục</th>
                        <th className="p-1.5 text-center">Công ty Tự làm</th>
                        <th className="p-1.5 text-center">Phí Tự làm ($)</th>
                        <th className="p-1.5 text-center">Báo giá FWD ($)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-[#186635]/30">
                        <td className="p-1.5 text-left font-semibold">1. Ocean &amp; Local/CFS</td>
                        <td className="p-1.5 text-center">
                          <input
                            type="checkbox"
                            disabled={mix.hasLcl || fwdOcean > 0}
                            checked={selfOceanChecked && !mix.hasLcl && fwdOcean === 0}
                            onChange={(e) => {
                              setSelfOceanChecked(e.target.checked);
                              if (e.target.checked) setFwdOcean(0);
                            }}
                          />
                        </td>
                        <td className="p-1.5 text-center font-mono">{mix.hasLcl ? 'LCL→FWD' : fmtUSD(costing.effOcean + costing.effSurcharge + costing.localTotal)}</td>
                        <td className="p-1.5 text-center">
                          <input
                            type="number"
                            disabled={selfOceanChecked && !mix.hasLcl}
                            value={fwdOcean}
                            onChange={(e) => {
                              const v = toNum(e.target.value);
                              setFwdOcean(v);
                              if (v > 0) setSelfOceanChecked(false);
                            }}
                            className="w-24 px-1.5 py-0.5 rounded border border-[#186635] text-center font-mono disabled:opacity-45"
                          />
                        </td>
                      </tr>
                      <tr className="border-t border-[#186635]/30">
                        <td className="p-1.5 text-left font-semibold">2. Trucking nội địa</td>
                        <td className="p-1.5 text-center">
                          <input
                            type="checkbox"
                            disabled={fwdTruck > 0}
                            checked={selfTruckChecked && fwdTruck === 0}
                            onChange={(e) => {
                              setSelfTruckChecked(e.target.checked);
                              if (e.target.checked) {
                                setFwdTruck(0);
                                if (selfTruckRate === 0) setSelfTruckRate(180);
                              }
                            }}
                          />
                        </td>
                        <td className="p-1.5 text-center">
                          <input
                            type="number"
                            disabled={!selfTruckChecked}
                            value={selfTruckRate}
                            onChange={(e) => setSelfTruckRate(toNum(e.target.value))}
                            className="w-24 px-1.5 py-0.5 rounded border border-[#186635] text-center font-mono disabled:opacity-45"
                          />
                        </td>
                        <td className="p-1.5 text-center">
                          <input
                            type="number"
                            disabled={selfTruckChecked}
                            value={fwdTruck}
                            onChange={(e) => {
                              const v = toNum(e.target.value);
                              setFwdTruck(v);
                              if (v > 0) setSelfTruckChecked(false);
                            }}
                            className="w-24 px-1.5 py-0.5 rounded border border-[#186635] text-center font-mono disabled:opacity-45"
                          />
                        </td>
                      </tr>
                      <tr className="border-t border-[#186635]/30">
                        <td className="p-1.5 text-left font-semibold">3. Hải quan Xuất khẩu</td>
                        <td className="p-1.5 text-center">
                          <input
                            type="checkbox"
                            disabled={fwdCustoms > 0}
                            checked={selfCustomsChecked && fwdCustoms === 0}
                            onChange={(e) => {
                              setSelfCustomsChecked(e.target.checked);
                              if (e.target.checked) setFwdCustoms(0);
                            }}
                          />
                        </td>
                        <td className="p-1.5 text-center font-mono">{fmtUSD(customsSplit.customsExportUsd)}</td>
                        <td className="p-1.5 text-center">
                          <input
                            type="number"
                            disabled={selfCustomsChecked}
                            value={fwdCustoms}
                            onChange={(e) => {
                              const v = toNum(e.target.value);
                              setFwdCustoms(v);
                              if (v > 0) setSelfCustomsChecked(false);
                            }}
                            className="w-24 px-1.5 py-0.5 rounded border border-[#186635] text-center font-mono disabled:opacity-45"
                          />
                        </td>
                      </tr>
                      <tr className="border-t border-[#186635]/30">
                        <td className="p-1.5 text-left font-semibold">4. Giấy phép (Kiểm dịch/C/O/Hun trùng)</td>
                        <td className="p-1.5 text-center">
                          <input
                            type="checkbox"
                            disabled={fwdPermits > 0}
                            checked={selfPermitsChecked && fwdPermits === 0}
                            onChange={(e) => {
                              setSelfPermitsChecked(e.target.checked);
                              if (e.target.checked) setFwdPermits(0);
                            }}
                          />
                        </td>
                        <td className="p-1.5 text-center font-mono">{fmtUSD(customsSplit.permitsUsd)}</td>
                        <td className="p-1.5 text-center">
                          <input
                            type="number"
                            disabled={selfPermitsChecked}
                            value={fwdPermits}
                            onChange={(e) => {
                              const v = toNum(e.target.value);
                              setFwdPermits(v);
                              if (v > 0) setSelfPermitsChecked(false);
                            }}
                            className="w-24 px-1.5 py-0.5 rounded border border-[#186635] text-center font-mono disabled:opacity-45"
                          />
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <div className="flex gap-1.5">
                      {!mix.hasLcl && (
                        <button type="button" onClick={() => setExecOption('SELF')} className={`px-2 py-1 rounded font-bold cursor-pointer ${execOption === 'SELF' ? 'bg-[#0f4a33] text-[#f4d98a]' : 'bg-[#d7eee4]'}`}>
                          100% SELF ({fmtUSD(costing.selfTotal || 0)})
                        </button>
                      )}
                      <button type="button" onClick={() => setExecOption('HYBRID')} className={`px-2 py-1 rounded font-bold cursor-pointer ${execOption === 'HYBRID' ? 'bg-[#0f4a33] text-[#f4d98a]' : 'bg-[#d7eee4]'}`}>
                        HYBRID ({fmtUSD(costing.hybridTotal)})
                      </button>
                      <button type="button" onClick={() => setExecOption('FWD_ALL')} className={`px-2 py-1 rounded font-bold cursor-pointer ${execOption === 'FWD_ALL' ? 'bg-[#0f4a33] text-[#f4d98a]' : 'bg-[#d7eee4]'}`}>
                        FWD_ALL ({fmtUSD(costing.fwdAllTotal)})
                      </button>
                    </div>
                    <div className="font-mono font-bold text-[#07281c]">
                      Chi phí nội bộ: {fmtUSD(costing.internalCost)} · Chênh lệch cước: {fmtUSD(costing.internalProfit)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-5 dash-xnk-dark p-4 flex flex-col justify-between space-y-3">
            <div className="space-y-1.5 text-xs">
              <div className="text-[11px] font-bold uppercase text-[#f4d98a] mb-2">Tổng hợp Cấu trúc Giá ({recIncoterm})</div>
              <div className="flex justify-between"><span>Giá vốn hàng hóa:</span><span className="font-mono font-bold">{fmtUSD(goodsCost)}</span></div>
              <div className="flex justify-between"><span>Bao bì &amp; Pallet:</span><span className="font-mono font-bold">{fmtUSD(effectivePackingCost)}</span></div>
              <div className="flex justify-between"><span>Cước biển + Phụ phí tàu:</span><span className="font-mono">{fmtUSD(costing.effOcean + costing.effSurcharge)}</span></div>
              <div className="flex justify-between"><span>Local Charges + Hải quan/C/O:</span><span className="font-mono">{fmtUSD(costing.localTotal + costing.customsTotal)}</span></div>
              <div className="flex justify-between"><span>Phí Đích &amp; Bảo hiểm:</span><span className="font-mono">{fmtUSD(costing.effDest + costing.effInsurance)}</span></div>
              <div className="border-t border-white/15 pt-2 flex justify-between text-base font-extrabold text-[#f4d98a]">
                <span>GIÁ BÁN ĐỀ XUẤT:</span>
                <span className="font-mono">{fmtUSD(costing.finalSelling)}</span>
              </div>
              <div className="flex justify-between text-[11px] text-[#9bccb8]">
                <span>Đơn giá bình quân:</span>
                <span className="font-mono font-bold">
                  {selectedInq && selectedInq.net_weight_kgs > 0 ? `${fmtUSD(costing.finalSelling / selectedInq.net_weight_kgs)} / KG` : '$0.00 / KG'}
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
              <span>{saving ? 'Đang lưu phương án...' : 'Lưu & Gửi Báo giá cho Kinh doanh'}</span>
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
                <th className="text-center">Giá vốn</th>
                <th className="text-center">Cước + BB + BH</th>
                <th className="text-center">Incoterm</th>
                <th className="text-center">Giá chào chốt</th>
                <th className="text-center">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {data.proposals.slice().reverse().map((p) => {
                const extra = proposalMetaMap[p.order_id];
                return (
                  <tr key={p.order_id}>
                    <td className="text-center">
                      <div className="font-mono font-bold">{extra?.quotation_no || `QT-${p.order_id}`}</div>
                      <button type="button" onClick={() => onOpenTimeline(p.order_id)} className="font-mono text-[11px] hover:underline cursor-pointer">
                        {p.order_id}
                      </button>
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
                    <td className="text-center font-mono text-[11px]">
                      Cước: {fmtUSD(p.total_freight_local)}
                      <div>BB: {fmtUSD(p.packing_pallet_cost)} · BH: {fmtUSD(p.insurance_cost)}</div>
                    </td>
                    <td className="text-center font-mono font-bold">{p.recommended_incoterm}</td>
                    <td className="text-center font-mono font-extrabold">{fmtUSD(p.final_selling_price)}</td>
                    <td className="text-center">
                      <span className="keep-badge-color inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#0f4a33] text-[#fff5d6] text-[11px] font-bold">
                        <Check className="w-3 h-3" /> {p.booking_status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
