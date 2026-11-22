/**
 * ============================================================================
 * HỆ THỐNG QUẢN LÝ XUẤT KHẨU NÔNG SẢN - NÔNG SẢN XANH
 * File: Code.gs (Google Apps Script Server-Side)
 * ============================================================================
 * Quy tắc xử lý:
 * 1. Mọi ô kiểu Date từ getValues() được chuyển sang chuỗi "yyyy-MM-dd" hoặc
 *    "yyyy-MM-dd HH:mm" (GMT+7) để tránh lỗi null của google.script.run.
 * 2. Hàm đăng nhập chỉ đọc sheet SYS_Users, không tạo/ghi log SYS_AuditLogs.
 * 3. Tự động đọc Data Validation (trình đơn thả xuống) từ các cột trong Google
 *    Sheets để đồng bộ trình đơn thả xuống lên giao diện Web.
 * 4. Tự động chống trùng lặp khách hàng & cập nhật phân loại khách hàng theo
 *    lũy tiến số lượng đơn hàng đã ký hợp đồng trong Consignee_Directory.
 * ============================================================================
 */

var TIMEZONE = "GMT+7";
var COMPANY_LOGO_ID = "1wCvXSGw4Y8bweGQjVGJgoMJo72krfJri";
var GEMINI_API_KEY = "AQ.Ab8RN6KpfZRa7BTcpLGSK_stD7xNFfDKu3ei1QEdMbye1rpD_w"; // Dán Gemini API Key tại đây (chỉ gọi khi bấm nút AI trên Chatbot)
var GEMINI_MODEL = "gemini-3-flash-preview"; // Model Gemini API (v1beta), tự fallback gemini-flash-latest nếu lỗi 404

/**
 * Điểm vào Web App
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("Nông sản Xanh - Quản lý Xuất khẩu Nông sản")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

/**
 * Nhúng các file HTML thành phần vào giao diện chính
 */
function include(filename) {
  try {
    var cleanName = String(filename || "").trim().replace(/\.html$/i, "");
    if (!cleanName) return "";
    return HtmlService.createTemplateFromFile(cleanName).evaluate().getContent();
  } catch (e) {
    if (String((e && e.message) || e).indexOf("No HTML file named") !== -1) {
      return "";
    }
    throw e;
  }
}

/**
 * Chạy hàm này 1 lần trong trình soạn thảo Apps Script (nhấn Run / Chạy)
 * để cấp đầy đủ quyền Google Sheets, Google Drive, Google Docs, GmailApp & MailApp cho Web App trước khi Triển khai (Deploy).
 *
 * LƯU Ý TRIỂN KHAI CHO NHIỀU NGƯỜI DÙNG (NHÓM ĐỒ ÁN):
 * - Vào Triển khai (Deploy) -> Quản lý các bản triển khai -> Chọn "Thực thi dưới dạng (Execute as): Người dùng truy cập ứng dụng web (User accessing the web app)".
 * - Khi bật chế độ này, mỗi thành viên đăng nhập Gmail riêng bấm gửi báo giá thì email sẽ gửi mang danh nghĩa "GREEN AGRI-EXPORTS (Nông Sản Xanh)"
 *   (replyTo: export@greenagri-vn.com) đồng thời lưu trực tiếp trong mục "Đã gửi (Sent)" trên chính hộp thư Gmail của thành viên đó.
 */
function capQuyenHeThong() {
  var ss = getSS_();
  var folderName = "NongSanXanh_Product_Images";
  var folders = DriveApp.getFoldersByName(folderName);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
  var oauthToken = ScriptApp.getOAuthToken();
  var docServiceCheck = typeof DocumentApp !== "undefined" ? "Ready" : "Unavailable";
  var mailQuota = 0;
  try {
    mailQuota = MailApp.getRemainingDailyQuota();
  } catch (mqErr) {}
  try {
    GmailApp.getInboxThreads(0, 1);
  } catch (gmErr) {}
  try {
    UrlFetchApp.getRequest("https://docs.google.com/document/d/1/export?format=pdf", {
      headers: { Authorization: "Bearer " + oauthToken }
    });
  } catch (e) {}
  Logger.log("Cấp quyền thành công! Bảng tính: " + ss.getName() + " | Thư mục ảnh Drive: " + folder.getName() + " | Docs: " + docServiceCheck + " | Mail quota: " + mailQuota);
  return {
    success: true,
    spreadsheet: ss.getName(),
    folder: folder.getName(),
    mailQuota: mailQuota,
    message: "Đã cấp quyền Google Sheets, Drive, Docs, Gmail và MailApp thành công. Khi Deploy cho nhóm, khuyến nghị chọn 'Execute as: User accessing the web app' để mỗi người lưu thư tại mục Đã gửi (Sent) của riêng mình."
  };
}

