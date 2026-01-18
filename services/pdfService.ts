
declare const pdfjsLib: any;
declare const Tesseract: any;

export interface ExtractionProgress {
  type: 'parsing' | 'ocr';
  page: number;
  totalPages: number;
  percentage: number;
}

export const extractTextFromPdf = async (
  file: File,
  onProgress: (progress: ExtractionProgress) => void
): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  let fullText = "";

  // Create a reusable canvas for OCR
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    
    // Improved text reconstruction: handle line breaks and spaces better
    let lastY: number | null = null;
    let pageText = "";
    
    for (const item of (textContent.items as any[])) {
      if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
        pageText += "\n";
      } else if (lastY !== null) {
        pageText += " ";
      }
      pageText += item.str;
      lastY = item.transform[5];
    }

    onProgress({
      type: 'parsing',
      page: i,
      totalPages: pdf.numPages,
      percentage: Math.round((i / pdf.numPages) * 100)
    });

    // Heuristic for scanned/unreliable text:
    // If text is very short OR has a suspiciously low ratio of letters to total characters
    const alphanumericCount = pageText.replace(/[^a-zA-Z0-9]/g, "").length;
    const isLikelyScanned = pageText.trim().length < 50 || (alphanumericCount / pageText.length < 0.3);

    if (isLikelyScanned && ctx) {
      onProgress({
        type: 'ocr',
        page: i,
        totalPages: pdf.numPages,
        percentage: Math.round((i / pdf.numPages) * 100)
      });

      // Render page at higher scale for better OCR accuracy (3.0 vs 2.0)
      const viewport = page.getViewport({ scale: 3.0 });
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({
        canvasContext: ctx,
        viewport: viewport
      }).promise;

      // Use Tesseract with better configuration
      const { data: { text } } = await Tesseract.recognize(canvas, 'eng', {
        logger: (m: any) => console.debug(m),
      });
      
      pageText = text;
    }

    fullText += `--- Page ${i} ---\n${pageText}\n\n`;
  }

  return fullText.trim();
};
