const productionAdvanceStages=['MOLDE','FUNDIR','PULIR','ALISTAR','ENTREGADO'];
const productionAdvanceContext={profile:null,viewOnly:false,canApprove:false,requests:[],sequence:0,channel:null};

function canApproveProductionAdvances(){return productionAdvanceContext.canApprove===true;}

function nextProductionAdvance(state){
  const index=productionAdvanceStages.indexOf(state);
  return index>=0?productionAdvanceStages[index+1]||null:null;
}

function resetProductionAdvances(){
  productionAdvanceContext.sequence++;
  productionAdvanceContext.profile=null;
  productionAdvanceContext.viewOnly=false;
  productionAdvanceContext.canApprove=false;
  setProductionViewerMode(false);
  productionAdvanceContext.requests=[];
  if(productionAdvanceContext.channel)db.removeChannel(productionAdvanceContext.channel);
  productionAdvanceContext.channel=null;
  document.querySelector('#advancesNav')?.classList.add('hidden');
  document.querySelector('#drawer')._advances=null;
}

async function initializeProductionAdvances(user){
  resetProductionAdvances();
  const {data,error}=await db.from('profiles').select('id,nombre,rol,activo').eq('id',user.id).single();
  if(error)throw error;
  if(!data?.activo)throw Error('El usuario no tiene acceso activo.');
  productionAdvanceContext.profile=data;
  productionAdvanceContext.viewOnly=user.app_metadata?.production_view_only===true;
  productionAdvanceContext.canApprove=!productionAdvanceContext.viewOnly&&data.rol==='ADMINISTRADOR'&&user.email?.toLowerCase()==='juandiegoe@gmail.com';
  setProductionViewerMode(productionAdvanceContext.viewOnly);
  const enabled=!productionAdvanceContext.viewOnly&&['ADMINISTRADOR','PRODUCCION','PRODUCCION_LECTURA'].includes(data.rol);
  document.querySelector('#advancesNav')?.classList.toggle('hidden',!enabled);
  if(!enabled)return;
  await reloadProductionAdvances();
  productionAdvanceContext.channel=db.channel('solicitudes-avance-'+user.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'solicitudes_avance_items'},()=>reloadProductionAdvances().catch(showProductionAdvanceError))
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'items_produccion'},()=>document.querySelector('#drawer')._advances?.refresh().catch(showProductionAdvanceError))
    .subscribe();
}

function showProductionAdvanceError(error){
  const status=document.querySelector('#advancesStatus');
  if(status){status.textContent=error.message||'No se pudieron actualizar los avances.';status.classList.add('mixture-error')}
}

async function reloadProductionAdvances(){
  const profile=productionAdvanceContext.profile;
  if(!profile || productionAdvanceContext.viewOnly || !['ADMINISTRADOR','PRODUCCION','PRODUCCION_LECTURA'].includes(profile.rol))return;
  const sequence=++productionAdvanceContext.sequence;
  const {data,error}=await db.from('solicitudes_avance_items').select(`
    id,item_id,estado_origen,estado_solicitado,estado,solicitante_id,creado_en,
    solicitante:profiles!solicitante_id(nombre),
    items_produccion(id,codigo,descripcion,estado,orden_id,ordenes_produccion(numero_op,cliente))
  `).eq('estado','PENDIENTE').order('creado_en',{ascending:true});
  if(sequence!==productionAdvanceContext.sequence)return;
  if(error)throw error;
  productionAdvanceContext.requests=data||[];
  const nav=document.querySelector('#advancesNav');
  if(nav)nav.textContent=`${canApproveProductionAdvances()?'Avances pendientes':'Mis avances'} (${productionAdvanceContext.requests.length})`;
  renderProductionAdvanceList();
  await document.querySelector('#drawer')._advances?.refresh();
}

function showProductionAdvances(){
  hideProductionViews();currentView='advances';
  document.querySelector('#advancesView').classList.remove('hidden');
  document.querySelector('#advancesNav').classList.add('active');
  document.querySelector('#advancesStatus').textContent='';
  reloadProductionAdvances().catch(showProductionAdvanceError);
}

function renderProductionAdvanceList(){
  const list=document.querySelector('#advancesList');
  if(!list)return;
  const admin=canApproveProductionAdvances();
  list.innerHTML=productionAdvanceContext.requests.length?productionAdvanceContext.requests.map(request=>{
    const item=request.items_produccion;
    return `<article class="advance-request-card">
      <div><strong class="advance-item-code">${esc(item?.codigo||'Ítem')}</strong><span>${esc(item?.ordenes_produccion?.numero_op||'—')} · ${esc(item?.ordenes_produccion?.cliente||'')}</span>
      <b>${esc(request.estado_origen)} → ${esc(request.estado_solicitado)}</b>
      <small>${esc(request.solicitante?.nombre||'Usuario')} · ${new Date(request.creado_en).toLocaleString('es-CO',{timeZone:'America/Bogota'})}</small></div>
      ${admin?`<button type="button" class="btn primary" data-review-advance="${esc(request.id)}">Revisar</button>`:'<span class="advance-pending-badge">Pendiente de confirmación</span>'}
    </article>`;
  }).join(''):'<div class="empty">Sin avances pendientes.</div>';
  list.querySelectorAll('[data-review-advance]').forEach(button=>button.onclick=()=>reviewProductionAdvance(button.dataset.reviewAdvance,button));
}

