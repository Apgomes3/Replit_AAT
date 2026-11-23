// The printed article on AAT letterhead (A4). It sits outside the app while the article page is
// open, so both the Print button and Ctrl+P print it instead of the screen. Page one carries the full
// letterhead; later pages the short header. Every page has the AAT footer, the document number,
// revision and print date, and "Page n of m".
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Article, fmtDate } from './libraryApi';

const LINK_LABELS: Record<string, string> = {
  project: 'Project', initiative: 'Initiative', product: 'Product', client: 'Client', enquiry: 'Enquiry', design_book: 'Design book',
};

export default function ArticlePrint({ a }: { a: Article }) {
  useEffect(() => {
    document.body.classList.add('kb-print-ready');
    return () => document.body.classList.remove('kb-print-ready');
  }, []);

  const draft = a.revision.id !== a.published_revision_id;
  const status = a.status === 'archived' ? 'Archived' : draft ? (a.in_review ? 'Draft, waiting for approval' : 'Draft, not published') : 'Published';
  const printed = fmtDate(new Date().toISOString());
  const rows: Array<[string, string]> = [
    ['Document no.', a.code], ['Revision', `${a.revision.rev_no}`], ['Type', a.kind_label], ['Pool', a.pool.name],
    ['Status', status], ['Published', a.published_at && !draft ? fmtDate(a.published_at) : '—'],
    ['Owner', a.owner_name ?? '—'], ['Review by', a.review_by ? fmtDate(a.review_by) : '—'],
  ];
  if (a.category) rows.push(['Category', a.category]);

  return createPortal(<div className="kb-print" aria-hidden>
    <img className="kb-print-first" src="/print/aat-letterhead-first.png" alt="" />
    <img className="kb-print-header" src="/print/aat-letterhead-header.png" alt="" />
    <div className="kb-print-footer">
      <img src="/print/aat-letterhead-footer.png" alt="" />
      <div className="kb-print-footer-meta">{a.code} · Revision {a.revision.rev_no} · Printed {printed} · Uncontrolled when printed. Check the Knowledge Library for the current version.</div>
    </div>

    <table className="kb-print-frame">
      <thead><tr><td><div className="kb-print-top-space" /></td></tr></thead>
      <tfoot><tr><td><div className="kb-print-bottom-space" /></td></tr></tfoot>
      <tbody><tr><td>
        <div className="kb-print-body">
          <div className="kb-print-title-block">
            {draft && <div className="kb-print-draft">{status.toUpperCase()}: this is not the version readers see.</div>}
            <h1 className="kb-print-title">{a.revision.title}</h1>
            {a.revision.summary && <p className="kb-print-summary">{a.revision.summary}</p>}
            <table className="kb-print-meta"><tbody>
              {Array.from({ length: Math.ceil(rows.length / 2) }, (_, i) => <tr key={i}>
                <th>{rows[i * 2][0]}</th><td>{rows[i * 2][1]}</td>
                {rows[i * 2 + 1] ? <><th>{rows[i * 2 + 1][0]}</th><td>{rows[i * 2 + 1][1]}</td></> : <><th /><td /></>}
              </tr>)}
            </tbody></table>
          </div>

          {/* The HTML is cleaned on the server (rules.ts cleanHtml) before it is stored. */}
          <div className="kb-prose" dangerouslySetInnerHTML={{ __html: a.revision.body_html }} />

          {(a.links.length > 0 || a.files.length > 0 || a.tags.length > 0) && <div className="kb-print-related">
            {a.links.length > 0 && <p><b>Related records:</b> {a.links.map(l => `${LINK_LABELS[l.entity_type] ?? l.entity_type} ${l.label}`).join('; ')}</p>}
            {a.files.length > 0 && <p><b>Attachments (in the Knowledge Library):</b> {a.files.map(f => f.file_name).join('; ')}</p>}
            {a.tags.length > 0 && <p><b>Tags:</b> {a.tags.join(', ')}</p>}
          </div>}
        </div>
      </td></tr></tbody>
    </table>
  </div>, document.body);
}
