import type {
  ConsigneeDirectory,
  InquiryQuotation,
  OrderMaster,
  PricingProposal,
  ProductCatalog,
  ProposalExtraMeta,
  ShippingSchedule,
} from '../types';
import {
  cleanQuoteNoForCustomer,
  fmtNumber,
  formatCurrency,
  parseOrderItems,
  stripInternalCodesForCustomer,
  toNum,
} from './calculations';

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildQuotationEmailSubject(
  inq: InquiryQuotation,
  _prop: PricingProposal | undefined,
  _extraMeta: ProposalExtraMeta | undefined,
  products: ProductCatalog[]
): string {
  const items = parseOrderItems(inq, products);
  const itemNames =
    items
      .map((i) => stripInternalCodesForCustomer(i.name_eng || i.name))
      .filter(Boolean)
      .slice(0, 2)
      .join(', ') || 'Vietnamese Agricultural Products';
  return `[GREEN AGRI-EXPORTS] Official Quotation – ${itemNames}`;
}

export function buildQuotationEmailHtml(
  inq: InquiryQuotation,
  cus: ConsigneeDirectory | undefined,
  prop: PricingProposal | undefined,
  extraMeta: ProposalExtraMeta | undefined,
  sch: ShippingSchedule | undefined,
  products: ProductCatalog[],
  overrideIncoterm?: string,
  overrideSellingPrice?: number
): string {
  const items = parseOrderItems(inq, products);
  const productLines = items.map((i) => `${i.name_eng || i.name} (${fmtNumber(i.weight)} KG)`).join(', ');
  const incoterm = overrideIncoterm || prop?.recommended_incoterm || inq.desired_incoterm || 'CIF';
  const totalPrice =
    overrideSellingPrice && overrideSellingPrice > 0 ? overrideSellingPrice : toNum(prop?.final_selling_price);
  const cleanRef = cleanQuoteNoForCustomer(extraMeta?.quotation_no || '', inq.order_id);

  return `Dear ${esc(cus?.contact_person || inq.contact || cus?.consignee_name || 'Valued Partner')},<br/><br/>
Thank you for your inquiry with <strong>GREEN AGRI-EXPORTS CO., LTD</strong>.<br/>
Please find below our quotation summary (Ref: <strong>${esc(cleanRef)}</strong>):<br/><br/>
• <strong>Products:</strong> ${esc(productLines)}<br/>
• <strong>Delivery Term:</strong> ${esc(incoterm)} ${esc(sch?.pod || 'Destination Port')} (Incoterms 2020)<br/>
• <strong>Total Value:</strong> <strong>$${formatCurrency(totalPrice)} USD</strong><br/>
• <strong>Payment Terms:</strong> ${esc(inq.proposed_payment_term || cus?.default_payment_term || 'T/T 30/70')}<br/><br/>
Detailed quotation breakdown is attached in our official quotation file. Please feel free to reply should you wish to confirm the order or discuss alternative Incoterms.<br/><br/>
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
