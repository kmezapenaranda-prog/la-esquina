import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { salesWorkbook, monthlyWorkbook } from '../excel.mjs';

function inspect(buffer, sheetNames) {
  const files=unzipSync(buffer);
  assert.ok(files['[Content_Types].xml']);
  const workbook=strFromU8(files['xl/workbook.xml']);
  for(const name of sheetNames)assert.ok(workbook.includes(name));
  const xml=Object.entries(files).filter(([name])=>name.endsWith('.xml')).map(([,content])=>strFromU8(content)).join('\n');
  assert.ok(!xml.includes('<f>'),'User strings must never become formulas');
  return xml;
}

test('real Excel sales workbook has numeric amounts, separate sheets and safe text', async () => {
  const report={range:{from:'2026-11-01',to:'2026-11-30'},summary:{sales:5000,units:2,orders:1,customers:1,average:5000,pending:5000,settled:0},comparison:{sales:0,change:5000,percent:null},products:[{name:'=1+1 <prueba>',category:'Dulces',type:'Comida',units:2,sales:5000}],categories:[{name:'Dulces',type:'Comida',units:2,sales:5000}],trend:[{period:'2026-11-01',sales:5000,orders:1}]};
  const xml=inspect(await salesWorkbook(report),['Resumen','Productos','Categorías','Evolución','Notas']);
  assert.match(xml,/<v>5000<\/v>/);
  assert.ok(xml.includes('=1+1 &lt;prueba&gt;'));
});

test('monthly Excel contains per-person totals, invoices and historical product details', async () => {
  const report={month:'2026-11',range:{from:'2026-11-01',to:'2026-11-30'},totals:{orders:1,total:5000,settled:0,pending:5000},people:[{name:'Ana',email:'ana@test.co',orders:1,total:5000,settled:0,pending:5000}],invoices:[{id:5,consumer:'Ana',email:'ana@test.co',created:'2026-11-01T05:00:00Z',status:'Pendiente',total:5000}],lines:[{consumer:'Ana',invoice_id:5,created:'2026-11-01T05:00:00Z',name:'Papas',quantity:2,price:2500,status:'Pendiente'}]};
  const xml=inspect(await monthlyWorkbook(report),['Resumen por persona','Cuentas del mes','Detalle de productos','Lectura del informe']);
  assert.ok(xml.includes('CC-0005'));assert.match(xml,/<v>2500<\/v>/);assert.ok(xml.includes('ana@test.co'));
});
