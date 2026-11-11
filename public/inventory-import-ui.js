let inventoryPreview=null;
let inventoryImportRequest=0;

function inventoryImportPage(){
 return heading('Importar inventario desde Excel','Carga productos, precios y cantidades en una sola operación.',button('Volver al inventario','inventory','box','secondary'))+`
  <section class="panel"><div class="panel-heading"><div><h2>Tu archivo de inventario</h2><small>Usa las cuatro columnas en la primera fila de la primera hoja.</small></div><button class="btn secondary" id="inventory-template">${icon('down')} Descargar plantilla</button></div><div class="panel-body">
  <div class="import-columns"><span>Producto</span><span>Precio venta</span><span>Cantidad</span><span>Precio unitario</span></div>
  <p class="report-note">Precio venta es lo que cobras al consumidor. Precio unitario es tu costo de compra por unidad. Usa valores numéricos en pesos colombianos, sin decimales.</p>
  <div class="notice import-notice">${icon('alert')}<span><strong>La cantidad del Excel reemplazará la existencia actual de cada producto incluido.</strong> Los productos que no estén en el archivo no cambian. No se borran cuentas ni consumos.</span></div>
  <form id="inventory-import-form"><label class="field">Archivo Excel (.xlsx)<input type="file" name="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required><small>Hasta 2 MB y 1.000 productos. Una sola fila por producto.</small></label><div class="form-actions"><button class="btn" type="submit">${icon('search')} Revisar Excel</button></div></form>
  <div id="inventory-import-error" class="form-error" role="alert"></div></div></section><div id="inventory-import-preview" aria-live="polite"></div>`;
}
function bindInventoryImport(){
 inventoryPreview=null;inventoryImportRequest++;
 $('#inventory-template').onclick=e=>downloadExcel('inventory-template.xlsx','plantilla-inventario.xlsx',e.currentTarget);
 const form=$('#inventory-import-form');
 form.elements.file.onchange=()=>{inventoryPreview=null;$('#inventory-import-preview').innerHTML='';$('#inventory-import-error').textContent='';};
 form.onsubmit=async event=>{
  event.preventDefault();
  const file=form.elements.file.files[0],submit=form.querySelector('[type=submit]');
  if(!file)return;
  const error=$('#inventory-import-error');error.textContent='';
  if(!file.name.toLowerCase().endsWith('.xlsx')){error.textContent='Selecciona un archivo .xlsx. Guarda tu Excel en ese formato antes de importarlo.';return;}
  if(file.size>2*1024*1024){error.textContent='El archivo supera 2 MB. Divídelo en archivos más pequeños.';return;}
  const request=++inventoryImportRequest;
  submit.disabled=true;form.elements.file.disabled=true;
  inventoryPreview=null;$('#inventory-import-preview').innerHTML='<div class="panel report-loading" role="status">Revisando el Excel. Tu inventario todavía no cambia…</div>';
  try{
   const fileBase64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('No pudimos abrir el archivo. Vuelve a seleccionarlo.'));reader.readAsDataURL(file);});
   const data=await api('inventory-import/preview','POST',{filename:file.name,fileBase64});
   if(request!==inventoryImportRequest||view!=='import')return;
   inventoryPreview=data;renderInventoryPreview();
  }catch(problem){
   if(request!==inventoryImportRequest||!$('#inventory-import-error'))return;
   $('#inventory-import-preview').innerHTML='';
   $('#inventory-import-error').innerHTML=`<p>${esc(problem.message)}</p>${problem.details?.errors?.length?`<ul>${problem.details.errors.map(item=>`<li>Fila ${item.row}: ${esc(item.message)}</li>`).join('')}</ul>`:''}`;
  }finally{submit.disabled=false;form.elements.file.disabled=false;}
 };
}
function renderInventoryPreview(showAll=false){
 const data=inventoryPreview;if(!data||!$('#inventory-import-preview'))return;
 const rows=showAll?data.rows:data.rows.slice(0,50);
 $('#inventory-import-preview').innerHTML=`<section class="panel import-preview-panel"><div class="panel-heading"><div><h2>Revisa antes de importar</h2><small>${esc(data.filename)} · ${data.created} productos nuevos · ${data.updated} productos existentes</small></div></div>
  <div class="table-wrap"><table><thead><tr><th>Producto</th><th>Precio venta</th><th>Precio unitario / costo</th><th>Cantidad actual</th><th>Cantidad del Excel</th><th>Acción</th></tr></thead><tbody>${rows.map(row=>`<tr><td><strong>${esc(row.name)}</strong><br><small>Fila ${row.row}</small></td><td>${money(row.price)}</td><td>${money(row.unit_cost)}</td><td>${row.oldStock==null?'Nuevo':row.oldStock}</td><td><strong>${row.stock}</strong></td><td>${pill(row.action,row.action==='Crear'?'':'warning')}</td></tr>`).join('')}</tbody></table></div>
  <div class="table-footer"><span>Mostrando ${rows.length} de ${data.rows.length} productos. Se importarán todos.</span>${rows.length<data.rows.length?'<button class="text-btn" id="inventory-import-expand">Ver todos</button>':''}</div>
  <div class="panel-body"><form id="inventory-import-confirm"><label class="import-confirm-label"><input type="checkbox" required> He revisado los precios y las cantidades que se reemplazarán.</label><p class="report-note">Los ajustes quedarán en Movimientos. No se consideran ventas. La vista previa vence en 15 minutos; si alguien modifica un producto, tendrás que revisarla otra vez.</p><p class="form-error" id="inventory-commit-error" role="alert"></p><div class="form-actions"><button class="btn" type="submit">Reemplazar cantidades e importar</button></div></form></div></section>`;
 adaptTables();
 if($('#inventory-import-expand'))$('#inventory-import-expand').onclick=()=>renderInventoryPreview(true);
 $('#inventory-import-confirm').onsubmit=async event=>{
  event.preventDefault();const form=event.target,submit=form.querySelector('[type=submit]');submit.disabled=true;
  $('#inventory-commit-error').textContent='';
  try{
   const result=await api('inventory-import/commit','POST',{token:data.token});
   inventoryPreview=null;view='inventory';location.hash='inventory';await refresh();window.scrollTo(0,0);
   toast(`Importación lista: ${result.created} productos creados y ${result.updated} actualizados.`);
  }catch(problem){
   if($('#inventory-commit-error')){$('#inventory-commit-error').textContent=problem.message;$('#inventory-commit-error').scrollIntoView({block:'center'});}
   if(problem.details?.error&&problem.message.includes('vista previa'))inventoryPreview=null;
   submit.disabled=false;
  }
 };
}
