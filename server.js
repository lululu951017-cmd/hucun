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
    else cb(new Error('只支持图片文件'));
  }
});

// Multer 错误处理中间件 - 返回 JSON 格式
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '图片文件太大，最大支持 4MB' });
  }
  if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: '上传的文件数量超出限制' });
  }
  if (err && err.message === '只支持图片文件') {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

// ── Get API Client Helper ────────────────────────────────────────────────────
function getClient(apiProvider, apiKey) {
  switch (apiProvider) {
    case 'openai':
      return new OpenAI({ apiKey });
    case 'google':
      return new GoogleGenerativeAI(apiKey);
    default:
      throw new Error('不支持的 API 提供商');
  }
}

// ── OpenAI Analysis Function ─────────────────────────────────────────────────
async function analyzeWithOpenAI(client, content, prompt) {
  const messages = [
    { role: 'user', content }
  ];

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages,
    max_tokens: 3500,
    temperature: 0.7
  });

  return response.choices[0].message.content;
}

// ── Google Analysis Function ──────────────────────────────────────────────────
async function analyzeWithGoogle(client, content, prompt) {
  const model = client.getGenerativeModel({ model: 'gemini-1.5-flash' });

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
    generationConfig: { maxOutputTokens: 3500, temperature: 0.7 }
  });

  return result.response.text();
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── System Prompt ──────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `你是一位专业的分镜图分析师和 AI 绘图提示词专家，擅长将黑白漫画分镜转化为 NANO BANANA PRO 平台的高质量绘图提示词。

你同时处理三类参考素材：
① 黑白分镜图 —— 提供构图、景别、人物站位、神态
② 人物形象参考图 —— 提供角色外貌、上色方案（发色/肤色/服装）
③ 背景场景参考图 —— 提供背景风格、场景细节、色调氛围

任务优先级：
【最高】构图与站位还原：精确识别景别（远景/全景/中景/近景/特写/大特写）、机位角度（平视/俯视/仰视/斜角）、人物在画面中的空间关系，必须在提示词中准确还原。
【最高】人物神态还原：细致捕捉每个角色的面部表情、眼神、情绪、肢体语言，确保情绪传达精准。
【高】人物上色：结合人物参考图确定发色、肤色、服装配色，精准描述到具体颜色词。
【高】背景融合：将背景参考图的视觉风格和环境细节，与分镜图的场景环境深度融合，生成匹配当前景别和透视关系的背景提示词。
【核心风格】成熟叙事动画风，写实基础上的二次元影视动画，去除所有文字、对话框、气泡框。

输出规则：
- 提示词用英文，分析描述用中文
- 背景提示词不包含任何人物
- 背景透视角度必须与当前景别、人物站位一致
- 严格输出 JSON，不加 markdown 代码块`;

