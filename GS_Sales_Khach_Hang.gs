/**
 * ============================================================================
 * HỆ THỐNG QUẢN LÝ XUẤT KHẨU NÔNG SẢN - NÔNG SẢN XANH
 * File: GS_Sales_Khach_Hang.gs (RFQ, Báo giá, Khách hàng & Danh mục Sản phẩm)
 * ============================================================================
 */

/**
 * ============================================================================
 * 2.1. TIẾP NHẬN YÊU CẦU + GỘP KHÁCH HÀNG + ĐA SẢN PHẨM + CHỐNG TRÙNG LẶP
 * ============================================================================
 */
function generateNextOrderId_() {
  var inquiries = readSheetAsObjects_("Inquiry_Quotation");
  var yearStr = Utilities.formatDate(new Date(), TIMEZONE, "yyyy");
  var maxNum = 0;
  for (var i = 0; i < inquiries.length; i++) {
    var oid = String(inquiries[i]["Order_ID"] || "");
    var match = oid.match(/ORD-(?:\d{4}-)?(\d+)/i);
    if (match) {
      var num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }
  return "ORD-" + yearStr + "-" + ("000" + (maxNum + 1)).slice(-3);
}

function generateNextConsigneeId_(consignees) {
  var maxNum = 0;
  for (var i = 0; i < consignees.length; i++) {
    var cid = String(consignees[i]["Consignee_ID"] || "");
    var m = cid.match(/(?:KH|CUS|CNE)-(\d+)/i);
    if (m) {
      var n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  return "KH-" + ("000" + (maxNum + 1)).slice(-3);
}

function generateNextQuotationNo_(proposals, orderId, quoteRound) {
  var cleanOid = String(orderId || "").trim().replace(/-(?:V|R)\d+$/i, "");
  var curRound = Math.max(parseInt(quoteRound || 1, 10) || 1, 1);
  return {
    versionLabel: "",
    quotationNo: cleanOid ? ("QT-" + cleanOid) : "",
    quoteRound: curRound
  };
}

function normalizeCustomerKeyServer_(val) {
  return String(val || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeTaxKeyServer_(val) {
  return String(val || "").replace(/\s+/g, "").trim().toLowerCase();
}

function upsertInquiryCustomer_(custPayload, proposedPayment) {
  var consignees = readSheetAsObjects_("Consignee_Directory");
  var inputId = String(custPayload.Consignee_ID || "").trim();
  var inputName = normalizeCustomerKeyServer_(custPayload.Consignee_Name);
  var inputEmail = normalizeCustomerKeyServer_(custPayload.Email);
  var inputTax = normalizeTaxKeyServer_(custPayload.Tax || custPayload.Tax_ID);

  var existing = null;
  for (var i = 0; i < consignees.length; i++) {
    var c = consignees[i];
    var cId = String(c["Consignee_ID"] || "").trim();
    var cName = normalizeCustomerKeyServer_(c["Consignee_Name"]);
    var cEmail = normalizeCustomerKeyServer_(c["Email"]);
    var cTax = normalizeTaxKeyServer_(c["Tax"] || c["Tax_ID"]);

    if (inputId && cId.toLowerCase() === inputId.toLowerCase()) {
      var matchesByField = (!inputName || cName === inputName) ||
        (inputEmail && cEmail && cEmail === inputEmail) ||
        (inputTax && cTax && cTax === inputTax);
      if (matchesByField) {
        existing = c;
        break;
      }
    }
    if (inputTax && cTax && cTax === inputTax) {
      existing = c;
      break;
    }
    if (inputEmail && cEmail && cEmail === inputEmail) {
      existing = c;
      break;
    }
    if (inputName && cName && cName === inputName) {
      existing = c;
      break;
    }
  }

  if (existing) {
    var existingId = existing["Consignee_ID"];
    var existingTaxVal = String(custPayload.Tax || custPayload.Tax_ID || "").trim();
    var existingUpdates = {};
    var cleanCustName = String(custPayload.Consignee_Name || "").replace(/\s+/g, " ").trim();
    var cleanCountry = String(custPayload.Country || "").trim();
    var cleanAddr = String(custPayload.Address || "").trim();
    var cleanContact = String(custPayload.Contact_Person || "").trim();
    var cleanPhone = String(custPayload.Phone || "").trim();
    var cleanEmail = String(custPayload.Email || "").trim();
    var cleanFax = String(custPayload.Fax || "").trim();
    var cleanPay = String(proposedPayment || "").trim();
    if (cleanCustName) existingUpdates["Consignee_Name"] = cleanCustName;
    if (cleanCountry) existingUpdates["Country"] = cleanCountry;
    if (cleanAddr) existingUpdates["Address"] = cleanAddr;
    if (existingTaxVal) {
      existingUpdates["Tax"] = existingTaxVal;
      existingUpdates["Tax_ID"] = existingTaxVal;
    }
    if (cleanContact) existingUpdates["Contact_Person"] = cleanContact;
    if (cleanPhone) existingUpdates["Phone"] = cleanPhone;
    if (cleanEmail) existingUpdates["Email"] = cleanEmail;
    if (cleanFax) existingUpdates["Fax"] = cleanFax;
    if (cleanPay) {
      existingUpdates["Điều khoản thanh toán mặc định"] = cleanPay;
      existingUpdates["Payment_Terms"] = cleanPay;
    }
    if (Object.keys(existingUpdates).length > 0) {
      updateRowByKey_("Consignee_Directory", "Consignee_ID", existingId, existingUpdates);
    }
    return existingId;
  }

  var newId = generateNextConsigneeId_(consignees);
  var todayStr = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");
  var taxVal = String(custPayload.Tax || custPayload.Tax_ID || "").trim();
  var rowObj = {
    "Consignee_ID": newId,
    "Consignee_Name": String(custPayload.Consignee_Name || "").replace(/\s+/g, " ").trim(),
    "Country": String(custPayload.Country || "").trim(),
    "Address": String(custPayload.Address || "").trim(),
    "Tax": taxVal,
    "Tax_ID": taxVal,
    "Contact_Person": String(custPayload.Contact_Person || "").trim(),
    "Phone": String(custPayload.Phone || "").trim(),
    "Email": String(custPayload.Email || "").trim(),
    "Fax": String(custPayload.Fax || "").trim(),
    "Điều khoản thanh toán mặc định": proposedPayment || "",
    "Customer_Type": "Khách hàng tiềm năng",
    "Số lượng đơn hàng": 0,
    "Order_Count": 0,
    "Ngày tạo": todayStr
  };

  var defaultHeaders = [
    "Consignee_ID", "Consignee_Name", "Country", "Address", "Tax",
    "Contact_Person", "Phone", "Email", "Fax",
    "Điều khoản thanh toán mặc định", "Customer_Type", "Số lượng đơn hàng", "Ngày tạo"
  ];
  appendObjectToSheet_("Consignee_Directory", rowObj, defaultHeaders);
  return newId;
}

function classifyCustomerTypeByCompletedCountServer_(orderCount) {
  var cnt = Math.max(0, Number(orderCount || 0));
  if (cnt <= 0) return "Khách hàng tiềm năng";
  if (cnt === 1) return "Khách hàng mới";
  return "Khách hàng cũ";
}

function incrementConsigneeOrderCountServer_(consigneeId, ssOpt) {
  var targetId = String(consigneeId || "").trim().toUpperCase();
  if (!targetId) return 0;
  var ss = ssOpt || getSS_();
  var sheet = ss.getSheetByName("Consignee_Directory");
  if (!sheet) return 0;
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return 0;

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var idIdx = findHeaderIndex_(headers, ["Consignee_ID"]);
  var countIdx = findHeaderIndex_(headers, ["Số lượng đơn hàng"]);
  var orderCountIdx = findHeaderIndex_(headers, ["Order_Count"]);
  var typeIdx = findHeaderIndex_(headers, ["Customer_Type"]);
  if (idIdx === -1) return 0;

  for (var r = 1; r < values.length; r++) {
    var rowCid = String(values[r][idIdx] || "").trim().toUpperCase();
    if (rowCid !== targetId) continue;
    var rawCur = (countIdx !== -1 && values[r][countIdx] !== "" && values[r][countIdx] !== null)
      ? values[r][countIdx]
      : (orderCountIdx !== -1 ? values[r][orderCountIdx] : 0);
    var nextCnt = Math.max(0, parseSmartNumber_(rawCur)) + 1;
    var nextType = classifyCustomerTypeByCompletedCountServer_(nextCnt);
    if (countIdx !== -1) sheet.getRange(r + 1, countIdx + 1).setValue(nextCnt);
    if (orderCountIdx !== -1 && orderCountIdx !== countIdx) sheet.getRange(r + 1, orderCountIdx + 1).setValue(nextCnt);
    if (typeIdx !== -1) sheet.getRange(r + 1, typeIdx + 1).setValue(nextType);
    return nextCnt;
  }
  return 0;
}

function recalculateConsigneeStatsServer_(ssOpt, writeBackSheet, ordersOpt, consigneesOpt) {
  var ss = ssOpt || getSS_();
  var orders = ordersOpt || readSheetAsObjects_("Order_Master", ss);
  var inquiries = readSheetAsObjects_("Inquiry_Quotation", ss);
  var consignees = consigneesOpt || readSheetAsObjects_("Consignee_Directory", ss);

  var seenOrderIds = {};
  var countedByCid = {};

  for (var qi = 0; qi < (inquiries || []).length; qi++) {
    var inq = inquiries[qi];
    if (!inq) continue;
    var qSt = String(inq["Inquiry_Status"] || "").trim().toLowerCase();
    if (qSt.indexOf("hủy") !== -1 || qSt.indexOf("cancel") !== -1) continue;
    var qCid = String(inq["Consignee_ID"] || "").trim().toUpperCase();
    var qOid = String(inq["Order_ID"] || "").trim().toUpperCase();
    if (qOid) seenOrderIds[qOid] = true;
    if (qCid) countedByCid[qCid] = (countedByCid[qCid] || 0) + 1;
  }

  for (var i = 0; i < (orders || []).length; i++) {
    var o = orders[i];
    if (!o) continue;
    var oOid = String(o["Order_ID"] || "").trim().toUpperCase();
    if (oOid && seenOrderIds[oOid]) continue;
    var oSt = String(o["Fulfillment_Status"] || "").trim().toLowerCase();
    if (oSt.indexOf("hủy") !== -1 || oSt.indexOf("cancel") !== -1) continue;
    var cidKey = String(o["Consignee_ID"] || "").trim().toUpperCase();
    if (!cidKey) continue;
    countedByCid[cidKey] = (countedByCid[cidKey] || 0) + 1;
  }

  // Bảo toàn số lượng đơn hàng gốc (baseline) trên Consignee_Directory — tuyệt đối không ghi đè về 0 khi bảng đơn trống
  var updatedConsignees = (consignees || []).map(function (c) {
    var cidKey = String(c["Consignee_ID"] || "").trim().toUpperCase();
    var rawExisting = (c["Số lượng đơn hàng"] !== undefined && c["Số lượng đơn hàng"] !== "")
      ? c["Số lượng đơn hàng"]
      : (c["Order_Count"] !== undefined && c["Order_Count"] !== "" ? c["Order_Count"] : 0);
    var baselineCnt = Math.max(0, parseSmartNumber_(rawExisting));
    var sheetCnt = cidKey ? (countedByCid[cidKey] || 0) : 0;
    var effectiveCnt = Math.max(baselineCnt, sheetCnt);
    var nextType = classifyCustomerTypeByCompletedCountServer_(effectiveCnt);
    var copy = Object.assign({}, c);
    copy["Số lượng đơn hàng"] = effectiveCnt;
    copy["Order_Count"] = effectiveCnt;
    copy["Customer_Type"] = nextType;
    return copy;
  });

  if (writeBackSheet) {
    var sheet = ss.getSheetByName("Consignee_Directory");
    if (sheet) {
      var lastRow = sheet.getLastRow();
      var lastCol = sheet.getLastColumn();
      if (lastRow >= 2 && lastCol >= 1) {
        var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
        var headers = values[0].map(function (h) { return String(h).trim(); });
        var idIdx = findHeaderIndex_(headers, ["Consignee_ID"]);
        var countIdx = findHeaderIndex_(headers, ["Số lượng đơn hàng"]);
        var orderCountIdx = findHeaderIndex_(headers, ["Order_Count"]);
        var typeIdx = findHeaderIndex_(headers, ["Customer_Type"]);
        if (idIdx !== -1) {
          for (var r = 1; r < values.length; r++) {
            var rowCid = String(values[r][idIdx] || "").trim().toUpperCase();
            if (!rowCid) continue;
            var curRaw = (countIdx !== -1 && values[r][countIdx] !== "" && values[r][countIdx] !== null)
              ? values[r][countIdx]
              : (orderCountIdx !== -1 ? values[r][orderCountIdx] : 0);
            var baselineVal = Math.max(0, parseSmartNumber_(curRaw));
            var cnt = Math.max(baselineVal, countedByCid[rowCid] || 0);
            var nextType = classifyCustomerTypeByCompletedCountServer_(cnt);
            if (countIdx !== -1 && Number(values[r][countIdx] || 0) !== cnt) {
              sheet.getRange(r + 1, countIdx + 1).setValue(cnt);
            }
            if (orderCountIdx !== -1 && orderCountIdx !== countIdx && Number(values[r][orderCountIdx] || 0) !== cnt) {
              sheet.getRange(r + 1, orderCountIdx + 1).setValue(cnt);
            }
            if (typeIdx !== -1 && String(values[r][typeIdx] || "").trim() !== nextType) {
              sheet.getRange(r + 1, typeIdx + 1).setValue(nextType);
            }
          }
        }
      }
    }
  }

  return updatedConsignees;
}

function buildSerializedItemsTag_(items) {
  var serialized = [];
  for (var i = 0; i < (items || []).length; i++) {
    var it = items[i];
    var w = parseSmartNumber_(it.weight);
    var pCode = String(it.packingCode || "").replace(/[|;\[\]]/g, " ").trim();
    var pName = String(it.packingName || "").replace(/[|;\[\]]/g, " ").trim();
    var pExtra = parseSmartNumber_(it.packingExtra || 0);
    var plt = String(it.palletCode || "PKG-PLT-NO").replace(/[|;\[\]]/g, " ").trim();
    var ctn = parseSmartNumber_(it.cartons || 0);
    var pls = parseSmartNumber_(it.pallets || 0);
    var pkCost = parseSmartNumber_(it.packingCost || 0);
    serialized.push(
      (it.sku || "") + "|" + (it.name || "") + "|" + w + "|" +
      pCode + "|" + pName + "|" + pExtra + "|" +
      plt + "|" + ctn + "|" + pls + "|" + pkCost
    );
  }
  return "[ITEMS:" + serialized.join(";") + "]";
}

function serializeOrderItemsTextServer_(items) {
  var lines = [];
  for (var i = 0; i < (items || []).length; i++) {
    var it = items[i] || {};
    var sku = String(it.sku || it.SKU_Code || "").trim();
    if (!sku) continue;
    var w = Math.round(parseSmartNumber_(it.weight || it.Net_Weight_KGs || 0));
    var pCode = String(it.packingCode || "").trim();
    lines.push(sku + ":" + w + ":" + pCode);
  }
  return lines.join("\n");
}

function createInquiry(payload) {
  var proposedPayment = payload["Phương thức thanh toán đề xuất"] || "";
  var consigneeId = upsertInquiryCustomer_(payload.customer || payload, proposedPayment);
  var existingOid = String(payload.Existing_Order_ID || payload.existingOrderId || "").trim();
  var isConvertingExisting = false;
  var existingRow = null;
  if (existingOid) {
    var curInqs = readSheetAsObjects_("Inquiry_Quotation");
    for (var ei = 0; ei < curInqs.length; ei++) {
      if (String(curInqs[ei]["Order_ID"] || "").trim().toUpperCase() === existingOid.toUpperCase()) {
        existingRow = curInqs[ei];
        isConvertingExisting = true;
        break;
      }
    }
  }
  var orderId = isConvertingExisting ? String(existingRow["Order_ID"]).trim() : generateNextOrderId_();
  var nowStr = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd HH:mm");

  var items = payload.items || [];
  if (items.length === 0 && payload["Mã sản phẩm"]) {
    items = [{
      sku: payload["Mã sản phẩm"],
      name: payload["Tên sản phẩm"] || "",
      weight: parseSmartNumber_(payload.Net_Weight_KGs),
      packingCode: payload.Packing_Code || "",
      packingName: payload.Packing_Name || "",
      packingExtra: parseSmartNumber_(payload.Packing_Extra || 0),
      palletCode: payload.Pallet_Code || "PKG-PLT-NO",
      cartons: parseSmartNumber_(payload.Cartons || 0),
      pallets: parseSmartNumber_(payload.Pallets || 0),
      packingCost: parseSmartNumber_(payload.Packing_Cost || 0)
    }];
  }

  var products = readSheetAsObjects_("Product_Catalog");
  var skuList = [];
  var nameList = [];
  var totalWeight = 0;

  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var w = parseSmartNumber_(it.weight);
    var pName = String(it.packingName || "").replace(/[|;\[\]]/g, " ").trim();
    var prodName = String(it.name || "").trim();
    if (!prodName && it.sku) {
      for (var pr = 0; pr < products.length; pr++) {
        var pSku = String(getFieldFuzzy_(products[pr], ["SKU_Code", "Mã sản phẩm", "SKU"], ["sku", "mã sản phẩm"])).trim();
        if (pSku.toLowerCase() === String(it.sku).trim().toLowerCase()) {
          prodName = String(getFieldFuzzy_(products[pr], ["Product_Name_VIE", "Tên sản phẩm", "Product_Name"], ["tên sản phẩm", "product_name_vie"])).trim();
          it.name = prodName;
          break;
        }
      }
    }
    totalWeight += w;
    if (it.sku) skuList.push(it.sku);
    nameList.push((prodName || it.sku) + " (" + w + " KG" + (pName ? " · " + pName : "") + ")");
  }

  var userNote = String(payload.Note || "").replace(/\s*\[ITEMS:[^\]]+\]/g, "").trim();
  var podVal = String(payload.POD || (payload.customer && payload.customer.POD) || "").trim();
  if (podVal && userNote.toLowerCase().indexOf("pod:") === -1) {
    userNote = userNote ? (userNote + " | POD: " + podVal) : ("POD: " + podVal);
  }
  var orderItemsText = serializeOrderItemsTextServer_(items);
  var quickProdSummary = String(payload.Quick_Product_Summary || payload["Tên sản phẩm"] || "").trim();
  var finalProdNames = nameList.length > 0 ? nameList.join("; ") : quickProdSummary;
  var finalTotalWeight = totalWeight > 0 ? totalWeight : parseSmartNumber_(payload.Net_Weight_KGs || 0);

  var usePalletBool = (payload.Use_Pallet === true || String(payload.Use_Pallet || "").toUpperCase() === "TRUE");

  var cust = payload.customer || payload;
  var resolvedAddr = String(cust.Address || "").trim();
  if (!resolvedAddr) {
    resolvedAddr = [podVal, String(cust.Country || "").trim()].filter(Boolean).join(", ");
  }
  var rowObj = {
    "Order_ID": orderId,
    "Timestamp": isConvertingExisting ? (existingRow["Timestamp"] || nowStr) : nowStr,
    "Sale_rep": payload.Sale_rep || (existingRow && existingRow["Sale_rep"]) || "",
    "Consignee_ID": consigneeId,
    "Address": resolvedAddr,
    "POD": podVal,
    "Contact": cust.Contact_Person || cust.Contact || "",
    "Email": cust.Email || "",
    "Phone": cust.Phone || "",
    "Mã sản phẩm": skuList.join(", "),
    "SKU_Code": skuList.join(", "),
    "Tên sản phẩm": finalProdNames,
    "Net_Weight_KGs": finalTotalWeight,
    "Order_Items": orderItemsText,
    "Quotation_Mode": payload.Quotation_Mode || "SINGLE",
    "Use_Pallet": usePalletBool,
    "Thời gian giao hàng mong muốn": payload["Thời gian giao hàng mong muốn"] || "",
    "Incoterm mong muốn": payload["Incoterm mong muốn"] || "",
    "Phương thức thanh toán đề xuất": proposedPayment,
    "Inquiry_Status": payload.Inquiry_Status || "Mới tạo / Chờ tính giá",
    "Note": userNote
  };

  var defaultHeaders = [
    "Order_ID", "Timestamp", "Sale_rep", "Consignee_ID", "Address",
    "Contact", "Email", "Phone", "Mã sản phẩm", "Tên sản phẩm",
    "Net_Weight_KGs", "Order_Items", "Quotation_Mode", "Use_Pallet",
    "Thời gian giao hàng mong muốn", "Incoterm mong muốn",
    "Phương thức thanh toán đề xuất", "Inquiry_Status", "Note"
  ];

  if (isConvertingExisting) {
    var prevCid = String(existingRow["Consignee_ID"] || "").trim();
    updateRowByKey_("Inquiry_Quotation", "Order_ID", orderId, rowObj);
    var updatedCount = null;
    if (prevCid && consigneeId && prevCid.toUpperCase() !== consigneeId.toUpperCase()) {
      decrementOrCleanupConsigneeServer_(prevCid, orderId);
      updatedCount = incrementConsigneeOrderCountServer_(consigneeId);
    }
    return { success: true, data: rowObj, convertedFromQuick: true, consigneeOrderCount: updatedCount };
  }

  appendObjectToSheet_("Inquiry_Quotation", rowObj, defaultHeaders);

  // Cộng +1 số lượng đơn hàng cho khách hàng & tự động phân loại (0: Tiềm năng, 1: Mới, >=2: Cũ)
  var newOrderCount = incrementConsigneeOrderCountServer_(consigneeId);
  return { success: true, data: rowObj, consigneeOrderCount: newOrderCount };
}

function updateInquiryStatus(orderId, newStatus) {
  var updated = updateRowByKey_("Inquiry_Quotation", "Order_ID", orderId, {
    "Inquiry_Status": newStatus
  });
  return { success: updated };
}

/**
 * Giảm 1 đơn hàng của khách hàng trên Consignee_Directory sau khi xóa/hủy đơn trước ký HĐ.
 * Nếu khách hàng là khách tiềm năng 0 đơn (không còn đơn/yêu cầu nào khác), xóa luôn dòng khách hàng đó.
 */
function decrementOrCleanupConsigneeServer_(consigneeId, deletedOrderId) {
  var cid = String(consigneeId || "").trim();
  if (!cid) return { customerDeleted: false, newOrderCount: 0 };
  var ss = getSS_();
  var sheet = ss.getSheetByName("Consignee_Directory");
  if (!sheet) return { customerDeleted: false, newOrderCount: 0 };
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return { customerDeleted: false, newOrderCount: 0 };

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var idIdx = findHeaderIndex_(headers, ["Consignee_ID"]);
  var countIdx = findHeaderIndex_(headers, ["Số lượng đơn hàng"]);
  var orderCountIdx = findHeaderIndex_(headers, ["Order_Count"]);
  var typeIdx = findHeaderIndex_(headers, ["Customer_Type"]);
  if (idIdx === -1) return { customerDeleted: false, newOrderCount: 0 };

  var normCid = cid.toUpperCase();
  var targetRowIdx = -1;
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][idIdx] || "").trim().toUpperCase() === normCid) {
      targetRowIdx = r;
      break;
    }
  }
  if (targetRowIdx === -1) return { customerDeleted: false, newOrderCount: 0 };

  var curRaw = (countIdx !== -1 && values[targetRowIdx][countIdx] !== "" && values[targetRowIdx][countIdx] !== null)
    ? values[targetRowIdx][countIdx]
    : (orderCountIdx !== -1 ? values[targetRowIdx][orderCountIdx] : 0);
  var curCount = Math.max(0, parseSmartNumber_(curRaw));
  var curTypeLow = typeIdx !== -1 ? String(values[targetRowIdx][typeIdx] || "").trim().toLowerCase() : "";

  var normDeletedOid = String(deletedOrderId || "").trim().toUpperCase();
  var remainingInqs = readSheetAsObjects_("Inquiry_Quotation").filter(function (row) {
    var rCid = String(row["Consignee_ID"] || "").trim().toUpperCase();
    var rOid = String(row["Order_ID"] || "").trim().toUpperCase();
    return rCid === normCid && (!normDeletedOid || rOid !== normDeletedOid);
  });
  var remainingOrders = readSheetAsObjects_("Order_Master").filter(function (row) {
    var rCid = String(row["Consignee_ID"] || "").trim().toUpperCase();
    var rOid = String(row["Order_ID"] || "").trim().toUpperCase();
    return rCid === normCid && (!normDeletedOid || rOid !== normDeletedOid);
  });

  var nextCount = Math.max(0, curCount - 1);
  var isZeroOrderProspect = (nextCount <= 0 && remainingInqs.length === 0 && remainingOrders.length === 0) ||
    (curCount <= 0 && curTypeLow.indexOf("tiềm năng") !== -1 && remainingInqs.length === 0 && remainingOrders.length === 0);

  if (isZeroOrderProspect) {
    sheet.deleteRow(targetRowIdx + 1);
    return { customerDeleted: true, newOrderCount: 0 };
  }

  var nextType = classifyCustomerTypeByCompletedCountServer_(nextCount);
  if (countIdx !== -1) {
    sheet.getRange(targetRowIdx + 1, countIdx + 1).setValue(nextCount);
  }
  if (orderCountIdx !== -1 && orderCountIdx !== countIdx) {
    sheet.getRange(targetRowIdx + 1, orderCountIdx + 1).setValue(nextCount);
  }
  if (typeIdx !== -1) {
    sheet.getRange(targetRowIdx + 1, typeIdx + 1).setValue(nextType);
  }
  return { customerDeleted: false, newOrderCount: nextCount };
}

