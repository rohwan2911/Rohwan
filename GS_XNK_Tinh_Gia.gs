/**
 * ============================================================================
 * HỆ THỐNG QUẢN LÝ XUẤT KHẨU NÔNG SẢN - NÔNG SẢN XANH
 * File: GS_XNK_Tinh_Gia.gs (Lịch tàu, Phụ phí, Phương án giá & Tư vấn AI)
 * ============================================================================
 */

var DEFAULT_PACKING_AND_CONTAINER_RATES_SERVER_ = [
  { Fee_Category: "PACKING", Fee_Code: "PKG-JAR-250", Scope_or_ContType: "ALL", Fee_Name_VIE: "Hũ PET 250g + Thùng Carton (24 hũ / 6kg)", Contract_Text_ENG: "250g PET Jars in 6kg Export Carton (24 Jars)", Unit_Basis: "Carton", Standard_Rate: 0.42, Provider_or_Rule: "6", Note: "Hàng gia vị đóng hũ PET 250g", Dim_CM: "36x28x22", Net_KG: 6, Tare_KG: 0.9, Max_Per_Pallet: 60 },
  { Fee_Category: "PACKING", Fee_Code: "PKG-JAR-500", Scope_or_ContType: "ALL", Fee_Name_VIE: "Hũ PET 500g + Thùng Carton (12 hũ / 6kg)", Contract_Text_ENG: "500g PET Jars in 6kg Export Carton (12 Jars)", Unit_Basis: "Carton", Standard_Rate: 0.36, Provider_or_Rule: "6", Note: "Hàng gia vị đóng hũ PET 500g", Dim_CM: "38x28x24", Net_KG: 6, Tare_KG: 0.85, Max_Per_Pallet: 55 },
  { Fee_Category: "PACKING", Fee_Code: "PKG-ZIP-250", Scope_or_ContType: "ALL", Fee_Name_VIE: "Túi Zipper Kraft 250g + Thùng (20 túi / 5kg)", Contract_Text_ENG: "250g Kraft Zipper Pouches in 5kg Carton (20 Pouches)", Unit_Basis: "Carton", Standard_Rate: 0.32, Provider_or_Rule: "5", Note: "Bao bì bán lẻ hạt/gia vị", Dim_CM: "36x26x22", Net_KG: 5, Tare_KG: 0.65, Max_Per_Pallet: 64 },
  { Fee_Category: "PACKING", Fee_Code: "PKG-ZIP-500", Scope_or_ContType: "ALL", Fee_Name_VIE: "Túi Zipper Kraft 500g + Thùng (10 túi / 5kg)", Contract_Text_ENG: "500g Kraft Zipper Pouches in 5kg Carton (10 Pouches)", Unit_Basis: "Carton", Standard_Rate: 0.28, Provider_or_Rule: "5", Note: "Bao bì bán lẻ 500g", Dim_CM: "36x28x24", Net_KG: 5, Tare_KG: 0.6, Max_Per_Pallet: 60 },
  { Fee_Category: "PACKING", Fee_Code: "PKG-VAC-1K", Scope_or_ContType: "ALL", Fee_Name_VIE: "Túi Hút Chân Không 1kg + Thùng 10kg (10 túi)", Contract_Text_ENG: "Vacuum PE Bag 1kg in 10kg Carton (10 Bags)", Unit_Basis: "Carton", Standard_Rate: 0.24, Provider_or_Rule: "10", Note: "Hạt điều/tiêu hút chân không", Dim_CM: "40x30x25", Net_KG: 10, Tare_KG: 0.8, Max_Per_Pallet: 50 },
  { Fee_Category: "PACKING", Fee_Code: "PKG-CTN-5K", Scope_or_ContType: "ALL", Fee_Name_VIE: "Thùng Carton 5 lớp lót túi PE 5kg", Contract_Text_ENG: "5kg 5-Ply Corrugated Carton with PE Liner", Unit_Basis: "Carton", Standard_Rate: 0.19, Provider_or_Rule: "5", Note: "Thùng khô tiêu chuẩn 5kg", Dim_CM: "38x28x20", Net_KG: 5, Tare_KG: 0.55, Max_Per_Pallet: 64 },
  { Fee_Category: "PACKING", Fee_Code: "PKG-CTN-10K", Scope_or_ContType: "ALL", Fee_Name_VIE: "Thùng Carton 5 lớp lót túi PE 10kg", Contract_Text_ENG: "10kg 5-Ply Corrugated Carton with PE Liner", Unit_Basis: "Carton", Standard_Rate: 0.25, Provider_or_Rule: "10", Note: "Thùng tiêu chuẩn 10kg", Dim_CM: "42x32x26", Net_KG: 10, Tare_KG: 0.85, Max_Per_Pallet: 48 },
  { Fee_Category: "PACKING", Fee_Code: "PKG-IQF-1K", Scope_or_ContType: "REEFER", Fee_Name_VIE: "Túi PE cấp đông IQF 1kg + Thùng chống ẩm 10kg", Contract_Text_ENG: "1kg IQF PE Bags in 10kg Moisture-Proof Carton", Unit_Basis: "Carton", Standard_Rate: 0.34, Provider_or_Rule: "10", Note: "Hàng cấp đông container lạnh", Dim_CM: "40x30x26", Net_KG: 10, Tare_KG: 0.95, Max_Per_Pallet: 45 },
  { Fee_Category: "PACKING", Fee_Code: "PKG-IQF-5K", Scope_or_ContType: "REEFER", Fee_Name_VIE: "Bao PE khối IQF 5kg + Thùng chống ẩm 15kg", Contract_Text_ENG: "5kg IQF Block Bags in 15kg Waxed Carton", Unit_Basis: "Carton", Standard_Rate: 0.31, Provider_or_Rule: "15", Note: "Hàng cấp đông bulk 15kg", Dim_CM: "45x32x28", Net_KG: 15, Tare_KG: 1.15, Max_Per_Pallet: 40 },
  { Fee_Category: "PACKING", Fee_Code: "PKG-PLT-YES", Scope_or_ContType: "ALL", Fee_Name_VIE: "Pallet Nhựa / Gỗ Hun Trùng ISPM-15 (Đế pallet + Quấn màng PE)", Contract_Text_ENG: "Heat-Treated ISPM-15 Export Pallet with Stretch Film", Unit_Basis: "Pallet", Standard_Rate: 18, Provider_or_Rule: "50 thùng/pallet", Note: "Tải trọng Pallet + màng quấn 18kg · 0.17 CBM/pallet", Dim_CM: "120x100x14.17", Net_KG: 0, Tare_KG: 18, Max_Per_Pallet: 50 },
  { Fee_Category: "PACKING", Fee_Code: "PKG-PLT-NO", Scope_or_ContType: "ALL", Fee_Name_VIE: "Không dùng Pallet (Xếp sàn container - Floor Load)", Contract_Text_ENG: "Loose Floor-Loaded in Container (No Pallet)", Unit_Basis: "Pallet", Standard_Rate: 0, Provider_or_Rule: "Xếp rời tối ưu thể tích", Note: "Không phát sinh phí & bì pallet", Dim_CM: "0x0x0", Net_KG: 0, Tare_KG: 0, Max_Per_Pallet: 0 },
  { Fee_Category: "CONTAINER", Fee_Code: "CONT-20GP", Scope_or_ContType: "20'DC", Fee_Name_VIE: "Container 20' Khô tiêu chuẩn (20'DC / 20GP)", Contract_Text_ENG: "20ft General Purpose Dry Container", Unit_Basis: "Container", Standard_Rate: 0, Provider_or_Rule: "Max 22,000 KG / 28 CBM / 10 Pallet", Note: "Khuyến nghị hàng khô nặng", Dim_CM: "589x235x239", Net_KG: 22000, Tare_KG: 28, Max_Per_Pallet: 10 },
  { Fee_Category: "CONTAINER", Fee_Code: "CONT-40GP", Scope_or_ContType: "40'DC", Fee_Name_VIE: "Container 40' Khô tiêu chuẩn (40'DC / 40GP)", Contract_Text_ENG: "40ft General Purpose Dry Container", Unit_Basis: "Container", Standard_Rate: 0, Provider_or_Rule: "Max 26,000 KG / 58 CBM / 20 Pallet", Note: "Tối ưu hàng thể tích lớn", Dim_CM: "1203x235x239", Net_KG: 26000, Tare_KG: 58, Max_Per_Pallet: 20 },
  { Fee_Category: "CONTAINER", Fee_Code: "CONT-40HC", Scope_or_ContType: "40'HC", Fee_Name_VIE: "Container 40' Khô Cao (40'HC)", Contract_Text_ENG: "40ft High-Cube Dry Container", Unit_Basis: "Container", Standard_Rate: 0, Provider_or_Rule: "Max 26,480 KG / 76 CBM / 21 Pallet", Note: "Ưu tiên cho hàng nhẹ thể tích lớn", Dim_CM: "1203x235x269", Net_KG: 26480, Tare_KG: 76, Max_Per_Pallet: 21 },
  { Fee_Category: "CONTAINER", Fee_Code: "CONT-20RF", Scope_or_ContType: "20'RF", Fee_Name_VIE: "Container 20' Lạnh (20'RF)", Contract_Text_ENG: "20ft Reefer Container", Unit_Basis: "Container", Standard_Rate: 0, Provider_or_Rule: "Max 21,000 KG / 24 CBM / 9 Pallet", Note: "Hàng tươi / cấp đông lô nhỏ", Dim_CM: "544x229x227", Net_KG: 21000, Tare_KG: 24, Max_Per_Pallet: 9 },
  { Fee_Category: "CONTAINER", Fee_Code: "CONT-40RF", Scope_or_ContType: "40'RF", Fee_Name_VIE: "Container 40' Lạnh Tiêu Chuẩn (40'RF)", Contract_Text_ENG: "40ft Standard Reefer Container", Unit_Basis: "Container", Standard_Rate: 0, Provider_or_Rule: "Max 25,500 KG / 52 CBM / 20 Pallet", Note: "Hàng tươi / cấp đông xuất khẩu", Dim_CM: "1156x229x250", Net_KG: 25500, Tare_KG: 52, Max_Per_Pallet: 20 },
  { Fee_Category: "CONTAINER", Fee_Code: "CONT-40RH", Scope_or_ContType: "40'RH", Fee_Name_VIE: "Container 40' Lạnh Cao (40'RH)", Contract_Text_ENG: "40ft High-Cube Reefer Container", Unit_Basis: "Container", Standard_Rate: 0, Provider_or_Rule: "Max 25,980 KG / 67 CBM / 20 Pallet", Note: "Hàng tươi / cấp đông thể tích lớn", Dim_CM: "1158x229x255", Net_KG: 25980, Tare_KG: 67, Max_Per_Pallet: 20 }
];

