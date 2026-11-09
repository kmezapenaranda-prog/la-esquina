function isRegistrationRoute() {
  return location.hash.slice(1).split('?')[0]==='registro';
}
function registrationInvitation() {
  return new URLSearchParams(location.hash.split('?').slice(1).join('?')).get('invitacion')||'';
}
function registrationPanel() {
  return `<section class="panel registration-panel" id="registration-panel" hidden><div class="panel-heading"><div><h2>Invita a tu tienda</h2><small>Comparte el QR o el enlace. Cada persona crea su propia cuenta de consumidor.</small></div></div><div class="panel-body" id="registration-content"></div></section>`;
}
async function showRegistrationQR(trigger) {
  const panel=$('#registration-panel');
  if(!panel)return;
  panel.hidden=false;
  trigger.disabled=true;
  $('#registration-content').innerHTML='<p class="muted" role="status">Preparando el QR de tu tienda…</p>';
  panel.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'});
  try {
    const data=await api('registration');
    if(!$('#registration-content'))return;
    $('#registration-content').innerHTML=`<div class="registration-share"><img class="registration-qr" src="${esc(data.qr)}" width="240" height="240" alt="QR para crear una cuenta de consumidor en La Esquina"><div><h3>Escanea, regístrate y listo</h3><p class="muted">Nombre, correo y una contraseña personal. La cuenta queda lista al instante y aparece en tu lista de consumidores.</p><label class="field">Enlace de registro<input id="registration-link" type="text" value="${esc(data.url)}" readonly></label><div class="actions">${button('Copiar enlace','copy-registration','receipt','secondary')}<a class="btn" href="${esc(data.qr)}" download="la-esquina-qr-registro.png">${icon('down')} Descargar QR</a></div><p class="report-note">Puedes imprimir el QR o enviarlo por WhatsApp. El mismo QR sirve para todas las personas y solo crea cuentas de consumidor.</p></div></div>`;
  } catch(error) {
    if($('#registration-content'))$('#registration-content').innerHTML=`<p class="form-error" role="alert">${esc(error.message)} Vuelve a pulsar QR de registro.</p>`;
  } finally {trigger.disabled=false;}
}
async function copyRegistrationLink(button) {
  const field=$('#registration-link');
  if(!field)return;
  try {await navigator.clipboard.writeText(field.value);toast('Enlace copiado. Ya puedes compartirlo.');}
  catch {field.focus();field.select();toast('El enlace quedó seleccionado. Cópialo para compartirlo.');}
}
function renderRegistration() {
  const invitation=registrationInvitation();
  app.innerHTML=`<main class="login signup" id="main"><section class="login-story"><div class="brand"><span class="brand-logo">${icon('store')}</span>la esquina.</div><div><h1>Tu cuenta,<br>en un momento.</h1><p>Elige tus productos y consulta tus consumos y cuentas desde tu celular.</p><div class="shelf" aria-hidden="true">${icon('drink')}${icon('food')}${icon('cookie')}</div></div><footer>Registro de consumidores · La Esquina</footer></section><section class="login-form-area"><div class="login-box"><h2>Crea tu cuenta</h2><p>Regístrate como consumidor de la tienda.</p><form id="signup-form">${invitation?`<input type="hidden" name="invitation" value="${esc(invitation)}">`:`<label class="field">Invitación de la tienda<input name="invitation" required maxlength="64" autocomplete="off"><small>Escanea el QR o abre el enlace que te compartió el administrador para llenar este campo automáticamente.</small></label>`}<label class="field">Nombre completo<input name="name" required minlength="2" maxlength="100" autocomplete="name" placeholder="Tu nombre y apellido"></label><label class="field">Correo electrónico<input name="email" type="email" required maxlength="100" autocomplete="email" placeholder="tu@correo.com"></label><label class="field">Contraseña<input name="password" type="password" required minlength="10" maxlength="200" autocomplete="new-password"><small>Usa al menos 10 caracteres.</small></label><label class="field">Confirmar contraseña<input name="confirmPassword" type="password" required minlength="10" maxlength="200" autocomplete="new-password"></label><p class="form-error" role="alert"></p><button class="btn" type="submit">Crear mi cuenta ${icon('chevron')}</button></form><p class="signup-login-note">¿Ya tienes cuenta? <button class="text-btn" data-action="login-page">Inicia sesión</button></p></div></section></main>`;
  const form=$('#signup-form');
  form.onsubmit=async event=>{
    event.preventDefault();
    const submit=form.querySelector('[type=submit]'),error=form.querySelector('.form-error');
    error.textContent='';
    if(form.elements.password.value!==form.elements.confirmPassword.value){error.textContent='Las contraseñas no coinciden. Revísalas antes de continuar.';form.elements.confirmPassword.focus();return;}
    submit.disabled=true;submit.textContent='Creando tu cuenta…';
    try {
      await api('register','POST',Object.fromEntries(new FormData(form)));
      state=await api('state');cart=[];view='catalog';location.hash='catalog';render();window.scrollTo(0,0);
      toast('Tu cuenta está lista. ¡Bienvenido a La Esquina!');
    } catch(problem) {error.textContent=problem.message;submit.disabled=false;submit.innerHTML='Crear mi cuenta '+icon('chevron');}
  };
}