/**
 * Xóa vĩnh viễn yêu cầu/báo giá trước khi ký Hợp đồng:
 * - Chặn xóa nếu đơn hàng đã có Hợp đồng đã ký (từ Bước 3 trở đi).
 * - Xóa vĩnh viễn khỏi Inquiry_Quotation & tất cả dòng liên quan trong Pricing_Proposal (và bản nháp chưa ký trong Order_Master nếu có).
 * - Giảm 1 đơn hàng trên Consignee_Directory hoặc xóa luôn khách hàng nếu là khách tiềm năng 0 đơn.
 */
function deletePreContractInquiry(orderId) {
  var cleanOid = String(orderId || "").trim();
  if (!cleanOid) {
    return { success: false, message: "Thiếu mã đơn hàng cần xóa." };
  }
  var normOid = cleanOid.toUpperCase();

  var orders = readSheetAsObjects_("Order_Master");
  var matchedOrder = null;
  for (var o = 0; o < orders.length; o++) {
    if (String(orders[o]["Order_ID"] || "").trim().toUpperCase() === normOid) {
      matchedOrder = orders[o];
      break;
    }
  }
  if (matchedOrder) {
    var stLow = String(matchedOrder["Fulfillment_Status"] || "").trim().toLowerCase();
    var isSigned = (
      stLow.indexOf("mốc 3") !== -1 ||
      stLow.indexOf("3.") === 0 || stLow.indexOf("4.") === 0 ||
      stLow.indexOf("5.") === 0 || stLow.indexOf("5b.") === 0 ||
      stLow.indexOf("6.") === 0 || stLow.indexOf("7.") === 0 ||
      stLow.indexOf("booking") !== -1 || stLow.indexOf("đóng hàng") !== -1 || stLow.indexOf("đóng cont") !== -1 ||
      stLow.indexOf("chứng từ") !== -1 || stLow.indexOf("vận chuyển") !== -1 || stLow.indexOf("on board") !== -1 ||
      stLow.indexOf("vận đơn") !== -1 || stLow.indexOf("thanh toán") !== -1 || stLow.indexOf("hoàn tất") !== -1 ||
      matchedOrder["Contract_Locked"] === true || String(matchedOrder["Contract_Locked"] || "").toUpperCase() === "TRUE"
    );
    if (isSigned) {
      return {
        success: false,
        message: "Đơn hàng " + cleanOid + " đã ký Hợp đồng Ngoại thương, không thể xóa."
      };
    }
  }

  var consigneeId = "";
  var inquiries = readSheetAsObjects_("Inquiry_Quotation");
  for (var i = 0; i < inquiries.length; i++) {
    if (String(inquiries[i]["Order_ID"] || "").trim().toUpperCase() === normOid) {
      consigneeId = String(inquiries[i]["Consignee_ID"] || "").trim();
      break;
    }
  }
  if (!consigneeId && matchedOrder) {
    consigneeId = String(matchedOrder["Consignee_ID"] || "").trim();
  }

  var deletedInq = false;
  var guardInq = 0;
  while (guardInq < 20 && deleteRowByKey_("Inquiry_Quotation", ["Order_ID", "Order ID"], cleanOid)) {
    deletedInq = true;
    guardInq++;
  }

  var deletedPropsCount = 0;
  var guardProp = 0;
  while (guardProp < 30 && deleteRowByKey_("Pricing_Proposal", ["Order ID", "Order_ID"], cleanOid)) {
    deletedPropsCount++;
    guardProp++;
  }

  var deletedDraftOrder = false;
  if (matchedOrder) {
    deletedDraftOrder = deleteRowByKey_("Order_Master", ["Order_ID", "Order ID"], cleanOid);
  }

  try {
    PropertiesService.getScriptProperties().deleteProperty("NSX_LOGI_" + normOid);
  } catch (propDelErr) {}

  var cneResult = decrementOrCleanupConsigneeServer_(consigneeId, cleanOid);

  var anyDeleted = deletedInq || deletedPropsCount > 0 || deletedDraftOrder;
  var msg = anyDeleted
    ? ("Đã xóa vĩnh viễn hồ sơ " + cleanOid + (cneResult.customerDeleted ? " và xóa khách hàng tiềm năng 0 đơn." : " và cập nhật lại số lượng đơn hàng của khách."))
    : ("Không tìm thấy hồ sơ " + cleanOid + " để xóa.");

  return {
    success: anyDeleted,
    message: msg,
    orderId: cleanOid,
    consigneeId: consigneeId,
    deletedInquiry: deletedInq,
    deletedProposals: deletedPropsCount,
    deletedDraftOrder: deletedDraftOrder,
    customerDeleted: cneResult.customerDeleted,
    newOrderCount: cneResult.newOrderCount
  };
}