var DEFAULT_INSURANCE_RATES_SERVER_ = [
  { Fee_Category: "INSURANCE", Fee_Code: "INS-NONE", Scope_or_ContType: "ALL", Fee_Name_VIE: "Không mua bảo hiểm (Người mua tự chịu)", Contract_Text_ENG: "", Unit_Basis: "%_CIF_110", Standard_Rate: 0, Provider_or_Rule: "Buyer Open Policy", Note: "Áp dụng cho EXW/FCA/FAS/FOB/CFR/CPT" },
  { Fee_Category: "INSURANCE", Fee_Code: "INS-ICC-C", Scope_or_ContType: "DC", Fee_Name_VIE: "Bảo hiểm cơ bản ICC (C) - Tối thiểu CIF", Contract_Text_ENG: "Institute Cargo Clauses (C) 110% CIF", Unit_Basis: "%_CIF_110", Standard_Rate: 0.12, Provider_or_Rule: "PVI / Bảo Việt (110% CIF)", Note: "Mức tối thiểu bắt buộc cho CIF hàng khô" },
  { Fee_Category: "INSURANCE", Fee_Code: "INS-ICC-B", Scope_or_ContType: "DC", Fee_Name_VIE: "Bảo hiểm mở rộng ICC (B) - Hàng khô", Contract_Text_ENG: "Institute Cargo Clauses (B) 110% CIF", Unit_Basis: "%_CIF_110", Standard_Rate: 0.18, Provider_or_Rule: "PVI / Bảo Việt (110% CIF)", Note: "Hàng khô dễ hư hại do nước biển/ẩm ướt" },
  { Fee_Category: "INSURANCE", Fee_Code: "INS-ICC-A", Scope_or_ContType: "ALL", Fee_Name_VIE: "Bảo hiểm mọi rủi ro ICC (A) - Chuẩn CIP", Contract_Text_ENG: "Institute Cargo Clauses (A) 110% CIF", Unit_Basis: "%_CIF_110", Standard_Rate: 0.25, Provider_or_Rule: "PVI / Bảo Việt (110% CIF/CIP)", Note: "Mức bắt buộc cho CIP & nông sản giá trị cao" },
  { Fee_Category: "INSURANCE", Fee_Code: "INS-FRZ-A", Scope_or_ContType: "RF", Fee_Name_VIE: "Bảo hiểm hàng đông lạnh (Frozen Food Clauses A)", Contract_Text_ENG: "Institute Frozen Food Clauses (A) 110% CIF", Unit_Basis: "%_CIF_110", Standard_Rate: 0.35, Provider_or_Rule: "PVI / Bảo Việt (Reefer -18°C)", Note: "Khuyến nghị bắt buộc cho container lạnh RF" },
  { Fee_Category: "INSURANCE", Fee_Code: "INS-EXT-SWH", Scope_or_ContType: "ADD-ON", Fee_Name_VIE: "Điều khoản mở rộng: Rủi ro hấp hơi, nóng ẩm", Contract_Text_ENG: "incl. Sweating & Heating Clause", Unit_Basis: "%_CIF_110", Standard_Rate: 0.05, Provider_or_Rule: "Add-on hàng khô (DC)", Note: "Chống hấp hơi, mốc nóng ẩm cho nông sản khô" },
  { Fee_Category: "INSURANCE", Fee_Code: "INS-EXT-WAR", Scope_or_ContType: "ADD-ON", Fee_Name_VIE: "Điều khoản mở rộng: Chiến tranh & Đình công", Contract_Text_ENG: "incl. Institute War & Strikes Clauses", Unit_Basis: "%_CIF_110", Standard_Rate: 0.03, Provider_or_Rule: "Add-on tuyến rủi ro", Note: "Áp dụng tuyến biển qua vùng xung đột/đình công" },
  { Fee_Category: "INSURANCE", Fee_Code: "INS-EXT-TPND", Scope_or_ContType: "ADD-ON", Fee_Name_VIE: "Điều khoản mở rộng: Trộm cắp & Nước ngọt", Contract_Text_ENG: "incl. TPND & Fresh Water Damage Clauses", Unit_Basis: "%_CIF_110", Standard_Rate: 0.04, Provider_or_Rule: "Add-on hàng giá trị cao", Note: "Chống mất cắp, thiếu hụt & thấm nước ngọt" }
];

function getInsuranceRatesCatalogServer_(ramRates, ss) {
  var src = Array.isArray(ramRates) && ramRates.length > 0 ? ramRates : readSheetAsObjects_("Pricing_Rates", ss);
  var byCode = {};
  var list = [];
  for (var i = 0; i < (src || []).length; i++) {
    var r = src[i];
    if (!r) continue;
    var cat = String(r["Fee_Category"] || r["Category"] || "").trim().toUpperCase();
    var code = String(r["Fee_Code"] || "").trim().toUpperCase();
    if (cat === "INSURANCE" && code) {
      var item = {
        Fee_Code: code,
        Scope_or_ContType: String(r["Scope_or_ContType"] || "ALL").trim(),
        Fee_Name_VIE: String(r["Fee_Name_VIE"] || code).trim(),
        Contract_Text_ENG: String(r["Contract_Text_ENG"] || "").trim(),
        Standard_Rate: parseSmartNumber_(r["Standard_Rate"] !== undefined && r["Standard_Rate"] !== "" ? r["Standard_Rate"] : r["Standard_Fee"]),
        Note: String(r["Note"] || "").trim()
      };
      byCode[code] = item;
      list.push(item);
    }
  }
  for (var d = 0; d < DEFAULT_INSURANCE_RATES_SERVER_.length; d++) {
    var def = DEFAULT_INSURANCE_RATES_SERVER_[d];
    if (!byCode[def.Fee_Code]) {
      byCode[def.Fee_Code] = def;
      list.push(def);
    }
  }
  return { list: list, byCode: byCode };
}

function buildCombinedInsuranceClauseServer_(insuranceCodeRaw, pricingRates) {
  var raw = String(insuranceCodeRaw || "").trim();
  if (!raw) return "";
  var codes = raw.split(/[+,;]+/).map(function (c) { return String(c || "").trim().toUpperCase(); }).filter(Boolean);
  if (codes.length === 0 || codes[0] === "INS-NONE") return "";
  var catalog = getInsuranceRatesCatalogServer_(pricingRates);
  var baseItem = catalog.byCode[codes[0]];
  var baseEng = baseItem && baseItem.Contract_Text_ENG ? baseItem.Contract_Text_ENG : "";
  var addonEngs = [];
  for (var i = 1; i < codes.length; i++) {
    var ext = catalog.byCode[codes[i]];
    if (ext && ext.Contract_Text_ENG) {
      addonEngs.push(ext.Contract_Text_ENG.replace(/^incl\.?\s*/i, "").trim());
    }
  }
  var cleanBase = baseEng.replace(/\s*\(\s*\d+(?:\.\d+)?\s*%\s*\)/g, "").trim();
  if (addonEngs.length === 0) return cleanBase;
  return (cleanBase ? (cleanBase + " incl. ") : "incl. ") + addonEngs.join(", ");
}

function parseDimCmToCbmServer_(dimCm) {
  var m = String(dimCm || "").trim().match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
  if (!m) return 0;
  var l = parseSmartNumber_(m[1]);
  var w = parseSmartNumber_(m[2]);
  var h = parseSmartNumber_(m[3]);
  return (l > 0 && w > 0 && h > 0) ? (l * w * h) / 1000000 : 0;
}

