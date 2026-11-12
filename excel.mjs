import writeExcelFile from 'write-excel-file/node';

function sheet(name, headers, rows, moneyColumns = []) {
  const header = headers.map(value=>({value,type:String,fontWeight:'bold',backgroundColor:'#234F3D',color:'#FFFFFF'}));
  const data = rows.map(row=>row.map((value,index)=>({value:value??'',type:typeof value==='number'?Number:String,...(moneyColumns.includes(index)&&typeof value==='number'?{format:'#,##0" COP"'}:{})})));
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
      ['Ganancia bruta con costo histórico COP',s.realProfit??0],['Unidades sin costo histórico',s.unknownUnits??0],['Costo conocido de pérdidas COP',s.lossCost??0],['Ganancia bruta estimada COP',s.estimatedProfit],['Margen sobre venta %',30],['Ganancia potencial inventario actual COP',report.inventory.potentialProfit],['Unidades vendidas',s.units],['Cuentas',s.orders],['Consumidores',s.customers],['Promedio por cuenta COP',s.average],
      ['Pendiente actual del período COP',s.pending],['Abonos netos a cuentas del período COP',s.settled],
      ['Ventas del período anterior COP',report.comparison.sales],['Diferencia COP',report.comparison.change],
      ['Variación %',report.comparison.percent??'Sin ventas anteriores']]),
    sheet('Productos',['Producto','Unidades','Ventas COP','Ganancia con costo histórico COP','Unidades sin costo','Ganancia por unidad estimada COP','Ganancia estimada COP'],report.products.map(p=>[p.name,p.units,p.sales,p.real_profit??0,p.unknown_units??0,p.estimatedProfitPerUnit,p.estimatedProfit]),[2,3,5,6]),
    sheet('Inventario actual',['Producto','Stock','Precio venta COP','Costo unitario actual COP','Ganancia por unidad con costo COP','Ganancia por unidad estimada COP','Ganancia potencial estimada COP'],report.inventory.products.map(p=>[p.name,p.stock,p.price,p.unit_cost??'Sin dato',p.actualProfitPerUnit??'Sin dato',p.estimatedProfitPerUnit,p.potentialProfit]),[2,3,4,5,6]),
    sheet('Baja venta',['Producto','Unidades del período','Stock actual'],report.insights.lowSales.map(p=>[p.name,p.units,p.stock])),
    sheet('Reposición 14 días',['Producto','Stock actual','Unidades por día','Días de inventario','Compra sugerida'],(report.insights.replenishment||[]).map(p=>[p.name,p.stock,p.dailyDemand,p.stockDays,p.suggestedQuantity])),
    sheet('Evolución',['Período','Ventas COP','Cuentas'],report.trend.map(t=>[t.period,t.sales,t.orders]),[1]),
    sheet('Notas',['Concepto','Explicación'],[
      ['Zona horaria','America/Bogota; ambos días incluidos'],['Ventas','Consumos registrados, incluidos los que siguen a crédito. No se incluyen ajustes de inventario.'],
      ['Estado de pago','Estado actual de cuentas emitidas en el período. No equivale al dinero recibido en el período.'],
      ['Ganancia real','Solo unidades con costo guardado al vender. Excluye ventas antiguas sin costo. Bruta antes de gastos e impuestos.'],['Devoluciones','Descuentan las ventas del período de la cuenta original. Los reembolsos se registran en la caja de la fecha de entrega.'],['Reposición','Demanda del período por 14 días menos stock actual. No contempla ventas perdidas por agotados ni plazos de proveedor.'],['Comparación','Mismo número de días inmediatamente anteriores al rango.'],['Ganancia estimada','Ventas × 30% de margen sobre venta. Bruta, antes de gastos e impuestos; incluye crédito. No usa costos históricos.'],['Inventario','Stock y precios actuales. Ganancia potencial aún no ganada.'],['Baja venta','Productos activos con stock y máximo 1 unidad por semana, proporcional al rango. Revisar disponibilidad y antigüedad antes de comprar; períodos menores de 7 días son insuficientes.']])
  ];
  return writeExcelFile(sheets,{fontFamily:'Calibri',fontSize:11}).toBuffer();
}

export async function monthlyWorkbook(report) {
  const sheets=[
    sheet('Resumen por persona',['Persona','Correo','Cuentas','Total COP','Abonado neto COP','Pendiente COP'],report.people.map(p=>[p.name,p.email,p.orders,p.total,p.settled,p.pending]),[3,4,5]),
    sheet('Cuentas del mes',['Persona','Correo','Cuenta','Fecha Colombia','Estado actual','Total neto COP','Abonado neto COP','Saldo COP'],report.invoices.map(i=>[i.consumer,i.email,number(i.id),localDate(i.created),i.status,i.total,i.paid??0,i.total-(i.paid??0)]),[5,6,7]),
    sheet('Detalle de productos',['Persona','Cuenta','Fecha Colombia','Producto histórico','Unidades netas','Devueltas','Precio venta unitario COP','Subtotal neto COP','Estado actual'],report.lines.map(l=>[l.consumer,number(l.invoice_id),localDate(l.created),l.name,l.quantity-(l.returned_quantity||0),l.returned_quantity||0,l.price,(l.quantity-(l.returned_quantity||0))*l.price,l.status]),[6,7]),
    sheet('Lectura del informe',['Concepto','Valor'],[
      ['Mes',report.month],['Desde',report.range.from],['Hasta',report.range.to],['Zona horaria','America/Bogota'],
      ['Cuentas',report.totals.orders],['Total COP',report.totals.total],['Abonado neto COP',report.totals.settled],['Pendiente COP',report.totals.pending],
      ['Alcance','Solo cuentas emitidas en el mes seleccionado; no incluye deuda de otros meses.'],
      ['Abonado y pendiente','Estado actual de las cuentas del mes, no flujo de dinero recibido en ese mes.'],
      ['Subtotales','La hoja de detalle suma unidades por precio histórico; el total de una cuenta aparece una sola vez en Cuentas del mes.']])
  ];
  return writeExcelFile(sheets,{fontFamily:'Calibri',fontSize:11}).toBuffer();
}

export async function inventoryTemplate(){
 return writeExcelFile([sheet('Inventario',['Producto','Precio venta','Cantidad','Precio unitario'],[])]).toBuffer();
}