function requestRepriceInquiry(orderId, note, reasons) {
  var cleanOrderId = String(orderId || "").trim();
  var proposals = readSheetAsObjects_("Pricing_Proposal");
  var maxPropRound = 1;
  for (var p = 0; p < proposals.length; p++) {
    var pOid = String(proposals[p]["Order ID"] || proposals[p]["Order_ID"] || "").trim();
    if (pOid === cleanOrderId) {
      var rVal = parseInt(proposals[p]["Quote_Round"] || 1, 10) || 1;
      if (rVal > maxPropRound) maxPropRound = rVal;
    }
  }

  var inquiries = readSheetAsObjects_("Inquiry_Quotation");
  var existingNote = "";
  var curInqRound = 1;
  for (var i = 0; i < inquiries.length; i++) {
    if (String(inquiries[i]["Order_ID"] || "").trim() === cleanOrderId) {
      existingNote = String(inquiries[i]["Note"] || "").replace(/\s*\[ITEMS:[^\]]+\]/g, "").trim();
      curInqRound = parseInt(inquiries[i]["Quote_Round"] || 1, 10) || 1;
      break;
    }
  }
  var nextRound = Math.max(2, Math.max(curInqRound, maxPropRound) + 1);
  var reasonsArr = Array.isArray(reasons)
    ? reasons.map(function (x) { return String(x || "").trim(); }).filter(Boolean)
    : (reasons ? String(reasons).split(/[,;|]+/).map(function (x) { return String(x || "").trim(); }).filter(Boolean) : []);
  var reasonsStr = reasonsArr.join("; ");
  var nextStatus = "Chờ báo giá lại (Lần " + nextRound + ")";

  var cleanInputNote = String(note || "").replace(/\s*\[ITEMS:[^\]]+\]/g, "").trim();
  var inqUpdates = {
    "Inquiry_Status": nextStatus,
    "Quote_Round": nextRound,
    "Reprice_Reasons": reasonsStr
  };
  if (cleanInputNote) {
    inqUpdates["Note"] = cleanInputNote;
  } else {
    inqUpdates["Note"] = existingNote;
  }

  var updated = updateRowByKey_("Inquiry_Quotation", "Order_ID", cleanOrderId, inqUpdates);
  return {
    success: updated,
    quoteRound: nextRound,
    inquiryStatus: nextStatus,
    repriceReasons: reasonsStr
  };
}