function getSS_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function parseSmartNumber_(val) {
  if (typeof val === "number") {
    return isNaN(val) || !isFinite(val) ? 0 : val;
  }
  if (val === null || val === undefined || val === "") return 0;
  var s = String(val).replace(/[^0-9.,-]/g, "").trim();
  if (!s) return 0;
  if (s.indexOf(",") !== -1 && s.indexOf(".") === -1) {
    s = s.replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  var n = Number(s);
  return isNaN(n) || !isFinite(n) ? 0 : n;
}

/**
 * Định dạng tiền tệ USD chuẩn quốc tế, luôn hiển thị đủ 2 chữ số thập phân (VD: 1,200.00 / 4.40).
 * Chỉ dùng cho chuỗi hiển thị hoặc điền biến thẻ trên phôi tài liệu, không dùng để lưu số vào Sheets.
 */
function formatCurrency(value) {
  var n = parseSmartNumber_(value);
  var isNeg = n < 0;
  var abs = Math.abs(n);
  var fixed = abs.toFixed(2);
  var parts = fixed.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (isNeg ? "-" : "") + parts[0] + "." + parts[1];
}

var ORDER_MASTER_COLUMNS_ = [
  "Order_ID",
  "Contract_No.",
  "Contract_Date",
  "In_Charge_Staff",
  "Consignee_ID",
  "SKU_Code",
  "NW_Confirmed_KGs",
  "Applied_Incoterm",
  "Contract_Value",
  "Payment_Terms",
  "POL",
  "POD",
  "Fulfillment_Status",
  "CO_Form",
  "Contract_Link"
];

function isPlainTextField_(headerName) {
  var hNorm = String(headerName || "").trim().toLowerCase().replace(/[\s_.]/g, "");
  if (!hNorm) return false;
  var exact = [
    "phone", "fax", "tax", "taxid",
    "orderid", "madon", "madonhang",
    "quoteid", "quotationno", "sobaogia",
    "contractno", "sohopdong",
    "consigneeid", "employeeid", "scheduleid",
    "skucode", "masanpham", "feecode", "chargecode", "servicecode", "templateid"
  ];
  return exact.indexOf(hNorm) !== -1;
}

function isCurrencyField_(headerName, dataObj) {
  var hNorm = String(headerName || "").trim().toLowerCase().replace(/[\s_.]/g, "");
  if (!hNorm) return false;
  if (hNorm === "standardrate" && dataObj && String(dataObj["Fee_Category"] || "").trim().toUpperCase() === "INSURANCE") {
    return false;
  }
  var exact = [
    "contractvalue", "contractvalueusd", "unitprice", "standardfee", "standardrate",
    "finalsellingprice", "floorpriceusd", "goodscost", "packingpalletcost",
    "totalfreightlocal", "insurancecost", "palletfee",
    "lclunitrateusd", "lcltotalfreightusd", "fwdoceancfsusd", "fwdtruckingusd",
    "fwdcustomsusd", "fwdpermitsusd", "selftruckingusd",
    "internalcostusd", "buyerchargeusd", "internalprofitusd",
    "exwprice", "fobprice", "cfrprice", "cifprice",
    "rate20dc", "rate40dc", "rate40hc", "rate20'rf", "rate40'rf", "rate40'rh",
    "baffee", "lssfee", "pssfee", "b/lfee", "sealfee",
    "thc20dry", "thc40dry", "thc20reefer", "thc40reefer", "billsealfeeshipment"
  ];
  return exact.indexOf(hNorm) !== -1;
}

function isIntegerNumberField_(headerName) {
  var hNorm = String(headerName || "").trim().toLowerCase().replace(/[\s_.]/g, "");
  if (!hNorm) return false;
  var exact = [
    "stt", "netweightkgs", "nwconfirmedkgs", "totalweightkg",
    "totalcartons", "totalpallets", "containerqty",
    "soluongdonhang", "ordercount", "quoteround",
    "daysconlai", "netkg", "maxperpallet"
  ];
  return exact.indexOf(hNorm) !== -1;
}

function resolveHeaderValueFromObj_(headerName, dataObj) {
  if (!dataObj || typeof dataObj !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(dataObj, headerName)) {
    return dataObj[headerName];
  }
  var aliasMap = {
    "Order_ID": ["Order ID", "Mã đơn", "Mã đơn hàng"],
    "Order ID": ["Order_ID", "Mã đơn", "Mã đơn hàng"],
    "Quote_ID": ["Quotation_No", "Số báo giá"],
    "Quotation_No": ["Quote_ID", "Số báo giá"],
    "Contract_No.": ["Contract_No", "Số hợp đồng"],
    "Contract_Value": ["Contract_Value_USD", "Contract Value"],
    "Contract_Value_USD": ["Contract_Value", "Contract Value"],
    "Tax": ["Tax_ID"],
    "Tax_ID": ["Tax"],
    "Final_Selling Price": ["Final_Selling_Price"],
    "Final_Selling_Price": ["Final_Selling Price"],
    "Recommended Incoterm": ["Recommended_Incoterm"],
    "Số lượng đơn hàng": ["Order_Count"],
    "Order_Count": ["Số lượng đơn hàng"],
    "SKU_Code": ["Mã sản phẩm", "SKU"],
    "Mã sản phẩm": ["SKU_Code", "SKU"]
  };
  var aliases = aliasMap[headerName];
  if (aliases) {
    for (var i = 0; i < aliases.length; i++) {
      if (Object.prototype.hasOwnProperty.call(dataObj, aliases[i])) {
        return dataObj[aliases[i]];
      }
    }
  }
  var targetNorm = String(headerName || "").toLowerCase().replace(/[\s_]/g, "");
  for (var k in dataObj) {
    if (!Object.prototype.hasOwnProperty.call(dataObj, k)) continue;
    if (String(k).toLowerCase().replace(/[\s_]/g, "") === targetNorm) {
      return dataObj[k];
    }
  }
  return undefined;
}

function writeFormattedCell_(cell, headerName, val, dataObj, applyDefaultAlign) {
  var hStr = String(headerName || "").trim();
  if (isPlainTextField_(hStr)) {
    var cleanTxt = (val === null || val === undefined) ? "" : String(val).trim().replace(/^'+/, "");
    if (cleanTxt) {
      cell.setNumberFormat("General");
      cell.setValue("'" + cleanTxt);
      cell.setNumberFormat("@");
    } else {
      cell.setValue("");
      cell.setNumberFormat("@");
    }
    if (applyDefaultAlign) {
      cell.setHorizontalAlignment("left");
    }
    return;
  }

  if (isCurrencyField_(hStr, dataObj)) {
    if (val === "" || val === null || val === undefined) {
      cell.setValue("");
    } else {
      cell.setValue(parseSmartNumber_(val));
    }
    cell.setNumberFormat("$#,##0.00");
    if (applyDefaultAlign) {
      cell.setHorizontalAlignment("right");
    }
    return;
  }

  if (isIntegerNumberField_(hStr)) {
    if (val === "" || val === null || val === undefined) {
      cell.setValue("");
    } else {
      cell.setValue(Math.round(parseSmartNumber_(val)));
    }
    cell.setNumberFormat("#,##0");
    if (applyDefaultAlign) {
      cell.setHorizontalAlignment("right");
    }
    return;
  }

  var safeVal = (val === null || val === undefined) ? "" : val;
  if (typeof safeVal === "string") {
    var trimmedSafe = safeVal.trim();
    var startsWithFormulaChar = /^[+=@]/.test(trimmedSafe) || (trimmedSafe.charAt(0) === "-" && isNaN(Number(trimmedSafe)));
    if (startsWithFormulaChar) {
      cell.setNumberFormat("General");
      cell.setValue("'" + trimmedSafe.replace(/^'+/, ""));
      cell.setNumberFormat("@");
    } else {
      cell.setValue(safeVal);
    }
  } else {
    cell.setValue(safeVal);
  }
  if (applyDefaultAlign && typeof safeVal !== "number") {
    cell.setHorizontalAlignment("left");
  }
}

/**
 * Chuẩn hóa giá trị ô trước khi trả về Frontend
 */
function sanitizeCell_(val, headerName) {
  if (val === null || val === undefined) {
    return "";
  }
  if (Object.prototype.toString.call(val) === "[object Date]" || val instanceof Date) {
    if (isNaN(val.getTime())) {
      return "";
    }
    var h = String(headerName || "").toLowerCase();
    if (h.indexOf("timestamp") !== -1 || h.indexOf("giờ") !== -1) {
      return Utilities.formatDate(val, TIMEZONE, "yyyy-MM-dd HH:mm");
    }
    var hours = val.getHours();
    var mins = val.getMinutes();
    if (hours !== 0 || mins !== 0) {
      return Utilities.formatDate(val, TIMEZONE, "yyyy-MM-dd HH:mm");
    }
    return Utilities.formatDate(val, TIMEZONE, "yyyy-MM-dd");
  }
  if (typeof val === "number") {
    if (isNaN(val) || !isFinite(val)) {
      return 0;
    }
    return val;
  }
  if (typeof val === "boolean") {
    return val;
  }
  var str = String(val);
  if (isPlainTextField_(headerName) && str.charAt(0) === "'") {
    str = str.slice(1);
  }
  return str;
}

/**
 * Đọc toàn bộ dữ liệu của 1 tab thành mảng đối tượng JSON an toàn (chỉ đọc vùng có dữ liệu thực tế)
 */
function readSheetAsObjects_(sheetName, ssOpt) {
  var ss = ssOpt || getSS_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    return [];
  }
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    return [];
  }
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) {
    return String(h).trim();
  });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var rowArr = values[r];
    var hasData = false;
    for (var c = 0; c < headers.length; c++) {
      if (rowArr[c] !== "" && rowArr[c] !== null && rowArr[c] !== undefined) {
        hasData = true;
        break;
      }
    }
    if (!hasData) continue;

    var obj = { _rowIndex: r + 1 };
    for (var col = 0; col < headers.length; col++) {
      var key = headers[col];
      if (!key) continue;
      obj[key] = sanitizeCell_(rowArr[col], key);
    }
    rows.push(obj);
  }
  return rows;
}