function reviewProductionAdvance(id,trigger){
  const request=productionAdvanceContext.requests.find(r=>r.id===id);
  if(!request || !canApproveProductionAdvances())return;
  const drawer=document.querySelector('#drawer');
  const side=openMixtureSidePanel(drawer,{title:'Confirmar avance',trigger});
  if(!side)return;
  const item=request.items_produccion;
  side.body.innerHTML=`<h3>${esc(item?.codigo||'Ítem')}</h3><p>${esc(item?.ordenes_produccion?.numero_op||'—')} · ${esc(item?.descripcion||'')}</p>
    <p class="advance-transition">${esc(request.estado_origen)} → <strong>${esc(request.estado_solicitado)}</strong></p>
    <p>${esc(request.solicitante?.nombre||'Usuario')}</p>
    <div class="field"><label>Comentario<textarea class="advance-review-comment" rows="3" maxlength="2000"></textarea></label></div>
    <p class="advance-review-status" role="status"></p>
    <div class="mixture-actions"><button type="button" class="btn primary advance-approve">Confirmar avance</button><button type="button" class="btn secondary advance-reject">Rechazar</button></div>`;
  const approve=side.body.querySelector('.advance-approve'),reject=side.body.querySelector('.advance-reject');
  const status=side.body.querySelector('.advance-review-status');
  const comment=side.body.querySelector('textarea');
  let saving=false;
  const decide=async accept=>{
    if(saving)return;
    saving=true;side.setBusy(true);approve.disabled=true;reject.disabled=true;comment.disabled=true;
    status.textContent='Guardando…';status.classList.remove('mixture-error');
    try{
      const {data,error}=await db.rpc('revisar_avance_item',{p_solicitud_id:id,p_aprobar:accept,p_comentario:comment.value.trim()||null});
      if(error)throw error;
      const decision=Array.isArray(data)?data[0]:data;
      await reloadProductionAdvances();
      await loadOrders({openRequested:false});
      if(decision?.estado==='OBSOLETA'){
        status.textContent='Solicitud desactualizada. No se cambió el ítem.';
        side.body.querySelector('.mixture-actions').remove();
      }else side.close({force:true});
    }catch(error){status.textContent=error.message||'No se pudo revisar el avance.';status.classList.add('mixture-error');approve.disabled=false;reject.disabled=false}
    finally{saving=false;side.setBusy(false);comment.disabled=false}
  };
  approve.onclick=()=>decide(true);reject.onclick=()=>decide(false);
}

async function mountProductionItemAdvances(drawer,order){
  const profile=productionAdvanceContext.profile;
  if(!profile || !['ADMINISTRADOR','PRODUCCION','PRODUCCION_LECTURA'].includes(profile.rol))return;
  const card=drawer.querySelector('.drawer-card');
  const current=()=>drawer.querySelector('.drawer-card')===card;
  const consultation=!canApproveProductionAdvances();
  const renderItems=()=>{
    if(!current())return;
    drawer.querySelectorAll('#itemsList .item-card').forEach(itemCard=>{
      const item=order.items.find(i=>i.id===itemCard.querySelector('[data-edit]')?.dataset.edit);
      if(!item)return;
      itemCard.dataset.stage=item.estado;
      const state=itemCard.querySelector('.item-state-compact');
      const pending=productionAdvanceContext.requests.find(r=>r.item_id===item.id);
      if(productionAdvanceContext.viewOnly){
        state.innerHTML=`<small>Estado</small><div class="advance-state-line"><strong>${esc(item.estado)}</strong></div>`;
      }else if(consultation){
        const next=nextProductionAdvance(item.estado);
        state.innerHTML=`<small>Estado</small><div class="advance-state-line"><strong>${esc(item.estado)}</strong><button type="button" class="advance-request-button" title="${pending?'Avance pendiente':next?'Solicitar avance a '+next:'Sin otro avance'}" aria-label="${pending?'Avance pendiente':next?'Solicitar avance a '+next:'Sin otro avance'}" ${pending||!next||order.cerrada?'disabled':''}>→</button></div><p class="advance-item-status" role="status">${pending?'Pendiente: '+esc(pending.estado_solicitado):''}</p>`;
        const button=state.querySelector('button');
        const status=state.querySelector('.advance-item-status');
        button.onclick=async()=>{
          button.disabled=true;status.textContent='Enviando…';status.classList.remove('mixture-error');
          try{
            const {error}=await db.rpc('solicitar_avance_item',{p_item_id:item.id});
            if(error)throw error;
            await reloadProductionAdvances();
          }catch(error){status.textContent=error.message||'No se pudo solicitar el avance.';status.classList.add('mixture-error');button.disabled=false}
        };
      }else{
        const select=state.querySelector('[data-state]');
        if(select)select.value=item.estado;
        state.querySelector('.advance-item-review')?.remove();
        if(pending){
          const button=document.createElement('button');button.type='button';button.className='advance-item-review';
          button.textContent='Confirmar '+pending.estado_solicitado;
          button.onclick=()=>reviewProductionAdvance(pending.id,button);
          state.append(button);
        }
      }
    });
  };
  let refreshSequence=0;
  const refresh=async()=>{
    const sequence=++refreshSequence;
    const {data,error}=await db.from('items_produccion').select('id,estado,fecha_ultimo_estado,nivel_prioridad,prioridad').eq('orden_id',order.id);
    if(error)throw error;
    if(!current()||sequence!==refreshSequence)return;
    (data||[]).forEach(update=>{const item=order.items.find(i=>i.id===update.id);if(item)Object.assign(item,update)});
    reconcileDailyPending();
    renderItems();
    applyOrderItemsFilter(drawer,order);
  };
  drawer._advances={renderItems,refresh};
  renderItems();
}
