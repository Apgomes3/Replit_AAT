import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, useNavigate } from 'react-router-dom';
import ProtectedDraftBar from '../../src/components/ui/ProtectedDraftBar';

function Editor() {
  const [text, setText] = useState('');
  const [baseline, setBaseline] = useState('');
  const [version, setVersion] = useState('1');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [fail, setFail] = useState(false);
  const [error, setError] = useState<any>(null);
  const navigate = useNavigate();
  const save = async () => {
    if (fail) {
      setError({ response: { status: 503, data: { error: { message: 'Interrupted request' } } } });
      return;
    }
    setError(null);
    setBaseline(text);
    setVersion(value => String(Number(value) + 1));
    setSavedAt(Date.now());
  };
  return <>
    <label>Draft text<input aria-label="Draft text" value={text} onChange={event => setText(event.target.value)} /></label>
    <ProtectedDraftBar storageKey="browser-test:record-1" value={text} baseline={baseline}
      version={version} savedAt={savedAt} error={error} onRestore={setText} onSave={save}
      onConflictReload={() => { setText(baseline); setError(null); }} />
    <button onClick={() => setFail(value => !value)}>Toggle request failure</button>
    <button onClick={save}>Save</button>
    <button onClick={() => navigate('/away')}>Leave</button>
  </>;
}

const router = createMemoryRouter([
  { path: '/', element: <Editor /> },
  { path: '/away', element: <p>Other page</p> },
]);
createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);