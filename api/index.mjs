let application;
export default async function vercelHandler(req,res) {
  try {
    const url=new URL(req.url,'https://localhost');
    const route=url.searchParams.get('__path');
    if(route!==null){url.searchParams.delete('__path');req.url='/api/'+route+(url.search?'?'+url.searchParams.toString():'');}
    if(!application)application=import('../server.mjs').then(module=>module.default).catch(error=>{application=null;throw error;});
    return await (await application)(req,res);
  } catch(error) {
    console.error('No fue posible iniciar La Esquina:',error.code||error.name);
    if(!res.headersSent)res.writeHead(503,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    res.end(JSON.stringify({error:'La tienda necesita terminar la configuración de la base de datos y del administrador.'}));
  }
}
