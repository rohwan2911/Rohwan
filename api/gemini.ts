import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

interface AiRequestBody {
  action?: 'incoterm_advisor' | 'smart_fill_template';
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
  blocks?: Array<{ id: string; text: string }>;
  existingPlaceholders?: Array<{
    placeholder_key: string;
    scope: string;
    source_table: string;
    source_column: string;
    description_vie: string;
  }>;
}

async function handleSmartFillTemplate(ai: GoogleGenAI, body: AiRequestBody) {
  const blocks = Array.isArray(body.blocks) ? body.blocks : [];
  const existing = Array.isArray(body.existingPlaceholders) ? body.existingPlaceholders : [];
  const docName = String(body.documentName || 'Export Document');
  const dept = String(body.targetDepartment || 'XNK');

  const systemInstruction = [
    'Bạn là Kỹ sư Chuẩn hóa Phôi mẫu Chứng từ Xuất nhập khẩu (Docxtemplater {{PLACEHOLDER}} Architect) cho hệ thống GREEN AGRI-EXPORTS.',
    'Nhiệm vụ: Nhận danh sách các đoạn văn bản (blocks) trích từ file .docx thô chưa gắn biến, cùng danh mục biến chuẩn hiện có (existingPlaceholders).',
    'Quy tắc BẮT BUỘC:',
    '1. ƯU TIÊN TUYỆT ĐỐI tái sử dụng các placeholder_key có sẵn trong existingPlaceholders (ví dụ {{CNE_NAME}}, {{CNE_ADDR}}, {{CNE_TAX}}, {{CNE_CONTACT}}, {{CNE_PHONE}}, {{CNE_EMAIL}}, {{CTR_NO}}, {{CTR_DATE}}, {{CTR_VAL}}, {{TOT_AMT_WORDS}}, {{INCOTERM}}, {{INCOTERM_PLACE}}, {{PAY_TERM}}, {{POL}}, {{POD}}, {{CO_FORM}}, {{INS_TERM}}, {{FREIGHT}}, {{TBA}}, {{PROD_NAME_ENG}}, {{HS_CODE}}, {{NW_KGS}}, {{GW_KGS}}, {{CARTONS}}, {{PALLETS}}, {{CBM}}, {{UNIT_PRICE}}, {{VES_VOY}}, {{BK_NO}}...).',
    '2. Chỉ tạo placeholder_key MỚI (UPPER_SNAKE_CASE, ngắn gọn, chuẩn quốc tế) nếu hoàn toàn KHÔNG có biến nào trong existingPlaceholders phù hợp với trường dữ liệu động đó.',
    '3. Mỗi block cần gắn biến phải trả về nguyên văn câu/dòng đó với phần dữ liệu mẫu/chỗ trống (như "....", "[Company Name]", ngày mẫu, số tiền mẫu, tên khách mẫu) được thay bằng {{KEY}}. Giữ nguyên các tiêu đề/điều khoản pháp lý cố định!',
    '4. KHÔNG sửa những block chỉ là tiêu đề hoặc văn bản pháp lý tĩnh không có dữ liệu động của đơn hàng.',
    '5. Với mỗi biến MỚI trong newPlaceholders, khai báo rõ source_table (trong: order_master, consignee_directory, product_catalog, pricing_proposal, inquiry_quotation, shipping_schedule, pricing_rates, system_lookups, computed) và source_column tương ứng (hoặc mặc định hợp lý như TBA).',
  ].join('\n');

  const prompt = [
    `Tên chứng từ: ${docName} · Phòng ban: ${dept}`,
    `Danh mục biến chuẩn hiện có (existingPlaceholders):\n${JSON.stringify(existing)}`,
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
                source_table: { type: Type.STRING, description: 'order_master | consignee_directory | product_catalog | pricing_proposal | inquiry_quotation | shipping_schedule | pricing_rates | system_lookups | computed' },
                source_column: { type: Type.STRING, description: 'Tên cột hoặc giá trị mặc định như TBA' },
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

  const text = (response.text || '{}').trim();
  const parsed = JSON.parse(text);
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

  const text = (response.text || '{}').trim();
  const parsed = JSON.parse(text);
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
