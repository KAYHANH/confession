import { ModerationCheckResult, ModerationRisk } from '@/types';

// Regular expressions for detecting PII
const PHONE_REGEX = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\b[6-9]\d{9}\b/g;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const CREDIT_CARD_REGEX = /\b(?:\d[ -]*?){13,16}\b/g;
const HANDLE_REGEX = /@[a-zA-Z0-9_.]+/g;
const AADHAAR_OR_SSN_REGEX = /\b\d{4}\s\d{4}\s\d{4}\b|\b\d{3}-\d{2}-\d{4}\b/g;

// High-risk keywords (self-harm, threats, severe violence, extreme hate)
const HIGH_RISK_KEYWORDS = [
  'kill myself', 'suicide', 'end my life', 'slit', 'hang myself',
  'shoot them', 'bomb', 'murder', 'i will rape', 'child porn',
  'cp', 'pedophile', 'blackmail', 'acid attack', 'terrorist'
];

// Medium-risk keywords (harassment, severe defamation, slurs, doxxing, explicit NSFW)
const MEDIUM_RISK_KEYWORDS = [
  'bitch', 'asshole', 'fuck', 'slut', 'dick', 'cunt', 'whore',
  'nude', 'nudes', 'leak photos', 'bastard', 'cheat', 'drugging',
  'scammer', 'fraud', 'drugs', 'weed', 'drunk driving'
];

export class ModerationService {
  /**
   * Masks a phone number (e.g., 9876543210 -> ********10)
   */
  public maskPhone(phone: string): string {
    const cleaned = phone.replace(/[\s\-()]/g, '');
    if (cleaned.length <= 4) return '****';
    const lastTwo = cleaned.slice(-2);
    return '*'.repeat(Math.max(4, cleaned.length - 2)) + lastTwo;
  }

  /**
   * Masks an email (e.g., john.doe@example.com -> j***e@example.com)
   */
  public maskEmail(email: string): string {
    const [user, domain] = email.split('@');
    if (!domain) return '***@***';
    if (user.length <= 2) return `${user[0] || '*'}***@${domain}`;
    return `${user[0]}***${user[user.length - 1]}@${domain}`;
  }

  /**
   * Helper to check if text contains keyword using word boundary for single words
   */
  private matchesKeyword(text: string, kw: string): boolean {
    if (!kw.includes(' ')) {
      const regex = new RegExp(`\\b${kw}\\b`, 'i');
      return regex.test(text);
    }
    return text.toLowerCase().includes(kw);
  }

  /**
   * Analyze input confession text for PII, abusive content, threats, and calculate moderation risk
   */
  public analyzeContent(text: string): ModerationCheckResult {
    const reasons: string[] = [];
    const flaggedKeywords: string[] = [];
    const piiDetected: ModerationCheckResult['piiDetected'] = [];

    // 1. Check for High-Risk threats & self-harm
    for (const kw of HIGH_RISK_KEYWORDS) {
      if (this.matchesKeyword(text, kw)) {
        reasons.push(`Contains critical safety risk keyword: "${kw}"`);
        flaggedKeywords.push(kw);
      }
    }

    // 2. Check for Medium-Risk harassment/slurs
    for (const kw of MEDIUM_RISK_KEYWORDS) {
      if (this.matchesKeyword(text, kw)) {
        reasons.push(`Contains potentially offensive/harassing language: "${kw}"`);
        flaggedKeywords.push(kw);
      }
    }

    // 3. Detect PII: Phone numbers
    const phones = text.match(PHONE_REGEX) || [];
    for (const phone of phones) {
      // Avoid false positive on simple numbers like years (2024)
      if (phone.replace(/\D/g, '').length >= 10) {
        piiDetected.push({
          type: 'phone',
          value: phone,
          masked: this.maskPhone(phone),
        });
        reasons.push(`Phone number detected: ${this.maskPhone(phone)}`);
      }
    }

    // 4. Detect PII: Emails
    const emails = text.match(EMAIL_REGEX) || [];
    for (const email of emails) {
      piiDetected.push({
        type: 'email',
        value: email,
        masked: this.maskEmail(email),
      });
      reasons.push(`Email address detected: ${this.maskEmail(email)}`);
    }

    // 5. Detect PII: Credit card / Govt IDs
    const cards = text.match(CREDIT_CARD_REGEX) || [];
    for (const card of cards) {
      const digits = card.replace(/\D/g, '');
      if (digits.length >= 13 && digits.length <= 16) {
        piiDetected.push({
          type: 'card_id',
          value: card,
          masked: '****-****-****-**' + digits.slice(-2),
        });
        reasons.push('Possible payment card or financial account number detected');
      }
    }

    const ids = text.match(AADHAAR_OR_SSN_REGEX) || [];
    for (const id of ids) {
      piiDetected.push({
        type: 'card_id',
        value: id,
        masked: '***-**-****',
      });
      reasons.push('Government identity number detected');
    }

    // 6. Detect PII: Social media handles (e.g. @priya_12)
    const handles = text.match(HANDLE_REGEX) || [];
    for (const handle of handles) {
      piiDetected.push({
        type: 'handle',
        value: handle,
        masked: '@****',
      });
      reasons.push(`Private social handle referenced: ${handle}`);
    }

    // Determine Risk Level
    let risk: ModerationRisk = 'LOW';

    if (
      flaggedKeywords.some((kw) => HIGH_RISK_KEYWORDS.includes(kw)) ||
      piiDetected.length >= 2 ||
      piiDetected.some((p) => p.type === 'card_id')
    ) {
      risk = 'HIGH';
    } else if (
      flaggedKeywords.length > 0 ||
      piiDetected.length > 0
    ) {
      risk = 'MEDIUM';
    }

    return {
      risk,
      reasons,
      piiDetected,
      flaggedKeywords,
    };
  }

  /**
   * Masks all detected PII in the text
   */
  public maskSensitiveInformation(text: string, piiDetected: ModerationCheckResult['piiDetected']): string {
    let masked = text;
    for (const pii of piiDetected) {
      masked = masked.split(pii.value).join(pii.masked);
    }
    return masked;
  }
}

export const moderationService = new ModerationService();