function resolvePackingSpecServer_(packingCode, pricingRates) {
  var rawCode = String(packingCode || "").trim().toUpperCase();
  if (rawCode === "PKG-POUCH-1K") rawCode = "PKG-VAC-1K";
  var rates = pricingRates || [];
  var row = null;
  for (var i = 0; i < rates.length; i++) {
    var cat = String(rates[i]["Fee_Category"] || rates[i]["Category"] || "").trim().toUpperCase();
    var code = String(rates[i]["Fee_Code"] || "").trim().toUpperCase();
    if (cat === "PACKING" && code === rawCode) {
      row = rates[i];
      break;
    }
  }
  var def = null;
  for (var d = 0; d < DEFAULT_PACKING_AND_CONTAINER_RATES_SERVER_.length; d++) {
    if (DEFAULT_PACKING_AND_CONTAINER_RATES_SERVER_[d].Fee_Code === rawCode) {
      def = DEFAULT_PACKING_AND_CONTAINER_RATES_SERVER_[d];
      break;
    }
  }
  if (!def && !row) def = DEFAULT_PACKING_AND_CONTAINER_RATES_SERVER_[6]; // PKG-CTN-10K fallback
  var dimCm = String((row && row["Dim_CM"]) || (def && def.Dim_CM) || "40x30x25");
  var cbmPerCarton = parseDimCmToCbmServer_(dimCm) || 0.03;
  var netKg = parseSmartNumber_(row && row["Net_KG"]);
  if (netKg <= 0) netKg = parseSmartNumber_(row && row["Unit_Weight_KG"]);
  if (netKg <= 0) netKg = parseSmartNumber_(def && def.Net_KG);
  if (netKg <= 0) netKg = parseSmartNumber_(row && row["Provider_or_Rule"]) || 10;
  var tareKg = parseSmartNumber_(row && row["Tare_KG"]) || parseSmartNumber_(def && def.Tare_KG) || 0.8;
  var maxPerPallet = parseSmartNumber_(row && row["Max_Per_Pallet"]) || parseSmartNumber_(def && def.Max_Per_Pallet) || 50;
  var rate = parseSmartNumber_(row && row["Standard_Rate"]) || parseSmartNumber_(row && row["Rate_Value"]) || parseSmartNumber_(def && def.Standard_Rate) || 0;
  var nameVie = String((row && row["Fee_Name_VIE"]) || (def && def.Fee_Name_VIE) || rawCode || "Thùng xuất khẩu");
  var engText = String((row && row["Contract_Text_ENG"]) || (def && def.Contract_Text_ENG) || nameVie);
  return {
    code: rawCode || "PKG-CTN-10K",
    dimCm: dimCm,
    cbmPerCarton: cbmPerCarton,
    netKgPerCarton: netKg,
    tareKgPerCarton: tareKg,
    maxPerPallet: maxPerPallet,
    rate: rate,
    nameVie: nameVie,
    engText: engText
  };
}

function computeOrderPackingSpecsServer_(orderItems, pricingRates, usePalletOpt) {
  var items = orderItems || [];
  var rates = pricingRates || [];
  var pltYesSpec = resolvePackingSpecServer_("PKG-PLT-YES", rates);
  var pltTarePerUnit = pltYesSpec.tareKgPerCarton > 0 ? pltYesSpec.tareKgPerCarton : 18;
  var pltRate = pltYesSpec.rate > 0 ? pltYesSpec.rate : 18;
  var pltBaseCbm = parseDimCmToCbmServer_(pltYesSpec.dimCm) || 0.17;

  var cargoNetKg = 0;
  var packingTareKg = 0;
  var cargoCbm = 0;
  var totalCartons = 0;
  var rawPalletFractions = 0;
  var anyUsePlt = (usePalletOpt === true);
  var distinctPackSpecs = {};
  var breakdown = [];

  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var w = parseSmartNumber_(it.weight);
    var pCode = String(it.packingCode || "").trim();
    var spec = resolvePackingSpecServer_(pCode, rates);
    var cartons = w > 0 ? Math.ceil(w / Math.max(0.1, spec.netKgPerCarton)) : 0;
    var itemPackingTare = cartons * spec.tareKgPerCarton;
    var itemCbm = cartons * spec.cbmPerCarton;
    var itemUsePlt = (usePalletOpt === true) || (String(it.palletCode || "").toUpperCase() === "PKG-PLT-YES");
    if (itemUsePlt) anyUsePlt = true;
    var itemFracPlt = (itemUsePlt && cartons > 0 && spec.maxPerPallet > 0) ? (cartons / spec.maxPerPallet) : 0;
    rawPalletFractions += itemFracPlt;
    if (cartons > 0 && spec.code) {
      distinctPackSpecs[String(spec.code).toUpperCase()] = true;
    }

    cargoNetKg += w;
    packingTareKg += itemPackingTare;
    cargoCbm += itemCbm;
    totalCartons += cartons;

    breakdown.push({
      sku: String(it.sku || ""),
      cartons: cartons,
      pallets: itemFracPlt > 0 ? Math.ceil(itemFracPlt) : 0,
      nw: Number(w.toFixed(2)),
      tareKg: Number(itemPackingTare.toFixed(2)),
      gw: Number((w + itemPackingTare).toFixed(2)),
      cbm: Number(itemCbm.toFixed(3)),
      packEng: spec.engText,
      packVie: spec.nameVie,
      packingCost: Number((cartons * spec.rate).toFixed(2))
    });
  }

  var hasMixedPacking = Object.keys(distinctPackSpecs).length >= 2;
  var palletLossFactor = hasMixedPacking ? 1.05 : 1.0;
  var totalPallets = (anyUsePlt && rawPalletFractions > 0) ? Math.ceil(rawPalletFractions * palletLossFactor) : 0;
  var palletTareKg = totalPallets * pltTarePerUnit;
  var palletCbm = totalPallets * pltBaseCbm;
  var totalGrossWeightKg = Number((cargoNetKg + packingTareKg + palletTareKg).toFixed(2));
  var totalCbm = Number((cargoCbm + palletCbm).toFixed(3));
  return {
    cargoNetKg: Number(cargoNetKg.toFixed(2)),
    packingTareKg: Number(packingTareKg.toFixed(2)),
    palletTareKg: Number(palletTareKg.toFixed(2)),
    totalGrossWeightKg: totalGrossWeightKg,
    cargoCbm: Number(cargoCbm.toFixed(3)),
    palletCbm: Number(palletCbm.toFixed(3)),
    totalCbm: totalCbm,
    totalCartons: totalCartons,
    totalPallets: totalPallets,
    palletLossApplied: hasMixedPacking,
    palletFee: totalPallets > 0 ? Number((totalPallets * pltRate).toFixed(2)) : 0,
    breakdown: breakdown
  };
}

function enrichPricingRatesWithDefaultsServer_(pricingRates) {
  var list = (pricingRates || []).slice();
  var byCode = {};
  for (var i = 0; i < list.length; i++) {
    var code = String(list[i]["Fee_Code"] || "").trim().toUpperCase();
    if (!code) continue;
    byCode[code] = list[i];
  }
  for (var d = 0; d < DEFAULT_PACKING_AND_CONTAINER_RATES_SERVER_.length; d++) {
    var def = DEFAULT_PACKING_AND_CONTAINER_RATES_SERVER_[d];
    var existing = byCode[def.Fee_Code];
    if (existing) {
      if (!existing["Dim_CM"]) existing["Dim_CM"] = def.Dim_CM;
      if (existing["Net_KG"] === undefined || existing["Net_KG"] === "") existing["Net_KG"] = def.Net_KG;
      if (existing["Tare_KG"] === undefined || existing["Tare_KG"] === "") existing["Tare_KG"] = def.Tare_KG;
      if (existing["Max_Per_Pallet"] === undefined || existing["Max_Per_Pallet"] === "") existing["Max_Per_Pallet"] = def.Max_Per_Pallet;
    } else {
      list.push(Object.assign({}, def));
    }
  }
  return list;
}