/**
 * Trích xuất các trình đơn thả xuống (Data Validation) thực tế từ Google Sheets
 */
function extractSheetDropdowns_(sheetName, ssOpt) {
  var result = {};
  var ss = ssOpt || getSS_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return result;

  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  if (lastCol < 1) return result;

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h).trim();
  });

  var sampleRows = Math.min(Math.max(lastRow - 1, 1), 10);
  var startRow = 2;
  if (sheet.getMaxRows() < 2) return result;

  try {
    var validations = sheet.getRange(startRow, 1, sampleRows, lastCol).getDataValidations();
    for (var col = 0; col < headers.length; col++) {
      var header = headers[col];
      if (!header) continue;
      for (var r = 0; r < validations.length; r++) {
        var rule = validations[r][col];
        if (!rule) continue;
        var criteria = rule.getCriteriaType();
        var args = rule.getCriteriaValues();
        var list = [];

        if (criteria === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST && args && args[0]) {
          list = args[0].map(function (v) { return String(v).trim(); }).filter(Boolean);
        } else if (criteria === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE && args && args[0]) {
          try {
            var rngVals = args[0].getValues();
            for (var rr = 0; rr < rngVals.length; rr++) {
              for (var cc = 0; cc < rngVals[rr].length; cc++) {
                var cellStr = String(rngVals[rr][cc] || "").trim();
                if (cellStr && list.indexOf(cellStr) === -1) {
                  list.push(cellStr);
                }
              }
            }
          } catch (rangeErr) {
            // Bỏ qua lỗi phạm vi tham chiếu
          }
        }

        if (list.length > 0) {
          result[header] = list;
          break;
        }
      }
    }
  } catch (e) {
    // Không làm gián đoạn quá trình tải dữ liệu nếu sheet không có validation
  }
  return result;
}

function getAllSheetDropdowns_(ssOpt) {
  var ss = ssOpt || getSS_();
  var sheets = [
    "Inquiry_Quotation",
    "Consignee_Directory",
    "Product_Catalog",
    "Pricing_Proposal",
    "Pricing_Rates",
    "Order_Master",
    "Shipping_Schedule",
    "Local_Charges",
    "Customs_Service_Fees",
    "Incoterms_Handbook",
    "System_Lookups",
    "Template_Manager",
    "SYS_Users"
  ];
  var map = {};
  for (var i = 0; i < sheets.length; i++) {
    map[sheets[i]] = extractSheetDropdowns_(sheets[i], ss);
  }
  if (!map["Order_Master"]) map["Order_Master"] = {};
  map["Order_Master"]["Fulfillment_Status"] = [
    WORKFLOW_5_STAGES_SERVER_[1],
    WORKFLOW_5_STAGES_SERVER_[2],
    PENDING_SALES_SIGN_STATUS_SERVER_,
    SIGNED_STAGE3_STATUS_SERVER_,
    WORKFLOW_5_STAGES_SERVER_[3],
    WORKFLOW_5_STAGES_SERVER_[4],
    WORKFLOW_5_STAGES_SERVER_[5],
    COMPLETED_ORDER_STATUS_SERVER_
  ];
  if (!map["Pricing_Rates"]) map["Pricing_Rates"] = {};
  var cats = Array.isArray(map["Pricing_Rates"]["Fee_Category"]) ? map["Pricing_Rates"]["Fee_Category"].slice() : ["PACKING", "LOCAL_CHARGE", "CUSTOMS_FEE", "INSURANCE", "CONTAINER"];
  ["PACKING", "CONTAINER", "LOCAL_CHARGE", "CUSTOMS_FEE", "INSURANCE"].forEach(function (c) {
    if (cats.indexOf(c) === -1) cats.push(c);
  });
  map["Pricing_Rates"]["Fee_Category"] = cats;
  return map;
}

function getSheetHeaders_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h).trim();
  });
}

function colIndexToLetter_(colIndex) {
  var temp, letter = "";
  while (colIndex > 0) {
    temp = (colIndex - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    colIndex = (colIndex - temp - 1) / 26;
  }
  return letter;
}

function findHeaderIndex_(headers, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    var idx = headers.indexOf(candidates[i]);
    if (idx !== -1) return idx;
  }
  for (var j = 0; j < candidates.length; j++) {
    var normTarget = candidates[j].toLowerCase().replace(/[\s_]/g, "");
    for (var k = 0; k < headers.length; k++) {
      if (headers[k].toLowerCase().replace(/[\s_]/g, "") === normTarget) {
        return k;
      }
    }
  }
  return -1;
}

function ensureSheetColumns_(sheetName, requiredCols) {
  // Cấm tự động thêm cột mới trên mọi Google Sheets để bảo toàn cấu trúc bảng gốc.
  return;
}

