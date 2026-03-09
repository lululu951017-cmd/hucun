const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are supported'));
  }
});

// Multer 閿欒澶勭悊涓棿浠?- 杩斿洖 JSON 鏍煎紡
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '鍥剧墖鏂囦欢澶ぇ锛屾渶澶ф敮鎸?4MB' });
  }
  if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Too many uploaded files' });
  }
  if (err && err.message === 'Only image files are supported') {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

// 鈹€鈹€ Get API Client Helper 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
function getClient(apiProvider, apiKey) {
  switch (apiProvider) {
    case 'openai':
      return new OpenAI({ apiKey });
    case 'google':
      return new GoogleGenerativeAI(apiKey);
    default:
      throw new Error('Unsupported API provider');
  }
}

// 鈹€鈹€ OpenAI Analysis Function 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
async function analyzeWithOpenAI(client, content, prompt) {
  const messages = [
    { role: 'user', content }
  ];

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages,
    response_format: { type: 'json_object' },
    max_tokens: 3500,
    temperature: 0.7
  });

  return response.choices[0].message.content;
}

// 鈹€鈹€ Google Analysis Function 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
async function analyzeWithGoogle(client, content, prompt) {
  const model = client.getGenerativeModel({ model: 'gemini-3.1-pro-preview' });

  // Convert content array to Gemini format
  const geminiContent = [];

  for (const item of content) {
    if (item.type === 'text') {
      geminiContent.push({ text: item.text });
    } else if (item.type === 'image') {
      const base64Data = item.source.data;
      const mimeType = item.source.media_type;

      // Gemini format expects { inlineData: { data: base64, mimeType } }
      geminiContent.push({
        inlineData: { data: base64Data, mimeType }
      });
    }
  }

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: geminiContent }],
    generationConfig: {
      maxOutputTokens: 3500,
      temperature: 0.7,
      responseMimeType: 'application/json'
    }
  });

  return result.response.text();
}

async function normalizeJsonWithOpenAI(client, rawText) {
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: 3500,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'Convert the following model output into strict valid JSON only. ' +
              'Keep all useful fields. Remove markdown/code fences/explanations. ' +
              'If some fields are missing, preserve existing structure as much as possible.\\n\\n' +
              rawText
          }
        ]
      }
    ]
  });

  return response.choices?.[0]?.message?.content || '';
}

async function normalizeJsonWithGoogle(client, rawText) {
  const model = client.getGenerativeModel({ model: 'gemini-3.1-pro-preview' });
  const result = await model.generateContent({
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              'Convert the following model output into strict valid JSON only. ' +
              'Keep all useful fields. Remove markdown/code fences/explanations. ' +
              'If some fields are missing, preserve existing structure as much as possible.\\n\\n' +
              rawText
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      maxOutputTokens: 3500
    }
  });

  return result.response.text();
}

function sanitizeJsonText(text) {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function repairJsonText(text) {
  return text
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":');
}

function collectJsonObjectCandidates(text) {
  const candidates = [];

  const blockRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let blockMatch;
  while ((blockMatch = blockRegex.exec(text)) !== null) {
    candidates.push(blockMatch[1].trim());
  }

  let depth = 0;
  let start = -1;
  let inString = false;
  let quoteChar = '"';
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quoteChar) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quoteChar = ch;
      continue;
    }

    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
      continue;
    }

    if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start !== -1) {
        candidates.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return candidates;
}

function parseAiJson(rawText) {
  const text = sanitizeJsonText(String(rawText || '')).trim();
  if (!text) {
    throw new Error('Empty AI response');
  }

  const directFenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const directCandidates = directFenceMatch ? [directFenceMatch[1], text] : [text];

  for (const candidate of directCandidates) {
    const normalized = sanitizeJsonText(candidate).trim();
    try {
      return JSON.parse(normalized);
    } catch (_) {
      try {
        return JSON.parse(repairJsonText(normalized));
      } catch (_) {}
    }
  }

  const extractedCandidates = collectJsonObjectCandidates(text);
  for (const candidate of extractedCandidates) {
    const normalized = sanitizeJsonText(candidate).trim();
    try {
      return JSON.parse(normalized);
    } catch (_) {
      try {
        return JSON.parse(repairJsonText(normalized));
      } catch (_) {}
    }
  }

  throw new Error('Unable to parse AI response as JSON');
}