function enrichParsedOrderItemsServer_(rawItems, productsOpt, pricingRatesOpt, lookupsOpt) {
  var products = productsOpt || [];
  var pricingRates = enrichPricingRatesWithDefaultsServer_(pricingRatesOpt || []);
  var lookups = lookupsOpt || [];
  return (rawItems || []).map(function (it) {
    var sku = String(it.sku || it.SKU_Code || "").trim();
    var prod = null;
    for (var pr = 0; pr < products.length; pr++) {
      var pSku = String(getFieldFuzzy_(products[pr], ["SKU_Code", "Mã sản phẩm", "SKU", "Product_ID"], ["sku", "mã sản phẩm", "mã hàng"])).trim();
      if (pSku && pSku.toLowerCase() === sku.toLowerCase()) {
        prod = products[pr];
        break;
      }
    }
    var pCode = String(it.packingCode || "").trim().toUpperCase();
    if (pCode === "PKG-POUCH-1K") pCode = "PKG-VAC-1K";
    var rateRow = null;
    if (pCode) {
      for (var rr = 0; rr < pricingRates.length; rr++) {
        var rCat = String(pricingRates[rr]["Fee_Category"] || pricingRates[rr]["Category"] || "").trim().toUpperCase();
        if (rCat === "PACKING" && String(pricingRates[rr]["Fee_Code"] || "").trim().toUpperCase() === pCode) {
          rateRow = pricingRates[rr];
          break;
        }
      }
    }
    var lookupRow = pCode ? findSystemLookup_(lookups, "PACKING", pCode) : null;
    if (!lookupRow && it.packingName) {
      lookupRow = findSystemLookup_(lookups, "PACKING", it.packingName);
    }

    var resolvedName = String(it.name || it.Product_Name_VIE || "").trim();
    if ((!resolvedName || resolvedName === "-" || resolvedName.toLowerCase() === sku.toLowerCase()) && prod) {
      resolvedName = String(getFieldFuzzy_(prod, ["Product_Name_VIE", "Tên sản phẩm", "Product_Name"], ["tên sản phẩm", "product_name_vie"]) || sku).trim();
    }
    if (!resolvedName || resolvedName === "-") resolvedName = sku || "-";

    var resolvedEng = String(it.nameEng || it.Product_Name_ENG || "").trim();
    if (!resolvedEng && prod) {
      resolvedEng = String(getFieldFuzzy_(prod, ["Product_Name_ENG", "Item_Name_ENG", "English_Name", "Tên tiếng Anh"], ["product_name_eng", "item_name_eng", "english"]) || "").trim();
    }

    var resolvedPackName = String(it.packingName || "").trim();
    if (!resolvedPackName && rateRow) {
      resolvedPackName = String(rateRow["Fee_Name_VIE"] || rateRow["Spec_Description"] || pCode).trim();
    }
    if (!resolvedPackName && lookupRow) {
      resolvedPackName = String(lookupRow["Display_Name_VIE"] || lookupRow["Contract_Text_ENG"] || pCode).trim();
    }
    if (!resolvedPackName) resolvedPackName = pCode;

    var resolvedExtra = parseSmartNumber_(it.packingExtra || 0);
    if (!resolvedExtra && lookupRow) {
      resolvedExtra = parseSmartNumber_(lookupRow["Extra_Value"] || 0);
    }

    var w = parseSmartNumber_(it.weight || it.Net_Weight_KGs || 0);
    var spec = resolvePackingSpecServer_(pCode, pricingRates);
    var cartons = parseSmartNumber_(it.cartons || 0);
    if (!cartons && w > 0) {
      cartons = Math.ceil(w / Math.max(0.1, spec.netKgPerCarton));
    }
    var packingCost = parseSmartNumber_(it.packingCost || 0);
    if (!packingCost && cartons > 0 && spec.rate > 0) {
      packingCost = Number((cartons * spec.rate).toFixed(2));
    }
    var palletCode = String(it.palletCode || "PKG-PLT-NO").trim();
    var pallets = parseSmartNumber_(it.pallets || 0);
    if (!pallets && palletCode.toUpperCase() === "PKG-PLT-YES" && cartons > 0 && spec.maxPerPallet > 0) {
      pallets = Math.ceil(cartons / spec.maxPerPallet);
    }
    var pltYes = resolvePackingSpecServer_("PKG-PLT-YES", pricingRates);
    var tareKg = Number((cartons * spec.tareKgPerCarton + pallets * (pltYes.tareKgPerCarton || 18)).toFixed(2));
    var grossWeightKg = Number((w + tareKg).toFixed(2));
    var cbm = Number((cartons * spec.cbmPerCarton + pallets * (parseDimCmToCbmServer_(pltYes.dimCm) || 0.17)).toFixed(3));

    return {
      sku: sku,
      name: resolvedName,
      nameEng: resolvedEng || resolvedName,
      weight: w,
      packingCode: pCode,
      packingName: resolvedPackName,
      packingExtra: resolvedExtra,
      palletCode: palletCode,
      cartons: cartons,
      pallets: pallets,
      packingCost: packingCost,
      tareKg: tareKg,
      grossWeightKg: grossWeightKg,
      cbm: cbm
    };
  }).filter(function (x) { return x.sku || (x.name && x.name !== "-"); });
}