function isOrderMasterAllowedColumn_(headerName) {
  var hNorm = String(headerName || "").trim().toLowerCase().replace(/[\s_.]/g, "");
  for (var i = 0; i < ORDER_MASTER_COLUMNS_.length; i++) {
    if (ORDER_MASTER_COLUMNS_[i].toLowerCase().replace(/[\s_.]/g, "") === hNorm) {
      return true;
    }
  }
  return false;
}

function appendObjectToSheet_(sheetName, dataObj, defaultHeaders) {
  var ss = getSS_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error("Không tìm thấy bảng dữ liệu: " + sheetName);
  }
  var effectiveDefaultHeaders = (sheetName === "Order_Master") ? ORDER_MASTER_COLUMNS_ : defaultHeaders;
  var headers = getSheetHeaders_(sheet);
  if (headers.length === 0 && effectiveDefaultHeaders && effectiveDefaultHeaders.length > 0) {
    sheet.getRange(1, 1, 1, effectiveDefaultHeaders.length).setValues([effectiveDefaultHeaders]);
    headers = effectiveDefaultHeaders.slice();
  }
  if (headers.length === 0) {
    throw new Error("Bảng " + sheetName + " chưa có dòng tiêu đề cột.");
  }

  var existingLastRow = sheet.getLastRow();
  var targetRow = Math.max(2, existingLastRow + 1);
  var hasSampleRow = existingLastRow >= 2;
  if (hasSampleRow) {
    try {
      var sampleRange = sheet.getRange(2, 1, 1, headers.length);
      sampleRange.copyFormatToRange(sheet, 1, headers.length, targetRow, targetRow);
    } catch (fmtErr) {}
  } else {
    sheet.getRange(targetRow, 1, 1, headers.length)
      .setFontFamily("Arial")
      .setFontSize(10)
      .setVerticalAlignment("middle");
  }

  for (var col = 0; col < headers.length; col++) {
    var header = headers[col];
    if (!header) continue;
    if (sheetName === "Order_Master" && !isOrderMasterAllowedColumn_(header)) {
      continue;
    }
    var resolvedVal = resolveHeaderValueFromObj_(header, dataObj);
    if (resolvedVal === undefined) resolvedVal = "";
    var cell = sheet.getRange(targetRow, col + 1);
    writeFormattedCell_(cell, header, resolvedVal, dataObj, !hasSampleRow);
  }

  return targetRow;
}

function updateRowByKey_(sheetName, keyCandidates, keyValue, updatesObj) {
  var ss = getSS_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error("Không tìm thấy bảng dữ liệu: " + sheetName);
  }
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    return false;
  }
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) {
    return String(h).trim();
  });

  var keyList = Array.isArray(keyCandidates) ? keyCandidates : [keyCandidates];
  var keyColIndex = findHeaderIndex_(headers, keyList);
  if (keyColIndex === -1) {
    throw new Error("Không tìm thấy cột khóa " + keyList[0] + " trong " + sheetName);
  }

  var targetStr = String(keyValue).trim().replace(/^'+/, "");
  for (var r = 1; r < values.length; r++) {
    var cellKeyStr = String(values[r][keyColIndex]).trim().replace(/^'+/, "");
    if (cellKeyStr === targetStr) {
      var rowNumber = r + 1;
      for (var updateKey in updatesObj) {
        if (!Object.prototype.hasOwnProperty.call(updatesObj, updateKey)) continue;
        if (sheetName === "Order_Master" && !isOrderMasterAllowedColumn_(updateKey)) {
          continue;
        }
        var colIdx = findHeaderIndex_(headers, [updateKey]);
        if (colIdx !== -1) {
          var targetHeader = headers[colIdx];
          if (sheetName === "Order_Master" && !isOrderMasterAllowedColumn_(targetHeader)) {
            continue;
          }
          var cell = sheet.getRange(rowNumber, colIdx + 1);
          writeFormattedCell_(cell, targetHeader, updatesObj[updateKey], updatesObj, false);
        }
      }
      return true;
    }
  }
  return false;
}

function deleteRowByKey_(sheetName, keyCandidates, keyValue) {
  var ss = getSS_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error("Không tìm thấy bảng dữ liệu: " + sheetName);
  }
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return false;

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var keyList = Array.isArray(keyCandidates) ? keyCandidates : [keyCandidates];
  var keyColIndex = findHeaderIndex_(headers, keyList);
  if (keyColIndex === -1) return false;

  var targetStr = String(keyValue).trim();
  for (var r = values.length - 1; r >= 1; r--) {
    if (String(values[r][keyColIndex]).trim() === targetStr) {
      sheet.deleteRow(r + 1);
      return true;
    }
  }
  return false;
}

/**
 * ============================================================================
 * 0. ĐĂNG NHẬP & PHÂN QUYỀN (CHỈ ĐỌC SYS_Users, KHÔNG TẠO/GHI SYS_AuditLogs)
 * ============================================================================
 */
function loginUser(fullName, employeeId) {
  var nameInput = String(fullName || "").trim().toLowerCase();
  var idInput = String(employeeId || "").trim().toLowerCase();

  if (!nameInput || !idInput) {
    return {
      success: false,
      message: "Vui lòng nhập đầy đủ Họ và tên nhân viên và Mã nhân viên."
    };
  }

  var users = readSheetAsObjects_("SYS_Users");
  if (!users || users.length === 0) {
    return {
      success: false,
      message: "Không tìm thấy dữ liệu nhân viên trong hệ thống."
    };
  }

  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    var uName = String(u["Full_Name"] || "").trim().toLowerCase();
    var uId = String(u["Employee_ID"] || "").trim().toLowerCase();
    var uStatus = String(u["Status"] || "").trim().toLowerCase();

    if (uName === nameInput && uId === idInput) {
      if (uStatus !== "active") {
        return {
          success: false,
          message: "Tài khoản của bạn đang bị khóa. Vui lòng liên hệ Quản trị viên."
        };
      }
      return {
        success: true,
        user: {
          Employee_ID: String(u["Employee_ID"]),
          Full_Name: String(u["Full_Name"]),
          Department: String(u["Department"]),
          Status: String(u["Status"])
        }
      };
    }
  }

  return {
    success: false,
    message: "Họ tên hoặc Mã nhân viên không chính xác."
  };
}

/**
 * ============================================================================
 * 1. NẠP DỮ LIỆU TỔNG HỢP + TRÌNH ĐƠN THẢ XUỐNG TỪ GOOGLE SHEETS
 *    - Dùng 1 handle SpreadsheetApp duy nhất, chỉ đọc đúng vùng có dữ liệu.
 *    - Tuyệt đối KHÔNG gọi DriveApp trong hàm load trang ban đầu.
 * ============================================================================
 */
