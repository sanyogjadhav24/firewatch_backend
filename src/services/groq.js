const axios = require("axios");

async function analyzeImageWithGroq(imageUrl) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY missing");

  const models = getModelCandidates();
  let lastError = null;

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

  for (const model of models) {
    console.log(`Calling Groq API with model: ${model}`);

    try {
      const resp = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
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
            "Content-Type": "application/json"
          },
          timeout: 60000
        }
      );

      const content = resp.data?.choices?.[0]?.message?.content;
      if (!content) throw new Error("Groq returned empty content");

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        throw new Error("Groq output not valid JSON: " + content.slice(0, 200));
      }

      return {
        isFire: !!parsed.isFire,
        fireConfidence: clamp01(parsed.fireConfidence),
        suspectedAIGenerated: !!parsed.suspectedAIGenerated,
        aiGenConfidence: clamp01(parsed.aiGenConfidence),
        reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String).slice(0, 10) : [],
        model
      };
    } catch (axiosError) {
      lastError = normalizeGroqError(axiosError, model);

      if (!shouldFallbackToNextModel(axiosError)) {
        throw lastError;
      }

      console.warn(`Groq model failed, trying next candidate: ${lastError.message}`);
    }
  }

  throw lastError || new Error("Groq API request failed");
}

function clamp01(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function getModelCandidates() {
  const configured = String(process.env.GROQ_VISION_MODEL || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const defaults = [
    "meta-llama/llama-4-maverick-17b-128e-instruct",
    "meta-llama/llama-4-scout-17b-16e-instruct"
  ];

  return [...configured, ...defaults.filter((model) => !configured.includes(model))];
}

function normalizeGroqError(axiosError, model) {
  if (axiosError.code === "ECONNABORTED") {
    return new Error(`Groq API timeout after 60 seconds for model ${model} - vision model may be overloaded`);
  }

  if (axiosError.response) {
    const status = axiosError.response.status;
    const statusText = axiosError.response.statusText || "";
    const errData = axiosError.response.data;
    return new Error(`Groq API error ${status} ${statusText} for model ${model}: ${JSON.stringify(errData).slice(0, 200)}`);
  }

  return new Error(`Groq API request failed for model ${model}: ${axiosError.message}`);
}

function shouldFallbackToNextModel(axiosError) {
  if (!axiosError.response) {
    return false;
  }

  const status = axiosError.response.status;
  const errData = axiosError.response.data;
  const code = errData?.error?.code;

  return status === 404 || code === "model_not_found";
}

module.exports = { analyzeImageWithGroq };
