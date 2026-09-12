import * as fs from 'fs';
import { PDFParse } from 'pdf-parse';
import { parseRutText } from './src/common/rut/rut-extractor.util';

const path = 'C:/Users/angel/AppData/Local/Temp/opencode/rut-real.pdf';
const buffer = fs.readFileSync(path);
console.log('file bytes:', buffer.length);

(async () => {
  let text = '';
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const parsed = await parser.getText();
    text = parsed.text ?? '';
  } finally {
    await parser.destroy();
  }
  console.log('extracted chars:', text.length);
  const result = parseRutText(text);
  console.log('parseRutText result:');
  console.log(JSON.stringify(result, null, 2));
  const required = ['name', 'documentNumber'];
  const missing = required.filter((f) => !result[f as keyof typeof result]);
  console.log('MISSING REQUIRED:', JSON.stringify(missing));
})().catch((e) => {
  console.error('ERROR:', e);
  console.error(JSON.stringify(e).slice(0, 500));
});