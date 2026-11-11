/* Keep the existing DOSAGE_BASE formula. Grains are additional percentages of item weight. */
const MIXTURE_GRAINS = [1,2,3];
const MIXTURE_PIGMENTS = [1,2];

function validateProductionMixture(recipe){
  if(!recipe.nombre?.trim() || recipe.nombre.trim().length>120)throw Error('Escribe un nombre de mezcla de hasta 120 caracteres.');
  if(!['BLANCO','GRIS'].includes(recipe.cemento_tipo))throw Error('Selecciona cemento blanco o gris.');
  for(const key of ['arena_fina_color','arena_gruesa_color']){
    if(!recipe[key]?.trim() || recipe[key].trim().length>120)throw Error('Escribe el color de la arena fina y de la arena gruesa (máximo 120 caracteres).');
  }
  for(const n of MIXTURE_GRAINS){
    const pct=Number(recipe[`grano_${n}_pct`]);
    if(!Number.isFinite(pct)||pct<0||pct>100)throw Error(`Grano ${n}: el porcentaje debe estar entre 0 y 100.`);
    if(pct>0 && (!recipe[`grano_${n}_color`]?.trim() || !recipe[`grano_${n}_tamano`]?.trim()))throw Error(`Grano ${n}: indica el color y el tamaño.`);
    if((recipe[`grano_${n}_color`]||'').length>120 || (recipe[`grano_${n}_tamano`]||'').length>120)throw Error(`Grano ${n}: usa referencias de hasta 120 caracteres.`);
  }
  for(const n of MIXTURE_PIGMENTS){
    const name=recipe[`pigmento_${n}_nombre`]||'';
    const pct=recipe[`pigmento_${n}_pct`];
    if(name.length>120)throw Error(`Pigmento ${n}: usa un nombre de hasta 120 caracteres.`);
    if(pct!=null && (pct==='' || !['number','string'].includes(typeof pct) || !Number.isFinite(Number(pct)) || Number(pct)<0 || Number(pct)>100))throw Error(`Pigmento ${n}: el porcentaje debe estar entre 0 y 100.`);
    if(pct!=null && !name.trim())throw Error(`Pigmento ${n}: escribe el nombre.`);
  }
  return recipe;
}

function calculateProductionMixture(recipe,weight){
  validateProductionMixture(recipe);
  const kg=Number(weight);
  if(!Number.isFinite(kg)||kg<=0)throw Error('El ítem necesita un peso mayor que cero para generar la dosificación. Edita el peso del ítem.');
  const factor=kg/100;
  const references={Cemento:recipe.cemento_tipo==='BLANCO'?'Blanco':'Gris','Arena fina':recipe.arena_fina_color,'Arena gruesa':recipe.arena_gruesa_color};
  const components=DOSAGE_BASE.map(m=>({label:m.name,name:references[m.name]||'',amount:m.amount*factor,unit:m.unit,basis:`${m.amount} ${m.unit} por cada 100 kg de elemento`}));
  MIXTURE_GRAINS.forEach(n=>{
    const percent=Number(recipe[`grano_${n}_pct`]);
    if(percent>0)components.push({label:`Grano ${n}`,name:`${recipe[`grano_${n}_color`]} · ${recipe[`grano_${n}_tamano`]}`,amount:kg*percent/100,unit:'kg',basis:`${percent.toLocaleString('es-CO')}% del peso del elemento · adicional`});
  });
  const cementKg=components.find(m=>m.label==='Cemento').amount;
  MIXTURE_PIGMENTS.forEach(n=>{
    const name=recipe[`pigmento_${n}_nombre`]?.trim();
    if(!name)return;
    const percent=recipe[`pigmento_${n}_pct`];
    components.push({label:`Pigmento ${n}`,name,amount:percent==null?null:cementKg*Number(percent)/100,unit:'kg'});
  });
  return {weight:kg,components,hasUnmeasuredPigments:components.some(m=>m.amount===null),totalKg:components.filter(m=>m.unit==='kg'&&m.amount!==null).reduce((sum,m)=>sum+m.amount,0),totalMl:components.filter(m=>m.unit==='ml').reduce((sum,m)=>sum+m.amount,0)};
}

