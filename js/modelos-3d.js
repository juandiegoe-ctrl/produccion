// Optional item models use a separate folder in the existing reference bucket.
const ITEM_MODEL_MAX_BYTES=25*1024*1024;
let itemModelViewerLoading=null;
function loadItemModelViewer(){
  if(customElements.get('model-viewer'))return Promise.resolve();
  if(itemModelViewerLoading)return itemModelViewerLoading;
  itemModelViewerLoading=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.type='module';
    script.src='https://cdn.jsdelivr.net/npm/@google/model-viewer@4.1.0/dist/model-viewer.min.js';
    const timer=setTimeout(()=>fail(),20000);
    function fail(){clearTimeout(timer);script.remove();itemModelViewerLoading=null;reject(new Error('No se pudo cargar el visor 3D. Revisa la conexión e intenta nuevamente.'));}
    script.onerror=fail;
    script.onload=()=>{
      clearTimeout(timer);
      if(!customElements.get('model-viewer')){fail();return;}
      resolve();
    };
    document.head.append(script);
  });
  return itemModelViewerLoading;
}
async function validateItemGlb(file){
  if(!file||!file.name.toLowerCase().endsWith('.glb'))throw Error('Selecciona un archivo GLB.');
  if(file.size>ITEM_MODEL_MAX_BYTES)throw Error('El modelo supera el máximo de 25 MB.');
  if(file.size<20)throw Error('El archivo GLB está incompleto.');
  const header=new DataView(await file.slice(0,12).arrayBuffer());
  if(header.getUint32(0,true)!==0x46546c67||header.getUint32(4,true)!==2||header.getUint32(8,true)!==file.size){
    throw Error('El archivo no es un GLB versión 2 válido. Expórtalo nuevamente.');
  }
}
async function openItemModel3D(order,item){
  const previous=document.querySelector('#itemModelDialog');
  if(previous?.open)previous.close();
  previous?.remove();
  const dialog=document.createElement('dialog');
  dialog.id='itemModelDialog';
  dialog.setAttribute('aria-labelledby','itemModelTitle');
  dialog.innerHTML=`<div class="item-model-head"><div><h2 id="itemModelTitle">Modelo 3D · ${esc(item.codigo||'Ítem')}</h2><p>${esc(item.catalogo_productos?.nombre||item.descripcion||'')}</p></div><button type="button" class="btn secondary" data-model-close aria-label="Cerrar visor 3D">Cerrar</button></div>
    <div class="item-model-modes" role="group" aria-label="Estilo del modelo"><button type="button" data-model-mode="lines" aria-pressed="true" disabled>Líneas</button><button type="button" data-model-mode="volume" aria-pressed="false" disabled>Volumen</button></div>
    <div class="item-model-stage"><p>Buscando modelo…</p></div>
    <p class="item-model-status" role="status" aria-live="polite"></p>
    <div class="item-model-footer"><label class="btn primary item-model-upload" aria-disabled="true">Subir GLB<input type="file" accept=".glb,model/gltf-binary" aria-label="Subir modelo GLB" disabled></label><span>Opcional · GLB hasta 25 MB. Arrastra para girar y usa la rueda o dos dedos para acercar.</span></div>`;
  document.body.append(dialog);dialog.showModal();
  dialog.querySelector('[data-model-close]').onclick=()=>dialog.close();
  let disposeLines=()=>{};
  let renderSequence=0;
  dialog.addEventListener('close',()=>{renderSequence++;disposeLines();dialog.remove();},{once:true});
  const stage=dialog.querySelector('.item-model-stage');
  const status=dialog.querySelector('.item-model-status');
  const input=dialog.querySelector('input');
  const label=dialog.querySelector('.item-model-upload');
  const bucket=db.storage.from('planos-produccion');
  const folder=`${order.id}/${item.id}/modelos-3d`;
  let existing=[];
  const active=()=>dialog.isConnected&&dialog.open;
  const setBusy=busy=>{input.disabled=busy;label.setAttribute('aria-disabled',String(busy));};
  let currentPath=null;
  let mode='lines';
  const modeButtons=dialog.querySelectorAll('[data-model-mode]');
  const showModel=async path=>{
    currentPath=path;
    const sequence=++renderSequence;
    disposeLines();disposeLines=()=>{};
    modeButtons.forEach(button=>{button.disabled=false;button.setAttribute('aria-pressed',String(button.dataset.modelMode===mode));});
    stage.replaceChildren();
    status.textContent='Cargando visor 3D…';
    try{
      const url=bucket.getPublicUrl(path).data.publicUrl;
      stage.classList.toggle('technical-view',mode==='lines');
      if(mode==='lines'){
        status.textContent='Cargando vista de líneas…';
        const host=document.createElement('div');host.className='item-model-lines';stage.append(host);
        const {createItemLineViewer}=await import('./modelos-3d-lineas.js');
        if(!active()||sequence!==renderSequence)return;
        const controller=await createItemLineViewer(host,url);
        if(!active()||sequence!==renderSequence){controller.dispose();return;}
        disposeLines=()=>controller.dispose();status.textContent='';return;
      }
      await loadItemModelViewer();
      if(!active()||sequence!==renderSequence)return;
      const viewer=document.createElement('model-viewer');
      viewer.setAttribute('alt',`Modelo 3D de ${item.codigo||'ítem'}`);
      viewer.setAttribute('camera-controls','');
      viewer.setAttribute('touch-action','pan-y');
      viewer.setAttribute('environment-image','neutral');
      viewer.setAttribute('tone-mapping','aces');
      viewer.setAttribute('exposure','0.8');
      viewer.setAttribute('shadow-intensity','0.6');
      viewer.setAttribute('shadow-softness','0.65');
      viewer.setAttribute('camera-orbit','35deg 60deg auto');
      viewer.setAttribute('field-of-view','35deg');
      viewer.setAttribute('src',bucket.getPublicUrl(path).data.publicUrl);
      viewer.addEventListener('load',()=>{if(active()&&sequence===renderSequence)status.textContent='';});
      viewer.addEventListener('error',()=>{if(active()&&sequence===renderSequence)status.textContent='No se pudo abrir el modelo. Comprueba el archivo GLB y su acceso en Supabase.';});
      stage.append(viewer);
      status.textContent='Cargando modelo…';
    }catch(error){if(active()&&sequence===renderSequence)status.textContent=error.message;}
  };
  modeButtons.forEach(button=>button.onclick=()=>{
    if(!currentPath||mode===button.dataset.modelMode)return;
    mode=button.dataset.modelMode;showModel(currentPath);
  });
  try{
    const {data,error}=await bucket.list(folder,{limit:100,sortBy:{column:'name',order:'desc'}});
    if(error)throw error;
    existing=(data||[]).filter(file=>file.name.endsWith('.glb')).map(file=>`${folder}/${file.name}`);
    if(!active())return;
    if(existing.length)await showModel(existing[0]);
    else stage.innerHTML='<p>Este ítem todavía no tiene modelo 3D. Sube un archivo GLB para visualizarlo.</p>';
    setBusy(false);
  }catch(error){
    if(active()){stage.innerHTML='<p>No se pudo consultar el modelo.</p>';status.textContent=error.message||'Revisa el acceso al almacenamiento de Supabase.';}
    return;
  }
  input.onchange=async()=>{
    const file=input.files?.[0];
    if(!file)return;
    setBusy(true);status.textContent='Validando modelo…';
    try{
      await validateItemGlb(file);
      const path=`${folder}/${Date.now()}-${crypto.randomUUID()}.glb`;
      status.textContent='Subiendo modelo…';
      const {error}=await bucket.upload(path,file,{upsert:false,contentType:'model/gltf-binary'});
      if(error)throw Error('No se pudo guardar el GLB. '+error.message+' Comprueba que el bucket planos-produccion permita model/gltf-binary y archivos de este tamaño.');
      const old=existing;existing=[path];
      // The new object is saved before removing any previous model.
      if(old.length){
        const {error:cleanupError}=await bucket.remove(old);
        if(cleanupError)console.error('No se pudo limpiar el modelo anterior:',cleanupError.message);
      }
      if(active())await showModel(path);
    }catch(error){if(active())status.textContent=error.message||'No se pudo subir el modelo.';}
    finally{if(active()){setBusy(false);input.value='';}}
  };
}
