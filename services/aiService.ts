import Groq from 'groq-sdk';
import { AIProcessedResult, ModerationRisk, RecommendedAction } from '@/types';
import { moderationService } from './moderationService';

export class AIService {
  private groqClient: Groq | null = null;

  constructor() {
    const groqApiKey = process.env.GROQ_API_KEY;
    if (groqApiKey && groqApiKey.trim().length > 0) {
      this.groqClient = new Groq({ apiKey: groqApiKey });
    }
  }

  /**
   * Main entrypoint to process confession with AI
   */
  public async processConfession(
    originalText: string,
    submittedName: string = 'Anonymous',
    isAnonymous: boolean = true,
    confessionNumber: number = 1
  ): Promise<AIProcessedResult> {
    // 1. Run strict rule-based moderation & PII screening first
    const localMod = moderationService.analyzeContent(originalText);
    const maskedText = moderationService.maskSensitiveInformation(originalText, localMod.piiDetected);

    // 2. Check if Groq client is configured
    if (!this.groqClient) {
      return this.ruleBasedProcess(maskedText, submittedName, isAnonymous, confessionNumber, localMod);
    }

    try {
      return await this.callGroq(maskedText, submittedName, isAnonymous, confessionNumber, localMod);
    } catch (err: any) {
      console.warn('[AIService] Groq API call failed, falling back to deterministic processing:', err?.message || err);
      return this.ruleBasedProcess(maskedText, submittedName, isAnonymous, confessionNumber, localMod);
    }
  }

  /**
   * Calls Groq AI with strict JSON mode & guardrails
   */
  private async callGroq(
    text: string,
    submittedName: string,
    isAnonymous: boolean,
    confessionNumber: number,
    localMod: ReturnType<typeof moderationService.analyzeContent>
  ): Promise<AIProcessedResult> {
    if (!this.groqClient) {
      throw new Error('Groq client not initialized');
    }

    const requestedModel = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

    const systemPrompt = `You are the lead AI editor and content strategist for "ConfessionFlow", a university/campus anonymous confession platform.
Your task is to prepare user-submitted confessions for an official Instagram post.

CRITICAL RULES:
1. DO NOT change the meaning of the confession.
2. DO NOT invent facts, names, events, fake drama, or emotional fabrications.
3. You MAY: fix typos, improve grammar, enhance readability, remove accidental word repetitions, and format clean paragraphs.
4. Keep the authentic voice, slang, and raw emotional tone of the submitter.
5. If the submitter is marked anonymous or submitted a name, set displayName to "${isAnonymous ? 'Anonymous' : submittedName}".
6. Generate an engaging, thoughtful Instagram caption that:
   - Starts with "Confession #${String(confessionNumber).padStart(3, '0')}" and an appropriate emoji.
   - Includes a brief 1-2 sentence hook or discussion prompt (e.g. "What would you do in this situation?").
   - Encourages comments and saves politely.
7. Generate 4 to 6 relevant, high-performing hashtags without spam.
8. Assess moderation risk: LOW, MEDIUM, or HIGH.
9. Output STRICT JSON ONLY with the exact keys:
   {
     "cleanedText": string,
     "displayName": string,
     "caption": string,
     "hashtags": string[],
     "moderationRisk": "LOW" | "MEDIUM" | "HIGH",
     "moderationReason": string,
     "recommendedAction": "APPROVE" | "REVIEW" | "REJECT"
   }`;

    const userPrompt = `Confession Submission:
"${text}"

Submitted Name: "${submittedName}"
Is Anonymous: ${isAnonymous}`;

    let completion;
    try {
      completion = await this.groqClient.chat.completions.create({
        model: requestedModel,
        temperature: 0.2, // Low temperature for high fidelity and zero hallucinations
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });
    } catch (modelErr: any) {
      if (modelErr?.message?.includes('model_not_found') || modelErr?.code === 'model_not_found') {
        const fallbackModel = requestedModel === 'openai/gpt-oss-120b' ? 'llama-3.3-70b-versatile' : 'openai/gpt-oss-120b';
        console.warn(`[AIService] Model ${requestedModel} not found, retrying with fallback model ${fallbackModel}...`);
        completion = await this.groqClient.chat.completions.create({
          model: fallbackModel,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        });
      } else {
        throw modelErr;
      }
    }

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from Groq');
    }

