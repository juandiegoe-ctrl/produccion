// Draw only geometric creases: coplanar GLB triangle edges stay hidden.
export async function createItemLineViewer(host,url,{onMeasure=()=>{}}={}){
  const [THREE,{GLTFLoader},{OrbitControls},{DRACOLoader},{MeshoptDecoder},{LineSegments2},{LineSegmentsGeometry},{LineMaterial}]=await Promise.all([
    import('https://cdn.jsdelivr.net/npm/three@0.172.0/+esm'),
    import('https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/loaders/GLTFLoader.js/+esm'),
    import('https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/controls/OrbitControls.js/+esm'),
    import('https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/loaders/DRACOLoader.js/+esm'),
    import('https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/libs/meshopt_decoder.module.js/+esm'),
    import('https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/lines/LineSegments2.js/+esm'),
    import('https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/lines/LineSegmentsGeometry.js/+esm'),
    import('https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/lines/LineMaterial.js/+esm')
  ]);
  if(!host.isConnected)throw Error('Visor cerrado.');
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setClearColor(0xd3d4cf);
  const canvas=renderer.domElement;
  canvas.setAttribute('aria-label','Vista técnica 3D. Arrastra para girar y usa la rueda o dos dedos para acercar.');
  canvas.setAttribute('role','img');
  canvas.tabIndex=0;
  host.append(canvas);
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(35,1,.001,10000);
  const controls=new OrbitControls(camera,canvas);
  controls.enableDamping=false;
  controls.screenSpacePanning=true;
  const draco=new DRACOLoader();
  draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/libs/draco/gltf/');
  const loader=new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  const geometries=new Set(),materials=new Set(),textures=new Set();
  let observer;
  let disposed=false;
  let selection=null;
  const events=new AbortController();
  const label=document.createElement('div');label.className='item-edge-label';label.hidden=true;host.append(label);
  const highlightGeometry=new LineSegmentsGeometry().setPositions([0,0,0,0,0,0]);
  const highlightMaterial=new LineMaterial({color:0x00a64b,linewidth:5,worldUnits:false,depthWrite:false});
  const highlight=new LineSegments2(highlightGeometry,highlightMaterial);highlight.visible=false;highlight.renderOrder=10;highlightMaterial.depthWrite=false;scene.add(highlight);
  geometries.add(highlightGeometry);materials.add(highlightMaterial);
  const clearMeasurement=()=>{selection=null;highlight.visible=false;label.hidden=true;onMeasure(null);render();};
  const render=()=>{
    if(disposed)return;
    camera.updateMatrixWorld();
    if(selection){
      const projected=selection.midpoint.clone().project(camera);
      label.hidden=projected.z < -1||projected.z > 1;
      label.style.left=`${Math.max(35,Math.min(host.clientWidth-35,(projected.x+1)/2*host.clientWidth))}px`;
      label.style.top=`${Math.max(30,Math.min(host.clientHeight-5,(1-projected.y)/2*host.clientHeight))}px`;
    }
    renderer.render(scene,camera);
  };
  const dispose=()=>{
    if(disposed)return;disposed=true;
    events.abort();label.remove();observer?.disconnect();controls.dispose();draco.dispose();
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
    renderer.dispose();renderer.forceContextLoss();canvas.remove();
  };
  try{
    const gltf=await loader.loadAsync(url);
    gltf.scene.traverse(object=>{
      if(object.geometry)geometries.add(object.geometry);
      const originals=Array.isArray(object.material)?object.material:[object.material];
      originals.filter(Boolean).forEach(material=>{
        materials.add(material);Object.values(material).forEach(value=>{if(value?.isTexture)textures.add(value);});
      });
    });
    if(!host.isConnected){dispose();throw Error('Visor cerrado.');}
    const meshes=[];
    gltf.scene.traverse(object=>{if(object.isMesh)meshes.push(object);});
    if(!meshes.length)throw Error('El GLB no contiene superficies para la vista técnica.');
    const faceMaterial=new THREE.MeshBasicMaterial({color:0xfafaf7,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
    const edgeMaterial=new THREE.LineBasicMaterial({color:0x252b28});
    materials.add(faceMaterial);materials.add(edgeMaterial);
    let edgeSegments=0;
    const edgeObjects=[];
    meshes.forEach(mesh=>{
      mesh.material=faceMaterial;
      const geometry=new THREE.EdgesGeometry(mesh.geometry,25);
      geometries.add(geometry);
      const copies=mesh.isInstancedMesh?mesh.count:1;
      edgeSegments+=geometry.attributes.position.count/2*copies;
      for(let i=0;i<copies;i++){
        const lines=new THREE.LineSegments(geometry,edgeMaterial);
        if(mesh.isInstancedMesh){mesh.getMatrixAt(i,lines.matrix);lines.matrixAutoUpdate=false;}
        mesh.add(lines);edgeObjects.push(lines);
      }
    });
    scene.add(gltf.scene);scene.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(gltf.scene);
    if(box.isEmpty())throw Error('El modelo no tiene geometría visible.');
    const center=box.getCenter(new THREE.Vector3());
    const radius=Math.max(box.getSize(new THREE.Vector3()).length()/2,.001);
    const distance=radius/Math.sin(THREE.MathUtils.degToRad(camera.fov/2))*1.15;
    camera.position.copy(center).add(new THREE.Vector3(1,.85,1.2).normalize().multiplyScalar(distance));
    camera.near=radius/1000;camera.far=distance+radius*100;
    controls.target.copy(center);controls.minDistance=radius*.05;controls.maxDistance=radius*30;
    // Measure world-space endpoints so nested scales and instances are respected.
    const edges=[];
    edgeObjects.forEach(object=>{
      const positions=object.geometry.attributes.position;
      for(let i=0;i<positions.count;i+=2){
        edges.push({a:new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld),b:new THREE.Vector3().fromBufferAttribute(positions,i+1).applyMatrix4(object.matrixWorld)});
      }
    });
    const raycaster=new THREE.Raycaster();
    const pa=new THREE.Vector3(),pb=new THREE.Vector3();
    const rayPoint=new THREE.Vector3(),edgePoint=new THREE.Vector3();
    const pickEdge=event=>{
      const rect=canvas.getBoundingClientRect();
      const x=event.clientX-rect.left,y=event.clientY-rect.top;
      const candidates=[];
      edges.forEach(edge=>{
        pa.copy(edge.a).project(camera);pb.copy(edge.b).project(camera);
        if((pa.z>1&&pb.z>1)||(pa.z < -1&&pb.z < -1))return;
        const ax=(pa.x+1)*rect.width/2,ay=(1-pa.y)*rect.height/2;
        const bx=(pb.x+1)*rect.width/2,by=(1-pb.y)*rect.height/2;
        const dx=bx-ax,dy=by-ay,length2=dx*dx+dy*dy;
        const t=length2?Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/length2)):0;
        const sx=ax+t*dx,sy=ay+t*dy;
        const d2=(x-sx)**2+(y-sy)**2;
        if(d2<=100)candidates.push({edge,d2,sx,sy});
      });
      candidates.sort((a,b)=>a.d2-b.d2);
      for(const candidate of candidates){
        raycaster.setFromCamera(new THREE.Vector2(candidate.sx/rect.width*2-1,1-candidate.sy/rect.height*2),camera);
        raycaster.ray.distanceSqToSegment(candidate.edge.a,candidate.edge.b,rayPoint,edgePoint);
        const surface=raycaster.intersectObjects(meshes,false)[0];
        if(surface&&surface.distance+radius*.001 < raycaster.ray.origin.distanceTo(rayPoint))continue;
        const {a,b}=candidate.edge;
        const centimeters=a.distanceTo(b)*100;
        const text=`${new Intl.NumberFormat('es-CO',{maximumFractionDigits:2}).format(centimeters)} cm`;
        selection={midpoint:a.clone().add(b).multiplyScalar(.5)};
        highlightGeometry.setPositions([a.x,a.y,a.z,b.x,b.y,b.z]);highlightGeometry.computeBoundingSphere();highlight.visible=true;
        label.textContent=text;label.hidden=false;
        onMeasure({centimeters,text});render();return;
      }
      clearMeasurement();
    };
    let pointer=null;
    canvas.addEventListener('pointerdown',event=>{
      if(!event.isPrimary||event.button!==0){pointer=null;return;}
      pointer={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};
    },{signal:events.signal});
    canvas.addEventListener('pointermove',event=>{
      if(pointer&&Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>5)pointer.moved=true;
    },{signal:events.signal});
    canvas.addEventListener('pointerup',event=>{
      const click=pointer;pointer=null;
      if(click&&click.id===event.pointerId&&!click.moved)pickEdge(event);
    },{signal:events.signal});
    canvas.addEventListener('pointercancel',()=>{pointer=null;},{signal:events.signal});
    canvas.addEventListener('keydown',event=>{if(event.key==='Escape')clearMeasurement();},{signal:events.signal});
    const resize=()=>{
      const width=host.clientWidth,height=host.clientHeight;
      if(!width||!height)return;
      renderer.setSize(width,height,false);highlightMaterial.resolution.set(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();render();
    };
    observer=new ResizeObserver(resize);observer.observe(host);
    controls.addEventListener('change',render);controls.update();resize();
    host.dataset.edgeSegments=String(edgeSegments);
    return {dispose,clearMeasurement};
  }catch(error){dispose();throw error;}
}
