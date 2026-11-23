import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

interface AiRequestBody {
  action?: 'incoterm_advisor' | 'smart_fill_template' | 'smart_fill_hash_markers' | 'translate_logistics';
  text?: string;
  context?: string;
  orderId?: string;
  question?: string;
  chatHistory?: Array<{ role: string; text: string }>;
  insuranceRates?: Array<{
    fee_code?: string;
    fee_name_vie?: string;
    standard_rate?: number;
    provider_or_rule?: string;
  }>;
  incotermsHandbook?: Array<{
    incoterms_code?: string;
    full_name?: string;
    risk_benefit_seller?: string;
    activation_condition?: string;
    practical_notes_vie?: string;
  }>;
  orderContext?: Record<string, unknown>;
  documentName?: string;
  targetDepartment?: string;
  blocks?: Array<{ id: string; text: string; hasMarker?: boolean; contextHint?: string }>;
  existingPlaceholders?: Array<{
    placeholder_key: string;
    scope: string;
    source_table: string;
    source_column: string;
    description_vie: string;
  }>;
}

async function handleTranslateLogistics(ai: GoogleGenAI, body: AiRequestBody) {
  const sourceText = String(body.text || '').trim();
  const context = String(body.context || 'GENERAL').toUpperCase();
  if (!sourceText) {
    return { success: true, translatedText: '' };
  }

  const systemInstruction = [
    'You are a senior international maritime logistics, Incoterms 2020, marine cargo insurance, and agricultural export trade translator.',
    'Translate the provided Vietnamese logistics/trade/product phrase into concise, idiomatic, contract-ready English.',
    'STRICT RULES:',
    '1. Output ONLY pure English international trade terminology with ZERO remaining Vietnamese words or diacritics.',
    '2. Follow exact ICC / maritime / export contract conventions:',
    '   - "Điều khoản mở rộng: Rủi ro hấp hơi, nóng ẩm" -> "incl. Sweating & Heating Clause"',
    '   - "Bảo hiểm hàng đông lạnh" -> "Institute Frozen Food Clauses (A)"',
    '   - "Bảo hiểm mọi rủi ro" -> "Institute Cargo Clauses (A) - All Risks"',
    '   - "Phí xếp dỡ tại cảng" -> "Terminal Handling Charge (THC)"',
    '   - "Phí kiểm dịch thực vật" -> "Phytosanitary Inspection & Certificate Fee"',
    '3. Keep it concise (suitable for a Sales Contract, Commercial Invoice, Packing List, or Pricing Rate table). Do not add explanations.',
  ].join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Category: ${context}\nVietnamese text: ${sourceText}`,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          translatedText: {
            type: Type.STRING,
            description: 'Clean, idiomatic international trade English translation with zero Vietnamese words',
          },
        },
        required: ['translatedText'],
      },
    },
  });

  const rawText = (response.text || '{}').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const parsed = JSON.parse(rawText || '{}');
  return {
    success: true,
    translatedText: String(parsed.translatedText || '').trim(),
  };
}

async function handleSmartFillHashMarkers(ai: GoogleGenAI, body: AiRequestBody) {
  const blocks = Array.isArray(body.blocks) ? body.blocks : [];
  const existing = Array.isArray(body.existingPlaceholders) ? body.existingPlaceholders : [];
  const docName = String(body.documentName || 'Export Document');
  const dept = String(body.targetDepartment || 'Xuất nhập khẩu (XNK)');

  const markedBlocks = blocks.filter((b) => b.hasMarker || String(b.text || '').includes('#'));
  if (markedBlocks.length === 0) {
    return {
      success: true,
      replacements: [],
      newPlaceholders: [],
      summary: 'Không tìm thấy dấu # nào trong nội dung văn bản.',
    };
  }

  const normalizedExisting = existing.map((p) => ({
    ...p,
    placeholder_key: String(p.placeholder_key || '').trim().replace(/^\{+|\}+$/g, '').toUpperCase(),
  }));

  const systemInstruction = [
    'Bạn là Kỹ sư Chuẩn hóa Phôi mẫu Chứng từ Xuất nhập khẩu (Docxtemplater {{PLACEHOLDER}} Architect) cho hệ thống GREEN AGRI-EXPORTS.',
    'Nhiệm vụ DUY NHẤT: Phân tích ngữ cảnh xung quanh TỪNG dấu `#` trong các block văn bản được đánh dấu (hasMarker: true), XÓA dấu `#` đó và thay thế bằng đúng thẻ `{{PLACEHOLDER_KEY}}` khớp nhất từ danh mục `existingPlaceholders`.',
    'Quy tắc BẮT BUỘC:',
    '1. CHỈ trả về các block có chứa dấu `#` (hoặc hasMarker: true). Giữ nguyên 100% văn bản xung quanh và các thẻ `{{...}}` đã có sẵn — chỉ xóa dấu `#` và thay bằng `{{PLACEHOLDER_KEY}}`.',
    '2. XÓA SẠCH tất cả dấu `#` trong các block đó; mỗi dấu `#` phải được thay bằng đúng 1 thẻ `{{PLACEHOLDER_KEY}}` phù hợp ngữ cảnh (xem xét nhãn phía trước dấu `#`, văn bản phía sau, và các block lân cận / contextHint).',
    '3. ƯU TIÊN TUYỆT ĐỐI tái sử dụng đúng `placeholder_key` có sẵn trong `existingPlaceholders` (VD: {{CTR_NO}}, {{CTR_DT}}, {{QUOT_NO}}, {{QUOT_DT}}, {{SALE_NAME}}, {{CNE_NAME}}, {{CNE_ADDR}}, {{CNE_TAX}}, {{CNE_TEL}}, {{CNE_EMAIL}}, {{BUYER_NAME}}, {{BUYER_REP}}, {{BUYER_TITLE}}, {{POL}}, {{POD}}, {{INCOTERM}}, {{INCOTERM_PLACE}}, {{PAY_TERM}}, {{CO_FORM}}, {{INS_TERM}}, {{FREIGHT}}, {{TOT_AMT}}, {{TOTAL_AMT}}, {{TOT_AMT_WORDS}}, {{CTR_VAL}}, {{ITEM_STT}}, {{ITEM_NAME}}, {{ITEM_SKU}}, {{ITEM_HS}}, {{ITEM_PACK}}, {{ITEM_QTY}}, {{ITEM_PRICE}}, {{ITEM_AMT}}, {{NW_KGS}}, {{GW_KGS}}, {{CARTONS}}, {{PALLETS}}, {{CBM}}, {{CONT_TYPE}}, {{BK_NO}}, {{VES_VOY}}, {{CONT_SEAL}}, {{ETD}}, {{ETA}}...).',
    '4. Chỉ tạo biến MỚI trong `newPlaceholders` (UPPER_SNAKE_CASE, ngắn gọn, có mô tả tiếng Việt rõ ràng) nếu trong `existingPlaceholders` hoàn toàn KHÔNG có biến nào khớp ngữ nghĩa với vị trí dấu `#`.',
    '5. KHÔNG BAO GIỜ đặt `source_column` là `"TBA"` — hãy chỉ định tên cột thật hoặc mô tả công thức ngắn gọn.',
  ].join('\n');

  const prompt = [
    `Tên chứng từ: ${docName} · Phòng ban: ${dept}`,
    `Danh mục biến chuẩn hiện có (existingPlaceholders):\n${JSON.stringify(normalizedExisting)}`,
    `Ngữ cảnh tài liệu (các block có hasMarker=true là các block cần xóa dấu # và thay bằng {{KEY}}; các block khác chỉ để tham khảo ngữ cảnh):\n${JSON.stringify(blocks)}`,
  ].join('\n\n');

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          replacements: {
            type: Type.ARRAY,
            description: 'Danh sách các block đã xóa # và thay bằng {{KEY}}',
            items: {
              type: Type.OBJECT,
              properties: {
                blockId: { type: Type.STRING, description: 'ID của block trong danh sách đầu vào' },
                taggedText: { type: Type.STRING, description: 'Toàn bộ nội dung của block sau khi xóa # và điền {{KEY}}' },
              },
              required: ['blockId', 'taggedText'],
            },
          },
          newPlaceholders: {
            type: Type.ARRAY,
            description: 'Chỉ liệt kê các biến MỚI tạo chưa có trong existingPlaceholders',
            items: {
              type: Type.OBJECT,
              properties: {
                placeholder_key: { type: Type.STRING, description: 'Tên biến viết hoa không có ngoặc, VD: BUYER_BANK' },
                scope: { type: Type.STRING, description: 'ALL, CONTRACT, QUOTATION, INVOICE, PACKING_LIST, CO, BL' },
                source_table: { type: Type.STRING, description: 'order_master | consignee_directory | product_catalog | pricing_proposal | inquiry_quotation | shipping_schedule | incoterms_handbook | pricing_rates | system_lookups | sys_users | computed' },
                source_column: { type: Type.STRING, description: 'Tên cột hoặc công thức nguồn (không dùng TBA)' },
                description_vie: { type: Type.STRING, description: 'Mô tả rõ ràng bằng tiếng Việt' },
              },
              required: ['placeholder_key', 'scope', 'source_table', 'source_column', 'description_vie'],
            },
          },
          summary: { type: Type.STRING, description: 'Tóm tắt ngắn những biến đã điền thay dấu #' },
        },
        required: ['replacements', 'newPlaceholders', 'summary'],
      },
    },
  });

  const rawText = (response.text || '{}').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const parsed = JSON.parse(rawText || '{}');
  return {
    success: true,
    ...parsed,
  };
}