function normalizeProductImageFieldsPure_(products) {
  var imgKeys = ["Image_URL", "Image URL", "Hình ảnh", "Ảnh sản phẩm", "Image", "Photo_URL"];
  return (products || []).map(function (p) {
    for (var i = 0; i < imgKeys.length; i++) {
      var k = imgKeys[i];
      if (p[k]) {
        p[k] = normalizeDriveImageUrl_(p[k]);
      }
    }
    return p;
  });
}

function normalizeRole_(department) {
  var raw = String(department || "").trim();
  if (!raw) return "";
  var norm = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toUpperCase()
    .trim();
  if (/ADMIN|QUAN LY|QUAN TRI|GIAM DOC|MANAGER|DIRECTOR|SYSTEM/.test(norm)) return "ADMIN";
  if (/XNK|LOGISTIC|XUAT NHAP KHAU|IMPORT|EXPORT|CHUNG TU|OPS/.test(norm)) return "XNK";
  if (/SALES|SALE|KINH DOANH|\bKD\b|COMMERCIAL/.test(norm)) return "SALES";
  return norm;
}

var WORKFLOW_5_STAGES_SERVER_ = {
  1: "1. Chờ báo giá (RFQ)",
  2: "2. Chờ ký HĐ & Cọc / L/C",
  3: "3. Chờ Booking & Đóng Cont",
  4: "4. Đang làm chứng từ (Inv / P/L / C/O / HQ)",
  5: "5. Chờ vận đơn (B/L) & Quyết toán"
};
var PENDING_SALES_SIGN_STATUS_SERVER_ = "Chờ Sales đưa ký";
var SIGNED_STAGE3_STATUS_SERVER_ = "Mốc 3/5 · 3. Chờ Booking & Đóng Cont";
var COMPLETED_ORDER_STATUS_SERVER_ = "6. Hoàn tất quyết toán";

function translateFulfillmentStatusServer_(status) {
  var raw = String(status || "").trim();
  if (!raw) return WORKFLOW_5_STAGES_SERVER_[2];
  var low = raw.toLowerCase();
  if (low === "6. hoàn tất quyết toán" || low.indexOf("6.") === 0 || low.indexOf("hoàn tất") !== -1 || low.indexOf("hoàn thành") !== -1 || low.indexOf("đã giao hàng") !== -1 || low.indexOf("completed") !== -1) {
    return COMPLETED_ORDER_STATUS_SERVER_;
  }
  if (low.indexOf("1.") === 0 || low.indexOf("chờ báo giá") !== -1 || low.indexOf("rfq") !== -1 || low.indexOf("chờ tính giá") !== -1) {
    return WORKFLOW_5_STAGES_SERVER_[1];
  }
  if (low.indexOf("chờ sales đưa ký") !== -1 || low.indexOf("chờ sales đưa đi ký") !== -1 || low.indexOf("chuyển hđ cho sales") !== -1 || low.indexOf("chờ gửi khách ký") !== -1 || low.indexOf("contract sent to sales") !== -1) {
    return PENDING_SALES_SIGN_STATUS_SERVER_;
  }
  if (low.indexOf("mốc 3/5") !== -1 || low.indexOf("3.") === 0 || low.indexOf("booking") !== -1 || low.indexOf("đóng cont") !== -1 || low.indexOf("packing") !== -1 || low.indexOf("đóng hàng") !== -1 || low.indexOf("hun trùng") !== -1 || low.indexOf("kho") !== -1) {
    return raw.indexOf("Mốc 3/5") !== -1 ? SIGNED_STAGE3_STATUS_SERVER_ : WORKFLOW_5_STAGES_SERVER_[3];
  }
  if (low.indexOf("2.") === 0 || low.indexOf("nháp hợp đồng") !== -1 || low.indexOf("chờ ký hđ") !== -1 || low.indexOf("đặt cọc") !== -1 || low.indexOf("mở l/c") !== -1 || low.indexOf("đã ký hđ") !== -1 || low === "pending" || low.indexOf("deposit") !== -1) {
    return WORKFLOW_5_STAGES_SERVER_[2];
  }
  if (low.indexOf("4.") === 0 || low.indexOf("chứng từ") !== -1 || low.indexOf("hải quan") !== -1 || low.indexOf("customs") !== -1 || low.indexOf("c/o") !== -1 || low.indexOf("kiểm dịch") !== -1) {
    return WORKFLOW_5_STAGES_SERVER_[4];
  }
  if (low.indexOf("5.") === 0 || low.indexOf("vận đơn") !== -1 || low.indexOf("b/l") !== -1 || low.indexOf("quyết toán") !== -1 || low.indexOf("on board") !== -1 || low.indexOf("arrived") !== -1 || low.indexOf("thanh toán") !== -1) {
    return WORKFLOW_5_STAGES_SERVER_[5];
  }
  return WORKFLOW_5_STAGES_SERVER_[2];
}

function resolveOrderContractValue_(ord, propOpt) {
  if (!ord) return parseSmartNumber_(propOpt && propOpt["Final_Selling Price"]);
  var keys = [
    "Contract_Value", "Contract_Value_USD", "Contract Value",
    "Contract_Value_Usd", "Giá trị HĐ", "Giá trị hợp đồng", "Total_Value"
  ];
  for (var i = 0; i < keys.length; i++) {
    var v = ord[keys[i]];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      var num = parseSmartNumber_(v);
      if (num !== 0) return num;
    }
  }
  for (var k in ord) {
    if (Object.prototype.hasOwnProperty.call(ord, k)) {
      var low = String(k).toLowerCase().replace(/[\s_]/g, "");
      if (low.indexOf("contractval") !== -1 || low.indexOf("giatri") !== -1) {
        var fv = parseSmartNumber_(ord[k]);
        if (fv !== 0) return fv;
      }
    }
  }
  if (propOpt && propOpt["Final_Selling Price"] !== undefined) {
    return parseSmartNumber_(propOpt["Final_Selling Price"]);
  }
  return 0;
}

function normalizeOrderMasterRows_(orders) {
  if (!orders || !orders.length) return [];
  return orders.map(function (o) {
    var val = resolveOrderContractValue_(o, null);
    o["Contract_Value"] = val;
    o["Contract_Value_USD"] = val;
    o["Fulfillment_Status"] = translateFulfillmentStatusServer_(o["Fulfillment_Status"]);
    return o;
  });
}