function parseOrderItemsServer_(inq, fallbackSku, fallbackWeight, productsOpt, pricingRatesOpt, lookupsOpt) {
  if (inq) {
    var rawOrderItems = String(inq["Order_Items"] || inq["order_items"] || "").trim();
    if (rawOrderItems) {
      if (rawOrderItems.charAt(0) === "[") {
        try {
          var arrFromOrderItems = JSON.parse(rawOrderItems);
          if (Array.isArray(arrFromOrderItems) && arrFromOrderItems.length > 0) {
            return enrichParsedOrderItemsServer_(arrFromOrderItems, productsOpt, pricingRatesOpt, lookupsOpt);
          }
        } catch (e1) {}
      }
      var lines = rawOrderItems.split(/\r?\n|;/).map(function (ln) { return ln.trim(); }).filter(Boolean);
      var parsedLines = [];
      for (var li = 0; li < lines.length; li++) {
        var cols = lines[li].split(":");
        var lSku = String(cols[0] || "").trim();
        var lWeight = cols.length > 1 ? parseSmartNumber_(cols[1]) : 0;
        var lPack = cols.length > 2 ? String(cols[2] || "").trim() : "";
        if (lSku) {
          parsedLines.push({
            sku: lSku,
            name: "",
            weight: lWeight,
            packingCode: lPack,
            packingName: "",
            packingExtra: 0,
            palletCode: "PKG-PLT-NO",
            cartons: 0,
            pallets: 0,
            packingCost: 0
          });
        }
      }
      if (parsedLines.length > 0) {
        return enrichParsedOrderItemsServer_(parsedLines, productsOpt, pricingRatesOpt, lookupsOpt);
      }
    }

    var rawJson = String(inq["Items_JSON"] || inq["items_json"] || "").trim();
    if (rawJson && rawJson.charAt(0) === "[") {
      try {
        var jsonArr = JSON.parse(rawJson);
        if (Array.isArray(jsonArr) && jsonArr.length > 0) {
          return enrichParsedOrderItemsServer_(jsonArr, productsOpt, pricingRatesOpt, lookupsOpt);
        }
      } catch (e) {}
    }

    var note = String(inq["Note"] || "");
    var m = note.match(/\[ITEMS:([^\]]+)\]/);
    if (m && m[1]) {
      var parsed = m[1].split(";").map(function (seg) {
        var parts = seg.split("|");
        return {
          sku: String(parts[0] || "").trim(),
          name: String(parts[1] || parts[0] || "").trim(),
          weight: parseSmartNumber_(parts[2] || 0),
          packingCode: String(parts[3] || "").trim(),
          packingName: String(parts[4] || "").trim(),
          packingExtra: parseSmartNumber_(parts[5] || 0),
          palletCode: String(parts[6] || "PKG-PLT-NO").trim(),
          cartons: parseSmartNumber_(parts[7] || 0),
          pallets: parseSmartNumber_(parts[8] || 0),
          packingCost: parseSmartNumber_(parts[9] || 0)
        };
      }).filter(function (x) { return x.sku || x.name; });
      if (parsed.length > 0) return enrichParsedOrderItemsServer_(parsed, productsOpt, pricingRatesOpt, lookupsOpt);
    }

    var rawSku = String(inq["Mã sản phẩm"] || inq["SKU_Code"] || fallbackSku || "").trim();
    var rawName = String(inq["Tên sản phẩm"] || "").trim();
    var totalW = parseSmartNumber_(inq["Net_Weight_KGs"] || fallbackWeight || 0);
    if (rawSku.indexOf(",") !== -1) {
      var skus = rawSku.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      var names = rawName.split(";").map(function (s) { return s.trim(); });
      var perW = skus.length > 0 ? Math.round(totalW / skus.length) : totalW;
      var multi = skus.map(function (s, idx) {
        return {
          sku: s,
          name: names[idx] || s,
          weight: perW,
          packingCode: "",
          packingName: "",
          packingExtra: 0,
          palletCode: "PKG-PLT-NO"
        };
      });
      return enrichParsedOrderItemsServer_(multi, productsOpt, pricingRatesOpt, lookupsOpt);
    }

    return enrichParsedOrderItemsServer_([{
      sku: rawSku,
      name: rawName,
      weight: totalW,
      packingCode: "",
      packingName: "",
      packingExtra: 0,
      palletCode: "PKG-PLT-NO"
    }], productsOpt, pricingRatesOpt, lookupsOpt);
  }
  return enrichParsedOrderItemsServer_([{
    sku: String(fallbackSku || "").trim(),
    name: String(fallbackSku || "").trim(),
    weight: parseSmartNumber_(fallbackWeight || 0),
    packingCode: "",
    packingName: "",
    packingExtra: 0,
    palletCode: "PKG-PLT-NO"
  }], productsOpt, pricingRatesOpt, lookupsOpt);
}

function normalizeDriveImageUrl_(url) {
  var u = String(url || "").trim();
  if (!u) return "";
  var mLh3 = u.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
  if (mLh3 && mLh3[1]) {
    return "https://lh3.googleusercontent.com/d/" + mLh3[1];
  }
  var m1 = u.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m1 && m1[1]) {
    return "https://lh3.googleusercontent.com/d/" + m1[1];
  }
  var m2 = u.match(/drive\.google\.com\/(?:open|uc|thumbnail)\?[^#]*[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2 && m2[1]) {
    return "https://lh3.googleusercontent.com/d/" + m2[1];
  }
  var m3 = u.match(/drive\.google\.com\/(?:open|uc|thumbnail)\?id=([a-zA-Z0-9_-]+)/);
  if (m3 && m3[1]) {
    return "https://lh3.googleusercontent.com/d/" + m3[1];
  }
  return u;
}

function getOrCreateProductImagesFolder_() {
  var folderName = "NongSanXanh_Product_Images";
  var folders = DriveApp.getFoldersByName(folderName);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
}

function ensurePublicDriveImageUrl_(file) {
  if (!file) return "";
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (shareErr) {
    Logger.log("Cảnh báo chia sẻ file Drive: " + shareErr);
  }
  return "https://lh3.googleusercontent.com/d/" + file.getId();
}

function uploadProductImageToDrive_(base64Data, skuCode, fileName) {
  if (!base64Data) return "";
  var folder = getOrCreateProductImagesFolder_();

  var match = String(base64Data).match(/^data:([^;]+);base64,(.+)$/);
  var mimeType = match ? match[1] : "image/jpeg";
  var b64 = match ? match[2] : String(base64Data);
  var bytes = Utilities.base64Decode(b64);

  var ext = mimeType.indexOf("/") !== -1 ? mimeType.split("/")[1].replace(/[^a-z0-9]/gi, "") : "jpg";
  if (ext === "jpeg") ext = "jpg";
  var safeSku = String(skuCode || "SP").replace(/[^a-zA-Z0-9_-]+/g, "_");
  var cleanOriginal = fileName ? String(fileName).replace(/[^a-zA-Z0-9._-]+/g, "_") : ("img." + ext);
  var finalName = safeSku + "_" + new Date().getTime() + "_" + cleanOriginal;

  var blob = Utilities.newBlob(bytes, mimeType, finalName);
  var file = folder.createFile(blob);
  return ensurePublicDriveImageUrl_(file);
}