async function normalizeAndParseAiJson(apiProvider, client, rawText) {
  try {
    return parseAiJson(rawText);
  } catch (_) {
    let normalizedRaw = '';

    if (apiProvider === 'openai') {
      normalizedRaw = await normalizeJsonWithOpenAI(client, rawText);
    } else if (apiProvider === 'google') {
      normalizedRaw = await normalizeJsonWithGoogle(client, rawText);
    }

    if (!normalizedRaw) {
      throw new Error('Normalization returned empty response');
    }

    return parseAiJson(normalizedRaw);
  }
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// 鈹€鈹€ System Prompt 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
const SYSTEM_PROMPT = `你是一位专业的分镜图分析师和 AI 绘图提示词专家。
你的任务是基于用户上传素材，输出严格 JSON（不要 Markdown，不要额外解释）。

分析重点：
1. 还原分镜构图、景别、机位与人物站位。
2. 准确描述人物姿态、表情、情绪与动作。
3. 若有人物参考图，提取并应用角色配色信息。
4. 若有背景参考图，提取风格并与分镜场景融合。
5. 提示词用英文，分析描述用中文。`;

function buildAnalysisPrompt(customStylePrompt) {
  const styleNote = customStylePrompt
    ? `用户自定义风格提示词（请融合到 style_prompt）：\n"${customStylePrompt}"\n\n`
    : '';

  return `${styleNote}请仅输出以下 JSON 结构，不要输出任何多余文本：
{
  "composition": {
    "shot_type": "景别中文",
    "shot_type_en": "shot type in English",
    "camera_angle": "机位角度中文",
    "camera_angle_en": "camera angle in English",
    "depth_of_field": "景深描述",
    "layout_description": "画面构图布局中文描述"
  },
  "characters": [
    {
      "label": "角色名或编号",
      "position_in_frame": "画面位置",
      "pose": "姿态",
      "expression": "表情",
      "emotion": "情绪",
      "action": "动作",
      "color_scheme": "角色配色"
    }
  ],
  "scene": {
    "environment": "场景环境",
    "time_of_day": "时间",
    "lighting": "光线",
    "atmosphere": "氛围",
    "background_key_elements": "背景关键元素"
  },
  "background_reference": {
    "has_reference": true,
    "style_extracted": "背景参考风格特征",
    "environment_match": "参考与分镜融合说明",
    "color_palette": "色调描述",
    "key_visual_elements": "关键视觉元素"
  },
  "prompts": {
    "character_prompt": "English prompt",
    "background_prompt": "English prompt, no characters",
    "composition_prompt": "English prompt",
    "style_prompt": "English prompt",
    "negative_prompt": "text, speech bubbles, dialogue boxes, subtitles, captions, watermark, signature, monochrome, grayscale, sketch lines, comic panel borders, flat colors, low quality, blurry, distorted anatomy, extra limbs, bad hands, missing fingers",
    "full_prompt": "Merged English prompt",
    "nano_banana_format": "[人物] ...\\n[构图] ...\\n[背景] ...\\n[风格] ...",
    "scene_summary_cn": "中文场景总结"
  }
}`;
}
app.post('/api/analyze', upload.fields([
  { name: 'storyboard', maxCount: 1 },
  { name: 'characters', maxCount: 6 },
  { name: 'backgrounds', maxCount: 3 }
]), async (req, res) => {
  try {
    const storyboardFile = req.files?.['storyboard']?.[0];
    const characterFiles = req.files?.['characters'] || [];
    const backgroundFiles = req.files?.['backgrounds'] || [];

    const apiKey = req.body.apiKey?.trim();
    const apiProvider = req.body.apiProvider?.trim() || 'anthropic';

    if (!apiKey) {
      return res.status(400).json({ error: '璇锋彁渚?API Key' });
    }

    if (!storyboardFile) {
      return res.status(400).json({ error: '璇蜂笂浼犲垎闀滃浘' });
    }

    // Build content array
    const content = [];

    // 1. Storyboard
    content.push({ type: 'text', text: 'Storyboard image to analyze: focus on composition, shot type, camera angle, character placement, and expression.' });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: storyboardFile.mimetype, data: storyboardFile.buffer.toString('base64') }
    });

    // 2. Character references
    if (characterFiles.length > 0) {
      content.push({ type: 'text', text: 'Character references (' + characterFiles.length + '): use these to determine each character appearance and colors.' });
      for (const f of characterFiles) {
        content.push({ type: 'image', source: { type: 'base64', media_type: f.mimetype, data: f.buffer.toString('base64') } });
      }
    } else {
      content.push({ type: 'text', text: 'No character reference images were uploaded. Please infer character coloring from the storyboard and clearly mark inferred parts.' });
    }

    // 3. Background references
    if (backgroundFiles.length > 0) {
      content.push({ type: 'text', text: 'Background references (' + backgroundFiles.length + '): extract style, palette, and environment details, then fuse with the storyboard scene.' });
      for (const f of backgroundFiles) {
        content.push({ type: 'image', source: { type: 'base64', media_type: f.mimetype, data: f.buffer.toString('base64') } });
      }
    } else {
      content.push({ type: 'text', text: 'No background reference images were uploaded. Please infer the background from the storyboard and set has_reference to false.' });
    }

    // 4. Extra context
    const extraContext = req.body.context?.trim();
    if (extraContext) {
      content.push({ type: 'text', text: `【补充说明】${extraContext}` });
    }

    // 5. Analysis prompt with optional custom style
    const customStyle = req.body.stylePrompt?.trim();
    const analysisPrompt = buildAnalysisPrompt(customStyle);

    // Call the appropriate API based on provider
    let rawText;
    const client = getClient(apiProvider, apiKey);

    if (apiProvider === 'openai') {
      // For OpenAI, we need to prepend the system prompt as part of the message
      content.push({ type: 'text', text: `\n${SYSTEM_PROMPT}\n\n${analysisPrompt}` });
      rawText = await analyzeWithOpenAI(client, content, analysisPrompt);
    } else if (apiProvider === 'google') {
      // For Google, prepend system prompt to analysis prompt
      content.push({ type: 'text', text: `\n${SYSTEM_PROMPT}\n\n${analysisPrompt}` });
      rawText = await analyzeWithGoogle(client, content, analysisPrompt);
    } else {
      return res.status(400).json({ error: 'Unsupported API provider' });
    }

    // Parse JSON response
    let result;
    console.log('[API raw response length]', rawText.length);
    console.log('[API raw response preview]', rawText.substring(0, 300));

    try {
      result = await normalizeAndParseAiJson(apiProvider, client, rawText);
    } catch (e) {
      console.error('[JSON parse error]', e.message);
      console.error('[Full response]', rawText);
      return res.status(500).json({
        error: 'AI response could not be parsed as JSON, please retry',
        raw: rawText.substring(0, 1000) + '...'
      });
    }

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[analyze error]', err);
    res.status(500).json({ error: err.message || '鍒嗘瀽澶辫触锛岃閲嶈瘯' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// 鏈湴寮€鍙戞椂鐩存帴鍚姩锛孷ercel 閮ㄧ讲鏃跺鍑?app
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log('Storyboard prompt workbench started');
    console.log('Visit: http://localhost:' + PORT);
  });
}

module.exports = app;