function generateNextScheduleId_(schedules) {
  var maxNum = 0;
  for (var i = 0; i < (schedules || []).length; i++) {
    var sid = String(schedules[i]["Schedule_ID"] || "");
    var m = sid.match(/(?:LT|SCH-?)(\d+)/i);
    if (m) {
      var n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  return "LT" + ("000" + (maxNum + 1)).slice(-3);
}

/**
 * Tính Cước biển & Tổng Phụ phí tàu từ một dòng Shipping_Schedule cho cả FCL, LCL và hỗn hợp FCL+LCL.
 * - FCL: cộng đủ THC theo loại cont (THC_20_Dry, THC_40_Dry, THC_20_Reefer, THC_40_Reefer)
 *        + phí chứng từ/seal (ưu tiên Bill_Seal_Fee_Shipment, nếu = 0 mới dùng B/L_Fee + Seal_Fee * totalCont để tránh tính trùng)
 *        + (BAF_Fee + LSS_Fee + PSS_Fee) * totalCont.
 * - LCL / hỗn hợp FCL+LCL: tính cước & phụ phí LCL tỷ lệ theo W/M (CBM/tấn) dựa trên giá LCL thực tế hoặc quy đổi từ giá cont 20' của chính hãng tàu đó.
 */
function computeScheduleOceanAndSurchargesServer_(sch, mix) {
  mix = mix || {};
  var q20dc = Math.max(0, parseSmartNumber_(mix.q20dc || 0));
  var q40dc = Math.max(0, parseSmartNumber_(mix.q40dc || 0));
  var q40hc = Math.max(0, parseSmartNumber_(mix.q40hc || 0));
  var q20rf = Math.max(0, parseSmartNumber_(mix.q20rf || 0));
  var q40rf = Math.max(0, parseSmartNumber_(mix.q40rf || 0));
  var q40rh = Math.max(0, parseSmartNumber_(mix.q40rh || 0));
  var totalCont = q20dc + q40dc + q40hc + q20rf + q40rf + q40rh;
  var hasLcl = Boolean(mix.hasLcl);

  if (!sch) {
    return { ocean: Math.round(parseSmartNumber_(mix.lclFreight || 0) * 100) / 100, surcharge: 0 };
  }

  var r20dc = parseSmartNumber_(sch["Rate_20DC"]);
  var r40dc = parseSmartNumber_(sch["Rate_40DC"]);
  var r40hc = parseSmartNumber_(sch["Rate_40HC"]) || (r40dc > 0 ? Math.round(r40dc * 1.05) : 0);
  var r20rf = parseSmartNumber_(sch["Rate_20'RF"]);
  var r40rf = parseSmartNumber_(sch["Rate_40'RF"]);
  var r40rh = parseSmartNumber_(sch["Rate_40'RH"]) || (r40rf > 0 ? Math.round(r40rf * 1.05) : 0);

  var thc20d = parseSmartNumber_(sch["THC_20_Dry"]);
  var thc40d = parseSmartNumber_(sch["THC_40_Dry"]);
  var thc20r = parseSmartNumber_(sch["THC_20_Reefer"]);
  var thc40r = parseSmartNumber_(sch["THC_40_Reefer"]);
  var billSealShipment = parseSmartNumber_(sch["Bill_Seal_Fee_Shipment"]);
  var blFee = parseSmartNumber_(sch["B/L_Fee"]);
  var sealFee = parseSmartNumber_(sch["Seal_Fee"]);
  var bafFee = parseSmartNumber_(sch["BAF_Fee"]);
  var lssFee = parseSmartNumber_(sch["LSS_Fee"]);
  var pssFee = parseSmartNumber_(sch["PSS_Fee"]);
  var perContFuelPeak = bafFee + lssFee + pssFee;

  var dry40Count = q40dc + q40hc;
  var rf40Count = q40rf + q40rh;

  var fclOcean = (q20dc * r20dc) + (q40dc * r40dc) + (q40hc * r40hc) + (q20rf * r20rf) + (q40rf * r40rf) + (q40rh * r40rh);
  var fclSurcharge = 0;
  if (totalCont > 0) {
    var fclThc = (q20dc * thc20d) + (dry40Count * thc40d) + (q20rf * thc20r) + (rf40Count * thc40r);
    var docSealFee = billSealShipment > 0 ? billSealShipment : (blFee + sealFee * totalCont);
    fclSurcharge = fclThc + docSealFee + (perContFuelPeak * totalCont);
  }

  var lclOcean = 0;
  var lclSurcharge = 0;
  if (hasLcl) {
    var explicitLclRate = parseSmartNumber_(sch["LCL_Rate_CBM"] || sch["LCL_Rate_WM"] || sch["LCL_Rate"] || sch["Rate_LCL"] || 0);
    var lclDryWm = Math.max(0, parseSmartNumber_(mix.lclDryWm || 0));
    var lclRfWm = Math.max(0, parseSmartNumber_(mix.lclRfWm || 0));
    if (lclDryWm <= 0 && lclRfWm <= 0) {
      var fallbackWm = Math.max(parseSmartNumber_(mix.lclWeightKg || 0) / 1000, parseSmartNumber_(mix.lclCbm || 0));
      if (String(mix.reeferMode || "").toUpperCase() === "LCL") lclRfWm = fallbackWm;
      else lclDryWm = fallbackWm;
    }

    var fallbackLclRate = Math.max(0, parseSmartNumber_(mix.lclRate || 0));
    if (lclDryWm > 0) {
      var base20Dry = r20dc > 0 ? r20dc : (r40dc > 0 ? r40dc * 0.65 : (r40hc > 0 ? r40hc * 0.6 : 0));
      var dryUnitWm = explicitLclRate > 0 ? explicitLclRate : (base20Dry > 0 ? (base20Dry / 28) : fallbackLclRate);
      lclOcean += dryUnitWm * lclDryWm;
      var dryRatio = lclDryWm / 28;
      var dryThcBase = thc20d > 0 ? thc20d : (thc40d > 0 ? thc40d * 0.65 : 0);
      lclSurcharge += dryRatio * (dryThcBase + perContFuelPeak);
    }
    if (lclRfWm > 0) {
      var base20Rf = r20rf > 0 ? r20rf : (r40rf > 0 ? r40rf * 0.65 : (r40rh > 0 ? r40rh * 0.6 : (r20dc > 0 ? r20dc * 1.45 : 0)));
      var rfUnitWm = explicitLclRate > 0 ? explicitLclRate : (base20Rf > 0 ? (base20Rf / 24) : fallbackLclRate);
      lclOcean += rfUnitWm * lclRfWm;
      var rfRatio = lclRfWm / 24;
      var rfThcBase = thc20r > 0 ? thc20r : (thc40r > 0 ? thc40r * 0.65 : thc20d);
      lclSurcharge += rfRatio * (rfThcBase + perContFuelPeak);
    }
    if (totalCont === 0) {
      lclSurcharge += (billSealShipment > 0 ? billSealShipment : blFee);
    }
  }

  return {
    ocean: Math.round((fclOcean + lclOcean) * 100) / 100,
    surcharge: Math.round((fclSurcharge + lclSurcharge) * 100) / 100
  };
}

/**
 * ============================================================================
 * 3.1. LỊCH TÀU & CƯỚC (THÊM MỚI + XÓA ĐƠN LẺ + DỌN TUYẾN HẾT HẠN)
 * ============================================================================
 */
function createShippingSchedule(payload) {
  var schedules = readSheetAsObjects_("Shipping_Schedule");
  var scheduleId = String(payload.Schedule_ID || "").trim();
  if (!scheduleId) {
    scheduleId = generateNextScheduleId_(schedules);
  }
  var todayStr = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");

  var daysLeft = 0;
  if (payload.Expiry_Date) {
    var exp = new Date(payload.Expiry_Date);
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    exp.setHours(0, 0, 0, 0);
    if (!isNaN(exp.getTime())) {
      daysLeft = Math.round((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    }
  }

  var rowObj = {
    "Schedule_ID": scheduleId,
    "POL": payload.POL || "",
    "POD": payload.POD || "",
    "Country": payload.Country || "",
    "POT": payload.POT || "",
    "Shipping_Line": payload.Shipping_Line || "",
    "Vessel": payload.Vessel || "",
    "Voyage": payload.Voyage || "",
    "ETD": payload.ETD || "",
    "ETA": payload.ETA || "",
    "Rate_20DC": parseSmartNumber_(payload.Rate_20DC),
    "Rate_40DC": parseSmartNumber_(payload.Rate_40DC),
    "Rate_40HC": parseSmartNumber_(payload.Rate_40HC),
    "Rate_20'RF": parseSmartNumber_(payload["Rate_20'RF"]),
    "Rate_40'RF": parseSmartNumber_(payload["Rate_40'RF"]),
    "Rate_40'RH": parseSmartNumber_(payload["Rate_40'RH"]),
    "BAF_Fee": parseSmartNumber_(payload.BAF_Fee),
    "LSS_Fee": parseSmartNumber_(payload.LSS_Fee),
    "PSS_Fee": parseSmartNumber_(payload.PSS_Fee),
    "B/L_Fee": parseSmartNumber_(payload["B/L_Fee"]),
    "Seal_Fee": parseSmartNumber_(payload.Seal_Fee),
    "THC_20_Dry": parseSmartNumber_(payload.THC_20_Dry),
    "THC_40_Dry": parseSmartNumber_(payload.THC_40_Dry),
    "THC_20_Reefer": parseSmartNumber_(payload.THC_20_Reefer),
    "THC_40_Reefer": parseSmartNumber_(payload.THC_40_Reefer),
    "Bill_Seal_Fee_Shipment": parseSmartNumber_(payload.Bill_Seal_Fee_Shipment),
    "LCL_Rate_CBM": parseSmartNumber_(payload.LCL_Rate_CBM),
    "Updated_Date": todayStr,
    "Expiry_Date": payload.Expiry_Date || "",
    "Days còn lại": daysLeft
  };

  for (var si = 0; si < schedules.length; si++) {
    if (String(schedules[si]["Schedule_ID"] || "").trim() === scheduleId) {
      updateRowByKey_("Shipping_Schedule", "Schedule_ID", scheduleId, rowObj);
      return { success: true, data: rowObj };
    }
  }

  var defaultHeaders = [
    "Schedule_ID", "POL", "POD", "Country", "POT", "Shipping_Line",
    "Vessel", "Voyage", "ETD", "ETA", "Rate_20DC", "Rate_40DC", "Rate_40HC",
    "Rate_20'RF", "Rate_40'RF", "Rate_40'RH", "BAF_Fee", "LSS_Fee", "PSS_Fee",
    "B/L_Fee", "Seal_Fee",
    "THC_20_Dry", "THC_40_Dry", "THC_20_Reefer", "THC_40_Reefer", "Bill_Seal_Fee_Shipment",
    "Updated_Date", "Expiry_Date", "Days còn lại"
  ];
  appendObjectToSheet_("Shipping_Schedule", rowObj, defaultHeaders);

  return { success: true, data: rowObj };
}

function deleteShippingSchedule(scheduleId) {
  var ok = deleteRowByKey_("Shipping_Schedule", "Schedule_ID", scheduleId);
  return { success: ok };
}

function deleteExpiredShippingSchedules() {
  var ss = getSS_();
  var sheet = ss.getSheetByName("Shipping_Schedule");
  if (!sheet) return { success: false, deletedCount: 0 };

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return { success: true, deletedCount: 0 };

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var expIdx = findHeaderIndex_(headers, ["Expiry_Date"]);
  var daysIdx = findHeaderIndex_(headers, ["Days còn lại"]);

  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var deletedCount = 0;

  for (var r = values.length - 1; r >= 1; r--) {
    var isExpired = false;
    if (daysIdx !== -1 && values[r][daysIdx] !== "" && values[r][daysIdx] !== null) {
      if (Number(values[r][daysIdx]) <= 0) {
        isExpired = true;
      }
    }
    if (!isExpired && expIdx !== -1 && values[r][expIdx]) {
      var expDate = new Date(values[r][expIdx]);
      if (!isNaN(expDate.getTime())) {
        expDate.setHours(0, 0, 0, 0);
        if (expDate.getTime() <= today.getTime()) {
          isExpired = true;
        }
      }
    }
    if (isExpired) {
      sheet.deleteRow(r + 1);
      deletedCount++;
    }
  }
  return { success: true, deletedCount: deletedCount };
}

/**
 * ============================================================================
 * 3.2, 3.3 & DANH MỤC SẢN PHẨM - THÊM / CẬP NHẬT / XÓA (ÁNH XẠ CỘT ĐỘNG)
 * ============================================================================
 */
function saveLocalCharge(payload, isEdit) {
  var rowObj = {
    "Charge_Code": payload.Charge_Code || "",
    "Charge_Name": payload.Charge_Name || "",
    "Charge_Category": payload.Charge_Category || "",
    "Unit": payload.Unit || "",
    "Standard_Fee": parseSmartNumber_(payload.Standard_Fee),
    "Applicable_ContType": payload.Applicable_ContType || "",
    "Note": payload.Note || ""
  };

  var existing = readSheetAsObjects_("Local_Charges");
  for (var i = 0; i < existing.length; i++) {
    if (String(existing[i]["Charge_Code"]).trim() === String(rowObj.Charge_Code).trim()) {
      updateRowByKey_("Local_Charges", "Charge_Code", rowObj.Charge_Code, rowObj);
      return { success: true, data: rowObj };
    }
  }

  var defaultHeaders = [
    "Charge_Code", "Charge_Name", "Charge_Category", "Unit",
    "Standard_Fee", "Applicable_ContType", "Note"
  ];
  appendObjectToSheet_("Local_Charges", rowObj, defaultHeaders);
  return { success: true, data: rowObj };
}

function deleteLocalCharge(chargeCode) {
  return { success: deleteRowByKey_("Local_Charges", "Charge_Code", chargeCode) };
}

function saveCustomsFee(payload, isEdit) {
  var rowObj = {
    "Service_Code": payload.Service_Code || "",
    "Service_Name": payload.Service_Name || "",
    "Unit": payload.Unit || "",
    "Standard_Fee": parseSmartNumber_(payload.Standard_Fee),
    "Provider": payload.Provider || "",
    "Note": payload.Note || ""
  };

  var existing = readSheetAsObjects_("Customs_Service_Fees");
  for (var i = 0; i < existing.length; i++) {
    if (String(existing[i]["Service_Code"]).trim() === String(rowObj.Service_Code).trim()) {
      updateRowByKey_("Customs_Service_Fees", "Service_Code", rowObj.Service_Code, rowObj);
      return { success: true, data: rowObj };
    }
  }

  var defaultHeaders = [
    "Service_Code", "Service_Name", "Unit", "Standard_Fee", "Provider", "Note"
  ];
  appendObjectToSheet_("Customs_Service_Fees", rowObj, defaultHeaders);
  return { success: true, data: rowObj };
}

function deleteCustomsFee(serviceCode) {
  return { success: deleteRowByKey_("Customs_Service_Fees", "Service_Code", serviceCode) };
}

/**
 * ============================================================================
 * 3.4. BẢNG TÍNH GIÁ XUẤT KHẨU (Pricing_Proposal) & PRICING_RATES CRUD
 * ============================================================================
 */
function savePricingRateItem(payload) {
  var rowObj = {
    "Fee_Category": String(payload.Fee_Category || "").trim().toUpperCase(),
    "Fee_Code": String(payload.Fee_Code || "").trim(),
    "Scope_or_ContType": String(payload.Scope_or_ContType || "ALL").trim(),
    "Fee_Name_VIE": String(payload.Fee_Name_VIE || "").trim(),
    "Contract_Text_ENG": String(payload.Contract_Text_ENG || "").trim(),
    "Unit_Basis": String(payload.Unit_Basis || "").trim(),
    "Standard_Rate": parseSmartNumber_(payload.Standard_Rate),
    "Provider_or_Rule": String(payload.Provider_or_Rule || "").trim(),
    "Note": String(payload.Note || "").trim(),
    "Dim_CM": String(payload.Dim_CM || "").trim(),
    "Net_KG": parseSmartNumber_(payload.Net_KG),
    "Tare_KG": parseSmartNumber_(payload.Tare_KG),
    "Max_Per_Pallet": parseSmartNumber_(payload.Max_Per_Pallet)
  };
  var existing = readSheetAsObjects_("Pricing_Rates");
  for (var i = 0; i < existing.length; i++) {
    if (String(existing[i]["Fee_Code"] || "").trim() === rowObj.Fee_Code) {
      updateRowByKey_("Pricing_Rates", "Fee_Code", rowObj.Fee_Code, rowObj);
      return { success: true, data: rowObj };
    }
  }
  appendObjectToSheet_("Pricing_Rates", rowObj, [
    "Fee_Category", "Fee_Code", "Scope_or_ContType", "Fee_Name_VIE",
    "Contract_Text_ENG", "Unit_Basis", "Standard_Rate", "Provider_or_Rule", "Note",
    "Dim_CM", "Net_KG", "Tare_KG", "Max_Per_Pallet"
  ]);
  return { success: true, data: rowObj };
}

function deletePricingRateItem(feeCode) {
  return { success: deleteRowByKey_("Pricing_Rates", "Fee_Code", feeCode) };
}

function savePricingProposal(payload) {
  var proposals = readSheetAsObjects_("Pricing_Proposal");
  var inquiries = readSheetAsObjects_("Inquiry_Quotation");
  var orderId = String(payload["Order ID"] || payload.Order_ID || "").trim().replace(/-(?:V|R)\d+$/i, "");
  var inqMatch = null;
  for (var qi = 0; qi < inquiries.length; qi++) {
    if (String(inquiries[qi]["Order_ID"] || "").trim() === orderId) {
      inqMatch = inquiries[qi];
      break;
    }
  }
  var baseRound = parseInt(payload.Quote_Round || (inqMatch && inqMatch["Quote_Round"]) || 1, 10) || 1;
  var rawInputQuo = String(payload.Quote_ID || payload.Quotation_No || (orderId ? ("QT-" + orderId) : "")).trim();
  var quotationNo = rawInputQuo.replace(/-(?:V|R)\d+$/i, "") || (orderId ? ("QT-" + orderId) : "");
  var quoteRound = Math.max(baseRound, 1);
  var versionLabel = "";
  var todayStr = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");
  var usePalletBool = (payload.Use_Pallet === true || String(payload.Use_Pallet || "").toUpperCase() === "TRUE");

  var proposedArr = [];
  if (Array.isArray(payload.Proposed_Incoterms)) {
    proposedArr = payload.Proposed_Incoterms.map(function (x) { return String(x || "").trim().toUpperCase(); }).filter(Boolean);
  } else if (payload.Proposed_Incoterms) {
    proposedArr = String(payload.Proposed_Incoterms).split(/[,;\s]+/).map(function (x) { return String(x || "").trim().toUpperCase(); }).filter(Boolean);
  }
  if (proposedArr.length === 0 && payload["Recommended Incoterm"]) {
    proposedArr = [String(payload["Recommended Incoterm"]).trim().toUpperCase()];
  }
  var resolvedMode = proposedArr.length >= 2
    ? "COMPARISON"
    : (String(payload.Quotation_Mode || "").toUpperCase() === "COMPARISON" ? "COMPARISON" : "SINGLE");

  var finalSellingNum = parseSmartNumber_(payload["Final_Selling Price"]);
  var floorPriceNum = parseSmartNumber_(payload.Floor_Price_USD);
  if (floorPriceNum <= 0) floorPriceNum = finalSellingNum;
  var cleanPropNote = String(payload.Note || "").replace(/\s*\[ITEMS:[^\]]+\]/g, "").trim();

  var calcGwVal = parseSmartNumber_(payload.Total_Gross_Weight || 0);
  var calcCbmVal = parseSmartNumber_(payload.Total_CBM || 0);
  if ((calcGwVal <= 0 || calcCbmVal <= 0) && Array.isArray(payload.items) && payload.items.length > 0) {
    var autoSpec = computeOrderPackingSpecsServer_(payload.items, readSheetAsObjects_("Pricing_Rates"), usePalletBool);
    if (calcGwVal <= 0) calcGwVal = autoSpec.totalGrossWeightKg;
    if (calcCbmVal <= 0) calcCbmVal = autoSpec.totalCbm;
  }
  var fwdOceanVal = parseSmartNumber_(payload.FWD_Ocean_CFS_USD || 0);
  var fwdTruckVal = parseSmartNumber_(payload.FWD_Trucking_USD || 0);
  var fwdCustVal = parseSmartNumber_(payload.FWD_Customs_USD || 0);
  var fwdPermVal = parseSmartNumber_(payload.FWD_Permits_USD || 0);
  var selfOceanVal = fwdOceanVal > 0 ? 0 : parseSmartNumber_(payload.Self_Ocean_CFS_USD || 0);
  var selfTruckVal = fwdTruckVal > 0 ? 0 : parseSmartNumber_(payload.Self_Trucking_USD || 0);
  var selfCustVal = fwdCustVal > 0 ? 0 : parseSmartNumber_(payload.Self_Customs_USD || 0);
  var selfPermVal = fwdPermVal > 0 ? 0 : parseSmartNumber_(payload.Self_Permits_USD || 0);

  var rowObj = {
    "Order ID": orderId,
    "Order_ID": orderId,
    "Price_Version": versionLabel,
    "Quote_ID": quotationNo,
    "Quotation_No": quotationNo,
    "Quote_Round": quoteRound,
    "XNK_Rep": payload.XNK_Rep || "",
    "Schedule_ID": payload.Schedule_ID || "",
    "Container_Type": payload.Container_Type || "",
    "Container_Qty": payload.Container_Qty !== undefined ? parseSmartNumber_(payload.Container_Qty) : 1,
    "Total_Freight_Local": parseSmartNumber_(payload.Total_Freight_Local),
    "Packing_Pallet_Cost": parseSmartNumber_(payload.Packing_Pallet_Cost || 0),
    "Use_Pallet": usePalletBool,
    "Total_Cartons": parseSmartNumber_(payload.Total_Cartons || 0),
    "Total_Pallets": parseSmartNumber_(payload.Total_Pallets || 0),
    "Pallet_Fee": parseSmartNumber_(payload.Pallet_Fee || 0),
    "Total_Gross_Weight": calcGwVal,
    "Total_CBM": calcCbmVal,
    "Dry_Ship_Mode": payload.Dry_Ship_Mode || "",
    "Reefer_Ship_Mode": payload.Reefer_Ship_Mode || "",
    "LCL_Rate_Basis": payload.LCL_Rate_Basis || (calcGwVal / 1000 >= calcCbmVal ? "TON" : "CBM"),
    "LCL_Unit_Rate_USD": parseSmartNumber_(payload.LCL_Unit_Rate_USD || 0),
    "LCL_Total_Freight_USD": parseSmartNumber_(payload.LCL_Total_Freight_USD || 0),
    "FWD_Ocean_CFS_USD": fwdOceanVal,
    "FWD_Trucking_USD": fwdTruckVal,
    "FWD_Customs_USD": fwdCustVal,
    "FWD_Permits_USD": fwdPermVal,
    "Self_Ocean_CFS_USD": selfOceanVal,
    "Self_Trucking_USD": selfTruckVal,
    "Self_Customs_USD": selfCustVal,
    "Self_Permits_USD": selfPermVal,
    "Freight_Exec_Option": payload.Freight_Exec_Option || "",
    "Internal_Cost_USD": parseSmartNumber_(payload.Internal_Cost_USD || 0),
    "Buyer_Charge_USD": parseSmartNumber_(payload.Buyer_Charge_USD || 0),
    "Internal_Profit_USD": parseSmartNumber_(payload.Internal_Profit_USD || 0),
    "Insurance_Code": payload.Insurance_Code || "",
    "Insurance_Cost": parseSmartNumber_(payload.Insurance_Cost),
    "Goods_Cost": parseSmartNumber_(payload.Goods_Cost),
    "Recommended Incoterm": payload["Recommended Incoterm"] || "",
    "Proposed_Incoterms": proposedArr.join(", "),
    "Quotation_Mode": resolvedMode,
    "Final_Selling Price": finalSellingNum,
    "Final_Selling_Price": finalSellingNum,
    "Floor_Price_USD": floorPriceNum,
    "Min_Margin_Pct": parseSmartNumber_(payload.Min_Margin_Pct || 0),
    "EXW_Price": parseSmartNumber_(payload.EXW_Price || 0),
    "FOB_Price": parseSmartNumber_(payload.FOB_Price || 0),
    "CFR_Price": parseSmartNumber_(payload.CFR_Price || 0),
    "CIF_Price": parseSmartNumber_(payload.CIF_Price || 0),
    "Adjusted_By_Sales": Boolean(payload.Adjusted_By_Sales),
    "Booking_Date": payload.Booking_Date || todayStr,
    "Booking_Status": payload.Booking_Status || "Đã tính giá / Sẵn sàng báo giá",
    "Note": cleanPropNote
  };

  var defaultHeaders = [
    "Order ID", "Price_Version", "Quotation_No", "Quote_Round", "XNK_Rep", "Schedule_ID",
    "Container_Type", "Container_Qty", "Total_Freight_Local", "Packing_Pallet_Cost",
    "Use_Pallet", "Total_Cartons", "Total_Pallets", "Pallet_Fee",
    "Total_Gross_Weight", "Total_CBM",
    "Dry_Ship_Mode", "Reefer_Ship_Mode", "LCL_Rate_Basis", "LCL_Unit_Rate_USD", "LCL_Total_Freight_USD",
    "FWD_Ocean_CFS_USD", "FWD_Trucking_USD", "FWD_Customs_USD", "FWD_Permits_USD", "Self_Trucking_USD",
    "Freight_Exec_Option", "Internal_Cost_USD", "Buyer_Charge_USD", "Internal_Profit_USD",
    "Insurance_Code", "Insurance_Cost", "Goods_Cost", "Recommended Incoterm",
    "Proposed_Incoterms", "Quotation_Mode",
    "Final_Selling Price", "Floor_Price_USD", "Min_Margin_Pct",
    "EXW_Price", "FOB_Price", "CFR_Price", "CIF_Price", "Adjusted_By_Sales",
    "Booking_Date", "Booking_Status", "Note"
  ];
  var updatedExistingProp = false;
  for (var pe = 0; pe < proposals.length; pe++) {
    var existingOid = String(proposals[pe]["Order ID"] || proposals[pe]["Order_ID"] || "").trim();
    if (existingOid === orderId) {
      updatedExistingProp = updateRowByKey_("Pricing_Proposal", ["Order ID", "Order_ID"], orderId, rowObj);
      break;
    }
  }
  if (!updatedExistingProp) {
    appendObjectToSheet_("Pricing_Proposal", rowObj, defaultHeaders);
  }

  var inqUpdates = {
    "Inquiry_Status": "Đã tính giá / Sẵn sàng báo giá",
    "Quote_Round": quoteRound,
    "Quotation_Mode": resolvedMode
  };
  if (payload.Use_Pallet !== undefined) {
    inqUpdates["Use_Pallet"] = usePalletBool;
  }
  if (payload.items && payload.items.length > 0) {
    var nameSummaries = [];
    for (var k = 0; k < payload.items.length; k++) {
      var it = payload.items[k];
      var w = parseSmartNumber_(it.weight);
      var pName = String(it.packingName || "").replace(/[|;\[\]]/g, " ").trim();
      nameSummaries.push((it.name || it.sku) + " (" + w + " KG" + (pName ? " · " + pName : "") + ")");
    }
    inqUpdates["Order_Items"] = serializeOrderItemsTextServer_(payload.items);
    inqUpdates["Tên sản phẩm"] = nameSummaries.join("; ");
  }

  updateRowByKey_("Inquiry_Quotation", "Order_ID", orderId, inqUpdates);

  return { success: true, data: rowObj };
}

/**
 * ============================================================================
 * 5. TRỢ LÝ AI PHÂN TÍCH & ĐỀ XUẤT INCOTERMS 2020 (GEMINI API SERVER-SIDE)
 * ============================================================================
 */
function adviseIncotermsWithAI(payload) {
  try {
    var cache = CacheService.getScriptCache();
    var cfgCacheKey = "GAS_AI_CFG_V2";
    var cachedCfg = null;
    try {
      var cfgStr = cache.get(cfgCacheKey);
      if (cfgStr) cachedCfg = JSON.parse(cfgStr);
    } catch (eCfg) {}

    var apiKey = cachedCfg && cachedCfg.apiKey ? String(cachedCfg.apiKey).trim() : "";
    var primaryModel = cachedCfg && cachedCfg.model ? String(cachedCfg.model).trim() : "";
    if (!apiKey) {
      apiKey = typeof GEMINI_API_KEY !== "undefined" ? String(GEMINI_API_KEY || "").trim() : "";
      if (!apiKey) {
        try {
          apiKey = String(PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY") || "").trim();
        } catch (eProp) {}
      }
      primaryModel = (typeof GEMINI_MODEL !== "undefined" && String(GEMINI_MODEL || "").trim())
        ? String(GEMINI_MODEL).trim()
        : "gemini-3-flash-preview";
      if (apiKey && apiKey !== "NHAP_API_KEY_TAI_DAY" && apiKey.indexOf("NHAP_") !== 0) {
        try {
          cache.put(cfgCacheKey, JSON.stringify({ apiKey: apiKey, model: primaryModel }), 21600);
        } catch (ePutCfg) {}
      }
    }
    if (!primaryModel) primaryModel = "gemini-3-flash-preview";

    if (!apiKey || apiKey === "NHAP_API_KEY_TAI_DAY" || apiKey.indexOf("NHAP_") === 0) {
      return {
        success: false,
        message: "Chưa cấu hình GEMINI_API_KEY trong Code.gs. Vui lòng nhập Gemini API Key vào biến GEMINI_API_KEY ở đầu file Code.gs rồi triển khai lại Web App."
      };
    }

    payload = payload || {};
    var orderCtx = payload.orderContext || {};
    var question = String(payload.question || "").trim();
    var chatHistory = Array.isArray(payload.chatHistory) ? payload.chatHistory.slice(-6) : [];
    var orderId = String(orderCtx.Order_ID || payload.orderId || "").trim();

    var hasRamContext = Boolean(payload.skipSheetRead) || Boolean(orderCtx.Customer || (Array.isArray(orderCtx.Items) && orderCtx.Items.length > 0));
    var handbookRows = Array.isArray(payload.handbookRows) ? payload.handbookRows : [];
    var schedulesRows = Array.isArray(payload.matchingSchedules) ? payload.matchingSchedules : [];
    var ramInsuranceRates = Array.isArray(payload.insuranceRates) ? payload.insuranceRates : [];

    if (!hasRamContext && orderId) {
      var refCacheKey = "GAS_AI_SHEETS_REF_V3";
      var refData = null;
      try {
        var refCachedStr = cache.get(refCacheKey);
        if (refCachedStr) refData = JSON.parse(refCachedStr);
      } catch (eRef) {}
      if (!refData) {
        var ss = getSS_();
        refData = {
          handbookRows: readSheetAsObjects_("Incoterms_Handbook", ss) || [],
          schedules: readSheetAsObjects_("Shipping_Schedule", ss) || [],
          pricingRates: readSheetAsObjects_("Pricing_Rates", ss) || []
        };
        try { cache.put(refCacheKey, JSON.stringify(refData), 900); } catch (ePut) {}
      }
      if (handbookRows.length === 0) handbookRows = refData.handbookRows || [];
      if (schedulesRows.length === 0) schedulesRows = refData.schedules || [];
      if (ramInsuranceRates.length === 0) ramInsuranceRates = refData.pricingRates || [];
    }

    var insCatalog = getInsuranceRatesCatalogServer_(ramInsuranceRates);
    var insuranceText = insCatalog.list.map(function (r) {
      return "- " + r.Fee_Code + " [" + (r.Scope_or_ContType || "ALL") + "] (" + r.Standard_Rate + "%): " + r.Fee_Name_VIE + (r.Contract_Text_ENG ? (" | ENG: " + r.Contract_Text_ENG) : "");
    }).join("\n");

    // Cache 15 phút cho phân tích khởi tạo không kèm chatHistory
    var cacheKey = "";
    if (chatHistory.length === 0) {
      var rawSig = JSON.stringify({
        v: 4,
        orderId: orderId,
        country: orderCtx.Country || "",
        pod: orderCtx.POD || "",
        mix: orderCtx.Container_Mix || "",
        rfKg: orderCtx.Reefer_Weight_KG || 0,
        dryKg: orderCtx.Dry_Weight_KG || 0,
        pay: orderCtx.Payment_Terms || "",
        req: orderCtx.Requested_Incoterm || "",
        sel: orderCtx.Selected_Incoterm || "",
        prop: orderCtx.Proposed_Incoterms || "",
        q: question
      });
      var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, rawSig, Utilities.Charset.UTF_8);
      cacheKey = "INC_AI_" + digest.map(function (b) {
        var v = b < 0 ? b + 256 : b;
        return ("0" + v.toString(16)).slice(-2);
      }).join("");
      var cachedStr = cache.get(cacheKey);
      if (cachedStr) {
        try {
          var cachedObj = JSON.parse(cachedStr);
          if (cachedObj && cachedObj.success) {
            return cachedObj;
          }
        } catch (e) {}
      }
    }

    var handbookText = (handbookRows || []).slice(0, 11).map(function (r) {
      var incCode = String(r["Incoterm"] || r["Code"] || "").trim().toUpperCase();
      var scope = r["Seller_Cost_Scope"] || r["Cost_Responsibility"] || "";
      var risk = r["Risk_Transfer_Point"] || "";
      var notes = r["Practical_Notes_VIE"] || r["Advice_Note_VIE"] || "";
      if (incCode === "CFR") {
        scope = "Người bán trả cước biển chính tới cảng đến (POD), không mua bảo hiểm";
        risk = "Chuyển giao khi hàng xếp lên tàu tại cảng đi (POL)";
      }
      return "- " + incCode + " | Chi phí NB: " + scope + " | Rủi ro: " + risk + (notes ? (" | Lưu ý: " + notes) : "");
    }).join("\n");

    var targetPod = String(orderCtx.POD || "").trim().toLowerCase();
    var schedulesText = (schedulesRows || []).filter(function (s) {
      return !targetPod || String(s["POD"] || "").toLowerCase().indexOf(targetPod) !== -1;
    }).slice(0, 4).map(function (s) {
      return "- " + (s["Schedule_ID"] || "") + " " + (s["Shipping_Line"] || "") + " (" + (s["POL"] || "") + "->" + (s["POD"] || "") + ") ETD " + (s["ETD"] || "") + " ETA " + (s["ETA"] || "") + " | 20DC $" + (s["Rate_20DC"] || 0) + " 40DC $" + (s["Rate_40DC"] || 0) + " 20RF $" + (s["Rate_20'RF"] || 0) + " 40RF $" + (s["Rate_40'RF"] || 0);
    }).join("\n");

    var systemInstruction = [
      "Bạn là Chuyên gia Cố vấn KÉP về Incoterms 2020 & Bảo hiểm Hàng hải Xuất nhập khẩu (GREEN AGRI-EXPORTS, Việt Nam).",
      "Trả lời CỰC KỲ NGẮN GỌN, CHÍNH XÁC, THỰC CHIẾN theo dữ liệu đơn hàng và biểu phí bảo hiểm dưới đây:",
      "",
      "1. INCOTERMS 2020 & QUY TẮC SO SÁNH CÙNG NHÓM:",
      "- Luôn so sánh rõ các điều kiện TRONG CÙNG NHÓM Incoterms liên quan đến đơn hàng (Nhóm E: EXW; Nhóm F: FCA/FAS/FOB; Nhóm C: CFR/CIF/CPT/CIP; Nhóm D: DAP/DPU/DDP).",
      "- Định nghĩa chuẩn CFR (Cost and Freight): Người bán trả cước biển chính tới cảng đến (POD), nhưng rủi ro chuyển giao cho người mua ngay khi hàng đã xếp lên tàu tại cảng đi (POL); người mua tự mua bảo hiểm.",
      "- Với hàng lạnh/giá trị cao hoặc thanh toán L/C: ưu tiên CIP hoặc CIF để bảo vệ rủi ro và kiểm soát chứng từ vận tải + đơn bảo hiểm.",
      "",
      "2. TƯ VẤN KÉP BẢO HIỂM HÀNG HẢI (DỰA TRÊN LOẠI HÀNG / CONTAINER & PRICING_RATES):",
      "- Hàng lạnh / cấp đông (RF, Reefer_Weight_KG > 0): BẮT BUỘC đề xuất gói chính 'INS-FRZ-A' (Institute Frozen Food Clauses A) khi bán CIF/CIP để bảo hiểm rủi ro hư hỏng nhiệt độ/ngừng máy lạnh.",
      "- Hàng nông sản khô (DC, hạt điều/tiêu/cà phê/gia vị/gạo): nếu chào CIP đề xuất 'INS-ICC-A'; nếu chào CIF đề xuất 'INS-ICC-C' hoặc 'INS-ICC-B' KÈM điều khoản mở rộng 'INS-EXT-SWH' (Sweating & Heating Clause - chống hấp hơi, nóng ẩm trong container khô).",
      "- Có thể đề xuất thêm 'INS-EXT-WAR' (tuyến biển rủi ro xung đột) hoặc 'INS-EXT-TPND' (trộm cắp & nước ngọt cho hàng giá trị cao/LCL). Nếu bestIncoterm không gồm bảo hiểm (EXW/FCA/FAS/FOB/CFR/CPT), đặt recommendedInsuranceCode = 'INS-NONE' và vẫn ghi rõ gói BH khuyến nghị nếu khách nâng lên CIF/CIP.",
      "- Công thức: R_total = R_base + sum(R_addons); V = (C + F) * 1.1 / (1 - R_total); I = R_total * V.",
      "",
      "3. GIAO NHẬN QUỐC TẾ & PHÁP LÝ XNK VIỆT NAM 2026:",
      "- Mốc Cut-off: S/I, VGM (= Cargo Gross + Container Tare), Draft B/L, CY Cut-off. L/C yêu cầu Shipped on Board B/L + Consignee 'To order of [Issuing Bank]' + Freight Prepaid.",
      "- Văn bản pháp lý 2026: NĐ 359/2025/NĐ-CP (GTGT nông sản), TT 121/2025/TT-BTC (HQ điện tử), NĐ 37/2026/NĐ-CP.",
      "",
      "4. ĐỊNH DẠNG ĐẦU RA BẮT BUỘC:",
      "- Mở đầu replyText ĐÚNG CỤM TỪ: 'Đã đối chiếu hồ sơ đơn hàng + Incoterm_Handbook: ' và trình bày súc tích 3-5 gạch đầu dòng (gồm cả tư vấn Incoterm cùng nhóm VÀ tư vấn gói Bảo hiểm + Điều khoản mở rộng phù hợp loại hàng).",
      "- Chỉ trả về JSON hợp lệ duy nhất đúng cấu trúc:",
      '{"replyText":"Đã đối chiếu hồ sơ đơn hàng + Incoterm_Handbook: ...","recommendedIncoterms":["CODE1","CODE2","CODE3"],"bestIncoterm":"CODE1","reason":"1 câu ngắn giải thích Incoterm tối ưu","recommendedInsuranceCode":"INS-ICC-C","recommendedInsuranceAddons":["INS-EXT-SWH"],"insuranceReason":"1 câu ngắn giải thích gói bảo hiểm & điều khoản mở rộng"}',
      "- Mã Incoterms hợp lệ duy nhất: EXW, FCA, FAS, FOB, CFR, CIF, CPT, CIP, DAP, DPU, DDP."
    ].join("\n");

    var contextPrompt = [
      "=== HỒ SƠ ĐƠN HÀNG (TỪ BỘ NHỚ RAM) ===",
      JSON.stringify(orderCtx),
      insuranceText ? ("\n=== DANH MỤC BẢO HIỂM (PRICING_RATES · INSURANCE) ===\n" + insuranceText) : "",
      handbookText ? ("\n=== INCOTERMS_HANDBOOK ===\n" + handbookText) : "",
      schedulesText ? ("\n=== LỊCH TÀU KHỚP POD ===\n" + schedulesText) : "",
      chatHistory.length > 0
        ? ("\n=== HỘI THOẠI GẦN ĐÂY ===\n" + chatHistory.map(function (m) {
            return (m.role === "user" ? "XNK" : "AI") + ": " + String(m.text || "").slice(0, 320);
          }).join("\n"))
        : "",
      "\n=== CÂU HỎI HIỆN TẠI ===",
      question || "Phân tích kép đơn hàng này: đề xuất 2-3 Incoterms 2020 tối ưu kèm gói Bảo hiểm hàng hóa + Điều khoản mở rộng phù hợp nhất theo loại hàng (Khô/Lạnh)."
    ].filter(Boolean).join("\n");

    var modelCandidates = [primaryModel];
    if (modelCandidates.indexOf("gemini-3-flash-preview") === -1) modelCandidates.push("gemini-3-flash-preview");
    if (modelCandidates.indexOf("gemini-flash-latest") === -1) modelCandidates.push("gemini-flash-latest");

    function buildReqPayload(includeThinkingConfig) {
      var genCfg = {
        responseMimeType: "application/json",
        maxOutputTokens: 600,
        temperature: 0.25
      };
      if (includeThinkingConfig) {
        genCfg.thinkingConfig = { thinkingBudget: 0 };
      }
      return {
        systemInstruction: {
          parts: [{ text: systemInstruction }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: contextPrompt }]
          }
        ],
        generationConfig: genCfg
      };
    }

    var resp = null;
    var code = 0;
    var bodyText = "";
    for (var mIdx = 0; mIdx < modelCandidates.length; mIdx++) {
      var modelName = modelCandidates[mIdx];
      var url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(modelName) + ":generateContent?key=" + encodeURIComponent(apiKey);
      var useThinking = true;
      for (var attempt = 0; attempt < 2; attempt++) {
        resp = UrlFetchApp.fetch(url, {
          method: "post",
          contentType: "application/json",
          payload: JSON.stringify(buildReqPayload(useThinking)),
          muteHttpExceptions: true
        });
        code = resp.getResponseCode();
        bodyText = resp.getContentText();
        if (code === 400 && useThinking && bodyText.toLowerCase().indexOf("thinking") !== -1) {
          useThinking = false;
          continue;
        }
        if ((code === 429 || code === 503) && attempt < 1) {
          Utilities.sleep(500);
          continue;
        }
        break;
      }
      if (code >= 200 && code < 300) {
        break;
      }
      if (code !== 404 && code !== 400) {
        break;
      }
    }

    if (code < 200 || code >= 300) {
      return {
        success: false,
        message: "Lỗi Gemini API (HTTP " + code + "): " + bodyText.slice(0, 260)
      };
    }

    var jsonResp = JSON.parse(bodyText);
    var rawText = "";
    if (
      jsonResp &&
      jsonResp.candidates &&
      jsonResp.candidates[0] &&
      jsonResp.candidates[0].content &&
      jsonResp.candidates[0].content.parts
    ) {
      var parts = jsonResp.candidates[0].content.parts;
      for (var pIdx = 0; pIdx < parts.length; pIdx++) {
        if (parts[pIdx] && typeof parts[pIdx].text === "string" && !parts[pIdx].thought) {
          rawText += parts[pIdx].text;
        }
      }
      rawText = rawText.trim();
    }

    if (!rawText) {
      return {
        success: false,
        message: "Gemini API không trả về nội dung phản hồi hợp lệ."
      };
    }

    var cleaned = rawText.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    var parsed = {};
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      parsed = { replyText: rawText, recommendedIncoterms: [], bestIncoterm: "", reason: "" };
    }

    var validCodes = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];
    var recList = [];
    if (Array.isArray(parsed.recommendedIncoterms)) {
      parsed.recommendedIncoterms.forEach(function (c) {
        var up = String(c || "").trim().toUpperCase();
        if (validCodes.indexOf(up) !== -1 && recList.indexOf(up) === -1) {
          recList.push(up);
        }
      });
    }
    var best = String(parsed.bestIncoterm || "").trim().toUpperCase();
    if (validCodes.indexOf(best) === -1) {
      best = recList[0] || "";
    } else if (recList.indexOf(best) === -1) {
      recList.unshift(best);
    }

    var replyOut = String(parsed.replyText || rawText).trim();
    var requiredPrefix = "Đã đối chiếu hồ sơ đơn hàng + Incoterm_Handbook:";
    if (replyOut.indexOf(requiredPrefix) !== 0) {
      replyOut = requiredPrefix + " " + replyOut;
    }

    var isReeferOrder = parseSmartNumber_(orderCtx.Reefer_Weight_KG || 0) > 0 ||
      /RF|RH|LẠNH|REEFER|FROZEN/i.test(String(orderCtx.Container_Mix || ""));
    var recInsCode = String(parsed.recommendedInsuranceCode || "").trim().toUpperCase();
    var recInsAddons = [];
    if (Array.isArray(parsed.recommendedInsuranceAddons)) {
      parsed.recommendedInsuranceAddons.forEach(function (a) {
        var upA = String(a || "").trim().toUpperCase();
        if (upA && upA.indexOf("INS-EXT-") === 0 && recInsAddons.indexOf(upA) === -1) {
          recInsAddons.push(upA);
        }
      });
    }
    if (!recInsCode || !insCatalog.byCode[recInsCode] || recInsCode.indexOf("INS-EXT-") === 0) {
      if (best === "CIF" || best === "CIP") {
        if (isReeferOrder) {
          recInsCode = "INS-FRZ-A";
        } else if (best === "CIP") {
          recInsCode = "INS-ICC-A";
        } else {
          recInsCode = "INS-ICC-C";
          if (recInsAddons.indexOf("INS-EXT-SWH") === -1) recInsAddons.push("INS-EXT-SWH");
        }
      } else {
        recInsCode = "INS-NONE";
        recInsAddons = [];
      }
    } else if (recInsCode === "INS-NONE") {
      recInsAddons = [];
    } else if (isReeferOrder && (best === "CIF" || best === "CIP") && recInsCode !== "INS-FRZ-A" && insCatalog.byCode["INS-FRZ-A"]) {
      recInsCode = "INS-FRZ-A";
    }

    var insReasonOut = String(parsed.insuranceReason || "").trim();
    if (!insReasonOut) {
      if (recInsCode === "INS-FRZ-A") {
        insReasonOut = "Hàng lạnh/cấp đông (RF): khuyến nghị Frozen Food Clauses (A) bảo vệ rủi ro hư hỏng nhiệt độ.";
      } else if (recInsCode === "INS-ICC-A") {
        insReasonOut = "Hàng khô theo CIP: áp dụng mức bảo hiểm mọi rủi ro ICC (A) theo chuẩn Incoterms 2020.";
      } else if (recInsCode === "INS-ICC-C" || recInsCode === "INS-ICC-B") {
        insReasonOut = "Hàng nông sản khô theo CIF: kết hợp " + recInsCode + (recInsAddons.length ? (" + " + recInsAddons.join(", ")) : "") + " để chống hấp hơi, nóng ẩm.";
      } else {
        insReasonOut = "Điều kiện " + (best || "đề xuất") + " không bắt buộc người bán mua bảo hiểm hàng hải.";
      }
    }

    var finalOut = {
      success: true,
      replyText: replyOut,
      recommendedIncoterms: recList.slice(0, 4),
      bestIncoterm: best,
      reason: String(parsed.reason || ""),
      recommendedInsuranceCode: recInsCode,
      recommendedInsuranceAddons: recInsAddons,
      insuranceReason: insReasonOut,
      insuranceClauseEng: buildCombinedInsuranceClauseServer_(
        recInsAddons.length ? (recInsCode + " + " + recInsAddons.join(" + ")) : recInsCode,
        insCatalog.list
      )
    };

    if (cacheKey) {
      try {
        cache.put(cacheKey, JSON.stringify(finalOut), 900);
      } catch (cacheErr) {}
    }

    return finalOut;
  } catch (err) {
    return {
      success: false,
      message: "Lỗi khi gọi Gemini AI Advisor: " + (err && err.message ? err.message : String(err))
    };
  }
}

/**
 * ============================================================================
 * 6. API THÊM HÀNG LOẠT (BATCH) CHO LỊCH TÀU, SẢN PHẨM, PHỤ PHÍ & KHÁCH HÀNG
 * ============================================================================
 */
function saveShippingSchedulesBatch(rows) {
  var list = Array.isArray(rows) ? rows : [];
  var saved = [];
  for (var i = 0; i < list.length; i++) {
    var row = list[i];
    if (!row || (!String(row.POL || "").trim() && !String(row.POD || "").trim() && !String(row.Shipping_Line || "").trim())) {
      continue;
    }
    var res = createShippingSchedule(row);
    if (res && res.success && res.data) saved.push(res.data);
  }
  return { success: true, count: saved.length, data: saved };
}

function savePricingRatesBatch(rows) {
  var list = Array.isArray(rows) ? rows : [];
  var saved = [];
  for (var i = 0; i < list.length; i++) {
    var row = list[i];
    if (!row || !String(row.Fee_Code || "").trim()) continue;
    var res = savePricingRateItem(row);
    if (res && res.success && res.data) saved.push(res.data);
  }
  return { success: true, count: saved.length, data: saved };
}
