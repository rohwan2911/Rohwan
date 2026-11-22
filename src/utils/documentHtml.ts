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
} from '../types';
import {
  cleanQuoteNoForCustomer,
  computeOrderPalletSummary,
  computeSilentFobUnitPrices,
  fmtNumber,
  fmtUSD,
  formatCurrency,
  parseOrderItems,
  stripInternalCodesForCustomer,
  suggestCoFormCode,
  todayIsoDate,
  toNum,
} from './calculations';

const COMPANY_INFO = {
  name: 'GREEN AGRI-EXPORTS CO., LTD (NÔNG SẢN XANH)',
  address: '128 Cộng Hòa, Phường 4, Quận Tân Bình, TP. Hồ Chí Minh, Việt Nam',
  taxId: '0315892416',
  tel: '+84 28 3811 6688',
  email: 'export@greenagri-vn.com',
  bank: 'Joint Stock Commercial Bank for Foreign Trade of Vietnam (Vietcombank) - Ho Chi Minh City Branch · SWIFT: BFTVVNVX · USD Account: 0071370894125',
};

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapPrintableDocument(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${esc(title)}</title>
<style>
  body { font-family: 'Be Vietnam Pro', Arial, sans-serif; color: #0f172a; margin: 0; padding: 28px; background: #fff; font-size: 12.5px; line-height: 1.5; }
  .doc-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2.5px solid #0f4a33; padding-bottom: 14px; margin-bottom: 18px; }
  .brand { font-size: 18px; font-weight: 800; color: #0f4a33; letter-spacing: 0.4px; }
  .sub-brand { font-size: 11px; color: #475569; margin-top: 2px; }
  .doc-title { text-align: right; }
  .doc-title h1 { margin: 0; font-size: 20px; font-weight: 800; color: #0f4a33; text-transform: uppercase; }
  .doc-title .meta { font-size: 11.5px; color: #334155; margin-top: 3px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
  .box { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 12px; background: #f8fafc; }
  .box h3 { margin: 0 0 6px 0; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #0f4a33; letter-spacing: 0.5px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th { background: #0f4a33; color: #fff5d6; padding: 8px 10px; text-align: left; font-size: 11.5px; border: 1px solid #0f4a33; }
  td { padding: 8px 10px; border: 1px solid #cbd5e1; font-size: 12px; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  .num { text-align: right; font-variant-numeric: tabular-nums; font-family: ui-monospace, monospace; }
  .total-row td { background: #ecfdf5 !important; font-weight: 800; color: #0f4a33; font-size: 13px; }
  .terms { margin-top: 14px; padding: 12px; border-radius: 8px; border: 1px solid #cbd5e1; background: #f8fafc; font-size: 12px; }
  .sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 36px; text-align: center; }
  .sig-box { border-top: 1px dashed #94a3b8; padding-top: 8px; margin-top: 48px; font-weight: 700; }
  @media print { body { padding: 10px; } }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

export function generateQuotationDocHtml(params: {
  inq: InquiryQuotation;
  prop?: PricingProposal;
  extraMeta?: ProposalExtraMeta;
  cus?: ConsigneeDirectory;
  sch?: ShippingSchedule;
  products: ProductCatalog[];
  pricingRates: PricingRate[];
  templateMode: 'STANDARD' | 'COMPARISON';
  overrideIncoterm?: string;
  overrideSellingPrice?: number;
}): string {
  const { inq, prop, extraMeta, cus, sch, products, pricingRates, templateMode, overrideIncoterm, overrideSellingPrice } = params;
  const items = parseOrderItems(inq, products, pricingRates);
  const incoterm = (overrideIncoterm || prop?.recommended_incoterm || inq.desired_incoterm || 'CIF').toUpperCase();
  const sellingTotal = overrideSellingPrice && overrideSellingPrice > 0
    ? overrideSellingPrice
    : toNum(prop?.final_selling_price) || 0;
  const cleanQuoteNo = cleanQuoteNoForCustomer(extraMeta?.quotation_no || '', inq.order_id);
  const allocated = computeSilentFobUnitPrices(items, sellingTotal, products, pricingRates);
  const pool = computeOrderPalletSummary(items, Boolean(extraMeta?.use_pallet), pricingRates);

  const itemsRows = allocated.map((row, idx) => `
    <tr>
      <td style="text-align:center">${idx + 1}</td>
      <td><strong>${esc(row.item.name_eng || row.item.name)}</strong><div style="font-size:11px;color:#475569">${esc(row.item.packingName || row.item.packingCode)}</div></td>
      <td class="num">${fmtNumber(row.item.weight)} KG</td>
      <td class="num">${fmtNumber(row.item.cartons)}</td>
      <td class="num">${fmtUSD(row.unitPricePerKg)}</td>
      <td class="num"><strong>${fmtUSD(row.lineTotalUsd)}</strong></td>
    </tr>
  `).join('');

  const compSection = templateMode === 'COMPARISON' && extraMeta
    ? `<div class="terms">
        <strong>INCOTERMS 2020 PRICE COMPARISON MATRIX (USD)</strong>
        <table style="margin-top:8px">
          <thead><tr><th>Incoterm</th><th class="num">Total Price (USD)</th><th>Cost & Risk Scope</th></tr></thead>
          <tbody>
            <tr><td><strong>EXW</strong></td><td class="num">${fmtUSD(extraMeta.exw_price)}</td><td>Goods & Export Packaging at Seller's Warehouse</td></tr>
            <tr><td><strong>FOB</strong></td><td class="num">${fmtUSD(extraMeta.fob_price)}</td><td>Loaded on Board Vessel at ${esc(sch?.pol || 'Cat Lai Port, Vietnam')}</td></tr>
            <tr><td><strong>CFR</strong></td><td class="num">${fmtUSD(extraMeta.cfr_price)}</td><td>Cost & Ocean Freight to ${esc(sch?.pod || 'Destination Port')}</td></tr>
            <tr><td><strong>CIF</strong></td><td class="num">${fmtUSD(extraMeta.cif_price)}</td><td>Cost, Marine Insurance (110% CIF) & Freight to ${esc(sch?.pod || 'Destination Port')}</td></tr>
          </tbody>
        </table>
      </div>`
    : '';

  const html = `
    <div class="doc-header">
      <div>
        <div class="brand">${esc(COMPANY_INFO.name)}</div>
        <div class="sub-brand">${esc(COMPANY_INFO.address)}</div>
        <div class="sub-brand">Tel: ${esc(COMPANY_INFO.tel)} · Email: ${esc(COMPANY_INFO.email)}</div>
      </div>
      <div class="doc-title">
        <h1>OFFICIAL QUOTATION</h1>
        <div class="meta">Quote Ref: <strong>${esc(cleanQuoteNo)}</strong> · Date: ${esc(todayIsoDate())}</div>
        <div class="meta">Delivery Term: <strong>${esc(incoterm)} ${esc(incoterm === 'EXW' ? 'Ho Chi Minh City' : (sch?.pod || 'Destination Port'))} (Incoterms 2020)</strong></div>
      </div>
    </div>
    <div class="grid-2">
      <div class="box">
        <h3>TO / BUYER</h3>
        <div><strong>${esc(cus?.consignee_name || inq.consignee_id)}</strong></div>
        <div>Address: ${esc(cus?.address || inq.address || '-')}</div>
        <div>Attn: ${esc(cus?.contact_person || inq.contact || '-')} · Email: ${esc(cus?.email || inq.email || '-')}</div>
        <div>Country: ${esc(cus?.country || '-')}</div>
      </div>
      <div class="box">
        <h3>SHIPMENT &amp; LOGISTICS SUMMARY</h3>
        <div>Route: <strong>${esc(sch?.pol || 'Cat Lai, HCMC')} &rarr; ${esc(sch?.pod || 'Destination Port')}</strong></div>
        <div>Allocation: <strong>${esc(prop?.container_type || 'FCL / LCL Optimal')}</strong> (${fmtNumber(pool.totalCartons)} Cartons · ${pool.totalCbm.toFixed(2)} CBM)</div>
        <div>Estimated Schedule: ${esc(sch ? `${sch.shipping_line} (ETD ${sch.etd} / ETA ${sch.eta})` : 'Subject to vessel confirmation')}</div>
        <div>Payment Terms: <strong>${esc(inq.proposed_payment_term || cus?.default_payment_term || 'T/T 30% Deposit / 70% against B/L copy')}</strong></div>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th style="width:42px;text-align:center">#</th>
          <th>Commodity &amp; Export Packaging</th>
          <th class="num">Net Weight</th>
          <th class="num">Cartons</th>
          <th class="num">Unit Price (USD/KG)</th>
          <th class="num">Amount (USD)</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows}
        <tr class="total-row">
          <td colspan="2">TOTAL QUOTATION VALUE (${esc(incoterm)} — INCOTERMS 2020)</td>
          <td class="num">${fmtNumber(pool.cargoNetKg)} KG</td>
          <td class="num">${fmtNumber(pool.totalCartons)}</td>
          <td class="num">-</td>
          <td class="num">${fmtUSD(sellingTotal)}</td>
        </tr>
      </tbody>
    </table>
    ${compSection}
    <div class="terms">
      <strong>COMMERCIAL TERMS &amp; VALIDITY:</strong>
      <ul style="margin:6px 0 0 18px;padding:0">
        <li>Quotation validity: 07 calendar days from the issue date (subject to ocean freight schedule availability).</li>
        <li>Quality &amp; Inspection: Vietnamese Export Grade, accompanied by Phytosanitary Certificate &amp; Certificate of Origin (${esc(suggestCoFormCode(sch?.pod, cus?.country))}).</li>
        <li>Beneficiary Bank: ${esc(COMPANY_INFO.bank)}</li>
      </ul>
    </div>
    <div class="sigs">
      <div><div>FOR THE BUYER</div><div class="sig-box">${esc(cus?.consignee_name || inq.consignee_id)}</div></div>
      <div><div>FOR THE SELLER</div><div class="sig-box">${esc(COMPANY_INFO.name)}</div></div>
    </div>
  `;
  return wrapPrintableDocument(`Quotation ${cleanQuoteNo}`, html);
}

export function generateContractDocHtml(params: {
  order: OrderMaster;
  meta?: OrderLogisticsMeta;
  inq?: InquiryQuotation;
  cus?: ConsigneeDirectory;
  products: ProductCatalog[];
  pricingRates: PricingRate[];
}): string {
  const { order, inq, cus, products, pricingRates } = params;
  const items: OrderItem[] = inq
    ? parseOrderItems(inq, products, pricingRates)
    : [{ sku: order.sku_code, name: order.sku_code, name_eng: order.sku_code, weight: toNum(order.nw_confirmed_kgs), packingCode: 'PKG-CTN-10K', packingName: 'Export Carton', packingExtra: 0, palletCode: 'PKG-PLT-NO', cartons: 0, pallets: 0, packingCost: 0 }];
  const allocated = computeSilentFobUnitPrices(items, toNum(order.contract_value), products, pricingRates);

  const html = `
    <div class="doc-header">
      <div>
        <div class="brand">${esc(COMPANY_INFO.name)}</div>
        <div class="sub-brand">${esc(COMPANY_INFO.address)} · Tax ID: ${esc(COMPANY_INFO.taxId)}</div>
      </div>
      <div class="doc-title">
        <h1>SALES CONTRACT</h1>
        <div class="meta">Contract No.: <strong>${esc(order.contract_no)}</strong></div>
        <div class="meta">Date: ${esc(order.contract_date || todayIsoDate())}</div>
      </div>
    </div>
    <div class="grid-2">
      <div class="box">
        <h3>1. THE SELLER</h3>
        <div><strong>${esc(COMPANY_INFO.name)}</strong></div>
        <div>Address: ${esc(COMPANY_INFO.address)}</div>
        <div>Tel: ${esc(COMPANY_INFO.tel)} · Tax ID: ${esc(COMPANY_INFO.taxId)}</div>
      </div>
      <div class="box">
        <h3>2. THE BUYER</h3>
        <div><strong>${esc(cus?.consignee_name || order.consignee_id)}</strong></div>
        <div>Address: ${esc(cus?.address || inq?.address || '-')}</div>
        <div>Tax/Reg No.: ${esc(cus?.tax || '-')} · Attn: ${esc(cus?.contact_person || inq?.contact || '-')}</div>
        <div>Tel: ${esc(cus?.phone || inq?.phone || '-')} · Email: ${esc(cus?.email || inq?.email || '-')}</div>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th style="width:42px;text-align:center">No.</th>
          <th>Description of Goods &amp; Packaging</th>
          <th class="num">Quantity (Net KG)</th>
          <th class="num">Unit Price (USD/KG)</th>
          <th class="num">Amount (USD)</th>
        </tr>
      </thead>
      <tbody>
        ${allocated.map((r, i) => `
          <tr>
            <td style="text-align:center">${i + 1}</td>
            <td><strong>${esc(r.item.name_eng || r.item.name)}</strong> (${esc(r.item.sku)})<div style="font-size:11px;color:#475569">${esc(r.item.packingName || 'Export Standard Packaging')}</div></td>
            <td class="num">${fmtNumber(r.item.weight)}</td>
            <td class="num">${fmtUSD(r.unitPricePerKg)}</td>
            <td class="num"><strong>${fmtUSD(r.lineTotalUsd)}</strong></td>
          </tr>
        `).join('')}
        <tr class="total-row">
          <td colspan="2">TOTAL CONTRACT VALUE (${esc(order.applied_incoterm)} ${esc(order.pod)} · INCOTERMS 2020)</td>
          <td class="num">${fmtNumber(order.nw_confirmed_kgs)} KG</td>
          <td class="num">-</td>
          <td class="num">${fmtUSD(order.contract_value)}</td>
        </tr>
      </tbody>
    </table>
    <div class="terms">
      <div><strong>3. SHIPMENT TERMS:</strong> POL: <strong>${esc(order.pol)}</strong> &rarr; POD: <strong>${esc(order.pod)}</strong>. Incoterm: <strong>${esc(order.applied_incoterm)} (Incoterms 2020)</strong>.</div>
      <div style="margin-top:6px"><strong>4. PAYMENT TERMS:</strong> ${esc(order.payment_terms)}.</div>
      <div style="margin-top:6px"><strong>5. BANKING DETAILS:</strong> ${esc(COMPANY_INFO.bank)}.</div>
      <div style="margin-top:6px"><strong>6. DOCUMENTS REQUIRED:</strong> Signed Commercial Invoice, Packing List, Bill of Lading, Phytosanitary Certificate, Certificate of Origin (${esc(order.co_form || suggestCoFormCode(order.pod, cus?.country))}).</div>
    </div>
    <div class="sigs">
      <div><div>THE BUYER</div><div class="sig-box">${esc(cus?.consignee_name || order.consignee_id)}</div></div>
      <div><div>THE SELLER</div><div class="sig-box">${esc(COMPANY_INFO.name)}</div></div>
    </div>
  `;
  return wrapPrintableDocument(`Sales Contract ${order.contract_no}`, html);
}

export function generateExportDocumentHtml(
  docType: 'INVOICE' | 'PACKING_LIST' | 'CO' | 'BL',
  params: {
    order: OrderMaster;
    meta?: OrderLogisticsMeta;
    inq?: InquiryQuotation;
    cus?: ConsigneeDirectory;
    prop?: PricingProposal;
    products: ProductCatalog[];
    pricingRates: PricingRate[];
  }
): string {
  const { order, meta, inq, cus, prop, products, pricingRates } = params;
  const items = inq
    ? parseOrderItems(inq, products, pricingRates)
    : [{ sku: order.sku_code, name: order.sku_code, name_eng: order.sku_code, weight: toNum(order.nw_confirmed_kgs), packingCode: 'PKG-CTN-10K', packingName: 'Export Carton', packingExtra: 0, palletCode: 'PKG-PLT-NO', cartons: 0, pallets: 0, packingCost: 0 }];
  const allocated = computeSilentFobUnitPrices(items, toNum(order.contract_value), products, pricingRates);
  const pool = computeOrderPalletSummary(items, false, pricingRates);

  if (docType === 'INVOICE') {
    return wrapPrintableDocument(`Commercial Invoice ${order.contract_no}`, `
      <div class="doc-header">
        <div><div class="brand">${esc(COMPANY_INFO.name)}</div><div class="sub-brand">${esc(COMPANY_INFO.address)}</div></div>
        <div class="doc-title"><h1>COMMERCIAL INVOICE</h1><div class="meta">Invoice No.: <strong>INV-${esc(order.contract_no.replace(/^SC-/, ''))}</strong></div><div class="meta">Contract Ref: ${esc(order.contract_no)} · Date: ${esc(todayIsoDate())}</div></div>
      </div>
      <div class="grid-2">
        <div class="box"><h3>CONSIGNEE / IMPORTER</h3><div><strong>${esc(cus?.consignee_name || order.consignee_id)}</strong></div><div>${esc(cus?.address || '-')}</div><div>Tax: ${esc(cus?.tax || '-')} · Tel: ${esc(cus?.phone || '-')}</div></div>
        <div class="box"><h3>VESSEL &amp; ROUTING</h3><div>Vessel/Voyage: <strong>${esc(meta?.ves_voy || 'TBA')}</strong></div><div>POL: ${esc(order.pol)} &rarr; POD: ${esc(order.pod)}</div><div>B/K No.: ${esc(meta?.bk_no || '-')} · Term: ${esc(order.applied_incoterm)}</div></div>
      </div>
      <table>
        <thead><tr><th>#</th><th>HS Code</th><th>Goods Description</th><th class="num">Net Weight (KG)</th><th class="num">Unit Price</th><th class="num">Total (USD)</th></tr></thead>
        <tbody>
          ${allocated.map((r, i) => {
            const p = products.find((x) => x.sku_code === r.item.sku);
            return `<tr><td>${i + 1}</td><td class="num">${esc(p?.hs_code || '0810.90')}</td><td><strong>${esc(r.item.name_eng || r.item.name)}</strong></td><td class="num">${fmtNumber(r.item.weight)}</td><td class="num">${fmtUSD(r.unitPricePerKg)}</td><td class="num">${fmtUSD(r.lineTotalUsd)}</td></tr>`;
          }).join('')}
          <tr class="total-row"><td colspan="3">TOTAL INVOICE AMOUNT (${esc(order.applied_incoterm)})</td><td class="num">${fmtNumber(order.nw_confirmed_kgs)} KG</td><td></td><td class="num">${fmtUSD(order.contract_value)}</td></tr>
        </tbody>
      </table>
      <div class="terms"><strong>Payment Terms:</strong> ${esc(order.payment_terms)}<br/><strong>Bank:</strong> ${esc(COMPANY_INFO.bank)}</div>
      <div class="sigs"><div></div><div><div>AUTHORIZED SIGNATURE</div><div class="sig-box">${esc(COMPANY_INFO.name)}</div></div></div>
    `);
  }

  if (docType === 'PACKING_LIST') {
    const totalGw = toNum(prop?.total_gross_weight) || pool.totalGrossWeightKg;
    const totalCbm = toNum(prop?.total_cbm) || pool.totalCbm;
    return wrapPrintableDocument(`Packing List ${order.contract_no}`, `
      <div class="doc-header">
        <div><div class="brand">${esc(COMPANY_INFO.name)}</div><div class="sub-brand">${esc(COMPANY_INFO.address)}</div></div>
        <div class="doc-title"><h1>PACKING LIST</h1><div class="meta">Ref: <strong>PL-${esc(order.contract_no.replace(/^SC-/, ''))}</strong> · Date: ${esc(todayIsoDate())}</div></div>
      </div>
      <div class="grid-2">
        <div class="box"><h3>CONSIGNEE</h3><div><strong>${esc(cus?.consignee_name || order.consignee_id)}</strong></div><div>${esc(cus?.address || '-')}</div></div>
        <div class="box"><h3>CONTAINER &amp; SEAL</h3><div>Cont/Seal: <strong>${esc(meta?.cont_seal_list || prop?.container_type || 'TBA')}</strong></div><div>POL: ${esc(order.pol)} &rarr; POD: ${esc(order.pod)}</div></div>
      </div>
      <table>
        <thead><tr><th>#</th><th>Goods &amp; Packaging</th><th class="num">Cartons</th><th class="num">Net Weight (KG)</th><th class="num">Gross Weight (KG)</th><th class="num">Volume (CBM)</th></tr></thead>
        <tbody>
          ${items.map((it, i) => `<tr><td>${i + 1}</td><td><strong>${esc(it.name_eng || it.name)}</strong><div style="font-size:11px;color:#475569">${esc(it.packingName)}</div></td><td class="num">${fmtNumber(it.cartons)}</td><td class="num">${fmtNumber(it.weight)}</td><td class="num">${fmtNumber(it.grossWeightKg || it.weight * 1.08)}</td><td class="num">${(it.cbm || 0).toFixed(3)}</td></tr>`).join('')}
          <tr class="total-row"><td colspan="2">TOTAL PACKING SUMMARY</td><td class="num">${fmtNumber(prop?.total_cartons || pool.totalCartons)}</td><td class="num">${fmtNumber(order.nw_confirmed_kgs)} KG</td><td class="num">${fmtNumber(totalGw)} KG</td><td class="num">${totalCbm.toFixed(3)} CBM</td></tr>
        </tbody>
      </table>
    `);
  }

  if (docType === 'CO') {
    const coForm = order.co_form || suggestCoFormCode(order.pod, cus?.country);
    return wrapPrintableDocument(`Certificate of Origin ${coForm}`, `
      <div class="doc-header">
        <div><div class="brand">CERTIFICATE OF ORIGIN — ${esc(coForm.toUpperCase())}</div><div class="sub-brand">Issued in Socialist Republic of Vietnam (DRAFT FOR CHECKING)</div></div>
        <div class="doc-title"><h1>C/O ${esc(coForm)}</h1><div class="meta">Contract: <strong>${esc(order.contract_no)}</strong></div></div>
      </div>
      <div class="grid-2">
        <div class="box"><h3>1. EXPORTER</h3><div><strong>${esc(COMPANY_INFO.name)}</strong></div><div>${esc(COMPANY_INFO.address)}</div></div>
        <div class="box"><h3>2. CONSIGNEE</h3><div><strong>${esc(cus?.consignee_name || order.consignee_id)}</strong></div><div>${esc(cus?.address || '-')} (${esc(cus?.country || '-')})</div></div>
      </div>
      <table>
        <thead><tr><th>Marks &amp; Numbers</th><th>Packages &amp; Description of Goods</th><th>Origin Criterion</th><th class="num">Gross Weight</th><th class="num">FOB Value</th></tr></thead>
        <tbody>
          ${allocated.map((r) => `<tr><td>N/M<br/>${esc(order.contract_no)}</td><td>${fmtNumber(r.item.cartons)} Cartons of <strong>${esc(r.item.name_eng || r.item.name)}</strong></td><td>WO (Wholly Obtained in Vietnam)</td><td class="num">${fmtNumber(r.item.grossWeightKg || r.item.weight)} KG</td><td class="num">${fmtUSD(r.lineTotalUsd)}</td></tr>`).join('')}
        </tbody>
      </table>
    `);
  }

  return wrapPrintableDocument(`Draft Bill of Lading ${order.contract_no}`, `
    <div class="doc-header">
      <div><div class="brand">BILL OF LADING — DRAFT (${esc(meta?.bl_type || 'ORIGINAL B/L')})</div><div class="sub-brand">Port of Loading: ${esc(order.pol)} &rarr; Port of Discharge: ${esc(order.pod)}</div></div>
      <div class="doc-title"><h1>DRAFT B/L</h1><div class="meta">Booking No.: <strong>${esc(meta?.bk_no || 'TBA')}</strong></div></div>
    </div>
    <div class="grid-2">
      <div class="box"><h3>SHIPPER</h3><div><strong>${esc(COMPANY_INFO.name)}</strong></div><div>${esc(COMPANY_INFO.address)}</div></div>
      <div class="box"><h3>CONSIGNEE / NOTIFY PARTY</h3><div><strong>${esc(cus?.consignee_name || order.consignee_id)}</strong></div><div>${esc(cus?.address || '-')}</div><div>Tax: ${esc(cus?.tax || '-')} · Email: ${esc(cus?.email || '-')}</div></div>
    </div>
    <div class="box" style="margin-bottom:12px">
      <h3>CARRIAGE DETAILS</h3>
      <div>Vessel / Voyage: <strong>${esc(meta?.ves_voy || 'TBA')}</strong> · Container/Seal No.: <strong>${esc(meta?.cont_seal_list || prop?.container_type || 'TBA')}</strong></div>
      <div>Freight Term: <strong>${['CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'].includes(order.applied_incoterm) ? 'FREIGHT PREPAID' : 'FREIGHT COLLECT'}</strong></div>
    </div>
    <table>
      <thead><tr><th>Container / Marks</th><th>No. of Packages &amp; Description of Goods</th><th class="num">Gross Weight (KG)</th><th class="num">Measurement (CBM)</th></tr></thead>
      <tbody>
        <tr>
          <td>${esc(meta?.cont_seal_list || prop?.container_type || 'FCL/LCL')}</td>
          <td>${fmtNumber(prop?.total_cartons || pool.totalCartons)} Export Cartons<br/>${items.map((it) => `${esc(it.name_eng || it.name)} (${fmtNumber(it.weight)} KG Net)`).join('<br/>')}</td>
          <td class="num">${fmtNumber(prop?.total_gross_weight || pool.totalGrossWeightKg)} KG</td>
          <td class="num">${(toNum(prop?.total_cbm) || pool.totalCbm).toFixed(3)} CBM</td>
        </tr>
      </tbody>
    </table>
  `);
}

export function buildQuotationEmailSubject(inq: InquiryQuotation, prop: PricingProposal | undefined, extraMeta: ProposalExtraMeta | undefined, products: ProductCatalog[]): string {
  const items = parseOrderItems(inq, products);
  const itemNames = items.map((i) => stripInternalCodesForCustomer(i.name_eng || i.name)).filter(Boolean).slice(0, 2).join(', ') || 'Vietnamese Agricultural Products';
  const cleanRef = cleanQuoteNoForCustomer(extraMeta?.quotation_no || '', inq.order_id);
  return `[GREEN AGRI-EXPORTS] Official Quotation – ${itemNames} (${cleanRef})`;
}

export function buildQuotationEmailHtml(inq: InquiryQuotation, cus: ConsigneeDirectory | undefined, prop: PricingProposal | undefined, extraMeta: ProposalExtraMeta | undefined, sch: ShippingSchedule | undefined, products: ProductCatalog[], overrideIncoterm?: string, overrideSellingPrice?: number): string {
  const items = parseOrderItems(inq, products);
  const productLines = items.map((i) => `${i.name_eng || i.name} (${fmtNumber(i.weight)} KG)`).join(', ');
  const incoterm = overrideIncoterm || prop?.recommended_incoterm || inq.desired_incoterm || 'CIF';
  const totalPrice = overrideSellingPrice && overrideSellingPrice > 0 ? overrideSellingPrice : toNum(prop?.final_selling_price);
  const cleanRef = cleanQuoteNoForCustomer(extraMeta?.quotation_no || '', inq.order_id);

  return `Dear ${esc(cus?.contact_person || inq.contact || cus?.consignee_name || 'Valued Partner')},<br/><br/>
Thank you for your inquiry with <strong>GREEN AGRI-EXPORTS CO., LTD</strong>.<br/>
Please find below our quotation summary (Ref: <strong>${esc(cleanRef)}</strong>):<br/><br/>
• <strong>Products:</strong> ${esc(productLines)}<br/>
• <strong>Delivery Term:</strong> ${esc(incoterm)} ${esc(sch?.pod || 'Destination Port')} (Incoterms 2020)<br/>
• <strong>Total Value:</strong> <strong>$${formatCurrency(totalPrice)} USD</strong><br/>
• <strong>Payment Terms:</strong> ${esc(inq.proposed_payment_term || cus?.default_payment_term || 'T/T 30/70')}<br/><br/>
Detailed quotation breakdown is attached/available in our official quotation sheet. Please feel free to reply should you wish to confirm the order or discuss alternative Incoterms.<br/><br/>
Best regards,<br/>
<strong>${esc(inq.sale_rep || 'Export Sales Team')}</strong><br/>
GREEN AGRI-EXPORTS CO., LTD`;
}

export function buildExportEmailHtml(docType: string, order: OrderMaster, cus?: ConsigneeDirectory): string {
  return `Dear ${esc(cus?.contact_person || cus?.consignee_name || 'Valued Partner')},<br/><br/>
Please find attached the <strong>${esc(docType)}</strong> for Contract <strong>${esc(order.contract_no)}</strong> (${esc(order.pol)} &rarr; ${esc(order.pod)}).<br/>
Kindly review and confirm if any amendments are required prior to final issuance.<br/><br/>
Best regards,<br/>
<strong>Export Documentation Team</strong><br/>
GREEN AGRI-EXPORTS CO., LTD`;
}
