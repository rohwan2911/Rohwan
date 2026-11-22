/**
 * ============================================================================
 * HỆ THỐNG QUẢN LÝ XUẤT KHẨU NÔNG SẢN - NÔNG SẢN XANH
 * File: GS_Hop_Dong_Chung_Tu.gs (Google Docs, PDF, Gmail, Hợp đồng & 6 Bước XNK)
 * ============================================================================
 */

var WORKFLOW_6_STAGES_SERVER_ = {
  1: "1. Chờ báo giá (RFQ)",
  2: "2. Chờ ký HĐ & Cọc",
  3: "3. Chờ Booking & Đóng hàng",
  4: "4. Đang làm chứng từ & HQ",
  5: "5. Đang vận chuyển (On Board)",
  6: "6. Chờ thanh toán"
};
var COMPLETED_ORDER_STATUS_6STEP_SERVER_ = "Hoàn tất quyết toán";
var SIGNED_STAGE3_6STEP_STATUS_SERVER_ = "Mốc 3/6 · 3. Chờ Booking & Đóng hàng";
var ORDER_LOGISTICS_META_PREFIX_ = "NSX_LOGI_";

function translateFulfillmentStatus6StepServer_(status) {
  var raw = String(status || "").trim();
  if (!raw) return WORKFLOW_6_STAGES_SERVER_[2];
  var low = raw.toLowerCase();
  if (low.indexOf("chờ sales đưa ký") !== -1) return "Chờ Sales đưa ký";
  if (low.indexOf("mốc 3/6") !== -1 || low.indexOf("mốc 3/5") !== -1) {
    return SIGNED_STAGE3_6STEP_STATUS_SERVER_;
  }
  if (low.indexOf("hoàn tất") !== -1 || low.indexOf("hoàn thành") !== -1 || low.indexOf("7.") === 0 || low.indexOf("settled") !== -1 || low.indexOf("completed") !== -1) {
    return COMPLETED_ORDER_STATUS_6STEP_SERVER_;
  }
  if (low.indexOf("5b.") === 0 || low.indexOf("6. chờ thanh toán") !== -1 || low.indexOf("chờ thanh toán") !== -1 || low.indexOf("mốc 6/6") !== -1) {
    return WORKFLOW_6_STAGES_SERVER_[6];
  }
  if (low.indexOf("5.") === 0 || low.indexOf("mốc 5") !== -1 || low.indexOf("on board") !== -1 || low.indexOf("vận chuyển") !== -1 || low.indexOf("vận đơn") !== -1 || low.indexOf("b/l") !== -1) {
    return WORKFLOW_6_STAGES_SERVER_[5];
  }
  if (low.indexOf("4.") === 0 || low.indexOf("mốc 4") !== -1 || low.indexOf("chứng từ") !== -1 || low.indexOf("hải quan") !== -1 || low.indexOf("hq") !== -1 || low.indexOf("customs") !== -1) {
    return WORKFLOW_6_STAGES_SERVER_[4];
  }
  if (low.indexOf("3.") === 0 || low.indexOf("booking") !== -1 || low.indexOf("đóng hàng") !== -1 || low.indexOf("đóng cont") !== -1 || low.indexOf("stuffing") !== -1) {
    return WORKFLOW_6_STAGES_SERVER_[3];
  }
  if (low.indexOf("2.") === 0 || low.indexOf("ký hđ") !== -1 || low.indexOf("hợp đồng") !== -1 || low.indexOf("cọc") !== -1) {
    return WORKFLOW_6_STAGES_SERVER_[2];
  }
  if (low.indexOf("1.") === 0 || low.indexOf("rfq") !== -1 || low.indexOf("báo giá") !== -1) {
    return WORKFLOW_6_STAGES_SERVER_[1];
  }
  return raw;
}

/**
 * Chuyển trạng thái 6 bước sang chuỗi an toàn cho cột Fulfillment_Status trên Order_Master
 * để Code.gs (translateFulfillmentStatusServer_) không hiểu nhầm "6. Chờ thanh toán" thành "Hoàn tất quyết toán".
 */
function toOrderMasterSafeStatusServer_(canonical6Step) {
  var st = translateFulfillmentStatus6StepServer_(canonical6Step);
  if (st === WORKFLOW_6_STAGES_SERVER_[6]) {
    return "5B. Chờ thanh toán";
  }
  return st;
}

function getOrderLogisticsMetaServer_(orderId) {
  var cleanOid = String(orderId || "").trim().toUpperCase();
  if (!cleanOid) return {};
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(ORDER_LOGISTICS_META_PREFIX_ + cleanOid);
    if (!raw) return {};
    var parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object") ? parsed : {};
  } catch (e) {
    return {};
  }
}

function saveOrderLogisticsMetaServer_(orderId, metaPatch) {
  var cleanOid = String(orderId || "").trim().toUpperCase();
  if (!cleanOid) return {};
  var cur = getOrderLogisticsMetaServer_(cleanOid);
  var patch = (metaPatch && typeof metaPatch === "object") ? metaPatch : {};
  var pickAlias = function (keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = patch[keys[i]];
      if (v !== undefined && v !== null) return String(v).trim();
    }
    return undefined;
  };
  var allowedFields = [
    "Booking_Source", "BK_No", "FWD_BK_No", "Carrier_BK_No",
    "Ves_Voy", "Cont_Seal_List", "Cargo_Mode", "BL_Type", "Template_ID",
    "SI_Cutoff", "VGM_Cutoff", "CFS_Cutoff", "CY_Cutoff", "Customs_Cutoff", "Draft_BL_Cutoff",
    "Exact_Fulfillment_Status"
  ];
  for (var i = 0; i < allowedFields.length; i++) {
    var k = allowedFields[i];
    if (patch[k] !== undefined && patch[k] !== null) {
      cur[k] = String(patch[k]).trim();
    }
  }
  var aliasCarrier = pickAlias(["Carrier_BK_No", "Carrier_Booking_No"]);
  var aliasFwd = pickAlias(["FWD_BK_No", "FWD_Booking_No"]);
  var aliasBk = pickAlias(["BK_No", "Booking_No"]);
  var aliasVes = pickAlias(["Ves_Voy", "Vessel_Voyage"]);
  var aliasCont = pickAlias(["Cont_Seal_List", "Container_Seal_No", "Cont_Seal_No"]);

  if (aliasCarrier !== undefined) cur["Carrier_BK_No"] = aliasCarrier;
  if (aliasFwd !== undefined) cur["FWD_BK_No"] = aliasFwd;
  if (aliasBk !== undefined) cur["BK_No"] = aliasBk;
  if (aliasVes !== undefined) cur["Ves_Voy"] = aliasVes;
  if (aliasCont !== undefined) cur["Cont_Seal_List"] = aliasCont;

  if (!cur["BK_No"]) {
    var src = String(cur["Booking_Source"] || "").toUpperCase();
    cur["BK_No"] = (src === "FWD")
      ? (cur["FWD_BK_No"] || cur["Carrier_BK_No"] || "")
      : (cur["Carrier_BK_No"] || cur["FWD_BK_No"] || "");
  }
  // Mirror aliases for seamless client reads across all screens
  cur["Carrier_Booking_No"] = cur["Carrier_BK_No"] || "";
  cur["FWD_Booking_No"] = cur["FWD_BK_No"] || "";
  cur["Booking_No"] = cur["BK_No"] || "";
  cur["Vessel_Voyage"] = cur["Ves_Voy"] || "";
  cur["Container_Seal_No"] = cur["Cont_Seal_List"] || "";
  cur["Cont_Seal_No"] = cur["Cont_Seal_List"] || "";

  cur["Updated_At"] = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd HH:mm");
  try {
    PropertiesService.getScriptProperties().setProperty(ORDER_LOGISTICS_META_PREFIX_ + cleanOid, JSON.stringify(cur));
  } catch (err) {}
  return cur;
}

function getAllOrderLogisticsMeta() {
  var result = {};
  try {
    var props = PropertiesService.getScriptProperties().getProperties();
    for (var key in props) {
      if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
      if (key.indexOf(ORDER_LOGISTICS_META_PREFIX_) === 0) {
        var oid = key.substring(ORDER_LOGISTICS_META_PREFIX_.length);
        try {
          var parsed = JSON.parse(props[key]);
          if (parsed && typeof parsed === "object") {
            result[oid] = parsed;
          }
        } catch (parseErr) {}
      }
    }
  } catch (e) {}
  return { success: true, data: result };
}

function saveOrderLogisticsMeta(orderId, metaPatch) {
  var cleanOid = String(orderId || "").trim();
  if (!cleanOid) {
    return { success: false, message: "Thiếu mã đơn hàng." };
  }
  var patch = (metaPatch && typeof metaPatch === "object") ? metaPatch : {};
  if (patch.Exact_Fulfillment_Status) {
    var canonical6 = translateFulfillmentStatus6StepServer_(patch.Exact_Fulfillment_Status);
    patch.Exact_Fulfillment_Status = canonical6;
    updateRowByKey_("Order_Master", "Order_ID", cleanOid, {
      "Fulfillment_Status": toOrderMasterSafeStatusServer_(canonical6)
    });
  }
  var saved = saveOrderLogisticsMetaServer_(cleanOid, patch);
  return { success: true, orderId: cleanOid, data: saved };
}

function resolveDisplayBookingNoServer_(ord, meta) {
  var m = meta || {};
  var src = String(m.Booking_Source || (ord && ord["Booking_Source"]) || "").trim().toUpperCase();
  var carrierBk = String(m.Carrier_BK_No || m.Carrier_Booking_No || (ord && (ord["Carrier_BK_No"] || ord["Carrier_Booking_No"])) || "").trim();
  var fwdBk = String(m.FWD_BK_No || m.FWD_Booking_No || (ord && (ord["FWD_BK_No"] || ord["FWD_Booking_No"])) || "").trim();
  var plainBk = String(m.BK_No || m.Booking_No || (ord && (ord["BK_No"] || ord["Booking_No"])) || "").trim();
  if (src === "FWD" && fwdBk) return fwdBk;
  if (src === "CARRIER" && carrierBk) return carrierBk;
  return carrierBk || fwdBk || plainBk || "";
}

function generateNextContractNo_(orders) {
  var yearStr = Utilities.formatDate(new Date(), TIMEZONE, "yyyy");
  var maxNum = 0;
  for (var i = 0; i < (orders || []).length; i++) {
    var cno = String(orders[i]["Contract_No."] || "");
    var m = cno.match(/(?:SC|NSX)-(?:\d{4})[-/](\d+)/i);
    if (m) {
      var n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  return "SC-" + yearStr + "-" + ("000" + (maxNum + 1)).slice(-3) + "/GAE";
}

function suggestCoFormCode_(pod, country) {
  var hay = (String(pod || "") + " " + String(country || "")).toLowerCase();
  if (!hay.trim()) return "Form B";
  if (/china|trung quốc|shanghai|shenzhen|ningbo|qingdao|guangzhou|xiamen|tianjin|dalian|hong kong/.test(hay)) return "Form E";
  if (/asean|singapore|thailand|thái lan|indonesia|malaysia|philippines|cambodia|campuchia|laos|lào|myanmar|brunei|laem chabang|port klang|jakarta|manila/.test(hay)) return "Form D";
  if (/japan|nhật bản|nhật|tokyo|osaka|yokohama|nagoya|kobe|hakata/.test(hay)) return "Form AJ";
  if (/korea|hàn quốc|busan|incheon|seoul|pyeongtaek/.test(hay)) return "Form AK";
  if (/eu|europe|châu âu|netherlands|hà lan|rotterdam|germany|đức|hamburg|bremen|france|pháp|le havre|fos|belgium|bỉ|antwerp|spain|tây ban nha|barcelona|valencia|italy|ý|genoa|poland|sweden|denmark|portugal|greece/.test(hay)) return "EUR.1";
  if (/australia|new zealand|úc|sydney|melbourne|brisbane|fremantle|auckland|tauranga/.test(hay)) return "Form AANZ";
  if (/india|ấn độ|nhava sheva|mumbai|chennai|mundra|kolkata/.test(hay)) return "Form AI";
  return "Form B";
}

function detectOrderProductGroups_(items, products) {
  var groups = [];
  var prodList = products || [];
  for (var i = 0; i < (items || []).length; i++) {
    var sku = String(items[i].sku || "").trim().toLowerCase();
    var matchedProd = null;
    for (var p = 0; p < prodList.length; p++) {
      var pSku = String(getFieldFuzzy_(prodList[p], ["Mã sản phẩm", "SKU_Code", "SKU", "Product_ID"], ["sku", "mã sản phẩm", "mã hàng"])).trim().toLowerCase();
      if (pSku && pSku === sku) {
        matchedProd = prodList[p];
        break;
      }
    }
    var grp = matchedProd ? String(getFieldFuzzy_(matchedProd, ["Product_Group", "Nhóm sản phẩm", "Product Group", "Group"], ["product_group", "nhóm sản phẩm", "nhóm hàng"])).trim() : "";
    if (grp && groups.indexOf(grp) === -1) {
      groups.push(grp);
    }
  }
  return groups;
}

function getTemplateCodeField_(row) {
  if (!row || typeof row !== "object") return "";
  return String(row["Template ID"] || row["Template_ID"] || row["Template_Code"] || "").trim();
}

function getTemplateDocIdField_(row) {
  if (!row || typeof row !== "object") return "";
  var raw = row["Google_Doc_File_ID"] || row["Google_Doc_ID"] || row["Doc_ID"] || row["File_ID"] || "";
  return extractGoogleDocId_(raw);
}

function matchesTemplateCodeOrName_(row, targetKey) {
  var needle = String(targetKey || "").trim().toUpperCase();
  if (!needle || !row) return false;
  var c1 = String(row["Template ID"] || "").trim().toUpperCase();
  var c2 = String(row["Template_ID"] || "").trim().toUpperCase();
  var c3 = String(row["Template_Code"] || "").trim().toUpperCase();
  var c4 = String(row["Document_Name"] || "").trim().toUpperCase();
  return c1 === needle || c2 === needle || c3 === needle || c4 === needle;
}

function selectContractTemplateDynamic_(templates, items, products, overrideTemplateId) {
  var list = templates || [];
  var ovId = String(overrideTemplateId || "").trim();
  if (ovId) {
    for (var k = 0; k < list.length; k++) {
      if (matchesTemplateCodeOrName_(list[k], ovId)) return list[k];
    }
  }

  var groups = detectOrderProductGroups_(items, products);
  var contractTemplates = list.filter(function (t) {
    var tid = getTemplateCodeField_(t).toUpperCase();
    var dname = String(t["Document_Name"] || "").trim().toLowerCase();
    return tid.indexOf("QUO") === -1 && tid.indexOf("PACK") === -1 && (tid.indexOf("CON") !== -1 || tid.indexOf("CONTRACT") !== -1 || dname.indexOf("hợp đồng") !== -1);
  });
  var pool = contractTemplates.length > 0 ? contractTemplates : list;

  function findByExactId(exactId) {
    for (var idx = 0; idx < pool.length; idx++) {
      if (matchesTemplateCodeOrName_(pool[idx], exactId)) {
        return pool[idx];
      }
    }
    return null;
  }

  function findByKeywords(keywords) {
    for (var i = 0; i < pool.length; i++) {
      var hay = (getTemplateCodeField_(pool[i]) + " " + String(pool[i]["Document_Name"] || "").trim()).toLowerCase();
      for (var j = 0; j < keywords.length; j++) {
        if (hay.indexOf(keywords[j]) !== -1) return pool[i];
      }
    }
    return null;
  }

  if (groups.length >= 2) {
    var mixedExact = findByExactId("TMP_CONTRACT_MIXED_CARGO");
    if (mixedExact) return mixedExact;
    var mixed = findByKeywords(["hỗn hợp", "đa chủng loại", "mixed", "multi"]);
    if (mixed) return mixed;
  } else if (groups.length === 1) {
    var g = groups[0].toLowerCase();
    if (g.indexOf("hạt") !== -1 || g.indexOf("nut") !== -1 || g.indexOf("điều") !== -1) {
      var nutExact = findByExactId("TMP_CONTRACT_EDIBLE_NUTS");
      if (nutExact) return nutExact;
      var nutTpl = findByKeywords(["hạt dinh dưỡng", "edible_nut", "nut", "hat"]);
      if (nutTpl) return nutTpl;
    } else if (g.indexOf("gia vị khô") !== -1 || (g.indexOf("khô") !== -1 && g.indexOf("gia vị") !== -1)) {
      var dryExact = findByExactId("TMP_CONTRACT_DRIED_SPICES");
      if (dryExact) return dryExact;
      var drySpiceTpl = findByKeywords(["gia vị khô", "dried_spice", "dry", "spice"]);
      if (drySpiceTpl) return drySpiceTpl;
    } else if (g.indexOf("tươi") !== -1 || g.indexOf("cấp đông") !== -1 || g.indexOf("lạnh") !== -1 || g.indexOf("frozen") !== -1) {
      var freshExact = findByExactId("TMP_CONTRACT_FRESH_FROZEN");
      if (freshExact) return freshExact;
      var freshTpl = findByKeywords(["gia vị tươi", "cấp đông", "fresh_frozen", "tươi", "fresh", "frozen"]);
      if (freshTpl) return freshTpl;
    }
  }

  return (
    findByExactId("TMP_CONTRACT_DRIED_SPICES") ||
    findByExactId("TMP_SALES_CONTRACT") ||
    (pool.length > 0 ? pool[0] : null)
  );
}

function replaceAllSectionsText_(doc, tagPattern, valueStr) {
  var safeVal = (valueStr === null || valueStr === undefined) ? "" : String(valueStr);
  var body = doc.getBody();
  if (body) body.replaceText(tagPattern, safeVal);
  var header = doc.getHeader();
  if (header) header.replaceText(tagPattern, safeVal);
  var footer = doc.getFooter();
  if (footer) footer.replaceText(tagPattern, safeVal);
}

function replaceInlineLogoTagInContainer_(container, blob) {
  if (!container || !blob) return;
  var search = container.findText("\\{\\{\\s*COMPANY_LOGO\\s*\\}\\}");
  while (search) {
    try {
      var el = search.getElement();
      var startIdx = search.getStartOffset();
      var endIdx = search.getEndOffsetInclusive();
      var textEl = el.asText();
      textEl.deleteText(startIdx, endIdx);
      var parent = el.getParent();
      if (parent && typeof parent.insertInlineImage === "function") {
        var childIdx = parent.getChildIndex(el);
        var inserted = parent.insertInlineImage(childIdx, blob);
        var origW = inserted.getWidth();
        var origH = inserted.getHeight();
        if (origW > 0 && origH > 0) {
          var targetH = 44;
          inserted.setHeight(targetH);
          inserted.setWidth(Math.round(origW * (targetH / origH)));
        }
      }
    } catch (e) {}
    search = container.findText("\\{\\{\\s*COMPANY_LOGO\\s*\\}\\}");
  }
}

function replaceInlineLogoTag_(doc, logoId) {
  var cleanId = extractGoogleDocId_(logoId);
  if (!cleanId || cleanId === "NHAP_ID_LOGO_TAI_DAY" || cleanId.indexOf("NHAP_") === 0) {
    replaceAllSectionsText_(doc, "\\{\\{\\s*COMPANY_LOGO\\s*\\}\\}", "");
    return;
  }
  try {
    var logoBlob = DriveApp.getFileById(cleanId).getBlob();
    replaceInlineLogoTagInContainer_(doc.getBody(), logoBlob);
    replaceInlineLogoTagInContainer_(doc.getHeader(), logoBlob);
    replaceInlineLogoTagInContainer_(doc.getFooter(), logoBlob);
  } catch (err) {}
  replaceAllSectionsText_(doc, "\\{\\{\\s*COMPANY_LOGO\\s*\\}\\}", "");
}

function resolveProposedIncotermsServer_(prop, inq, modeOverride, forceIsComparison) {
  var opts = (modeOverride && typeof modeOverride === "object") ? modeOverride : {};
  var recInc = String(opts.selectedIncoterm || (prop && prop["Recommended Incoterm"]) || (inq && inq["Incoterm mong muốn"]) || "CIF").trim().toUpperCase();
  var explicitMode = String(opts.quotationMode || "").trim().toUpperCase();
  var overrideTplId = String(opts.templateId || "").trim().toUpperCase();
  if (explicitMode === "SINGLE" || overrideTplId === "TMP_QUOTATION_01") {
    return [recInc || "CIF"];
  }

  var raw = "";
  if (opts.proposedIncoterms) {
    raw = Array.isArray(opts.proposedIncoterms)
      ? opts.proposedIncoterms.join(",")
      : String(opts.proposedIncoterms);
  } else if (prop && prop["Proposed_Incoterms"]) {
    raw = String(prop["Proposed_Incoterms"]);
  } else if (inq && inq["Proposed_Incoterms"]) {
    raw = String(inq["Proposed_Incoterms"]);
  }
  var arr = [];
  if (raw) {
    var parts = raw.split(/[,;\n|]+/);
    for (var i = 0; i < parts.length; i++) {
      var code = String(parts[i] || "").trim().toUpperCase();
      if (code && arr.indexOf(code) === -1) arr.push(code);
    }
  }
  var reqInc = String((inq && inq["Incoterm mong muốn"]) || recInc).trim().toUpperCase();
  if (arr.length === 0) {
    if (recInc) arr.push(recInc);
    if (reqInc && arr.indexOf(reqInc) === -1) arr.push(reqInc);
  }
  if (forceIsComparison && arr.length < 2) {
    var baseCompare = ["EXW", "FOB", "CFR", "CIF"];
    for (var b = 0; b < baseCompare.length; b++) {
      if (arr.indexOf(baseCompare[b]) === -1) arr.push(baseCompare[b]);
    }
  }
  if (recInc && arr.indexOf(recInc) === -1) {
    arr.unshift(recInc);
  }
  return arr;
}

function resolveTextbookInsuranceRateServer_(incCode, insPlanCode) {
  var code = String(incCode || "").trim().toUpperCase();
  var plan = String(insPlanCode || "").trim().toUpperCase();
  var planRate = 0;
  if (plan === "INS-ICC-A") planRate = 0.0025;
  else if (plan === "INS-ICC-B") planRate = 0.0015;
  else if (plan === "INS-ICC-C") planRate = 0.0008;

  if (code === "CIP") {
    return planRate >= 0.0025 ? planRate : 0.0025;
  }
  if (code === "CIF") {
    return planRate > 0 ? planRate : 0.0008;
  }
  return 0;
}

function calcTextbookInsurancePremiumServer_(cPlusF, rateDecimal) {
  var base = Math.max(0, Number(cPlusF || 0));
  var r = Math.max(0, Math.min(0.25, Number(rateDecimal || 0)));
  if (base <= 0 || r <= 0) return 0;
  var insuredValue = (base * 1.1) / (1 - r);
  return Number((r * insuredValue).toFixed(2));
}

function computeIncotermTotalServer_(incCode, exwTotal, fobTotal, cfrTotal, cifTotal, activeRecInc, activeFinalPrice, cipTotal, destTotal) {
  var code = String(incCode || "").trim().toUpperCase();
  var activeCode = String(activeRecInc || "").trim().toUpperCase();
  if (activeCode && code === activeCode && parseSmartNumber_(activeFinalPrice) > 0) {
    return Number(parseSmartNumber_(activeFinalPrice).toFixed(2));
  }
  if (code === "EXW") return Number(parseSmartNumber_(exwTotal).toFixed(2));
  if (code === "FCA" || code === "FAS" || code === "FOB") return Number(parseSmartNumber_(fobTotal).toFixed(2));
  if (code === "CFR" || code === "CPT") return Number(parseSmartNumber_(cfrTotal).toFixed(2));
  if (code === "CIF") return Number(parseSmartNumber_(cifTotal).toFixed(2));
  if (code === "CIP") {
    var cipVal = parseSmartNumber_(cipTotal);
    return cipVal > 0 ? Number(cipVal.toFixed(2)) : Number((cfrTotal + calcTextbookInsurancePremiumServer_(cfrTotal, 0.0025)).toFixed(2));
  }
  if (code === "DAP" || code === "DPU" || code === "DDP") {
    var dVal = parseSmartNumber_(destTotal);
    return dVal > 0 ? Number(dVal.toFixed(2)) : Number(parseSmartNumber_(cfrTotal).toFixed(2));
  }
  return Number(parseSmartNumber_(cifTotal).toFixed(2));
}

function describeIncotermCostsServer_(incCode, insPlanCode) {
  var code = String(incCode || "").trim().toUpperCase();
  var plan = String(insPlanCode || "").trim().toUpperCase();
  var cifClause = (plan === "INS-ICC-A")
    ? "ICC (A) All Risks"
    : ((plan === "INS-ICC-B") ? "ICC (B)" : "ICC (C)");
  if (code === "EXW") return "Ex-Works Export Product Value (Seller's Premises)";
  if (code === "FCA" || code === "FAS" || code === "FOB") return "FOB Export Value (Export-Cleared & Delivered at POL)";
  if (code === "CFR") return "FOB Value + Ocean Freight to POD (Risk transfers on board at POL; Insurance by Buyer)";
  if (code === "CPT") return "FCA Value + International Main Freight to Destination (Insurance by Buyer)";
  if (code === "CIF") return "FOB Value + Ocean Freight + Marine Insurance (" + cifClause + ", 110% CIF Value)";
  if (code === "CIP") return "FCA Value + Main Freight + Marine Insurance (ICC (A) All Risks, 110% CIP Value)";
  if (code === "DDP") return "CFR Value + Destination Delivery Charges & Import Duty (DDP)";
  return "CFR Value + Destination Delivery Charges (" + code + ")";
}

function describeIncotermRecommendServer_(incCode, isRecommended) {
  return isRecommended ? "\u2605 RECOMMENDED OPTIMAL TERM" : "Alternative Option";
}

function exportTempDocAsBase64_(docId, fileBaseName, exportFormat) {
  var fmt = (String(exportFormat || "pdf").toLowerCase() === "docx") ? "docx" : "pdf";
  var mimeType = fmt === "docx"
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : "application/pdf";
  var safeBase = String(fileBaseName || "Document").replace(/[\\/:*?"<>|]/g, "_");
  var exportUrl = "https://docs.google.com/document/d/" + docId + "/export?format=" + fmt;

  var res = UrlFetchApp.fetch(exportUrl, {
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() === 200) {
    return {
      fileName: safeBase + "." + fmt,
      mimeType: mimeType,
      base64Data: Utilities.base64Encode(res.getBlob().getBytes())
    };
  }
  if (fmt === "pdf") {
    var pdfBlob = DriveApp.getFileById(docId).getAs("application/pdf");
    return {
      fileName: safeBase + ".pdf",
      mimeType: "application/pdf",
      base64Data: Utilities.base64Encode(pdfBlob.getBytes())
    };
  }
  throw new Error("Không thể xuất định dạng " + fmt.toUpperCase() + " (HTTP " + res.getResponseCode() + "). Hãy chạy hàm capQuyenHeThong trong Apps Script trước.");
}

function numberToUsdWordsServer_(amount) {
  var num = Math.max(0, Number(amount || 0));
  var dollars = Math.floor(num + 0.000001);
  var cents = Math.round((num - dollars) * 100);
  if (cents >= 100) {
    dollars += 1;
    cents = 0;
  }
  var ones = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN",
    "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"];
  var tens = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];
  var scales = ["", "THOUSAND", "MILLION", "BILLION"];

  function chunkToWords(n) {
    var out = [];
    var h = Math.floor(n / 100);
    var rem = n % 100;
    if (h > 0) out.push(ones[h] + " HUNDRED");
    if (rem >= 20) {
      var t = Math.floor(rem / 10);
      var o = rem % 10;
      out.push(o > 0 ? (tens[t] + "-" + ones[o]) : tens[t]);
    } else if (rem > 0) {
      out.push(ones[rem]);
    }
    return out.join(" ");
  }

  if (dollars === 0 && cents === 0) return "SAY TOTAL: US DOLLARS ZERO ONLY.";
  var parts = [];
  var scaleIdx = 0;
  var tmp = dollars;
  while (tmp > 0 && scaleIdx < scales.length) {
    var chunk = tmp % 1000;
    if (chunk > 0) {
      var words = chunkToWords(chunk);
      parts.unshift(scales[scaleIdx] ? (words + " " + scales[scaleIdx]) : words);
    }
    tmp = Math.floor(tmp / 1000);
    scaleIdx++;
  }
  var dollarStr = parts.length > 0 ? parts.join(" ") : "ZERO";
  var centStr = cents > 0 ? (" AND CENTS " + chunkToWords(cents)) : "";
  return "SAY TOTAL: US DOLLARS " + dollarStr + centStr + " ONLY.";
}

function stripInternalCodesForCustomer_(text) {
  return String(text || "")
    .replace(/\bTMP_[A-Z0-9_]+\b/gi, "")
    .replace(/\(\s*(?:Comparison|Mixed|Single|So\s*s[áa]nh|H[ỗo]n\s*h[ợo]p)\s*\)/gi, "")
    .replace(/\b(?:Comparison|Mixed)\b/gi, "")
    .replace(/\bORD-[A-Z0-9-]+\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.)\]])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/^\s*[-–—·|]+\s*|\s*[-–—·|]+\s*$/g, "")
    .trim();
}

