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

    // 2. Check if we should use Groq AI or fallback/mock
    const useMock =
      process.env.MOCK_EXTERNAL_APIS === 'true' ||
      !this.groqClient;

    if (useMock) {
      return this.mockProcess(maskedText, submittedName, isAnonymous, confessionNumber, localMod);
    }

    try {
      return await this.callGroq(maskedText, submittedName, isAnonymous, confessionNumber, localMod);
    } catch (err: any) {
      console.warn('[AIService] Groq API call failed, falling back to deterministic processing:', err?.message || err);
      return this.mockProcess(maskedText, submittedName, isAnonymous, confessionNumber, localMod);
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

    const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

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

    const completion = await this.groqClient.chat.completions.create({
      model,
      temperature: 0.2, // Low temperature for high fidelity and zero hallucinations
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

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
   * Deterministic mock engine for offline development, local demos, and unit testing
   */
  public mockProcess(
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
}

export const aiService = new AIService();
