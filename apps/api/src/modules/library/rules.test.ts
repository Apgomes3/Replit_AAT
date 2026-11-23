import { describe, expect, it } from 'vitest';
import { cleanHtml, htmlToText, poolRights, saveOutcome, validateArticle } from './rules';

const base = { isAdmin: false, isOwner: false, isEditor: false, isReader: false, restricted: false };

describe('pool rights', () => {
  it('lets everyone read an open pool but only owner and editors write', () => {
    expect(poolRights(base)).toMatchObject({ read: true, write: false, approve: false });
    expect(poolRights({ ...base, isEditor: true })).toMatchObject({ read: true, write: true, approve: false, members: false });
    expect(poolRights({ ...base, isOwner: true })).toMatchObject({ write: true, approve: true, members: true, settings: false });
    expect(poolRights({ ...base, isAdmin: true })).toMatchObject({ settings: true, approve: true });
  });

  it('keeps a restricted pool to its readers, editors and owner', () => {
    expect(poolRights({ ...base, restricted: true }).read).toBe(false);
    expect(poolRights({ ...base, restricted: true, isReader: true })).toMatchObject({ read: true, write: false });
    expect(poolRights({ ...base, restricted: true, isEditor: true }).read).toBe(true);
  });
});

describe('saving an article', () => {
  it('publishes at once except procedures, which wait for the pool owner', () => {
    expect(saveOutcome('howto', true, false)).toBe('publish');
    expect(saveOutcome('procedure', true, false)).toBe('review');
    expect(saveOutcome('procedure', true, true)).toBe('publish');
    expect(saveOutcome('procedure', false, true)).toBe('draft');
  });

  it('checks fields and tidies tags', () => {
    expect(validateArticle({ title: '  ' }, true)).toEqual({ error: 'Give the article a title' });
    expect(validateArticle({ title: 'Annealing', tags: ['Acrylic', ' acrylic', 'Heat '], review_by: '2027-06-01' }, true))
      .toEqual({ value: { title: 'Annealing', tags: ['acrylic', 'heat'], review_by: '2027-06-01' } });
    expect(validateArticle({ kind: 'memo' }, false)).toEqual({ error: 'Unknown article type' });
    expect(validateArticle({ review_by: '1 June' }, false)).toMatchObject({ error: expect.stringMatching(/review date/) });
  });
});

describe('article HTML', () => {
  it('keeps editor formatting and drops scripts, handlers and odd links', () => {
    const html = cleanHtml('<h2>Steps</h2><p onclick="x()">Bond <strong>clean</strong><script>alert(1)</script></p>'
      + '<a href="javascript:alert(1)">bad</a><a href="https://aat.example/x">good</a>'
      + '<table><tbody><tr><td colspan="2">cell</td></tr></tbody></table>');
    expect(html).toBe('<h2>Steps</h2><p>Bond <strong>clean</strong></p><a target="_blank" rel="noopener noreferrer">bad</a>'
      + '<a href="https://aat.example/x" target="_blank" rel="noopener noreferrer">good</a>'
      + '<table><tbody><tr><td colspan="2">cell</td></tr></tbody></table>');
  });

  it('keeps pasted images but not other data URLs', () => {
    expect(cleanHtml('<img src="data:image/png;base64,iVBORw0KGgo=" alt="panel">')).toBe('<img src="data:image/png;base64,iVBORw0KGgo=" alt="panel" />');
    expect(cleanHtml('<img src="data:text/html;base64,PHNjcmlwdD4=">')).toBe('');
  });

  it('turns an article into searchable text', () => {
    expect(htmlToText('<h2>Annealing</h2><p>Heat to 80&nbsp;°C</p><ul><li>Slow</li><li>Cool</li></ul>')).toBe('Annealing Heat to 80 °C Slow Cool');
  });
});
