// The PHE selection sheet: one A4 page on AAT letterhead. It sits outside the app while the sizer is
// open, so the Print button and Ctrl+P print it instead of the screen; "Save as PDF" in the print dialog
// gives the PDF. The content comes from buildSheetModel, which the API also renders when the sheet is
// stored in the project's documents.
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { PheResult } from '../../lib/plateHeatExchanger';
import { SheetModel } from '../../lib/plateHeatExchangerSheet';
import { ProfileChart } from './PlateHeatExchangerChart';
import './plateHeatExchanger.css';

export type { SheetHeader } from '../../lib/plateHeatExchangerSheet';

export default function PlateHeatExchangerSheet({ r, model }: { r: PheResult; model: SheetModel }) {
  useEffect(() => {
    document.body.classList.add('phe-print-ready');
    return () => document.body.classList.remove('phe-print-ready');
  }, []);
  const h = model.header;
  return createPortal(<div className="phe-print" aria-hidden>
    <div className="phe-page">
      <img className="phe-hdr" src="/print/aat-letterhead-first.png" alt="" />
      <div className="phe-body">
        <h1>EQUIPMENT DATA SHEET · PLATE HEAT EXCHANGER</h1>
        <table className="phe-meta"><tbody>
          <tr><td className="k">Project</td><td>{h.project}</td><td className="k">Doc. no.</td><td>{h.doc_no}</td></tr>
          <tr><td className="k">Client</td><td>{h.client}</td><td className="k">Item / tag</td><td>{h.tag}</td></tr>
          <tr><td className="k">Service</td><td>{h.service}</td><td className="k">Rev / date</td><td>{h.rev} / {model.date}</td></tr>
        </tbody></table>
        <table><tbody>
          {model.sections.map(sec => [
            <tr key={sec.title} className="sec"><td colSpan={5}>{sec.title}</td></tr>,
            sec.columns && <tr key={`${sec.title}-h`} className="colh"><td></td><td style={{ textAlign: 'left' }}>Description</td><td>Unit</td><td>{sec.columns[0]}</td><td>{sec.columns[1]}</td></tr>,
            ...sec.rows.map(row => <tr key={row.n}>
              <td className="n">{row.n}</td><td>{row.desc}</td><td className="u">{row.unit}</td>
              {row.b === undefined ? <td className="v" colSpan={2}>{row.a}</td> : <><td className="v">{row.a}</td><td className="v">{row.b}</td></>}
            </tr>),
          ])}
        </tbody></table>
        <div className="phe-lower">
          <figure className="phe-chart">
            <figcaption>Temperature profile along the plate pack (counter-current)</figcaption>
            <ProfileChart r={r} print />
          </figure>
          <ul className="phe-notes">{model.notes.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </div>
        <table className="phe-sign"><tbody>
          <tr><td>Rev</td><td>Description</td><td>Date</td><td>Prepared</td><td>Checked</td><td>Approved</td></tr>
          <tr><td>{h.rev}</td><td>Issued for review</td><td>{model.date}</td><td>{h.prepared}</td><td>{h.checked}</td><td>{h.approved}</td></tr>
        </tbody></table>
      </div>
      <img className="phe-ftr" src="/print/aat-letterhead-footer.png" alt="" />
    </div>
  </div>, document.body);
}
