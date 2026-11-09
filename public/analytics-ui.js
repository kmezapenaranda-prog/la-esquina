let analyticsData = null;
let analyticsRequest = 0;
let reportPreset = 'month';

function bogotaToday() {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = type => parts.find(p => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function shiftDate(value, days) {
  const d = new Date(value + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function presetDates(preset) {
  const to = bogotaToday(), first = to.slice(0, 7) + '-01';
  if (preset === 'today') return { from: to, to };
  if (preset === 'week') return { from: shiftDate(to, -6), to };
  if (preset === '30days') return { from: shiftDate(to, -29), to };
  if (preset === 'previous') { const last = shiftDate(first, -1); return { from: last.slice(0, 7) + '-01', to: last }; }
  return { from: first, to };
}
let analysisRange = presetDates('month');
const reportDate = value => new Date(value + 'T12:00:00Z').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' });

function analyticsPage() {
  return heading('Análisis de ventas', 'Entiende qué se vende y elige el período que quieres revisar.', button('Cuentas por persona','jump-monthly','users','secondary')) + `
    <section class="panel report-filters" aria-label="Período del análisis">
      <form id="analysis-form">
        <label class="field">Período<select id="report-preset">${[['month','Este mes'],['previous','Mes anterior'],['today','Hoy'],['week','Últimos 7 días'],['30days','Últimos 30 días'],['custom','Personalizado']].map(([v,t])=>`<option value="${v}" ${reportPreset===v?'selected':''}>${t}</option>`).join('')}</select></label>
        <label class="field">Desde<input type="date" name="from" value="${analysisRange.from}" min="2000-01-01" max="2100-12-31" required></label>
        <label class="field">Hasta<input type="date" name="to" value="${analysisRange.to}" min="2000-01-01" max="2100-12-31" required></label>
        <button class="btn" type="submit">${icon('chart')} Analizar</button>
      </form>
      <p id="report-error" class="form-error" role="alert"></p>
      <p class="report-note">Fechas inclusivas, hora de Colombia. Las ventas incluyen consumos a crédito; las salidas por ajuste no se cuentan como ventas.</p>
    </section>
    <div id="analysis-results" aria-live="polite" aria-busy="${!analyticsData}">${analyticsData ? reportContent(analyticsData) : '<div class="panel report-loading">Consultando las ventas del período…</div>'}</div>${monthlyPanel()}`;
}
function bindAnalytics() {
  const form = $('#analysis-form');
  form.onsubmit = e => { e.preventDefault(); loadAnalytics(); };
  $('#report-preset').onchange = e => {
    reportPreset = e.target.value;
    if (reportPreset === 'custom') return;
    const dates = presetDates(reportPreset);
    form.elements.from.value = dates.from;
    form.elements.to.value = dates.to;
    loadAnalytics();
  };
  for (const name of ['from','to']) form.elements[name].onchange = () => { reportPreset = 'custom'; $('#report-preset').value = 'custom'; };
  bindMonthly();
  if (!analyticsData) loadAnalytics();
  else bindReportExport();
}
async function loadAnalytics() {
  const form = $('#analysis-form');
  if (!form || !form.reportValidity()) return;
  const range = { from: form.elements.from.value, to: form.elements.to.value };
  if (range.from > range.to) { $('#report-error').textContent = 'La fecha inicial debe ser anterior o igual a la final.'; return; }
  const request = ++analyticsRequest, userId = state.user.id;
  const submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  $('#report-error').textContent = '';
  $('#analysis-results').setAttribute('aria-busy', 'true');
  $('#analysis-results').innerHTML = '<div class="panel report-loading">Consultando las ventas del período…</div>';
  try {
    const data = await api(`analytics?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);
    if (request !== analyticsRequest || view !== 'analytics' || state?.user.id !== userId) return;
    analyticsData = data;
    analysisRange = range;
    $('#analysis-results').innerHTML = reportContent(data);
    adaptTables();
    bindReportExport();
  } catch (error) {
    if (request !== analyticsRequest || view !== 'analytics' || !$('#analysis-results')) return;
    analyticsData = null;
    $('#report-error').textContent = error.message;
    $('#analysis-results').innerHTML = empty('No pudimos cargar el análisis', 'Revisa las fechas y vuelve a pulsar Analizar.', 'chart');
  } finally {
    if (request === analyticsRequest && view === 'analytics' && $('#analysis-results')) {
      submit.disabled = false;
      $('#analysis-results').setAttribute('aria-busy', 'false');
    }
  }
}
function reportContent(data) {
  const { summary:s, comparison:c } = data;
  const comparison = c.percent === null ? 'Sin ventas en el período anterior' : `${c.percent>0?'+':''}${c.percent}% frente al período anterior`;
  return `<div class="report-period"><p><strong>${reportDate(data.range.from)} — ${reportDate(data.range.to)}</strong><small>${data.range.days} ${data.range.days===1?'día':'días'} · comparación con los ${data.range.days} días anteriores</small></p><div class="actions"><button class="btn" id="export-excel">${icon('down')} Descargar Excel</button><button class="btn secondary" id="export-report">${icon('down')} CSV</button></div></div>
    <div class="overview report-overview">
      <div class="stat"><div class="stat-label">Ventas registradas</div><div class="stat-value">${money(s.sales)}</div><small class="${c.change<0?'report-decrease':''}">${comparison}</small></div>
      <div class="stat"><div class="stat-label">Unidades vendidas</div><div class="stat-value">${s.units}</div><small>${s.orders} cuentas · ${s.customers} consumidores</small></div>
      <div class="stat"><div class="stat-label">Promedio por cuenta</div><div class="stat-value">${money(s.average)}</div><small>Total vendido ÷ número de cuentas</small></div>
      <div class="stat"><div class="stat-label">Pendiente del período</div><div class="stat-value orange">${money(s.pending)}</div><small>${money(s.settled)} en cuentas saldadas</small></div>
    </div>
    ${!s.orders?'<div class="notice">'+icon('receipt')+'<span>No hay ventas registradas en estas fechas. Prueba otro período; los datos aparecerán al registrar consumos.</span></div>':''}
    <div class="report-grid"><section class="panel"><div class="panel-heading"><div><h2>Evolución de ventas</h2><small>${data.granularity==='month'?'Por mes; solo se cuentan los días seleccionados':'Por día, incluyendo días sin ventas'}</small></div></div><div class="panel-body report-chart-body">${salesChart(data)}<details class="chart-details"><summary>Ver datos del gráfico</summary><div class="table-wrap"><table><thead><tr><th>Período</th><th>Ventas</th><th>Cuentas</th></tr></thead><tbody>${data.trend.map(row=>`<tr><td>${esc(trendLabel(row.period))}</td><td>${money(row.sales)}</td><td>${row.orders}</td></tr>`).join('')}</tbody></table></div></details></div></section>
      <section class="panel"><div class="panel-heading"><div><h2>Ventas por categoría</h2><small>Distribución del valor vendido</small></div></div><div class="panel-body">${categoryBars(data)}</div></section></div>
    <section class="panel report-products"><div class="panel-heading"><div><h2>Productos más vendidos</h2><small>Ordenados por unidades; valores a precios históricos de cada cuenta.</small></div></div>${data.products.length?`<div class="table-wrap"><table><thead><tr><th>Producto</th><th>Categoría actual</th><th>Unidades</th><th>Ventas</th><th>Del total vendido</th></tr></thead><tbody>${data.products.map(p=>`<tr><td><strong>${esc(p.name)}</strong></td><td>${esc(p.category)}</td><td>${p.units}</td><td class="money">${money(p.sales)}</td><td>${s.sales?Math.round(p.sales/s.sales*1000)/10:0}%</td></tr>`).join('')}</tbody></table></div>`:empty('Aún no hay productos vendidos','Selecciona un período con consumos registrados.','chart')}</section>
    <div class="bottom-grid report-insights"><section class="panel"><div class="panel-heading"><div><h2>Para reponer</h2><small>Existencias actuales, independientes del período.</small></div></div>${data.stock.length?`<ul class="insight-list">${data.stock.map(p=>`<li><span><strong>${esc(p.name)}</strong><small>Aviso configurado en ${p.minimum} unidades</small></span>${pill(p.stock===0?'Agotado':`${p.stock} disponibles`,p.stock===0?'danger':'warning')}</li>`).join('')}</ul>`:empty('Inventario al día','Ningún producto está por debajo de su aviso de stock.','check')}</section>
    <section class="panel"><div class="panel-heading"><div><h2>Sin ventas en el período</h2><small>Productos activos para revisar su rotación.</small></div></div>${data.noSales.length?`<ul class="insight-list">${data.noSales.map(p=>`<li><span><strong>${esc(p.name)}</strong><small>${p.stock} unidades en inventario actual</small></span></li>`).join('')}</ul>`:empty('Todos tuvieron ventas','Cada producto activo tuvo al menos un consumo en el período.','check')}</section></div>
    <p class="report-note">Las cuentas pendientes y saldadas muestran su estado actual, no el dinero recibido durante estas fechas. Las categorías son las actuales. No se calcula utilidad porque aún no se registran costos de compra.</p>`;
}
function trendLabel(value) {
  if (value.length === 7) return new Date(value+'-15T12:00:00Z').toLocaleDateString('es-CO',{month:'short',year:'numeric',timeZone:'America/Bogota'});
  return reportDate(value);
}
function salesChart(data) {
  if (!data.summary.orders) return empty('Sin ventas para graficar', 'El gráfico se completará con tus consumos registrados.', 'chart');
  const points = data.trend, max = Math.max(...points.map(p=>p.sales), 1);
  const top = Math.ceil(max/1000)*1000, width=700, height=230;
  const coords = points.map((p,i)=>[points.length===1?365:65+i/(points.length-1)*610,185-p.sales/top*155]);
  const ticks=[0,.5,1].map(v=>`<line x1="65" y1="${185-v*155}" x2="675" y2="${185-v*155}" class="chart-grid"/><text x="53" y="${189-v*155}" text-anchor="end">${esc(new Intl.NumberFormat('es-CO',{notation:'compact',maximumFractionDigits:1}).format(top*v))}</text>`).join('');
  return `<figure class="sales-figure"><svg class="sales-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Ventas ${data.granularity==='month'?'mensuales':'diarias'} del período. Total ${money(data.summary.sales)}. Los valores exactos están disponibles en Ver datos del gráfico.">${ticks}<polyline class="chart-sales" points="${coords.map(p=>p.join(',')).join(' ')}"/>${points.length<=31?coords.map(([x,y],i)=>`<circle cx="${x}" cy="${y}" r="3" class="chart-point"><title>${esc(trendLabel(points[i].period))}: ${money(points[i].sales)}</title></circle>`).join(''):''}<text x="65" y="218">${esc(trendLabel(points[0].period))}</text>${points.length>1?`<text x="675" y="218" text-anchor="end">${esc(trendLabel(points.at(-1).period))}</text>`:''}</svg><figcaption>Ventas registradas en pesos colombianos (COP).</figcaption></figure>`;
}
function categoryBars(data) {
  if (!data.categories.length) return empty('Sin categorías con ventas','Las categorías aparecerán al registrar consumos.','tag');
  return `<div class="category-bars">${data.categories.map(c=>{const percent=data.summary.sales?Math.round(c.sales/data.summary.sales*1000)/10:0;return `<div><div class="bar-heading"><span><strong>${esc(c.name)}</strong><small>${c.type} · ${c.units} unidades</small></span><span><strong>${money(c.sales)}</strong><small>${percent}%</small></span></div><meter min="0" max="100" value="${percent}" aria-label="${esc(c.name)}: ${percent}% de las ventas">${percent}%</meter></div>`}).join('')}</div>`;
}
function bindReportExport() {
  if($('#export-excel'))$('#export-excel').onclick=()=>downloadExcel(`analytics.xlsx?from=${analyticsData.range.from}&to=${analyticsData.range.to}`,`la-esquina-ventas-${analyticsData.range.from}-${analyticsData.range.to}.xlsx`,$('#export-excel'));
  const button=$('#export-report');
  if (button) button.onclick=()=>{
    if (!analyticsData) return;
    const d=analyticsData, s=d.summary;
    const rows=[['Análisis de ventas - La Esquina'],['Desde',d.range.from,'Hasta',d.range.to],['Zona horaria','America/Bogota'],[],['Indicador','Valor COP o unidades'],['Ventas registradas COP',s.sales],['Cuentas',s.orders],['Unidades',s.units],['Consumidores',s.customers],['Promedio por cuenta COP',s.average],['Pendiente actual de las cuentas del período COP',s.pending],['Cuentas saldadas del período COP',s.settled],[],['Producto','Categoría actual','Tipo','Unidades','Ventas COP'],...d.products.map(p=>[p.name,p.category,p.type,p.units,p.sales]),[],['Categoría actual','Tipo','Unidades','Ventas COP'],...d.categories.map(c=>[c.name,c.type,c.units,c.sales]),[],['Período','Ventas COP','Cuentas'],...d.trend.map(p=>[p.period,p.sales,p.orders])];
    const cell=value=>{let text=String(value??'');if(typeof value==='string'&&/^[=+\-@\t\r\n]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"'};
    const csv='\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=`la-esquina-ventas-${d.range.from}-${d.range.to}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast('Informe descargado. Puedes abrirlo en Excel.');
  };
}

let monthlyData = null;
let monthlyRequest = 0;
let selectedMonth = bogotaToday().slice(0,7);
let selectedPerson = '';

function monthlyPanel() {
  return `<section class="panel monthly-panel" id="monthly-report"><div class="panel-heading"><div><h2>Cuentas mensuales por persona</h2><small>Selecciona un mes y revisa las cuentas de cada consumidor.</small></div></div>
    <div class="panel-body"><form id="monthly-form" class="monthly-form">
      <label class="field">Mes del informe<input type="month" name="month" min="2000-01" max="2100-12" value="${selectedMonth}" required></label>
      <label class="field">Persona<select name="person"><option value="">Todas las personas</option>${state.users.map(u=>`<option value="${u.id}" ${String(u.id)===selectedPerson?'selected':''}>${esc(u.name)}</option>`).join('')}</select></label>
      <button class="btn secondary" type="submit">Consultar cuentas</button>
    </form><p id="monthly-error" class="form-error" role="alert"></p><p class="report-note">Incluye cuentas emitidas en el mes elegido, con su estado de pago actual. No incluye saldos de meses anteriores.</p></div>
    <div id="monthly-results" aria-live="polite" aria-busy="${!monthlyData}">${monthlyData?monthlyContent(monthlyData):'<div class="report-loading">Consultando las cuentas del mes…</div>'}</div></section>`;
}
function bindMonthly() {
  $('#monthly-form').onsubmit=e=>{e.preventDefault();loadMonthly()};
  if (!monthlyData) loadMonthly();
  else bindMonthlyActions();
}
async function loadMonthly() {
  const form=$('#monthly-form');
  if(!form||!form.reportValidity())return;
  const month=form.elements.month.value,person=form.elements.person.value;
  const request=++monthlyRequest,userId=state.user.id,submit=form.querySelector('[type=submit]');
  submit.disabled=true;$('#monthly-error').textContent='';$('#monthly-results').setAttribute('aria-busy','true');
  $('#monthly-results').innerHTML='<div class="report-loading">Consultando las cuentas del mes…</div>';
  try {
    const data=await api(`monthly-accounts?month=${encodeURIComponent(month)}&person=${encodeURIComponent(person)}`);
    if(request!==monthlyRequest||view!=='analytics'||state?.user.id!==userId)return;
    monthlyData=data;selectedMonth=month;selectedPerson=person;
    $('#monthly-results').innerHTML=monthlyContent(data);adaptTables();bindMonthlyActions();
  } catch(error) {
    if(request!==monthlyRequest||!$('#monthly-error'))return;
    monthlyData=null;$('#monthly-error').textContent=error.message;
    $('#monthly-results').innerHTML=empty('No pudimos cargar las cuentas','Revisa el mes y vuelve a consultar.','receipt');
  } finally {
    if(request===monthlyRequest&&$('#monthly-results')){submit.disabled=false;$('#monthly-results').setAttribute('aria-busy','false')}
  }
}
function monthlyContent(data) {
  return `<div class="monthly-summary"><div><strong>${trendLabel(data.month)}</strong><small>${data.totals.orders} cuentas · ${money(data.totals.total)} en consumos · ${money(data.totals.pending)} pendientes</small></div><button class="btn" id="export-monthly">${icon('down')} Excel del mes</button></div>
    ${data.people.length?`<div class="table-wrap"><table><thead><tr><th>Persona</th><th>Cuentas</th><th>Total del mes</th><th>Saldado</th><th>Pendiente</th><th>Detalle</th></tr></thead><tbody>${data.people.map(p=>`<tr><td><strong>${esc(p.name)}</strong><br><small>${esc(p.email)}</small></td><td>${p.orders}</td><td>${money(p.total)}</td><td>${money(p.settled)}</td><td>${money(p.pending)}</td><td><button class="text-btn" data-monthly-person="${p.id}">Ver sus cuentas →</button></td></tr>`).join('')}</tbody></table></div>`:empty('Sin personas para este informe','Selecciona otra persona o crea un consumidor.','users')}
    <div class="panel-heading monthly-accounts-heading"><h3>Cuentas emitidas en ${trendLabel(data.month)}</h3></div>
    ${data.invoices.length?`<div class="table-wrap"><table><thead><tr><th>Persona</th><th>Cuenta</th><th>Fecha</th><th>Total</th><th>Estado actual</th><th>Detalle</th></tr></thead><tbody>${data.invoices.map(i=>`<tr><td>${esc(i.consumer)}</td><td>${billNo(i.id)}</td><td>${date(i.created)}</td><td>${money(i.total)}</td><td>${pill(i.status,i.status==='Pendiente'?'warning':'')}</td><td><button class="text-btn" data-action="invoice" data-id="${i.id}">Ver cuenta →</button></td></tr>`).join('')}</tbody></table></div>`:empty('No hay cuentas en este mes','Selecciona otro mes o registra un consumo.','receipt')}`;
}
function bindMonthlyActions() {
  if($('#export-monthly'))$('#export-monthly').onclick=()=>downloadExcel(`monthly-accounts.xlsx?month=${monthlyData.month}&person=${monthlyData.person||''}`,`la-esquina-cuentas-${monthlyData.month}${monthlyData.person?'-persona-'+monthlyData.person:''}.xlsx`,$('#export-monthly'));
  document.querySelectorAll('[data-monthly-person]').forEach(button=>button.onclick=()=>{
    $('#monthly-form').elements.person.value=button.dataset.monthlyPerson;loadMonthly();
  });
}
async function downloadExcel(route,filename,button) {
  button.disabled=true;
  try {
    const response=await fetch('/api/'+route,{credentials:'same-origin'});
    if(!response.ok){const error=await response.json();throw Error(error.error||'No fue posible generar el Excel.')}
    const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast('Informe Excel descargado.');
  } catch(error) {toast(error.message)} finally {button.disabled=false}
}
