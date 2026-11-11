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