function normalizeProposalRows_(proposals) {
  if (!proposals || !proposals.length) return [];
  return proposals.map(function (p) {
    var oid = String(p["Order ID"] || p["Order_ID"] || p["Mã đơn"] || "").trim().replace(/-(?:V|R)\d+$/i, "");
    var sellPrice = parseSmartNumber_(
      p["Final_Selling Price"] !== undefined
        ? p["Final_Selling Price"]
        : (p["Final_Selling_Price"] !== undefined ? p["Final_Selling_Price"] : p["Final_Selling"])
    );
    var recInc = String(p["Recommended Incoterm"] || p["Recommended_Incoterm"] || p["Incoterm"] || "CIF").trim().toUpperCase();
    var rawQ = String(p["Quote_ID"] || p["Quotation_No"] || (oid ? ("QT-" + oid) : "")).trim();
    var qNo = rawQ.replace(/-(?:V|R)\d+$/i, "") || (oid ? ("QT-" + oid) : "");
    var bStatus = String(p["Booking_Status"] || p["Status"] || "Đã tính giá / Sẵn sàng báo giá").trim();
    var floorVal = parseSmartNumber_(p["Floor_Price_USD"]);
    if (floorVal <= 0) floorVal = sellPrice;
    p["Order ID"] = oid;
    p["Order_ID"] = oid;
    p["Price_Version"] = "";
    p["Quote_ID"] = qNo;
    p["Quotation_No"] = qNo;
    p["Recommended Incoterm"] = recInc;
    p["Final_Selling Price"] = sellPrice;
    p["Final_Selling_Price"] = sellPrice;
    p["Floor_Price_USD"] = floorVal;
    p["Booking_Status"] = bStatus;
    return p;
  });
}

