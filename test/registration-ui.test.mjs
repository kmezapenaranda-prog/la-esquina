import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('clicking the QR control renders both the image and share link',async()=>{
 const panel={hidden:true,scrollIntoView(){}},content={innerHTML:''},trigger={disabled:false};
 const url='https://la-esquina.vercel.app/#registro?invitacion=example';
 const calls=[];
 const context=vm.createContext({
  $:selector=>({'#registration-panel':panel,'#registration-content':content})[selector],
  matchMedia:()=>({matches:true}),
  api:async route=>{calls.push(route);return {url,qr:'data:image/png;base64,example'}},
  esc:value=>String(value),
  icon:()=>'<svg></svg>',
  button:(label,action)=>`<button data-action="${action}">${label}</button>`
 });
 vm.runInContext(readFileSync(new URL('../public/registration-ui.js',import.meta.url),'utf8'),context);
 await context.showRegistrationQR(trigger);
 assert.deepEqual(calls,['registration']);
 assert.equal(panel.hidden,false);
 assert.equal(trigger.disabled,false);
 assert.match(content.innerHTML,/<img class="registration-qr"/);
 assert.ok(content.innerHTML.includes(url));
 assert.match(content.innerHTML,/data-action="copy-registration"/);
 assert.match(content.innerHTML,/download="la-esquina-qr-registro.png"/);
 assert.ok(!content.innerHTML.includes('role="alert"'));
});
