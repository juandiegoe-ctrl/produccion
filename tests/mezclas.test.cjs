const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const context=vm.createContext({});
vm.runInContext(html.match(/const DOSAGE_BASE=\[[\s\S]*?\];/)[0],context);
vm.runInContext(fs.readFileSync(path.join(root,'js/mezclas.js'),'utf8'),context);
const recipe={nombre:'Pedestal',cemento_tipo:'BLANCO',arena_fina_color:'Blanca',arena_gruesa_color:'Gris',grano_1_color:'Carrara',grano_1_tamano:'3-6 mm',grano_1_pct:10,grano_2_color:'Negro',grano_2_tamano:'#1',grano_2_pct:5,grano_3_color:'',grano_3_tamano:'',grano_3_pct:0};
test('preserves the previous formula and adds grains without reducing sand',()=>{
 const result=context.calculateProductionMixture(recipe,50);
 const amounts=Object.fromEntries(result.components.map(m=>[m.label,m.amount]));
 assert.deepEqual(amounts,{'Cemento':15.5,'Arena gruesa':9.7,'Arena fina':14.55,'Agua':3.45,'Superplastificante':350,'Carbonato de calcio':4.2,'Grano 1':5,'Grano 2':2.5});
 assert.equal(result.totalMl,350);
 assert.ok(Math.abs(result.totalKg-54.9)<1e-10);
});
test('uses fractional item weights without rounding ingredients before display',()=>{
 const result=context.calculateProductionMixture(recipe,2.75);
 assert.ok(Math.abs(result.components.find(m=>m.label==='Cemento').amount-0.8525)<1e-10);
 assert.ok(Math.abs(result.components.find(m=>m.label==='Grano 1').amount-0.275)<1e-10);
});
test('optional zero-percent grains need no color or size',()=>{
 const result=context.calculateProductionMixture({...recipe,grano_1_pct:0,grano_2_pct:0,grano_1_color:'',grano_1_tamano:''},100);
 assert.equal(result.components.length,6);
});
test('rejects invalid weights, missing references and invalid percentages',()=>{
 for(const weight of [0,-1,Infinity,NaN,''])assert.throws(()=>context.calculateProductionMixture(recipe,weight),/peso mayor que cero/);
 assert.throws(()=>context.validateProductionMixture({...recipe,grano_1_tamano:''}),/color y el tamaño/);
 assert.throws(()=>context.validateProductionMixture({...recipe,grano_1_pct:-10}),/entre 0 y 100/);
 assert.throws(()=>context.validateProductionMixture({...recipe,grano_1_pct:101}),/entre 0 y 100/);
 assert.throws(()=>context.validateProductionMixture({...recipe,arena_fina_color:''}),/color de la arena/);
 assert.throws(()=>context.validateProductionMixture({...recipe,cemento_tipo:'OTRO'}),/blanco o gris/);
});
test('pigments use cement weight and contribute to the kg total',()=>{
 const result=context.calculateProductionMixture({...recipe,pigmento_1_nombre:'Negro',pigmento_1_pct:2,pigmento_2_nombre:'Kolanil',pigmento_2_pct:1},50);
 assert.equal(result.components.find(m=>m.label==='Pigmento 1').amount,0.31);
 assert.equal(result.components.find(m=>m.label==='Pigmento 2').amount,0.155);
 assert.ok(Math.abs(result.totalKg-55.365)<1e-10);
 assert.equal(result.hasUnmeasuredPigments,false);
});
test('by-eye pigments preserve their name without inventing a quantity',()=>{
 const result=context.calculateProductionMixture({...recipe,pigmento_1_nombre:'Negro',pigmento_1_pct:null,pigmento_2_nombre:'Kolanil',pigmento_2_pct:2},50);
 assert.equal(result.components.find(m=>m.label==='Pigmento 1').amount,null);
 assert.equal(result.components.find(m=>m.label==='Pigmento 1').name,'Negro');
 assert.ok(Math.abs(result.totalKg-55.21)<1e-10);
 assert.equal(result.hasUnmeasuredPigments,true);
});
test('unused pigments remain compatible with older recipes',()=>{
 const result=context.calculateProductionMixture({...recipe,pigmento_1_nombre:'',pigmento_1_pct:null,pigmento_2_nombre:'',pigmento_2_pct:null},50);
 assert.equal(result.components.length,8);
 assert.equal(result.hasUnmeasuredPigments,false);
});
test('rejects invalid pigment percentages and unnamed dosages',()=>{
 for(const pct of [-1,101,NaN,Infinity,''])assert.throws(()=>context.validateProductionMixture({...recipe,pigmento_1_nombre:'Negro',pigmento_1_pct:pct}),/entre 0 y 100/);
 assert.throws(()=>context.validateProductionMixture({...recipe,pigmento_2_nombre:'',pigmento_2_pct:2}),/escribe el nombre/);
});
test('batch weight overrides item weight and saves an independent recipe snapshot',()=>{
 const item={id:'item-1',codigo:'001-001',peso_kg:50};
 const mix={...recipe,id:'mix-1',pigmento_1_nombre:'Negro',pigmento_1_pct:2,pigmento_2_nombre:'Kolanil',pigmento_2_pct:null};
 const record=context.buildProductionDosageRecord(mix,item,'order-1',75,'2026-11-11','batch-1');
 assert.equal(record.id,'batch-1');
 assert.equal(record.total_kg,75);
 assert.equal(item.peso_kg,50);
 assert.equal(record.item_id,'item-1');
 assert.equal(record.mezcla_id,'mix-1');
 assert.equal(record.componentes.Cemento.cantidad,23.25);
 assert.equal(record.componentes['Grano 1'].cantidad,7.5);
 assert.equal(record.componentes['Pigmento 1'].cantidad,0.465);
 assert.equal(record.componentes['Pigmento 2'].cantidad,null);
 assert.equal(record.componentes['Pigmento 2'].a_ojo,true);
 mix.grano_1_pct=99;mix.nombre='Changed';
 assert.equal(record.receta_snapshot.grano_1_pct,10);
 assert.equal(record.mezcla_nombre,'Pedestal');
});
test('batch registration rejects invalid dates and unsupported kg precision',()=>{
 const build=(kg,date)=>context.buildProductionDosageRecord(recipe,{id:'item-1'},'order-1',kg,date,'batch-1');
 for(const date of ['', '2026-02-30','2026-13-11','2026-1-1'])assert.throws(()=>build(50,date),/fecha válida/);
 assert.throws(()=>build(50.1234,'2026-11-11'),/3 decimales/);
 assert.equal(build(50.123,'2026-11-11').total_kg,50.123);
});

test('batch comments are saved and empty comments stay optional',()=>{
 const build=comments=>context.buildProductionDosageRecord(recipe,{id:'item-1'},'order-1',50,'2026-11-11','batch-1',comments);
 assert.equal(build('  Fabricar extra para reposición.  ').observacion,'Fabricar extra para reposición.');
 assert.equal(build('   ').observacion,null);
 assert.equal(build(undefined).observacion,null);
});
