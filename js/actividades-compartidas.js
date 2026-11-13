const sharedDaily={ready:false,error:'',pending:[],extras:{},drafts:{},userId:null,channel:null,timer:null,sequence:0};
let sharedExtraTimer=null;
let sharedExtraQueue=Promise.resolve();
function canEditSharedDaily(){
  return sharedDaily.ready&&!sharedDaily.error&&!productionAdvanceContext.viewOnly&&['ADMINISTRADOR','PRODUCCION'].includes(productionAdvanceContext.profile?.rol);
}
function sharedDailyError(error){
  if(['42P01','42883','PGRST202','PGRST205'].includes(error?.code))return 'Falta activar las actividades compartidas en Supabase: ejecuta db/actividades-compartidas.sql.';
  return error?.message||'No se pudieron sincronizar las actividades. Intenta nuevamente.';
}
function updateSharedDailyUI(){
  const ids=new Set(sharedDaily.pending.map(row=>String(row.item_id)));
  document.querySelectorAll('[data-daily-item]').forEach(input=>{
    input.checked=ids.has(input.dataset.dailyItem);input.disabled=!canEditSharedDaily();
  });
  if(document.querySelector('#dailyPlan')?.open&&document.activeElement?.id!=='dailyExtraInput')showDailyPlan();
}
async function refreshSharedDaily({render=true}={}){
  if(!sharedDaily.userId)return false;
  const sequence=++sharedDaily.sequence;
  const date=dailyPlanDate();
  try{
    const [pending,extra]=await Promise.all([
      db.from('actividades_produccion').select('item_id,estado_seleccionado,prioridad').order('prioridad'),
      db.from('actividades_produccion_adicionales').select('fecha,texto').eq('fecha',date)
    ]);
    if(sequence!==sharedDaily.sequence)return false;
    if(pending.error||extra.error)throw pending.error||extra.error;
    sharedDaily.pending=pending.data||[];sharedDaily.extras[date]=extra.data?.[0]?.texto||'';
    sharedDaily.ready=true;sharedDaily.error='';
    if(render)updateSharedDailyUI();
    return true;
  }catch(error){
    if(sequence!==sharedDaily.sequence)return false;
    sharedDaily.error=sharedDailyError(error);
    if(render)updateSharedDailyUI();
    return false;
  }
}
function resetSharedDaily(){
  sharedDaily.sequence++;
  if(sharedDaily.channel)db.removeChannel(sharedDaily.channel);
  clearInterval(sharedDaily.timer);clearTimeout(sharedExtraTimer);
  sharedExtraQueue=Promise.resolve();
  sharedDaily.channel=null;sharedDaily.timer=null;sharedDaily.userId=null;
  sharedDaily.ready=false;sharedDaily.pending=[];sharedDaily.extras={};sharedDaily.drafts={};sharedDaily.error='';
}
async function initializeSharedDaily(user){
  resetSharedDaily();sharedDaily.userId=user.id;
  await refreshSharedDaily({render:false});
  sharedDaily.channel=db.channel('actividades-compartidas-'+user.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'actividades_produccion'},()=>refreshSharedDaily())
    .on('postgres_changes',{event:'*',schema:'public',table:'actividades_produccion_adicionales'},()=>refreshSharedDaily())
    .subscribe();
  // Keep readers synchronized even when their connection cannot use Realtime.
  sharedDaily.timer=setInterval(()=>{if(document.visibilityState==='visible')refreshSharedDaily();},15000);
}
async function setSharedDailyItem(id,selected){
  if(!canEditSharedDaily())throw Error('No tienes permiso para editar las actividades compartidas.');
  const {error}=await db.rpc('seleccionar_actividad_produccion',{p_item_id:id,p_seleccionado:selected});
  if(error)throw Error(sharedDailyError(error));
  await refreshSharedDaily();
}
function sharedDailyExtraText(){
  const date=dailyPlanDate();return sharedDaily.drafts[date]?.text??sharedDaily.extras[date]??'';
}
function saveSharedDailyExtra(text,date=dailyPlanDate()){
  if(!canEditSharedDaily())return Promise.reject(Error('No tienes permiso para editar las actividades.'));
  const userId=sharedDaily.userId;
  const draft={text};sharedDaily.drafts[date]=draft;
  const save=async()=>{
    if(userId!==sharedDaily.userId)return;
    const {error}=await db.from('actividades_produccion_adicionales').upsert({fecha:date,texto:text,actualizado_por:userId,actualizado_en:new Date().toISOString()});
    if(error)throw Error(sharedDailyError(error));
    if(userId!==sharedDaily.userId)return;
    sharedDaily.extras[date]=text;
    if(sharedDaily.drafts[date]===draft)delete sharedDaily.drafts[date];
  };
  sharedExtraQueue=sharedExtraQueue.catch(()=>{}).then(save);
  return sharedExtraQueue;
}
function queueSharedDailyExtra(text){
  const date=dailyPlanDate();sharedDaily.drafts[date]={text};clearTimeout(sharedExtraTimer);
  const status=document.querySelector('#dailyExtraStatus');if(status)status.textContent='Guardando…';
  sharedExtraTimer=setTimeout(()=>saveSharedDailyExtra(text,date).then(()=>{
    const current=document.querySelector('#dailyExtraStatus');if(current)current.textContent='Guardado para todos.';
  }).catch(error=>{
    const current=document.querySelector('#dailyExtraStatus');if(current)current.textContent=error.message;
  }),700);
}
async function flushSharedDailyExtra(){
  clearTimeout(sharedExtraTimer);
  const date=dailyPlanDate();
  const draft=sharedDaily.drafts[date];
  if(draft&&canEditSharedDaily())await saveSharedDailyExtra(draft.text,date);
  await sharedExtraQueue;
}
function localDailyImportCount(){
  if(!canEditSharedDaily())return 0;
  try{return Object.keys(readDailyPending()).length;}catch{return 0;}
}
async function importLocalDailyPlan(){
  if(!canEditSharedDaily())throw Error('No tienes permiso para importar actividades.');
  const local=readDailyPending();
  const items=new Map(orders.flatMap(order=>(order.items||[]).map(item=>[String(item.id),{order,item}])));
  const stages=['MOLDE','FUNDIR','PULIR','ALISTAR','ENTREGADO','CERRADO'];
  for(const [id,entry] of Object.entries(local).sort((a,b)=>a[1].priority-b[1].priority)){
    const row=items.get(id);
    if(!row||row.order.cerrada||!DAILY_PLAN_STAGES[row.item.estado])continue;
    if(entry.state&&stages.indexOf(row.item.estado)>stages.indexOf(entry.state))continue;
    const {error}=await db.rpc('seleccionar_actividad_produccion',{p_item_id:id,p_seleccionado:true});
    if(error)throw Error(sharedDailyError(error));
  }
  const oldText=localStorage.getItem(dailyExtraKey())||'';
  if(oldText.trim()&&!sharedDailyExtraText().trim())await saveSharedDailyExtra(oldText);
  localStorage.setItem(DAILY_PENDING_KEY,'{}');
  await refreshSharedDaily();
}
