export interface SysUser {
  id?: string | number;
  employee_id: string;
  full_name: string;
  department: string;
  role: string;
  email: string;
  status: string;
}

export interface ConsigneeDirectory {
  id?: string | number;
  consignee_id: string;
  consignee_name: string;
  country: string;
  address: string;
  tax: string;
  contact_person: string;
  phone: string;
  email: string;
  fax: string;
  default_payment_term: string;
  customer_type: string;
  order_count: number;
  created_date: string;
}

export interface ProductCatalog {
  id?: string | number;
  stt: number;
  product_group: string;
  sku_code: string;
  product_name_vie: string;
  product_name_eng: string;
  unit_price: number;
  hs_code: string;
  container_type: string;
  storage_temperature: string;
  image_url: string;
}

export interface PricingRate {
  id?: string | number;
  fee_category: string;
  fee_code: string;
  scope_or_cont_type: string;
  fee_name_vie: string;
  contract_text_eng: string;
  unit_basis: string;
  standard_rate: number;
  provider_or_rule: string;
  note: string;
  dim_cm: string;
  net_kg: number;
  tare_kg: number;
  max_per_pallet: number;
}

export interface ShippingSchedule {
  id?: string | number;
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
  rate_20dc: number;
  rate_40dc: number;
  rate_40hc: number;
  rate_20rf: number;
  rate_40rf: number;
  rate_40rh: number;
  baf_fee: number;
  lss_fee: number;
  pss_fee: number;
  bl_fee: number;
  seal_fee: number;
  updated_date: string;
  expiry_date: string;
  thc_20_dry: number;
  thc_40_dry: number;
  thc_20_reefer: number;
  thc_40_reefer: number;
  bill_seal_fee_shipment: number;
}

export interface IncotermsHandbook {
  id?: string | number;
  stt: number;
  incoterms_code: string;
  incoterm_group: string;
  full_name: string;
  transport_mode: string;
  contract_text_eng: string;
  freight_term: string;
  freight_payer: string;
  insurance_payer: string;
  export_customs: string;
  import_customs: string;
  risk_transfer_point: string;
  activation_condition: string;
  risk_benefit_seller: string;
  note: string;
  practical_notes_vie: string;
  seller_cost_scope: string;
}

export interface SystemLookup {
  id?: string | number;
  category: string;
  code: string;
  scope: string;
  display_name_vie: string;
  contract_text_eng: string;
  extra_value: string | number;
}

export interface TemplateManager {
  id?: string | number;
  template_id: string;
  document_name: string;
  google_doc_file_id: string;
  target_department: string;
  status: string;
  supported_placeholders: string;
}

export interface TemplatePlaceholder {
  id?: string | number;
  placeholder_key: string;
  scope: string;
  source_table: string;
  source_column: string;
  description_vie: string;
  is_auto_created?: boolean;
}

export interface InquiryQuotation {
  id?: string | number;
  order_id: string;
  timestamp: string;
  sale_rep: string;
  consignee_id: string;
  address: string;
  contact: string;
  email: string;
  phone: string;
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
  customer_confirm_note: string;
  sent_mail_link: string;
}

export interface PricingProposal {
  id?: string | number;
  order_id: string;
  xnk_rep: string;
  schedule_id: string;
  container_type: string;
  container_qty: number;
  total_freight_local: number;
  insurance_cost: number;
  goods_cost: number;
  recommended_incoterm: string;
  final_selling_price: number;
  booking_date: string;
  booking_status: string;
  packing_pallet_cost: number;
  insurance_code: string;
  total_cartons: number;
  total_pallets: number;
  pallet_fee: number;
  total_gross_weight: number;
  total_cbm: number;
  proposed_incoterms: string;
}

export interface OrderMaster {
  id?: string | number;
  order_id: string;
  contract_no: string;
  contract_date: string;
  in_charge_staff: string;
  consignee_id: string;
  sku_code: string;
  nw_confirmed_kgs: number;
  applied_incoterm: string;
  contract_value: number;
  payment_terms: string;
  pol: string;
  pod: string;
  fulfillment_status: string;
  co_form: string;
  contract_link: string;
}

export interface OrderItem {
  sku: string;
  name: string;
  name_eng?: string;
  weight: number;
  packingCode: string;
  packingName: string;
  packingExtra: number;
  palletCode: string;
  cartons: number;
  pallets: number;
  tareKg?: number;
  grossWeightKg?: number;
  cbm?: number;
  packingCost: number;
}

export interface OrderLogisticsMeta {
  order_id: string;
  booking_source?: 'CARRIER' | 'FWD' | '';
  carrier_bk_no?: string;
  fwd_bk_no?: string;
  bk_no?: string;
  cargo_mode?: 'FCL' | 'LCL' | '';
  cont_seal_list?: string;
  ves_voy?: string;
  bl_type?: string;
  template_id?: string;
  fwd_name?: string;
  cfs_warehouse?: string;
  pod_agent?: string;
  si_cutoff?: string;
  vgm_cutoff?: string;
  cfs_cutoff?: string;
  cy_cutoff?: string;
  customs_cutoff?: string;
  draft_bl_cutoff?: string;
  exact_fulfillment_status?: string;
  signed_date?: string;
  is_locked?: boolean;
  sent_to_sales?: boolean;
  invoice_link?: string;
  packing_list_link?: string;
  co_link?: string;
  bl_link?: string;
}

export interface ProposalExtraMeta {
  order_id: string;
  quotation_no: string;
  floor_price_usd: number;
  min_margin_pct: number;
  margin_pct: number;
  exw_price: number;
  fob_price: number;
  cfr_price: number;
  cif_price: number;
  dest_extra?: number;
  freight_exec_option?: 'SELF' | 'HYBRID' | 'FWD_ALL';
  self_trucking?: number;
  fwd_ocean?: number;
  fwd_trucking?: number;
  fwd_customs?: number;
  fwd_permits?: number;
  internal_cost_usd?: number;
  buyer_charge_usd?: number;
  internal_profit_usd?: number;
  use_pallet?: boolean;
  lcl_basis?: 'CBM' | 'TON';
  lcl_rate?: number;
  note?: string;
}

export interface AppDataState {
  users: SysUser[];
  consignees: ConsigneeDirectory[];
  products: ProductCatalog[];
  pricingRates: PricingRate[];
  schedules: ShippingSchedule[];
  incoterms: IncotermsHandbook[];
  lookups: SystemLookup[];
  templates: TemplateManager[];
  templatePlaceholders: TemplatePlaceholder[];
  inquiries: InquiryQuotation[];
  proposals: PricingProposal[];
  orders: OrderMaster[];
}

export type RoleType = 'SALES' | 'XNK' | 'ADMIN';

export type ViewId =
  | 'dashboard'
  | 'sales-inquiry'
  | 'sales-quotation'
  | 'sales-contracts'
  | 'sales-customers'
  | 'xnk-pricing'
  | 'xnk-contract'
  | 'xnk-documents'
  | 'xnk-shipping'
  | 'xnk-rates'
  | 'master-products'
  | 'admin-templates'
  | 'admin-users';

export interface ToastMessage {
  id: number;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
}