function buildProductionDosageRecord(recipe,item,orderId,weight,date,id){
  const dosage=calculateProductionMixture(recipe,weight);
  if(Math.abs(dosage.weight*1000-Math.round(dosage.weight*1000))>0.00001)throw Error('Usa hasta 3 decimales en los kg a fabricar.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date+'T12:00:00Z')) || new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw Error('Selecciona una fecha válida.');
  const payload={
    id,orden_id:orderId,item_id:item.id,mezcla_id:recipe.id,
    item_codigo:item.codigo||'',mezcla_nombre:recipe.nombre,
    receta_snapshot:JSON.parse(JSON.stringify(recipe)),
    fecha_fundida:date,total_kg:dosage.weight,
    pigmento_nombre:recipe.pigmento_1_nombre||null,
    pigmento_porcentaje:Number(recipe.pigmento_1_pct??0),
    componentes:Object.fromEntries(dosage.components.map(component=>[
      component.label,{cantidad:component.amount,unidad:component.unit,referencia:component.name,a_ojo:component.amount===null}
    ]))
  };
  MIXTURE_GRAINS.forEach(n=>{
    payload[`grano_${n}_nombre`]=[recipe[`grano_${n}_color`],recipe[`grano_${n}_tamano`]].filter(Boolean).join(' · ')||null;
    payload[`grano_${n}_porcentaje`]=Number(recipe[`grano_${n}_pct`]||0);
  });
  return payload;
}

function openMixtureSidePanel(drawer,{title,content=null,trigger=document.activeElement,onClose=null}){
  if(drawer._mixturePanel && !drawer._mixturePanel.close({restoreFocus:false}))return null;
  const dialog=document.createElement('dialog');
  dialog.className='dosage-side-panel';
  dialog.setAttribute('aria-labelledby','dosagePanelTitle');
  dialog.innerHTML=`<header class="dosage-panel-header"><h3 id="dosagePanelTitle">${esc(title)}</h3><button type="button" class="dosage-panel-close" aria-label="Cerrar ${esc(title.toLowerCase())}" title="Cerrar">✕</button></header><div class="item-mixture-result mixture-panel-content"></div>`;
  const body=dialog.querySelector('.mixture-panel-content');
  const closeButton=dialog.querySelector('.dosage-panel-close');
  const placeholder=content?document.createComment('mixture-panel-origin'):null;
  if(content){content.before(placeholder);body.append(content);content.classList.remove('hidden')}
  let busy=false;
  let finished=false;
  const panel={dialog,body,closeButton,
    setBusy(value){busy=value;closeButton.disabled=value},
    close({force=false,restoreFocus=true}={}){
      if(busy&&!force)return false;
      if(finished)return true;
      finished=true;
      if(dialog.open)dialog.close();
      if(content){
        content.classList.add('hidden');
        if(placeholder.isConnected)placeholder.replaceWith(content);
        else content.remove();
      }
      dialog.remove();
      if(drawer._mixturePanel===panel)drawer._mixturePanel=null;
      onClose?.();
      if(restoreFocus && trigger?.isConnected && trigger.checkVisibility())trigger.focus({preventScroll:true});
      return true;
    }
  };
  closeButton.onclick=()=>panel.close();
  dialog.addEventListener('cancel',event=>{event.preventDefault();panel.close()});
  dialog.addEventListener('close',()=>panel.close(),{once:true});
  drawer._mixturePanel=panel;
  drawer.append(dialog);
  dialog.showModal();
  return panel;
}

async function mountProductionMixtures(drawer,order,{onChange=()=>{}}={}){
  const panel=drawer.querySelector('#mixtureLibrary');
  if(!panel)return;
  const card=drawer.querySelector('.drawer-card');
  const isCurrent=()=>drawer.querySelector('.drawer-card')===card;
  const fmt=n=>Number(n).toLocaleString('es-CO',{maximumFractionDigits:4});
  let recipes=[];
  let editingId=null;
  let loading=false;
  let recipeRequest=0;
  const storageError=error=>error?.code==='23505'?'Ya existe una mezcla con ese nombre. Usa otro nombre.':(error?.message||'No se pudo guardar el cambio.');
  panel.innerHTML=`
    <div class="section-head"><div><h3>Mezclas</h3></div><button type="button" class="btn primary" id="newMixture">+ Crear mezcla</button></div>
    <p class="mixture-status" role="status" id="mixtureLibraryStatus">Cargando mezclas…</p>
    <div id="mixtureLibraryList"></div>
    <form id="mixtureEditor" class="hidden mixture-editor">
      <h3 id="mixtureEditorTitle">Crear mezcla</h3>
      <div class="grid">
        <div class="field"><label for="mixtureName">Nombre de la mezcla</label><input id="mixtureName" required maxlength="120" placeholder="Ej. Mezcla pedestal"></div>
        <div class="field"><label for="mixtureCementType">Tipo de cemento</label><select id="mixtureCementType"><option value="BLANCO">Blanco</option><option value="GRIS">Gris</option></select></div>
      </div>
      <div class="grid" style="margin-top:12px">
        <div class="field"><label for="mixFineSandColor">Color de la arena fina</label><input id="mixFineSandColor" maxlength="120" required placeholder="Ej. Blanca"></div>
        <div class="field"><label for="mixCoarseSandColor">Color de la arena gruesa</label><input id="mixCoarseSandColor" maxlength="120" required placeholder="Ej. Gris"></div>
      </div>
      <div class="mixture-materials">
      <h4 class="mixture-group-title">Agregados</h4>
      <div class="mixture-row-heading mixture-grain-heading" aria-hidden="true"><span>Color</span><span>Tamaño</span><span>%</span></div>
      ${MIXTURE_GRAINS.map(n=>`<fieldset class="mixture-grain mixture-compact-grain"><legend class="mixture-visually-hidden">Grano ${n}</legend><div class="grid">
        <div class="field"><label class="mixture-visually-hidden" for="mixGrainColor_${n}">Color / referencia</label><input id="mixGrainColor_${n}" maxlength="120" placeholder="Color"></div>
        <div class="field"><label class="mixture-visually-hidden" for="mixGrainSize_${n}">Tamaño</label><input id="mixGrainSize_${n}" maxlength="120" placeholder="Nº2"></div>
        <div class="field"><label class="mixture-visually-hidden" for="mixGrainPct_${n}">% sobre el peso del elemento</label><input id="mixGrainPct_${n}" type="number" min="0" max="100" step="0.0001" value="0" required></div>
      </div></fieldset>`).join('')}
      </div>
      <h4 class="mixture-group-title">Pigmentos</h4>
      <div class="mixture-row-heading mixture-pigment-heading" aria-hidden="true"><span>Nombre / color</span><span>Dosificación</span><span>% cemento</span></div>
      ${MIXTURE_PIGMENTS.map(n=>`<fieldset class="mixture-grain mixture-compact-pigment"><legend class="mixture-visually-hidden">Pigmento ${n}</legend><div class="grid">
        <div class="field"><label class="mixture-visually-hidden" for="mixPigmentName_${n}">Nombre / color</label><input id="mixPigmentName_${n}" maxlength="120" placeholder="Negro, Kolanil…"></div>
        <div class="field"><label class="mixture-visually-hidden" for="mixPigmentMode_${n}">Dosificación</label><select id="mixPigmentMode_${n}"><option value="percent">% estimado</option><option value="eye">A ojo</option></select></div>
        <div class="field" id="mixPigmentPctField_${n}"><label class="mixture-visually-hidden" for="mixPigmentPct_${n}">% sobre el cemento</label><input id="mixPigmentPct_${n}" type="number" min="0" max="100" step="0.0001"></div>
      </div></fieldset>`).join('')}
      <p id="mixtureSaveStatus" role="status"></p>
      <div class="mixture-actions"><button class="btn primary" type="submit">Guardar mezcla</button><button class="btn secondary" type="button" id="cancelMixture">Cancelar</button></div>
    </form>`;
  const editor=panel.querySelector('#mixtureEditor');
  const q=selector=>panel.querySelector(selector)||(editor.matches(selector)?editor:editor.querySelector(selector));
  const setStatus=(message,error=false)=>{q('#mixtureLibraryStatus').textContent=message;q('#mixtureLibraryStatus').classList.toggle('mixture-error',error)};
  const getRecipe=()=>{
    const recipe={nombre:q('#mixtureName').value.trim(),cemento_tipo:q('#mixtureCementType').value,arena_fina_color:q('#mixFineSandColor').value.trim(),arena_gruesa_color:q('#mixCoarseSandColor').value.trim()};
    MIXTURE_GRAINS.forEach(n=>{recipe[`grano_${n}_color`]=q('#mixGrainColor_'+n).value.trim();recipe[`grano_${n}_tamano`]=q('#mixGrainSize_'+n).value.trim();recipe[`grano_${n}_pct`]=Number(q('#mixGrainPct_'+n).value)});
    MIXTURE_PIGMENTS.forEach(n=>{
      recipe[`pigmento_${n}_nombre`]=q('#mixPigmentName_'+n).value.trim();
      const raw=q('#mixPigmentPct_'+n).value;
      const byEye=q('#mixPigmentMode_'+n).value==='eye';
      if(recipe[`pigmento_${n}_nombre`] && !byEye && raw==='')throw Error(`Pigmento ${n}: indica el porcentaje o selecciona «A ojo según color».`);
      recipe[`pigmento_${n}_pct`]=byEye||raw===''?null:Number(raw);
    });
    return recipe;
  };
  const syncPigmentMode=n=>{
    const byEye=q('#mixPigmentMode_'+n).value==='eye';
    q('#mixPigmentPct_'+n).disabled=byEye;
    q('#mixPigmentPctField_'+n).classList.toggle('hidden',byEye);
  };
  MIXTURE_PIGMENTS.forEach(n=>q('#mixPigmentMode_'+n).onchange=()=>syncPigmentMode(n));
  const openEditor=recipe=>{
    editingId=recipe?.id||null;
    q('#mixtureEditor').reset();
    q('#mixtureEditorTitle').textContent=recipe?'Editar mezcla':'Crear mezcla';
    q('#mixtureName').value=recipe?.nombre||'';
    q('#mixtureCementType').value=recipe?.cemento_tipo||'BLANCO';
    q('#mixFineSandColor').value=recipe?.arena_fina_color||'';
    q('#mixCoarseSandColor').value=recipe?.arena_gruesa_color||'';
    MIXTURE_GRAINS.forEach(n=>{
      q('#mixGrainColor_'+n).value=recipe?.[`grano_${n}_color`]||'';
      q('#mixGrainSize_'+n).value=recipe?.[`grano_${n}_tamano`]||'';
      q('#mixGrainPct_'+n).value=recipe?.[`grano_${n}_pct`]||0;
    });
    MIXTURE_PIGMENTS.forEach(n=>{
      const name=recipe?.[`pigmento_${n}_nombre`]||'';
      const pct=recipe?.[`pigmento_${n}_pct`];
      q('#mixPigmentName_'+n).value=name;
      q('#mixPigmentMode_'+n).value=name&&pct==null?'eye':'percent';
      q('#mixPigmentPct_'+n).value=pct??'';
      syncPigmentMode(n);
    });
    q('#mixtureSaveStatus').textContent='';
    q('#mixtureSaveStatus').classList.remove('mixture-error');
    openMixtureSidePanel(drawer,{title:recipe?'Editar mezcla':'Crear mezcla',content:editor});
    q('#mixtureName').focus({preventScroll:true});
  };
  const recipeTags=(recipe,includePigments=true)=>{
    if(!recipe)return '';
    const grains=MIXTURE_GRAINS.filter(n=>Number(recipe[`grano_${n}_pct`])>0).map(n=>`<span class="mixture-tag" title="Grano ${n}">${esc(recipe[`grano_${n}_color`])} ${esc(recipe[`grano_${n}_tamano`])} <b>${fmt(recipe[`grano_${n}_pct`])}%</b></span>`).join('');
    const pigments=includePigments?MIXTURE_PIGMENTS.filter(n=>recipe[`pigmento_${n}_nombre`]?.trim()).map(n=>`<span class="mixture-tag mixture-tag-pigment" title="Pigmento ${n}">${esc(recipe[`pigmento_${n}_nombre`])} <b>${recipe[`pigmento_${n}_pct`]==null?'A ojo':fmt(recipe[`pigmento_${n}_pct`])+'%'}</b></span>`).join(''):'';
    return grains||pigments?`<div class="mixture-tags">${grains}${pigments}</div>`:'';
  };
  const renderLibrary=()=>{
    q('#mixtureLibraryList').innerHTML=recipes.length?recipes.map(r=>`<article class="mixture-recipe"><div class="mixture-recipe-info"><strong>${esc(r.nombre)}</strong><small>Cemento ${r.cemento_tipo==='BLANCO'?'blanco':'gris'} · Arena fina ${esc(r.arena_fina_color)} · Arena gruesa ${esc(r.arena_gruesa_color)}</small>${recipeTags(r)}</div><button type="button" class="btn secondary" data-edit-mixture="${esc(r.id)}">Editar</button></article>`).join(''):'<p class="empty">Sin mezclas.</p>';
    q('#mixtureLibraryList').querySelectorAll('[data-edit-mixture]').forEach(button=>button.onclick=()=>openEditor(recipes.find(r=>r.id===button.dataset.editMixture)));
  };
  const renderDosage=async(host,item)=>{
    const button=host.querySelector('.mixture-generate');
    const select=host.querySelector('select');
    const side=openMixtureSidePanel(drawer,{title:'Dosificación',trigger:button});
    if(!side)return;
    const {dialog,body:result}=side;
    button.disabled=true;select.disabled=true;
    result.textContent='Calculando dosificación…';result.classList.remove('hidden','mixture-error');
    try{
      if(!item.mezcla_id)throw Error('Asigna y guarda una mezcla antes de generar la dosificación.');
      const {data:recipe,error}=await db.from('mezclas_produccion').select('*').eq('id',item.mezcla_id).single();
      if(error)throw error;
      if(!dialog.open||!isCurrent())return;
      if(!recipe)throw Error('La mezcla asignada no está disponible. Vuelve a abrir la orden.');
      validateProductionMixture(recipe);
      const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Bogota'}).format(new Date());
      result.classList.remove('mixture-error');
      result.innerHTML=`<h4>${esc(recipe.nombre)}</h4><p>${esc(item.codigo||'Ítem')} · Peso del elemento: <strong>${fmt(Number(item.peso_kg)||0)} kg</strong></p>
      <form class="item-dosage-form">
        <div class="grid">
          <div class="field"><label>Kg a fabricar<input class="item-dosage-kg" type="number" min="0.001" step="0.001" required value="${Number(item.peso_kg)>0?Number(item.peso_kg):''}"></label></div>
          <div class="field"><label>Fecha<input class="item-dosage-date" type="date" required value="${today}"></label></div>
        </div>
        <div class="item-dosage-preview"></div>
        <p class="item-dosage-status" role="status"></p>
        <button type="submit" class="btn primary item-dosage-register">Guardar</button>
      </form>`;
      const form=result.querySelector('form');
      const kgInput=form.querySelector('.item-dosage-kg');
      const dateInput=form.querySelector('.item-dosage-date');
      const preview=form.querySelector('.item-dosage-preview');
      const register=form.querySelector('.item-dosage-register');
      const status=form.querySelector('.item-dosage-status');
      let registrationId=null;
      let saving=false;
      let registered=false;
      const recalculate=()=>{
        if(saving)return;
        registered=false;registrationId=null;
        status.textContent='';status.classList.remove('mixture-error');
        register.textContent='Guardar';
        try{
          const dosage=calculateProductionMixture(recipe,kgInput.value);
          preview.innerHTML=`<div class="mixture-dosage-rows">${dosage.components.map(m=>`<div><span><strong>${esc(m.label)}${m.name?' · '+esc(m.name):''}</strong></span><strong>${m.amount===null?'A ojo según color':fmt(m.amount)+' '+m.unit}</strong></div>`).join('')}</div>`;
          register.disabled=false;
        }catch(error){preview.innerHTML='';status.textContent=error.message;status.classList.add('mixture-error');register.disabled=true}
      };
      kgInput.addEventListener('input',recalculate);
      dateInput.addEventListener('input',recalculate);
      form.onsubmit=async event=>{
        event.preventDefault();
        if(saving||registered)return;
        try{
          registrationId ||= crypto.randomUUID();
          const payload=buildProductionDosageRecord(recipe,item,order.id,kgInput.value,dateInput.value,registrationId);
          saving=true;side.setBusy(true);register.disabled=true;kgInput.disabled=true;dateInput.disabled=true;select.disabled=true;button.disabled=true;
          register.textContent='Guardando…';status.textContent='';status.classList.remove('mixture-error');
          let {data,error}=await db.from('registros_dosificacion').insert(payload).select('id').single();
          if(error?.code==='23505'){
            ({data,error}=await db.from('registros_dosificacion').select('id').eq('id',registrationId).eq('orden_id',order.id).single());
          }
          if(error)throw error;
          if(data?.id!==registrationId)throw Error('No se pudo confirmar el registro.');
          registered=true;register.textContent='Guardado';status.textContent='Dosificación registrada.';
          side.close({force:true,restoreFocus:false});
          try{
            if(isCurrent()){
              await drawer._reloadDosageRecords?.();
              if(isCurrent()){
                drawer.querySelector('[data-tab="dosageRecords"]')?.click();
                drawer.querySelector('#castingRecords')?.scrollIntoView({behavior:'smooth',block:'start'});
              }
            }
          }catch(error){status.textContent='Registrado. No se pudo actualizar el listado.'}
        }catch(error){status.textContent=error.message||'No se pudo registrar la dosificación.';status.classList.add('mixture-error');register.textContent='Guardar'}
        finally{saving=false;side.setBusy(false);register.disabled=registered;kgInput.disabled=false;dateInput.disabled=false;select.disabled=false;button.disabled=false}
      };
      recalculate();
      kgInput.focus({preventScroll:true});
      kgInput.select();
    }catch(error){result.textContent=storageError(error);result.classList.add('mixture-error')}
    finally{button.disabled=false;select.disabled=false}
    result.classList.remove('hidden');
  };
  const renderItems=()=>{
    if(!isCurrent())return;
    drawer.querySelectorAll('#itemsList [data-edit]').forEach(editButton=>{
      const item=order.items.find(i=>i.id===editButton.dataset.edit);
      const itemCard=editButton.closest('article');
      if(!item||!itemCard)return;
      itemCard.querySelector('.item-mixture')?.remove();
      const host=document.createElement('section');
      host.className='item-mixture';
      host.innerHTML=`<div class="mixture-item-controls"><div class="field"><label>Mezcla<select aria-label="Mezcla para ${esc(item.codigo||'ítem')}" ${loading?'disabled':''}><option value="">Sin mezcla asignada</option>${recipes.map(r=>`<option value="${esc(r.id)}" ${item.mezcla_id===r.id?'selected':''}>${esc(r.nombre)}</option>`).join('')}</select></label></div><button type="button" class="btn secondary mixture-generate" aria-label="Generar dosificación" title="Generar dosificación" ${loading?'disabled':''}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 10-12h-7l1-8z"/></svg></button></div><div class="item-mixture-summary"></div><p class="mixture-assignment-status" role="status"></p>`;
      (itemCard.querySelector('.item-work-row')||itemCard).append(host);
      const select=host.querySelector('select');
      const generate=host.querySelector('.mixture-generate');
      const status=host.querySelector('.mixture-assignment-status');
      const renderSummary=()=>{host.querySelector('.item-mixture-summary').innerHTML=recipeTags(recipes.find(r=>r.id===item.mezcla_id),false)};
      renderSummary();
      select.onchange=async()=>{
        const previous=item.mezcla_id||'';
        const next=select.value||null;
        select.disabled=true;generate.disabled=true;
        status.textContent='Guardando mezcla…';status.classList.remove('mixture-error');status.classList.add('mixture-visually-hidden');
        try{
          const {data,error}=await db.from('items_produccion').update({mezcla_id:next}).eq('id',item.id).select('id,mezcla_id').single();
          if(error)throw error;
          if(!data || data.mezcla_id!==next)throw Error('No se pudo confirmar la asignación de la mezcla.');
          item.mezcla_id=data.mezcla_id;
          renderSummary();
          onChange({recipes});
          status.textContent='Mezcla guardada.';
        }catch(error){select.value=previous;status.textContent=storageError(error);status.classList.add('mixture-error');status.classList.remove('mixture-visually-hidden')}
        finally{select.disabled=false;generate.disabled=false}
      };
      generate.onclick=()=>renderDosage(host,item);
    });
  };
  const reload=async()=>{
    const request=++recipeRequest;
    loading=true;onChange({loading:true});
    const {data,error}=await db.from('mezclas_produccion').select('*').order('nombre');
    if(!isCurrent() || request!==recipeRequest)return;
    loading=false;
    if(error){onChange({error});throw error}
    recipes=data||[];renderLibrary();renderItems();setStatus('');
    onChange({recipes});
  };
  drawer._mixtures={renderItems,reload};
  q('#newMixture').onclick=()=>openEditor(null);
  q('#cancelMixture').onclick=()=>drawer._mixturePanel?.close();
  q('#mixtureEditor').onsubmit=async event=>{
    event.preventDefault();
    const button=q('[type="submit"]');
    const side=drawer._mixturePanel;
    try{
      const recipe=validateProductionMixture(getRecipe());
      button.disabled=true;side?.setBusy(true);q('#mixtureSaveStatus').textContent='Guardando…';
      const query=editingId?db.from('mezclas_produccion').update(recipe).eq('id',editingId):db.from('mezclas_produccion').insert(recipe);
      const {data,error}=await query.select('id').single();
      if(error)throw error;
      if(!data)throw Error('No se pudo confirmar el guardado.');
      if(!isCurrent())return;
      side?.close({force:true});
      await reload();
      setStatus('Mezcla guardada.');
    }catch(error){
      if(!isCurrent())return;
      q('#mixtureSaveStatus').textContent=storageError(error);q('#mixtureSaveStatus').classList.add('mixture-error');
      if(q('#mixtureEditor').classList.contains('hidden'))setStatus('La mezcla se guardó, pero no se pudo actualizar el listado. Vuelve a abrir la orden.',true);
    }finally{button.disabled=false;side?.setBusy(false)}
  };
  try{await reload()}catch(error){if(isCurrent()){setStatus('No se pudieron cargar las mezclas: '+storageError(error),true);q('#newMixture').disabled=true}}
}