// ── Analysis Prompt Template ───────────────────────────────────────────────
function buildAnalysisPrompt(customStylePrompt) {
  const styleNote = customStylePrompt
    ? `用户自定义风格提示词（请在 style_prompt 中融合此风格）：\n"${customStylePrompt}"\n\n`
    : '';

  return `${styleNote}请分析所有上传的素材，输出以下 JSON，不要输出任何其他内容：

{
  "composition": {
    "shot_type": "景别中文",
    "shot_type_en": "shot type in English",
    "camera_angle": "机位角度中文",
    "camera_angle_en": "camera angle in English",
    "depth_of_field": "景深描述",
    "layout_description": "画面构图布局的完整中文描述"
  },
  "characters": [
    {
      "label": "角色名或编号",
      "position_in_frame": "画面位置（左前景/右中景/画面中心等）",
      "pose": "姿态",
      "expression": "表情神态精确描述",
      "emotion": "情绪状态",
      "action": "正在进行的动作",
      "color_scheme": "基于人物参考图的上色方案：发色、肤色、服装颜色，无参考图则注明推测"
    }
  ],
  "scene": {
    "environment": "场景环境（室内/室外/具体地点）",
    "time_of_day": "时段",
    "lighting": "光线描述",
    "atmosphere": "整体氛围",
    "background_key_elements": "背景核心元素"
  },
  "background_reference": {
    "has_reference": true或false,
    "style_extracted": "从背景参考图提取的风格特征（画面质感、色调、细节程度等）",
    "environment_match": "参考图场景与分镜场景的匹配与融合说明",
    "color_palette": "参考图色调描述",
    "key_visual_elements": "从参考图中可以移植到目标场景的关键视觉元素"
  },
  "prompts": {
    "character_prompt": "人物提示词（英文）：每个角色的外貌、发色、服装配色、表情、姿态、画面位置",
    "background_prompt": "背景提示词（英文）：融合分镜场景+背景参考图风格，包含透视、光线、氛围、环境细节，不含人物",
    "composition_prompt": "构图提示词（英文）：景别、机位角度、构图方式",
    "style_prompt": "风格提示词（英文）：融合用户自定义风格与核心风格关键词",
    "negative_prompt": "负面提示词（英文）：text, speech bubbles, dialogue boxes, subtitles, captions, watermark, signature, monochrome, grayscale, sketch lines, comic panel borders, flat colors, low quality, blurry, distorted anatomy, extra limbs, bad hands, missing fingers",
    "full_prompt": "完整正向提示词（英文）：将 character_prompt + composition_prompt + background_prompt + style_prompt 合并为一段连贯描述",
    "nano_banana_format": "NANO BANANA PRO 格式化提示词，按模块分段，用换行分隔，格式：[人物] ... \\n[构图] ... \\n[背景] ... \\n[风格] ...",
    "scene_summary_cn": "中文场景总结，用于人工核查：描述画面整体内容、还原要点、背景融合结果"
  }
}`;
}

// ── API Route ──────────────────────────────────────────────────────────────
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
      return res.status(400).json({ error: '请提供 API Key' });
    }

    if (!storyboardFile) {
      return res.status(400).json({ error: '请上传分镜图' });
    }

    // Build content array
    const content = [];

    // 1. Storyboard
    content.push({ type: 'text', text: '【① 分镜图】以下是需要分析还原的黑白分镜图，重点分析构图、景别、人物站位和神态：' });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: storyboardFile.mimetype, data: storyboardFile.buffer.toString('base64') }
    });

    // 2. Character references
    if (characterFiles.length > 0) {
      content.push({ type: 'text', text: `【② 人物形象参考图 × ${characterFiles.length}】请根据以下参考图确定各角色的上色方案（发色、肤色、服装颜色等）：` });
      for (const f of characterFiles) {
        content.push({ type: 'image', source: { type: 'base64', media_type: f.mimetype, data: f.buffer.toString('base64') } });
      }
    } else {
      content.push({ type: 'text', text: '【② 人物参考图】未上传，请根据分镜内容合理推测上色方案并注明为推测。' });
    }

    // 3. Background references
    if (backgroundFiles.length > 0) {
      content.push({ type: 'text', text: `【③ 背景场景参考图 × ${backgroundFiles.length}】请分析以下背景参考图的视觉风格、色调、环境细节，并与分镜图的场景深度融合，生成匹配当前景别和透视角度的背景提示词：` });
      for (const f of backgroundFiles) {
        content.push({ type: 'image', source: { type: 'base64', media_type: f.mimetype, data: f.buffer.toString('base64') } });
      }
    } else {
      content.push({ type: 'text', text: '【③ 背景参考图】未上传，请根据分镜图场景推断背景，has_reference 填 false。' });
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
      return res.status(400).json({ error: '不支持的 API 提供商' });
    }

    // Parse JSON response
    let result;
    try {
      result = JSON.parse(rawText);
    } catch {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) result = JSON.parse(jsonMatch[0]);
      else return res.status(500).json({ error: '响应解析失败，请重试', raw: rawText });
    }

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[analyze error]', err);
    res.status(500).json({ error: err.message || '分析失败，请重试' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// 本地开发时直接启动，Vercel 部署时导出 app
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`\n  分镜提示词工作台已启动`);
    console.log(`  访问地址: http://localhost:${PORT}\n`);
  });
}

module.exports = app;