function cleanQuoteIdForCustomer_(rawQuoteId) {
  var s = String(rawQuoteId || "").trim().replace(/-(?:V|R)\d+$/i, "");
  s = s.replace(/^QT-ORD-/i, "QT-").replace(/^ORD-/i, "QT-");
  return s || "QT-EXPORT";
}

function fixBuyerContactPersonPlaceholders_(doc, cneContact) {
  var contactVal = String(cneContact || "").trim();
  if (!doc || !contactVal) return;
  var patterns = [
    ["(Contact\\s*Person\\s*:\\s*)\\{\\{\\s*(?:BUYER_NAME|CNE_NAME|Consignee_Name)\\s*\\}\\}", "$1" + contactVal],
    ["(Attn\\.?\\s*:\\s*)\\{\\{\\s*(?:BUYER_NAME|CNE_NAME|Consignee_Name)\\s*\\}\\}", "$1" + contactVal]
  ];
  for (var i = 0; i < patterns.length; i++) {
    replaceAllSectionsText_(doc, patterns[i][0], patterns[i][1]);
  }
}

function cleanMergedDocSections_(doc) {
  var patterns = [
    ["\\{\\{[^}]+\\}\\}", ""],
    ["\\{\\{TOT_QTY\\}", ""],
    ["\\{\\{OTP_PLACE\\}", ""],
    ["\\(\\s*Port of Loading:\\s*—\\s*Port of Discharge:\\s*\\)", ""],
    ["\\(\\s*Port of Loading:\\s*-\\s*Port of Discharge:\\s*\\)", ""],
    ["[ \\t]*\\(\\s*\\)", ""],
    ["\\s*→\\s*$", ""],
    ["^\\s*→\\s*", ""]
  ];
  for (var i = 0; i < patterns.length; i++) {
    replaceAllSectionsText_(doc, patterns[i][0], patterns[i][1]);
  }
}

function selectQuotationTemplateDynamic_(templates, isComparison, overrideTemplateId) {
  var list = (templates || []).filter(function (t) {
    var status = String(t["Status"] || "Active").trim().toLowerCase();
    return status !== "inactive" && status !== "locked";
  });
  var ovId = String(overrideTemplateId || "").trim();
  if (ovId) {
    for (var m = 0; m < list.length; m++) {
      if (matchesTemplateCodeOrName_(list[m], ovId)) {
        return list[m];
      }
    }
    for (var m2 = 0; m2 < (templates || []).length; m2++) {
      if (matchesTemplateCodeOrName_(templates[m2], ovId)) {
        return templates[m2];
      }
    }
  }
  var exactId = isComparison ? "TMP_QUOTATION_TUVAN" : "TMP_QUOTATION_01";
  for (var i = 0; i < list.length; i++) {
    if (matchesTemplateCodeOrName_(list[i], exactId)) {
      return list[i];
    }
  }
  for (var j = 0; j < list.length; j++) {
    var tid = getTemplateCodeField_(list[j]).toUpperCase();
    var dname = String(list[j]["Document_Name"] || "").trim().toLowerCase();
    if (isComparison && (tid.indexOf("TUVAN") !== -1 || tid.indexOf("COMPAR") !== -1 || dname.indexOf("so sánh") !== -1 || dname.indexOf("tư vấn") !== -1)) {
      return list[j];
    }
    if (!isComparison && tid.indexOf("QUO") !== -1 && tid.indexOf("TUVAN") === -1 && tid.indexOf("COMPAR") === -1) {
      return list[j];
    }
  }
  for (var k = 0; k < list.length; k++) {
    if (getTemplateCodeField_(list[k]).toUpperCase().indexOf("QUO") !== -1) {
      return list[k];
    }
  }
  return null;
}

/**
 * Xuất file Báo giá từ mẫu Template_Manager (TMP_QUOTATION_01 / TMP_QUOTATION_TUVAN)
 * và trả thẳng dữ liệu Base64 (.docx / .pdf), xóa file tạm ngay lập tức.
 */
