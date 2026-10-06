export interface DuplicateCheckResult {
  isDuplicate: boolean;
  duplicateOfId?: string | null;
  duplicateOfRow?: number | null;
  matchType?: 'EXACT' | 'NEAR_DUPLICATE' | 'NONE';
  similarity: number; // 0.0 to 1.0
  reason?: string;
}

export class DuplicateQualityService {
  /**
   * Normalize text for duplicate comparison
   */
  public normalize(text: string): string {
    return (text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Tokenize text into words
   */
  private tokenize(text: string): Set<string> {
    const norm = this.normalize(text);
    return new Set(norm.split(' ').filter(Boolean));
  }

  /**
   * Calculate Jaccard similarity between two token sets
   */
  public calculateJaccardSimilarity(textA: string, textB: string): number {
    const tokensA = this.tokenize(textA);
    const tokensB = this.tokenize(textB);

    if (tokensA.size === 0 || tokensB.size === 0) return 0;

    let intersection = 0;
    for (const t of tokensA) {
      if (tokensB.has(t)) intersection++;
    }

    const union = tokensA.size + tokensB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * Check if candidate text is duplicate of any existing submission
   */
  public checkDuplicate(
    candidateText: string,
    existingPool: Array<{ id: string; row?: number; text: string }>
  ): DuplicateCheckResult {
    const normCandidate = this.normalize(candidateText);
    if (!normCandidate) {
      return { isDuplicate: false, similarity: 0, matchType: 'NONE' };
    }

    // 1. Exact normalized match check
    for (const item of existingPool) {
      const normItem = this.normalize(item.text);
      if (normCandidate === normItem) {
        return {
          isDuplicate: true,
          duplicateOfId: item.id,
          duplicateOfRow: item.row ?? null,
          matchType: 'EXACT',
          similarity: 1.0,
          reason: `Exact identical match with confession #${item.row || item.id}`,
        };
      }
    }

    // 2. Near-duplicate check using word-level Jaccard similarity (> 0.85 for 4+ words)
    const wordsCount = normCandidate.split(' ').length;
    if (wordsCount >= 4) {
      for (const item of existingPool) {
        const similarity = this.calculateJaccardSimilarity(candidateText, item.text);
        if (similarity >= 0.88) {
          return {
            isDuplicate: true,
            duplicateOfId: item.id,
            duplicateOfRow: item.row ?? null,
            matchType: 'NEAR_DUPLICATE',
            similarity: Math.round(similarity * 100) / 100,
            reason: `Near-duplicate (${Math.round(similarity * 100)}% match) of confession #${item.row || item.id}`,
          };
        }
      }
    }

    return { isDuplicate: false, similarity: 0, matchType: 'NONE' };
  }
}

export const duplicateQualityService = new DuplicateQualityService();
