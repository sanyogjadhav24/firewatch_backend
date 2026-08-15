const axios = require("axios");

async function analyzeImageWithOpenRouter(imageUrl) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing");

  const model = String(process.env.OPENROUTER_MODEL || "openrouter/free").trim();
  const appName = String(process.env.OPENROUTER_APP_NAME || "FireWatch Backend").trim();
  const appUrl = String(process.env.OPENROUTER_APP_URL || "").trim();

  const prompt = `
You are a safety/validation classifier for a fire reporting app.
Given an image, decide:
1) Is there visible fire OR smoke consistent with a real fire incident?
2) Does the image look AI-generated or synthetic? (best-effort; uncertain allowed)

Return ONLY valid JSON with this schema:
{
  "isFire": boolean,
  "fireConfidence": number,
  "suspectedAIGenerated": boolean,
  "aiGenConfidence": number,
  "reasons": string[]
}

Rules:
- Confidence is 0.0 to 1.0
- reasons should be short bullet-like strings
- If uncertain, lower confidence and explain.
`;

  console.log(`Calling OpenRouter API with model: ${model}`);

  let resp;
  try {
    resp = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageUrl } }
            ]
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(appUrl ? { "HTTP-Referer": appUrl } : {}),
          ...(appName ? { "X-Title": appName } : {})
        },
        timeout: 60000
      }
    );
  } catch (axiosError) {
    throw normalizeOpenRouterError(axiosError, model);
  }

  const content = resp.data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned empty content");

  let parsed;
  try {
    parsed = parseOpenRouterJson(content);
  } catch (e) {
    return {
      isFire: false,
      fireConfidence: 0,
      suspectedAIGenerated: false,
      aiGenConfidence: 0,
      reasons: ["OpenRouter returned non-JSON response: " + summarizeContent(content)],
      model
    };
  }

  return {
    isFire: !!parsed.isFire,
    fireConfidence: clamp01(parsed.fireConfidence),
    suspectedAIGenerated: !!parsed.suspectedAIGenerated,
    aiGenConfidence: clamp01(parsed.aiGenConfidence),
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String).slice(0, 10) : [],
    model
  };
}

function clamp01(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function parseOpenRouterJson(content) {
  const raw = extractRawContent(content).trim();
  if (!raw) throw new Error("empty response");

  try {
    return JSON.parse(raw);
  } catch (_) {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }

    throw new Error("non-json response");
  }
}

function extractRawContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .join("\n");
  }
  if (content && typeof content.text === "string") return content.text;
  return content ? JSON.stringify(content) : "";
}

function summarizeContent(content) {
  const raw = extractRawContent(content).replace(/\s+/g, " ").trim();
  return raw.slice(0, 200) || "empty response";
}

function normalizeOpenRouterError(axiosError, model) {
  if (axiosError.code === "ECONNABORTED") {
    return new Error(`OpenRouter API timeout after 60 seconds for model ${model}`);
  }

  if (axiosError.response) {
    const status = axiosError.response.status;
    const statusText = axiosError.response.statusText || "";
    const errData = axiosError.response.data;
    return new Error(`OpenRouter API error ${status} ${statusText} for model ${model}: ${JSON.stringify(errData).slice(0, 200)}`);
  }

  return new Error(`OpenRouter API request failed for model ${model}: ${axiosError.message}`);
}

module.exports = { analyzeImageWithOpenRouter };