function exportQuotationFromTemplate(orderId, exportFormat, modeOverride) {
  var templates = readSheetAsObjects_("Template_Manager");
  var inquiries = readSheetAsObjects_("Inquiry_Quotation");
  var proposals = readSheetAsObjects_("Pricing_Proposal");
  var consignees = readSheetAsObjects_("Consignee_Directory");
  var lookups = readSheetAsObjects_("System_Lookups");
  var products = readSheetAsObjects_("Product_Catalog");
  var pricingRates = readSheetAsObjects_("Pricing_Rates");
  var schedules = readSheetAsObjects_("Shipping_Schedule");
  var localChargesList = readSheetAsObjects_("Local_Charges");
  var customsFeesList = readSheetAsObjects_("Customs_Service_Fees");

  var inq = null;
  for (var i = 0; i < inquiries.length; i++) {
    if (String(inquiries[i]["Order_ID"]).trim().toUpperCase() === String(orderId).trim().toUpperCase()) {
      inq = inquiries[i];
      break;
    }
  }
  if (!inq) return { success: false, message: "Không tìm thấy đơn hàng " + orderId };

  var prop = null;
  var fallbackProp = null;
  for (var p = proposals.length - 1; p >= 0; p--) {
    var oid = proposals[p]["Order ID"] || proposals[p]["Order_ID"] || "";
    if (String(oid).trim().toUpperCase() === String(orderId).trim().toUpperCase()) {
      if (!fallbackProp) fallbackProp = proposals[p];
      var bStat = String(proposals[p]["Booking_Status"] || "");
      if (bStat.indexOf("Superseded") === -1 && bStat.indexOf("Đã thay thế") === -1) {
        prop = proposals[p];
        break;
      }
    }
  }
  if (!prop) prop = fallbackProp;

  var cus = null;
  for (var c = 0; c < consignees.length; c++) {
    if (String(consignees[c]["Consignee_ID"]).trim() === String(inq["Consignee_ID"]).trim()) {
      cus = consignees[c];
      break;
    }
  }

  var opts = (modeOverride && typeof modeOverride === "object") ? modeOverride : {};
  var overrideTplId = String(opts.templateId || "").trim().toUpperCase();
  var explicitMode = String(opts.quotationMode || "").trim().toUpperCase();
  var storedMode = String((prop && prop["Quotation_Mode"]) || (inq && inq["Quotation_Mode"]) || "").toUpperCase();
  var rawProposedPre = resolveProposedIncotermsServer_(prop, inq, opts, false);

  var isComparison;
  if (overrideTplId === "TMP_QUOTATION_TUVAN" || explicitMode === "COMPARISON" || explicitMode === "COMPARE") {
    isComparison = true;
  } else if (overrideTplId === "TMP_QUOTATION_01" || explicitMode === "SINGLE") {
    isComparison = false;
  } else {
    isComparison = (storedMode === "COMPARISON") || (storedMode === "COMPARE") || (rawProposedPre.length >= 2);
  }
  var proposedList = resolveProposedIncotermsServer_(prop, inq, opts, isComparison);

  var quoTpl = selectQuotationTemplateDynamic_(templates, isComparison, overrideTplId);
  var cleanTplId = getTemplateDocIdField_(quoTpl);
  if (!cleanTplId) {
    return {
      success: false,
      message: "Chưa cấu hình Google Doc File ID cho mẫu báo giá " + (overrideTplId || (isComparison ? "TMP_QUOTATION_TUVAN" : "TMP_QUOTATION_01")) + " trong Quản lý biểu mẫu."
    };
  }

  var copyFile = null;
  try {
    var quoteRound = parseInt((prop && prop["Quote_Round"]) || (inq && inq["Quote_Round"]) || 1, 10) || 1;
    var cleanOidQuo = String(orderId || "").trim().replace(/-(?:V|R)\d+$/i, "");
    var rawQuoNo = String((prop && (prop["Quote_ID"] || prop["Quotation_No"])) || (cleanOidQuo ? ("QT-" + cleanOidQuo) : "")).trim();
    var quoNo = rawQuoNo.replace(/-(?:V|R)\d+$/i, "") || (cleanOidQuo ? ("QT-" + cleanOidQuo) : "");
    var displayQuoNo = cleanQuoteIdForCustomer_(quoNo);
    var quoDate = String((prop && prop["Booking_Date"]) || Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd"));
    var cneSafeForFile = String((cus && cus["Consignee_Name"]) || "Customer").replace(/[\\/:*?"<>|]+/g, "").trim().replace(/\s+/g, "_");
    var safeBaseName = ("Quotation_" + displayQuoNo + "_" + (cneSafeForFile || "Customer")).replace(/[\\/:*?"<>|\s]+/g, "_");
    var templateFile = DriveApp.getFileById(cleanTplId);
    copyFile = templateFile.makeCopy("TEMP_" + safeBaseName);
    var docId = copyFile.getId();
    var doc = DocumentApp.openById(docId);
    var body = doc.getBody();

    var orderItems = parseOrderItemsServer_(inq, inq["Mã sản phẩm"] || inq["SKU_Code"], inq["Total_Weight_KG"] || inq["Net_Weight_KGs"], products, pricingRates, lookups);
    var usePltQ = (prop && (prop["Use_Pallet"] === true || String(prop["Use_Pallet"] || "").toUpperCase() === "TRUE")) || (inq && (inq["Use_Pallet"] === true || String(inq["Use_Pallet"] || "").toUpperCase() === "TRUE"));
    var qPackSummary = computeOrderPackingSpecsServer_(orderItems, pricingRates, usePltQ);
    var netWeightVal = parseSmartNumber_(inq["Total_Weight_KG"]) || parseSmartNumber_(inq["Net_Weight_KGs"]);
    if (netWeightVal <= 0) {
      netWeightVal = qPackSummary.cargoNetKg;
    }
    var qGrossWeightVal = parseSmartNumber_(prop && prop["Total_Gross_Weight"]) || qPackSummary.totalGrossWeightKg || netWeightVal;
    var qCbmVal = parseSmartNumber_(prop && prop["Total_CBM"]) || qPackSummary.totalCbm;

    var goodsCostVal = parseSmartNumber_(prop && prop["Goods_Cost"]);
    var packPalletVal = parseSmartNumber_(prop && prop["Packing_Pallet_Cost"]);
    var freightLocalVal = parseSmartNumber_(prop && prop["Total_Freight_Local"]);
    var insCostVal = parseSmartNumber_(prop && prop["Insurance_Cost"]);
    var insPlanCode = String((prop && prop["Insurance_Code"]) || "").trim().toUpperCase();
    var recInc = String(opts.selectedIncoterm || (prop && prop["Recommended Incoterm"]) || inq["Incoterm mong muốn"] || "CIF").trim().toUpperCase();
    var finalPriceVal = parseSmartNumber_(opts.overrideFinalPrice) > 0
      ? parseSmartNumber_(opts.overrideFinalPrice)
      : parseSmartNumber_(prop && (prop["Final_Selling Price"] !== undefined ? prop["Final_Selling Price"] : prop["Final_Selling_Price"]));
    if (finalPriceVal <= 0) {
      finalPriceVal = goodsCostVal + packPalletVal + freightLocalVal + insCostVal;
    }

    var storedExw = parseSmartNumber_(prop && prop["EXW_Price"]);
    var storedFob = parseSmartNumber_(prop && prop["FOB_Price"]);
    var storedCfr = parseSmartNumber_(prop && prop["CFR_Price"]);
    var storedCif = parseSmartNumber_(prop && prop["CIF_Price"]);
    var isAdjustedBySales = Boolean(prop && (prop["Adjusted_By_Sales"] === true || String(prop["Adjusted_By_Sales"] || "").toUpperCase() === "TRUE")) ||
      Boolean(opts.selectedIncoterm || parseSmartNumber_(opts.overrideFinalPrice) > 0);
    var insRateCif = resolveTextbookInsuranceRateServer_("CIF", insPlanCode);
    var insRateCip = resolveTextbookInsuranceRateServer_("CIP", insPlanCode);
    var insRateActive = resolveTextbookInsuranceRateServer_(recInc, insPlanCode);

    var schRow = null;
    if (prop && prop["Schedule_ID"]) {
      for (var s = 0; s < schedules.length; s++) {
        if (String(schedules[s]["Schedule_ID"] || "").trim() === String(prop["Schedule_ID"]).trim()) {
          schRow = schedules[s];
          break;
        }
      }
    }
    var polStr = String((schRow && schRow["POL"]) || "Cat Lai Port, HCMC, Vietnam");
    var podStr = String((schRow && schRow["POD"]) || (cus && cus["Country"]) || "Destination Port");

    var oceanGuess = 0;
    var lclFreightSaved = parseSmartNumber_(prop && prop["LCL_Total_Freight_USD"]);
    var cTypeStr = String((prop && prop["Container_Type"]) || "");
    var isLclOnlyProp = (cTypeStr.toUpperCase().indexOf("LCL") !== -1 && cTypeStr.toUpperCase().indexOf("X") === -1) ||
      (parseSmartNumber_(prop && prop["Container_Qty"]) === 0 && lclFreightSaved > 0);
    if (isLclOnlyProp && lclFreightSaved > 0) {
      oceanGuess = lclFreightSaved;
    } else if (schRow) {
      var cType = cTypeStr;
      var cQty = parseSmartNumber_(prop && prop["Container_Qty"]);
      if (cQty <= 0 && !isLclOnlyProp) cQty = 1;
      var perContMatches = cType.match(/(\d+)\s*x\s*(20'?DC|40'?DC|40'?HC|20'?GP|40'?GP|20'?RF|40'?RF|40'?RH)/gi);
      if (perContMatches && perContMatches.length > 0) {
        for (var cm = 0; cm < perContMatches.length; cm++) {
          var partMatch = perContMatches[cm].match(/(\d+)\s*x\s*(.+)/i);
          if (partMatch) {
            var qn = parseSmartNumber_(partMatch[1]);
            var tn = String(partMatch[2] || "").toUpperCase();
            if (tn.indexOf("40") !== -1 && tn.indexOf("HC") !== -1) oceanGuess += (parseSmartNumber_(schRow["Rate_40HC"]) || Math.round(parseSmartNumber_(schRow["Rate_40DC"]) * 1.05)) * qn;
            else if (tn.indexOf("40") !== -1 && tn.indexOf("RH") !== -1) oceanGuess += (parseSmartNumber_(schRow["Rate_40'RH"]) || Math.round(parseSmartNumber_(schRow["Rate_40'RF"]) * 1.05)) * qn;
            else if (tn.indexOf("20DC") !== -1 || tn.indexOf("20'DC") !== -1 || tn.indexOf("20'GP") !== -1 || tn.indexOf("20GP") !== -1) oceanGuess += parseSmartNumber_(schRow["Rate_20DC"]) * qn;
            else if (tn.indexOf("40DC") !== -1 || tn.indexOf("40'DC") !== -1 || tn.indexOf("40'GP") !== -1 || tn.indexOf("40GP") !== -1) oceanGuess += parseSmartNumber_(schRow["Rate_40DC"]) * qn;
            else if (tn.indexOf("20") !== -1 && tn.indexOf("RF") !== -1) oceanGuess += parseSmartNumber_(schRow["Rate_20'RF"]) * qn;
            else if (tn.indexOf("40") !== -1 && tn.indexOf("RF") !== -1) oceanGuess += parseSmartNumber_(schRow["Rate_40'RF"]) * qn;
          }
        }
      } else {
        if (cType.indexOf("40HC") !== -1 || cType.indexOf("40'HC") !== -1) oceanGuess = (parseSmartNumber_(schRow["Rate_40HC"]) || Math.round(parseSmartNumber_(schRow["Rate_40DC"]) * 1.05)) * cQty;
        else if (cType.indexOf("40RH") !== -1 || cType.indexOf("40'RH") !== -1) oceanGuess = (parseSmartNumber_(schRow["Rate_40'RH"]) || Math.round(parseSmartNumber_(schRow["Rate_40'RF"]) * 1.05)) * cQty;
        else if (cType.indexOf("20DC") !== -1 || cType.indexOf("20'DC") !== -1 || cType.indexOf("20'GP") !== -1) oceanGuess = parseSmartNumber_(schRow["Rate_20DC"]) * cQty;
        else if (cType.indexOf("40DC") !== -1 || cType.indexOf("40'DC") !== -1 || cType.indexOf("40'GP") !== -1) oceanGuess = parseSmartNumber_(schRow["Rate_40DC"]) * cQty;
        else if (cType.indexOf("20'RF") !== -1 || cType.indexOf("20RF") !== -1) oceanGuess = parseSmartNumber_(schRow["Rate_20'RF"]) * cQty;
        else if (cType.indexOf("40'RF") !== -1 || cType.indexOf("40RF") !== -1) oceanGuess = parseSmartNumber_(schRow["Rate_40'RF"]) * cQty;
      }
      oceanGuess += (parseSmartNumber_(schRow["BAF_Fee"]) + parseSmartNumber_(schRow["LSS_Fee"]) + parseSmartNumber_(schRow["PSS_Fee"]) + parseSmartNumber_(schRow["Seal_Fee"])) * cQty;
      if (cQty > 0 || isLclOnlyProp) {
        oceanGuess += parseSmartNumber_(schRow["B/L_Fee"]);
      }
      if (lclFreightSaved > 0 && cTypeStr.toUpperCase().indexOf("LCL") !== -1) {
        oceanGuess += lclFreightSaved;
      }
    }
    if (storedCfr > storedFob && storedFob > 0) {
      oceanGuess = Number((storedCfr - storedFob).toFixed(2));
    }
    if (oceanGuess <= 0 && freightLocalVal > 0 && recInc !== "EXW" && recInc !== "FOB" && recInc !== "FCA" && recInc !== "FAS") {
      oceanGuess = Number((freightLocalVal * 0.72).toFixed(2));
    }
    oceanGuess = Number(Math.max(0, oceanGuess).toFixed(2));
    var localAndCustomsEst = Number(Math.max(0, freightLocalVal - oceanGuess).toFixed(2));

    // Cấu trúc Báo giá Xuất khẩu thực tế:
    // - KHÔNG lộ biên lợi nhuận (%), giá vốn hàng hóa hay các phí nội địa (hun trùng, kiểm dịch, trucking, local charges).
    // - Toàn bộ (Giá vốn + Lợi nhuận + Bao bì/Pallet + Trucking + Phí cảng/Hải quan XK) được phân bổ ẩn vào Đơn giá FOB từng sản phẩm.
    // - Chỉ hiển thị các dòng phụ phí QUỐC TẾ bên dưới Subtotal khi áp dụng với Incoterm đang chào:
    //   + Ocean Freight: chỉ nhóm C & D
    //   + Marine Insurance (110% CIF/CIP): chỉ CIF & CIP (V = (C+F)*1.1/(1-R), I = R*V)
    //   + Destination Delivery / Import Duty: chỉ nhóm D
    var isGroupC = (recInc === "CFR" || recInc === "CPT" || recInc === "CIF" || recInc === "CIP");
    var isCifOrCip = (recInc === "CIF" || recInc === "CIP");
    var isDestTerm = (recInc === "DAP" || recInc === "DPU" || recInc === "DDP");
    var freightIncluded = isGroupC || isDestTerm;
    var insIncluded = isCifOrCip;

    var freightChargeApplied = freightIncluded ? Number(Math.min(oceanGuess, Math.max(0, finalPriceVal * 0.85)).toFixed(2)) : 0;
    var effectiveInsDisplayVal = 0;
    if (insIncluded) {
      if (insCostVal > 0 && !isAdjustedBySales && Math.abs(insCostVal - calcTextbookInsurancePremiumServer_(Math.max(0, finalPriceVal - insCostVal), insRateActive)) < 5) {
        effectiveInsDisplayVal = Number(insCostVal.toFixed(2));
      } else {
        var cPlusFDerived = finalPriceVal * (1 - insRateActive) / (1 + 0.1 * insRateActive);
        effectiveInsDisplayVal = Number(Math.max(0, finalPriceVal - cPlusFDerived).toFixed(2));
      }
    }

    var destChargeApplied = 0;
    if (isDestTerm) {
      if (storedCfr > 0 && finalPriceVal > storedCfr + 0.01) {
        destChargeApplied = Number((finalPriceVal - storedCfr).toFixed(2));
      } else {
        var estFobRef = storedFob > 0 ? storedFob : (goodsCostVal + packPalletVal + localAndCustomsEst);
        var estDest = finalPriceVal - estFobRef - freightChargeApplied;
        if (estDest > 0.01) {
          destChargeApplied = Number(estDest.toFixed(2));
        }
      }
    }

    var internationalAddOnsSum = Number((freightChargeApplied + effectiveInsDisplayVal + destChargeApplied).toFixed(2));
    var productSubtotalVal = Number(Math.max(0, finalPriceVal - internationalAddOnsSum).toFixed(2));
    if (productSubtotalVal <= 0 && finalPriceVal > 0) {
      freightChargeApplied = 0;
      effectiveInsDisplayVal = 0;
      destChargeApplied = 0;
      productSubtotalVal = Number(finalPriceVal.toFixed(2));
    }
    var subtotalAmtVal = productSubtotalVal;
    var unitPriceVal = netWeightVal > 0 ? (finalPriceVal / netWeightVal) : 0;

    // 4+ mức giá tham chiếu chuẩn cho bảng so sánh (TMP_QUOTATION_TUVAN)
    var fobTotal = (recInc === "FOB" || recInc === "FCA" || recInc === "FAS") && finalPriceVal > 0
      ? Number(finalPriceVal.toFixed(2))
      : ((recInc !== "EXW" && productSubtotalVal > 0)
        ? productSubtotalVal
        : (storedFob > 0 ? storedFob : Number((productSubtotalVal + localAndCustomsEst).toFixed(2))));

    var exwTotal = recInc === "EXW" && finalPriceVal > 0
      ? Number(finalPriceVal.toFixed(2))
      : ((storedExw > 0 && !isAdjustedBySales)
        ? storedExw
        : Number(Math.max(0, fobTotal - localAndCustomsEst).toFixed(2)));
    if (exwTotal <= 0) exwTotal = fobTotal;

    var cfrTotal = (recInc === "CFR" || recInc === "CPT") && finalPriceVal > 0
      ? Number(finalPriceVal.toFixed(2))
      : Number((fobTotal + oceanGuess).toFixed(2));

    var cifInsCalc = calcTextbookInsurancePremiumServer_(cfrTotal, insRateCif);
    var cipInsCalc = calcTextbookInsurancePremiumServer_(cfrTotal, insRateCip);
    var cifTotal = recInc === "CIF" && finalPriceVal > 0
      ? Number(finalPriceVal.toFixed(2))
      : Number((cfrTotal + cifInsCalc).toFixed(2));
    var cipTotal = recInc === "CIP" && finalPriceVal > 0
      ? Number(finalPriceVal.toFixed(2))
      : Number((cfrTotal + cipInsCalc).toFixed(2));
    var destTotal = isDestTerm && finalPriceVal > 0
      ? Number(finalPriceVal.toFixed(2))
      : Number((cfrTotal + destChargeApplied).toFixed(2));

    var incotermPlaceStr = recInc === "EXW"
      ? "Seller's Factory (Binh Duong / Dong Nai, Vietnam)"
      : ((recInc === "FCA" || recInc === "FAS" || recInc === "FOB") ? polStr : podStr);

    var localStatusStr = "Included in FOB Unit Price";
    var localAmtStr = "0.00";
    var freightStatusStr = freightIncluded ? "Included (Seller)" : "Excluded (Buyer)";
    var freightAmtStr = freightIncluded ? formatCurrency(freightChargeApplied) : "0.00";
    var insStatusStr = insIncluded ? "Included (Seller - 110% " + recInc + ")" : "Excluded (Buyer)";
    var insAmtStr = insIncluded ? formatCurrency(effectiveInsDisplayVal) : "0.00";
    var destStatusStr = (isDestTerm && destChargeApplied > 0) ? "Included (Seller)" : "Excluded (Buyer)";
    var destAmtStr = (isDestTerm && destChargeApplied > 0) ? formatCurrency(destChargeApplied) : "0.00";

    var qInsClauseStr = !insIncluded
      ? "Marine Cargo Insurance excluded — to be arranged and covered by Buyer"
      : (recInc === "CIP" || insPlanCode === "INS-ICC-A"
        ? "Institute Cargo Clauses (A) All Risks - 110% of " + recInc + " Value covered by Seller"
        : (insPlanCode === "INS-ICC-B"
          ? "Institute Cargo Clauses (B) - 110% of CIF Value covered by Seller"
          : "Institute Cargo Clauses (C) - 110% of CIF Value covered by Seller"));

    // 1. Nhân bản dòng sản phẩm: Phân bổ ẩn (Giá vốn + Lợi nhuận + Bao bì/Pallet + Phí nội địa/HQ XK) vào Đơn giá FOB
    var baseWeightedSum = 0;
    var qItemsPrepared = [];
    for (var qi = 0; qi < orderItems.length; qi++) {
      var qIt = orderItems[qi];
      var qBd = qPackSummary.breakdown[qi] || { cartons: 0, nw: qIt.weight, gw: qIt.weight, cbm: 0 };
      var qProd = null;
      for (var qp = 0; qp < products.length; qp++) {
        var qSku = String(getFieldFuzzy_(products[qp], ["SKU_Code", "Mã sản phẩm", "SKU"], ["sku", "mã sản phẩm"])).trim();
        if (qSku.toLowerCase() === String(qIt.sku || "").trim().toLowerCase()) {
          qProd = products[qp];
          break;
        }
      }
      var qPackLookup = qIt.packingCode ? findSystemLookup_(lookups, "PACKING", qIt.packingCode) : null;
      var qBaseUnit = qProd ? parseSmartNumber_(getFieldFuzzy_(qProd, ["Unit_Price", "Đơn giá", "Price"], ["unit_price", "đơn giá"])) : 0;
      var qEffUnit = Math.max(0, qBaseUnit + parseSmartNumber_(qIt.packingExtra || 0));
      var qBaseLine = qEffUnit * parseSmartNumber_(qIt.weight);
      baseWeightedSum += qBaseLine;
      qItemsPrepared.push({
        stt: String(qi + 1),
        sku: String(qIt.sku || ""),
        name: String((qProd && getFieldFuzzy_(qProd, ["Item_Name_ENG", "English_Name", "Product_Name_ENG"], ["item_name_eng", "english"])) || qIt.nameEng || qIt.name || qIt.sku),
        grade: String((qProd && getFieldFuzzy_(qProd, ["Grade", "ITEM_GRADE", "Phân loại", "Hạng"], ["grade", "hạng"])) || "Grade A"),
        spec: String((qProd && getFieldFuzzy_(qProd, ["Spec", "ITEM_SPEC", "Specification", "Specifications", "Technical_Spec", "Thông số kỹ thuật"], ["spec", "kỹ thuật"])) || (qProd && getFieldFuzzy_(qProd, ["Packaging", "Quy cách"], ["quy cách"])) || "-"),
        org: String((qProd && getFieldFuzzy_(qProd, ["Origin", "ORG", "Xuất xứ"], ["origin", "xuất xứ"])) || "VIETNAM").toUpperCase(),
        cropYear: String((qProd && getFieldFuzzy_(qProd, ["Crop_Year", "CROP_YEAR", "Mùa vụ", "Năm thu hoạch"], ["crop_year", "mùa vụ", "năm thu hoạch"])) || Utilities.formatDate(new Date(), TIMEZONE, "yyyy")),
        pack: String((qPackLookup && qPackLookup["Contract_Text_ENG"]) || qBd.packEng || qIt.packingName || qIt.packingCode || "-"),
        unit: " KGS",
        weight: parseSmartNumber_(qIt.weight),
        cartons: qBd.cartons || parseSmartNumber_(qIt.cartons || 0),
        gw: qBd.gw || parseSmartNumber_(qIt.weight),
        cbm: qBd.cbm || 0,
        baseLine: qBaseLine
      });
    }
    var firstOriginQ = (qItemsPrepared.length > 0 && qItemsPrepared[0].org) ? qItemsPrepared[0].org : "VIETNAM";
    var tables = body.getTables();
    for (var tbIdx = 0; tbIdx < tables.length; tbIdx++) {
      var table = tables[tbIdx];
      var nRows = table.getNumRows();
      for (var rIdx = 0; rIdx < nRows; rIdx++) {
        var tr = table.getRow(rIdx);
        var rTxt = tr.getText() || "";
        if (rTxt.indexOf("{{ITEM_SKU}}") !== -1 || rTxt.indexOf("{{ITEM_NAME}}") !== -1 || rTxt.indexOf("{{ITEM_STT}}") !== -1) {
          var runningFobSum = 0;
          for (var cIdx = 0; cIdx < qItemsPrepared.length; cIdx++) {
            var qObj = qItemsPrepared[cIdx];
            var share = baseWeightedSum > 0 ? (qObj.baseLine / baseWeightedSum) : (netWeightVal > 0 ? qObj.weight / netWeightVal : 1 / Math.max(1, qItemsPrepared.length));
            var lAmt = productSubtotalVal > 0 ? Number((productSubtotalVal * share).toFixed(2)) : Number(qObj.baseLine.toFixed(2));
            if (productSubtotalVal > 0 && cIdx === qItemsPrepared.length - 1) {
              lAmt = Number(Math.max(0, productSubtotalVal - runningFobSum).toFixed(2));
            } else {
              runningFobSum += lAmt;
            }
            var lUnit = qObj.weight > 0 ? (lAmt / qObj.weight) : 0;
            var cloned = tr.copy();
            cloned.replaceText("\\{\\{ITEM_STT\\}\\}", qObj.stt);
            cloned.replaceText("\\{\\{ITEM_SKU\\}\\}", qObj.sku);
            cloned.replaceText("\\{\\{ITEM_NAME\\}\\}", qObj.name);
            cloned.replaceText("\\{\\{ITEM_GRADE\\}\\}", qObj.grade);
            cloned.replaceText("\\{\\{ITEM_SPEC\\}\\}", qObj.spec);
            cloned.replaceText("\\{\\{ORG\\}\\}", qObj.org);
            cloned.replaceText("\\{\\{ORIGIN\\}\\}", qObj.org);
            cloned.replaceText("\\{\\{CROP_YEAR\\}\\}", qObj.cropYear);
            cloned.replaceText("\\{\\{ITEM_PACK\\}\\}", qObj.pack);
            cloned.replaceText("\\{\\{ITEM_CARTONS\\}\\}", String(qObj.cartons));
            cloned.replaceText("\\{\\{ITEM_QTY\\}\\}", formatCurrency(qObj.weight));
            cloned.replaceText("\\{\\{ITEM_NW\\}\\}", formatCurrency(qObj.weight));
            cloned.replaceText("\\{\\{ITEM_GW\\}\\}", formatCurrency(qObj.gw));
            cloned.replaceText("\\{\\{ITEM_CBM\\}\\}", Number(qObj.cbm || 0).toFixed(3));
            cloned.replaceText("\\{\\{ITEM_UNIT\\}\\}", qObj.unit);
            cloned.replaceText("\\{\\{ITEM_PRICE\\}\\}", formatCurrency(lUnit));
            cloned.replaceText("\\{\\{ITEM_AMT\\}\\}", formatCurrency(lAmt));
            table.insertTableRow(rIdx + 1 + cIdx, cloned);
          }
          table.removeRow(rIdx);
          break;
        }
      }
    }

    // 1B. Dọn dẹp dòng chi phí nội địa & chỉ giữ các dòng phụ phí QUỐC TẾ áp dụng với Incoterm đang chào
    var tablesForCharges = body.getTables();
    for (var ctIdx = 0; ctIdx < tablesForCharges.length; ctIdx++) {
      var cTable = tablesForCharges[ctIdx];
      var hasDestPlaceholder = false;
      var freightRowIdxForDest = -1;
      for (var checkR = 0; checkR < cTable.getNumRows(); checkR++) {
        var checkTxt = cTable.getRow(checkR).getText() || "";
        if (checkTxt.indexOf("{{DEST_AMT}}") !== -1 || checkTxt.indexOf("{{DEST_DELIVERY_AMT}}") !== -1) {
          hasDestPlaceholder = true;
        }
      }
      for (var cr = cTable.getNumRows() - 1; cr >= 0; cr--) {
        var cRow = cTable.getRow(cr);
        var cTxt = cRow.getText() || "";
        var cTxtLow = cTxt.toLowerCase();
        var isOptTemplateRow = cTxt.indexOf("{{OPT_INCOTERM}}") !== -1 || cTxt.indexOf("{{OPT_TOT_AMT}}") !== -1;
        if (isOptTemplateRow) continue;

        var isDomesticOrInternalRow =
          cTxt.indexOf("{{LOCAL_AMT}}") !== -1 ||
          cTxt.indexOf("{{LOCAL_STATUS}}") !== -1 ||
          cTxt.indexOf("{{Goods_Cost}}") !== -1 ||
          cTxt.indexOf("{{Packing_Pallet_Cost}}") !== -1 ||
          cTxt.indexOf("{{Min_Margin_Pct}}") !== -1 ||
          ((cTxtLow.indexOf("fumigation") !== -1 || cTxtLow.indexOf("quarantine") !== -1 || cTxtLow.indexOf("trucking") !== -1 || cTxtLow.indexOf("profit margin") !== -1 || cTxtLow.indexOf("goods cost") !== -1 || cTxtLow.indexOf("local charge") !== -1 || cTxtLow.indexOf("export customs") !== -1) &&
            cTxt.indexOf("{{TOT_AMT}}") === -1 && cTxt.indexOf("{{SUBTOTAL_AMT}}") === -1);

        if (isDomesticOrInternalRow) {
          cTable.removeRow(cr);
          continue;
        }
        if ((cTxt.indexOf("{{FREIGHT_AMT}}") !== -1 || cTxt.indexOf("{{FREIGHT_STATUS}}") !== -1)) {
          if (!freightIncluded) {
            cTable.removeRow(cr);
            continue;
          } else {
            freightRowIdxForDest = cr;
          }
        }
        if ((cTxt.indexOf("{{INSURANCE_AMT}}") !== -1 || cTxt.indexOf("{{INSURANCE_STATUS}}") !== -1) && !insIncluded) {
          cTable.removeRow(cr);
          continue;
        }
        if ((cTxt.indexOf("{{DEST_AMT}}") !== -1 || cTxt.indexOf("{{DEST_DELIVERY_AMT}}") !== -1) && (!isDestTerm || destChargeApplied <= 0)) {
          cTable.removeRow(cr);
          continue;
        }
      }
      if (isDestTerm && destChargeApplied > 0 && !hasDestPlaceholder && freightRowIdxForDest !== -1 && freightRowIdxForDest < cTable.getNumRows()) {
        try {
          var destClone = cTable.getRow(freightRowIdxForDest).copy();
          var destTitle = recInc === "DDP" ? "Destination Delivery & Import Duty (DDP)" : ("Destination Delivery Charges (" + recInc + ")");
          destClone.replaceText("(?i)International\\s+Ocean\\s*/?\\s*(?:Main\\s+)?Freight[^\\n]*", destTitle);
          destClone.replaceText("(?i)Ocean\\s+Freight[^\\n]*", destTitle);
          destClone.replaceText("\\{\\{FREIGHT_STATUS\\}\\}", destStatusStr);
          destClone.replaceText("\\{\\{FREIGHT_AMT\\}\\}", destAmtStr);
          cTable.insertTableRow(freightRowIdxForDest + 1, destClone);
        } catch (destRowErr) {}
      }
    }

    // 2. Nhân bản chính xác N dòng so sánh Incoterm nếu mẫu có thẻ {{OPT_INCOTERM}} / {{OPT_PLACE}} / {{OTP_PLACE}}
    var optRenderList = isComparison ? proposedList : [recInc];
    var tablesAfterItems = body.getTables();
    for (var tbi = 0; tbi < tablesAfterItems.length; tbi++) {
      var optTable = tablesAfterItems[tbi];
      var optRows = optTable.getNumRows();
      for (var ori = 0; ori < optRows; ori++) {
        var otr = optTable.getRow(ori);
        var otxt = otr.getText() || "";
        if (otxt.indexOf("{{OPT_INCOTERM}}") !== -1 || otxt.indexOf("{{OPT_TOT_AMT}}") !== -1 || otxt.indexOf("{{OPT_PLACE}}") !== -1 || otxt.indexOf("{{OTP_PLACE}}") !== -1) {
          for (var oi = 0; oi < optRenderList.length; oi++) {
            var incOption = optRenderList[oi];
            var optAmt = computeIncotermTotalServer_(incOption, exwTotal, fobTotal, cfrTotal, cifTotal, recInc, finalPriceVal, cipTotal, destTotal);
            var optPlace = incOption === "EXW"
              ? "Seller's Factory (Binh Duong / Dong Nai)"
              : ((incOption === "FCA" || incOption === "FAS" || incOption === "FOB") ? polStr : podStr);
            var optRecommend = describeIncotermRecommendServer_(incOption, incOption === recInc);
            var clonedOpt = otr.copy();
            clonedOpt.replaceText("\\{\\{OPT_INCOTERM\\}\\}", incOption);
            clonedOpt.replaceText("\\{\\{OPT_PLACE\\}\\}", optPlace);
            clonedOpt.replaceText("\\{\\{OTP_PLACE\\}\\}", optPlace);
            clonedOpt.replaceText("\\{\\{OPT_COSTS\\}\\}", describeIncotermCostsServer_(incOption, insPlanCode));
            clonedOpt.replaceText("\\{\\{OPT_RECOMMEND\\}\\}", optRecommend);
            clonedOpt.replaceText("\\{\\{OPT_TOT_AMT\\}\\}", "$" + formatCurrency(optAmt));
            clonedOpt.replaceText("\\{\\{OPT_UNIT_PRICE\\}\\}", netWeightVal > 0 ? ("$" + formatCurrency(optAmt / netWeightVal)) : "$0.00");
            optTable.insertTableRow(ori + 1 + oi, clonedOpt);
          }
          optTable.removeRow(ori);
          break;
        }
      }
    }

    // 3. Chèn Logo công ty vào thẻ {{COMPANY_LOGO}} nếu đã cấu hình
    replaceInlineLogoTag_(doc, COMPANY_LOGO_ID);

    var cneName = String((cus && cus["Consignee_Name"]) || inq["Consignee_ID"] || "");
    var cneAddr = String(inq["Address"] || (cus && cus["Address"]) || "");
    var cneTax = String((cus && (cus["Tax"] || cus["Tax_ID"])) || "");
    var cnePhone = String((cus && cus["Phone"]) || inq["Phone"] || "");
    var cneEmail = String((cus && cus["Email"]) || inq["Email"] || "");
    var cneContact = String(
      (cus && getFieldFuzzy_(cus, ["Contact_Person", "Contact Person", "Người liên hệ", "Contact"], ["contact_person", "người liên hệ", "contact"])) ||
      inq["Contact"] ||
      inq["Contact_Person"] ||
      ""
    ).trim();
    var buyerTelCombined = [cnePhone, cneEmail].filter(Boolean).join(" / ");
    var saleName = String(inq["Sale_rep"] || "Sales Executive");

    var payRaw = String(inq["Phương thức thanh toán đề xuất"] || "");
    var payLookup = findSystemLookup_(lookups, "PAYMENT", payRaw);
    var payEng = payLookup && payLookup["Contract_Text_ENG"] ? String(payLookup["Contract_Text_ENG"]) : payRaw;
    var productNamesSummary = orderItems.map(function (it) {
      return (it.nameEng || it.name || it.sku) + " (" + formatCurrency(it.weight) + " KG" + (it.packingName ? " · " + it.packingName : "") + ")";
    }).join("; ");
    var totalQtyFormatted = formatCurrency(netWeightVal);
    var totalWords = numberToUsdWordsServer_(finalPriceVal);
    var contTypeStr = String((prop && prop["Container_Type"]) || "Optimal Container Mix");

    var quoTagMap = {
      "Order_ID": String(orderId),
      "ORDER_ID": String(orderId),
      "Quote_ID": displayQuoNo,
      "QUOTE_ID": displayQuoNo,
      "Quotation_No": displayQuoNo,
      "QUOTATION_NO": displayQuoNo,
      "QUOT_NO": displayQuoNo,
      "QUOT_DT": quoDate,
      "CTR_NO": displayQuoNo,
      "CTR_DT": quoDate,
      "VALID_DAYS": "3",
      "Quotation_Mode": isComparison ? "COMPARISON" : "SINGLE",
      "Proposed_Incoterms": proposedList.join(", "),
      "Consignee_Name": cneName,
      "CNE_NAME": cneName,
      "BUYER_NAME": cneName,
      "Address": cneAddr,
      "CNE_ADDR": cneAddr,
      "BUYER_ADDR": cneAddr,
      "CNE_TAX": cneTax,
      "Tax_ID": cneTax,
      "CNE_TEL": cnePhone,
      "CNE_PHONE": cnePhone,
      "CNE_EMAIL": cneEmail,
      "Contact": cneContact,
      "Contact_Person": cneContact,
      "CONTACT_PERSON": cneContact,
      "CNE_CONTACT": cneContact,
      "CNE_CONTACT_PERSON": cneContact,
      "CNE_REP": cneContact,
      "BUYER_CONTACT": cneContact,
      "BUYER_CONTACT_PERSON": cneContact,
      "BUYER_REP": cneContact,
      "ATTN": cneContact,
      "BUYER_ATTN": cneContact,
      "BUYER_TITLE": "Representative / Purchasing Manager",
      "SALE_NAME": saleName,
      "Sale_rep": saleName,
      "BUYER_TEL": buyerTelCombined,
      "Product_Name": productNamesSummary || String(inq["Tên sản phẩm"] || ""),
      "ALL_PROD_NAMES": orderItems.map(function (it) { return it.nameEng || it.name || it.sku; }).join(", "),
      "Order_Items": String(inq["Order_Items"] || serializeOrderItemsTextServer_(orderItems)),
      "Net_Weight": String(netWeightVal),
      "QUANT_TOLERANCE": "+/- 5%",
      "TOT_QTY": totalQtyFormatted,
      "TOTAL_QTY": totalQtyFormatted,
      "TOTAL_NET_WEIGHT": totalQtyFormatted,
      "TOTAL_NW": totalQtyFormatted,
      "TOT_NW": totalQtyFormatted,
      "TOTAL_GROSS_WEIGHT": formatCurrency(qGrossWeightVal),
      "TOTAL_GW": formatCurrency(qGrossWeightVal),
      "TOTAL_CBM": Number(qCbmVal || 0).toFixed(3),
      "TOTAL_CARTONS": String(qPackSummary.totalCartons || 0),
      "TOTAL_PALLETS": String(qPackSummary.totalPallets || 0),
      "Incoterm": recInc,
      "INCOTERM": recInc,
      "INCOTERM_PLACE": incotermPlaceStr,
      "POL": polStr,
      "POD": podStr,
      "CONT_TYPE": contTypeStr,
      "LOCAL_STATUS": localStatusStr,
      "LOCAL_AMT": localAmtStr,
      "FREIGHT_STATUS": freightStatusStr,
      "FREIGHT_AMT": freightAmtStr,
      "INSURANCE_STATUS": insStatusStr,
      "INSURANCE_AMT": insAmtStr,
      "DEST_STATUS": destStatusStr,
      "DEST_AMT": destAmtStr,
      "DEST_DELIVERY_AMT": destAmtStr,
      "INS_TERM": qInsClauseStr,
      "ORIGIN": firstOriginQ || "VIETNAM",
      "Origin": firstOriginQ || "VIETNAM",
      "ORG": firstOriginQ || "VIETNAM",
      "SHIPPING_MARKS": "Origin: " + (firstOriginQ || "VIETNAM") + "   |   Destination: " + podStr,
      "Shipping_Marks": "Origin: " + (firstOriginQ || "VIETNAM") + "   |   Destination: " + podStr,
      "Payment_Terms": payRaw,
      "PAY_TERM": payEng,
      "SUBTOTAL_AMT": formatCurrency(subtotalAmtVal),
      "FOB_SUBTOTAL_AMT": formatCurrency(subtotalAmtVal),
      "TOT_AMT": formatCurrency(finalPriceVal),
      "TOTAL_AMT": formatCurrency(finalPriceVal),
      "TOT_AMT_WORDS": totalWords,
      "Final_Price": formatCurrency(finalPriceVal),
      "Final_Price_USD": "$" + formatCurrency(finalPriceVal),
      "Final_Selling_Price": formatCurrency(finalPriceVal),
      "Unit_Price": formatCurrency(unitPriceVal),
      "Goods_Cost": formatCurrency(subtotalAmtVal),
      "Packing_Pallet_Cost": "Included",
      "Total_Freight_Local": formatCurrency(freightChargeApplied),
      "Insurance_Cost": formatCurrency(effectiveInsDisplayVal),
      "Insurance_Code": insIncluded ? (recInc === "CIP" ? "INS-ICC-A" : (insPlanCode && insPlanCode !== "INS-NONE" ? insPlanCode : "INS-ICC-C")) : "",
      "OPT_PLACE": incotermPlaceStr,
      "OTP_PLACE": incotermPlaceStr
    };

    fixBuyerContactPersonPlaceholders_(doc, cneContact);
    for (var qtKey in quoTagMap) {
      if (!Object.prototype.hasOwnProperty.call(quoTagMap, qtKey)) continue;
      replaceAllSectionsText_(doc, "\\{\\{" + qtKey + "\\}\\}", quoTagMap[qtKey]);
    }
    replaceAllSectionsText_(doc, "\\{\\{TOT_QTY\\}", totalQtyFormatted);
    cleanMergedDocSections_(doc);
    doc.saveAndClose();

    var exported = exportTempDocAsBase64_(docId, safeBaseName, exportFormat || "pdf");

    var curStatusLower = String(inq["Inquiry_Status"] || "").trim().toLowerCase();
    if (!curStatusLower || curStatusLower.indexOf("chờ tính giá") !== -1 || curStatusLower.indexOf("sẵn sàng báo giá") !== -1 || curStatusLower === "priced" || curStatusLower === "quoted") {
      updateRowByKey_("Inquiry_Quotation", "Order_ID", orderId, {
        "Inquiry_Status": "Đã lập báo giá"
      });
    }

    return {
      success: true,
      fileName: exported.fileName,
      mimeType: exported.mimeType,
      base64Data: exported.base64Data,
      templateDocId: cleanTplId,
      templateUsed: quoTpl ? String(quoTpl["Document_Name"] || "") : "",
      templateId: quoTpl ? getTemplateCodeField_(quoTpl) : "",
      quotationNo: displayQuoNo,
      quoteRound: quoteRound,
      quotationMode: isComparison ? "COMPARISON" : "SINGLE",
      proposedIncoterms: proposedList,
      emailMeta: {
        docKind: "QUOTATION",
        docLabel: "Official Export Quotation",
        quotNo: displayQuoNo,
        quotDt: quoDate,
        allProdNames: stripInternalCodesForCustomer_(quoTagMap["ALL_PROD_NAMES"]) || "Vietnamese Agricultural Products",
        totQty: totalQtyFormatted,
        incoterm: recInc,
        incotermPlace: incotermPlaceStr,
        pol: polStr,
        pod: podStr,
        totAmt: formatCurrency(finalPriceVal),
        validDays: "3",
        saleName: saleName,
        buyerName: cneContact || cneName,
        cneName: cneName,
        recipientEmail: cneEmail,
        payTerm: payEng
      }
    };
  } catch (err) {
    return { success: false, message: err.message };
  } finally {
    if (copyFile) {
      try {
        copyFile.setTrashed(true);
      } catch (trashErr) {}
    }
  }
}

/**
 * Xuất file Google Docs Hợp đồng ngoại thương từ Template_Manager động:
 * - Tự động chọn mẫu theo nhóm sản phẩm hoặc theo Template_ID chọn thủ công
 * - Nhân bản dòng sản phẩm trong bảng ARTICLE 2
 * - Đổ dữ liệu System_Lookups (PACKING, CO_FORM, PAYMENT) & Incoterms_Handbook (Contract_Text_ENG, Freight_Term)
 * - Xử lý mặc định Container/Seal & Tàu/Booking nếu chưa có dữ liệu thực tế
 * - Trả về cả link Google Docs và PDF Preview/Download
 */
function getOrCreateContractFolderServer_(folderName) {
  var name = String(folderName || "NongSanXanh_Contracts").trim();
  var it = DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(name);
}

function exportContractFromTemplate(orderId, overrideOptions) {
  return generatePopulatedContractDoc_(orderId, overrideOptions, false);
}

function saveContractFileToDrive(orderId, overrideOptions) {
  return generatePopulatedContractDoc_(orderId, overrideOptions, true);
}

function generatePopulatedContractDoc_(orderId, overrideOptions, keepPermanentFile) {
  var opts = overrideOptions && typeof overrideOptions === "object" ? overrideOptions : {};
  var templates = readSheetAsObjects_("Template_Manager");
  var orders = readSheetAsObjects_("Order_Master");
  var inquiries = readSheetAsObjects_("Inquiry_Quotation");
  var proposals = readSheetAsObjects_("Pricing_Proposal");
  var consignees = readSheetAsObjects_("Consignee_Directory");
  var products = readSheetAsObjects_("Product_Catalog");
  var pricingRates = readSheetAsObjects_("Pricing_Rates");
  var incoterms = readSheetAsObjects_("Incoterms_Handbook");
  var lookups = readSheetAsObjects_("System_Lookups");

  var ord = null;
  for (var o = 0; o < orders.length; o++) {
    if (String(orders[o]["Order_ID"]).trim() === String(orderId).trim()) {
      ord = orders[o];
      break;
    }
  }
  if (!ord) return { success: false, message: "Không tìm thấy hợp đồng cho đơn hàng " + orderId };

  var inq = null;
  for (var q = 0; q < inquiries.length; q++) {
    if (String(inquiries[q]["Order_ID"]).trim() === String(orderId).trim()) {
      inq = inquiries[q];
      break;
    }
  }

  var prop = null;
  for (var p = proposals.length - 1; p >= 0; p--) {
    var pOid = proposals[p]["Order ID"] || proposals[p]["Order_ID"] || "";
    if (String(pOid).trim() === String(orderId).trim()) {
      prop = proposals[p];
      break;
    }
  }

  var cus = null;
  for (var c = 0; c < consignees.length; c++) {
    if (String(consignees[c]["Consignee_ID"]).trim() === String(ord["Consignee_ID"]).trim()) {
      cus = consignees[c];
      break;
    }
  }

  var orderItems = parseOrderItemsServer_(inq, ord["SKU_Code"], ord["NW_Confirmed_KGs"], products, pricingRates, lookups);
  var chosenTemplateId = String(opts.templateId || ord["Template_ID"] || "").trim();
  var ctrTpl = selectContractTemplateDynamic_(templates, orderItems, products, chosenTemplateId);
  var cleanTplId = getTemplateDocIdField_(ctrTpl);

  if (!cleanTplId) {
    return {
      success: false,
      message: "Chưa cấu hình Google Doc File ID hợp lệ cho mẫu hợp đồng trong mục Quản lý biểu mẫu."
    };
  }

  var copyFile = null;
  var savedPermanently = false;
  try {
    var contractNo = String(ord["Contract_No."] || orderId).trim();
    var safeFileName = ("Sales_Contract_" + contractNo).replace(/[\\/:*?"<>|\s]+/g, "_");
    var templateFile = DriveApp.getFileById(cleanTplId);
    if (keepPermanentFile) {
      var targetFolder = getOrCreateContractFolderServer_("NongSanXanh_Contracts");
      copyFile = templateFile.makeCopy(safeFileName, targetFolder);
    } else {
      copyFile = templateFile.makeCopy("TEMP_" + safeFileName);
    }
    var docId = copyFile.getId();
    var doc = DocumentApp.openById(docId);
    var body = doc.getBody();

    var usePltCtr = (prop && (prop["Use_Pallet"] === true || String(prop["Use_Pallet"] || "").toUpperCase() === "TRUE")) || (inq && (inq["Use_Pallet"] === true || String(inq["Use_Pallet"] || "").toUpperCase() === "TRUE"));
    var ctrPackSummary = computeOrderPackingSpecsServer_(orderItems, pricingRates, usePltCtr);
    var contractVal = resolveOrderContractValue_(ord, prop);
    var nwVal = parseSmartNumber_(ord["NW_Confirmed_KGs"]);
    var totalItemsWeight = ctrPackSummary.cargoNetKg;
    if (totalItemsWeight <= 0) totalItemsWeight = nwVal;
    var finalCtrNw = nwVal > 0 ? nwVal : totalItemsWeight;
    var finalCtrGw = parseSmartNumber_(prop && prop["Total_Gross_Weight"]) || ctrPackSummary.totalGrossWeightKg || finalCtrNw;
    var finalCtrCbm = parseSmartNumber_(prop && prop["Total_CBM"]) || ctrPackSummary.totalCbm;
    var avgUnitPrice = finalCtrNw > 0 ? contractVal / finalCtrNw : 0;

    // 1. Resolve Consignee details
    var cneName = String((cus && cus["Consignee_Name"]) || ord["Consignee_ID"] || "");
    var cneAddr = String((cus && cus["Address"]) || (inq && inq["Address"]) || "");
    var cneCountry = String((cus && cus["Country"]) || "");
    var cneTax = String((cus && (cus["Tax"] || cus["Tax_ID"])) || "");
    var cneContact = String(
      (cus && getFieldFuzzy_(cus, ["Contact_Person", "Contact Person", "Người liên hệ", "Contact"], ["contact_person", "người liên hệ", "contact"])) ||
      (inq && (inq["Contact"] || inq["Contact_Person"])) ||
      ""
    ).trim();
    var cnePhone = String((cus && cus["Phone"]) || (inq && inq["Phone"]) || "");
    var cneEmail = String((cus && cus["Email"]) || (inq && inq["Email"]) || "");
    var cneFax = String((cus && cus["Fax"]) || "");

    // 2. Resolve POL / POD & Incoterms_Handbook
    var pol = String(ord["POL"] || "Cát Lái");
    var pod = String(ord["POD"] || "");
    var appliedInc = String(ord["Applied_Incoterm"] || "").trim().toUpperCase();

    var incRow = null;
    for (var ih = 0; ih < incoterms.length; ih++) {
      var ihCode = String(getFieldFuzzy_(incoterms[ih], ["Incoterm", "Code", "Incoterm_Code"], ["incoterm"])).trim().toUpperCase();
      if (ihCode && ihCode === appliedInc) {
        incRow = incoterms[ih];
        break;
      }
    }
    var incContractEng = incRow ? String(getFieldFuzzy_(incRow, ["Contract_Text_ENG", "Contract Text ENG"], ["contract_text"]) || "") : "";
    if (!incContractEng) {
      incContractEng = appliedInc + " " + (pod || cneAddr || "");
    }
    incContractEng = incContractEng
      .replace(/\{\{\s*POD\s*\}\}/gi, pod || cneAddr || "")
      .replace(/\{\{\s*FINAL_DESTINATION\s*\}\}/gi, pod || cneAddr || "");

    var freightTerm = incRow ? String(getFieldFuzzy_(incRow, ["Freight_Term", "Freight Term"], ["freight_term", "freight"]) || "").trim() : "";
    if (!freightTerm) {
      freightTerm = (appliedInc === "EXW" || appliedInc === "FCA" || appliedInc === "FAS" || appliedInc === "FOB")
        ? "FREIGHT COLLECT"
        : "FREIGHT PREPAID";
    }

    // 3. Resolve System_Lookups: CO_FORM & PAYMENT
    var coFormCode = String(opts.coForm || ord["CO_Form"] || suggestCoFormCode_(pod, cneCountry)).trim();
    var coLookup = findSystemLookup_(lookups, "CO_FORM", coFormCode);
    var coFormNameEng = coLookup && coLookup["Contract_Text_ENG"]
      ? String(coLookup["Contract_Text_ENG"])
      : ("Certificate of Origin " + coFormCode);

    var payRaw = String(ord["Payment_Terms"] || (inq && inq["Phương thức thanh toán đề xuất"]) || "");
    var payLookup = findSystemLookup_(lookups, "PAYMENT", payRaw);
    var payTermEng = payLookup && payLookup["Contract_Text_ENG"] ? String(payLookup["Contract_Text_ENG"]) : payRaw;
    var lcOpeningTime = payLookup && payLookup["Extra_Value"] !== undefined && payLookup["Extra_Value"] !== ""
      ? String(payLookup["Extra_Value"])
      : "Within 07 working days after Contract signing";

    // 4. Container/Seal & Vessel/Booking & 6 Cut-offs (hydrate from PropertiesService)
    var logiMetaCtr = getOrderLogisticsMetaServer_(orderId);
    var rawContSeal = String(opts.contSealList || logiMetaCtr.Cont_Seal_List || ord["Cont_Seal_List"] || "").trim();
    var rawVesVoy = String(opts.vesVoy || logiMetaCtr.Ves_Voy || ord["Ves_Voy"] || "").trim();
    var rawBkNo = String(opts.bkNo || resolveDisplayBookingNoServer_(ord, logiMetaCtr) || "").trim();

    var contSealDisplay = rawContSeal ? rawContSeal : "To be updated upon stuffing";
    var vesVoyDisplay = rawVesVoy ? rawVesVoy : "To be advised";
    var bkNoDisplay = rawBkNo ? rawBkNo : "To be advised";

    // 5. Duplicate ARTICLE 2 table product rows for multi-SKU orders
    var itemComputedRows = [];
    var baseWeightedSum = 0;
    var hasReeferCargoCtr = false;
    for (var idx = 0; idx < orderItems.length; idx++) {
      var it = orderItems[idx];
      var cBd = ctrPackSummary.breakdown[idx] || { cartons: 0, nw: it.weight, gw: it.weight, cbm: 0 };
      var prod = null;
      for (var pr = 0; pr < products.length; pr++) {
        var pSku = String(getFieldFuzzy_(products[pr], ["Mã sản phẩm", "SKU_Code", "SKU", "Product_ID"], ["sku", "mã sản phẩm", "mã hàng"])).trim();
        if (pSku && pSku.toLowerCase() === String(it.sku || "").trim().toLowerCase()) {
          prod = products[pr];
          break;
        }
      }
      var pContType = String((prod && getFieldFuzzy_(prod, ["Container_Type", "Loại hàng / Bảo quản", "Storage_Type"], ["container_type", "bảo quản"])) || "").toLowerCase();
      var isDryExplicit = pContType.indexOf("khô") !== -1 || pContType.indexOf("dc") !== -1 || pContType.indexOf("gp") !== -1;
      if (!isDryExplicit && (pContType.indexOf("rf") !== -1 || pContType.indexOf("lạnh") !== -1 || pContType.indexOf("tươi") !== -1 || pContType.indexOf("cấp đông") !== -1)) {
        hasReeferCargoCtr = true;
      }
      var packLookup = it.packingCode ? findSystemLookup_(lookups, "PACKING", it.packingCode) : null;
      if (!packLookup && it.packingName) {
        packLookup = findSystemLookup_(lookups, "PACKING", it.packingName);
      }
      var packExtra = packLookup ? parseSmartNumber_(packLookup["Extra_Value"]) : parseSmartNumber_(it.packingExtra || 0);
      var baseUnit = prod ? parseSmartNumber_(getFieldFuzzy_(prod, ["Unit_Price", "Đơn giá", "Price_USD_KG", "Price", "Giá vốn"], ["unit_price", "đơn giá", "giá vốn", "price"])) : 0;
      var effectiveBaseUnit = Math.max(0, baseUnit + packExtra);
      var itemWeight = parseSmartNumber_(it.weight);
      var baseLine = effectiveBaseUnit * itemWeight;
      baseWeightedSum += baseLine;

      var itemNameEng = String((prod && getFieldFuzzy_(prod, ["Item_Name_ENG", "English_Name", "Product_Name_ENG", "Tên tiếng Anh"], ["item_name_eng", "english"])) || it.name || (prod && getFieldFuzzy_(prod, ["Tên sản phẩm", "Product_Name"], ["tên sản phẩm"])) || it.sku);
      var itemGrade = String((prod && getFieldFuzzy_(prod, ["Grade", "ITEM_GRADE", "Phân loại", "Hạng"], ["grade", "hạng"])) || "Grade A");
      var itemSpec = String((prod && getFieldFuzzy_(prod, ["Spec", "ITEM_SPEC", "Specification", "Specifications", "Technical_Spec", "Thông số kỹ thuật"], ["spec", "kỹ thuật"])) || (prod && getFieldFuzzy_(prod, ["Packaging", "Quy cách"], ["quy cách"])) || "-");
      var itemOrigin = String((prod && getFieldFuzzy_(prod, ["Origin", "ORG", "Xuất xứ"], ["origin", "xuất xứ"])) || "VIETNAM").toUpperCase();
      var itemCropYear = String((prod && getFieldFuzzy_(prod, ["Crop_Year", "CROP_YEAR", "Mùa vụ", "Năm thu hoạch"], ["crop_year", "mùa vụ", "năm thu hoạch"])) || Utilities.formatDate(new Date(), TIMEZONE, "yyyy"));
      var itemPackEng = String((packLookup && packLookup["Contract_Text_ENG"]) || cBd.packEng || it.packingName || (prod && getFieldFuzzy_(prod, ["Packaging", "Quy cách"], ["quy cách"])) || "-");
      var itemUnit = " KGS";

      itemComputedRows.push({
        stt: String(idx + 1),
        sku: String(it.sku || ""),
        name: itemNameEng,
        grade: itemGrade,
        spec: itemSpec,
        org: itemOrigin,
        cropYear: itemCropYear,
        pack: itemPackEng,
        cartons: String(cBd.cartons || parseSmartNumber_(it.cartons || 0)),
        weight: itemWeight,
        gw: cBd.gw || itemWeight,
        cbm: cBd.cbm || 0,
        unit: itemUnit,
        baseLine: baseLine
      });
    }

    for (var ir = 0; ir < itemComputedRows.length; ir++) {
      var rowItem = itemComputedRows[ir];
      var shareRatio = baseWeightedSum > 0
        ? (rowItem.baseLine / baseWeightedSum)
        : (totalItemsWeight > 0 ? rowItem.weight / totalItemsWeight : 1 / Math.max(1, itemComputedRows.length));
      var lineAmt = contractVal > 0 ? (contractVal * shareRatio) : rowItem.baseLine;
      var lineUnitPrice = rowItem.weight > 0 ? (lineAmt / rowItem.weight) : 0;
      rowItem.unitPriceStr = formatCurrency(lineUnitPrice);
      rowItem.amtStr = formatCurrency(lineAmt);
      rowItem.qtyStr = formatCurrency(rowItem.weight);
    }

    var tables = body.getTables();
    for (var tbIdx = 0; tbIdx < tables.length; tbIdx++) {
      var table = tables[tbIdx];
      var numRows = table.getNumRows();
      for (var rIdx = 0; rIdx < numRows; rIdx++) {
        var tr = table.getRow(rIdx);
        var rowText = tr.getText() || "";
        if (rowText.indexOf("{{ITEM_SKU}}") !== -1 || rowText.indexOf("{{ITEM_NAME}}") !== -1 || rowText.indexOf("{{ITEM_STT}}") !== -1) {
          for (var cIdx = 0; cIdx < itemComputedRows.length; cIdx++) {
            var irObj = itemComputedRows[cIdx];
            var clonedRow = tr.copy();
            clonedRow.replaceText("\\{\\{ITEM_STT\\}\\}", irObj.stt);
            clonedRow.replaceText("\\{\\{ITEM_NAME\\}\\}", irObj.name);
            clonedRow.replaceText("\\{\\{ITEM_SKU\\}\\}", irObj.sku);
            clonedRow.replaceText("\\{\\{ITEM_GRADE\\}\\}", irObj.grade);
            clonedRow.replaceText("\\{\\{ITEM_SPEC\\}\\}", irObj.spec);
            clonedRow.replaceText("\\{\\{ORG\\}\\}", irObj.org);
            clonedRow.replaceText("\\{\\{ORIGIN\\}\\}", irObj.org);
            clonedRow.replaceText("\\{\\{CROP_YEAR\\}\\}", irObj.cropYear);
            clonedRow.replaceText("\\{\\{ITEM_PACK\\}\\}", irObj.pack);
            clonedRow.replaceText("\\{\\{ITEM_CARTONS\\}\\}", irObj.cartons);
            clonedRow.replaceText("\\{\\{ITEM_QTY\\}\\}", irObj.qtyStr);
            clonedRow.replaceText("\\{\\{ITEM_NW\\}\\}", irObj.qtyStr);
            clonedRow.replaceText("\\{\\{ITEM_GW\\}\\}", formatCurrency(irObj.gw));
            clonedRow.replaceText("\\{\\{ITEM_CBM\\}\\}", Number(irObj.cbm || 0).toFixed(3));
            clonedRow.replaceText("\\{\\{ITEM_UNIT\\}\\}", irObj.unit);
            clonedRow.replaceText("\\{\\{ITEM_PRICE\\}\\}", irObj.unitPriceStr);
            clonedRow.replaceText("\\{\\{ITEM_AMT\\}\\}", irObj.amtStr);
            table.insertTableRow(rIdx + 1 + cIdx, clonedRow);
          }
          table.removeRow(rIdx);
          break;
        }
      }
    }

    // 6. Replace header / body / footer global tags
    var firstPackEng = itemComputedRows.length > 0 ? itemComputedRows[0].pack : "";
    var totalQtyFormatted = formatCurrency(finalCtrNw);
    var goodsAndPackVal = parseSmartNumber_(prop && prop["Goods_Cost"]) + parseSmartNumber_(prop && prop["Packing_Pallet_Cost"]);
    var ctrSubtotal = goodsAndPackVal > 0 ? goodsAndPackVal : contractVal;
    var buyerTelCombinedCtr = [cnePhone, cneEmail].filter(Boolean).join(" / ");
    var saleNameCtr = String(ord["In_Charge_Staff"] || (inq && inq["Sale_rep"]) || "");
    var allProdNames = itemComputedRows.map(function (it) { return it.name; }).join(", ");
    var packAndTempSpec = usePltCtr
      ? ("ISPM-15 Export Palletized, " + ctrPackSummary.totalCartons + " Cartons / " + ctrPackSummary.totalPallets + " Pallets" + (hasReeferCargoCtr ? " (Reefer Max 6 layers, 20cm below red air-flow line)" : ""))
      : ("Floor-loaded Export Cartons (" + ctrPackSummary.totalCartons + " Cartons)" + (hasReeferCargoCtr ? " · Reefer cold chain maintained" : ""));
    var contLoadStr = String((prop && prop["Container_Type"]) || "Standard Export Container") + " — Net: " + totalQtyFormatted + " KGS, Gross: " + formatCurrency(finalCtrGw) + " KGS, Vol: " + Number(finalCtrCbm || 0).toFixed(3) + " CBM";
    var shipmentDeadlineStr = String((inq && inq["Thời gian giao hàng mong muốn"]) || "Within 15 days from receipt of deposit / L/C");
    var insPlanCodeCtr = String(ord["Insurance_Code"] || (prop && prop["Insurance_Code"]) || "").trim().toUpperCase();
    var insTermStr = "";
    if (insPlanCodeCtr === "INS-ICC-A") {
      insTermStr = "Institute Cargo Clauses (A) - 110% of Invoice Value covered by Seller";
    } else if (insPlanCodeCtr === "INS-ICC-B") {
      insTermStr = "Institute Cargo Clauses (B) - 110% of Invoice Value covered by Seller";
    } else if (insPlanCodeCtr === "INS-ICC-C") {
      insTermStr = "Institute Cargo Clauses (C) - 110% of Invoice Value covered by Seller";
    } else if (insPlanCodeCtr === "INS-NONE") {
      insTermStr = "Insurance to be arranged and covered by Buyer";
    } else {
      insTermStr = (appliedInc === "CIP")
        ? "Institute Cargo Clauses (A) - 110% of Invoice Value covered by Seller"
        : ((appliedInc === "CIF")
          ? "Institute Cargo Clauses (C) - 110% of Invoice Value covered by Seller"
          : "Insurance to be arranged and covered by Buyer");
    }
    var firstOriginCtr = (itemComputedRows.length > 0 && itemComputedRows[0].org) ? itemComputedRows[0].org : "VIETNAM";
    var extraDocsStr = hasReeferCargoCtr
      ? "Phytosanitary Certificate, Health Certificate, Temperature Recording Chart"
      : "Phytosanitary Certificate, Fumigation Certificate";

    var tagMap = {
      "Order_ID": String(orderId),
      "ORDER_ID": String(orderId),
      "Contract_No": contractNo,
      "CONTRACT_NO": contractNo,
      "CTR_NO": contractNo,
      "Contract_Date": String(ord["Contract_Date"] || ""),
      "CONTRACT_DATE": String(ord["Contract_Date"] || ""),
      "CTR_DT": String(ord["Contract_Date"] || ""),
      "QUOT_NO": String((prop && (prop["Quote_ID"] || prop["Quotation_No"])) || ("QT-" + String(orderId || "").trim().replace(/-(?:V|R)\d+$/i, ""))).replace(/-(?:V|R)\d+$/i, "").trim(),
      "QUOT_DT": String((prop && prop["Booking_Date"]) || ord["Contract_Date"] || ""),
      "In_Charge_Staff": saleNameCtr,
      "SELLER_REP": saleNameCtr,
      "SALE_NAME": saleNameCtr,
      "Consignee_Name": cneName,
      "CNE_NAME": cneName,
      "BUYER_NAME": cneName,
      "Address": cneAddr,
      "CNE_ADDR": cneAddr,
      "BUYER_ADDR": cneAddr,
      "FINAL_DESTINATION": pod || cneAddr,
      "Tax_ID": cneTax,
      "CNE_TAX": cneTax,
      "Contact": cneContact,
      "Contact_Person": cneContact,
      "CONTACT_PERSON": cneContact,
      "CNE_CONTACT": cneContact,
      "CNE_CONTACT_PERSON": cneContact,
      "CNE_REP": cneContact,
      "BUYER_CONTACT": cneContact,
      "BUYER_CONTACT_PERSON": cneContact,
      "BUYER_REP": cneContact,
      "ATTN": cneContact,
      "BUYER_ATTN": cneContact,
      "BUYER_TITLE": "Representative / Purchasing Manager",
      "Phone": cnePhone,
      "CNE_TEL": cnePhone,
      "CNE_PHONE": cnePhone,
      "Email": cneEmail,
      "CNE_EMAIL": cneEmail,
      "BUYER_TEL": buyerTelCombinedCtr,
      "Fax": cneFax,
      "CNE_FAX": cneFax,
      "SKU_Code": String(ord["SKU_Code"] || ""),
      "ALL_PROD_NAMES": allProdNames,
      "PACK_AND_TEMP_SPEC": packAndTempSpec,
      "CONT_LOAD": contLoadStr,
      "QUANT_TOLERANCE": "+/- 5%",
      "NW_Confirmed_KGs": totalQtyFormatted,
      "TOT_QTY": totalQtyFormatted,
      "TOTAL_QTY": totalQtyFormatted,
      "TOTAL_NET_WEIGHT": totalQtyFormatted,
      "TOT_NW": totalQtyFormatted,
      "TOTAL_NW": totalQtyFormatted,
      "TOTAL_GROSS_WEIGHT": formatCurrency(finalCtrGw),
      "TOTAL_GW": formatCurrency(finalCtrGw),
      "TOTAL_CBM": Number(finalCtrCbm || 0).toFixed(3),
      "TOTAL_CARTONS": String(ctrPackSummary.totalCartons || 0),
      "TOTAL_PALLETS": String(ctrPackSummary.totalPallets || 0),
      "Applied_Incoterm": appliedInc,
      "INCOTERM": appliedInc,
      "INCOTERM_TEXT": incContractEng,
      "DELIVERY_TERM": incContractEng,
      "INCOTERM_CLAUSE": incContractEng,
      "Contract_Text_ENG": incContractEng,
      "FREIGHT": freightTerm,
      "FREIGHT_TERM": freightTerm,
      "INS_TERM": insTermStr,
      "Insurance_Code": insPlanCodeCtr,
      "ORIGIN": firstOriginCtr || "VIETNAM",
      "Origin": firstOriginCtr || "VIETNAM",
      "ORG": firstOriginCtr || "VIETNAM",
      "SHIPPING_MARKS": "Origin: " + (firstOriginCtr || "VIETNAM") + "   |   Destination: " + (pod || cneAddr || "Destination"),
      "Shipping_Marks": "Origin: " + (firstOriginCtr || "VIETNAM") + "   |   Destination: " + (pod || cneAddr || "Destination"),
      "PARTIAL_SHIPMENT": "Allowed",
      "TRANSSHIPMENT": "Allowed",
      "SHIPMENT_DEADLINE": shipmentDeadlineStr,
      "Payment_Terms": payRaw,
      "PAY_TERM": payTermEng,
      "LC_OPENING_TIME": lcOpeningTime,
      "CO_FORM": coFormCode,
      "CO_FORM_NAME": coFormNameEng,
      "EXTRA_DOCS": extraDocsStr,
      "ITEM_PACK": firstPackEng,
      "POL": pol,
      "POD": pod,
      "CONT_SEAL_LIST": contSealDisplay,
      "VES_VOY": vesVoyDisplay,
      "BK_NO": bkNoDisplay,
      "CARRIER_BK_NO": String(logiMetaCtr.Carrier_BK_No || ""),
      "FWD_BK_NO": String(logiMetaCtr.FWD_BK_No || ""),
      "BK_SOURCE": String(logiMetaCtr.Booking_Source || ""),
      "SI_CUTOFF": String(logiMetaCtr.SI_Cutoff || ""),
      "VGM_CUTOFF": String(logiMetaCtr.VGM_Cutoff || ""),
      "CFS_CUTOFF": String(logiMetaCtr.CFS_Cutoff || ""),
      "CY_CUTOFF": String(logiMetaCtr.CY_Cutoff || ""),
      "CUSTOMS_CUTOFF": String(logiMetaCtr.Customs_Cutoff || ""),
      "DRAFT_BL_CUTOFF": String(logiMetaCtr.Draft_BL_Cutoff || ""),
      "SUBTOTAL_AMT": formatCurrency(ctrSubtotal),
      "Contract_Value": formatCurrency(contractVal),
      "CONTRACT_VALUE": formatCurrency(contractVal),
      "TOT_AMT": formatCurrency(contractVal),
      "TOTAL_AMT": formatCurrency(contractVal),
      "TOT_AMT_WORDS": numberToUsdWordsServer_(contractVal),
      "Contract_Value_USD": "$" + formatCurrency(contractVal),
      "Unit_Price": formatCurrency(avgUnitPrice)
    };

    replaceInlineLogoTag_(doc, COMPANY_LOGO_ID);
    fixBuyerContactPersonPlaceholders_(doc, cneContact);

    for (var tagKey in tagMap) {
      if (!Object.prototype.hasOwnProperty.call(tagMap, tagKey)) continue;
      replaceAllSectionsText_(doc, "\\{\\{" + tagKey + "\\}\\}", tagMap[tagKey]);
    }
    replaceAllSectionsText_(doc, "\\{\\{TOT_QTY\\}", totalQtyFormatted);
    cleanMergedDocSections_(doc);

    doc.saveAndClose();

    if (keepPermanentFile) {
      try {
        copyFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (shareErr) {}
      var permanentUrl = copyFile.getUrl();
      var savedTemplateId = (ctrTpl && ctrTpl["Template ID"]) ? String(ctrTpl["Template ID"]) : chosenTemplateId;
      updateRowByKey_("Order_Master", "Order_ID", orderId, {
        "Contract_Link": permanentUrl
      });
      savedPermanently = true;
      if (!opts.includeExportOnSave) {
        return {
          success: true,
          contractLink: permanentUrl,
          docId: docId,
          fileName: safeFileName,
          templateId: savedTemplateId,
          templateUsed: ctrTpl ? ctrTpl["Document_Name"] : "",
          contractNo: contractNo
        };
      }
    }

    var exported = exportTempDocAsBase64_(docId, safeFileName, opts.format || "pdf");

    var sysUsersCtr = readSheetAsObjects_("SYS_Users");
    var staffEmailCtr = "";
    var staffCleanLower = String(saleNameCtr || "").trim().toLowerCase();
    for (var su = 0; su < sysUsersCtr.length; su++) {
      var uFull = String(sysUsersCtr[su]["Full_Name"] || "").trim().toLowerCase();
      var uId = String(sysUsersCtr[su]["Employee_ID"] || "").trim().toLowerCase();
      if (staffCleanLower && (uFull === staffCleanLower || uId === staffCleanLower || uFull.indexOf(staffCleanLower) !== -1)) {
        staffEmailCtr = String(sysUsersCtr[su]["Email"] || sysUsersCtr[su]["User_Email"] || "").trim();
        if (staffEmailCtr) break;
      }
    }

    return {
      success: true,
      contractLink: savedPermanently ? copyFile.getUrl() : "",
      fileName: exported.fileName,
      mimeType: exported.mimeType,
      base64Data: exported.base64Data,
      templateDocId: cleanTplId,
      templateUsed: ctrTpl ? ctrTpl["Document_Name"] : "",
      templateId: ctrTpl ? ctrTpl["Template ID"] : "",
      coFormUsed: coFormCode,
      contractNo: contractNo,
      emailMeta: {
        docKind: "CONTRACT",
        docLabel: "Sales Contract",
        contractNo: contractNo,
        quotNo: contractNo,
        quotDt: String(ord["Contract_Date"] || Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd")),
        allProdNames: allProdNames,
        totQty: totalQtyFormatted,
        incoterm: appliedInc,
        incotermPlace: pod || pol,
        pol: pol,
        pod: pod,
        totAmt: formatCurrency(contractVal),
        validDays: "3",
        saleName: saleNameCtr || "Export Staff",
        buyerName: cneContact || cneName,
        cneName: cneName,
        recipientEmail: staffEmailCtr,
        payTerm: payTermEng
      }
    };
  } catch (err) {
    return { success: false, message: err.message };
  } finally {
    if (copyFile && !savedPermanently) {
      try {
        copyFile.setTrashed(true);
      } catch (trashErr) {}
    }
  }
}

/**
 * Tìm biểu mẫu Bộ chứng từ xuất khẩu động trong Template_Manager
 * Hỗ trợ: INVOICE (TMP_INVOICE), PACKING (TMP_PACKING_LIST), CO (TMP_CO), BL (TMP_BL)
 */
function selectShippingDocTemplateDynamic_(templates, docType) {
  var kind = String(docType || "").trim().toUpperCase();
  var list = (templates || []).filter(function (row) {
    var status = String(row["Status"] || "Active").trim().toLowerCase();
    return status !== "inactive" && status !== "locked";
  });
  var exactMap = {
    INVOICE: "TMP_INVOICE",
    PACKING: "TMP_PACKING_LIST",
    CO: "TMP_CO",
    BL: "TMP_BL"
  };
  var exactId = exactMap[kind] || "";
  if (exactId) {
    for (var e = 0; e < list.length; e++) {
      if (matchesTemplateCodeOrName_(list[e], exactId)) {
        return list[e];
      }
    }
  }
  for (var i = 0; i < list.length; i++) {
    var row = list[i];
    var tid = getTemplateCodeField_(row).toUpperCase();
    var dname = String(row["Document_Name"] || "").trim().toLowerCase();
    if (kind === "INVOICE" && (tid.indexOf("INV") !== -1 || dname.indexOf("invoice") !== -1 || dname.indexOf("hóa đơn") !== -1)) {
      return row;
    }
    if (kind === "PACKING" && (tid.indexOf("PACK") !== -1 || tid.indexOf("PKL") !== -1 || dname.indexOf("packing") !== -1 || dname.indexOf("đóng gói") !== -1)) {
      return row;
    }
    if (kind === "CO" && (tid === "TMP_CO" || tid.indexOf("_CO") !== -1 || tid.indexOf("CO_") !== -1 || dname.indexOf("origin") !== -1 || dname.indexOf("c/o") !== -1 || dname.indexOf("xuất xứ") !== -1)) {
      return row;
    }
    if (kind === "BL" && (tid.indexOf("BL") !== -1 || tid.indexOf("B/L") !== -1 || dname.indexOf("lading") !== -1 || dname.indexOf("b/l") !== -1 || dname.indexOf("vận đơn") !== -1 || dname.indexOf("shipping instruction") !== -1)) {
      return row;
    }
  }
  return null;
}

/**
 * Xuất Bộ chứng từ Xuất khẩu (Invoice / Packing List / C/O / Draft B/L) từ Google Docs Template -> PDF/DOCX Base64
 */
function exportShippingDocumentFromTemplate(orderId, docType, exportFormat) {
  var kind = String(docType || "INVOICE").trim().toUpperCase();
  var templates = readSheetAsObjects_("Template_Manager");
  var matchedTpl = selectShippingDocTemplateDynamic_(templates, kind);
  var cleanTplId = getTemplateDocIdField_(matchedTpl);

  var docTypeLabelMap = {
    INVOICE: "Commercial Invoice",
    PACKING: "Packing List",
    CO: "Certificate of Origin (C/O)",
    BL: "Draft Bill of Lading (B/L)"
  };
  var docTypeLabel = docTypeLabelMap[kind] || kind;

  if (!cleanTplId) {
    return {
      success: false,
      message: "Chưa cấu hình Google Doc File ID cho mẫu " + docTypeLabel + " trong Quản lý biểu mẫu.",
      templateId: matchedTpl ? getTemplateCodeField_(matchedTpl) : ""
    };
  }

  var orders = readSheetAsObjects_("Order_Master");
  var inquiries = readSheetAsObjects_("Inquiry_Quotation");
  var proposals = readSheetAsObjects_("Pricing_Proposal");
  var consignees = readSheetAsObjects_("Consignee_Directory");
  var schedules = readSheetAsObjects_("Shipping_Schedule");
  var products = readSheetAsObjects_("Product_Catalog");
  var pricingRates = readSheetAsObjects_("Pricing_Rates");
  var incoterms = readSheetAsObjects_("Incoterms_Handbook");
  var lookups = readSheetAsObjects_("System_Lookups");

  var ord = null;
  for (var o = 0; o < orders.length; o++) {
    if (String(orders[o]["Order_ID"] || "").trim() === String(orderId || "").trim()) {
      ord = orders[o];
      break;
    }
  }
  if (!ord) return { success: false, message: "Không tìm thấy hợp đồng cho đơn hàng " + orderId };

  var inq = null;
  for (var q = 0; q < inquiries.length; q++) {
    if (String(inquiries[q]["Order_ID"] || "").trim() === String(orderId || "").trim()) {
      inq = inquiries[q];
      break;
    }
  }

  var prop = null;
  for (var p = proposals.length - 1; p >= 0; p--) {
    var pOid = proposals[p]["Order ID"] || proposals[p]["Order_ID"] || "";
    if (String(pOid).trim() === String(orderId || "").trim()) {
      prop = proposals[p];
      break;
    }
  }

  var cus = null;
  for (var c = 0; c < consignees.length; c++) {
    if (String(consignees[c]["Consignee_ID"] || "").trim() === String(ord["Consignee_ID"] || "").trim()) {
      cus = consignees[c];
      break;
    }
  }

  var schRow = null;
  if (prop && prop["Schedule_ID"]) {
    for (var s = 0; s < schedules.length; s++) {
      if (String(schedules[s]["Schedule_ID"] || "").trim() === String(prop["Schedule_ID"]).trim()) {
        schRow = schedules[s];
        break;
      }
    }
  }

  var copyFile = null;
  try {
    var contractNo = String(ord["Contract_No."] || orderId);
    var safeFileName = (kind + "_" + contractNo + "_" + Utilities.formatDate(new Date(), TIMEZONE, "yyyyMMdd")).replace(/[\\/:*?"<>|]/g, "_");
    var templateFile = DriveApp.getFileById(cleanTplId);
    copyFile = templateFile.makeCopy("TEMP_" + safeFileName);
    var docId = copyFile.getId();
    var doc = DocumentApp.openById(docId);
    var body = doc.getBody();

    var orderItems = parseOrderItemsServer_(inq, ord["SKU_Code"], ord["NW_Confirmed_KGs"], products, pricingRates, lookups);
    var usePltDoc = (prop && (prop["Use_Pallet"] === true || String(prop["Use_Pallet"] || "").toUpperCase() === "TRUE")) || (inq && (inq["Use_Pallet"] === true || String(inq["Use_Pallet"] || "").toUpperCase() === "TRUE"));
    var docPackSummary = computeOrderPackingSpecsServer_(orderItems, pricingRates, usePltDoc);
    var contractVal = resolveOrderContractValue_(ord, prop);
    var nwVal = parseSmartNumber_(ord["NW_Confirmed_KGs"]);
    var totalItemsWeight = docPackSummary.cargoNetKg;
    var totalCartonsSum = docPackSummary.totalCartons;
    if (totalItemsWeight <= 0) totalItemsWeight = nwVal;
    var finalNwVal = nwVal > 0 ? nwVal : totalItemsWeight;
    var finalGwVal = parseSmartNumber_(prop && prop["Total_Gross_Weight"]) || docPackSummary.totalGrossWeightKg || finalNwVal;
    var finalCbmVal = parseSmartNumber_(prop && prop["Total_CBM"]) || docPackSummary.totalCbm;

    var cneName = String((cus && cus["Consignee_Name"]) || ord["Consignee_ID"] || "");
    var cneAddr = String((cus && cus["Address"]) || (inq && inq["Address"]) || "");
    var cneCountry = String((cus && cus["Country"]) || "");
    var cneTax = String((cus && (cus["Tax"] || cus["Tax_ID"])) || "");
    var cneContact = String(
      (cus && getFieldFuzzy_(cus, ["Contact_Person", "Contact Person", "Người liên hệ", "Contact"], ["contact_person", "người liên hệ", "contact"])) ||
      (inq && (inq["Contact"] || inq["Contact_Person"])) ||
      ""
    ).trim();
    var cnePhone = String((cus && cus["Phone"]) || (inq && inq["Phone"]) || "");
    var cneEmail = String((cus && cus["Email"]) || (inq && inq["Email"]) || "");

    var pol = String(ord["POL"] || "Cát Lái");
    var pod = String(ord["POD"] || "");
    var appliedInc = String(ord["Applied_Incoterm"] || "").trim().toUpperCase();

    var incRow = null;
    for (var ih = 0; ih < incoterms.length; ih++) {
      var ihCode = String(getFieldFuzzy_(incoterms[ih], ["Incoterm", "Code", "Incoterm_Code"], ["incoterm"])).trim().toUpperCase();
      if (ihCode && ihCode === appliedInc) {
        incRow = incoterms[ih];
        break;
      }
    }
    var incContractEng = incRow ? String(getFieldFuzzy_(incRow, ["Contract_Text_ENG", "Contract Text ENG"], ["contract_text"]) || "") : (appliedInc + " " + (pod || cneAddr));
    incContractEng = incContractEng
      .replace(/\{\{\s*POD\s*\}\}/gi, pod || cneAddr || "")
      .replace(/\{\{\s*FINAL_DESTINATION\s*\}\}/gi, pod || cneAddr || "");
    var freightTerm = incRow ? String(getFieldFuzzy_(incRow, ["Freight_Term", "Freight Term"], ["freight_term", "freight"]) || "").trim() : "";
    if (!freightTerm) {
      freightTerm = (appliedInc === "EXW" || appliedInc === "FCA" || appliedInc === "FAS" || appliedInc === "FOB")
        ? "FREIGHT COLLECT"
        : "FREIGHT PREPAID";
    }

    var coFormCode = String(ord["CO_Form"] || suggestCoFormCode_(pod, cneCountry)).trim();
    var coLookup = findSystemLookup_(lookups, "CO_FORM", coFormCode);
    var coFormNameEng = coLookup && coLookup["Contract_Text_ENG"] ? String(coLookup["Contract_Text_ENG"]) : ("Certificate of Origin " + coFormCode);

    var payRaw = String(ord["Payment_Terms"] || (inq && inq["Phương thức thanh toán đề xuất"]) || "");
    var payLookup = findSystemLookup_(lookups, "PAYMENT", payRaw);
    var payTermEng = payLookup && payLookup["Contract_Text_ENG"] ? String(payLookup["Contract_Text_ENG"]) : payRaw;

    var logiMetaDoc = getOrderLogisticsMetaServer_(orderId);
    var vesVoyDisplay = String(logiMetaDoc.Ves_Voy || ord["Ves_Voy"] || "").trim() || (schRow && schRow["Vessel"] ? String(schRow["Vessel"]) : "To be advised");
    var bkNoDisplay = resolveDisplayBookingNoServer_(ord, logiMetaDoc) || "To be advised";
    var contSealDisplay = String(logiMetaDoc.Cont_Seal_List || ord["Cont_Seal_List"] || "").trim() || "To be advised upon shipment";

    // Nhân bản dòng sản phẩm trong bảng (nếu phôi Doc có bảng {{ITEM_SKU}} / {{ITEM_NAME}} / {{ITEM_STT}})
    var itemRowsPrepared = [];
    var baseWeightedSum = 0;
    for (var idx = 0; idx < orderItems.length; idx++) {
      var it = orderItems[idx];
      var dBd = docPackSummary.breakdown[idx] || { cartons: 0, nw: it.weight, gw: it.weight, cbm: 0 };
      var prod = null;
      for (var pr = 0; pr < products.length; pr++) {
        var pSku = String(getFieldFuzzy_(products[pr], ["Mã sản phẩm", "SKU_Code", "SKU", "Product_ID"], ["sku", "mã sản phẩm", "mã hàng"])).trim();
        if (pSku && pSku.toLowerCase() === String(it.sku || "").trim().toLowerCase()) {
          prod = products[pr];
          break;
        }
      }
      var packLookup = it.packingCode ? findSystemLookup_(lookups, "PACKING", it.packingCode) : null;
      var packExtra = packLookup ? parseSmartNumber_(packLookup["Extra_Value"]) : parseSmartNumber_(it.packingExtra || 0);
      var baseUnit = prod ? parseSmartNumber_(getFieldFuzzy_(prod, ["Unit_Price", "Đơn giá", "Price_USD_KG", "Price"], ["unit_price", "đơn giá", "price"])) : 0;
      var itemWeight = parseSmartNumber_(it.weight);
      var baseLine = Math.max(0, baseUnit + packExtra) * itemWeight;
      baseWeightedSum += baseLine;
      itemRowsPrepared.push({
        stt: String(idx + 1),
        sku: String(it.sku || ""),
        name: String((prod && getFieldFuzzy_(prod, ["Item_Name_ENG", "English_Name", "Product_Name_ENG"], ["item_name_eng", "english"])) || it.name || it.sku),
        grade: String((prod && getFieldFuzzy_(prod, ["Grade", "ITEM_GRADE", "Phân loại", "Hạng"], ["grade", "hạng"])) || "Grade A"),
        spec: String((prod && getFieldFuzzy_(prod, ["Spec", "ITEM_SPEC", "Specification", "Specifications", "Technical_Spec", "Thông số kỹ thuật"], ["spec", "kỹ thuật"])) || (prod && getFieldFuzzy_(prod, ["Packaging", "Quy cách"], ["quy cách"])) || "-"),
        org: String((prod && getFieldFuzzy_(prod, ["Origin", "ORG", "Xuất xứ"], ["origin", "xuất xứ"])) || "VIETNAM").toUpperCase(),
        cropYear: String((prod && getFieldFuzzy_(prod, ["Crop_Year", "CROP_YEAR", "Mùa vụ", "Năm thu hoạch"], ["crop_year", "mùa vụ", "năm thu hoạch"])) || Utilities.formatDate(new Date(), TIMEZONE, "yyyy")),
        hsCode: String((prod && getFieldFuzzy_(prod, ["HS_Code", "Mã HS"], ["hs_code"])) || "0801.32.00"),
        pack: String((packLookup && packLookup["Contract_Text_ENG"]) || dBd.packEng || it.packingName || (prod && getFieldFuzzy_(prod, ["Packaging", "Quy cách"], ["quy cách"])) || "Export Standard Carton"),
        cartons: String(dBd.cartons || parseSmartNumber_(it.cartons || 0)),
        weight: itemWeight,
        gw: dBd.gw || itemWeight,
        cbm: dBd.cbm || 0,
        unit: " KGS",
        baseLine: baseLine
      });
    }

    var tables = body.getTables();
    for (var tbIdx = 0; tbIdx < tables.length; tbIdx++) {
      var table = tables[tbIdx];
      var nRows = table.getNumRows();
      for (var rIdx = 0; rIdx < nRows; rIdx++) {
        var tr = table.getRow(rIdx);
        var rowText = tr.getText() || "";
        if (rowText.indexOf("{{ITEM_SKU}}") !== -1 || rowText.indexOf("{{ITEM_NAME}}") !== -1 || rowText.indexOf("{{ITEM_STT}}") !== -1) {
          for (var cIdx = 0; cIdx < itemRowsPrepared.length; cIdx++) {
            var rItem = itemRowsPrepared[cIdx];
            var shareRatio = baseWeightedSum > 0
              ? (rItem.baseLine / baseWeightedSum)
              : (finalNwVal > 0 ? rItem.weight / finalNwVal : 1 / Math.max(1, itemRowsPrepared.length));
            var lAmt = contractVal > 0 ? (contractVal * shareRatio) : rItem.baseLine;
            var lUnit = rItem.weight > 0 ? (lAmt / rItem.weight) : 0;
            var cloned = tr.copy();
            cloned.replaceText("\\{\\{ITEM_STT\\}\\}", rItem.stt);
            cloned.replaceText("\\{\\{ITEM_SKU\\}\\}", rItem.sku);
            cloned.replaceText("\\{\\{ITEM_NAME\\}\\}", rItem.name);
            cloned.replaceText("\\{\\{ITEM_GRADE\\}\\}", rItem.grade);
            cloned.replaceText("\\{\\{ITEM_SPEC\\}\\}", rItem.spec);
            cloned.replaceText("\\{\\{ORG\\}\\}", rItem.org);
            cloned.replaceText("\\{\\{ORIGIN\\}\\}", rItem.org);
            cloned.replaceText("\\{\\{CROP_YEAR\\}\\}", rItem.cropYear);
            cloned.replaceText("\\{\\{HS_CODE\\}\\}", rItem.hsCode);
            cloned.replaceText("\\{\\{ITEM_PACK\\}\\}", rItem.pack);
            cloned.replaceText("\\{\\{ITEM_CARTONS\\}\\}", rItem.cartons);
            cloned.replaceText("\\{\\{ITEM_QTY\\}\\}", formatCurrency(rItem.weight));
            cloned.replaceText("\\{\\{ITEM_NW\\}\\}", formatCurrency(rItem.weight));
            cloned.replaceText("\\{\\{ITEM_GW\\}\\}", formatCurrency(rItem.gw));
            cloned.replaceText("\\{\\{ITEM_CBM\\}\\}", Number(rItem.cbm || 0).toFixed(3));
            cloned.replaceText("\\{\\{ITEM_UNIT\\}\\}", rItem.unit);
            cloned.replaceText("\\{\\{ITEM_PRICE\\}\\}", formatCurrency(lUnit));
            cloned.replaceText("\\{\\{ITEM_AMT\\}\\}", formatCurrency(lAmt));
            table.insertTableRow(rIdx + 1 + cIdx, cloned);
          }
          table.removeRow(rIdx);
          break;
        }
      }
    }

    replaceInlineLogoTag_(doc, COMPANY_LOGO_ID);

    var docNoPrefix = kind === "INVOICE" ? "INV-" : (kind === "PACKING" ? "PKL-" : (kind === "CO" ? "CO-" : "BL-"));
    var docNoVal = docNoPrefix + contractNo;
    var saleNameDoc = String(ord["In_Charge_Staff"] || (inq && inq["Sale_rep"]) || "");
    var buyerTelDoc = [cnePhone, cneEmail].filter(Boolean).join(" / ");
    var totNwFormatted = formatCurrency(finalNwVal);
    var docTagMap = {
      "DOC_TITLE": docTypeLabel.toUpperCase(),
      "INVOICE_NO": "INV-" + contractNo,
      "PACKING_LIST_NO": "PKL-" + contractNo,
      "CO_NO": "CO-" + contractNo,
      "BL_NO": "BL-" + contractNo,
      "DOC_NO": docNoVal,
      "ORDER_ID": String(orderId),
      "Order_ID": String(orderId),
      "CONTRACT_NO": contractNo,
      "Contract_No": contractNo,
      "CTR_NO": contractNo,
      "CONTRACT_DATE": String(ord["Contract_Date"] || ""),
      "Contract_Date": String(ord["Contract_Date"] || ""),
      "CTR_DT": String(ord["Contract_Date"] || ""),
      "IN_CHARGE_STAFF": saleNameDoc,
      "SELLER_REP": saleNameDoc,
      "SALE_NAME": saleNameDoc,
      "CNE_NAME": cneName,
      "Consignee_Name": cneName,
      "BUYER_NAME": cneName,
      "CNE_ADDR": cneAddr,
      "Address": cneAddr,
      "CNE_COUNTRY": cneCountry,
      "FINAL_DESTINATION": pod || cneAddr,
      "CNE_TAX": cneTax,
      "Tax_ID": cneTax,
      "Contact": cneContact,
      "Contact_Person": cneContact,
      "CONTACT_PERSON": cneContact,
      "CNE_CONTACT": cneContact,
      "CNE_CONTACT_PERSON": cneContact,
      "CNE_REP": cneContact,
      "BUYER_CONTACT": cneContact,
      "BUYER_CONTACT_PERSON": cneContact,
      "BUYER_REP": cneContact,
      "ATTN": cneContact,
      "BUYER_ATTN": cneContact,
      "BUYER_TITLE": "Representative / Purchasing Manager",
      "CNE_TEL": cnePhone,
      "CNE_PHONE": cnePhone,
      "CNE_EMAIL": cneEmail,
      "BUYER_TEL": buyerTelDoc,
      "POL": pol,
      "POD": pod,
      "VES_VOY": vesVoyDisplay,
      "BK_NO": bkNoDisplay,
      "CARRIER_BK_NO": String(logiMetaDoc.Carrier_BK_No || ""),
      "FWD_BK_NO": String(logiMetaDoc.FWD_BK_No || ""),
      "BK_SOURCE": String(logiMetaDoc.Booking_Source || ""),
      "SI_CUTOFF": String(logiMetaDoc.SI_Cutoff || ""),
      "VGM_CUTOFF": String(logiMetaDoc.VGM_Cutoff || ""),
      "CFS_CUTOFF": String(logiMetaDoc.CFS_Cutoff || ""),
      "CY_CUTOFF": String(logiMetaDoc.CY_Cutoff || ""),
      "CUSTOMS_CUTOFF": String(logiMetaDoc.Customs_Cutoff || ""),
      "DRAFT_BL_CUTOFF": String(logiMetaDoc.Draft_BL_Cutoff || ""),
      "CONT_SEAL_LIST": contSealDisplay,
      "SHIPPING_LINE": String((schRow && schRow["Shipping_Line"]) || ""),
      "ETD": String((schRow && schRow["ETD"]) || ""),
      "ETA": String((schRow && schRow["ETA"]) || ""),
      "INCOTERM": appliedInc,
      "DELIVERY_TERM": incContractEng,
      "FREIGHT": freightTerm,
      "FREIGHT_TERM": freightTerm,
      "PAY_TERM": payTermEng,
      "CO_FORM": coFormCode,
      "CO_FORM_NAME": coFormNameEng,
      "ALL_PROD_NAMES": itemRowsPrepared.map(function (it) { return it.name; }).join(", "),
      "ORIGIN": (itemRowsPrepared.length > 0 && itemRowsPrepared[0].org) ? itemRowsPrepared[0].org : "VIETNAM",
      "Origin": (itemRowsPrepared.length > 0 && itemRowsPrepared[0].org) ? itemRowsPrepared[0].org : "VIETNAM",
      "ORG": (itemRowsPrepared.length > 0 && itemRowsPrepared[0].org) ? itemRowsPrepared[0].org : "VIETNAM",
      "SHIPPING_MARKS": "Origin: " + ((itemRowsPrepared.length > 0 && itemRowsPrepared[0].org) ? itemRowsPrepared[0].org : "VIETNAM") + "   |   Destination: " + (pod || cneCountry || "Destination"),
      "Shipping_Marks": "Origin: " + ((itemRowsPrepared.length > 0 && itemRowsPrepared[0].org) ? itemRowsPrepared[0].org : "VIETNAM") + "   |   Destination: " + (pod || cneCountry || "Destination"),
      "CONT_LOAD": String((prop && prop["Container_Type"]) || "Export Container") + " — Net: " + totNwFormatted + " KGS, Gross: " + formatCurrency(finalGwVal) + " KGS, Vol: " + Number(finalCbmVal || 0).toFixed(3) + " CBM",
      "QUANT_TOLERANCE": "+/- 5%",
      "TOT_QTY": totNwFormatted,
      "TOTAL_QTY": totNwFormatted,
      "TOTAL_NET_WEIGHT": totNwFormatted,
      "TOT_NW": totNwFormatted,
      "TOTAL_NW": totNwFormatted,
      "TOTAL_GROSS_WEIGHT": formatCurrency(finalGwVal),
      "TOTAL_GW": formatCurrency(finalGwVal),
      "TOTAL_CBM": Number(finalCbmVal || 0).toFixed(3),
      "TOTAL_CARTONS": String(totalCartonsSum || 0),
      "TOTAL_PALLETS": String(docPackSummary.totalPallets || 0),
      "SUBTOTAL_AMT": formatCurrency(contractVal),
      "TOT_AMT": formatCurrency(contractVal),
      "TOTAL_AMT": formatCurrency(contractVal),
      "TOT_AMT_WORDS": numberToUsdWordsServer_(contractVal),
      "CONTRACT_VALUE": formatCurrency(contractVal)
    };

    fixBuyerContactPersonPlaceholders_(doc, cneContact);
    for (var tk in docTagMap) {
      if (!Object.prototype.hasOwnProperty.call(docTagMap, tk)) continue;
      replaceAllSectionsText_(doc, "\\{\\{" + tk + "\\}\\}", docTagMap[tk]);
    }
    replaceAllSectionsText_(doc, "\\{\\{TOT_QTY\\}", totNwFormatted);
    cleanMergedDocSections_(doc);

    doc.saveAndClose();

    var exported = exportTempDocAsBase64_(docId, safeFileName, exportFormat || "pdf");
    return {
      success: true,
      fileName: exported.fileName,
      mimeType: exported.mimeType,
      base64Data: exported.base64Data,
      templateDocId: cleanTplId,
      templateUsed: matchedTpl ? String(matchedTpl["Document_Name"] || "") : docTypeLabel,
      templateId: matchedTpl ? String(matchedTpl["Template ID"] || "") : "",
      emailMeta: {
        docKind: kind,
        docLabel: docTypeLabel,
        contractNo: contractNo,
        quotNo: docNoVal,
        quotDt: String(ord["Contract_Date"] || Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd")),
        allProdNames: docTagMap["ALL_PROD_NAMES"],
        totQty: totNwFormatted,
        incoterm: appliedInc,
        incotermPlace: pod || pol,
        pol: pol,
        pod: pod,
        totAmt: formatCurrency(contractVal),
        validDays: "3",
        saleName: saleNameDoc || "Export Sales Executive",
        buyerName: cneContact || cneName,
        cneName: cneName,
        recipientEmail: cneEmail,
        payTerm: payTermEng
      }
    };
  } catch (err) {
    return { success: false, message: err.message };
  } finally {
    if (copyFile) {
      try {
        copyFile.setTrashed(true);
      } catch (trashErr) {}
    }
  }
}

function escapeHtmlEmailServer_(val) {
  return String(val == null ? "" : val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Xây dựng mẫu Email HTML chuẩn Thương mại Quốc tế (100% inline CSS tương thích Gmail / Outlook / Apple Mail).
 */
function buildExportEmailHtml(data, customMessage) {
  var d = data || {};
  var docKind = String(d.docKind || "QUOTATION").toUpperCase();
  var isQuotation = docKind === "QUOTATION";
  var quotNo = String(d.quotNo || d.QUOT_NO || "N/A");
  var quotDt = String(d.quotDt || d.QUOT_DT || Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd"));
  var allProdNames = String(d.allProdNames || d.ALL_PROD_NAMES || "Vietnamese Agricultural Products");
  var totQty = String(d.totQty || d.TOT_QTY || "0.00");
  var incoterm = String(d.incoterm || d.INCOTERM || "CIF");
  var incotermPlace = String(d.incotermPlace || d.INCOTERM_PLACE || "").trim();
  var pol = String(d.pol || d.POL || "").trim();
  var pod = String(d.pod || d.POD || "").trim();
  var totAmt = String(d.totAmt || d.TOT_AMT || "0.00");
  var validDays = String(d.validDays || d.VALID_DAYS || "3");
  var saleName = String(d.saleName || d.SALE_NAME || "Export Sales Team");
  var buyerName = String(d.buyerName || d.BUYER_NAME || d.cneName || d.CNE_NAME || "Valued Partner");
  var payTerm = String(d.payTerm || d.PAY_TERM || "");

  var defaultMessage = isQuotation
    ? ("Dear Mr./Ms. " + buyerName + ",\n\nThank you for your inquiry. Please find attached our official export quotation (" + quotNo + ") for your review.\n\nShould you require any further clarification or adjustments, please do not hesitate to contact us.")
    : ("Dear Mr./Ms. " + buyerName + ",\n\nPlease find attached the official " + String(d.docLabel || "Export Document") + " (" + quotNo + ") for your shipment records and customs clearance.\n\nShould you need any further assistance, please let us know.");

  var rawMessage = String(customMessage || "").trim() || defaultMessage;
  var messageHtml = escapeHtmlEmailServer_(rawMessage).replace(/\r\n|\r|\n/g, "<br>");

  var headerRightLabel = isQuotation
    ? ("OFFICIAL QUOTATION: " + quotNo)
    : (String(d.docLabel || "EXPORT DOCUMENT").toUpperCase() + ": " + quotNo);
  var refRowLabel = isQuotation ? "Quotation Ref. & Date" : "Document Ref. & Date";
  var valueRowLabel = isQuotation ? "Total Quotation Value" : "Total Document Value";
  var routePart = (pol || pod) ? (" (" + (pol || "Vietnam") + " \u2192 " + (pod || "Destination") + ")") : "";
  var deliveryText = [incoterm, incotermPlace].filter(Boolean).join(" ") + routePart;
  var fifthRowLabel = isQuotation ? "Quotation Validity" : "Payment Terms";
  var fifthRowVal = isQuotation ? (validDays + " days from quotation date") : (payTerm || "As per signed contract");
  var logoImgEmailUrl = "https://lh3.googleusercontent.com/d/" + COMPANY_LOGO_ID;

  return (
    '<div style="margin:0;padding:24px 12px;background-color:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#1e293b;line-height:1.6;">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:680px;margin:0 auto;background-color:#ffffff;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;border-collapse:collapse;">' +
        '<tr>' +
          '<td style="background-color:#14532d;padding:20px 24px;color:#ffffff;">' +
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">' +
              '<tr>' +
                '<td style="vertical-align:middle;width:54px;padding-right:12px;">' +
                  '<img src="' + logoImgEmailUrl + '" alt="GREEN AGRI-EXPORTS" width="44" height="44" style="display:block;width:44px;height:44px;object-fit:contain;border-radius:8px;background-color:#ffffff;padding:2px;" />' +
                '</td>' +
                '<td style="vertical-align:middle;">' +
                  '<div style="font-size:16px;font-weight:700;letter-spacing:0.4px;color:#ffffff;margin:0;">GREEN AGRICULTURAL PRODUCTS EXPORT CO., LTD</div>' +
                  '<div style="font-size:11px;font-weight:600;letter-spacing:0.8px;color:#bbf7d0;margin-top:4px;">GLOBAL AGRICULTURAL SUPPLY &amp; LOGISTICS &bull; DA NANG, VIETNAM</div>' +
                '</td>' +
                '<td style="vertical-align:middle;text-align:right;padding-left:12px;">' +
                  '<span style="display:inline-block;padding:6px 10px;background-color:#166534;border:1px solid #86efac;border-radius:6px;font-size:11px;font-weight:700;color:#ffffff;white-space:nowrap;">' +
                    escapeHtmlEmailServer_(headerRightLabel) +
                  '</span>' +
                '</td>' +
              '</tr>' +
            '</table>' +
          '</td>' +
        '</tr>' +
        '<tr>' +
          '<td style="padding:24px 24px 16px 24px;font-size:14px;color:#1e293b;line-height:1.65;">' +
            messageHtml +
          '</td>' +
        '</tr>' +
        '<tr>' +
          '<td style="padding:4px 24px 20px 24px;">' +
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;border-collapse:separate;border-spacing:0;">' +
              '<tr>' +
                '<td colspan="2" style="padding:12px 16px 8px 16px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#14532d;border-bottom:1px solid #bbf7d0;">' +
                  (isQuotation ? 'Quotation Summary' : 'Shipment &amp; Document Summary') +
                '</td>' +
              '</tr>' +
              '<tr>' +
                '<td style="padding:10px 16px;font-size:13px;font-weight:600;color:#334155;width:40%;border-bottom:1px solid #dcfce7;">' + refRowLabel + '</td>' +
                '<td style="padding:10px 16px;font-size:13px;font-weight:700;color:#0f172a;border-bottom:1px solid #dcfce7;">' + escapeHtmlEmailServer_(quotNo) + ' (' + escapeHtmlEmailServer_(quotDt) + ')</td>' +
              '</tr>' +
              '<tr>' +
                '<td style="padding:10px 16px;font-size:13px;font-weight:600;color:#334155;border-bottom:1px solid #dcfce7;">Commodity &amp; Total Quantity</td>' +
                '<td style="padding:10px 16px;font-size:13px;color:#0f172a;border-bottom:1px solid #dcfce7;">' + escapeHtmlEmailServer_(allProdNames) + ' &mdash; <strong>' + escapeHtmlEmailServer_(totQty) + ' KGS</strong></td>' +
              '</tr>' +
              '<tr>' +
                '<td style="padding:10px 16px;font-size:13px;font-weight:600;color:#334155;border-bottom:1px solid #dcfce7;">Delivery Terms (Incoterms 2020)</td>' +
                '<td style="padding:10px 16px;font-size:13px;color:#0f172a;border-bottom:1px solid #dcfce7;">' + escapeHtmlEmailServer_(deliveryText) + '</td>' +
              '</tr>' +
              '<tr>' +
                '<td style="padding:10px 16px;font-size:13px;font-weight:600;color:#334155;border-bottom:1px solid #dcfce7;">' + valueRowLabel + '</td>' +
                '<td style="padding:10px 16px;font-size:15px;font-weight:800;color:#14532d;border-bottom:1px solid #dcfce7;">USD ' + escapeHtmlEmailServer_(totAmt) + '</td>' +
              '</tr>' +
              '<tr>' +
                '<td style="padding:10px 16px;font-size:13px;font-weight:600;color:#334155;">' + fifthRowLabel + '</td>' +
                '<td style="padding:10px 16px;font-size:13px;color:#0f172a;">' + escapeHtmlEmailServer_(fifthRowVal) + '</td>' +
              '</tr>' +
            '</table>' +
          '</td>' +
        '</tr>' +
        '<tr>' +
          '<td style="padding:4px 24px 24px 24px;">' +
            '<div style="border-top:1px solid #e2e8f0;padding-top:16px;font-size:13px;color:#334155;">' +
              '<div style="font-size:14px;font-weight:700;color:#14532d;">' + escapeHtmlEmailServer_(saleName) + '</div>' +
              '<div style="font-size:12px;font-weight:600;color:#475569;margin-bottom:6px;">Export Sales Executive</div>' +
              '<div style="font-size:12px;font-weight:700;color:#0f172a;">GREEN AGRICULTURAL PRODUCTS EXPORT CO., LTD</div>' +
              '<div style="font-size:11.5px;color:#64748b;margin-top:2px;">Address: No. 128 Bach Dang Street, Hai Chau District, Da Nang City, Vietnam | Tel: (+84) 236 388 9922 | Email: export@greenagri-vn.com</div>' +
            '</div>' +
          '</td>' +
        '</tr>' +
      '</table>' +
    '</div>'
  );
}

/**
 * Helper tìm lại link Gmail Sent của email vừa gửi (chờ ~1.5s để Gmail đánh chỉ mục).
 * Trả về { gmailSentUrl, fallbackGmailUrl, threadId }.
 */
function findSentGmailThreadUrl_(emailSubject, refNo) {
  var refClean = String(refNo || "").trim();
  var fallbackSearchUrl = "https://mail.google.com/mail/u/0/#search/in%3Asent+" + encodeURIComponent(refClean || String(emailSubject || ""));
  var directUrl = fallbackSearchUrl;
  var threadId = "";
  try {
    Utilities.sleep(1500);
    var subjClean = String(emailSubject || "").replace(/"/g, " ").trim();
    var threads = [];
    if (subjClean) {
      threads = GmailApp.search('in:sent subject:"' + subjClean + '"', 0, 1);
    }
    if ((!threads || threads.length === 0) && refClean) {
      threads = GmailApp.search('in:sent "' + refClean.replace(/"/g, " ") + '"', 0, 1);
    }
    if (threads && threads.length > 0) {
      threadId = String(threads[0].getId() || "").trim();
      if (threadId) {
        directUrl = "https://mail.google.com/mail/u/0/#sent/" + threadId;
      }
    }
  } catch (searchErr) {
    // Nếu chưa cấp quyền đọc GmailApp.search (hoặc chạy dưới MailApp), giữ nguyên fallbackSearchUrl
  }
  return {
    gmailSentUrl: directUrl,
    fallbackGmailUrl: fallbackSearchUrl,
    threadId: threadId
  };
}

/**
 * Gửi Email Báo giá HTML chuyên nghiệp mang danh nghĩa "GREEN AGRI-EXPORTS (Nông Sản Xanh)"
 * đính kèm file PDF thật:
 * - Hỗ trợ chế độ Deploy "Execute as: User accessing the web app" (ưu tiên GmailApp.sendEmail để lưu thẳng vào Sent của từng thành viên, fallback MailApp nếu thiếu scope Gmail).
 * - Tham số name: "GREEN AGRI-EXPORTS (Nông Sản Xanh)", replyTo: "export@greenagri-vn.com".
 * - Tìm link thư đã gửi trong Gmail Sent & lưu URL vào cột Sent_Mail_Link + Note của Inquiry_Quotation.
 */
function sendQuotationEmailWithPdf(orderId, recipientEmail, customSubject, customMessage, senderName, modeOverride) {
  var cleanEmail = String(recipientEmail || "").trim();
  if (!cleanEmail || cleanEmail.indexOf("@") === -1) {
    return { success: false, message: "Vui lòng nhập địa chỉ email khách hàng hợp lệ." };
  }
  var pdfRes = exportQuotationFromTemplate(orderId, "pdf", modeOverride);
  if (!pdfRes || !pdfRes.success || !pdfRes.base64Data) {
    return { success: false, message: (pdfRes && pdfRes.message) || "Không thể kết xuất file PDF báo giá để đính kèm." };
  }
  try {
    var inquiries = readSheetAsObjects_("Inquiry_Quotation");
    var inq = null;
    for (var i = 0; i < inquiries.length; i++) {
      if (String(inquiries[i]["Order_ID"] || "").trim() === String(orderId || "").trim()) {
        inq = inquiries[i];
        break;
      }
    }
    var meta = pdfRes.emailMeta || {};
    var cleanSender = String(senderName || "").trim();
    if (cleanSender) {
      meta.saleName = cleanSender;
    }
    var curRound = parseInt((inq && inq["Quote_Round"]) || pdfRes.quoteRound || 0, 10) || 0;
    var alreadySentBefore = Boolean(
      inq && (
        String(inq["Sent_Mail_Link"] || "").trim() ||
        String(inq["Inquiry_Status"] || "").toLowerCase().indexOf("đã gửi báo giá") !== -1
      )
    );
    var roundNum = alreadySentBefore ? (curRound + 1) : Math.max(curRound, 1);
    var sentStatus = "Đã gửi báo giá (Lần " + roundNum + ") — Chờ khách phản hồi";
    var quotNoStr = cleanQuoteIdForCustomer_(meta.quotNo || pdfRes.quotationNo || orderId);
    var quotNoClean = quotNoStr.replace(/[\\/:*?"<>|\s]+/g, "_");
    var cneClean = String(meta.cneName || "Customer").replace(/[\\/:*?"<>|]+/g, "").trim().replace(/\s+/g, "_");
    var attachFileName = "Quotation_" + quotNoClean + "_" + (cneClean || "Customer") + ".pdf";

    var bytes = Utilities.base64Decode(pdfRes.base64Data);
    var pdfBlob = Utilities.newBlob(bytes, "application/pdf", attachFileName);

    var cleanProdNames = stripInternalCodesForCustomer_(meta.allProdNames || (inq && inq["Tên sản phẩm"]) || "Vietnamese Agricultural Products") || "Vietnamese Agricultural Products";
    var defaultSubject = "[GREEN AGRI-EXPORTS] Official Quotation \u2013 " + cleanProdNames + " (" + quotNoStr + ")";
    var emailSubject = stripInternalCodesForCustomer_(customSubject) || defaultSubject;
    var htmlEmailContent = buildExportEmailHtml(meta, customMessage);
    var plainTextFallback = String(customMessage || "").trim() ||
      ("Dear " + (meta.buyerName || "Valued Partner") + ",\n\nPlease find attached our official Export Quotation " + quotNoStr + " (" + attachFileName + ").\n\nBest regards,\nGREEN AGRICULTURAL PRODUCTS EXPORT CO., LTD");

    var companyDisplayName = "GREEN AGRI-EXPORTS (Nông Sản Xanh)";
    var companyReplyTo = "export@greenagri-vn.com";
    var mailDispatchMethod = "GmailApp";
    try {
      GmailApp.sendEmail(cleanEmail, emailSubject, plainTextFallback, {
        htmlBody: htmlEmailContent,
        attachments: [pdfBlob],
        name: companyDisplayName,
        replyTo: companyReplyTo
      });
    } catch (gmailErr) {
      mailDispatchMethod = "MailApp";
      MailApp.sendEmail({
        to: cleanEmail,
        subject: emailSubject,
        body: plainTextFallback,
        htmlBody: htmlEmailContent,
        name: companyDisplayName,
        replyTo: companyReplyTo,
        attachments: [pdfBlob]
      });
    }

    var sentLinkInfo = findSentGmailThreadUrl_(emailSubject, quotNoStr);
    var gmailSentUrl = sentLinkInfo.gmailSentUrl || String((inq && inq["Sent_Mail_Link"]) || "").trim();
    var cleanNoteVal = String((inq && inq["Note"]) || "").replace(/\s*\[ITEMS:[^\]]+\]/g, "").trim();

    updateRowByKey_("Inquiry_Quotation", "Order_ID", orderId, {
      "Inquiry_Status": sentStatus,
      "Quote_Round": roundNum,
      "Email": cleanEmail,
      "Sent_Mail_Link": gmailSentUrl
    });

    return {
      success: true,
      emailSentTo: cleanEmail,
      fileName: attachFileName,
      emailSubject: emailSubject,
      inquiryStatus: sentStatus,
      quoteRound: roundNum,
      quotationNo: pdfRes.quotationNo || quotNoStr,
      gmailSentUrl: gmailSentUrl,
      fallbackGmailUrl: sentLinkInfo.fallbackGmailUrl,
      updatedNote: cleanNoteVal,
      mailDispatchMethod: mailDispatchMethod
    };
  } catch (mailErr) {
    return {
      success: false,
      message: "Lỗi gửi Email qua GmailApp/MailApp: " + (mailErr && mailErr.message ? mailErr.message : String(mailErr))
    };
  }
}

/**
 * Gửi Email Chứng từ Xuất khẩu (Invoice, Packing List, C/O, B/L) định dạng HTML mang danh nghĩa GREEN AGRI-EXPORTS đính kèm PDF thật.
 */
function sendExportDocumentEmailWithPdf(orderId, docType, recipientEmail, customSubject, customMessage, senderName) {
  var cleanEmail = String(recipientEmail || "").trim();
  if (!cleanEmail || cleanEmail.indexOf("@") === -1) {
    return { success: false, message: "Vui lòng nhập địa chỉ email khách hàng hợp lệ." };
  }
  var pdfRes = exportShippingDocumentFromTemplate(orderId, docType || "INVOICE", "pdf");
  if (!pdfRes || !pdfRes.success || !pdfRes.base64Data) {
    return { success: false, message: (pdfRes && pdfRes.message) || "Không thể kết xuất file PDF chứng từ để đính kèm." };
  }
  try {
    var meta = pdfRes.emailMeta || {};
    var cleanSender = String(senderName || "").trim();
    if (cleanSender) {
      meta.saleName = cleanSender;
    }
    var docLabel = String(meta.docLabel || docType || "Export Document");
    var docNoStr = String(meta.quotNo || orderId);
    var docNoClean = docNoStr.replace(/[\\/:*?"<>|\s]+/g, "_");
    var cneClean = String(meta.cneName || "Customer").replace(/[\\/:*?"<>|]+/g, "").trim().replace(/\s+/g, "_");
    var attachFileName = String(docType || "DOC").toUpperCase() + "_" + docNoClean + "_" + (cneClean || "Customer") + ".pdf";

    var bytes = Utilities.base64Decode(pdfRes.base64Data);
    var pdfBlob = Utilities.newBlob(bytes, "application/pdf", attachFileName);
    var defaultSubject = "[GREEN AGRI-EXPORTS] " + docLabel + " " + docNoStr + " \u2013 " + (meta.allProdNames || "Agricultural Products") + " (" + (meta.incoterm || "CIF") + ")";
    var emailSubject = String(customSubject || "").trim() || defaultSubject;
    var htmlEmailContent = buildExportEmailHtml(meta, customMessage);
    var plainTextFallback = String(customMessage || "").trim() ||
      ("Dear " + (meta.buyerName || "Valued Partner") + ",\n\nPlease find attached our " + docLabel + " (" + attachFileName + ").\n\nBest regards,\nGREEN AGRICULTURAL PRODUCTS EXPORT CO., LTD");

    var companyDisplayName = "GREEN AGRI-EXPORTS (Nông Sản Xanh)";
    var companyReplyTo = "export@greenagri-vn.com";
    var mailDispatchMethod = "GmailApp";
    try {
      GmailApp.sendEmail(cleanEmail, emailSubject, plainTextFallback, {
        htmlBody: htmlEmailContent,
        attachments: [pdfBlob],
        name: companyDisplayName,
        replyTo: companyReplyTo
      });
    } catch (gmailErr) {
      mailDispatchMethod = "MailApp";
      MailApp.sendEmail({
        to: cleanEmail,
        subject: emailSubject,
        body: plainTextFallback,
        htmlBody: htmlEmailContent,
        name: companyDisplayName,
        replyTo: companyReplyTo,
        attachments: [pdfBlob]
      });
    }

    var sentLinkInfo = findSentGmailThreadUrl_(emailSubject, docNoStr);

    return {
      success: true,
      emailSentTo: cleanEmail,
      fileName: attachFileName,
      emailSubject: emailSubject,
      gmailSentUrl: sentLinkInfo.gmailSentUrl,
      fallbackGmailUrl: sentLinkInfo.fallbackGmailUrl,
      mailDispatchMethod: mailDispatchMethod
    };
  } catch (mailErr) {
    return {
      success: false,
      message: "Lỗi gửi Email qua GmailApp/MailApp: " + (mailErr && mailErr.message ? mailErr.message : String(mailErr))
    };
  }
}

function buildContractHandoverEmailHtml_(data, customMessage) {
  var d = data || {};
  var contractNo = String(d.contractNo || d.quotNo || "N/A");
  var contractDt = String(d.quotDt || Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd"));
  var cneName = String(d.cneName || "Khách hàng");
  var allProdNames = String(d.allProdNames || "Nông sản xuất khẩu");
  var totQty = String(d.totQty || "0.00");
  var incoterm = String(d.incoterm || "CIF");
  var pol = String(d.pol || "").trim();
  var pod = String(d.pod || "").trim();
  var totAmt = String(d.totAmt || "0.00");
  var payTerm = String(d.payTerm || "Theo thỏa thuận hợp đồng");
  var saleName = String(d.saleName || "Sales Executive");

  var defaultMsg =
    "Chào " + saleName + ",\n\n" +
    "Phòng Xuất Nhập Khẩu đã hoàn tất soạn thảo Hợp đồng Ngoại thương số " + contractNo + " cho khách hàng " + cneName + " (đính kèm file PDF chính thức).\n\n" +
    "Đề nghị Sales kiểm tra lại các điều khoản thanh toán, thời hạn giao hàng và số lượng hàng hóa trước khi chuyển khách hàng ký xác nhận và thực hiện đặt cọc / mở L/C.";
  var rawMsg = String(customMessage || "").trim() || defaultMsg;
  var msgHtml = escapeHtmlEmailServer_(rawMsg).replace(/\r\n|\r|\n/g, "<br>");
  var routeText = (pol || pod) ? (incoterm + " (" + (pol || "Việt Nam") + " \u2192 " + (pod || "Cảng đích") + ")") : incoterm;

  var logoImgCtrUrl = "https://lh3.googleusercontent.com/d/" + COMPANY_LOGO_ID;

  return (
    '<div style="margin:0;padding:24px 12px;background-color:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#1e293b;line-height:1.6;">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:680px;margin:0 auto;background-color:#ffffff;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;border-collapse:collapse;">' +
        '<tr>' +
          '<td style="background-color:#14532d;padding:20px 24px;color:#ffffff;">' +
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">' +
              '<tr>' +
                '<td style="vertical-align:middle;width:54px;padding-right:12px;">' +
                  '<img src="' + logoImgCtrUrl + '" alt="GREEN AGRI-EXPORTS" width="44" height="44" style="display:block;width:44px;height:44px;object-fit:contain;border-radius:8px;background-color:#ffffff;padding:2px;" />' +
                '</td>' +
                '<td style="vertical-align:middle;">' +
                  '<div style="font-size:16px;font-weight:700;letter-spacing:0.4px;color:#ffffff;margin:0;">GREEN AGRI-EXPORTS (NÔNG SẢN XANH)</div>' +
                  '<div style="font-size:11px;font-weight:600;letter-spacing:0.8px;color:#bbf7d0;margin-top:4px;">BÀN GIAO HỢP ĐỒNG NGOẠI THƯƠNG NỘI BỘ (XNK \u2192 SALES)</div>' +
                '</td>' +
                '<td style="vertical-align:middle;text-align:right;padding-left:12px;">' +
                  '<span style="display:inline-block;padding:6px 10px;background-color:#166534;border:1px solid #86efac;border-radius:6px;font-size:11px;font-weight:700;color:#ffffff;white-space:nowrap;">HĐ: ' + escapeHtmlEmailServer_(contractNo) + '</span>' +
                '</td>' +
              '</tr>' +
            '</table>' +
          '</td>' +
        '</tr>' +
        '<tr><td style="padding:24px 24px 16px 24px;font-size:14px;color:#1e293b;line-height:1.65;">' + msgHtml + '</td></tr>' +
        '<tr>' +
          '<td style="padding:4px 24px 20px 24px;">' +
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;border-collapse:separate;border-spacing:0;">' +
              '<tr><td colspan="2" style="padding:12px 16px 8px 16px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#14532d;border-bottom:1px solid #bbf7d0;">Thông tin Hợp đồng bàn giao</td></tr>' +
              '<tr><td style="padding:10px 16px;font-size:13px;font-weight:600;color:#334155;width:40%;border-bottom:1px solid #dcfce7;">Số &amp; Ngày Hợp đồng</td><td style="padding:10px 16px;font-size:13px;font-weight:700;color:#0f172a;border-bottom:1px solid #dcfce7;">' + escapeHtmlEmailServer_(contractNo) + ' (' + escapeHtmlEmailServer_(contractDt) + ')</td></tr>' +
              '<tr><td style="padding:10px 16px;font-size:13px;font-weight:600;color:#334155;border-bottom:1px solid #dcfce7;">Khách hàng (Buyer)</td><td style="padding:10px 16px;font-size:13px;font-weight:700;color:#0f172a;border-bottom:1px solid #dcfce7;">' + escapeHtmlEmailServer_(cneName) + '</td></tr>' +
              '<tr><td style="padding:10px 16px;font-size:13px;font-weight:600;color:#334155;border-bottom:1px solid #dcfce7;">Mặt hàng &amp; Trọng lượng</td><td style="padding:10px 16px;font-size:13px;color:#0f172a;border-bottom:1px solid #dcfce7;">' + escapeHtmlEmailServer_(allProdNames) + ' &mdash; <strong>' + escapeHtmlEmailServer_(totQty) + ' KGS</strong></td></tr>' +
              '<tr><td style="padding:10px 16px;font-size:13px;font-weight:600;color:#334155;border-bottom:1px solid #dcfce7;">Điều kiện giao hàng</td><td style="padding:10px 16px;font-size:13px;color:#0f172a;border-bottom:1px solid #dcfce7;">' + escapeHtmlEmailServer_(routeText) + '</td></tr>' +
              '<tr><td style="padding:10px 16px;font-size:13px;font-weight:600;color:#334155;border-bottom:1px solid #dcfce7;">Giá trị Hợp đồng</td><td style="padding:10px 16px;font-size:15px;font-weight:800;color:#14532d;border-bottom:1px solid #dcfce7;">USD ' + escapeHtmlEmailServer_(totAmt) + '</td></tr>' +
              '<tr><td style="padding:10px 16px;font-size:13px;font-weight:600;color:#334155;">Phương thức thanh toán</td><td style="padding:10px 16px;font-size:13px;color:#0f172a;">' + escapeHtmlEmailServer_(payTerm) + '</td></tr>' +
            '</table>' +
          '</td>' +
        '</tr>' +
        '<tr>' +
          '<td style="padding:4px 24px 24px 24px;">' +
            '<div style="border-top:1px solid #e2e8f0;padding-top:14px;font-size:12px;color:#475569;">' +
              'Phòng Xuất Nhập Khẩu &amp; Logistics &bull; <strong>GREEN AGRICULTURAL PRODUCTS EXPORT CO., LTD</strong>' +
            '</div>' +
          '</td>' +
        '</tr>' +
      '</table>' +
    '</div>'
  );
}

/**
 * XNK gửi Email Hợp đồng Ngoại thương PDF kèm thông tin bàn giao cho Sales phụ trách,
 * tự động tìm lại link Gmail Sent và lưu vào cột Contract_Sent_Mail_Link của Order_Master.
 */
function sendContractEmailToSalesWithPdf(orderId, recipientEmail, customSubject, customMessage, senderName, overrideOptions) {
  var cleanEmail = String(recipientEmail || "").trim();
  if (!cleanEmail || cleanEmail.indexOf("@") === -1) {
    return { success: false, message: "Vui lòng nhập địa chỉ email nhân viên Sales hợp lệ." };
  }
  var exportOpts = Object.assign({}, (overrideOptions && typeof overrideOptions === "object") ? overrideOptions : {}, {
    format: "pdf",
    includeExportOnSave: true
  });
  var pdfRes = generatePopulatedContractDoc_(orderId, exportOpts, true);
  if (!pdfRes || !pdfRes.success || !pdfRes.base64Data) {
    return { success: false, message: (pdfRes && pdfRes.message) || "Không thể kết xuất file PDF Hợp đồng để đính kèm." };
  }
  try {
    var meta = pdfRes.emailMeta || {};
    var ctrNoStr = String(meta.contractNo || pdfRes.contractNo || orderId);
    var ctrNoClean = ctrNoStr.replace(/[\\/:*?"<>|\s]+/g, "_");
    var attachFileName = "Sales_Contract_" + ctrNoClean + ".pdf";
    var bytes = Utilities.base64Decode(pdfRes.base64Data);
    var pdfBlob = Utilities.newBlob(bytes, "application/pdf", attachFileName);

    var ctrProdNamesClean = stripInternalCodesForCustomer_(meta.allProdNames || "Vietnamese Agricultural Products") || "Vietnamese Agricultural Products";
    var defaultSubject = "[GREEN AGRI-EXPORTS] Sales Contract \u2013 " + ctrProdNamesClean + " (" + ctrNoStr + ")";
    var emailSubject = stripInternalCodesForCustomer_(customSubject) || defaultSubject;
    var htmlEmailContent = buildContractHandoverEmailHtml_(meta, customMessage);
    var plainTextFallback = String(customMessage || "").trim() ||
      ("Phòng XNK bàn giao Hợp đồng Ngoại thương " + ctrNoStr + " (" + attachFileName + ") cho Sales gửi khách ký.");

    var companyDisplayName = "GREEN AGRI-EXPORTS (Nông Sản Xanh)";
    var companyReplyTo = "export@greenagri-vn.com";
    var mailDispatchMethod = "GmailApp";
    try {
      GmailApp.sendEmail(cleanEmail, emailSubject, plainTextFallback, {
        htmlBody: htmlEmailContent,
        attachments: [pdfBlob],
        name: companyDisplayName,
        replyTo: companyReplyTo
      });
    } catch (gmailErr) {
      mailDispatchMethod = "MailApp";
      MailApp.sendEmail({
        to: cleanEmail,
        subject: emailSubject,
        body: plainTextFallback,
        htmlBody: htmlEmailContent,
        name: companyDisplayName,
        replyTo: companyReplyTo,
        attachments: [pdfBlob]
      });
    }

    var sentLinkInfo = findSentGmailThreadUrl_(emailSubject, ctrNoStr);
    var gmailSentUrl = sentLinkInfo.gmailSentUrl;
    var nextStatus = typeof PENDING_SALES_SIGN_STATUS_SERVER_ !== "undefined"
      ? PENDING_SALES_SIGN_STATUS_SERVER_
      : "Chờ Sales đưa ký";

    var ordUpdates = {
      "Fulfillment_Status": nextStatus
    };
    if (pdfRes.contractLink) {
      ordUpdates["Contract_Link"] = pdfRes.contractLink;
    }
    updateRowByKey_("Order_Master", "Order_ID", orderId, ordUpdates);

    return {
      success: true,
      emailSentTo: cleanEmail,
      fileName: attachFileName,
      emailSubject: emailSubject,
      contractNo: ctrNoStr,
      contractLink: pdfRes.contractLink || "",
      fulfillmentStatus: nextStatus,
      gmailSentUrl: gmailSentUrl,
      fallbackGmailUrl: sentLinkInfo.fallbackGmailUrl,
      mailDispatchMethod: mailDispatchMethod
    };
  } catch (mailErr) {
    return {
      success: false,
      message: "Lỗi gửi Email Hợp đồng qua GmailApp/MailApp: " + (mailErr && mailErr.message ? mailErr.message : String(mailErr))
    };
  }
}

/**
 * ============================================================================
 * 2.2 & 3.5. XNK - LẬP & QUẢN LÝ HỢP ĐỒNG NGOẠI THƯƠNG (Order_Master)
 * ============================================================================
 */
function buildContractDraftObject_(inq, proposals, schedules, consignees, orders, products, templates, staffName, customerNote) {
  var orderId = String(inq["Order_ID"] || "").trim();
  var prop = null;
  var fallbackProp = null;
  for (var p = proposals.length - 1; p >= 0; p--) {
    var pOrderId = proposals[p]["Order ID"] || proposals[p]["Order_ID"] || "";
    if (String(pOrderId).trim() === orderId) {
      if (!fallbackProp) fallbackProp = proposals[p];
      var bStat = String(proposals[p]["Booking_Status"] || "");
      if (bStat.indexOf("Superseded") === -1 && bStat.indexOf("Đã thay thế") === -1) {
        prop = proposals[p];
        break;
      }
    }
  }
  if (!prop) prop = fallbackProp;

  var cus = null;
  for (var c = 0; c < consignees.length; c++) {
    if (String(consignees[c]["Consignee_ID"]).trim() === String(inq["Consignee_ID"]).trim()) {
      cus = consignees[c];
      break;
    }
  }

  var pol = "Cát Lái";
  var pod = "";
  var country = (cus && cus["Country"]) || "";
  if (prop && prop["Schedule_ID"]) {
    for (var s = 0; s < schedules.length; s++) {
      if (String(schedules[s]["Schedule_ID"]).trim() === String(prop["Schedule_ID"]).trim()) {
        pol = schedules[s]["POL"] || pol;
        pod = schedules[s]["POD"] || "";
        country = schedules[s]["Country"] || country;
        break;
      }
    }
  }

  var orderItems = parseOrderItemsServer_(inq, inq["Mã sản phẩm"], inq["Net_Weight_KGs"], products, null, null);
  var autoTpl = selectContractTemplateDynamic_(templates, orderItems, products, "");
  var autoCoForm = suggestCoFormCode_(pod, country);

  var contractNo = generateNextContractNo_(orders);
  var todayStr = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");

  var contractVal = parseSmartNumber_(prop && (prop["Final_Selling Price"] !== undefined ? prop["Final_Selling Price"] : prop["Final_Selling_Price"]));
  return {
    "Order_ID": orderId,
    "Contract_No.": contractNo,
    "Contract_Date": todayStr,
    "In_Charge_Staff": staffName || inq["Sale_rep"] || "",
    "Consignee_ID": inq["Consignee_ID"] || "",
    "SKU_Code": inq["Mã sản phẩm"] || inq["SKU_Code"] || "",
    "NW_Confirmed_KGs": parseSmartNumber_(inq["Net_Weight_KGs"]),
    "Applied_Incoterm": (prop && prop["Recommended Incoterm"]) || inq["Incoterm mong muốn"] || "",
    "Contract_Value": contractVal,
    "Payment_Terms": inq["Phương thức thanh toán đề xuất"] || "",
    "POL": pol,
    "POD": pod,
    "Fulfillment_Status": WORKFLOW_6_STAGES_SERVER_[2],
    "CO_Form": autoCoForm,
    "Contract_Link": ""
  };
}

function confirmOrderToContractDraft(orderId, customerNote, staffName) {
  var cleanOrderId = String(orderId || "").trim();
  var cleanNote = String(customerNote || "").replace(/\s*\[ITEMS:[^\]]+\]/g, "").trim();
  var inquiries = readSheetAsObjects_("Inquiry_Quotation");
  var proposals = readSheetAsObjects_("Pricing_Proposal");
  var schedules = readSheetAsObjects_("Shipping_Schedule");
  var consignees = readSheetAsObjects_("Consignee_Directory");
  var orders = readSheetAsObjects_("Order_Master");
  var products = readSheetAsObjects_("Product_Catalog");
  var templates = readSheetAsObjects_("Template_Manager");

  var inq = null;
  for (var i = 0; i < inquiries.length; i++) {
    if (String(inquiries[i]["Order_ID"] || "").trim() === cleanOrderId) {
      inq = inquiries[i];
      break;
    }
  }
  if (!inq) {
    return { success: false, message: "Không tìm thấy yêu cầu báo giá: " + cleanOrderId };
  }

  var inqUpdates = {
    "Inquiry_Status": "Khách đã chốt đơn",
    "Customer_Confirm_Note": cleanNote
  };
  if (cleanNote) {
    inqUpdates["Note"] = cleanNote;
  }
  updateRowByKey_("Inquiry_Quotation", "Order_ID", cleanOrderId, inqUpdates);

  var existingContract = null;
  for (var o = 0; o < orders.length; o++) {
    if (String(orders[o]["Order_ID"] || "").trim() === cleanOrderId) {
      existingContract = orders[o];
      break;
    }
  }

  var contractObj = buildContractDraftObject_(inq, proposals, schedules, consignees, orders, products, templates, staffName, cleanNote);
  if (existingContract) {
    contractObj["Contract_No."] = String(existingContract["Contract_No."] || contractObj["Contract_No."]).trim();
    contractObj["Contract_Date"] = String(existingContract["Contract_Date"] || contractObj["Contract_Date"]).trim();
    contractObj["Contract_Link"] = String(existingContract["Contract_Link"] || "").trim();
    if (existingContract["Fulfillment_Status"]) {
      contractObj["Fulfillment_Status"] = toOrderMasterSafeStatusServer_(existingContract["Fulfillment_Status"]);
    }
    updateRowByKey_("Order_Master", "Order_ID", cleanOrderId, contractObj);
    return { success: true, contract: contractObj, alreadyExists: true };
  }

  appendObjectToSheet_("Order_Master", contractObj, ORDER_MASTER_COLUMNS_);
  return { success: true, contract: contractObj };
}

/**
 * XNK xác nhận hoàn thiện Hợp đồng Ngoại thương, lưu file lên Drive (Contract_Link)
 * và chuyển trạng thái Fulfillment_Status sang "Chờ Sales đưa ký" (ghi đè tại chỗ 15 cột chuẩn).
 */
function confirmAndSendContractToSales(orderId, overrideOptions) {
  var cleanOrderId = String(orderId || "").trim().replace(/-(?:V|R)\d+$/i, "");
  if (!cleanOrderId) {
    return { success: false, message: "Thiếu mã đơn hàng để xác nhận gửi Hợp đồng cho Sales." };
  }
  var exportOpts = Object.assign({}, (overrideOptions && typeof overrideOptions === "object") ? overrideOptions : {}, {
    format: "pdf",
    includeExportOnSave: false
  });
  var savedRes = generatePopulatedContractDoc_(cleanOrderId, exportOpts, true);
  if (!savedRes || !savedRes.success) {
    return {
      success: false,
      message: (savedRes && savedRes.message) || "Không thể xuất và lưu file Hợp đồng lên Google Drive."
    };
  }
  var nextStatus = typeof PENDING_SALES_SIGN_STATUS_SERVER_ !== "undefined"
    ? PENDING_SALES_SIGN_STATUS_SERVER_
    : "Chờ Sales đưa ký";
  var updates = {
    "Fulfillment_Status": nextStatus
  };
  if (savedRes.contractLink) {
    updates["Contract_Link"] = savedRes.contractLink;
  }
  updateRowByKey_("Order_Master", "Order_ID", cleanOrderId, updates);
  return {
    success: true,
    orderId: cleanOrderId,
    contractLink: savedRes.contractLink || "",
    fulfillmentStatus: nextStatus,
    contractNo: savedRes.contractNo || "",
    fileName: savedRes.fileName || "",
    templateId: savedRes.templateId || "",
    templateUsed: savedRes.templateUsed || ""
  };
}

/**
 * Sales xác nhận Khách hàng đã ký Hợp đồng:
 * - Ghi đè Fulfillment_Status trên Order_Master -> "Mốc 3/6 · 3. Chờ Booking & Đóng hàng"
 * - Cập nhật Inquiry_Quotation -> "Đã lập hợp đồng"
 * - Đồng bộ lại số lượng đơn hàng & phân loại khách hàng trên Consignee_Directory.
 */
function confirmBuyerSignedContract(orderId, staffName) {
  var cleanOrderId = String(orderId || "").trim().replace(/-(?:V|R)\d+$/i, "");
  var orders = readSheetAsObjects_("Order_Master");
  var ord = null;
  for (var i = 0; i < orders.length; i++) {
    if (String(orders[i]["Order_ID"] || "").trim().toUpperCase() === cleanOrderId.toUpperCase()) {
      ord = orders[i];
      break;
    }
  }
  if (!ord) {
    return { success: false, message: "Không tìm thấy hợp đồng cho đơn hàng " + cleanOrderId };
  }

  var todayStr = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");
  var signedStage3Status = SIGNED_STAGE3_6STEP_STATUS_SERVER_;

  var updates = {
    "Fulfillment_Status": signedStage3Status
  };
  if (staffName && !ord["In_Charge_Staff"]) {
    updates["In_Charge_Staff"] = String(staffName).trim();
  }

  updateRowByKey_("Order_Master", "Order_ID", ord["Order_ID"], updates);
  saveOrderLogisticsMetaServer_(ord["Order_ID"], {
    "Exact_Fulfillment_Status": signedStage3Status
  });
  updateRowByKey_("Inquiry_Quotation", "Order_ID", ord["Order_ID"], {
    "Inquiry_Status": "Đã lập hợp đồng"
  });

  recalculateConsigneeStatsServer_(null, true);

  return {
    success: true,
    orderId: String(ord["Order_ID"] || cleanOrderId),
    contractNo: String(ord["Contract_No."] || ""),
    contractLink: String(ord["Contract_Link"] || ""),
    signedDate: todayStr,
    fulfillmentStatus: signedStage3Status
  };
}

function signContractLock(orderId, staffName) {
  return confirmBuyerSignedContract(orderId, staffName);
}

function createContractFromConfirmedOrder(orderId, staffName) {
  var inquiries = readSheetAsObjects_("Inquiry_Quotation");
  var proposals = readSheetAsObjects_("Pricing_Proposal");
  var schedules = readSheetAsObjects_("Shipping_Schedule");
  var consignees = readSheetAsObjects_("Consignee_Directory");
  var orders = readSheetAsObjects_("Order_Master");
  var products = readSheetAsObjects_("Product_Catalog");
  var templates = readSheetAsObjects_("Template_Manager");

  var inq = null;
  for (var i = 0; i < inquiries.length; i++) {
    if (String(inquiries[i]["Order_ID"]).trim() === String(orderId).trim()) {
      inq = inquiries[i];
      break;
    }
  }
  if (!inq) {
    throw new Error("Không tìm thấy yêu cầu báo giá: " + orderId);
  }

  var cleanOrderId = String(orderId || "").trim();
  var existingContract = null;
  for (var o = 0; o < orders.length; o++) {
    if (String(orders[o]["Order_ID"] || "").trim() === cleanOrderId) {
      existingContract = orders[o];
      break;
    }
  }

  var contractObj = buildContractDraftObject_(inq, proposals, schedules, consignees, orders, products, templates, staffName, inq["Customer_Confirm_Note"] || "");
  if (existingContract) {
    contractObj["Contract_No."] = String(existingContract["Contract_No."] || contractObj["Contract_No."]).trim();
    contractObj["Contract_Date"] = String(existingContract["Contract_Date"] || contractObj["Contract_Date"]).trim();
    contractObj["Contract_Link"] = String(existingContract["Contract_Link"] || "").trim();
    updateRowByKey_("Order_Master", "Order_ID", cleanOrderId, contractObj);
    return { success: true, contract: contractObj, alreadyExists: true };
  }

  appendObjectToSheet_("Order_Master", contractObj, ORDER_MASTER_COLUMNS_);

  return { success: true, contract: contractObj };
}

function saveSalesContract(payload, isEdit) {
  var cleanOid = String((payload && payload.Order_ID) || "").trim().replace(/-(?:V|R)\d+$/i, "");
  var resolvedPayloadVal = parseSmartNumber_(payload.Contract_Value !== undefined ? payload.Contract_Value : payload.Contract_Value_USD);
  var cleanCtrNo = String(payload["Contract_No."] || "").trim().replace(/-(?:V|R)\d+$/i, "");
  var exactStatus6 = payload.Fulfillment_Status
    ? translateFulfillmentStatus6StepServer_(payload.Fulfillment_Status)
    : WORKFLOW_6_STAGES_SERVER_[2];
  var contractObj = {
    "Order_ID": cleanOid,
    "Contract_No.": cleanCtrNo,
    "Contract_Date": payload.Contract_Date || Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd"),
    "In_Charge_Staff": payload.In_Charge_Staff || "",
    "Consignee_ID": payload.Consignee_ID || "",
    "SKU_Code": payload.SKU_Code || "",
    "NW_Confirmed_KGs": parseSmartNumber_(payload.NW_Confirmed_KGs),
    "Applied_Incoterm": payload.Applied_Incoterm || "",
    "Contract_Value": resolvedPayloadVal,
    "Payment_Terms": payload.Payment_Terms || "",
    "POL": payload.POL || "",
    "POD": payload.POD || "",
    "Fulfillment_Status": toOrderMasterSafeStatusServer_(exactStatus6),
    "CO_Form": String(payload.CO_Form || "").trim(),
    "Contract_Link": payload.Contract_Link !== undefined ? String(payload.Contract_Link || "").trim() : ""
  };

  var logiPatch = {
    "Booking_Source": payload.Booking_Source,
    "BK_No": payload.BK_No !== undefined ? payload.BK_No : payload.Booking_No,
    "FWD_BK_No": payload.FWD_BK_No !== undefined ? payload.FWD_BK_No : payload.FWD_Booking_No,
    "Carrier_BK_No": payload.Carrier_BK_No !== undefined ? payload.Carrier_BK_No : payload.Carrier_Booking_No,
    "Ves_Voy": payload.Ves_Voy !== undefined ? payload.Ves_Voy : payload.Vessel_Voyage,
    "Cont_Seal_List": payload.Cont_Seal_List !== undefined ? payload.Cont_Seal_List : (payload.Container_Seal_No !== undefined ? payload.Container_Seal_No : payload.Cont_Seal_No),
    "Cargo_Mode": payload.Cargo_Mode,
    "BL_Type": payload.BL_Type,
    "Template_ID": payload.Template_ID,
    "SI_Cutoff": payload.SI_Cutoff,
    "VGM_Cutoff": payload.VGM_Cutoff,
    "CFS_Cutoff": payload.CFS_Cutoff,
    "CY_Cutoff": payload.CY_Cutoff,
    "Customs_Cutoff": payload.Customs_Cutoff,
    "Draft_BL_Cutoff": payload.Draft_BL_Cutoff,
    "Exact_Fulfillment_Status": exactStatus6
  };

  if (cleanOid) {
    var orders = readSheetAsObjects_("Order_Master");
    var matchedExisting = null;
    for (var i = 0; i < orders.length; i++) {
      if (String(orders[i]["Order_ID"] || "").trim().toUpperCase() === cleanOid.toUpperCase()) {
        matchedExisting = orders[i];
        break;
      }
    }
    if (matchedExisting) {
      if (matchedExisting["Contract_No."]) {
        contractObj["Contract_No."] = String(matchedExisting["Contract_No."]).trim().replace(/-(?:V|R)\d+$/i, "");
      }
      if (!payload.Fulfillment_Status && matchedExisting["Fulfillment_Status"]) {
        exactStatus6 = translateFulfillmentStatus6StepServer_(matchedExisting["Fulfillment_Status"]);
        contractObj["Fulfillment_Status"] = toOrderMasterSafeStatusServer_(exactStatus6);
        logiPatch["Exact_Fulfillment_Status"] = exactStatus6;
      }
      if ((payload.Contract_Link === undefined || payload.Contract_Link === "") && matchedExisting["Contract_Link"]) {
        contractObj["Contract_Link"] = String(matchedExisting["Contract_Link"]).trim();
      }
      var stLow = String(matchedExisting["Fulfillment_Status"] || "").toLowerCase();
      var isSignedStage = (
        stLow.indexOf("mốc 3") !== -1 ||
        stLow.indexOf("3.") === 0 || stLow.indexOf("4.") === 0 || stLow.indexOf("5.") === 0 || stLow.indexOf("5b.") === 0 || stLow.indexOf("6.") === 0 ||
        stLow.indexOf("booking") !== -1 || stLow.indexOf("đóng hàng") !== -1 || stLow.indexOf("chứng từ") !== -1 || stLow.indexOf("vận đơn") !== -1 || stLow.indexOf("vận chuyển") !== -1 || stLow.indexOf("thanh toán") !== -1 || stLow.indexOf("hoàn tất") !== -1
      );
      var isLocked = isSignedStage || (matchedExisting["Contract_Locked"] === true || String(matchedExisting["Contract_Locked"] || "").toUpperCase() === "TRUE");
      if (isLocked) {
        var lockedVal = resolveOrderContractValue_(matchedExisting, null);
        contractObj["NW_Confirmed_KGs"] = parseSmartNumber_(matchedExisting["NW_Confirmed_KGs"]);
        contractObj["Contract_Value"] = lockedVal;
        contractObj["Applied_Incoterm"] = String(matchedExisting["Applied_Incoterm"] || contractObj["Applied_Incoterm"]);
        contractObj["Payment_Terms"] = String(matchedExisting["Payment_Terms"] || contractObj["Payment_Terms"]);
      }
      var updated = updateRowByKey_("Order_Master", "Order_ID", matchedExisting["Order_ID"], contractObj);
      if (updated) {
        var savedMeta = saveOrderLogisticsMetaServer_(matchedExisting["Order_ID"], logiPatch);
        recalculateConsigneeStatsServer_(null, true);
        contractObj["Fulfillment_Status"] = exactStatus6;
        return { success: true, data: contractObj, logisticsMeta: savedMeta };
      }
    }
  }

  if (!contractObj["Contract_No."]) {
    contractObj["Contract_No."] = generateNextContractNo_(readSheetAsObjects_("Order_Master"));
  }
  appendObjectToSheet_("Order_Master", contractObj, ORDER_MASTER_COLUMNS_);
  var createdMeta = saveOrderLogisticsMetaServer_(cleanOid, logiPatch);
  recalculateConsigneeStatsServer_(null, true);
  contractObj["Fulfillment_Status"] = exactStatus6;
  return { success: true, data: contractObj, logisticsMeta: createdMeta };
}

function updateContractFulfillment(orderId, newStatus) {
  var canonical6 = translateFulfillmentStatus6StepServer_(newStatus);
  var safeSheetStatus = toOrderMasterSafeStatusServer_(canonical6);
  var updated = updateRowByKey_("Order_Master", "Order_ID", orderId, {
    "Fulfillment_Status": safeSheetStatus
  });
  saveOrderLogisticsMetaServer_(orderId, {
    "Exact_Fulfillment_Status": canonical6
  });
  if (updated) {
    recalculateConsigneeStatsServer_(null, true);
  }
  return { success: updated, fulfillmentStatus: canonical6 };
}
