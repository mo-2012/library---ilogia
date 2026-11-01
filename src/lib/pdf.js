// pdf.js wrapper (lazy-loaded: students who never open a PDF never download it).
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Opens a PDF from a URL (HTTP range requests: only the pages being read are fetched) or from bytes.
 *  Returns { doc, destroy } — destroy() releases the worker-side document and its network connection. */
export async function openPdf({ url, data }) {
  const assets = { standardFontDataUrl: '/pdfjs/standard_fonts/', cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, wasmUrl: '/pdfjs/wasm/', iccUrl: '/pdfjs/iccs/' };
  const task = pdfjs.getDocument(url ? { url, rangeChunkSize: 262144, disableAutoFetch: true, enableXfa: false, isEvalSupported: false, ...assets }
    : { data, isEvalSupported: false, ...assets });
  const doc = await task.promise;
  return { doc, destroy: () => task.destroy() };
}