function resolveSingleDriveImageByName_(rawName) {
  var target = String(rawName || "").trim();
  if (!target || /^(https?:\/\/|data:)/i.test(target)) {
    return normalizeDriveImageUrl_(target);
  }
  try {
    var folder = getOrCreateProductImagesFolder_();
    var targetLow = target.toLowerCase();
    var files = folder.getFiles();
    while (files.hasNext()) {
      var f = files.next();
      var fName = String(f.getName() || "").trim().toLowerCase();
      if (fName === targetLow || fName.indexOf(targetLow) !== -1) {
        return ensurePublicDriveImageUrl_(f);
      }
    }
    var globalFiles = DriveApp.getFilesByName(target);
    if (globalFiles.hasNext()) {
      return ensurePublicDriveImageUrl_(globalFiles.next());
    }
  } catch (err) {
    Logger.log("Lỗi tìm ảnh theo tên: " + err);
  }
  return target;
}

/**
 * Chuyển đổi các dòng dữ liệu cũ đang lưu tên file trong cột Image_URL sang URL chuẩn
 * https://lh3.googleusercontent.com/d/FILE_ID, mở quyền xem công khai và ghi ngược lại Google Sheets.
 * Được gọi bất đồng bộ khi phát hiện dòng cũ hoặc khi cần đồng bộ, KHÔNG chạy trong getInitialAppData.
 */
function resolveLegacyProductImages() {
  var ss = getSS_();
  var sheet = ss.getSheetByName("Product_Catalog");
  if (!sheet) return { success: false, updatedCount: 0, products: [] };

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    return { success: true, updatedCount: 0, products: [] };
  }

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var imgKeyCandidates = ["Image_URL", "Image URL", "Hình ảnh", "Ảnh sản phẩm", "Image", "Photo_URL"];
  var imgCol = findHeaderIndexFuzzy_(headers, imgKeyCandidates, ["image_url", "image", "hình ảnh", "ảnh"]);
  if (imgCol === -1) {
    return { success: true, updatedCount: 0, products: normalizeProductImageFieldsPure_(readSheetAsObjects_("Product_Catalog", ss)) };
  }

  var pendingRows = [];
  for (var r = 1; r < values.length; r++) {
    var rawVal = String(values[r][imgCol] || "").trim();
    if (!rawVal) continue;
    if (/drive\.google\.com\//i.test(rawVal)) {
      var normUrl = normalizeDriveImageUrl_(rawVal);
      if (normUrl !== rawVal) {
        sheet.getRange(r + 1, imgCol + 1).setValue(normUrl);
        pendingRows.push({ row: r + 1, resolved: true });
      }
      continue;
    }
    if (!/^(https?:\/\/|data:|lh3\.googleusercontent\.com)/i.test(rawVal)) {
      pendingRows.push({ row: r + 1, name: rawVal });
    }
  }

  var updatedCount = 0;
  var needDriveLookup = pendingRows.some(function (x) { return !x.resolved && x.name; });
  if (needDriveLookup) {
    var folder = getOrCreateProductImagesFolder_();
    var filesMap = {};
    var filesList = [];
    var it = folder.getFiles();
    while (it.hasNext()) {
      var file = it.next();
      var fName = String(file.getName() || "").trim().toLowerCase();
      filesMap[fName] = file;
      filesList.push({ name: fName, file: file });
    }

    for (var i = 0; i < pendingRows.length; i++) {
      var item = pendingRows[i];
      if (item.resolved) {
        updatedCount++;
        continue;
      }
      var targetLow = item.name.toLowerCase();
      var matchedFile = filesMap[targetLow] || null;
      if (!matchedFile) {
        for (var j = 0; j < filesList.length; j++) {
          if (filesList[j].name.indexOf(targetLow) !== -1) {
            matchedFile = filesList[j].file;
            break;
          }
        }
      }
      if (!matchedFile) {
        var gIt = DriveApp.getFilesByName(item.name);
        if (gIt.hasNext()) matchedFile = gIt.next();
      }
      if (matchedFile) {
        var publicUrl = ensurePublicDriveImageUrl_(matchedFile);
        sheet.getRange(item.row, imgCol + 1).setValue(publicUrl);
        updatedCount++;
      }
    }
  } else {
    updatedCount = pendingRows.length;
  }

  return {
    success: true,
    updatedCount: updatedCount,
    products: normalizeProductImageFieldsPure_(readSheetAsObjects_("Product_Catalog", ss))
  };
}

function saveProductCatalogItem(payload) {
  if (!payload || typeof payload !== "object") {
    Logger.log("saveProductCatalogItem được gọi trực tiếp không có tham số. Để cấp quyền Apps Script, hãy chọn hàm 'capQuyenHeThong' và nhấn Chạy (Run).");
    return {
      success: false,
      message: "Hàm này chỉ nhận dữ liệu khi bấm Lưu từ giao diện Web. Để cấp quyền trong Apps Script, hãy chọn hàm 'capQuyenHeThong' ở thanh trên cùng rồi bấm Chạy (Run)."
    };
  }

  var ss = getSS_();
  var sheet = ss.getSheetByName("Product_Catalog");
  if (!sheet) throw new Error("Không tìm thấy sheet Product_Catalog");

  var headers = getSheetHeaders_(sheet);
  var sttCol = findHeaderIndexFuzzy_(headers, ["STT", "No", "No."], ["stt"]);
  var skuKeyCandidates = ["SKU_Code", "Mã sản phẩm", "SKU", "Product_ID", "Ma_SP", "Mã hàng", "SKU Code"];
  var nameVieCandidates = ["Product_Name_VIE", "Tên sản phẩm", "Product_Name", "Ten_San_Pham", "Tên nông sản", "Tên hàng"];
  var nameEngCandidates = ["Product_Name_ENG", "Item_Name_ENG", "English_Name", "Tên tiếng Anh"];
  var priceKeyCandidates = ["Unit_Price", "Đơn giá", "Don_Gia", "Price_USD_KG", "Unit Price", "Price", "Giá vốn"];
  var contKeyCandidates = ["Container_Type", "Loại hàng / Bảo quản", "Storage_Type", "Bảo quản", "Storage"];
  var tempKeyCandidates = ["Storage_Temperature", "Nhiệt độ bảo quản", "Temperature"];
  var packKeyCandidates = ["Packaging", "Quy cách", "Quy cách đóng gói", "Packing"];
  var specKeyCandidates = ["Spec", "ITEM_SPEC", "Specification", "Specifications", "Technical_Spec", "Thông số kỹ thuật"];
  var originKeyCandidates = ["Origin", "ORG", "Xuất xứ"];
  var hsKeyCandidates = ["HS_Code", "Mã HS", "HS Code"];
  var imgKeyCandidates = ["Image_URL", "Image URL", "Hình ảnh", "Ảnh sản phẩm", "Image", "Photo_URL"];
  var groupKeyCandidates = ["Product_Group", "Nhóm sản phẩm", "Product Group", "Nhóm hàng"];

  var skuCol = findHeaderIndexFuzzy_(headers, skuKeyCandidates, ["sku", "mã sản phẩm", "mã hàng"]);
  var nameVieCol = findHeaderIndexFuzzy_(headers, nameVieCandidates, ["product_name_vie", "tên sản phẩm", "tên nông sản", "product_name"]);
  var nameEngCol = findHeaderIndexFuzzy_(headers, nameEngCandidates, ["product_name_eng", "item_name_eng", "english"]);
  var priceCol = findHeaderIndexFuzzy_(headers, priceKeyCandidates, ["unit_price", "đơn giá", "giá vốn", "price"]);
  var contCol = findHeaderIndexFuzzy_(headers, contKeyCandidates, ["container_type", "bảo quản", "storage"]);
  var tempCol = findHeaderIndexFuzzy_(headers, tempKeyCandidates, ["temperature", "nhiệt độ"]);
  var packCol = findHeaderIndexFuzzy_(headers, packKeyCandidates, ["quy cách", "packag", "packing"]);
  var specCol = findHeaderIndexFuzzy_(headers, specKeyCandidates, ["spec", "kỹ thuật"]);
  var originCol = findHeaderIndexFuzzy_(headers, originKeyCandidates, ["origin", "xuất xứ"]);
  var hsCol = findHeaderIndexFuzzy_(headers, hsKeyCandidates, ["hs_code", "mã hs", "hs code"]);
  var imgCol = findHeaderIndexFuzzy_(headers, imgKeyCandidates, ["image_url", "image", "hình ảnh", "ảnh"]);
  var groupCol = findHeaderIndexFuzzy_(headers, groupKeyCandidates, ["product_group", "nhóm sản phẩm", "nhóm hàng"]);

  var existingProducts = readSheetAsObjects_("Product_Catalog", ss);
  var sttVal = parseSmartNumber_(payload.STT) || (existingProducts.length + 1);
  var skuVal = String(payload.SKU_Code || payload["Mã sản phẩm"] || "").trim();
  var nameVieVal = String(payload.Product_Name_VIE || payload["Tên sản phẩm"] || payload.Product_Name || "").trim();
  var nameEngVal = String(payload.Product_Name_ENG || payload.Item_Name_ENG || "").trim();
  var priceVal = parseSmartNumber_(payload.Unit_Price);
  var contVal = String(payload.Container_Type || payload["Loại hàng / Bảo quản"] || payload.Storage_Type || "40'RF").trim();
  var tempVal = String(payload.Storage_Temperature || "").trim();
  var packVal = String(payload.Packaging || "").trim();
  var specVal = String(payload.Spec || payload.Specification || payload.ITEM_SPEC || "").trim();
  var originVal = String(payload.Origin || payload.ORG || "VIETNAM").trim();
  var hsVal = String(payload.HS_Code || "").trim();
  var groupVal = String(payload.Product_Group || payload["Nhóm sản phẩm"] || "").trim();
  var rawImageInput = String(payload.Image_URL || "").trim();
  var imageUrl = normalizeDriveImageUrl_(rawImageInput);

  if (payload.imageBase64) {
    try {
      imageUrl = uploadProductImageToDrive_(payload.imageBase64, skuVal, payload.imageFileName || "");
    } catch (driveErr) {
      throw new Error("Không thể tải ảnh lên Google Drive (" + (driveErr.message || driveErr) + "). Hãy chọn hàm 'capQuyenHeThong' trong Apps Script -> Chạy (Run) -> Cấp quyền và Triển khai lại Phiên bản mới, hoặc dán link ảnh URL trực tiếp.");
    }
  } else if (rawImageInput && !/^(https?:\/\/|data:)/i.test(rawImageInput)) {
    imageUrl = resolveSingleDriveImageByName_(rawImageInput);
  }

  var rowObj = {};
  if (sttCol !== -1) rowObj[headers[sttCol]] = sttVal;
  else rowObj["STT"] = sttVal;

  rowObj[groupCol !== -1 ? headers[groupCol] : "Product_Group"] = groupVal;
  rowObj[skuCol !== -1 ? headers[skuCol] : "SKU_Code"] = skuVal;
  rowObj[nameVieCol !== -1 ? headers[nameVieCol] : "Product_Name_VIE"] = nameVieVal;
  if (nameEngCol !== -1 || nameEngVal) {
    rowObj[nameEngCol !== -1 ? headers[nameEngCol] : "Product_Name_ENG"] = nameEngVal;
  }
  rowObj[priceCol !== -1 ? headers[priceCol] : "Unit_Price"] = priceVal;
  if (hsCol !== -1 || hsVal) {
    rowObj[hsCol !== -1 ? headers[hsCol] : "HS_Code"] = hsVal;
  }
  rowObj[contCol !== -1 ? headers[contCol] : "Container_Type"] = contVal;
  if (tempCol !== -1 || tempVal) {
    rowObj[tempCol !== -1 ? headers[tempCol] : "Storage_Temperature"] = tempVal;
  }
  if (packCol !== -1 || packVal) {
    rowObj[packCol !== -1 ? headers[packCol] : "Packaging"] = packVal;
  }
  if (specCol !== -1 || specVal) {
    rowObj[specCol !== -1 ? headers[specCol] : "Spec"] = specVal;
  }
  if (originCol !== -1 || originVal) {
    rowObj[originCol !== -1 ? headers[originCol] : "Origin"] = originVal;
  }
  rowObj[imgCol !== -1 ? headers[imgCol] : "Image_URL"] = imageUrl;

  var actualSkuCandidates = skuCol !== -1 ? [headers[skuCol]].concat(skuKeyCandidates) : skuKeyCandidates;
  var updated = updateRowByKey_("Product_Catalog", actualSkuCandidates, skuVal, rowObj);
  if (updated) {
    return { success: true, data: rowObj };
  }

  var defaultHeaders = [
    "STT", "Product_Group", "SKU_Code", "Product_Name_VIE", "Product_Name_ENG",
    "Unit_Price", "HS_Code", "Container_Type", "Storage_Temperature", "Packaging", "Spec", "Origin", "Image_URL"
  ];
  appendObjectToSheet_("Product_Catalog", rowObj, defaultHeaders);
  return { success: true, data: rowObj };
}