async function handleSmartFillTemplate(ai: GoogleGenAI, body: AiRequestBody) {
  const blocks = Array.isArray(body.blocks) ? body.blocks : [];
  const existing = Array.isArray(body.existingPlaceholders) ? body.existingPlaceholders : [];
  const docName = String(body.documentName || 'Export Document');
  const dept = String(body.targetDepartment || 'Xuất nhập khẩu (XNK)');

  const normalizedExisting = existing.map((p) => ({
    ...p,
    placeholder_key: String(p.placeholder_key || '').trim().replace(/^\{+|\}+$/g, '').toUpperCase(),
  }));

  const systemInstruction = [
    'Bạn là Kỹ sư Chuẩn hóa Phôi mẫu Chứng từ Xuất nhập khẩu (Docxtemplater {{PLACEHOLDER}} Architect) cho hệ thống GREEN AGRI-EXPORTS.',
    'Nhiệm vụ: Nhận danh sách các đoạn văn bản (blocks) trích từ file .docx thô chưa gắn biến, cùng danh mục biến chuẩn hiện có (existingPlaceholders).',
    'Quy tắc BẮT BUỘC:',
    '1. ƯU TIÊN TUYỆT ĐỐI tái sử dụng các placeholder_key có sẵn trong existingPlaceholders (ví dụ {{CNE_NAME}}, {{CNE_ADDR}}, {{CNE_TAX}}, {{BUYER_NAME}}, {{CNE_TEL}}, {{CNE_EMAIL}}, {{CTR_NO}}, {{CTR_DT}}, {{CTR_VAL}}, {{TOT_AMT_WORDS}}, {{INCOTERM}}, {{INCOTERM_PLACE}}, {{PAY_TERM}}, {{POL}}, {{POD}}, {{CO_FORM}}, {{INS_TERM}}, {{FREIGHT}}, {{PROD_NAME_ENG}}, {{HS_CODE}}, {{NW_KGS}}, {{GW_KGS}}, {{CARTONS}}, {{PALLETS}}, {{CBM}}, {{UNIT_PRICE}}, {{VES_VOY}}, {{BK_NO}}...).',
    '2. Chỉ tạo placeholder_key MỚI (UPPER_SNAKE_CASE, ngắn gọn, chuẩn quốc tế) nếu hoàn toàn KHÔNG có biến nào trong existingPlaceholders phù hợp với trường dữ liệu động đó.',
    '3. Mỗi block cần gắn biến phải trả về nguyên văn câu/dòng đó với phần dữ liệu mẫu/chỗ trống (như "....", "[Company Name]", ngày mẫu, số tiền mẫu, tên khách mẫu) được thay bằng {{KEY}}. Giữ nguyên các tiêu đề/điều khoản pháp lý cố định!',
    '4. KHÔNG sửa những block chỉ là tiêu đề hoặc văn bản pháp lý tĩnh không có dữ liệu động của đơn hàng.',
    '5. Với mỗi biến MỚI trong newPlaceholders, khai báo rõ source_table (trong: order_master, consignee_directory, product_catalog, pricing_proposal, inquiry_quotation, shipping_schedule, incoterms_handbook, pricing_rates, system_lookups, sys_users, computed) và source_column tương ứng (không dùng TBA).',
  ].join('\n');

  const prompt = [
    `Tên chứng từ: ${docName} · Phòng ban: ${dept}`,
    `Danh mục biến chuẩn hiện có (existingPlaceholders):\n${JSON.stringify(normalizedExisting)}`,
    `Danh sách đoạn văn bản trong .docx (blocks):\n${JSON.stringify(blocks)}`,
  ].join('\n\n');

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          replacements: {
            type: Type.ARRAY,
            description: 'Danh sách các block được gắn biến {{KEY}}',
            items: {
              type: Type.OBJECT,
              properties: {
                blockId: { type: Type.STRING, description: 'ID của block trong danh sách đầu vào' },
                taggedText: { type: Type.STRING, description: 'Toàn bộ nội dung mới của block sau khi chèn {{KEY}}' },
              },
              required: ['blockId', 'taggedText'],
            },
          },
          newPlaceholders: {
            type: Type.ARRAY,
            description: 'Chỉ liệt kê các biến MỚI tạo chưa có trong existingPlaceholders',
            items: {
              type: Type.OBJECT,
              properties: {
                placeholder_key: { type: Type.STRING, description: 'Tên biến viết hoa không có ngoặc, VD: BUYER_BANK' },
                scope: { type: Type.STRING, description: 'ALL, CONTRACT, QUOTATION, INVOICE, PACKING_LIST, CO, BL' },
                source_table: { type: Type.STRING, description: 'order_master | consignee_directory | product_catalog | pricing_proposal | inquiry_quotation | shipping_schedule | incoterms_handbook | pricing_rates | system_lookups | sys_users | computed' },
                source_column: { type: Type.STRING, description: 'Tên cột hoặc công thức nguồn' },
                description_vie: { type: Type.STRING, description: 'Mô tả ngắn bằng tiếng Việt' },
              },
              required: ['placeholder_key', 'scope', 'source_table', 'source_column', 'description_vie'],
            },
          },
          summary: { type: Type.STRING, description: 'Tóm tắt ngắn những biến đã gắn vào phôi' },
        },
        required: ['replacements', 'newPlaceholders', 'summary'],
      },
    },
  });

  const rawText = (response.text || '{}').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const parsed = JSON.parse(rawText || '{}');
  return {
    success: true,
    ...parsed,
  };
}

