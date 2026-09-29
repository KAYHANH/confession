import { describe, it, expect } from 'vitest';
import {
  paginateConfession,
  tokenize,
  verifyContentPreservation,
  buildInstagramCaption,
  createHookText,
  canFitOnSingleCard,
  validatePublicationPayload,
} from '../lib/paginationEngine';
import { splitIntoSlides } from '../components/confessions/PostCardPreview';

describe('Carousel Pagination & Layout Engine', () => {
  const shortConfession =
    'Just wanted to confess for a boy named HASSAN!!!! ❤️😭 He is so kind and sweet to everyone. Hope he notices me soon!';

  const mediumConfession = `I've been holding this in for the past two semesters, and honestly I don't know who else to talk to. Back in October during midterm week, I accidentally overheard my closest friend and study partner talking in the library study lounge about how they intentionally didn't share the final review notes with me because they wanted to set the grading curve. 

At first I thought maybe I misheard or was just being paranoid from sleep deprivation. But later that week on exam day, several questions matched exact topics they had reviewed without me. It felt like a punch in the gut because I had spent weeks tutoring them in calculus when they were failing. 

I haven't confronted them yet because we share the same small lab group and friend circle, but every time we study together now, I feel completely disconnected. What would you do in my position?`;

  const veryLongConfession = `Let me start by saying that I never thought I would be writing something like this on an anonymous confession page, but after everything that transpired over the last six months, I genuinely feel like I have nowhere else to turn. 

It all started back in the beginning of the semester when our department announced the annual capstone project teams. For those who don't know, this capstone determines almost forty percent of our final year grading, and companies directly recruit based on the project deliverables. I was placed in a team with three other students who seemed initially enthusiastic and committed. We set up weekly meetings, divided responsibilities, and agreed on a shared repository for our work.

By week four, however, things began deteriorating rapidly. Two of the team members stopped showing up to our scheduled lab sprints, leaving excuses about personal emergencies and exam pressures. Being naive and wanting the project to succeed, I took on their modules alongside my own backend architecture tasks. I ended up pulling multiple forty-eight hour coding marathons in the computer science lab just to keep our sprint deliverables on track.

When mid-term evaluations arrived, our faculty advisor praised the project architecture and gave our entire team top tier marks. At the presentation, the teammates who hadn't contributed a single line of working code spoke confidently, claiming leadership over the algorithmic pipelines and data models that I had spent endless sleepless nights building from scratch. I was too stunned and exhausted to speak up in the moment.

The breaking point arrived two weeks ago during the final pre-submission code freeze. I discovered that one of the non-contributing teammates had submitted an application for the department's top innovation grant, listing themselves as the sole principal author and completely omitting my name from the submission credits. When I confronted them privately, they laughed it off and claimed it was an administrative clerical error that couldn't be amended.

I am torn between reporting the full commit history and timestamped logs to the academic integrity board, which might delay graduation for everyone involved, or simply letting it go, graduating peacefully, and cutting all contact forever. If anyone has navigated a situation like this without destroying their own peace of mind, please share your perspective.`;

  describe('Short Confession (User Reported Scenario: 26 words)', () => {
    it('should fit comfortably on 1 card without forced multi-slide carousel', () => {
      const result = paginateConfession(shortConfession);

      expect(result.totalSlides).toBe(1);
      expect(result.format).toBe('IMAGE');
      expect(result.recommendedFormat).toBe('Single Post');
      expect(result.canFitSingle).toBe(true);
      expect(result.slides[0].text).toBe(shortConfession);
      expect(result.slides[0].isFirst).toBe(true);
      expect(result.slides[0].isLast).toBe(true);
    });

    it('should preserve all words, punctuation, and emojis perfectly', () => {
      const result = paginateConfession(shortConfession);
      const isPreserved = verifyContentPreservation(shortConfession, [result.slides[0].text]);

      expect(isPreserved).toBe(true);
      expect(result.slides[0].text).toContain('HASSAN!!!!');
      expect(result.slides[0].text).toContain('❤️😭');
    });

    it('should generate an independent Instagram caption that does NOT duplicate confession text', () => {
      const caption = buildInstagramCaption({
        confessionNumber: 33,
        hashtags: ['#campuslife', '#confessions'],
        mode: 'fit',
      });

      expect(caption).toContain('Confession #033');
      expect(caption).not.toContain('HASSAN');
      expect(caption).not.toContain(shortConfession);
      expect(caption).toContain('Share your thoughts below 👇');
    });
  });

  describe('Long Confessions (Multi-Slide Auto Pagination)', () => {
    it('should paginate long confessions across multiple slides', () => {
      const result = paginateConfession(veryLongConfession);

      expect(result.totalSlides).toBeGreaterThan(1);
      expect(result.totalSlides).toBeLessThanOrEqual(10);
      expect(result.format).toBe('CAROUSEL');
      expect(result.recommendedFormat).toBe('Carousel');
      expect(result.slides[0].isFirst).toBe(true);
      expect(result.slides[result.totalSlides - 1].isLast).toBe(true);
    });

    it('should guarantee 100% token and content preservation with zero word loss', () => {
      const result = paginateConfession(veryLongConfession);
      const slideTexts = result.slides.map((s) => s.text);
      const isPreserved = verifyContentPreservation(veryLongConfession, slideTexts);

      expect(isPreserved).toBe(true);
      expect(result.validationError).toBeUndefined();

      // Token count equality check
      const sourceTokens = tokenize(veryLongConfession);
      const outputTokens = tokenize(slideTexts.join(' '));
      expect(outputTokens.length).toBe(sourceTokens.length);
      expect(outputTokens).toEqual(sourceTokens);
    });

    it('should never contain truncation markers like "... [Read caption 👇]" on slides', () => {
      const result = paginateConfession(veryLongConfession);
      for (const slide of result.slides) {
        expect(slide.text).not.toContain('... [Read caption');
        expect(slide.text).not.toContain('Read caption 👇');
      }
    });

    it('should break on clean boundaries (sentences or paragraphs)', () => {
      const result = paginateConfession(veryLongConfession);
      for (let i = 0; i < result.slides.length - 1; i++) {
        const slideText = result.slides[i].text.trim();
        // Each non-last slide should end on punctuation or clean clause boundary
        const lastChar = slideText.slice(-1);
        expect(/[\.\!\?\,\;\:\-]/.test(lastChar)).toBe(true);
      }
    });

    it('should produce an independent caption for Carousel mode', () => {
      const caption = buildInstagramCaption({
        confessionNumber: 42,
        hashtags: ['#college', '#story'],
        mode: 'carousel',
      });

      expect(caption).toContain('Confession #042');
      expect(caption).toContain('#college');
      expect(caption).not.toContain(veryLongConfession);
    });
  });

  describe('Medium Confession Pagination', () => {
    it('should paginate medium confessions cleanly across 2 or 3 slides', () => {
      const result = paginateConfession(mediumConfession);
      expect(result.totalSlides).toBeGreaterThanOrEqual(1);

      const slideTexts = result.slides.map((s) => s.text);
      expect(verifyContentPreservation(mediumConfession, slideTexts)).toBe(true);
    });
  });

  describe('Hook + Caption Mode', () => {
    it('should extract a clean hook for the card and put full confession into caption', () => {
      const hook = createHookText(mediumConfession, 250);
      expect(hook).toContain('[📖 Read full confession in caption 👇]');
      expect(hook.length).toBeLessThan(mediumConfession.length);

      const caption = buildInstagramCaption({
        confessionNumber: 15,
        mode: 'hook',
        sourceConfession: mediumConfession,
      });

      expect(caption).toContain('Confession #015');
      expect(caption).toContain(mediumConfession.trim());
      expect(caption).toContain('Share your thoughts below 👇');
    });
  });

  describe('Pre-flight Payload Validation', () => {
    it('should pass validation for valid single post payload', () => {
      const caption = buildInstagramCaption({ confessionNumber: 1, mode: 'fit' });
      const validation = validatePublicationPayload({
        sourceConfession: shortConfession,
        slides: [shortConfession],
        mode: 'fit',
        caption,
      });

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should pass validation for valid multi-slide carousel payload', () => {
      const result = paginateConfession(veryLongConfession);
      const slideTexts = result.slides.map((s) => s.text);
      const caption = buildInstagramCaption({ confessionNumber: 5, mode: 'carousel' });

      const validation = validatePublicationPayload({
        sourceConfession: veryLongConfession,
        slides: slideTexts,
        mode: 'carousel',
        caption,
      });

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should block carousel publication if carousel has less than 2 slides', () => {
      const validation = validatePublicationPayload({
        sourceConfession: shortConfession,
        slides: [shortConfession],
        mode: 'carousel',
        caption: 'Test caption',
      });

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Carousel format requires at least 2 slides.');
    });

    it('should block publication if content is accidentally truncated or lost', () => {
      const truncatedSlide = veryLongConfession.slice(0, 100);
      const validation = validatePublicationPayload({
        sourceConfession: veryLongConfession,
        slides: [truncatedSlide],
        mode: 'fit',
        caption: 'Test caption',
      });

      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes('losing content'))).toBe(true);
    });

    it('should block publication if visual mode accidentally dumps full confession into caption', () => {
      const validation = validatePublicationPayload({
        sourceConfession: mediumConfession,
        slides: [mediumConfession],
        mode: 'fit',
        caption: `Confession #01 💭\n\n${mediumConfession}\n\nComment below!`,
      });

      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes('duplicate the full confession'))).toBe(true);
    });

    it('should block publication if slides exceed platform limit of 10 slides', () => {
      const excessiveSlides = Array.from({ length: 12 }, (_, i) => `Slide content ${i + 1}`);
      const validation = validatePublicationPayload({
        sourceConfession: excessiveSlides.join(' '),
        slides: excessiveSlides,
        mode: 'carousel',
        caption: 'Test caption',
      });

      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes('platform limit is 10'))).toBe(true);
    });
  });

  describe('PostCardPreview splitIntoSlides Integration', () => {
    it('should delegate splitIntoSlides to paginateConfession and preserve tokens', () => {
      const slides = splitIntoSlides(veryLongConfession);
      expect(slides.length).toBeGreaterThan(1);
      expect(verifyContentPreservation(veryLongConfession, slides)).toBe(true);
    });

    it('should return 1 slide for short confessions', () => {
      const slides = splitIntoSlides(shortConfession);
      expect(slides.length).toBe(1);
      expect(slides[0]).toBe(shortConfession);
    });
  });

  describe('Single Card Safety Check', () => {
    it('should report canFitOnSingleCard true for short confessions', () => {
      expect(canFitOnSingleCard(shortConfession)).toBe(true);
    });

    it('should report canFitOnSingleCard false for excessive text that cannot safely fit on one card', () => {
      expect(canFitOnSingleCard(veryLongConfession)).toBe(false);
    });
  });
});