function deleteProductCatalogItem(skuCode) {
  var ss = getSS_();
  var sheet = ss.getSheetByName("Product_Catalog");
  var headers = sheet ? getSheetHeaders_(sheet) : [];
  var skuKeyCandidates = ["SKU_Code", "Mã sản phẩm", "SKU", "Product_ID", "Ma_SP", "Mã hàng", "SKU Code"];
  var skuCol = findHeaderIndexFuzzy_(headers, skuKeyCandidates, ["sku", "mã sản phẩm", "mã hàng"]);
  var actualSkuCandidates = skuCol !== -1 ? [headers[skuCol]].concat(skuKeyCandidates) : skuKeyCandidates;
  var ok = deleteRowByKey_("Product_Catalog", actualSkuCandidates, skuCode);
  return { success: ok };
}

/**
 * Thẩm quyền thương lượng trực tiếp cho Sales trong khung Floor_Price_USD (>= giá sàn của XNK)
 * Hỗ trợ đủ 11 điều kiện Incoterms 2020 & đồng bộ chế độ phôi báo giá
 */
function salesQuickAdjustProposal(orderId, newPriceUsd, newIncoterm, staffName, modeOpts) {
  var cleanOid = String(orderId || "").trim();
  var normOid = cleanOid.toUpperCase();
  var proposals = readSheetAsObjects_("Pricing_Proposal");
  var activeProp = null;
  for (var p = proposals.length - 1; p >= 0; p--) {
    var oid = String(proposals[p]["Order ID"] || proposals[p]["Order_ID"] || "").trim();
    if (oid.toUpperCase() === normOid) {
      var st = String(proposals[p]["Booking_Status"] || "");
      if (st.indexOf("Superseded") === -1 && st.indexOf("Đã thay thế") === -1) {
        activeProp = proposals[p];
        break;
      }
    }
  }
  if (!activeProp) {
    return { success: false, message: "Không tìm thấy phương án giá đang hiệu lực cho đơn " + cleanOid };
  }

  var origInc = String(activeProp["Recommended Incoterm"] || "CIF").trim().toUpperCase();
  var targetInc = String(newIncoterm || origInc || "CIF").trim().toUpperCase();
  var basePrice = parseSmartNumber_(activeProp["Final_Selling Price"] !== undefined ? activeProp["Final_Selling Price"] : activeProp["Final_Selling_Price"]);
  var exwP = parseSmartNumber_(activeProp["EXW_Price"]);
  var fobP = parseSmartNumber_(activeProp["FOB_Price"]);
  var cfrP = parseSmartNumber_(activeProp["CFR_Price"]);
  var cifP = parseSmartNumber_(activeProp["CIF_Price"]);

  function pickRefPriceForInc_(incCode) {
    var c = String(incCode || "").trim().toUpperCase();
    if (c === "EXW") {
      if (exwP > 0) return exwP;
      var gp = parseSmartNumber_(activeProp["Goods_Cost"]) + parseSmartNumber_(activeProp["Packing_Pallet_Cost"]);
      return gp > 0 ? gp : basePrice;
    }
    if (c === "FCA" || c === "FAS" || c === "FOB") {
      return fobP > 0 ? fobP : basePrice;
    }
    if (c === "CFR" || c === "CPT") {
      return cfrP > 0 ? cfrP : basePrice;
    }
    if (c === "CIF" || c === "CIP") {
      return cifP > 0 ? cifP : basePrice;
    }
    if (c === origInc && basePrice > 0) return basePrice;
    return cifP > 0 ? cifP : basePrice;
  }

  var refOrig = pickRefPriceForInc_(origInc) || basePrice;
  var refTarget = pickRefPriceForInc_(targetInc) || basePrice;

  var targetPrice = parseSmartNumber_(newPriceUsd);
  if (targetPrice <= 0) {
    targetPrice = refTarget > 0 ? refTarget : basePrice;
  }

  var floorPrice = parseSmartNumber_(activeProp["Floor_Price_USD"]);
  var effectiveFloor = floorPrice;
  if (floorPrice > 0 && targetInc !== origInc && refOrig > 0 && refTarget > 0) {
    effectiveFloor = Number((floorPrice * (refTarget / refOrig)).toFixed(2));
  }
  if (effectiveFloor > 0 && targetPrice + 0.009 < effectiveFloor) {
    return {
      success: false,
      message: "Giá điều chỉnh (" + targetInc + " $" + formatCurrency(targetPrice) + ") thấp hơn Giá Sàn tối thiểu (" + targetInc + " $" + formatCurrency(effectiveFloor) + ") do XNK quy định. Vui lòng tăng giá hoặc chuyển XNK tính giá lại."
    };
  }

  var curRound = parseInt(activeProp["Quote_Round"] || 1, 10) || 1;
  var nextRound = Math.max(2, curRound + 1);
  var baseOidNoSuffix = cleanOid.replace(/-(?:V|R)\d+$/i, "");
  var newQuoNo = "QT-" + baseOidNoSuffix;
  var newVer = "";

  var todayStr = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");
  var newRow = {};
  for (var k in activeProp) {
    if (k === "_rowIndex") continue;
    if (Object.prototype.hasOwnProperty.call(activeProp, k)) newRow[k] = activeProp[k];
  }

  var delta = targetPrice - (refTarget > 0 ? refTarget : targetPrice);
  if (exwP > 0) newRow["EXW_Price"] = Number(Math.max(0, exwP + delta).toFixed(2));
  if (fobP > 0) newRow["FOB_Price"] = Number(Math.max(0, fobP + delta).toFixed(2));
  if (cfrP > 0) newRow["CFR_Price"] = Number(Math.max(0, cfrP + delta).toFixed(2));
  if (cifP > 0) newRow["CIF_Price"] = Number(Math.max(0, cifP + delta).toFixed(2));
  if (targetInc === "EXW") newRow["EXW_Price"] = Number(targetPrice.toFixed(2));
  else if (targetInc === "FCA" || targetInc === "FAS" || targetInc === "FOB") newRow["FOB_Price"] = Number(targetPrice.toFixed(2));
  else if (targetInc === "CFR" || targetInc === "CPT") newRow["CFR_Price"] = Number(targetPrice.toFixed(2));
  else if (targetInc === "CIF" || targetInc === "CIP") newRow["CIF_Price"] = Number(targetPrice.toFixed(2));

  var optsObj = (modeOpts && typeof modeOpts === "object") ? modeOpts : {};
  var optMode = String(optsObj.quotationMode || activeProp["Quotation_Mode"] || "SINGLE").trim().toUpperCase();
  var resolvedMode = (optMode.indexOf("COMPAR") !== -1) ? "COMPARISON" : "SINGLE";
  var existingProposed = String(activeProp["Proposed_Incoterms"] || "")
    .split(/[,;\n|]+/)
    .map(function (x) { return String(x || "").trim().toUpperCase(); })
    .filter(Boolean);
  if (resolvedMode === "COMPARISON") {
    if (existingProposed.length === 0) existingProposed = ["EXW", "FOB", "CFR", "CIF"];
    if (existingProposed.indexOf(targetInc) === -1) existingProposed.push(targetInc);
    newRow["Proposed_Incoterms"] = existingProposed.join(", ");
  } else {
    newRow["Proposed_Incoterms"] = targetInc;
  }
  newRow["Quotation_Mode"] = resolvedMode;

  newRow["Order ID"] = cleanOid;
  newRow["Order_ID"] = cleanOid;
  newRow["Price_Version"] = newVer;
  newRow["Quote_ID"] = newQuoNo;
  newRow["Quotation_No"] = newQuoNo;
  newRow["Quote_Round"] = nextRound;
  newRow["Recommended Incoterm"] = targetInc;
  newRow["Final_Selling Price"] = Number(targetPrice.toFixed(2));
  newRow["Final_Selling_Price"] = Number(targetPrice.toFixed(2));
  newRow["Floor_Price_USD"] = effectiveFloor > 0 ? Number(effectiveFloor.toFixed(2)) : floorPrice;
  newRow["Adjusted_By_Sales"] = true;
  newRow["Booking_Date"] = todayStr;
  newRow["Booking_Status"] = "Đã lập báo giá";
  newRow["Note"] = String(activeProp["Note"] || "").replace(/\s*\[ITEMS:[^\]]+\]/g, "").trim();

  var updatedProp = updateRowByKey_("Pricing_Proposal", ["Order ID", "Order_ID"], cleanOid, newRow);
  if (!updatedProp) {
    appendObjectToSheet_("Pricing_Proposal", newRow, Object.keys(newRow));
  }
  updateRowByKey_("Inquiry_Quotation", "Order_ID", cleanOid, {
    "Inquiry_Status": "Đã lập báo giá",
    "Quote_Round": nextRound,
    "Quotation_Mode": resolvedMode
  });

  return {
    success: true,
    data: newRow,
    quotationNo: newQuoNo,
    quoteRound: nextRound
  };
}