export async function runGeminiIncotermAdvisor(body: AiRequestBody, apiKey: string) {
  if (!apiKey) {
    throw new Error('Chưa cấu hình GEMINI_API_KEY trên máy chủ. Vui lòng thiết lập trong Settings > Secrets.');
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  if (body.action === 'translate_logistics') {
    return handleTranslateLogistics(ai, body);
  }

  if (body.action === 'smart_fill_hash_markers') {
    return handleSmartFillHashMarkers(ai, body);
  }

  if (body.action === 'smart_fill_template') {
    return handleSmartFillTemplate(ai, body);
  }

  const orderCtx = body.orderContext || {};
  const question = String(body.question || '').trim();
  const history = Array.isArray(body.chatHistory) ? body.chatHistory.slice(-6) : [];
  const insList = Array.isArray(body.insuranceRates) ? body.insuranceRates : [];
  const handbook = Array.isArray(body.incotermsHandbook) ? body.incotermsHandbook : [];

  const systemInstruction = [
    'Bạn là Chuyên gia Xuất Nhập Khẩu Nông sản Việt Nam (GREEN AGRI-EXPORTS / Nông Sản Xanh).',
    'Nhiệm vụ: Phân tích đơn hàng xuất khẩu, đề xuất 2-4 điều kiện Incoterms 2020 phù hợp nhất (chọn 1 bestIncoterm tối ưu nhất), đồng thời đề xuất gói Bảo hiểm hàng hóa (recommendedInsuranceCode + recommendedInsuranceAddons nếu cần).',
    'Quy tắc Incoterms & Bảo hiểm:',
    '- Hàng lạnh / Reefer (RF/RH): tránh EXW/FOB thuần nếu đường biển dài, ưu tiên CIP (bắt buộc ICC A / INS-FRZ-A) hoặc CIF/CFR kèm giám sát nhiệt độ.',
    '- Hàng nông sản khô (DC/HC) thanh toán L/C hoặc D/P: ưu tiên CIF/CIP để người bán kiểm soát B/L và chứng từ bảo hiểm.',
    '- CIF tối thiểu INS-ICC-C (nông sản khô đường biển dài nên thêm INS-EXT-SWH chống hấp hơi nóng ẩm); CIP bắt buộc INS-ICC-A (hoặc INS-FRZ-A nếu hàng lạnh).',
    '- Nếu không chọn CIF/CIP thì recommendedInsuranceCode = "INS-NONE".',
    '- Trả lời súc tích, thực chiến bằng tiếng Việt, đúng JSON schema yêu cầu.',
  ].join('\n');

  const promptParts = [
    `Hồ sơ đơn hàng:\n${JSON.stringify(orderCtx, null, 2)}`,
    insList.length ? `Danh mục bảo hiểm:\n${JSON.stringify(insList.slice(0, 12))}` : '',
    handbook.length ? `Cẩm nang Incoterms tóm tắt:\n${JSON.stringify(handbook.slice(0, 11))}` : '',
    history.length ? `Lịch sử trao đổi gần đây:\n${history.map((m) => `${m.role}: ${m.text}`).join('\n')}` : '',
    question ? `Câu hỏi của nhân viên XNK: ${question}` : 'Hãy phân tích toàn diện đơn hàng này và đưa ra phương án Incoterms 2020 + Bảo hiểm tối ưu nhất.',
  ].filter(Boolean);

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite',
    contents: promptParts.join('\n\n'),
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          replyText: { type: Type.STRING, description: 'Phân tích chi tiết bằng tiếng Việt rõ ràng, thực chiến' },
          recommendedIncoterms: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Danh sách 2-4 mã Incoterms 2020 viết hoa như FOB, CIF, CIP, CFR',
          },
          bestIncoterm: { type: Type.STRING, description: '1 mã Incoterm tối ưu nhất' },
          reason: { type: Type.STRING, description: 'Lý do ngắn gọn chọn bestIncoterm' },
          recommendedInsuranceCode: { type: Type.STRING, description: 'Mã gói bảo hiểm chính như INS-ICC-A, INS-ICC-C, INS-FRZ-A, INS-NONE' },
          recommendedInsuranceAddons: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Các mã mở rộng như INS-EXT-SWH, INS-EXT-WAR, INS-EXT-TPND',
          },
          insuranceReason: { type: Type.STRING, description: 'Giải thích lựa chọn bảo hiểm' },
        },
        required: ['replyText', 'recommendedIncoterms', 'bestIncoterm', 'reason', 'recommendedInsuranceCode', 'recommendedInsuranceAddons', 'insuranceReason'],
      },
    },
  });

  const rawText = (response.text || '{}').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const parsed = JSON.parse(rawText || '{}');
  return {
    success: true,
    ...parsed,
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, message: 'Method Not Allowed' });
    return;
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const result = await runGeminiIncotermAdvisor(body, process.env.GEMINI_API_KEY || '');
    res.status(200).json(result);
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: err?.message || 'Lỗi kết nối Gemini AI.',
    });
  }
}
