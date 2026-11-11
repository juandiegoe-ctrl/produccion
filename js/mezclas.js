/* Keep the existing DOSAGE_BASE formula. Grains are additional percentages of item weight. */
const MIXTURE_GRAINS = [1,2,3];

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
  return {weight:kg,components,totalKg:components.filter(m=>m.unit==='kg').reduce((sum,m)=>sum+m.amount,0),totalMl:components.filter(m=>m.unit==='ml').reduce((sum,m)=>sum+m.amount,0)};
}

async function mountProductionMixtures(drawer,order){
  const panel=drawer.querySelector('#mixtureLibrary');
  if(!panel)return;
  const card=drawer.querySelector('.drawer-card');
  const isCurrent=()=>drawer.querySelector('.drawer-card')===card;
  const fmt=n=>Number(n).toLocaleString('es-CO',{maximumFractionDigits:4});
  let recipes=[];
  let editingId=null;
  let loading=false;
  const storageError=error=>error?.code==='23505'?'Ya existe una mezcla con ese nombre. Usa otro nombre.':(error?.message||'No se pudo guardar el cambio.');
  panel.innerHTML=`
    <div class="section-head"><div><h3>Mezclas</h3><p>Crea recetas reutilizables y asígnalas a los ítems.</p></div><button type="button" class="btn primary" id="newMixture">+ Crear mezcla</button></div>
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
      <p>El agua, el aditivo y el carbonato se calculan automáticamente con la receta actual. Los granos se suman a la receta base, sin descontarlos de las arenas.</p>
      <div class="mixture-materials">
      ${MIXTURE_GRAINS.map(n=>`<fieldset class="mixture-grain"><legend>Grano ${n}</legend><div class="grid">
        <div class="field"><label for="mixGrainColor_${n}">Color / referencia</label><input id="mixGrainColor_${n}" maxlength="120" placeholder="Ej. Blanco Carrara"></div>
        <div class="field"><label for="mixGrainSize_${n}">Tamaño</label><input id="mixGrainSize_${n}" maxlength="120" placeholder="Ej. #2 o 3–6 mm"></div>
        <div class="field"><label for="mixGrainPct_${n}">% sobre el peso del elemento</label><input id="mixGrainPct_${n}" type="number" min="0" max="100" step="0.0001" value="0" required></div>
      </div></fieldset>`).join('')}
      </div>
      <p id="mixturePercentTotal" role="status"></p>
      <p id="mixtureSaveStatus" role="status"></p>
      <div class="mixture-actions"><button class="btn primary" type="submit">Guardar mezcla</button><button class="btn secondary" type="button" id="cancelMixture">Cancelar</button></div>
    </form>`;
  const q=s=>panel.querySelector(s);
  const setStatus=(message,error=false)=>{q('#mixtureLibraryStatus').textContent=message;q('#mixtureLibraryStatus').classList.toggle('mixture-error',error)};
  const getRecipe=()=>{
    const recipe={nombre:q('#mixtureName').value.trim(),cemento_tipo:q('#mixtureCementType').value,arena_fina_color:q('#mixFineSandColor').value.trim(),arena_gruesa_color:q('#mixCoarseSandColor').value.trim()};
    MIXTURE_GRAINS.forEach(n=>{recipe[`grano_${n}_color`]=q('#mixGrainColor_'+n).value.trim();recipe[`grano_${n}_tamano`]=q('#mixGrainSize_'+n).value.trim();recipe[`grano_${n}_pct`]=Number(q('#mixGrainPct_'+n).value)});
    return recipe;
  };
  const updateTotal=()=>{
    const r=getRecipe();
    const total=MIXTURE_GRAINS.reduce((sum,n)=>sum+r[`grano_${n}_pct`],0);
    q('#mixturePercentTotal').textContent=`Granos adicionales: ${fmt(total)} kg por cada 100 kg de elemento.`;
  };
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
    q('#mixtureSaveStatus').textContent=recipe?'Los cambios se aplicarán a las próximas dosificaciones de todos los ítems que usan esta mezcla.':'';
    q('#mixtureSaveStatus').classList.remove('mixture-error');
    q('#mixtureEditor').classList.remove('hidden');
    updateTotal();
    q('#mixtureName').focus();
  };
  const renderLibrary=()=>{
    q('#mixtureLibraryList').innerHTML=recipes.length?recipes.map(r=>`<article class="mixture-recipe"><div><strong>${esc(r.nombre)}</strong><small>Cemento ${r.cemento_tipo==='BLANCO'?'blanco':'gris'} · Arena fina ${esc(r.arena_fina_color)} · Arena gruesa ${esc(r.arena_gruesa_color)}${MIXTURE_GRAINS.filter(n=>Number(r[`grano_${n}_pct`])>0).map(n=>` · Grano ${n}: ${esc(r[`grano_${n}_color`])} / ${esc(r[`grano_${n}_tamano`])} (${fmt(r[`grano_${n}_pct`])}%)`).join('')}</small></div><button type="button" class="btn secondary" data-edit-mixture="${esc(r.id)}">Editar</button></article>`).join(''):'<p class="empty">Aún no hay mezclas. Crea la primera para asignarla a tus ítems.</p>';
    q('#mixtureLibraryList').querySelectorAll('[data-edit-mixture]').forEach(button=>button.onclick=()=>openEditor(recipes.find(r=>r.id===button.dataset.editMixture)));
  };
  const renderDosage=async(host,item)=>{
    const result=host.querySelector('.item-mixture-result');
    const button=host.querySelector('.mixture-generate');
    const select=host.querySelector('select');
    button.disabled=true;select.disabled=true;
    result.textContent='Calculando dosificación…';result.classList.remove('hidden','mixture-error');
    try{
      if(!item.mezcla_id)throw Error('Asigna y guarda una mezcla antes de generar la dosificación.');
      const {data:recipe,error}=await db.from('mezclas_produccion').select('*').eq('id',item.mezcla_id).single();
      if(error)throw error;
      if(!recipe)throw Error('La mezcla asignada no está disponible. Vuelve a abrir la orden.');
      const dosage=calculateProductionMixture(recipe,item.peso_kg);
      result.classList.remove('mixture-error');
      result.innerHTML=`<h4>Dosificación · ${esc(recipe.nombre)}</h4><p>${esc(item.codigo||'Ítem')} · Peso del elemento: <strong>${fmt(dosage.weight)} kg</strong></p>
      <div class="mixture-dosage-rows">${dosage.components.map(m=>`<div><span><strong>${esc(m.label)}${m.name?' · '+esc(m.name):''}</strong><small>${esc(m.basis)}</small></span><strong>${fmt(m.amount)} ${m.unit}</strong></div>`).join('')}</div>
      <p><strong>Total a preparar: ${fmt(dosage.totalKg)} kg + ${fmt(dosage.totalMl)} ml de aditivo</strong><small class="mixture-note">Receta base actual + granos adicionales. Las cantidades se recalculan con el peso actual del ítem y la mezcla guardada.</small></p>`;
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
      host.innerHTML=`<div class="mixture-item-controls"><div class="field"><label>Mezcla del ítem<select aria-label="Mezcla para ${esc(item.codigo||'ítem')}" ${loading?'disabled':''}><option value="">Sin mezcla asignada</option>${recipes.map(r=>`<option value="${esc(r.id)}" ${item.mezcla_id===r.id?'selected':''}>${esc(r.nombre)}</option>`).join('')}</select></label></div><button type="button" class="btn secondary mixture-generate" ${loading?'disabled':''}>Generar dosificación</button></div><p class="mixture-assignment-status" role="status"></p><div class="item-mixture-result hidden" aria-live="polite"></div>`;
      itemCard.append(host);
      const select=host.querySelector('select');
      const generate=host.querySelector('.mixture-generate');
      const status=host.querySelector('.mixture-assignment-status');
      select.onchange=async()=>{
        const previous=item.mezcla_id||'';
        const next=select.value||null;
        select.disabled=true;generate.disabled=true;
        host.querySelector('.item-mixture-result').classList.add('hidden');
        status.textContent='Guardando mezcla…';status.classList.remove('mixture-error');
        try{
          const {data,error}=await db.from('items_produccion').update({mezcla_id:next}).eq('id',item.id).select('id,mezcla_id').single();
          if(error)throw error;
          if(!data || data.mezcla_id!==next)throw Error('No se pudo confirmar la asignación de la mezcla.');
          item.mezcla_id=data.mezcla_id;
          status.textContent='Mezcla guardada.';
        }catch(error){select.value=previous;status.textContent=storageError(error);status.classList.add('mixture-error')}
        finally{select.disabled=false;generate.disabled=false}
      };
      generate.onclick=()=>renderDosage(host,item);
    });
  };
  const reload=async()=>{
    loading=true;
    const {data,error}=await db.from('mezclas_produccion').select('*').order('nombre');
    loading=false;
    if(error)throw error;
    if(!isCurrent())return;
    recipes=data||[];renderLibrary();renderItems();setStatus('');
  };
  drawer._mixtures={renderItems};
  q('#newMixture').onclick=()=>openEditor(null);
  q('#cancelMixture').onclick=()=>q('#mixtureEditor').classList.add('hidden');
  q('#mixtureEditor').addEventListener('input',updateTotal);
  q('#mixtureEditor').onsubmit=async event=>{
    event.preventDefault();
    const button=q('[type="submit"]');
    try{
      const recipe=validateProductionMixture(getRecipe());
      button.disabled=true;q('#mixtureSaveStatus').textContent='Guardando…';
      const query=editingId?db.from('mezclas_produccion').update(recipe).eq('id',editingId):db.from('mezclas_produccion').insert(recipe);
      const {data,error}=await query.select('id').single();
      if(error)throw error;
      if(!data)throw Error('No se pudo confirmar el guardado.');
      if(!isCurrent())return;
      q('#mixtureEditor').classList.add('hidden');
      await reload();
      setStatus('Mezcla guardada. Ya puedes asignarla a los ítems.');
    }catch(error){
      if(!isCurrent())return;
      q('#mixtureSaveStatus').textContent=storageError(error);q('#mixtureSaveStatus').classList.add('mixture-error');
      if(q('#mixtureEditor').classList.contains('hidden'))setStatus('La mezcla se guardó, pero no se pudo actualizar el listado. Vuelve a abrir la orden.',true);
    }finally{button.disabled=false}
  };
  try{await reload()}catch(error){if(isCurrent()){setStatus('No se pudieron cargar las mezclas: '+storageError(error),true);q('#newMixture').disabled=true}}
}