function saveProductsBatch(rows) {
  var list = Array.isArray(rows) ? rows : [];
  var saved = [];
  for (var i = 0; i < list.length; i++) {
    var row = list[i];
    if (!row || !String(row.SKU_Code || "").trim()) continue;
    var res = saveProductCatalogItem(row);
    if (res && res.success && res.data) saved.push(res.data);
  }
  return { success: true, count: saved.length, data: saved };
}

function saveConsigneeItem(payload) {
  if (!payload || typeof payload !== "object") {
    return { success: false, message: "Thiếu dữ liệu khách hàng." };
  }
  var existing = readSheetAsObjects_("Consignee_Directory");
  var cneId = String(payload.Consignee_ID || "").trim();
  var inputNameNorm = normalizeCustomerKeyServer_(payload.Consignee_Name);
  var inputEmailNorm = normalizeCustomerKeyServer_(payload.Email);
  var inputTaxNorm = normalizeTaxKeyServer_(payload.Tax_ID || payload.Tax);

  if (!cneId) {
    for (var k = 0; k < existing.length; k++) {
      var ex = existing[k];
      var exName = normalizeCustomerKeyServer_(ex["Consignee_Name"]);
      var exEmail = normalizeCustomerKeyServer_(ex["Email"]);
      var exTax = normalizeTaxKeyServer_(ex["Tax"] || ex["Tax_ID"]);
      if ((inputTaxNorm && exTax && inputTaxNorm === exTax) ||
          (inputEmailNorm && exEmail && inputEmailNorm === exEmail) ||
          (inputNameNorm && exName && inputNameNorm === exName)) {
        cneId = String(ex["Consignee_ID"] || "").trim();
        break;
      }
    }
  }
  if (!cneId) {
    var maxNum = 0;
    for (var i = 0; i < existing.length; i++) {
      var m = String(existing[i]["Consignee_ID"] || "").match(/(\d+)/);
      if (m) {
        var n = parseInt(m[1], 10);
        if (n > maxNum) maxNum = n;
      }
    }
    cneId = "KH-" + ("000" + (maxNum + 1)).slice(-3);
  }
  var existingMatch = null;
  for (var jm = 0; jm < existing.length; jm++) {
    if (String(existing[jm]["Consignee_ID"] || "").trim() === cneId) {
      existingMatch = existing[jm];
      break;
    }
  }
  var hasExplicitCount = (payload.Order_Count !== undefined && payload.Order_Count !== "") ||
    (payload["Số lượng đơn hàng"] !== undefined && payload["Số lượng đơn hàng"] !== "");
  var baselineOrderCnt = existingMatch
    ? Math.max(0, parseSmartNumber_(existingMatch["Số lượng đơn hàng"] !== undefined && existingMatch["Số lượng đơn hàng"] !== "" ? existingMatch["Số lượng đơn hàng"] : existingMatch["Order_Count"]))
    : 0;
  var resolvedOrderCnt = hasExplicitCount
    ? Math.max(0, parseSmartNumber_(payload.Order_Count !== undefined && payload.Order_Count !== "" ? payload.Order_Count : payload["Số lượng đơn hàng"]))
    : baselineOrderCnt;
  var resolvedCustomerType = classifyCustomerTypeByCompletedCountServer_(resolvedOrderCnt);

  var taxVal = String(payload.Tax_ID || payload.Tax || "").trim();
  var payTermsVal = String(payload.Payment_Terms || payload["Điều khoản thanh toán mặc định"] || "T/T 30% Deposit, 70% against B/L copy").trim();
  var rowObj = {
    "Consignee_ID": cneId,
    "Consignee_Name": String(payload.Consignee_Name || "").replace(/\s+/g, " ").trim(),
    "Country": String(payload.Country || "").trim(),
    "Address": String(payload.Address || "").trim(),
    "Tax": taxVal,
    "Tax_ID": taxVal,
    "Contact_Person": String(payload.Contact_Person || "").trim(),
    "Phone": String(payload.Phone || "").trim(),
    "Email": String(payload.Email || "").trim(),
    "Fax": String(payload.Fax || "").trim(),
    "Điều khoản thanh toán mặc định": payTermsVal,
    "Payment_Terms": payTermsVal,
    "Customer_Type": resolvedCustomerType,
    "Status": String(payload.Status || "Active").trim(),
    "Số lượng đơn hàng": resolvedOrderCnt,
    "Order_Count": resolvedOrderCnt
  };
  if (existingMatch) {
    updateRowByKey_("Consignee_Directory", "Consignee_ID", cneId, rowObj);
    return { success: true, data: rowObj };
  }
  rowObj["Ngày tạo"] = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");
  appendObjectToSheet_("Consignee_Directory", rowObj, [
    "Consignee_ID", "Consignee_Name", "Country", "Address", "Tax",
    "Contact_Person", "Phone", "Email", "Fax", "Điều khoản thanh toán mặc định", "Customer_Type", "Số lượng đơn hàng", "Ngày tạo"
  ]);
  return { success: true, data: rowObj };
}

function saveConsigneesBatch(rows) {
  var list = Array.isArray(rows) ? rows : [];
  var saved = [];
  for (var i = 0; i < list.length; i++) {
    var row = list[i];
    if (!row || !String(row.Consignee_Name || "").trim()) continue;
    var res = saveConsigneeItem(row);
    if (res && res.success && res.data) saved.push(res.data);
  }
  return { success: true, count: saved.length, data: saved };
}
