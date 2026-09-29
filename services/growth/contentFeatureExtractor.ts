/**
 * ConfessionFlow - Content Feature Extraction Engine
 * Analyzes confession text into structured linguistic, emotional, and thematic features.
 * Combines high-speed deterministic regex/heuristic extraction with Groq AI semantic reasoning.
 */

import { ContentFeatures, HookType, EmotionalTone } from '@/types/growth';
import Groq from 'groq-sdk';
import { growthStore } from '@/lib/growthStore';

export class ContentFeatureExtractor {
  private groqClient: Groq | null = null;
  private readonly FEATURE_VERSION = '1.2.0';

  constructor() {
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey && groqKey.trim().length > 0) {
      this.groqClient = new Groq({ apiKey: groqKey });
    }
  }

  /**
   * Main entry point to extract features for a confession
   */
  public async extractFeatures(contentId: string, text: string): Promise<ContentFeatures> {
    // 1. Deterministic text metrics
    const trimmed = (text || '').trim();
    const words = trimmed.length > 0 ? trimmed.split(/\s+/) : [];
    const wordCount = words.length;
    const characterCount = trimmed.length;
    const sentences = trimmed.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const sentenceCount = Math.max(1, sentences.length);

    // Reading time (approx 200 words per minute -> 3.3 words per second)
    const estimatedReadingTimeSeconds = Math.max(3, Math.ceil(wordCount / 3.3));

    // Reading complexity
    const avgWordLen = wordCount > 0 ? characterCount / wordCount : 0;
    let reading_complexity: ContentFeatures['reading_complexity'] = 'EASY';
    if (avgWordLen > 6.2 || (wordCount / sentenceCount) > 22) {
      reading_complexity = 'COMPLEX';
    } else if (avgWordLen > 5.2 || (wordCount / sentenceCount) > 14) {
      reading_complexity = 'MODERATE';
    }

    // Hook detection (first sentence or first 80 characters)
    const firstSentence = sentences[0]?.trim() || trimmed.slice(0, 80);
    const hookLength = firstSentence.length;
    const hookText = firstSentence;

    const questionPresent = trimmed.includes('?');
    const ctaRegex = /(what do you think|what should i do|thoughts\?|tell me|would you|advise me|confess|comment below)/i;
    const ctaPresent = ctaRegex.test(trimmed);

    // Thematic detection
    const relationshipRegex = /\b(crush|dating|boyfriend|girlfriend|bf|gf|ex|love|breakup|cheated|kiss|romantic|heartbreak)\b/i;
    const schoolRegex = /\b(school|teacher|class|homework|principal|uniform|recess)\b/i;
    const collegeRegex = /\b(college|university|campus|hostel|dorm|semester|professor|cgpa|exam|fresher|seniors|canteen)\b/i;
    const funnyRegex = /\b(lol|lmao|hilarious|funny|prank|joke|embarrassing|oops|accidentally)\b/i;
    const dramaticRegex = /\b(fight|betrayal|secret|exposed|caught|crying|tears|drama|revenge|scandal)\b/i;
    const namedPersonRegex = /\b([A-Z][a-z]+(\s[A-Z][a-z]+)?)\b/;

    const relationshipTheme = relationshipRegex.test(trimmed);
    const schoolTheme = schoolRegex.test(trimmed);
    const collegeTheme = collegeRegex.test(trimmed);
    const funnyTheme = funnyRegex.test(trimmed);
    const dramaticTheme = dramaticRegex.test(trimmed);
    const namedPerson = namedPersonRegex.test(trimmed);

    // Baseline hook type detection
    let hookType: HookType = 'DIRECT_STATEMENT';
    if (firstSentence.endsWith('?') || /^(why|how|what|is it|have you|does anyone)/i.test(firstSentence)) {
      hookType = 'QUESTION';
    } else if (/^(omg|wtf|holy|unbelievable|i can't believe|never thought)/i.test(firstSentence)) {
      hookType = 'SHOCK';
    } else if (/(nobody knows|secret|i have to confess|true story|i never told)/i.test(firstSentence)) {
      hookType = 'CONFESSION_REVEAL';
    } else if (/(wondering|curious|plot twist|listen to this)/i.test(firstSentence)) {
      hookType = 'CURIOSITY';
    } else if (/^(so yesterday|last week|once|back in|during)/i.test(firstSentence)) {
      hookType = 'STORY_OPENING';
    }

    // Baseline emotional tone
    let emotionalTone: EmotionalTone = 'RELATABLE';
    if (funnyTheme) emotionalTone = 'HUMOROUS';
    else if (dramaticTheme) emotionalTone = 'DRAMATIC';
    else if (relationshipTheme) emotionalTone = 'ROMANTIC';

    // Baseline category
    let category = 'General';
    if (relationshipTheme) category = 'Relationship';
    else if (collegeTheme) category = 'Campus Life';
    else if (schoolTheme) category = 'School';
    else if (funnyTheme) category = 'Humor';
    else if (dramaticTheme) category = 'Drama';

    let topic = category;

    // 2. Optional AI Enrichment with Groq (if available)
    if (this.groqClient && process.env.NODE_ENV !== 'test') {
      try {
        const aiFeatures = await this.queryGroqFeatures(trimmed);
        if (aiFeatures) {
          if (aiFeatures.category) category = aiFeatures.category;
          if (aiFeatures.topic) topic = aiFeatures.topic;
          if (aiFeatures.hookType) hookType = aiFeatures.hookType;
          if (aiFeatures.emotionalTone) emotionalTone = aiFeatures.emotionalTone;
        }
      } catch (err: any) {
        console.warn('[ContentFeatureExtractor] Groq enrichment failed, using deterministic features:', err?.message || err);
      }
    }

    const result: ContentFeatures = {
      content_id: contentId,
      category,
      topic,
      language: 'en',
      language_mix: false,
      word_count: wordCount,
      character_count: characterCount,
      sentence_count: sentenceCount,
      hook_length: hookLength,
      hook_text: hookText,
      hook_type: hookType,
      emotional_tone: emotionalTone,
      question_present: questionPresent,
      cta_present: ctaPresent,
      named_person: namedPerson,
      relationship_theme: relationshipTheme,
      school_theme: schoolTheme,
      college_theme: collegeTheme,
      funny_theme: funnyTheme,
      dramatic_theme: dramaticTheme,
      negative_sentiment: dramaticTheme ? 0.6 : 0.2,
      positive_sentiment: funnyTheme || relationshipTheme ? 0.7 : 0.4,
      reading_complexity,
      estimated_reading_time_seconds: estimatedReadingTimeSeconds,
      sensitive_content_flag: false,
      feature_extraction_version: this.FEATURE_VERSION,
      created_at: new Date().toISOString(),
    };

    await growthStore.saveContentFeatures(result);
    return result;
  }

  /**
   * Query Groq for nuanced category, topic, hook type, and tone
   */
  private async queryGroqFeatures(text: string): Promise<{
    category?: string;
    topic?: string;
    hookType?: HookType;
    emotionalTone?: EmotionalTone;
  } | null> {
    if (!this.groqClient) return null;

    const response = await this.groqClient.chat.completions.create({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `You are a social content linguistic classifier. Classify the user confession into JSON.
Return JSON ONLY:
{
  "category": "Relationship" | "Crush" | "Campus Life" | "Academic" | "Humor" | "Drama" | "Emotional" | "General",
  "topic": "Concise 2-4 word topic description",
  "hookType": "QUESTION" | "SHOCK" | "CURIOSITY" | "CONFESSION_REVEAL" | "DIRECT_STATEMENT" | "STORY_OPENING",
  "emotionalTone": "HUMOROUS" | "DRAMATIC" | "VULNERABLE" | "ROMANTIC" | "ANXIOUS" | "ANGRY" | "RELATABLE" | "NEUTRAL"
}`,
        },
        {
          role: 'user',
          content: text.slice(0, 500),
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 200,
    });

    const parsed = JSON.parse(response.choices[0]?.message?.content || '{}');
    return parsed;
  }
}

export const contentFeatureExtractor = new ContentFeatureExtractor();
