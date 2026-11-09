import writeExcelFile from 'write-excel-file/node';

function sheet(name, headers, rows, moneyColumns = []) {
  const header = headers.map(value=>({value,type:String,fontWeight:'bold',backgroundColor:'#234F3D',color:'#FFFFFF'}));
  const data = rows.map(row=>row.map((value,index)=>({value:value??'',type:typeof value==='number'?Number:String,...(moneyColumns.includes(index)?{format:'#,##0" COP"'}:{})})));
  return { sheet:name, data:[header,...data], stickyRowsCount:1,
    columns:headers.map((h,i)=>({width:Math.min(40,rows.reduce((width,row)=>Math.max(width,String(row[i]??'').length+2),Math.max(16,h.length+2)))})) };
}
const localDate = value => new Date(value).toLocaleString('es-CO',{timeZone:'America/Bogota'});
const number = id => 'CC-'+String(id).padStart(4,'0');

export async function salesWorkbook(report) {
  const s=report.summary;
  const sheets=[
    sheet('Resumen',['Indicador','Valor'],[
      ['Desde',report.range.from],['Hasta',report.range.to],['Moneda','COP'],['Ventas registradas',s.sales],
      ['Unidades vendidas',s.units],['Cuentas',s.orders],['Consumidores',s.customers],['Promedio por cuenta COP',s.average],
      ['Pendiente actual del período COP',s.pending],['Cuentas saldadas del período COP',s.settled],
      ['Ventas del período anterior COP',report.comparison.sales],['Diferencia COP',report.comparison.change],
      ['Variación %',report.comparison.percent??'Sin ventas anteriores']]),
    sheet('Productos',['Producto','Categoría actual','Tipo','Unidades','Ventas COP'],report.products.map(p=>[p.name,p.category,p.type,p.units,p.sales]),[4]),
    sheet('Categorías',['Categoría actual','Tipo','Unidades','Ventas COP'],report.categories.map(c=>[c.name,c.type,c.units,c.sales]),[3]),
    sheet('Evolución',['Período','Ventas COP','Cuentas'],report.trend.map(t=>[t.period,t.sales,t.orders]),[1]),
    sheet('Notas',['Concepto','Explicación'],[
      ['Zona horaria','America/Bogota; ambos días incluidos'],['Ventas','Consumos registrados, incluidos los que siguen a crédito. No se incluyen ajustes de inventario.'],
      ['Estado de pago','Estado actual de cuentas emitidas en el período. No equivale al dinero recibido en el período.'],
      ['Comparación','Mismo número de días inmediatamente anteriores al rango.'],['Utilidad','No calculada: no hay costos de compra.']])
  ];
  return writeExcelFile(sheets,{fontFamily:'Calibri',fontSize:11}).toBuffer();
}

export async function monthlyWorkbook(report) {
  const sheets=[
    sheet('Resumen por persona',['Persona','Correo','Cuentas','Total COP','Saldado COP','Pendiente COP'],report.people.map(p=>[p.name,p.email,p.orders,p.total,p.settled,p.pending]),[3,4,5]),
    sheet('Cuentas del mes',['Persona','Correo','Cuenta','Fecha Colombia','Estado actual','Total COP'],report.invoices.map(i=>[i.consumer,i.email,number(i.id),localDate(i.created),i.status,i.total]),[5]),
    sheet('Detalle de productos',['Persona','Cuenta','Fecha Colombia','Producto histórico','Unidades','Precio unitario COP','Subtotal COP','Estado actual'],report.lines.map(l=>[l.consumer,number(l.invoice_id),localDate(l.created),l.name,l.quantity,l.price,l.quantity*l.price,l.status]),[5,6]),
    sheet('Lectura del informe',['Concepto','Valor'],[
      ['Mes',report.month],['Desde',report.range.from],['Hasta',report.range.to],['Zona horaria','America/Bogota'],
      ['Cuentas',report.totals.orders],['Total COP',report.totals.total],['Saldado COP',report.totals.settled],['Pendiente COP',report.totals.pending],
      ['Alcance','Solo cuentas emitidas en el mes seleccionado; no incluye deuda de otros meses.'],
      ['Saldado y pendiente','Estado actual de las cuentas del mes, no flujo de dinero recibido en ese mes.'],
      ['Subtotales','La hoja de detalle suma unidades por precio histórico; el total de una cuenta aparece una sola vez en Cuentas del mes.']])
  ];
  return writeExcelFile(sheets,{fontFamily:'Calibri',fontSize:11}).toBuffer();
}
