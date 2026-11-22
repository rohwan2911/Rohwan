import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

interface AiRequestBody {
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
