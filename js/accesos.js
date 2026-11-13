// These UI restrictions accompany the database guard; they are not authorization.
let productionViewerObserver=null;
function applyProductionViewerMode(){
  if(!document.body.classList.contains('production-view-only'))return;
  document.querySelectorAll('#drawer input,#drawer select,#drawer textarea').forEach(field=>{
    if(field.id==='orderItemsStateFilter'||field.type==='search')return;
    if(!field.disabled)field.disabled=true;
  });
  document.querySelectorAll('#drawer button').forEach(button=>{
    if(button.matches('.close,[data-tab],#printOrderDocument,[data-open-reference],[data-model-3d]'))return;
    if(!button.disabled)button.disabled=true;
  });
  document.querySelectorAll('#itemModelDialog input[type="file"]').forEach(field=>{if(!field.disabled)field.disabled=true;});
}
function setProductionViewerMode(enabled){
  productionViewerObserver?.disconnect();productionViewerObserver=null;
  document.body.classList.toggle('production-view-only',enabled);
  if(!enabled)return;
  applyProductionViewerMode();
  productionViewerObserver=new MutationObserver(applyProductionViewerMode);
  productionViewerObserver.observe(document.body,{childList:true,subtree:true});
}