    const parsed = JSON.parse(content);

    // Merge with local safety guarantees: if local check flagged HIGH, never let AI downgrade to LOW
    let finalRisk: ModerationRisk = parsed.moderationRisk || 'LOW';
    if (localMod.risk === 'HIGH') {
      finalRisk = 'HIGH';
    } else if (localMod.risk === 'MEDIUM' && finalRisk === 'LOW') {
      finalRisk = 'MEDIUM';
    }

    let recommendedAction: RecommendedAction = parsed.recommendedAction || 'REVIEW';
    if (finalRisk === 'HIGH') {
      recommendedAction = 'REJECT';
    } else if (finalRisk === 'LOW' && recommendedAction !== 'REJECT') {
      recommendedAction = 'APPROVE';
    }

    const reasons = [
      ...(parsed.moderationReason ? [parsed.moderationReason] : []),
      ...localMod.reasons,
    ];

    return {
      cleanedText: parsed.cleanedText || text,
      displayName: isAnonymous ? 'Anonymous' : (parsed.displayName || submittedName || 'Anonymous'),
      caption: parsed.caption || `Confession #${String(confessionNumber).padStart(3, '0')}\n\n${text}\n\nWhat are your thoughts?`,
      hashtags: Array.isArray(parsed.hashtags) && parsed.hashtags.length > 0
        ? parsed.hashtags.map((h: string) => (h.startsWith('#') ? h : `#${h}`))
        : ['#confession', '#anonymousconfession', '#campuslife'],
      moderationRisk: finalRisk,
      moderationReason: reasons.join(' | ') || 'Passed standard moderation check.',
      recommendedAction,
    };
  }

  /**
   * Deterministic rule-based engine for offline formatting and safety fallback
   */
  public ruleBasedProcess(
    text: string,
    submittedName: string,
    isAnonymous: boolean,
    confessionNumber: number,
    localMod: ReturnType<typeof moderationService.analyzeContent>
  ): AIProcessedResult {
    // 1. Basic sentence formatting & capitalisation
    let cleaned = text.trim();
    if (cleaned.length > 0) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
      if (!/[.!?]$/.test(cleaned)) {
        cleaned += '.';
      }
    }

    const numStr = String(confessionNumber).padStart(3, '0');
    const displayName = isAnonymous ? 'Anonymous' : (submittedName || 'Anonymous');

    // Contextual hashtag determination
    const lower = text.toLowerCase();
    const tags = ['#confession', '#campusconfessions'];
    if (lower.includes('friend') || lower.includes('crush') || lower.includes('love')) {
      tags.push('#secretcrush', '#relationshipconfessions');
    }
    if (lower.includes('exam') || lower.includes('professor') || lower.includes('class') || lower.includes('college')) {
      tags.push('#collegelife', '#studentproblems');
    }
    if (lower.includes('roommate') || lower.includes('hostel')) {
      tags.push('#roommatediaries', '#hostellife');
    }
    if (tags.length < 4) {
      tags.push('#anonymousstory', '#thoughts');
    }

    let recommendedAction: RecommendedAction = 'APPROVE';
    if (localMod.risk === 'HIGH') {
      recommendedAction = 'REJECT';
    } else if (localMod.risk === 'MEDIUM') {
      recommendedAction = 'REVIEW';
    }

    const caption = `Confession #${numStr} 💭\n\nSometimes the things we can't say out loud are the things we need to say the most.\n\nWhat would you do in this situation? Share your thoughts below 👇\n\n${tags.join(' ')}`;

    return {
      cleanedText: cleaned,
      displayName,
      caption,
      hashtags: tags,
      moderationRisk: localMod.risk,
      moderationReason: localMod.reasons.length > 0 ? localMod.reasons.join(' | ') : 'Passed safety and privacy validation.',
      recommendedAction,
    };
  }

  public mockProcess(
    text: string,
    submittedName: string,
    isAnonymous: boolean,
    confessionNumber: number,
    localMod: ReturnType<typeof moderationService.analyzeContent>
  ): AIProcessedResult {
    return this.ruleBasedProcess(text, submittedName, isAnonymous, confessionNumber, localMod);
  }

  /**
   * Use Groq AI to semantically check if a confession is a duplicate of any already published or existing confession
   */
  public async checkDuplicateWithGroq(
    candidateText: string,
    existingPosts: { row: number; text: string; id?: string }[]
  ): Promise<{
    isDuplicate: boolean;
    duplicateOfRow: number | null;
    confidence: number;
    reason: string;
  }> {
    if (!this.groqClient || existingPosts.length === 0) {
      return { isDuplicate: false, duplicateOfRow: null, confidence: 0, reason: 'No comparison posts or AI client not available' };
    }

    // 1. Fast exact & normalized string check first
    const normalizedCandidate = candidateText.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    for (const p of existingPosts) {
      const normP = p.text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
      if (normalizedCandidate === normP) {
        return {
          isDuplicate: true,
          duplicateOfRow: p.row,
          confidence: 1.0,
          reason: `Exact identical text match with confession #${p.row}`,
        };
      }
    }

    // 2. Groq AI semantic comparison (analyze latest 40 posts)
    const requestedModel = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
    const sample = existingPosts.slice(0, 40);

    const systemPrompt = `You are an AI content duplicate detector for an Instagram anonymous confession platform.
Your job is to detect if a NEW confession is a duplicate, repeated submission, or semantic equivalent of any PREVIOUSLY POSTED confession.

RULES:
1. Two confessions are DUPLICATES if they describe the exact same specific confession (e.g. same specific person named, same unique incident, or rephrased submission from the same person).
2. General common themes (e.g. two unrelated people talking about exam stress, feeling lonely, or campus life) are NOT duplicates.
3. Respond in STRICT JSON format:
{
  "isDuplicate": boolean,
  "duplicateOfRow": number | null,
  "confidence": number,
  "reason": string
}`;

    const userPrompt = `NEW CONFESSION:
"${candidateText}"

PREVIOUS CONFESSIONS:
${sample.map((p) => `[Row #${p.row}]: "${p.text}"`).join('\n\n')}

Analyze if the NEW CONFESSION is a duplicate of any previous confession.`;

    try {
      let completion;
      try {
        completion = await this.groqClient.chat.completions.create({
          model: requestedModel,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        });
      } catch (err: any) {
        const fallbackModel = requestedModel === 'openai/gpt-oss-120b' ? 'llama-3.3-70b-versatile' : 'openai/gpt-oss-120b';
        completion = await this.groqClient.chat.completions.create({
          model: fallbackModel,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        });
      }

      const content = completion.choices[0]?.message?.content;
      if (!content) return { isDuplicate: false, duplicateOfRow: null, confidence: 0, reason: 'Empty AI response' };

      const parsed = JSON.parse(content);
      const isDup = Boolean(parsed.isDuplicate && (Number(parsed.confidence) || 0) >= 0.75);

      return {
        isDuplicate: isDup,
        duplicateOfRow: parsed.duplicateOfRow ?? null,
        confidence: Number(parsed.confidence) || 0,
        reason: parsed.reason || '',
      };
    } catch (err: any) {
      console.warn('[AIService] Groq duplicate check skipped due to error:', err?.message || err);
      return { isDuplicate: false, duplicateOfRow: null, confidence: 0, reason: 'AI check skipped' };
    }
  }
}

export const aiService = new AIService();