function getInitialBundleData(department) {
  var role = normalizeRole_(department);
  var ss = getSS_();

  var inquiries = readSheetAsObjects_("Inquiry_Quotation", ss);
  var proposals = normalizeProposalRows_(readSheetAsObjects_("Pricing_Proposal", ss));
  var orders = normalizeOrderMasterRows_(readSheetAsObjects_("Order_Master", ss));
  var schedules = readSheetAsObjects_("Shipping_Schedule", ss);
  var consignees = recalculateConsigneeStatsServer_(ss, false, orders, readSheetAsObjects_("Consignee_Directory", ss));
  var products = normalizeProductImageFieldsPure_(readSheetAsObjects_("Product_Catalog", ss));
  var incoterms = readSheetAsObjects_("Incoterms_Handbook", ss);
  var pricingRates = enrichPricingRatesWithDefaultsServer_(readSheetAsObjects_("Pricing_Rates", ss));
  var localCharges = readSheetAsObjects_("Local_Charges", ss);
  var customsFees = readSheetAsObjects_("Customs_Service_Fees", ss);
  var templates = readSheetAsObjects_("Template_Manager", ss);
  var lookups = readSheetAsObjects_("System_Lookups", ss);
  var allUsersRaw = readSheetAsObjects_("SYS_Users", ss);
  var users = role === "ADMIN" ? allUsersRaw : [];
  var staffDirectory = allUsersRaw.map(function (u) {
    return {
      Employee_ID: u["Employee_ID"] || "",
      Full_Name: u["Full_Name"] || "",
      Department: u["Department"] || "",
      Email: u["Email"] || u["User_Email"] || "",
      Status: u["Status"] || "Active"
    };
  });
  var dropdowns = getAllSheetDropdowns_(ss);

  if ((!localCharges || localCharges.length === 0) && pricingRates.length > 0) {
    localCharges = pricingRates
      .filter(function (r) { return String(r["Fee_Category"] || "").trim().toUpperCase() === "LOCAL_CHARGE"; })
      .map(function (r) {
        return {
          Charge_Code: r["Fee_Code"] || "",
          Charge_Name: r["Fee_Name_VIE"] || r["Contract_Text_ENG"] || "",
          Charge_Category: r["Provider_or_Rule"] || "Cảng vụ",
          Unit: r["Unit_Basis"] || "Container",
          Standard_Fee: parseSmartNumber_(r["Standard_Rate"]),
          Applicable_ContType: r["Scope_or_ContType"] || "ALL",
          Note: r["Note"] || ""
        };
      });
  }

  if ((!customsFees || customsFees.length === 0) && pricingRates.length > 0) {
    customsFees = pricingRates
      .filter(function (r) { return String(r["Fee_Category"] || "").trim().toUpperCase() === "CUSTOMS_FEE"; })
      .map(function (r) {
        return {
          Service_Code: r["Fee_Code"] || "",
          Service_Name: r["Fee_Name_VIE"] || r["Contract_Text_ENG"] || "",
          Unit: r["Unit_Basis"] || "Lô hàng",
          Standard_Fee: parseSmartNumber_(r["Standard_Rate"]),
          Provider: r["Provider_or_Rule"] || "Cơ quan kiểm dịch / Hải quan",
          Note: r["Note"] || ""
        };
      });
  }

  var today = new Date();
  today.setHours(0, 0, 0, 0);
  schedules = schedules.map(function (s) {
    if (s["Expiry_Date"]) {
      var exp = new Date(s["Expiry_Date"]);
      if (!isNaN(exp.getTime())) {
        exp.setHours(0, 0, 0, 0);
        s["Days còn lại"] = Math.round((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        return s;
      }
    }
    var days = s["Days còn lại"];
    s["Days còn lại"] = (days === "" || days === null || days === undefined) ? 0 : Number(days);
    return s;
  });

  return {
    inquiries: inquiries,
    proposals: proposals,
    orders: orders,
    schedules: schedules,
    consignees: consignees,
    products: products,
    incoterms: incoterms,
    pricingRates: pricingRates,
    localCharges: localCharges,
    customsFees: customsFees,
    templates: templates,
    lookups: lookups,
    users: users,
    staffDirectory: staffDirectory,
    dropdowns: dropdowns,
    companyLogoId: COMPANY_LOGO_ID
  };
}

function getInitialAppData(department) {
  return getInitialBundleData(department);
}

function getAppBootstrapData(department) {
  return getInitialBundleData(department);
}

function getModuleBundleData(moduleKey, department) {
  var key = String(moduleKey || "").trim().toLowerCase();
  var role = normalizeRole_(department);
  var ss = getSS_();
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  function computeSchedulesWithDays_() {
    var list = readSheetAsObjects_("Shipping_Schedule", ss);
    return list.map(function (s) {
      if (s["Expiry_Date"]) {
        var exp = new Date(s["Expiry_Date"]);
        if (!isNaN(exp.getTime())) {
          exp.setHours(0, 0, 0, 0);
          s["Days còn lại"] = Math.round((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          return s;
        }
      }
      var days = s["Days còn lại"];
      s["Days còn lại"] = (days === "" || days === null || days === undefined) ? 0 : Number(days);
      return s;
    });
  }

  var partial = {};
  if (key === "dashboard") {
    partial.inquiries = readSheetAsObjects_("Inquiry_Quotation", ss);
    partial.proposals = normalizeProposalRows_(readSheetAsObjects_("Pricing_Proposal", ss));
    partial.orders = normalizeOrderMasterRows_(readSheetAsObjects_("Order_Master", ss));
    partial.schedules = computeSchedulesWithDays_();
    partial.consignees = recalculateConsigneeStatsServer_(ss, false, partial.orders, readSheetAsObjects_("Consignee_Directory", ss));
    partial.products = normalizeProductImageFieldsPure_(readSheetAsObjects_("Product_Catalog", ss));
  } else if (key === "sales-inquiry") {
    partial.inquiries = readSheetAsObjects_("Inquiry_Quotation", ss);
    partial.consignees = readSheetAsObjects_("Consignee_Directory", ss);
    partial.products = normalizeProductImageFieldsPure_(readSheetAsObjects_("Product_Catalog", ss));
    partial.pricingRates = enrichPricingRatesWithDefaultsServer_(readSheetAsObjects_("Pricing_Rates", ss));
    partial.lookups = readSheetAsObjects_("System_Lookups", ss);
  } else if (key === "sales-quotation") {
    partial.inquiries = readSheetAsObjects_("Inquiry_Quotation", ss);
    partial.proposals = normalizeProposalRows_(readSheetAsObjects_("Pricing_Proposal", ss));
    partial.orders = normalizeOrderMasterRows_(readSheetAsObjects_("Order_Master", ss));
    partial.schedules = computeSchedulesWithDays_();
    partial.consignees = recalculateConsigneeStatsServer_(ss, false, partial.orders, readSheetAsObjects_("Consignee_Directory", ss));
    partial.products = normalizeProductImageFieldsPure_(readSheetAsObjects_("Product_Catalog", ss));
    partial.pricingRates = enrichPricingRatesWithDefaultsServer_(readSheetAsObjects_("Pricing_Rates", ss));
    partial.templates = readSheetAsObjects_("Template_Manager", ss);
    partial.lookups = readSheetAsObjects_("System_Lookups", ss);
  } else if (key === "sales-contracts") {
    partial.orders = normalizeOrderMasterRows_(readSheetAsObjects_("Order_Master", ss));
    partial.inquiries = readSheetAsObjects_("Inquiry_Quotation", ss);
    partial.proposals = normalizeProposalRows_(readSheetAsObjects_("Pricing_Proposal", ss));
    partial.consignees = recalculateConsigneeStatsServer_(ss, false, partial.orders, readSheetAsObjects_("Consignee_Directory", ss));
    partial.products = normalizeProductImageFieldsPure_(readSheetAsObjects_("Product_Catalog", ss));
    partial.templates = readSheetAsObjects_("Template_Manager", ss);
    partial.lookups = readSheetAsObjects_("System_Lookups", ss);
  } else if (key === "sales-customers") {
    partial.orders = normalizeOrderMasterRows_(readSheetAsObjects_("Order_Master", ss));
    partial.consignees = recalculateConsigneeStatsServer_(ss, false, partial.orders, readSheetAsObjects_("Consignee_Directory", ss));
  } else if (key === "xnk-pricing") {
    partial.inquiries = readSheetAsObjects_("Inquiry_Quotation", ss);
    partial.proposals = normalizeProposalRows_(readSheetAsObjects_("Pricing_Proposal", ss));
    partial.schedules = computeSchedulesWithDays_();
    partial.consignees = readSheetAsObjects_("Consignee_Directory", ss);
    partial.products = normalizeProductImageFieldsPure_(readSheetAsObjects_("Product_Catalog", ss));
    partial.pricingRates = enrichPricingRatesWithDefaultsServer_(readSheetAsObjects_("Pricing_Rates", ss));
    partial.incoterms = readSheetAsObjects_("Incoterms_Handbook", ss);
    partial.lookups = readSheetAsObjects_("System_Lookups", ss);
  } else if (key === "xnk-contract") {
    partial.orders = normalizeOrderMasterRows_(readSheetAsObjects_("Order_Master", ss));
    partial.inquiries = readSheetAsObjects_("Inquiry_Quotation", ss);
    partial.proposals = normalizeProposalRows_(readSheetAsObjects_("Pricing_Proposal", ss));
    partial.schedules = computeSchedulesWithDays_();
    partial.consignees = readSheetAsObjects_("Consignee_Directory", ss);
    partial.products = normalizeProductImageFieldsPure_(readSheetAsObjects_("Product_Catalog", ss));
    partial.templates = readSheetAsObjects_("Template_Manager", ss);
    partial.lookups = readSheetAsObjects_("System_Lookups", ss);
  } else if (key === "xnk-documents") {
    partial.orders = normalizeOrderMasterRows_(readSheetAsObjects_("Order_Master", ss));
    partial.inquiries = readSheetAsObjects_("Inquiry_Quotation", ss);
    partial.proposals = normalizeProposalRows_(readSheetAsObjects_("Pricing_Proposal", ss));
    partial.consignees = readSheetAsObjects_("Consignee_Directory", ss);
    partial.products = normalizeProductImageFieldsPure_(readSheetAsObjects_("Product_Catalog", ss));
    partial.templates = readSheetAsObjects_("Template_Manager", ss);
  } else if (key === "cat-shipping" || key === "xnk-shipping") {
    partial.schedules = computeSchedulesWithDays_();
  } else if (key === "xnk-rates" || key === "cat-rates") {
    partial.pricingRates = enrichPricingRatesWithDefaultsServer_(readSheetAsObjects_("Pricing_Rates", ss));
    partial.lookups = readSheetAsObjects_("System_Lookups", ss);
  } else if (key === "cat-products" || key === "xnk-products" || key === "master-products") {
    partial.products = normalizeProductImageFieldsPure_(readSheetAsObjects_("Product_Catalog", ss));
  } else if (key === "cat-templates" || key === "xnk-templates" || key === "admin-templates") {
    partial.templates = readSheetAsObjects_("Template_Manager", ss);
  } else if (key === "admin-users") {
    var allUsersScoped = readSheetAsObjects_("SYS_Users", ss);
    partial.users = role === "ADMIN" ? allUsersScoped : [];
    partial.staffDirectory = allUsersScoped.map(function (u) {
      return {
        Employee_ID: u["Employee_ID"] || "",
        Full_Name: u["Full_Name"] || "",
        Department: u["Department"] || "",
        Email: u["Email"] || u["User_Email"] || "",
        Status: u["Status"] || "Active"
      };
    });
  } else {
    partial = getInitialBundleData(department);
  }

  return {
    success: true,
    moduleKey: key,
    syncedAt: Utilities.formatDate(new Date(), TIMEZONE, "HH:mm:ss dd/MM/yyyy"),
    data: partial
  };
}

/**
 * ============================================================================
 * HELPERS: REGEX FILE ID, SYSTEM_LOOKUPS, INCOTERMS & TEMPLATE AUTO-SELECTION
 * ============================================================================
 */
function extractGoogleDocId_(input) {
  var s = String(input || "").trim();
  if (!s) return "";
  var m = s.match(/[-\w]{25,}/);
  return m ? m[0] : s;
}

function getFieldFuzzy_(obj, exactCandidates, partialKeywords) {
  if (!obj || typeof obj !== "object") return "";
  var keys = Object.keys(obj);
  for (var i = 0; i < exactCandidates.length; i++) {
    var k = exactCandidates[i];
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  for (var j = 0; j < exactCandidates.length; j++) {
    var normCand = String(exactCandidates[j]).toLowerCase().replace(/[\s_()/-]/g, "");
    for (var m = 0; m < keys.length; m++) {
      if (keys[m] === "_rowIndex") continue;
      var normKey = String(keys[m]).toLowerCase().replace(/[\s_()/-]/g, "");
      if (normKey === normCand && obj[keys[m]] !== undefined && obj[keys[m]] !== null && obj[keys[m]] !== "") {
        return obj[keys[m]];
      }
    }
  }
  if (partialKeywords && partialKeywords.length > 0) {
    for (var p = 0; p < partialKeywords.length; p++) {
      var kw = String(partialKeywords[p]).toLowerCase();
      for (var c = 0; c < keys.length; c++) {
        if (keys[c] === "_rowIndex") continue;
        if (String(keys[c]).toLowerCase().indexOf(kw) !== -1 && obj[keys[c]] !== undefined && obj[keys[c]] !== null && obj[keys[c]] !== "") {
          return obj[keys[c]];
        }
      }
    }
  }
  return "";
}

function findSystemLookup_(lookups, category, codeOrDisplay) {
  var catUpper = String(category || "").trim().toUpperCase();
  var target = String(codeOrDisplay || "").trim().toLowerCase();
  if (!target) return null;
  for (var i = 0; i < (lookups || []).length; i++) {
    var row = lookups[i];
    if (String(row["Category"] || "").trim().toUpperCase() !== catUpper) continue;
    var code = String(row["Code"] || "").trim().toLowerCase();
    var disp = String(row["Display_Name_VIE"] || "").trim().toLowerCase();
    var eng = String(row["Contract_Text_ENG"] || "").trim().toLowerCase();
    if (code === target || disp === target || eng === target) {
      return row;
    }
  }
  for (var j = 0; j < (lookups || []).length; j++) {
    var r2 = lookups[j];
    if (String(r2["Category"] || "").trim().toUpperCase() !== catUpper) continue;
    var c2 = String(r2["Code"] || "").trim().toLowerCase();
    var d2 = String(r2["Display_Name_VIE"] || "").trim().toLowerCase();
    if ((c2 && target.indexOf(c2) !== -1) || (d2 && target.indexOf(d2) !== -1) || (c2 && c2.indexOf(target) !== -1)) {
      return r2;
    }
  }
  return null;
}

function saveTemplateManagerItem(payload) {
  if (!payload || typeof payload !== "object") {
    return { success: false, message: "Thiếu dữ liệu biểu mẫu." };
  }
  var templateId = String(payload["Template ID"] || payload.Template_ID || "").trim();
  if (!templateId) {
    return { success: false, message: "Vui lòng nhập Mã biểu mẫu." };
  }
  var rawDocInput = payload["Google_Doc_File_ID"] || payload.docUrlOrId || "";
  var cleanDocId = extractGoogleDocId_(rawDocInput);
  var rowObj = {
    "Template ID": templateId,
    "Document_Name": String(payload["Document_Name"] || "").trim(),
    "Google_Doc_File_ID": cleanDocId,
    "Target_Department": String(payload["Target_Department"] || "XNK").trim(),
    "Status": String(payload["Status"] || "Active").trim()
  };

  var existing = readSheetAsObjects_("Template_Manager");
  var found = false;
  for (var i = 0; i < existing.length; i++) {
    if (String(existing[i]["Template ID"] || "").trim() === templateId) {
      found = true;
      break;
    }
  }
  if (found) {
    updateRowByKey_("Template_Manager", ["Template ID", "Template_ID"], templateId, rowObj);
  } else {
    appendObjectToSheet_("Template_Manager", rowObj, ["Template ID", "Document_Name", "Google_Doc_File_ID", "Target_Department", "Status"]);
  }
  return { success: true, data: rowObj };
}

function findHeaderIndexFuzzy_(headers, exactCandidates, keywordCandidates) {
  var idx = findHeaderIndex_(headers, exactCandidates);
  if (idx !== -1) return idx;
  if (!keywordCandidates || keywordCandidates.length === 0) return -1;
  for (var i = 0; i < headers.length; i++) {
    var hNorm = String(headers[i] || "").toLowerCase();
    for (var k = 0; k < keywordCandidates.length; k++) {
      if (hNorm.indexOf(keywordCandidates[k]) !== -1) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * ============================================================================
 * 4.1. QUẢN LÝ TÀI KHOẢN & PHÂN QUYỀN (SYS_Users)
 * ============================================================================
 */
function createUserAccount(payload) {
  var users = readSheetAsObjects_("SYS_Users");
  var empId = String(payload.Employee_ID || "").trim();
  for (var i = 0; i < users.length; i++) {
    if (String(users[i]["Employee_ID"]).trim() === empId) {
      return { success: false, message: "Mã nhân viên " + empId + " đã tồn tại." };
    }
  }
  var rowObj = {
    "Employee_ID": empId,
    "Full_Name": String(payload.Full_Name || "").trim(),
    "Department": String(payload.Department || "Sales").trim(),
    "Email": String(payload.Email || "").trim(),
    "Status": String(payload.Status || "Active").trim()
  };
  appendObjectToSheet_("SYS_Users", rowObj, ["Employee_ID", "Full_Name", "Department", "Email", "Status"]);
  return { success: true, data: rowObj };
}

function updateUserAccount(employeeId, updates) {
  var updated = updateRowByKey_("SYS_Users", "Employee_ID", employeeId, updates);
  return { success: updated };
}
